# Namoro do Olimpo

Comandos com o prefixo configurado: `namorar @pessoa`, `aceitarnamoro`,
`recusarnamoro`, `namoro` e `terminar`. Pedido e decisão exigem o grupo
de origem e identidade comprovada. O prazo é de cinco minutos pelo relógio
MongoDB; a expiração é verificada nos comandos. Consulta e término também
funcionam no privado. Somente um dos parceiros pode terminar.

## Exclusividade e conversão

Namoro e casamento usam a coleção já existente `casamentosOlimpo` e o mesmo
índice único parcial de participantes. Não há coleção paralela nem migração
de dados. Casamentos antigos, sem `modalidade`, continuam sendo casamentos.
Novos registros têm `modalidade: namoro` ou `modalidade: casamento`.

O namoro ativo reserva os dois participantes. Somente esse casal pode pedir
conversão com `casar`; somente o destinatário decide com `aceitar`/`recusar`
no grupo do pedido de casamento. O pedido fica embutido no namoro e o histórico
fica em `pedidosCasamento`, com chaves derivadas dos IDs idempotentes.
Recusa e expiração fecham apenas esse pedido, preservando o namoro e a reserva.

O aceite altera o mesmo documento atomicamente, sem liberar participantes:
`modalidade` passa a `casamento`, `casadoEm` recebe o relógio do banco e
`namoroAnterior` guarda `estado: convertido`, `iniciadoEm` e `convertidoEm`.
O `criadoEm` original e `namoradoEm` são preservados. Não existe uma janela
entre encerrar namoro e criar casamento, nem dependência de transação entre
documentos. A consulta de casamento exibe o período anterior de namoro.

O término guarda `estado: terminado`, data e autor, libera a reserva e cancela
eventual pedido de conversão pendente. Histórico e recibos nunca são apagados.
O cancelamento exige que o pedido ainda esteja `pendente` na escrita atômica.
Se uma recusa/expiração vencer essa corrida, o término retorna estado alterado;
uma nova execução pode encerrar o namoro sem substituir o desfecho do pedido.
Os recibos dos pedidos são localizados por `_id` e fixam o namoro original
antes de criar o pedido embutido; não há varredura da coleção para encontrar
pedidos antigos. Os recibos das decisões fixam documento e pedido de conversão:
repetir uma mensagem antiga não decide pedidos posteriores no mesmo namoro.
Resultado incerto não gera sucesso nem repetição automática de mensagem.
Conflitos com outro pedido pendente são decididos atomicamente no próprio
namoro e ficam no histórico como `rejeitado_conflito`. A mesma mensagem não
ganha um novo prazo depois de encerrar o pedido concorrente. A consulta de
conversão inclui o participante comprovado para usar o índice já existente.

## Data histórica exclusiva do dono

`ajustardatacasamento DD/MM/AAAA` exige o dono comprovado pelo helper existente
e limita a operação ao casamento ativo do próprio remetente. Não aceita alvo.
Datas devem existir no calendário, ser de 1900 em diante e não ser futuras
no calendário de São Paulo. Não altera namoros nem ajusta datas automaticamente.

A data fica em `inicioRelacionamentoEm`, com recibo e auditoria em
`ajustesInicio` (data, autor e instante do banco). `casadoEm`, `criadoEm` e
`namoroAnterior` não são substituídos. A duração de casamento continua usando
`casadoEm`; a data histórica aparece separadamente. Repetir o mesmo ajuste
não desfaz um ajuste posterior nem atinge outro casamento.
Datas futuras ficam auditadas com `resultado: rejeitado_data_futura`, sem
substituir a data atual. A rejeição continua valendo ao repetir a mensagem em
outro dia; uma tentativa nova exige outra mensagem. Ajustes aplicados usam
`resultado: aplicado`; auditorias antigas sem esse campo mantêm a semântica
original de sucesso.

Erros de transporte ou respostas sem confirmação continuam incertos e não
são traduzidos em rejeições definitivas. Se a escrita ocorreu mas a resposta
se perdeu, uma repetição reconcilia o resultado persistido. Não há migração
retroativa: recibos incompletos de versões anteriores não permitem inferir
se uma tentativa foi rejeitada ou interrompida antes de escrever.

## Operação e validação

Enviar juntos os dois módulos `dados/casamento-olimpo*.js`, o helper existente
`dados/casamento-identidade.js` e os comandos de namoro/casamento/ajuste.
O loader existente registra os comandos; permissões de OFF, prefixo e somente
administradores continuam aplicadas pelo roteador. Todas as instâncias que
manipulam relacionamentos precisam usar essa versão; não misturar executores
antigos que desconhecem `modalidade` com a versão nova.

Não há alterações de `.env`, sessão WhatsApp, credenciais ou índices existentes.
O provider continua exigindo a preparação dos índices já definidos. A coleção
deve permanecer sem sharding. O histórico cresce no mesmo documento e está
sujeito ao limite de tamanho BSON; falha de tamanho deve bloquear a operação,
sem remover histórico automaticamente.

Testes offline, sem MongoDB/WhatsApp reais:

```text
node scripts/teste-namoro-olimpo.js
node scripts/teste-casamento-olimpo.js
node scripts/teste-loader.js
node scripts/teste-on-off.js
```

As coleções simuladas verificam filtros, concorrência intercalada, respostas
perdidas e idempotência. Não certificam failover, múltiplos processos MongoDB,
permissões/índices de produção ou entrega no WhatsApp. Não executar o teste
MongoDB real sem autorização específica e ambiente isolado.
