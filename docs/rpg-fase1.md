# RPG — fase 1: economia, identidade e persistência

Escopo: simulação de vida real. Nenhuma classe, combate, mitologia ou recompensa nova.
Credenciais, saldos e documentos reais não foram alterados durante a implementação.

## Arquivos desta etapa

Criados:

- rpg/identidade.js
- rpg/comandos.js
- scripts/helpers/rpg-mongo-fake.js
- scripts/teste-rpg-seguranca.js
- scripts/teste-rpg-conexao.js
- docs/rpg-fase1.md

Modificados:

- rpg/conexao-mongo.js, rpg/database.js, rpg/economia.js, rpg/cooldown.js
- comandos/rpg/registrar.js, comandos/rpg/ficha.js, comandos/rpg/carteira.js
- comandos/rpg/depositar.js, comandos/rpg/sacar.js, comandos/rpg/transferir.js
- comandos/rpg/testrpg.js
- lid.js (somente opção de consulta silenciosa)
- scripts/teste-rpg-fase1.js, scripts/teste-rpg-fase2.js, scripts/teste-rpg-lid.js
- scripts/teste-on-off.js (cenário adicional com comandos RPG reais e mocks)
- scripts/migrar-rpg-lid.js, scripts/migrar-rpg-para-cluster-dedicado.js
- scripts/smoke-rpg-fase2-mongo.js

Sem novas dependências. bot.js, config.js, .env e permissões globais não foram
modificados. Alterações anteriores de anagrama/forca foram preservadas.

## Cadastro e documentos antigos

O cadastro atualiza somente nome e gênero. savePlayer e mergeAtualizacao
recusam campos financeiros, identidade interna e snapshots do jogador.
Campos desconhecidos já presentes continuam intactos.

Novos documentos usam PN completo, sem dispositivo. Um único legado identificado
por telefone, PN com dispositivo ou LID comprovado continua com sua chave original.
Nenhum documento é renomeado, mesclado ou excluído automaticamente.

rpg/identidade.js usa o namespace do helper compartilhado, pares exatos dos
metadados e o mapeamento da sessão. Dígitos iguais PN/LID não comprovam identidade.
Metadados e sessão contraditórios, múltiplos participantes ou múltiplas fichas
comprovadas bloqueiam a operação. A associação global de outros comandos não mudou.
O parâmetro opcional silencioso de lid.js evita logs de identificadores no RPG.

Se não há ficha correspondente e existem documentos LID legados, a criação é
bloqueada conservadoramente: um legado pode ser do solicitante. Contas existentes
e inequívocas podem continuar acessíveis. A revisão de legados precisa verificar
também associações que os metadados/sessão ainda não comprovam.

## Operações financeiras

Transferência, depósito e saque exigem transações. Não há fallback compensatório.
O limite é R$ 1.000.000.000 por saldo/operação. Valores e saldos devem ser positivos
(saldos podem ser zero), finitos e equivalentes a centavos dentro da tolerância de
representação IEEE-754. Não se convertem strings, Decimal128 ou frações reais de
centavo; documentos incompatíveis ficam bloqueados para decisão posterior.

Formatos aceitos: 100, 100,50, 100.50, 1.234,56, todos, tudo.
1.234 é ambíguo entre decimal e milhar e é recusado. Expoentes, hexadecimal,
mais de duas casas decimais e valores acima do limite são recusados.
O cálculo usa centavos inteiros e grava novamente reais/Number somente nos
campos envolvidos na operação. Não existe migração de unidades ou saldos.

A coleção MONGODB_COLLECTION_RPG seguida de _operacoes (padrão rpgPlayers_operacoes)
registra estado, tipo, atores comprovados, valor solicitado, datas, resultado
e saldos anteriores/posteriores. O ID tem índice único nativo e não há TTL.

O ID é SHA-256 de chat, autor canônico e ID da mensagem. Privado PN/LID do
mesmo remetente usa o chat canônico. Um fingerprint vincula também tipo,
destinatário e valor (inclusive a intenção todos). Mesmo ID com outro
pedido é recusado. Prefixo e alias não mudam o ID financeiro.

1. Reserva pendente, persistida com majority antes de qualquer movimentação.
2. Sessão no MESMO cliente/coleções, snapshot e majority.
3. Leitura/validação dos participantes e saldos, escritas verificadas.
4. Releitura dos saldos e auditoria concluída no mesmo commit financeiro.
5. Só depois são enviadas mensagens; falha de entrega não altera o resultado.

