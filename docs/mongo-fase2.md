# MongoDB — fase 2 conservadora

Data: 14/10/2026. Base da comparação offline: commit `6e0e14e`.
Status: implementação e validação concluídas; commit e push autorizados pelo
usuário após revisão final. Nenhum deploy manual será executado.

## Escopo e diagnóstico

A varredura de JavaScript de produção encontrou 26 pontos de construção de
MongoClient. Esses pontos continuam existindo: não foi criado pool global nem
removido cliente de nenhum sistema. Todos são executados sob demanda, dentro
de funções; importar um módulo não significa que seu cliente esteja conectado.
Não foi consultada a produção. Portanto, não há evidência de quantos desses
clientes estejam simultaneamente ativos no Render, nem de seu tráfego atual.

Cliente não equivale a socket: o driver mantém pools e conexões de monitoramento
por servidor da topologia. Referência: [pools do driver MongoDB](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/connection-pools/).

### Treze módulos alterados

Nos módulos abaixo, a URI continua sendo `MONGODB_URI`, o database continua
sendo `MONGODB_DB || 'whatsapp'`, e os nomes de coleção e suas substituições
por variáveis de ambiente permanecem iguais. Nenhuma URI real de produção foi
inspecionada ou utilizada. A comparação é dos contratos de configuração no
código, não uma comprovação de que diferentes variáveis tenham destinos iguais.

| Arquivo | Getter | Coleção padrão | Alteração |
| --- | --- | --- | --- |
| `database.js` | `obterColecaoRanking` | `ranking` | Promessa por módulo, sem ping de reuso; diagnóstico `conectar()` preservado |
| `afk.js` | `obterColecaoAfk` | `afks` | Promessa por módulo e retirada do ping de reuso |
| `avaliacoes.js` | `obterColecaoAvaliacoes` | `avaliacoes` | Promessa por módulo e retirada do ping de reuso |
| `sugestoes.js` | `obterColecaoSugestoes` | `sugestoes` | Promessa por módulo e retirada do ping de reuso |
| `vip.js` | `obterColecaoVips` | `vips` | Promessa por módulo e retirada do ping de reuso |
| `modoadulto.js` | `obterColecaoModoAdulto` | `modoAdulto` | Promessa por módulo e retirada do ping de reuso |
| `lembretes.js` | `obterColecaoLembretes` | `lembretes` | Promessa por módulo e retirada do ping de reuso; agendador intacto |
| `prefixo.js` | `obterColecao` | `prefixoComando` | Promessa por módulo, retirada do ping de reuso e fechamento após falha de inicialização |
| `packs-figurinha.js` | `obterColecaoPacks` | `packsFigurinha` | Promessa por módulo e retirada do ping de reuso |
| `configuracoes-grupo.js` | `obterColecaoConfiguracoes` | `configuracoesGrupo` | Promessa por módulo e retirada do ping de reuso |
| `advertencias.js` | `obterColecaoAdvertencias` / `conectarAdvertencias` | `advertencias` e auxiliares existentes | Retirada do ping de reuso; promessa já existia |
| `dados/historico-apagadas.js` | `obterColecaoApagadas` | `apagadas_dia` | Promessa por módulo, retirada do ping de reuso e fechamento após falha inicial |
| `comandos/menu-brincadeiras/aleatorios.js` | `obterColecaoBrincadeiras` | `brincadeiraDiaria` | Promessa por módulo, retirada do ping de reuso e fechamento após falha inicial |

Todos mantêm `serverSelectionTimeoutMS: 15000`, exceto histórico de apagadas,
que mantém 8000. Nenhuma outra opção de conexão foi introduzida ou alterada
nesses módulos. Pings iniciais dos doze módulos que já os tinham foram mantidos;
histórico de apagadas não tinha ping inicial e continua sem esse ping.

As corridas anteriores ocorriam porque `colecaoCacheada` só era preenchida após
`connect`, ping e/ou índices, sem uma promessa protegendo esses awaits. A corrida
foi reproduzida com os arquivos de HEAD: cada um dos doze módulos sem promessa
podia criar vinte clientes para vinte chamadas concorrentes. Advertências já
criava somente um. Também havia caminhos de falha sem fechamento do cliente em
prefixo, histórico e brincadeiras diárias; agora o fechamento precede a liberação
do estado para uma nova tentativa.

### Nove clientes já protegidos, sem alteração

Todos usam `MONGODB_URI` e `MONGODB_DB || 'whatsapp'`. Mantêm promessa de
inicialização, fechamento em falha inicial e liberação da promessa rejeitada.
Não há ping explícito de reuso nesses providers.

