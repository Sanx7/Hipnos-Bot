# Migração manual do ranking PN/LID

O script `scripts/migrar-ranking-lid.js` continua sendo manual e usa as mesmas
variáveis de conexão e a mesma prova dupla de identidade PN/LID. Importar o módulo
não executa a migração. Não há alterações nos comandos ou nos escritores do bot.

## Caminho padrão: transações

Sem `--aplicar`, o script apenas consulta e simula. Com `--aplicar`, grava e reabre
um backup local antes de escrever no banco. Cada origem é processada numa transação
com snapshot e confirmação majority: relê a contagem atual, credita o destino,
remove a origem e registra um recibo. Ou todas essas escritas são confirmadas,
ou nenhuma se torna efetiva. Conflitos transitórios são tratados pelo driver.

O recibo persistente permite repetir uma execução cujo commit ocorreu, mas cuja
resposta se perdeu. Um commit incerto interrompe o script e nunca aciona o fallback.
Uma nova execução consulta o recibo antes de creditar novamente.

MongoDB precisa oferecer transações (replica set, incluindo Atlas, ou cluster
compatível). A conta precisa ler a autenticação/mapeamento existente e ler/escrever
o ranking e a coleção de auditoria `<coleção-ranking>_migracoes_lid` (por padrão,
`ranking_migracoes_lid`). O script cria essa coleção após o backup, quando necessário;
a conta deve ter permissão para isso. Nenhuma alteração de `.env`, dependência nova
ou configuração específica da LatamHost é necessária.

## MongoDB sem transações

Por padrão, o script recusa alterar o ranking quando transações não são suportadas.
Existe um modo explícito `--aplicar --offline-confirmado`, exclusivamente para
manutenção com **todas as instâncias do bot e todos os demais escritores do ranking
parados**. A opção declara essa condição; o script não consegue comprová-la sozinho.

Nesse modo, primeiro registra um diário durável com os documentos completos.
O crédito e um marcador `_migracoesRankingLid.<identificador-da-operação>` são gravados
atomicamente no destino. Só depois de confirmar o marcador por leitura do primário
o script remove a origem, condicionando a exclusão ao snapshot registrado.
Uma repetição reconhece o marcador e não volta a somar. O diário permite concluir
a operação mesmo após a origem ter sido removida ou renomeada.

Se houver interrupção, **mantenha os escritores parados e repita a migração nesse
mesmo modo até concluir as pendências**. Entre crédito e exclusão podem existir
temporariamente os dois registros, com contagem duplicada na leitura normal do bot.
Esse intervalo não é uma transação e exige a manutenção. Alterações inesperadas nos
documentos ou nos marcadores bloqueiam a retomada para análise; não tente limpar
marcadores ou diários para forçar uma execução.

## Preservação e recuperação

- O destino mantém seu identificador e seus campos; a contagem é somada e o nome
  e a data seguem a regra anterior de mensagem mais recente.
- Campos exclusivos da origem são copiados quando podem ser escritos sem conflito.
  Ambos os documentos completos anteriores ficam no diário, incluindo metadados
  conflitantes, para que nenhuma informação seja descartada.
- Valores inválidos ou somas acima do limite inteiro seguro são recusados sem
  remover a origem; não há conversão silenciosa das contagens.
- O formato dos backups JSON existentes permanece compatível. Novos nomes incluem
  UUID e são escritos com criação exclusiva, sem sobrescrever ou apagar backups.
- Preserve o diário e os marcadores junto do ranking nos próximos backups.
  Não restaure parcialmente apenas uma dessas partes após executar a migração.
- O índice único já esperado em `(grupo_id, usuario_id)` deve permanecer disponível.
  O script não modifica índices nem a estrutura dos registros antigos.

## Verificação local

`node scripts/teste-migrar-ranking-lid.js` e
`node scripts/teste-migrar-ranking-seguranca.js` usam somente coleções fictícias,
com bloqueio de rede/conexão MongoDB. Cobrem rollback, conflitos, execuções
simultâneas, falhas antes/depois das escritas, commit incerto e retomada após reinício.
Backups usados nos testes contêm exclusivamente dados sintéticos em pasta temporária.
Esses testes não validam uma conexão real, a topologia do banco ou a hospedagem.

Para utilizar a correção no servidor, mantenha juntos o script manual e
`scripts/helpers/ranking-migracao-segura.js`. Não há necessidade de reiniciar o bot
para instalar esses arquivos; o modo de manutenção exige pará-lo antes da execução.