Uma reserva concluída apenas retorna o resultado original. Esse saldo é o saldo
após aquela operação, não uma promessa de saldo atual em replays; /carteira
consulta o estado corrente. O aviso privado não se repete em replay, mas não
há garantia de entrega exatamente uma vez do WhatsApp.

Falha conhecida antes de enviar commit pode ficar recusada. Commit ambíguo,
falha não classificada ou processo interrompido conserva pendente.
Só a leitura majority de um registro concluído confirma sucesso. Não há
repetição automática do callback financeiro, expiração ou desbloqueio por tempo.
Conflito comprovado pelo rótulo TransientTransactionError fica recusado.
UnknownTransactionCommitResult tem precedência e conserva pendente. Não se
reinicia automaticamente a operação nem se presume abort por número de erro.
Falhas concorrentes sem evidência conclusiva podem permanecer pendentes.

O driver MongoDB pode repetir internamente uma escrita retryable ou o MESMO
commit; isso não constitui novo callback ou nova transferência.
Sem suporte a transações, as movimentações são recusadas. Leitura de ficha e
cadastro podem continuar. Falha antes de criar reserva não comprova movimentação;
as mensagens não presumem sucesso.

## Conexão e comandos

A inicialização e o preparo dos índices são compartilhados. O pool MongoDB
recupera a rede sem trocar cliente durante sessões. Fechamento explícito espera
operações financeiras em uso. Leituras diagnósticas não criam índices/coleções.
O índice único de jogadores permanece idx_rpg_jid; a auditoria é preparada
antes da primeira operação, sem criar índices de migração.

Todos os sete comandos e dez aliases foram mantidos. Instruções usam o prefixo
sincronizado pelo roteador. bot.js, suas permissões, modo OFF e ordem de
processamento não foram alterados. /testrpg informa acesso à ficha sem
expor JID, banco interno, URI ou diagnóstico de infraestrutura.

O helper de cooldown continua em memória e não autoriza salvar snapshots.
Nenhuma ação RPG nova usa cooldown; a IA mantém seu contrato existente.

## Diagnóstico e migrações bloqueadas

corrigirJogadoresComLid e scripts/migrar-rpg-lid.js só contam documentos e
legados; não fundem saldos. O migrador de cluster recusa cópia; --dry-run
somente conta documentos nas duas origens, sem verificar equivalência.
O smoke de MongoDB real está desabilitado para impedir gravação de dinheiro
de teste ou exclusão de coleção. Nenhum desses scripts reais foi executado.

## Validação offline

Executar individualmente:

- node scripts/teste-rpg-seguranca.js
- node scripts/teste-rpg-conexao.js
- node scripts/teste-rpg-fase1.js
- node scripts/teste-rpg-fase2.js
- node scripts/teste-rpg-lid.js
- node scripts/teste-on-off.js
- node scripts/teste-prefixo.js
- node scripts/teste-loader.js

Os mocks de economia têm cópias profundas, snapshot/MVCC, conflitos de commit,
índice único e rollback; não arredondam os valores. Não são o servidor MongoDB.
Testes offline não comprovam segurança em produção, durabilidade do cluster,
failover real, permissões de criação de coleção ou entrega WhatsApp.

## Implantação e decisões pendentes

1. Obter backup verificável e suspender escritas RPG antes de qualquer
   reconciliação futura. Não restaurar automaticamente snapshots antigos.
2. Validar em MongoDB separado, sem contas reais, suporte transacional,
   majority, criação da auditoria, conflitos e falhas de rede/commit.
3. Revisar fichas duplicadas, LIDs não comprovados e saldos incompatíveis.
   Escolher regra auditável de reconciliação; máximo/soma automática não serve.
4. Revisar reservas pendentes com processo original parado, sem transação
   em voo, consultando auditoria e evidências majority. Não apagar reserva
   para reenviar a mensagem, não estornar nem repetir por suposição.
   Uma ferramenta controlada de recuperação ainda precisa ser projetada.
5. Preservar a coleção de operações junto com jogadores em backup/restore.
   Uma reversão de versão também precisa evitar reabrir mensagens antigas.
6. Decidir separadamente uma futura migração para centavos/Decimal128, com
   relatório de incompatibilidades e comparação por jogador antes/depois.
7. Fazer implantação somente após validação e autorização específicas.

Incompatibilidades intencionais: snapshots via savePlayer são recusados;
depósitos/saques também dependem de transações; entradas ambíguas/extremas
e saldos não numéricos ficam bloqueados; diagnósticos internos foram reduzidos;
scripts de migração/smoke não realizam mais escritas reais.
