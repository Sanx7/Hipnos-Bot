# Comando nuke

O dono do bot deve ser membro e administrador do grupo, assim como o bot.
O comando segue o prefixo configurado e continua disponível ao dono no modo OFF.
O nuke inicia **desativado em todos os grupos**. Ausência de configuração,
valor diferente do booleano `true` ou falha no MongoDB bloqueia seu uso.

Somente o dono pode enviar `/nuke habilitar` para habilitar **aquele grupo** ou
`/nuke desabilitar` para fechar a trava. Configurar não faz rebaixamentos,
remoções, simulação ou confirmação automática; o dono não precisa ser admin
para configurar, mas continua precisando desse cargo para simular e executar.
A habilitação e a desabilitação persistem entre reinícios. Desabilitar invalida
códigos anteriores e impede novas chamadas; uma operação já admitida pode
concluir. Reabilitar não restaura confirmações canceladas nem libera reservas
incertas. `/nuke cancelar` continua disponível mesmo com a trava fechada.

1. Envie `/nuke` no grupo para a simulação obrigatória, sem alterações no WhatsApp.
2. Confira nome, membros, administradores e participantes afetados.
3. Envie `/nuke confirmar <codigo>` em até 60 segundos para autorizar a operação.
4. Use `/nuke cancelar` para cancelar a prévia ou interromper a execução.

Os exemplos usam `/`; substitua pelo prefixo atual. O código aleatório é de uso
único, vinculado ao grupo e ao responsável. Somente seu hash é persistido.
Alterações de nome, lista, identidade ou privilégios entre prévia e confirmação
exigem uma nova simulação. A lista também é conferida após o consumo do código,
antes da primeira alteração. O prazo é revalidado após a espera pelo MongoDB.
Identidades ausentes, contraditórias ou ambíguas bloqueiam a operação inteira.
Todos os números configurados como donos são preservados.

Administradores elegíveis são rebaixados primeiro. Os participantes elegíveis são
removidos em seguida. Bot, donos e criador identificado por `owner`/`superadmin`
são preservados. Não há tentativas de contornar proteção do criador, blacklist,
advertências, saída do bot ou exclusão de dados de outros comandos.
Sem `owner` resolvido nem `superadmin` identificado, o comando bloqueia a operação.
O criador identificado no plano original permanece protegido mesmo se esses
campos mudarem durante a execução. Não é possível provar um criador histórico
que já não esteja identificado nos metadados fornecidos pelo WhatsApp.

Cada chamada altera um participante e tem intervalo de 1,5 segundo. Permissões,
lista de participantes, conexão, sessão exclusiva e reserva persistente são
revalidadas antes de cada alteração. O status `200` só é contado quando o JID de
retorno corresponde à identidade comprovada do alvo. Uma recusa 4xx/5xx atribuída
ao alvo conta como falha confirmada; timeout 408, exceção de transporte, resultado
vazio, JID inválido ou ambíguo conta como desconhecido. Desconhecidos interrompem
o fluxo e mantêm a reserva bloqueada. Não há repetição automática de alterações.

O relatório discrimina rebaixamentos, remoções confirmadas, falhas confirmadas e
resultados desconhecidos, também separados no MongoDB. Uma operação
já admitida pode concluir após cancelamento ou queda da conexão;
cancelar não desfaz alterações. Novos membros que entrarem durante a execução
não são incluídos automaticamente na autorização anterior. Membros que já
saíram não contam como remoções do comando. O criador protegido permanece.

Cancelamento e admissão de cada chamada usam updates condicionais atômicos no
mesmo documento. Se o cancelamento vencer, a chamada não é admitida. Se a
admissão vencer, essa operação já conta como em voo, ainda que seu envio ao
WhatsApp aguarde a resposta do MongoDB. No mesmo processo, a flag de cancelamento
também é checada após a admissão, imediatamente antes da chamada ao socket.
Não há atomicidade entre um update MongoDB e o envio pela rede. O cancelamento
pode ser solicitado pelo responsável mesmo após ele perder o cargo de admin,
para interromper a execução; simular e confirmar continuam exigindo admin.

## Persistência e interrupções

A collection `nukeOperacoes` utiliza o `_id` do grupo como reserva atômica.
O mesmo documento guarda `habilitado` e `travaAtualizadaEm`. A configuração
e a admissão de chamadas usam esse documento para arbitrar a desabilitação
concorrente. Reservar não usa upsert e nunca cria uma habilitação implicitamente.
Operações antigas sem `habilitado: true` também ficam bloqueadas até uma
habilitação explícita pelo dono, sem migração ou habilitação automática.
Documentos `execucao:<UUID>` registram grupo, datas, responsável, estado e
contadores, sem listas de participantes, nomes de pessoas ou mensagens.
Leituras usam o primário com `readConcern: majority`; escritas exigem `w: majority`.
Somente o documento de reserva contém hash do código e assinatura da simulação.
Estados: `inativa` (configuração sem operação), `pendente`, `executando`, `concluida`, `cancelada`, `expirada` e
`interrompida`. `concluida` significa que o fluxo terminou; consulte os contadores
de falhas e desconhecidos para saber quais alterações foram confirmadas.

Uma prévia expirada deixa de autorizar e pode ser substituída. Uma reserva em
execução não expira nem é retomada automaticamente. Após crash, escrita MongoDB
incerta ou perda de reserva, ela pode exigir revisão manual. Antes de liberar
uma reserva abandonada, certifique-se de que o processo anterior está encerrado
e nenhuma chamada continua em voo; conferir o grupo sozinho não comprova que
uma requisição desconhecida terminou. Uma reserva com `emVoo: true` não pode ser
substituída automaticamente, mesmo se seu estado for terminal. Preserve-a até
a reconciliação comprovar a ausência de operações em voo. Para uma reserva
comprovadamente abandonada e sem chamada em voo, use um update condicional por
`_id`, `operacao` exata, `estado: executando` e `emVoo: false`, marcando-a como
`interrompida` e anulando o código; confira `matchedCount === 1` e registre a
reconciliação na auditoria correspondente. Dados anteriores à revisão sem campo
`emVoo` exigem revisão, sem assumir que o valor ausente significa ausência de
chamadas. Nunca libere pela idade do registro, nem altere uma operação nova com
um identificador antigo. Uma nova execução ainda exige simulação e confirmação.
Não apague credenciais ou outras
collections. Não há comando de liberação automática.

Não existe atomicidade entre WhatsApp e MongoDB: se o processo morrer ou a
persistência falhar após uma resposta do WhatsApp, os contadores persistidos
podem estar incompletos. O comando interrompe novas alterações e não repete
chamadas incertas. Se o grupo estiver inacessível ou a conexão cair, o envio do
relatório também pode falhar; o registro persistente fica disponível quando a
escrita é possível. Limites do WhatsApp variam e o intervalo não garante ausência
de recusas. Não há garantia de esvaziar o grupo nem de excluir o grupo do WhatsApp.

## Validação offline

`node scripts/teste-nuke.js` exercita o comando real com socket e MongoDB em
memória, sem ações externas. `node scripts/teste-on-off.js` inclui simulação e
cancelamento pelo handler de produção com prefixo dinâmico e modo OFF. Validar
também loader, proteção do bot e persistência da sessão após alterações.

Os mocks não validam regras reais de criador, respostas do servidor, limites de
tráfego, conectividade do WhatsApp ou concorrência em um cluster MongoDB real.
Não houve deploy nem operação real durante a implementação.