| Arquivo / função | Seleção do servidor | Outras opções explícitas / responsabilidade |
| --- | --- | --- |
| `estado-bot.js` / `obterColecao` | 15000 ms | Estado global ON/OFF |
| `dados/nuke-mongo.js` / `obterColecao` | 10000 ms | `nukeOperacoes`, preocupações de leitura/escrita majority e leitura primary preservadas |
| `dados/figurinhas-regras.js` / `colecoes` | 5000 ms | Regras e ocorrências de figurinhas |
| `dados/antilinkhard-config.js` / `colecoes` | 5000 ms | Configuração, eventos e travas |
| `dados/antiflood-config.js` / `colecoes` | 5000 ms | Configuração, eventos e cooldowns |
| `dados/antigolpe-config.js` / `colecoes` | 5000 ms | Configuração, eventos e cooldowns |
| `dados/limitecaractere-config.js` / `colecoes` | 5000 ms | Configuração, eventos e cooldowns |
| `dados/gartic-mongo.js` / `obter` | 5000 ms | Conexão 5000 ms, socket 20000 ms; catálogo |
| `dados/ads-storage.js` / `obter` | 5000 ms | Conexão 5000 ms, socket 30000 ms; anúncios e GridFS |

### Quatro clientes expressamente preservados

| Arquivo / função | Configuração e ciclo de vida | Decisão |
| --- | --- | --- |
| `sessao-mongo.js` / `obterColecaoAuth` | URI principal; `MONGODB_DB`; `MONGODB_COLLECTION || 'authState'`; seleção 15000 ms | Sem alteração, inclusive pings inicial e de reuso. Autenticação e lease ficam fora desta fase |
| `dados/captura-diaria.js` / `obterColecaoJornal` | URI principal; database principal; coleção configurável do jornal; seleção 8000 ms; promessa já existente | Arquivo publicado preservado integralmente, inclusive seu ping de reuso |
| `rpg/conexao-mongo.js` / fábrica e `obterContextoRpg` | `MONGO_URI_RPG`; database RPG próprio, com os fallbacks existentes; seleção 15000 ms, socket 20000 ms; fechamento coordenado com operações | Sem alteração de cliente, transação, isolamento ou finanças |
| `comandos/menu-utilitario/tempo-resposta.js` / `medirPingMongo` | URI principal; seleção 3000 ms; constrói, conecta, mede ping e fecha por execução | Ping e custo de abertura fazem parte da medição; nenhum reaproveitamento de pool |

A lease de `dados/sessao-exclusiva.js` utiliza a coleção da sessão, não é um
27º construtor. Seu prazo e sua renovação não foram alterados.

## Pings retirados e preservados

Foram retiradas treze sondagens executadas no reuso de coleção. A API pública
`database.conectar()` mantém sua verificação de saúde: seu ping foi deslocado
para essa API e não é repetido no primeiro boot, já coberto pelo ping inicial.
Assim ela continua retornando false durante falha e true após recuperação.

A quantidade estática de chamadas com `ping: 1` caiu de 29 para 17. Isso não é
uma métrica de frequência: loops e quantidade de acessos determinam o consumo.

As operações de leitura/escrita continuam sendo aguardadas e seus erros seguem
para os mesmos tratamentos dos consumidores. Nenhum erro de CRUD provoca retry
de negócio novo ou fechamento/recriação automática do cliente. O driver continua
gerenciando reconexão, seleção de servidor e os próprios retries configurados.
Falhas durante inicialização fecham o cliente incompleto e liberam a promessa,
permitindo tentativa posterior.

## Comparação offline reproduzível

Executor: `node scripts/teste-mongo-conexoes.js`.
Ele compara o working tree com os arquivos em HEAD; mudar HEAD muda a base.
Não carrega config.js, .env ou credenciais; usa os módulos completos em VM e
um driver simulado. Os getters privados só são expostos dentro do harness.

Carga estável: uma inicialização e cem acessos ao getter com uma consulta por
acesso, em cada um dos treze módulos. Mesmas opções, índices e consultas.

| Medição | Antes | Depois | Diferença |
| --- | ---: | ---: | ---: |
| Clientes construídos | 13 | 13 | 0 |
| Pings explícitos | 1312 | 12 | -1300 |
| Comandos modelados, incluindo índices e consultas | 2632 | 1332 | -1300 |
| Soma dos corpos BSON reconstruídos | 168128 bytes | 129128 bytes | -39000 bytes |

Carga concorrente independente: vinte chamadas de inicialização simultâneas
em cada módulo, com espera no connect e nos índices.

| Medição | Antes | Depois |
| --- | ---: | ---: |
| Clientes construídos | 241 | 13 |
| Clientes redundantes evitados nesse cenário | — | 228 |

Não foram eliminados 228 clientes de produção: esse número pertence à carga
sintética. Em uso serial estável, a redução de clientes medida foi zero.
Não há conversão justificável desses números para GB mensais do Render.

Os bytes são serializações BSON de comandos reconstruídos no mock. Não incluem
handshake, autenticação, seleção de servidor, heartbeats, sessões, TLS, cabeçalhos,
compressão ou retransmissões. Não são captura de rede nem faturamento. Não foi
medida economia de CPU, RAM ou inbound; esses recursos não foram usados como
prova de redução de outbound.

