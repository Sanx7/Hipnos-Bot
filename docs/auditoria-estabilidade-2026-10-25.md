# Etapa 7 — Auditoria de estabilidade e regressões

Data: 25/10/2026. Branch: `feat/casamento-olimpo`. Base: `a405356d26e96e5672c7512e08bbe76e13bcc306`.

## Resultado consolidado

O inventário inicial encontrou **145 suítes**. Foi acrescentada uma regressão para um defeito demonstrado durante a auditoria, totalizando **146 suítes** no estado final. Foram **140 executadas e aprovadas**, **zero reprovadas**, **zero timeouts** e **seis não executadas**, por dependerem de serviços reais. A rodada final completa levou aproximadamente 198 segundos, com quatro processos em paralelo e limite de 90 segundos por suíte.

As suítes registraram **4.021 casos/verificações individuais aprovados e zero reprovados**. Outras **cinco suítes integradas passaram sem informar quantidade individual**: `teste-aniversarios-conexao`, `teste-loader`, `teste-rpg-fase1`, `teste-rpg-fase2` e `teste-rpg-lid`. Elas estão incluídas nas 140 suítes, mas não foram artificialmente convertidas em quantidades de testes. As contagens individuais usam os resumos dos scripts, casos identificados por suas linhas de resultado e o resumo de `node:test`; não representam quantidade de assertions ou cobertura de linhas. Canvas informa oito valores de configuração e sete cenários; sessão Mongo informa seis escritas e três leituras. As repetições da bateria e a reprodução anterior à correção não são somadas ao total final.

As 16 suítes que falhavam no diagnóstico original passaram nesta auditoria. Nenhuma suíte preexistente foi alterada para obter esse resultado. Isso **não constitui aprovação geral das integrações de produção**: seis suítes não puderam ser executadas nas condições autorizadas.

## Isolamento e execução

O executor `scripts/auditoria-offline.js` descobre suítes `teste-*.js` entre arquivos versionados e arquivos novos não ignorados. Arquivos auxiliares de teste e o comando de produção `comandos/rpg/testrpg.js` não são suítes independentes. `npm test` permanece um placeholder que termina com erro e não executa a bateria; não foi contado como suíte funcional.

Cada worker recebe uma cópia dos arquivos do projeto, sem `.env`, autenticação, bancos locais ou sessões, e ambiente reduzido sem credenciais herdadas. As dependências instaladas são reutilizadas por junction. A guarda bloqueia TCP/TLS, UDP, resolução DNS e conexão do MongoClient real, além de leitura de `.env` e escritas no checkout original, inclusive pela junction. `NODE_OPTIONS` propaga a guarda e rejeições estritas aos subprocessos Node que herdam o ambiente. Os subprocessos nativos identificados nos testes usam arquivos fictícios e FFmpeg local. Essa proteção em JavaScript é infraestrutura de teste, não um sandbox para executar código hostil.

As fixtures são restauradas somente dentro das cópias temporárias, antes da próxima suíte. Resultados brutos permanecem fora do repositório; o JSON deste relatório contém apenas nomes, estados, duração e contagens, sem mensagens, mídia ou credenciais. Sete verificações adicionais da própria guarda passaram, confirmando bloqueios de rede, DNS, MongoDB, leitura síncrona/assíncrona de `.env` e escrita no checkout/dependências. Essas sete verificações complementares não integram os 4.021 casos da bateria.

Uma tentativa preliminar do executor foi interrompida por um erro de escape de caminhos Windows em `NODE_OPTIONS`, antes de iniciar corretamente os testes. O caminho foi normalizado e a bateria inteira repetida. Esses erros de infraestrutura não são resultados dos testes do bot. Após a correção do helper, houve outra rodada completa sobre o estado final; os totais acima são dessa última rodada.

Não houve conexão ao WhatsApp ou MongoDB real, execução da migração real, alteração de `.env`, autenticação ou dados privados, commit, push, deploy ou reinício.

## Falha real encontrada e corrigida

