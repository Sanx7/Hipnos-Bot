# Arcontes do Olimpo

Arconte é uma patente local ao grupo. Não transforma seu titular em administrador
do WhatsApp nem altera os verificadores gerais de permissão do Hipnos.

## Comandos

- `/arconte @pessoa`: nomeia um membro comum presente, por menção ou resposta.
- `/removerarconte @pessoa`: revoga a patente sem apagar seu registro ou histórico.
  Também aceita resposta/menção com identidade comprovada de quem já saiu.
- `/listaarcontes`: lista até 100 patentes ativas do grupo.
- `/historicoarconte [página]`: dez expulsões confirmadas por página, enviadas
  **no privado do solicitante**; o grupo recebe somente uma confirmação de envio.
  No privado, informe o grupo: `/historicoarconte grupo ID_DO_GRUPO [página]`.
  Cada resposta identifica o grupo e fornece o comando da próxima página.
- `/kick @pessoa [motivo]`: remove um membro comum. Por resposta, use
  `/kick [motivo]`. Motivo opcional, limitado a 500 caracteres.

Os quatro comandos de gestão/consulta são exclusivos de administradores reais,
proprietário do grupo e donos configurados do Hipnos, com identidade comprovada.
Arcontes sem essas permissões só recebem autorização adicional para `/kick`.
Não há aliases novos. A exceção de `/soadm` exige o nome `kick` e o objeto do
comando canônico; aliases não recebem a exceção. OFF continua bloqueando Arcontes.

Arcontes não removem administradores, proprietário, donos do bot, outros Arcontes,
a si mesmos ou o bot. Autor e alvo precisam estar presentes e identificados.
O bot precisa ser administrador, e socket/lease devem estar disponíveis.
Administradores mantêm a possibilidade de remover um Arconte comum; o dono sem
administração do grupo não ganha autorização para `/kick`, mesmo com patente.

## Persistência isolada

Usa o MongoDB já configurado, sem novas variáveis ou dependências. Conexão sob
demanda, reutilizada, com pool limitado, leituras primárias e confirmação majority.
Somente três coleções novas são utilizadas:

- `arcontesOlimpo`: patente por grupo/telefone, índice único `{ grupo, numero }`.
  Revogação grava `ativo: false`, preservando o documento.
- `historicoExpulsoesArcontes`: recibos idempotentes das alterações e de todos os
  `/kick`, incluindo administrador/dono/Arconte, grupo, alvo, motivo e datas.
  `_id` é hash do grupo, telefone comprovado do autor e ID da mensagem.
  O histórico consulta somente `tipo: kick, estado: confirmada`; há índice por
  grupo/tipo/estado/data/ID. Registros confirmados são terminais.
- `arcontesControles`: reserva atômica por grupo/token, usada tanto por expulsões
  quanto por nomeações/revogações, vinculada ao ID da operação e à instância do
  processo. Operações concorrentes recusadas exigem uma nova mensagem; o replay
  da mesma mensagem não reaplica alterações. Durante uma revisão, o token antigo
  deixa de autorizar despachos e liberações ordinárias.

Não há TTL, exclusão automática, alteração de blacklist, migração nem acesso às
coleções existentes de casamento, advertências ou autenticação. Índices novos
só são preparados nessas coleções quando o repositório é utilizado em produção.

## Falhas e concorrência

A reserva persistente antecede qualquer remoção. Identidades, permissões,
patentes, participação, bot administrador e lease são revalidados no despacho,
inclusive depois da admissão no MongoDB. Só `status: 200` com um JID comprovado
do alvo confirma expulsão. O anúncio depende da confirmação persistida.

MongoDB indisponível bloqueia novas remoções, inclusive de administradores.
Timeouts, respostas vazias, JID inesperado e falhas de persistência conservam a
reserva quando o resultado pode ser incerto. Reiniciar o bot não libera essa
reserva. Não há repetição automática nem expiração de operação em voo.
Enquanto uma expulsão é admitida, nomeação/revogação no mesmo grupo é recusada.
Uma revogação só vale após ser confirmada e não desfaz uma chamada já admitida.

WhatsApp e MongoDB não oferecem uma transação conjunta: queda após a remoção e
antes de persistir o status pode deixar recibo `enviando`/`incerta`. O histórico
não inventa confirmação pela ausência do membro. Essas situações exigem revisão
manual autorizada de um administrador real ou dono; não há desbloqueio automático.
Não repetir o comando para tentar resolver uma operação incerta.

