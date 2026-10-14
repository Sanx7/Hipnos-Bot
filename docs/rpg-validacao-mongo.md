# RPG fase 1 — validação com MongoDB real isolado

Execução em 13/10/2026. ID: ebea88dd455c0195fd8d9546852eec51.
Ambiente: Node.js v24.17.0 e driver MongoDB 6.21.0.

## Isolamento verificado

RPG_TEST_MONGO_URI foi carregada do .env local pelo parser existente.
O host SRV e os três servidores DNS do destino de testes são distintos dos
hosts/servidores configurados em MONGODB_URI e MONGO_URI_RPG.
Não foram consultados dados de produção nem abertas conexões MongoDB nesses
destinos. DNS não certifica ausência de outros usos administrativos do cluster;
a conclusão é separação em relação às conexões de produção configuradas.

Banco utilizado: hipnos_rpg_testes.
Coleções criadas exclusivamente para a execução:

- rpg_test_ebea88dd455c0195fd8d9546852eec51_jogadores
- rpg_test_ebea88dd455c0195fd8d9546852eec51_operacoes
- rpg_test_ebea88dd455c0195fd8d9546852eec51_prova

A criação explícita recusa NamespaceExists: nunca reutiliza uma coleção
preexistente. Documentos recebem rpgTestRun, e consultas/escritas são limitadas
a esse identificador. Nenhuma coleção foi apagada; nenhuma limpeza executada.
Somente atores sintéticos com prefixo numérico 000 foram utilizados.
Não há conexão ao WhatsApp: envio, metadados de grupo e mapeamento LID usam stubs.

## Testes reais executados

17 cenários aprovados; zero reprovados:

1. Commit real com snapshot e majority.
2. Interrupção antes do commit, com abort e reversão de escrita real.
3. Criação de personagem e preservação de documento antigo/campos desconhecidos.
4. Depósito e saque, saldos pós-operação e conservação do total.
5. Transferência e auditoria no mesmo commit.
6. Repetição da mensagem concluída e recusa de pedido conflitante.
7. Replay em outro processo Node, usando os registros persistidos.
8. Saldo insuficiente e transferência para a própria conta.
9. Destinatário novo criado dentro da transação; ausência na escrita do crédito
   provoca recusa sem débito. O comportamento atual é criar destinatário novo.
10. Falha injetada depois de crédito real ainda não confirmado: rollback.
11. Commit real concluído com resposta perdida artificialmente: leitura da
    auditoria comprova sucesso, sem nova movimentação.
12. Commit sem comprovação: reserva permanece pendente e replay não executa.
13. Doze movimentações simultâneas, com conservação do total e sem negativos.
14. Fechamento/reabertura do cliente e replay sem segundo débito.
15. Confirmação WhatsApp bloqueada no stub, sem alterar resultado financeiro.
16. PN/JID/LID legados e fichas conflitantes, sem mesclagem ou mudança monetária.
17. Auditoria persistente, IDs únicos, estados e conservação por operação.

Estado final da auditoria: 9 concluídas, 11 recusadas, 2 pendentes.
As recusas incluem validações de negócio e conflitos reais concorrentes.
Os dois pendentes foram gerados intencionalmente pelos cenários de falha.
Eles NÃO foram limpos nem convertidos automaticamente em recusados/concluídos.

As verificações usaram o driver MongoDB e sessões/coleções reais. As coleções
foram injetadas no contexto RPG para evitar qualquer provider de produção;
as APIs de cadastro, economia, transação e comandos foram as da implementação.
O ciclo de conexão testado aqui é fechamento/reabertura do cliente isolado,
não um failover do pool de produção.

## Controles offline adicionais

scripts/teste-rpg-isolamento.js aprovou 12 verificações: ausência da variável,
host de produção, banco não identificado como teste, DNS compartilhado,
configuração incompleta, falha DNS e namespaces inválidos são recusados.

Novos arquivos desta validação:

- scripts/helpers/rpg-mongo-isolamento.js
- scripts/teste-rpg-isolamento.js
- scripts/teste-rpg-integracao-mongo.js
- docs/rpg-validacao-mongo.md

Nenhum módulo de produção precisou de correção. Nenhuma credencial ou
configuração persistente foi alterada; não houve commit, push ou deploy.

## Como executar novamente

Configurar RPG_TEST_MONGO_URI exclusivamente para um cluster de testes
separado, usando URI mongodb+srv e banco com nome hipnos_rpg_testes ou
hipnos_rpg_test, opcionalmente seguido de sufixo alfanumérico.
As duas conexões de produção precisam estar presentes somente para comparação
de endpoints; nunca são fornecidas ao MongoClient do executor.

Executar:

    node scripts/teste-rpg-isolamento.js
    node scripts/teste-rpg-integracao-mongo.js

Cada execução gera outro ID e outras coleções. O executor não usa rpgPlayers,
não executa migrações, não apaga bancos/coleções e não limpa documentos.
Se faltar URI, isolamento DNS, permissão ou suporte transacional, interrompe.
Resultados incompletos/falhas preservam o material criado para diagnóstico.

## Limitações, riscos e recomendação

Não foram executados failover do replica set, partição real de rede, reinício
do servidor, interrupção abrupta do processo durante commit nem queda do cluster.
Os erros de resposta/commit foram injetados no cliente, sobre transações reais,
sem manipular infraestrutura. Entrega WhatsApp real não foi testada.

Asserções monetárias usam centavos para comparar o total, sem alterar documentos
antigos nem introduzir conversão de armazenamento. Fichas conflitantes e
representações monetárias incompatíveis continuam exigindo decisão separada.

Esta execução confirma funcionamento da integração básica no destino testado,
não certifica todos os cenários de disponibilidade ou o cluster de produção.
Antes de produção, revisar operação/recuperação de pendentes, backup conjunto
de jogadores/auditoria, legados e homologação de falhas de infraestrutura.
Conflitos simultâneos podem recusar operações; não há repetição automática.