| Arquivo | Reprodução | Causa | Gravidade | Correção e validação |
| --- | --- | --- | --- | --- |
| `func/administrar.js` | `node --check` e o novo teste falharam com `SyntaxError: Unexpected token 'export'`. Remover somente essa instrução na VM reproduziu `ReferenceError: _purlBot is not defined`. | Export ESM em projeto CommonJS e referência a uma função que não havia sido declarada. | Baixa no estado atual: não foram encontradas referências a esse helper no código ativo. Seria impeditiva para um consumidor que o importasse. | Removido o export incompatível; declarada a função antes dos metadados e reutilizada a mesma referência em `module.exports`. Quatro regressões verificam sintaxe, importação, metadados e formato da geração local. Nenhum serviço externo foi acionado. |

O formato preexistente do retorno e o endereço ilustrativo do helper foram preservados. A correção não transforma esse helper legado em uma integração validada com uma API. Nenhum defeito novo crítico ou alto, ou desvio de autorização, foi reproduzido nos cenários executados.

## Comandos, aliases e menus

- Carregamento: **647 rotas** entre nomes e aliases, **361 objetos de comando**, sem novos erros de exportação nos módulos carregados. O teste de aliases extrai o carregador real de `bot.js`; o teste de loader também verifica o registro.
- Catálogo: **345 entradas, 12 portais, 12 comandos por página**, com todas as páginas renderizadas para `/`, `!` e `#`. Cadastro de aniversários no RPG e bloqueios do modo adulto preservados.
- Permanecem os **16 conflitos conhecidos**: sete aliases do próprio objeto e nove colisões entre implementações. Nenhum conflito novo foi encontrado. As nove mensagens de alias ignorado resultam de sete autorreferências e dos aliases `morder` e `flip`; outras colisões decorrem de registros de nomes canônicos.
- Rotas conhecidas: `arrancarcalcinha`, `beijogostoso`, `beijolesbico`, `blow2`, `encerrar-enquete`, `flip`, `gay`, `meme`, `menu-adulto`, `meuslembretes`, `morder`, `mordida`, `pgpeito2`, `pgpeito3`, `soco`, `tapa`. Os vencedores e acessos alternativos documentados na Etapa 6 foram preservados, incluindo `/gayporcentagem`.
- A implementação administrativa de `encerrar-enquete` é acessada por delegação do encerramento unificado. A variante utilitária de lembretes continua acessível por `/meus-lembretes`. Comandos de navegação, seu adaptador e o comando reservado não precisam aparecer como itens comuns do catálogo. A comparação entre implementações e catálogo não identificou outra implementação inacessível.
- Os avisos de itens ignorados em `webp-animado.js` e `audio-extrator.js` referem-se a auxiliares sem `nome/executar`, não à perda de comandos.

Os conflitos continuam dependentes das regras atuais do carregador e são protegidos por regressões. Sua presença não significa que todo alias declarado pertence ao módulo que o declarou: alguns preservam deliberadamente o vencedor histórico. Detalhes estão em `docs/revisao-aliases-menus-2026-10-24.md`.

## Segurança, persistência e estabilidade

| Área | Evidência offline | Limite da conclusão |
| --- | --- | --- |
| PN/LID e privilégios | Donos fictícios em processos isolados, PN/LID comprovados e ambíguos, usuários comuns, Arcontes, histórico e proteção do bot. | Não verifica metadados ou mapeamentos reais de uma sessão WhatsApp. |
| Moderação e ON/OFF | Antigolpe, antiflood, antilink, limite de caracteres, figurinhas, advertências e gates do handler passaram, incluindo falhas fictícias de banco e transporte. | Não equivale a verificar todas as combinações possíveis de permissões e conteúdo de todos os comandos. |
| Ranking | Registro, consultas e migração com injeção de falhas e repetição passaram; 51 casos da migração segura. | Não houve migração nem validação de transações, majority ou topologia em servidor MongoDB real. |
| MongoDB | Pool simulado, inicialização concorrente, falhas de connect/ping/índice/leitura/escrita, recuperação e sessão passaram. | Índices e garantias de persistência são simulados; nenhum banco real foi alterado. |
| VIP, namoro, casamento e RPG | Identidade, acesso, persistência e operações auditadas com coleções fictícias passaram. | Concorrência e falhas reais do driver/servidor permanecem fora desta execução. |
| Aniversários e lembretes | Privacidade pública/privada, datas, listagens, agendamento, menções, duplicação e reconexões foram cobertos pelas respectivas suítes existentes. | Não há prova de entrega/notificação nos clientes WhatsApp; a garantia de não duplicação dos aniversários não deve ser extrapolada para todos os agendadores. |
| Conexão e processo | Lifecycle em VM, lease, socket substituído, conflito 440 e encerramento; rejeições estritas no executor e watchdog/timeout dos testes. | Não houve teste de carga contínua do processo real, perda de rede real ou OOM na hospedagem. |

