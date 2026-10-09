# Tribunal dos Sonhos

Os comandos existentes e seus aliases permanecem. `/adv` e `/remadv` exigem
ADM ou dono do grupo. `/advs`, `/historicoadv` e `/zeraradv` também aceitam dono
do bot. `/minhaspunicoes [página]` consulta somente o próprio remetente.
`/setlimiteadv 5` exige dono do bot e grupo; aceita de 1 a 10.

## Dados e compatibilidade

Advertências continuam em `MONGODB_COLLECTION_ADV` (padrão `advertencias`), no
banco `MONGODB_DB` (padrão `whatsapp`). Não há migração nem exclusão de documentos.
`ativa: true` continua sendo o filtro de contagem, inclusive para registros antigos.
Documentos novos também têm `estado: ativa`. O perdão mantém o documento e grava
`estado: perdoada`, `ativa: false`, `removido_por` e `removida_em`. O arquivo grava
`estado: arquivada`, `ativa: false`, `arquivada_por` e `arquivada_em`.
Os documentos antigos sem `estado` são apresentados como ativos ou arquivados
conforme `ativa`; dados de responsável inexistentes são apresentados como não registrados.
Registros apagados antes desta mudança não podem ser recuperados pelo código.

`configAdvertencias` guarda um documento por grupo, `_id = JID do grupo`, com
`limite`, `atualizado_por` e `atualizado_em`. Ausência do documento usa padrão 3;
falha de leitura impede a aplicação de nova advertência. Mudar o limite não percorre
participantes nem dispara banimentos. A próxima advertência usa o novo limite.
`/adv` e `/figadv` usam a mesma coleção, contagem, limite e serialização.
A proteção automática de figurinhas continua isentando ADM, dono e bot.
As permissões manuais existentes não foram ampliadas.

## Concorrência e falhas parciais

Há uma fila por pessoa/grupo no processo e uma reserva exclusiva no MongoDB,
em `advertenciasOperacoes`, com `_id = grupo:telefone`, token, data e estado.
Aplicação, decisão de banimento e arquivamento ficam na mesma reserva; perdão
e zeragem usam essa mesma barreira. Outro processo que encontra a reserva
recusa a operação, sem modificar o contador. Grupos e pessoas diferentes
continuam independentes.

A reserva não expira automaticamente. Uma falha de transporte após iniciar a
remoção pode ter ocorrido depois da aceitação do WhatsApp. Resposta vazia,
crash do processo ou falha após remoção confirmada exigem reconciliação pelo
operador. Isso evita repetir expulsões incertas. Status explicitamente recusado
libera a reserva, preservando as advertências e sem gravar blacklist.

Antes de reconciliar uma reserva pendente:

1. Parar todas as instâncias que operam esse grupo e preservar uma cópia dos registros.
2. Consultar a reserva, as advertências e a participação real no WhatsApp.
3. Para `remocao_confirmada`, conferir blacklist e arquivamento; para `em_andamento`,
   determinar se a remoção ocorreu. Não inferir sucesso só pela contagem.
4. Concluir apenas os registros daquele participante/grupo, preservando histórico
   e responsáveis. Não repetir `groupParticipantsUpdate` automaticamente.
5. Só após reconciliar os efeitos, remover a reserva identificada por `_id` e token
   conferidos. Não limpar a coleção inteira. Reiniciar as instâncias.

WhatsApp, MongoDB e JSON não oferecem uma transação conjunta. Os testes são
offline e usam sockets e coleções simuladas; não executam expulsões reais.

## Blacklist no Render

O JSON atual em `comandos/dados/blacklist.json` foi preservado, com os mesmos
leitores e comandos. O ban compartilhado grava nele somente após status 200
da remoção. A escrita substitui o JSON atomicamente e recusa conteúdo inválido,
preservando os dados existentes. Falha na gravação é informada como pendência, sem negar uma remoção
já confirmada. Não houve migração, limpeza nem mudança na autenticação Baileys.

Render usa filesystem efêmero por padrão; somente arquivos dentro do caminho
de um disco persistente são preservados entre reinícios/deploys:
https://render.com/docs/disks

Não foi consultado o painel do serviço. Antes de qualquer deploy, verificar se
o caminho atual do JSON está em armazenamento persistente e preservar uma cópia.
Uma futura migração exige backup, leitura compatível por todos os comandos,
validação dos registros e procedimento explícito de recuperação. Este trabalho
não a executa nem configura disco/deploy.

## Arquivos deste trabalho

Modificados:

- `advertencias.js`
- `comandos/admin/adv.js`, `advs.js`, `remadv.js`, `ban.js`, `menu-admin.js`
- `comandos/menu.js`, `comandos/menu-dono/menu-dono.js`
- `dados/moderacao-figurinhas.js`
- `scripts/helpers/colecao-figurinhas-fake.js`
- `scripts/teste-adv.js`, `teste-loader.js`, `teste-protecao-bot.js`, `teste-on-off.js`

Criados:

- `dados/identidade-participante.js`, `dados/advertencias-contexto.js`
- `comandos/admin/advertencias-consultas.js` (quatro comandos no loader existente)
- `scripts/teste-advertencias-evolucao.js`
- `docs/advertencias.md`
