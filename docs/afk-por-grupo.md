# AFK independente por grupo

Cada AFK agora é identificado por `{ grupo_id, numero }`, onde `grupo_id` é o
JID completo do grupo e `numero` é o telefone comprovado via PN/metadados/sessão
Baileys. Uma mensagem em B nunca consulta/remove o AFK de A. Motivos e horários
são independentes, mesmo para a mesma pessoa em vários grupos.

O AFK privado foi preservado em um escopo próprio: nesse caso `grupo_id` contém
o JID PN canônico do chat privado. Ativar/retornar no privado não afeta grupo
algum. Uma identidade LID sem resolução comprovada não é gravada ou comparada
como telefone; o comando explica a indisponibilidade e mantém o estado.

## Pontos do fluxo

- `comandos/afk.js`: resolve PN/LID e ativa/atualiza somente a conversa atual.
- `afk.js`: todas as APIs de gravação, consulta e remoção exigem o escopo;
  a consulta em lote usa `{ grupo_id, numero: { $in: [...] } }`.
- `bot.js`, bloco SISTEMA AFK: consulta remetente, menções e autor do reply;
  retira AFK somente do remetente no escopo atual e anuncia só os ausentes
  desse escopo. A atualização por `/afk` respeita o prefixo dinâmico. Retornos
  concorrentes dependem da remoção atômica para não enviar avisos duplicados.
- `comandos/meuslembretes.js`: utiliza apenas `formatarDuracao`, sem estado AFK;
  a função e seu contrato foram preservados.

O posicionamento do bloco no handler permanece: moderação/ranking/cache antes;
barreira interativa ON/OFF, comandos, jogos e IA depois. OFF ainda permite
atualização interna AFK sem avisos para quem não pode interagir. Mute, mensagens
do próprio bot e demais filtros do roteador continuam com a mesma precedência.

## Índices, legados e migração

O esquema anterior gravava `{ numero, motivo, desde }` na coleção `afks`, com
índice único global `{ numero: 1 }` chamado `idx_afks_numero`. Esse índice impede
vários AFKs por pessoa mesmo se um índice composto for acrescentado. Além
disso, registros antigos podem conter LID cru no campo `numero`, sem namespace.
Não existe evidência persistida suficiente para inferir grupo e identidade.

A migração é por isolamento de esquema, no MESMO banco e configuração Mongo:

| Uso | Coleção padrão | Índice |
| --- | --- | --- |
| Origem preservada, sem uso como status ativo | `afks` | índices anteriores intactos |
| AFKs novos por grupo/conversa | `afks_por_grupo` | único `{ grupo_id: 1, numero: 1 }`, `idx_afks_grupo_numero` |

Se `MONGODB_COLLECTION_AFK` já estiver definido, ele continua sendo o nome da
origem; a coleção ativa usa esse nome mais `_por_grupo`. Nenhuma variável precisa
ser alterada. `MONGODB_URI` e `MONGODB_DB` permanecem os mesmos.

Nenhum documento legado é copiado, apagado, atribuído a um grupo ou convertido
em PN automaticamente. Até campos de grupo eventuais na origem são preservados
sem assumirmos que pertencem ao novo esquema. Os AFKs antigos ficam como dados
históricos pendentes. **Os usuários precisam ativar `/afk` novamente nos grupos
desejados.** Uma reativação não altera o documento antigo.

O runtime prepara apenas a coleção nova e o índice composto, de forma
idempotente, no primeiro acesso ao AFK. Não remove/recria índices da origem.
Duplicatas ou falha de índice na coleção nova bloqueiam a inicialização do AFK
com erro tratado; não há limpeza automática de dados. O resto do bot continua.

Há uma ferramenta manual para inspecionar índices/contagens e preparar o destino:

```sh
node scripts/migrar-afk-por-grupo.js --help
node scripts/migrar-afk-por-grupo.js --dry-run
node scripts/migrar-afk-por-grupo.js --apply
```

`--dry-run` é o padrão e faz somente leitura. `--apply` cria/verifica apenas o
índice novo; não modifica documentos ou índices legados. Os relatórios contêm
contagens/definições de índice, sem números, motivos ou documentos AFK. A
ferramenta lê a configuração Mongo existente e não deve ser executada contra
produção durante testes. Nenhuma execução real de dry-run/apply foi feita nesta
alteração: a análise dos registros/índices usou o esquema do código e fixtures.

## Testes e atualização na LatamHost

`scripts/teste-afk.js` executa o bloco real extraído de `bot.js`, o comando real,
um Mongo em memória e sessão Baileys injetada, com rede bloqueada. Cobre dois
grupos, AFKs simultâneos, privado separado, menção/reply, PN/LID, prefixo,
persistência/reinicialização, formatos de retorno do driver, concorrência,
falhas e preservação dos legados/índices. O script antigo que replicava o bloco
foi substituído por essa execução do código de produção.

Antes da publicação manual, preserve backup das coleções envolvidas e pare a
instância antiga para não manter dois modelos AFK em execução. Revise/aplique
o código e mantenha `.env`, sessão, dependências e `DISABLE_CANVAS` atuais. O
usuário Mongo precisa poder criar a coleção/índice novos, como já era necessário
para o índice anterior. A ferramenta opcional acima permite auditoria antes da
reinicialização; o próprio runtime também prepara o destino.

Reinicie e valide em dois grupos de teste autorizados: ative `/afk` em ambos,
envie mensagem em apenas um e confirme que o outro permanece ativo. Avise os
usuários sobre a reativação dos estados legados. Não reinstale dependências.
Não execute a versão antiga novamente sem considerar que ela ainda leria seus
registros globais históricos. Esta alteração não faz commit, push ou deploy.