As mensagens de erro esperadas em testes de falha de Mongo, metadados ou transporte foram confrontadas com o resultado das suítes, não contadas automaticamente como falhas. Não apareceram sinais inesperados de rejeições/exceções não tratadas ou bloqueios da guarda nos logs finais.

Pontos para aprofundar, sem incidentes novos demonstrados nesta etapa:

1. **Prioridade de estabilidade:** ampliar regressões do agendador de lembretes para envio aceito seguido de falha na gravação da confirmação, espera indefinida de transporte e troca de socket durante a entrega. O mutex atual é local ao processo e a confirmação sucede o envio; não há nesta auditoria uma prova de entrega exatamente uma vez para esse sistema.
2. **Prioridade de diagnóstico/privacidade:** os handlers globais de `bot.js` mantêm o processo após exceção e imprimem objetos de erro. Revisar, em etapa própria, redaction e critérios de recuperação/encerramento, com testes; a presença desses handlers não prova que o processo continuou saudável depois de uma falha arbitrária.
3. Entregas de aniversário incertas permanecem bloqueadas para evitar duplicação. Isso pode significar ausência de uma homenagem após falha ambígua, sem que ela seja marcada como enviada; o comportamento é intencional e foi preservado.
4. Autorizar futuramente integrações em ambiente descartável, com credenciais de teste e isolamento comprovado, antes de afirmar garantias reais do MongoDB e dos provedores. Nada disso foi executado nesta auditoria offline.

## Suítes não executadas

| Suíte | Motivo |
| --- | --- |
| `scripts/teste-acoes.js` | Requisições reais às APIs de GIFs e conversão do resultado remoto. |
| `scripts/teste-play.js` | Download/API externa real. |
| `scripts/teste-nasa-integracao.js` | Smoke test real de NASA/Groq, com chaves externas. |
| `scripts/teste-mongo-conexoes-real.js` | Integração com MongoDB real, mesmo exigindo banco explicitamente de teste. |
| `scripts/teste-jornal-mongo-real.js` | Persistência e falhas de transporte em MongoDB real. |
| `scripts/teste-rpg-integracao-mongo.js` | Operações em MongoDB real de teste. |

Essas seis suítes não são aprovadas, nem falhas de produção reproduzidas: são cobertura não executada pela restrição offline. Também não foram validados Linux/recursos da LatamHost, serviços pagos ou gratuitos externos, notificações efetivas, limites reais de grupos/mídia e comportamento em execução prolongada.

## Arquivos e hospedagem

| Arquivo | Alteração | Enviar à LatamHost? |
| --- | --- | --- |
| `func/administrar.js` | Correção mínima do helper legado CommonJS. | Somente este arquivo de produção, caso seja aplicada a correção. Nenhuma configuração adicional é necessária. |
| `scripts/teste-administrar.js` | Quatro regressões offline novas. | Não é necessário para executar o bot. |
| `scripts/auditoria-offline.js` | Executor reproduzível da bateria em cópias temporárias. | Não é necessário para executar o bot. |
| `scripts/helpers/auditoria-offline-preload.js` | Guarda dos processos de teste. | Não é necessário para executar o bot. |
| `docs/auditoria-estabilidade-2026-10-25.md` | Relatório consolidado e inventário. | Não é necessário para executar o bot. |
| `docs/auditoria-estabilidade-2026-10-25.json` | Resultados estruturados, sem saída bruta dos comandos. | Não é necessário para executar o bot. |

Risco de regressão da correção: baixo, pois o helper não tem consumidores identificados e seu formato local foi preservado. A sintaxe dos **523 arquivos JavaScript** foi validada por compilação sem execução; `node --check` passou nos quatro arquivos JavaScript alterados/criados. `git diff --check` passou. A branch e o HEAD foram preservados; as únicas alterações locais são os seis arquivos acima.