## Procedimento de revisão explícita

Somente administradores reais do grupo e donos identificados do Hipnos podem
consultar ou liberar a reserva. A patente de Arconte não concede esses direitos.
Os comandos podem partir do grupo (a resposta detalhada vai no privado) ou do
privado, sempre com `grupo ID_DO_GRUPO`. O bot verifica as permissões atuais no
grupo selecionado a cada consulta/página e novamente antes de liberar a reserva.
No privado, o dono comprovado do Hipnos pode consultar/revisar mesmo sem ser
membro do grupo; administradores precisam continuar presentes e autorizados.
Essa exceção pertence somente ao histórico/revisão e não concede `/kick` ao dono.

1. No grupo, execute `/historicoarconte pendentes`. A resposta privada mostra a
   operação que mantém a trava, o estado original e os comandos para continuar.
2. No privado, consulte `/historicoarconte grupo ID_DO_GRUPO operacao ID_OPERACAO`.
   Confira responsável, alvo, motivo, resultado registrado e revisões anteriores.
   Presença ou ausência do membro não é evidência de expulsão pelo bot.
3. Depois de revisar explicitamente e decidir encerrar o bloqueio, envie uma
   **nova mensagem**: `/historicoarconte grupo ID_DO_GRUPO resolver ID_OPERACAO CONFIRMO motivo`.
   `CONFIRMO` é literal; o motivo precisa ter de 10 a 500 caracteres. O operador
   autoriza somente a liberação administrativa, aceitando a incerteza original.
4. Consulte novamente `pendentes` para verificar a situação atual do grupo e
   `operacao ID_OPERACAO` para ver a auditoria. `revisoes [página]` permite recuperar
   os IDs e motivos de revisões antigas, mesmo após revogar uma patente.

A revisão grava recibo próprio permanente com revisor, função, grupo, operação,
estado original, motivo e datas. A autorização é persistida **antes** de liberar
o grupo. Uma comparação atômica fixa a liberação ao token/ID/revisão exatos; uma
mensagem repetida não libera uma operação posterior. O registro de expulsão não
é editado pela revisão: `incerta` continua incerta e `confirmada` continua
confirmada. O procedimento não chama o WhatsApp para remover ninguém.

Chamadas ainda em execução neste processo são recusadas, inclusive quando a
revisão parte de outro serviço local. Espere o término da chamada. Após reinício,
a revisão exige socket com lease exclusiva válida e bloqueia a reserva antiga
antes da liberação. Ela não cancela uma requisição já recebida pelo WhatsApp nem
produz evidência nova sobre seu resultado.

Falhas de transporte podem deixar uma revisão `reservada` ou `autorizada`. O
estado `autorizada` confirma o registro da autorização, **não** a liberação: uma
resposta MongoDB perdida pode ocorrer antes ou depois da escrita. Consulte a
trava atual e a auditoria. Se ela ainda estiver bloqueada, uma nova mensagem
explícita de revisão pode concluir a liberação, preservando e vinculando a revisão
anterior. Nada é reaplicado automaticamente; o replay da mesma mensagem é recusado.
Se a trava já pertencer a outra operação, a revisão antiga não pode liberá-la.

Controles antigos sem vínculo comprovado ao ID da expulsão e travas de alterações
de patente não recebem liberação genérica. Exigem análise específica autorizada,
sem inferir IDs por proximidade de datas e sem apagar documentos. Não há TTL ou
exclusão de expulsões, recibos ou revisões.

Alterações externas no WhatsApp ainda podem ocorrer entre a última consulta e a
chamada: as travas serializam este sistema, não outros administradores humanos
ou outros sistemas de moderação. Os registros cobrem `/kick`, não `/ban`, nuke
ou expulsões automáticas. Não existe preenchimento retroativo de históricos.

## Validação offline

`node scripts/teste-arcontes-olimpo.js` usa coleções em memória, socket falso e
bloqueio de rede. Exercita permissões, PN/LID, concorrência, replay, falhas,
paginação privada e liberação auditada, além do trecho real de `/soadm`.
`scripts/teste-on-off.js` cobre o listener completo e
`scripts/teste-protecao-bot.js` mantém a regressão da conta protegida com novo
repositório falso por cenário. Não validam MongoDB real nem remoções reais.
