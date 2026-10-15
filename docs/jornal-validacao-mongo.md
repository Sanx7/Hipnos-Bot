# Jornal incremental — validação com MongoDB real de testes

Execução concluída em 14/10/2026. Resultado: 12 cenários aprovados, zero falhas.

- Banco explicitamente utilizado: `hipnos_rpg_testes`.
- Configuração exclusiva de testes: `RPG_TEST_MONGO_URI`.
- MongoDB: `8.0.34`; driver: `6.21.0`; Node.js: `v24.17.0`.
- Execução: `e3a38dafde97416fbeb83eb9a1435ffa`.
- SHA-256 de `dados/captura-diaria.js` testado:
  `401a5f9b73ed5fbb54041062dff17021510969c0c971379b42d820c676c93b99`.

## Isolamento e material criado

Executor: `node scripts/teste-jornal-mongo-real.js`.

O executor não importa `config.js`, não usa as variáveis de conexão de produção
e não as repassa ao módulo nem ao processo filho. Extrai somente a configuração
explicitamente identificada como teste; recusa URI/banco não reconhecidos e não
possui fallback para produção. O provider MongoDB interno do módulo é bloqueado
no harness; somente a coleção de testes injetada pode fazer operações.

Coleções criadas explicitamente, recusando reutilização de namespace:

- `jornal_test_e3a38dafde97416fbeb83eb9a1435ffa`;
- `jornal_ttl_e3a38dafde97416fbeb83eb9a1435ffa`.

Todos os atores são sintéticos, com prefixo `000`, e os filtros são restritos
por `jornalTestRun`. O pipeline preserva esse marcador. Não foram consultadas
coleções existentes, nem executados comandos RPG, autenticação ou WhatsApp.
Nenhuma coleção foi apagada e não houve limpeza manual. Somente o documento
sintético de prova TTL foi removido automaticamente pelo MongoDB. As coleções
e os demais documentos de teste permanecem sujeitos aos próprios índices TTL.

## Cenários executados

1. Pipeline real com `$replaceWith`, `$cond`, `$concatArrays`, `$slice`,
   `$mergeObjects` e `$literal`; preservação de `$campo`, `$$ROOT`, acentos,
   emoji, autor e horário dentro do conteúdo.
2. Cem capturas simultâneas no mesmo grupo; ordem completa verificada no banco.
3. Cinquenta capturas em cada um de dois grupos intercalados; isolamento dos
   conteúdos verificado no banco.
4. Quinhentas entradas e a entrada 501; comparação exata das últimas 500.
5. Documento legado sem metadados incrementais; primeira nova captura preserva
   o histórico anterior e os campos desconhecidos.
6. Novo processo Node recupera mensagens persistidas e acrescenta outra na ordem.
7. Resposta descartada artificialmente após escrita real com `majority`; retry
   não duplica a entrada e a revisão avança uma vez por mensagem.
8. Duas confirmações descartadas; nova instância recupera o documento real e
   acrescenta outra entrada; a tentativa antiga posterior não duplica dados.
9. Mesmo pipeline repetido três vezes diretamente no servidor; documento final
   permanece idêntico, inclusive revisão e metadados de idempotência.
10. Destruição efetiva de um socket em uso do cliente exclusivo de testes antes
    da resposta da operação; erro de transporte observado e recuperação sem
    duplicação nem inversão de ordem. `retryWrites: false` mantém a recuperação
    desse cenário sob responsabilidade do código do jornal.
11. Relógio injetado atravessa a meia-noite de São Paulo; documentos de dias
    distintos, histórico anterior intacto e mínimo de 60 segundos da função
    de expiração preservado.
12. Inspeção dos índices reais, incluindo unicidade e `expireAfterSeconds: 0`;
    remoção automática efetivamente observada de uma prova expirada criada
    exclusivamente para esse teste.

Contadores finais: 1 socket interrompido, 1 erro real de transporte,
3 confirmações descartadas e 3 repetições explícitas do pipeline.

## Resultado e limites

Não apareceu defeito que exigisse alterar `dados/captura-diaria.js`.
Foram adicionados somente o executor de integração e este relatório.

As leituras/escritas e os índices foram executados por um servidor MongoDB real.
O relógio e a normalização da entrada WhatsApp foram injetados: não houve envio,
recebimento ou conexão WhatsApp real. A compatibilidade foi comprovada no servidor
8.0.34 testado, não em todas as versões de MongoDB.

As perdas de confirmação são injetadas na fronteira do cliente depois de escritas
reais concluídas; não representam perda de pacotes controlada no servidor. O
corte de transporte destrói um socket do próprio cliente de testes usando as
estruturas internas do driver 6.21.0, sem alterar infraestrutura compartilhada.
Não foram exercitados failover do replica set, reinício do servidor, partição
prolongada de rede ou morte abrupta do processo durante uma gravação incerta.
Não foi exercitada escrita simultânea por processos independentes no mesmo grupo.

Permanece o limite de durabilidade documentado: entradas ainda não confirmadas,
mantidas somente em RAM durante indisponibilidade, podem se perder com a morte
do processo. A recuperação testada garante o histórico efetivamente persistido.
O TTL remove documentos de forma assíncrona; não garante exclusão no exato
instante da meia-noite. Referência: [TTL do MongoDB](https://www.mongodb.com/docs/manual/core/index-ttl/).

Não houve instalação de dependências, commit, push ou deploy. Não foram
necessárias alterações em outras funcionalidades.
