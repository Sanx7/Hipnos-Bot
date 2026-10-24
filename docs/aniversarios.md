# Aniversários do Hipnos

Sistema comemorativo, sem recompensas e sem exigir um personagem registrado.
Os comandos aparecem no menu RPG, preservando as páginas de 12 entradas.

## Uso e privacidade

- `/aniversario DD/MM`: salva ou atualiza **somente a própria data**. Sempre deixa o cadastro privado, inclusive em atualizações. Não armazena ano de nascimento.
- `/aniversario publico`: autoriza divulgação em todos os grupos elegíveis, listagem, ficha pública e homenagem anual com menção a todos. É uma ação explícita separada do cadastro.
- `/aniversario privado`: revoga essa autorização para novas divulgações.
- `/meuaniversario`: consulta a própria data e a autorização. No privado, mostra a data nos dois modos. No grupo, só mostra a data com autorização pública explícita; no modo privado, orienta consultar no privado do bot.
- `/aniversarios [página]`: lista até 20 participantes por página, com autorização pública e identidade comprovada nos metadados atuais do grupo. Hoje vem primeiro; depois, as próximas datas, inclusive na virada do ano. Pessoas externas e identidades ambíguas não aparecem.
- `/removeraniversario`: remove somente o próprio cadastro. Não apaga mensagens já enviadas.

A `/ficha` só acrescenta a data quando pública em grupos; no privado, o próprio titular pode ver sua data privada. Falhas nessa consulta opcional não impedem a ficha. O sistema não altera jogadores, idade do personagem, economia, relacionamentos ou moderação.

**29/02:** aceito no cadastro e comemorado em **28/02** nos anos não bissextos. No ano bissexto, a homenagem é somente em 29/02. A listagem ordena pela data efetiva da próxima comemoração.

## Agendamento e grupos elegíveis

O agendador usa `America/Sao_Paulo`, verifica a data atual ao conectar e a cada 60 segundos, sem depender de comandos executados no aniversário. Não há varredura apenas na meia-noite: cadastros/autorização feitos no próprio dia podem entrar nos ciclos seguintes. A autorização pública também solicita uma consulta imediata; se já houver ciclo em andamento, solicita outro ao terminar. Não envia homenagens retroativas de dias em que o bot esteve offline.

Exige o socket atual registrado e aberto, lease da sessão válida, uso global do bot ligado, MongoDB acessível, data correspondente e autorização atual. Consulta `groupFetchAllParticipating` para descobrir os grupos, mas comprova pertencimento com `groupMetadata` atual. Grupos raiz/comunidade de avisos são excluídos. Em grupos restritos a administradores, o bot precisa ser administrador comprovado; em grupos comuns, basta comprovar que o bot é membro. Dados de grupo incompletos impedem o envio.

Antes do envio, consulta novamente os metadados, a presença do aniversariante e a revisão/autorização do cadastro. A mensagem inclui o aniversariante no texto e usa `mentions` e `contextInfo.mentionedJid` com todos os IDs atuais do grupo, inclusive administradores. A indicação `📣 @Todos` é apenas visual: a notificação depende do array real do Baileys. PN/LID são associados pelo resolvedor existente, nunca por coincidência de dígitos.

Não modifica `/hidetag` ou `/totag`. O timer é único no processo e encerrado ao fechar/substituir o socket, perder a lease ou encerrar o bot.

## Persistência e entregas

Reutiliza `rpg/conexao-mongo.js` e `usarContextoRpg`, com as variáveis já usadas pelo RPG (`MONGO_URI_RPG` e o banco resolvido por aquele módulo). Não cria cliente/pool novo nem usa as coleções financeiras.

Coleções novas nesse banco:

- `aniversariosHipnos`: `_id` = telefone comprovado, `dia`, `mes`, `publico`, `revisao`, datas de criação/atualização. Índice próprio `{ publico: 1, mes: 1, dia: 1 }`.
- `aniversariosEntregas`: `_id` = SHA-256 da combinação pessoa/grupo/ano, token, ano, estado e timestamps. Não guarda telefone, grupo ou data de nascimento em campos separados. O índice único nativo de `_id` impede reservar duas vezes a mesma homenagem anual. Não tem TTL.

Usa leitura `majority`, escrita `majority` e servidor primário. Falhas de inicialização/índice/escrita confirmada bloqueiam operações e envios.

O recibo é persistido como `incerta` **antes** de chamar o WhatsApp. Só muda para `enviada` quando `sendMessage` devolve um identificador de mensagem e essa confirmação é persistida. Isso confirma a aceitação pelo transporte, não leitura/entrega no aparelho de cada destinatário.

Se o socket rejeitar, houver timeout, retorno vazio, queda do processo ou falha de gravação da confirmação, o recibo permanece `incerta`. **Não há reenvio automático desse recibo**, mesmo após reinício. Um timeout não comprova que o WhatsApp recusou a mensagem; repetir poderia duplicar a homenagem. Uma queda entre a reserva e a chamada ao transporte também pode deixar uma homenagem não enviada nesse estado. Não é possível fazer uma transação atômica entre MongoDB e WhatsApp.

Se uma verificação falhar após a reserva mas **antes de invocar** `sendMessage`, a reserva pode ser liberada para um ciclo futuro. Os recibos anuais permanecem após remoção/recadastro ou mudança de data, evitando reabrir homenagens no mesmo ano. Não apagar recibos incertos para forçar reenvio sem revisão explícita do resultado. Logs contêm somente eventos fixos, sem JIDs, conteúdo ou erros crus.

## Hospedagem e validação

Enviar os arquivos de produção listados na entrega e reiniciar o processo. Não é necessária dependência nova. O MongoDB usado pelo RPG precisa permitir leitura/escrita nas duas coleções e criação do índice próprio. Nenhuma conexão real é aberta pelos testes.

Os testes usam MongoDB em memória, transporte simulado e metadados fictícios. Incluem concorrência entre agendadores com repositório persistido compartilhado, reinício/reconexão, consentimento, saída do grupo, falhas e datas especiais. Essa evidência não substitui validar permissões reais do banco, conexão/lease na hospedagem e notificações no WhatsApp.

## Verificação desta implementação

Todas as 17 suítes abaixo passaram, executadas com `node scripts/<arquivo>`:

| Arquivo | Resultado |
| --- | --- |
| `teste-aniversarios.js` | 49 testes |
| `teste-aniversarios-conexao.js` | lifecycle em VM |
| `teste-menus-olimpo.js` | 54 testes |
| `teste-loader.js` | 646 entradas registradas |
| `teste-on-off.js` | 86 testes |
| `teste-conexao-bot.js` | 61 verificações |
| `teste-setads-conexao.js` | 9 verificações |
| `teste-mongo-conexoes.js` | 82 testes |
| `teste-rpg-fase1.js` | aprovado |
| `teste-rpg-fase2.js` | aprovado |
| `teste-rpg-lid.js` | aprovado |
| `teste-rpg-empregos.js` | 14 cenários |
| `teste-rpg-faculdade.js` | 20 cenários |
| `teste-rpg-seguranca.js` | 23 cenários |
| `teste-rpg-conexao.js` | 3 cenários |
| `teste-casamento-olimpo.js` | 61 cenários |
| `teste-animacoes-comandos.js` | 44 testes |

A suíte de animações também cobre as regressões dos comandos adultos. Sintaxe de 11 arquivos de runtime e testes dedicados e `git diff --check` aprovados. Nenhum teste do comando secreto foi executado ou alterado nesta implementação.
