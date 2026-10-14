# Verdade ou Consequência por enquete

`/verdadeouconsequencia` abre uma enquete nativa com Verdade, Consequência e Aleatório. Os aliases `vouc`, `verdadeconsequencia` e `verdadeouconseq` continuam disponíveis, com o prefixo dinâmico do bot. Uma menção escolhe o participante autorizado; sem menção, joga o autor. Argumentos antigos de categoria não pulam a escolha na enquete.

Apenas esse participante decide a rodada, em até 120 segundos. O primeiro voto válido recebido conclui a rodada e envia uma mensagem com menção. Remoções de voto não escolhem categoria; mudanças ou duplicatas depois da conclusão são ignoradas. Cada jogador pode ter uma rodada por grupo, sem bloquear `/enquete` ou os outros jogos.

Se a enquete não funcionar, o participante pode usar `/verdade` ou `/consequencia` durante sua rodada. Esses nomes não são comandos globais: o roteador só tenta o fallback quando nenhum comando existente possui esse nome. O aviso usa o prefixo atual. OFF bloqueia criação e conclusão, inclusive para donos; desconexão, saída do participante e expiração limpam o estado.

## Identificação dos votos

O registro temporário guarda grupo, ID real da mensagem enviada, identidade autorizada, instante de criação, prazo e estado. A escolha nunca depende do texto da enquete. O payload usa `selectableCount: 1` e reutiliza `montarEnquete` de `dados/enquetes-nativas.js`.

O Baileys instalado é `7.0.0-rc14`. Em `lib/Utils/process-message.js`, a emissão automática de `messages.update` para votos está comentada. Por isso o handler também entrega os `pollUpdateMessage` de todos os itens novos (`notify`) do lote ao gerenciador. O segredo da mensagem original, o ID real, o JID do criador e o JID do eleitor são usados por `decryptPollVote`. A autenticação AES-GCM precisa passar antes de interpretar o hash SHA-256 da opção. Atualizações já decifradas emitidas internamente pelo Baileys em `messages.update` também são aceitas, com as mesmas verificações de grupo, autor, horário e estado.

PN e LID só são equivalentes quando pertencem a um único participante nos metadados atuais. Dígitos iguais entre namespaces, nome exibido, identidade desconhecida ou associação ambígua não autorizam. O gerenciador tenta os namespaces comprovados na descriptografia; não inventa telefone para um LID. Sem metadados confiáveis, não há resultado.

## Conteúdo e modo adulto

As 369 verdades e os 206 desafios do banco foram preservados. `vouc-conteudo-livre.json` contém os textos revisados como livres; os demais ficam sujeitos a `modoAdultoAtivo(grupo)`. A lista é conservadora: conteúdo novo ou não classificado só fica disponível com modo adulto ligado. Para liberar uma nova frase no modo comum, revise-a e inclua seu texto exato na lista correspondente desse JSON.

O modo é consultado na escolha, e a permissão é reconfirmada antes de entregar conteúdo adulto. Erro na consulta não libera +18. Nenhuma migração ou alteração na configuração MongoDB é necessária.

## Limites reais

- As rodadas vivem em memória e são canceladas ao desconectar ou reiniciar. Enquetes antigas podem continuar visíveis no WhatsApp, mas seus votos deixam de ter efeito.
- Não existe garantia de receber todos os votos do WhatsApp. Segredo ausente, payload que não autentica, timestamp ausente/incompatível ou metadados indisponíveis impedem o sorteio por voto; há fallback por comando.
- A primeira escolha válida **recebida** vence. O bot não consegue recuperar a ordem real de eventos que o WhatsApp não entregou.
- A entrega do resultado tem uma única tentativa. Em falha ou resposta ambígua, a rodada fica consumida e não há retry automático que possa duplicar o desafio.
- A configuração adulto não é uma verificação de idade dos participantes.
- Os testes usam sockets e coleções falsos com payloads/votos cifrados do Baileys real. Não validam dispositivos ou tráfego real do WhatsApp.

## Verificação offline

```powershell
node scripts/teste-vouc.js
node scripts/teste-on-off.js
node scripts/teste-enquetes-nativas.js
node scripts/teste-enquete.js
node scripts/teste-enquete-admin.js
node scripts/teste-loader.js
node --check bot.js
git diff --check
```

Os scripts usam mocks de armazenamento e conexão. Não iniciar `bot.js` para executar essa verificação.

## Revisão final

Foram corrigidas duas falhas reproduzidas offline:

- A conexão fechava durante uma consulta de ON/OFF e o retorno antigo ainda permitia criar uma enquete. A disponibilidade e o estado de encerramento agora são reconferidos depois da consulta.
- Alvo e eleitor eram consultados em retratos diferentes dos metadados, permitindo misturar associações PN/LID alteradas. A autorização agora compara ambos no mesmo retrato e reconfirma o próprio eleitor antes de revelar a pergunta/desafio.

Os testes adicionais cobrem o pipeline instalado `7.0.0-rc14` com `cleanMessage`, timestamps protobuf Long e votos AES-GCM reais; o mesmo voto em `messages.upsert` e `messages.update`, nas duas ordens e simultaneamente; remoções/replays fora de ordem; grupo/ID/autor incorretos; nova rodada após expiração; desconexão durante consultas pendentes; e prioridade de um comando existente sobre o fallback no handler real.

Foi exercitada a entrega de cada um dos 575 textos no modo adulto, e de cada um dos 415 textos livres no modo comum. Os 160 demais continuam restritos ao modo adulto. O banco não foi alterado nesta revisão.

Resultado: 56 testes de VOUC, 82 de ON/OFF, 38 de enquetes nativas, 49 de `/enquete` e 53 de `/enquete-admin` passaram, além do loader (584 entradas), sintaxe e conferência do diff. Não houve mensagens reais, commit ou deploy. A limitação do rc14 continua sendo a emissão automática comentada de votos em `messages.update`; o caminho criptografado em `messages.upsert` permanece necessário.
