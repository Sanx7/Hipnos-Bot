# Casamento do Olimpo

Comandos: `casar @pessoa`, `aceitar`, `recusar`, `casamento` e `divorciar`,
com o prefixo configurado no bot. O loader os registra sem mudanças no roteador.
As regras existentes de OFF e somente administradores continuam valendo.

## Regras

- Pedido, aceite e recusa acontecem no grupo de origem. Pedido exige uma
  menção e presença comprovada de ambos. O aceite revalida essa presença.
- Somente o destinatário decide. Um usuário só pode participar de um pedido
  pendente ou casamento ativo em todos os grupos, em qualquer posição.
- O prazo é de 300.000 ms, medido pelo MongoDB. No instante exato do limite
  o pedido está vencido. A expiração é verificada nos comandos, sem timers.
- Consulta e divórcio são globais, inclusive no privado. Qualquer cônjuge
  pode encerrar a união, sem aprovação do outro.
- Identidades são telefones comprovados pelo helper do projeto e mapeamento
  PN/LID da sessão. Identidades ambíguas ou desconhecidas bloqueiam o rito.
  O mapeamento é consultado silenciosamente, sem logs de identidades.

## Persistência

Usa `MONGODB_URI`, `MONGODB_DB` (padrão `whatsapp`) e uma nova coleção
`casamentosOlimpo`, sem conexão com o banco RPG ou sistema VIP. A conexão é
preguiçosa, reutilizada e serializada. Importar um comando não conecta ao banco.

Documentos `tipo: 'uniao'` contêm `participantes` (dois telefones distintos),
`solicitante`, `destinatario`, `grupoOrigem`, `estado`, `bloqueiaParticipantes`,
`criadoEm`, `expiraEm`, `casadoEm`, `encerradoEm`, `encerradoPor`,
`ultimaOperacao` e, após aceite, `mencoesAceite`. Datas são BSON Date em UTC.
Novos pedidos também guardam `jidsParticipantes`, na ordem de `participantes`,
como pistas para a resolução no aceite. Essas pistas são revalidadas contra
o telefone comprovado e a presença atual; não concedem autorização. Pedidos
anteriores sem esse campo continuam funcionando pelo fallback PN/LID.
Estados: `pendente`, `ativo`, `recusado`, `expirado`, `divorciado`.

O índice único multikey `{ participantes: 1 }`, parcial para
`bloqueiaParticipantes: true`, reserva os dois membros globalmente. Sua
criação deve ser confirmada antes de qualquer operação. Grupo não faz parte
da chave. A coleção deve permanecer sem sharding para manter essa garantia.
Há também índice de consulta `{ destinatario: 1, grupoOrigem: 1, estado: 1 }`.

O pedido é inserido por upsert com pipeline, sem renovar datas em repetições.
Seu `_id` é um hash da ação, chat, autor canônico e ID da mensagem.
O mesmo documento vira casamento, mantendo a reserva. Recusa, expiração e
divórcio alteram estado e liberam ambos em uma atualização atômica.
Filtros de estado, autor, grupo e prazo protegem decisões concorrentes.
Não há transações entre documentos nem travas em memória.

Documentos `tipo: 'operacao'` guardam recibos persistentes com `_id` derivado
da mensagem e `pedidoId`. Eles vinculam aceites, recusas e divórcios ao
documento original, inclusive quando não existia pedido/união (`pedidoId: null`).
Reprocessar uma mensagem não pode decidir um pedido ou união posterior.
Os recibos e históricos não possuem TTL e não devem ser apagados automaticamente:
isso reabriria a possibilidade de reprocessar mensagens antigas.

As gravações usam confirmação majority; leitura usa primary e majority.
Falhas ou resultado incerto não anunciam sucesso. A mesma mensagem pode
ser reconciliada pela chave persistida. WhatsApp e MongoDB não compartilham
uma transação: falha no envio da resposta não desfaz o casamento e não há
garantia de entrega exatamente uma vez. `casamento` consulta o estado salvo.
Falhas de envio são capturadas pelo próprio comando e geram apenas o evento
seguro `confirmacao_nao_entregue`, sem exceção ao roteador, segunda resposta
genérica ou retry automático. Falhas de persistência continuam gerando aviso
de indisponibilidade ou resultado não confirmado, quando o transporte permite.

## Limites e resolução de identidade

`casamento-identidade.js` cria índices locais dos metadados uma vez por comando,
resolve primeiro o autor e o alvo e compartilha promessas/resultados nessa
execução. Metadados com PN comprovado não exigem consultar LIDs de terceiros.
Se só há LIDs e o chamador só conhece o PN, o fallback percorre os membros
desconhecidos uma única vez, detectando associações ambíguas. Falhas também são
reutilizadas dentro do comando, sem cache negativo entre comandos. Há no máximo
duas consultas à sessão em paralelo por processo, inclusive entre comandos.
O helper e o armazenamento de sessão dos outros sistemas não foram alterados.

Menções são extraídas após `normalizeMessageContent` do Baileys, assim como
o texto do roteador: texto, mensagens temporárias e legendas de imagem, vídeo
ou documento. Continua sendo exigida exatamente uma menção.

O cliente próprio de casamento é reutilizado pelo singleton do módulo, com
pool máximo 4, mínimo 0, uma conexão sendo aberta por vez e ociosidade de 60 s.
Há limites explícitos: seleção/conexão 10 s, fila 5 s, socket 20 s e orçamento
de operação (`timeoutMS`) 30 s. O driver aplica seu mecanismo de timeout global
às operações; esses prazos não devem ser somados como duração garantida do
comando inteiro. Não existe um cliente global compartilhado na arquitetura
atual, e nenhum pool/configuração dos outros sistemas foi alterado.

Na avaliação sintética offline de um `/casar` com 102 membros (autor e alvo PN
comprovados e outros 100 LIDs sem mapeamento), as consultas à sessão caíram de
200 para 0, mantendo uma leitura de metadados. Com autor e alvo LID, somente os
dois necessários são consultados. Isso não mede tráfego ou RAM na LatamHost;
no fallback de um PN conhecido apenas por LID ainda pode ser preciso percorrer
os membros, agora com resultados reutilizados e concorrência limitada.

Requer MongoDB com suporte a pipelines de atualização, `$$NOW` e `$replaceWith`
(MongoDB 4.2 ou superior), além de permissão para criar os índices novos.
Nenhum índice existente é alterado. O servidor real não foi consultado nesta etapa.

## Contador

`casadoEm` recebe `$$NOW` na transição atômica para ativo. Consulta obtém
`consultadoEm` pelo mesmo relógio do banco e calcula:

```js
Math.floor((consultadoEm - casadoEm) / 86400000)
```

Cada dia significa 24 horas completas, sem incremento diário ou dependência
do tempo de execução do processo. Exibição da data usa `pt-BR`,
`America/Sao_Paulo` e `DD/MM/AAAA`. No divórcio, a união deixa de ser consultada
como ativa; a duração histórica termina em `encerradoEm`.

## Verificação offline

```text
node scripts/teste-casamento-olimpo.js
node scripts/teste-loader.js
node scripts/teste-on-off.js
node scripts/teste-mongo-conexoes.js
```

A suíte própria bloqueia sockets, usa coleção em memória e testa também o
código real de inicialização Mongo em VM com cliente fake. Inclui concorrência,
autorização, PN/LID, prazos, reprocessamento, falhas, histórico e contador após
reinicialização. Os mocks não certificam comportamento do servidor MongoDB,
failover ou menções no WhatsApp real. Esses cenários precisam de validação
posterior em ambiente isolado. Não houve instalação, reinício ou deploy.