## Testes novos e integração real isolada

Os 82 testes offline passaram: concorrência por módulo, falhas de connect/ping/
índice, fechamento do cliente incompleto, nova tentativa, erros de leitura e
escrita, recuperação sem novo cliente, tratamento funcional de erros públicos,
comandos equivalentes e integridade dos arquivos protegidos/agendadores.

Executor real: `node scripts/teste-mongo-conexoes-real.js`.

- Única configuração real utilizada: `RPG_TEST_MONGO_URI`.
- Banco explicitamente identificado: `hipnos_rpg_testes`.
- MongoDB `8.0.34`, driver `6.21.0`.
- Execução: `522ec7d2accb4108a685cd2ebd32f199`.
- Coleções novas, sem reutilizar namespace anterior:
  `mongo_fase2_522ec7d2accb4108a685cd2ebd32f199_ranking` e
  `mongo_fase2_522ec7d2accb4108a685cd2ebd32f199_configuracoesGrupo`.

Oito cenários reais passaram, usando os providers modificados de ranking e
configurações de grupo. Em cada módulo: vinte inicializações concorrentes criam
um cliente; cem leituras não acrescentam ping; erros de CRUD injetados são
propagados; um socket real do próprio cliente de testes é destruído e o driver
recupera leituras/escritas sem substituir MongoClient ou fazer ping de reuso.

Contadores: dois clientes, dois pings iniciais, dois sockets interrompidos e dois
eventos de falha de transporte. Os providers internos recebem URI sentinela;
a factory redireciona somente para a configuração exclusiva de testes. Nenhuma
conexão, coleção ou dados de produção foram usados. Os documentos são sintéticos
e marcados com `fase2Run`. Não houve drop/delete, limpeza ou alteração de dados
preexistentes; as duas coleções de evidência permanecem no banco de testes.

## Regressão executada

As 27 suítes abaixo concluíram com código zero, com variáveis de conexão de
produção vazias nos processos de teste. Nenhuma suíte de migração ou integração
financeira real foi executada.

- Jornal: `teste-jornal.js`, `teste-jornal-incremental.js` (21 cenários).
- RPG offline: `teste-rpg-conexao.js`, `teste-rpg-fase1.js`, `teste-rpg-fase2.js`,
  `teste-rpg-faculdade.js`, `teste-rpg-seguranca.js`.
- Fluxo: `teste-on-off.js` (83), `teste-loader.js` (594 registros).
- Moderação: `teste-adv.js`, `teste-advertencias-evolucao.js`,
  `teste-antiflood.js`, `teste-antilinkhard.js`, `teste-antigolpe.js`,
  `teste-moderacao-figurinhas.js`.
- Consumidores: `teste-prefixo.js`, `teste-ranking.js`, `teste-afk.js`,
  `teste-welcome-mongo.js`, `teste-vip-mongo.js`, `teste-avaliacao.js`,
  `teste-sugestao.js`, `teste-aleatorios.js`, `teste-lembrete.js`,
  `teste-meuslembretes.js`, `smoke-packs.js`, `teste-tempo-resposta.js`.

`git diff --check` também passou. Nenhum comando, resposta, regra de permissão,
consulta de negócio, índice, documento gravado ou intervalo foi modificado.

## Riscos e oportunidades não implementadas

- O acesso a um getter quente agora não é uma sondagem de disponibilidade.
  Os consumidores fazem suas operações reais e recebem os erros normais delas;
  a API de diagnóstico de ranking e o comando de tempo mantêm suas sondagens.
- Tempos exatos de detecção/erro podem diferir ao remover uma operação de rede.
  Não foram impostos novos timeouts ou garantias de resposta durante uma queda.
- A integração real cobre dois providers e corte de sockets, não todos os módulos
  em um failover, partição longa, troca de credenciais, reinício do cluster ou
  pressão de recursos. Não certifica operação WhatsApp ou Render em produção.
- Os pings de reuso da autenticação e do jornal permanecem por restrição de escopo.
- Compartilhar pools entre módulos, compressão MongoDB, observabilidade contínua,
  cache de configurações, redução de polling e mudanças em agendadores não foram
  implementados. Exigem avaliação e autorização próprias.
- Os 26 pontos de construção permanecem; quantidade simultaneamente ativa,
  sockets e economia faturada só podem ser comprovados com métricas de execução.

Arquivos novos: os dois executores de teste e este relatório. As treze alterações
de aplicação estão enumeradas acima. Nenhum pacote, credencial, .env ou authstate
foi alterado. A publicação foi autorizada pelo usuário após revisão final do
diff, conferência de arquivos sensíveis e nova execução offline dos 82 testes
e das 27 suítes de regressão. O push para main pode iniciar o deploy automático
do Render; não está autorizado um deploy manual adicional.