Para repetir a bateria: `node scripts/auditoria-offline.js`. Os resultados serão criados em um novo diretório temporário, sem sobrescrever uma rodada anterior. O executor exige Git e dependências previamente instaladas; não instala pacotes nem acessa serviços. A primeira providência recomendada para a próxima etapa é ampliar os testes de falhas parciais dos lembretes e da supervisão de erros assíncronos, mantendo os dados fictícios.

## Inventário da rodada final

A tabela abaixo é gerada a partir do JSON da execução final. “Integrado” significa suíte aprovada sem subdivisão individual informada pelo script; “—” nas integrações externas significa não executado.

| Suite | Estado | Casos/verificacoes individuais | Duracao (ms) |
| --- | --- | ---: | ---: |
| `scripts/teste-acoes.js` | nao-executada | --- | --- |
| `scripts/teste-adivinha-emoji.js` | aprovada | 44 | 4945 |
| `scripts/teste-administrar.js` | aprovada | 4 | 11791 |
| `scripts/teste-adv.js` | aprovada | 26 | 17556 |
| `scripts/teste-advertencias-evolucao.js` | aprovada | 63 | 22365 |
| `scripts/teste-afk.js` | aprovada | 22 | 6322 |
| `scripts/teste-alcunha.js` | aprovada | 28 | 7247 |
| `scripts/teste-aleatorios.js` | aprovada | 11 | 14622 |
| `scripts/teste-aliases-comandos.js` | aprovada | 33 | 8692 |
| `scripts/teste-anagrama.js` | aprovada | 27 | 6653 |
| `scripts/teste-animacoes-comandos.js` | aprovada | 44 | 3361 |
| `scripts/teste-animacoes-locais.js` | aprovada | 11 | 1998 |
| `scripts/teste-aniversarios-conexao.js` | aprovada | Integrado | 707 |
| `scripts/teste-aniversarios.js` | aprovada | 49 | 3193 |
| `scripts/teste-antiaudio.js` | aprovada | 8 | 1948 |
| `scripts/teste-antidoc.js` | aprovada | 8 | 618 |
| `scripts/teste-antievento.js` | aprovada | 8 | 1896 |
| `scripts/teste-antiflood.js` | aprovada | 78 | 2665 |
| `scripts/teste-antigolpe.js` | aprovada | 198 | 7976 |
| `scripts/teste-antilink.js` | aprovada | 8 | 653 |
| `scripts/teste-antilinkhard.js` | aprovada | 97 | 3149 |
| `scripts/teste-antipay.js` | aprovada | 8 | 821 |
| `scripts/teste-antistatus.js` | aprovada | 8 | 746 |
| `scripts/teste-arcontes-olimpo.js` | aprovada | 98 | 1815 |
| `scripts/teste-assinatura.js` | aprovada | 24 | 1848 |
| `scripts/teste-atividade-grupo.js` | aprovada | 26 | 4970 |
| `scripts/teste-avaliacao.js` | aprovada | 8 | 1085 |
| `scripts/teste-blacklist-numero.js` | aprovada | 20 | 1605 |
| `scripts/teste-boasvindas.js` | aprovada | 23 | 15938 |
| `scripts/teste-brat.js` | aprovada | 5 | 4879 |
| `scripts/teste-casamento-olimpo.js` | aprovada | 61 | 1487 |
| `scripts/teste-cep.js` | aprovada | 7 | 1654 |
| `scripts/teste-checkativo.js` | aprovada | 8 | 1988 |
| `scripts/teste-cobrinha.js` | aprovada | 21 | 1814 |
| `scripts/teste-compatibilidade-canvas.js` | aprovada | 15 | 20865 |
| `scripts/teste-compatibilidade.js` | aprovada | 32 | 1116 |
| `scripts/teste-comunicado.js` | aprovada | 53 | 1391 |
| `scripts/teste-conexao-bot.js` | aprovada | 61 | 1276 |
| `scripts/teste-conversor.js` | aprovada | 13 | 883 |
| `scripts/teste-corvip.js` | aprovada | 20 | 5035 |
| `scripts/teste-ddd.js` | aprovada | 7 | 454 |
| `scripts/teste-delete.js` | aprovada | 9 | 409 |
| `scripts/teste-desenharpalavra.js` | aprovada | 46 | 584 |
| `scripts/teste-dicionario.js` | aprovada | 10 | 1380 |
| `scripts/teste-dino.js` | aprovada | 18 | 1338 |
| `scripts/teste-downloads-extra.js` | aprovada | 39 | 16144 |
| `scripts/teste-efeitos-visuais.js` | aprovada | 61 | 17394 |
| `scripts/teste-efeitos.js` | aprovada | 16 | 8363 |
| `scripts/teste-elogio.js` | aprovada | 13 | 1473 |
| `scripts/teste-emojimix.js` | aprovada | 11 | 1750 |
| `scripts/teste-enquete-admin.js` | aprovada | 53 | 1341 |
| `scripts/teste-enquete.js` | aprovada | 49 | 1353 |
| `scripts/teste-enquetes-nativas.js` | aprovada | 38 | 2501 |
| `scripts/teste-estabilidade.js` | aprovada | 17 | 6998 |
| `scripts/teste-eununca.js` | aprovada | 7 | 1420 |
| `scripts/teste-explicarmeme.js` | aprovada | 28 | 1962 |
| `scripts/teste-fake-chat.js` | aprovada | 8 | 2188 |
| `scripts/teste-figurinha.js` | aprovada | 54 | 8369 |
| `scripts/teste-forca.js` | aprovada | 35 | 788 |
| `scripts/teste-frase.js` | aprovada | 18 | 631 |
| `scripts/teste-gartic-catalogo.js` | aprovada | 36 | 3501 |
| `scripts/teste-gartic.js` | aprovada | 20 | 5963 |
| `scripts/teste-gerar-nome.js` | aprovada | 17 | 1810 |
| `scripts/teste-hidetag.js` | aprovada | 13 | 787 |
| `scripts/teste-historicoarconte.js` | aprovada | 58 | 2837 |
| `scripts/teste-horoscopo.js` | aprovada | 9 | 1367 |
| `scripts/teste-ia-interativa-donos.js` | aprovada | 13 | 4805 |
| `scripts/teste-ia-interativa.js` | aprovada | 29 | 2152 |
| `scripts/teste-ia.js` | aprovada | 6 | 777 |
| `scripts/teste-insulto.js` | aprovada | 11 | 1480 |
| `scripts/teste-jornal-incremental.js` | aprovada | 21 | 15676 |
| `scripts/teste-jornal-mongo-real.js` | nao-executada | --- | --- |
| `scripts/teste-jornal.js` | aprovada | 20 | 4095 |
| `scripts/teste-lembrete.js` | aprovada | 14 | 1022 |
| `scripts/teste-letra.js` | aprovada | 14 | 889 |
| `scripts/teste-limitecaractere.js` | aprovada | 167 | 6709 |
| `scripts/teste-limpar-chat.js` | aprovada | 41 | 1226 |
| `scripts/teste-linkgp.js` | aprovada | 8 | 1616 |
| `scripts/teste-loader.js` | aprovada | Integrado | 5643 |
| `scripts/teste-mensagens-apagadas.js` | aprovada | 14 | 2296 |
| `scripts/teste-menus-olimpo.js` | aprovada | 54 | 6601 |
| `scripts/teste-meuslembretes.js` | aprovada | 19 | 806 |
| `scripts/teste-migrar-ranking-lid.js` | aprovada | 14 | 788 |
| `scripts/teste-migrar-ranking-seguranca.js` | aprovada | 51 | 1945 |
| `scripts/teste-moderacao-figurinhas.js` | aprovada | 44 | 1397 |
| `scripts/teste-modificador-voz.js` | aprovada | 55 | 6950 |
| `scripts/teste-mongo-conexoes-real.js` | nao-executada | --- | --- |
| `scripts/teste-mongo-conexoes.js` | aprovada | 82 | 4437 |
| `scripts/teste-namoro-olimpo.js` | aprovada | 65 | 2034 |
| `scripts/teste-nasa-integracao.js` | nao-executada | --- | --- |
| `scripts/teste-nasa.js` | aprovada | 8 | 1842 |
| `scripts/teste-nomecustom.js` | aprovada | 22 | 5146 |
| `scripts/teste-novidades.js` | aprovada | 13 | 755 |
| `scripts/teste-npm-shell-sem-canvas.js` | aprovada | 16 | 5799 |
| `scripts/teste-nuke.js` | aprovada | 89 | 1512 |
| `scripts/teste-on-off.js` | aprovada | 86 | 5334 |
| `scripts/teste-perfil.js` | aprovada | 11 | 5614 |
| `scripts/teste-pergunta.js` | aprovada | 4 | 362 |
| `scripts/teste-pinterest.js` | aprovada | 9 | 701 |
| `scripts/teste-play.js` | nao-executada | --- | --- |
| `scripts/teste-ppt.js` | aprovada | 10 | 1460 |
| `scripts/teste-prefixo.js` | aprovada | 25 | 5189 |
| `scripts/teste-procurado.js` | aprovada | 40 | 10397 |
| `scripts/teste-protecao-bot.js` | aprovada | 48 | 5363 |
| `scripts/teste-quem.js` | aprovada | 8 | 554 |
| `scripts/teste-quiz.js` | aprovada | 29 | 1008 |
| `scripts/teste-ranking-registro.js` | aprovada | 14 | 812 |
| `scripts/teste-ranking.js` | aprovada | 26 | 9344 |
| `scripts/teste-reacoes-palavras.js` | aprovada | 23 | 1406 |
| `scripts/teste-reescrever.js` | aprovada | 12 | 1390 |
| `scripts/teste-removebg.js` | aprovada | 18 | 3136 |
| `scripts/teste-resposta-prefixo.js` | aprovada | 26 | 1351 |
| `scripts/teste-resumir.js` | aprovada | 27 | 1474 |
| `scripts/teste-revelar-permissoes.js` | aprovada | 18 | 5819 |
| `scripts/teste-revelaraudio.js` | aprovada | 17 | 1138 |
| `scripts/teste-rimas.js` | aprovada | 6 | 1034 |
| `scripts/teste-rpg-conexao.js` | aprovada | 3 | 1837 |
| `scripts/teste-rpg-empregos.js` | aprovada | 14 | 614 |
| `scripts/teste-rpg-faculdade.js` | aprovada | 20 | 2594 |
| `scripts/teste-rpg-fase1.js` | aprovada | Integrado | 656 |
| `scripts/teste-rpg-fase2.js` | aprovada | Integrado | 2803 |
| `scripts/teste-rpg-integracao-mongo.js` | nao-executada | --- | --- |
| `scripts/teste-rpg-isolamento.js` | aprovada | 12 | 1481 |
| `scripts/teste-rpg-lid.js` | aprovada | Integrado | 3307 |
| `scripts/teste-rpg-seguranca.js` | aprovada | 23 | 1253 |
| `scripts/teste-sessao-mongo.js` | aprovada | 9 | 1221 |
| `scripts/teste-setads-conexao.js` | aprovada | 9 | 2499 |
| `scripts/teste-setads-storage.js` | aprovada | 28 | 1246 |
| `scripts/teste-setads.js` | aprovada | 135 | 2211 |
| `scripts/teste-sticker-captura.js` | aprovada | 26 | 2232 |
| `scripts/teste-sticker-video.js` | aprovada | 6 | 45719 |
| `scripts/teste-sugestao.js` | aprovada | 6 | 1343 |
| `scripts/teste-surpresa.js` | aprovada | 26 | 1350 |
| `scripts/teste-temavip.js` | aprovada | 15 | 8033 |
| `scripts/teste-tempo-resposta.js` | aprovada | 7 | 809 |
| `scripts/teste-tiktok.js` | aprovada | 18 | 4952 |
| `scripts/teste-totag.js` | aprovada | 122 | 1831 |
| `scripts/teste-traduzir.js` | aprovada | 21 | 1582 |
| `scripts/teste-troca-dono.js` | aprovada | 72 | 1772 |
| `scripts/teste-ttp.js` | aprovada | 7 | 1754 |
| `scripts/teste-velha.js` | aprovada | 12 | 1671 |
| `scripts/teste-vip-identidade-cooldown.js` | aprovada | 26 | 2239 |
| `scripts/teste-vip-mongo.js` | aprovada | 9 | 894 |
| `scripts/teste-vouc.js` | aprovada | 56 | 2363 |
| `scripts/teste-welcome-mongo.js` | aprovada | 15 | 1020 |
| `scripts/teste-wiki.js` | aprovada | 9 | 1296 |
