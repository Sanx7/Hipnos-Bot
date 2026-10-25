# Investigação do TikTok por contexto — 25/10/2026

Base: `d191cefe3792d2c02c3464ed26b8ea6e83855b5f`, branch `feat/casamento-olimpo`.

## Conclusão e limites

Foi reproduzida e corrigida uma falha real do roteador: a moderação examinava o lote inteiro de `messages.upsert`, mas o fluxo de comandos usava somente `messages[0]`. Um `/tiktok` posterior à primeira mensagem desaparecia; uma primeira mensagem ignorada, por exemplo `fromMe`, descartava também as seguintes. A falha não era exclusiva do TikTok, do nome de um grupo, de PN/LID ou de uma quantidade específica de participantes.

**Não está demonstrado que essa seja a causa do incidente no Swag.** Não houve acesso ao grupo, aos seus participantes ou às configurações reais. Grupos movimentados podem receber lotes múltiplos, mas isso continua uma hipótese para esse incidente. A correção precisa ser validada no grupo real pelo operador.

Também foi reproduzida uma configuração que explica exatamente a diferença entre comandos com link e `/ping`/`/menu`: com o antilink básico ativo, o listener tenta apagar a mensagem contendo URL e retorna antes de reconhecer o comando. Não há aviso de processamento. **Essa proteção não foi contornada nem desativada**. Não sabemos se está ativa no Swag.

## Correção e instrumentação

- Em eventos novos (`type === 'notify'`), cada mensagem percorre o roteador e suas barreiras, em sequência. Um retorno ou falha de uma mensagem não descarta as seguintes.
- A moderação continua sendo feita no lote inteiro antes dos comandos, na mesma ordem. Mensagens já tratadas continuam bloqueadas. O processamento de votos conserva sua precedência.
- Nos demais tipos de evento, inclusive `append`, foi preservado o alcance anterior de roteamento (somente a primeira mensagem). A correção não amplia replay de comandos históricos. Isso não equivale a afirmar que exista uma nova barreira global contra histórico.
- Nenhuma alteração nas regras de dono, administrador, Arconte, OFF, mute ou moderação; nenhuma exceção de links para comandos de download.
- Logs opcionais acompanham TikTok e seus aliases, incluindo áudio, desde a recepção até fonte, download, preparação e envio. Erros existentes dos módulos TikTok passaram a usar categorias, sem imprimir objetos de erro, URLs de provedores ou detalhes brutos do FFmpeg.

A execução permanece sequencial dentro de um lote; uma operação lenta pode atrasar as mensagens seguintes daquele lote. O diagnóstico registra `fila` ou a etapa pendente. Ele não cancela nem repete envios e não modifica os timeouts existentes.

## Pontos de interrupção revisados

| Etapa | Comportamento/ponto de silêncio | Como distinguir |
| --- | --- | --- |
| Baileys/socket | Socket indisponível ou lease inválida retorna antes das regras. Mensagens não recebidas não geram rastros. | `recebida` seguido de `socket/bloqueado`; ausência de rastros exige primeiro conferir ativação, limite de amostragem e reconhecimento do candidato. |
| Lote | Antes, somente a primeira mensagem era roteada; as demais eram descartadas. | Corrigido para `notify`; `lote=multiplo`, `posicao=seguinte` no diagnóstico. |
| Moderação persistente | Antilinkhard, antiflood/cooldown, limite, figurinhas e antigolpe podem consumir a mensagem. Uma consulta pendente pode segurar o lote. | Evento da regra com `resultado=bloqueado`, ou `aguardando` durante a regra. |
| Votos/revogação/fromMe | Consumo pelo sistema de votos, reenvio de apagada ou mensagem do próprio bot termina o fluxo individual. | `voto`, `revogacao` ou `from_me` com bloqueio. |
| Regras básicas do grupo | Antiáudio/documento/evento podem considerar mídia ou reply; antilink considera URL; antipagamento/status têm seus próprios retornos. JSON inválido pode interromper a mensagem. | Eventos `anti_*`, `antilink_basico` ou `erro_mensagem`. Configurações foram simuladas, não consultadas no grupo real. |
| Mute e manutenção | Mute pode retornar sem aviso. OFF/indisponibilidade de estado bloqueia usuários não autorizados. | `mute/bloqueado`, `manutencao/bloqueado` ou espera na consulta. OFF é global, portanto é hipótese menos compatível quando o mesmo usuário consegue executar outros comandos naquele instante. |
| AFK/PN/LID | Metadados são consultados quando há LID entre autor/alvos; consultas de identidade/AFK podem atrasar. Erros de AFK preservam o fluxo. | `afk`, `metadados_afk`, `aguardando`. O diagnóstico não altera a resolução de identidades nem libera acesso negado pelas regras existentes. |
| Prefixo/registro | Texto extraído vazio, prefixo divergente ou nome sem registro pode terminar sem resposta. | `prefixo`, `nao_comando` ou `registro/ausente`; os aliases atuais passaram nos três prefixos. |
| Somente admin | `/soadm` pode ignorar usuário comum; falta de metadados não libera acesso. Arconte não ganha acesso geral aos downloads por essa patente. | `restrito/bloqueado`, consulta de metadados e demais regressões de permissões. |
| TikTok/fonte | Não existe confirmação inicial de processamento. A cascata pode demorar até três tentativas de 15 segundos. | `handler` e `fonte`, resultado de erro ou espera. Não foram feitos requests reais. |
| Download/preparação | Axios usa timeout de 120 segundos e limite de 50 MB; thumbnail tem teto de 30 segundos e permite fallback sem preview. | `download`, `preparar_midia`, resultado de erro/espera. Fonte, download, preparação e envio são etapas distintas. |
| WhatsApp | Envio pode falhar ou ficar pendente; o envio do aviso de erro também pode falhar e era deliberadamente silenciado. | `envio_midia` e `aviso_erro` com início/ok/erro/aguardando. Grupo de anúncios, permissões do bot, criptografia/fanout e infraestrutura real só poderão ser avaliados na hospedagem. |

O próprio `/tiktok` não exige metadados de participantes nem tem cooldown ou autorização especial de grupo. Essas diferenças surgem do listener compartilhado e do transporte do WhatsApp. Não foi encontrado conflito no registro de `tiktok` e seus aliases. O nome “Swag” não é utilizado em nenhuma condição introduzida.

`/tiktok-audio` e outros downloads atravessam o mesmo listener: podiam sofrer descarte de lote e continuam sujeitos ao antilink, mute, OFF e somente admin. O áudio reutiliza a cascata e o downloader do TikTok. Os estágios internos de fonte/download/envio instrumentados aqui são específicos dos dois comandos TikTok; não foi instrumentado o conteúdo dos demais comandos.

## Diagnóstico seguro na LatamHost

O padrão é **desativado**. Para uma coleta curta, o operador pode definir `HIPNOS_DIAG_TIKTOK=true` nas variáveis do painel e carregar os arquivos atualizados conforme seu procedimento habitual. Não é preciso editar `.env`. Nenhuma mudança de painel, envio de arquivo ou reinício foi feito nesta investigação.

Os registros têm a tag `[diag-tiktok]` e um `rastro` aleatório por tentativa. Não registram número, JID, LID, nome do grupo, ID da mensagem, link, mídia, argumento do comando, token, credencial ou objeto de erro. `conversa` e `identidade` são somente classificações (`grupo/pv`, `pn/lid/outro`). Os rastros não permitem mapear permanentemente uma conversa ou participante.

Limites: quatro rastros por lote, vinte por janela de dez minutos por processo e 45 eventos por rastro. Uma etapa ainda pendente após vinte segundos pode emitir `aguardando`; isso é telemetria, não timeout, cancelamento ou retentativa. O fim do fluxo (`fim`) **não significa que o vídeo foi entregue**; confira o resultado de `envio_midia`. Mesmo `envio_midia/ok` confirma o retorno da chamada, não leitura/reprodução no aplicativo do destinatário.

Roteiro manual, somente depois de o operador aplicar e carregar os arquivos:

1. Com o diagnóstico habilitado e sem exceder a amostragem, testar uma conversa por vez. Registrar o horário local da tentativa e qual conversa estava sendo testada, fora dos logs do bot.
2. No PV, executar `/tiktok` com o link escolhido; depois repetir no Swag com o mesmo link. Fazer também um teste isolado de `/tiktok-audio`. Respeitar o prefixo configurado.
3. Comparar a sequência do mesmo `rastro`: recepção → regras → reconhecimento → handler → fonte → download → envio. Se houver silêncio, aguardar ao menos o evento diagnóstico de vinte segundos e observar em qual etapa parou, sem repetir comandos em sequência.
4. `antilink_basico/bloqueado` confirma que a regra impediu aquela tentativa; `restrito/bloqueado` indica uma barreira de acesso. Não desativar proteções automaticamente. Conferir a configuração com o administrador e decidir a política do grupo separadamente.
5. Se parar em `metadados_afk`/`metadados_restrito`, investigar metadados e PN/LID. Se parar em `envio_midia`, revisar transporte/configuração do grupo/permissões do bot. Se parar em `fonte` ou `download`, investigar provedor/rede usando os códigos seguros, sem publicar URLs ou credenciais.
6. Se não houver `recebida`, conferir carregamento dos arquivos, variável e limite da janela. O log registra candidatos TikTok conhecidos; ausência de registro não prova isoladamente que o Baileys não recebeu o evento.
7. Confirmar visualmente a chegada/reprodução do vídeo no Swag e funcionamento no PV. Retirar `HIPNOS_DIAG_TIKTOK` ou definir `false` ao encerrar a coleta, recarregando o processo conforme o painel exigir.

**Ainda precisamos dessa coleta/teste real para determinar a causa do incidente e confirmar sua resolução.** Não usar números/links privados ao compartilhar os registros e não compartilhar logs gerais de sessão/autenticação.

## Testes e alterações

Antes da correção, o novo teste de contexto registrou **44 aprovações e duas falhas** nos cenários de lote; os controles PV/grupo passaram. O antilink básico reproduziu o bloqueio esperado, sem representar um defeito de autorização.

Após a correção e a ampliação da cobertura, `teste-tiktok-contexto.js` tem **51 casos** e `teste-diagnostico-tiktok.js` tem **10 casos**, todos offline. Incluem grupo fictício de 2.048 participantes, PN/LID separados, metadados incompletos/ambíguos sem restrição, indisponibilidade de metadados com restrição, manutenção, mute, marcadores de moderação, prefixos, aliases, falhas simuladas e segurança dos rastros. As regras de moderação são injetadas no teste de contexto para verificar seu efeito no roteamento; as suítes específicas exercitam as implementações reais com coleções fictícias.

Na primeira regressão ampla, houve três falhas de integração dos testes: `teste-afk` e `teste-arcontes-olimpo` não injetavam a nova dependência ao executar trechos isolados em VM; `teste-mongo-conexoes` exigia identidade textual do listener com HEAD. Foram corrigidas as injeções e delimitada a exceção do listener autorizado, mantendo igualdade integral para os módulos Mongo, conexão, lease e lifecycle externos a ele. O listener atualizado é exercitado pelos testes de contexto, ON/OFF e proteção. Nenhuma expectativa de permissão foi removida.

**Rodada final completa:** 148 suítes descobertas, 142 executadas e aprovadas, zero reprovadas e zero timeouts. Foram registrados **4.082 casos/verificações individuais aprovados**, mais cinco suítes integradas aprovadas sem subdivisão individual informada. As repetições e reproduções anteriores não são somadas ao total final. Sintaxe dos 526 arquivos JavaScript aprovada e `git diff --check` aprovado.

Permaneceram não executadas, pela exigência offline, as seis integrações históricas: `teste-acoes`, `teste-play`, `teste-nasa-integracao`, `teste-mongo-conexoes-real`, `teste-jornal-mongo-real` e `teste-rpg-integracao-mongo`. `npm test` continua sendo um placeholder; a execução usou `node scripts/auditoria-offline.js`, em cópias temporárias com credenciais/rede/MongoDB reais bloqueados. Não houve validação de tráfego real ou da hospedagem.

| Regressão relevante | Resultado final |
| --- | --- |
| Contexto TikTok / diagnóstico seguro | 51 / 10 casos aprovados |
| TikTok existente / downloads extras | 18 / 39 casos aprovados |
| ON/OFF / proteção do bot | 86 / 48 casos aprovados |
| Donos / Arcontes | 72 / 98 casos aprovados |
| AFK / conexões Mongo simuladas | 22 / 82 casos aprovados |
| Antigolpe / antiflood / antilinkhard | 198 / 78 / 97 casos aprovados |
| Limite de caracteres / totag | 167 / 122 casos aprovados |
| Menus / aliases / loader | 54 / 33 casos aprovados; loader integrado aprovado |

Arquivos de produção para envio manual à LatamHost, em conjunto:

- `bot.js`
- `dados/diagnostico-tiktok.js` (novo; obrigatório mesmo com diagnóstico desligado)
- `comandos/menu-download/tiktok.js`
- `comandos/menu-download/tiktok-audio.js`

Arquivos de testes/documentação, sem necessidade de envio para executar o bot:

- `scripts/teste-tiktok-contexto.js` (novo)
- `scripts/teste-diagnostico-tiktok.js` (novo)
- `scripts/teste-afk.js`
- `scripts/teste-arcontes-olimpo.js`
- `scripts/teste-mongo-conexoes.js`
- `scripts/teste-protecao-bot.js`
- `docs/investigacao-tiktok-contexto-2026-10-25.md` (novo)

As alterações das sete etapas anteriores e os relatórios históricos foram preservados. Nenhuma conexão WhatsApp/MongoDB real, operação de migração real, mudança de dados privados, commit, push ou deploy foi realizado.
