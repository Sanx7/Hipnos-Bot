# Falha de /totag e conflito 440

## Evidências e limite do diagnóstico

Os logs `metadados/falha`, `autorizacao/falha`, `aviso_erro/falha` podem ser reproduzidos no código anterior: `groupMetadata` rejeita; o comando tenta avisar o usuário; esse envio rejeita e cai no catch externo com a etapa ainda `autorizacao`; então tenta outro aviso e falha novamente. O download da foto sequer começou. O bloqueio na ausência de metadados é necessário: não se comprovam os administradores nem se obtém a lista de participantes para menções. Não foi removido, nem para dono.

No Baileys instalado, `DisconnectReason.connectionReplaced` é 440. O código anterior reconectava após esse status, alimentando disputa com uma conexão concorrente. Existia uma trava apenas de reconexão *agendada*, mas nenhuma para a inicialização assíncrona: chamadas simultâneas a `startBot` podiam passar juntas pela trava antes dos awaits Mongo. `end` é assíncrono no rc14 e não era aguardado. Não havia exclusão entre processos usando a mesma collection de autenticação.

Esses defeitos e riscos estão comprovados por leitura do código e reprodução offline. Não há evidência suficiente para atribuir o incidente do Render a uma instância específica, provar sockets sobrepostos naquele momento ou estabelecer que `/totag` causou o 440. As consultas de metadados podem falhar durante indisponibilidade/substituição da conexão. A ordem dos logs não comprova causalidade.

## Correções

- Inicialização tem promessa única abrangendo banco, encerramento, criação e registro de listeners. Reentradas compartilham a mesma promessa. O encerramento anterior é aguardado; falha não libera novo socket.
- Eventos de sockets antigos não acionam reconexões; handlers de mensagens/participantes recusam socket indisponível. Baileys `end` destrói seu event buffer e remove listeners; um socket novo recebe uma inscrição por evento. Gravações futuras de autenticação também validam socket atual e lease.
- Um timer de reconexão é mantido e cancelado quando abre, perde lease ou termina. Fechamentos repetidos não criam novos timers. Backoff comum permanece. 440 bloqueia reconexão automática até reiniciar o processo; não apaga credenciais nem chama logout. 401/500 também bloqueiam, preservando a política existente de sessão inválida.
- Inicialização com sessão ocupada aguarda 30s antes de tentar reservar novamente, sem abrir socket enquanto houver titular. Falhas temporárias de inicialização usam backoff até 60s; isso permite recuperação quando a instância anterior termina durante troca de processo no Render. Lembretes só iniciam em `open`, evitando consumir tentativas enquanto está conectando.
- Lease persistente `_id=hipnos_socket_lease` na mesma collection de autenticação (`MONGODB_COLLECTION`, padrão `authState`), reservada atomicamente antes de ler/criar credenciais e abrir socket. Dura 90s, renovada a cada 20s; perda/falha de renovação bloqueia inicialização e encerra a conexão. Validade local é verificada antes de envio, metadados e acesso à autenticação, inclusive se a renovação ficar pendente além da expiração. Uma segunda instância atualizada registra `sessao_ocupada` e não abre socket.
- SIGTERM/SIGINT bloqueiam reentradas, fecham socket e só então liberam a lease. Encerramento com erro não libera antecipadamente; a reserva expira. Prazo de shutdown: 15s. Após 440, o processo mantém sua reserva enquanto aguarda intervenção, para impedir ciclos de disputa.
- Consultas **simultâneas** de metadados do mesmo grupo/socket compartilham uma promessa. Ela é removida após sucesso/falha. Consultas posteriores são novas: sem cache de permissões. Há consultas sequenciais em AFK, OFF/dono, modo somente admin e no próprio comando; elas têm finalidades distintas e não foram eliminadas para não reutilizar permissões antigas.
- Envios e metadados pelo socket de produção recusam estado desconectado; `/totag` verifica disponibilidade e separa logs de metadados, autorização e envio. Avisos não propagam erros nem provocam outro aviso. Falha de transporte no envio não gera retry. Falhas de download continuam com aviso amigável quando há conexão.

## Diagnóstico seguro no Render

Logs de conexão mostram eventos fixos, status numérico, identificador aleatório do processo e geração local do socket. Não imprimem erro bruto, credenciais, sessão, URI, telefone, JID ou mídia. O identificador não é o token da lease. Eventos úteis: `socket_criado`, `sessao_substituida`, `conflito_440`, `sessao_ocupada`, `lease_perdida`.

Compare identificadores de processo e períodos de atividade nos serviços/workers/localizações que usam a mesma sessão. Confira escala, deploys em sobreposição, serviços antigos e execução local. Uma cópia antiga que não implementa lease, ou outro cliente conectado com credenciais copiadas, ainda pode causar 440: a reserva só coordena processos que respeitam o protocolo e compartilham o banco/collection. Não há observação remota das instâncias nesta investigação.

O lease depende do relógio dos hosts razoavelmente sincronizado. Não existe transação conjunta entre Mongo e WhatsApp: uma operação já iniciada pode terminar após o fechamento; verificações impedem operações novas de sockets antigos, mas não desfazem efeitos já enviados. Não é garantia matemática de ausência de conflitos em partições ou com clientes externos.

## Testes offline

`scripts/teste-conexao-bot.js` usa mocks Mongo e executa o construtor/listener de produção em VM: inicialização concorrente, encerramento aguardado, listeners, callbacks antigos, timer único/cancelamento, 440, exclusão entre processos, lease expirada/perdida, escrita antiga recusada e logs sem segredos. `scripts/teste-totag.js` cobre falhas de metadados e autorização, desconexão, aviso falho sem cascata, envio 440, permissões JID/LID e regressões de texto/foto/vídeo/áudio.

Arquivos criados: `dados/socket-seguro.js`, `dados/sessao-exclusiva.js`, `scripts/teste-conexao-bot.js` e este documento. Modificados: `bot.js`, `sessao-mongo.js`, `comandos/admin/totag.js`, `scripts/teste-totag.js` e os contextos VM de `scripts/teste-on-off.js`, `scripts/teste-protecao-bot.js`, `scripts/teste-setads-conexao.js`.

Nenhuma conexão real ao WhatsApp/Render/Mongo, logout, exclusão de credenciais ou deploy é feita pelos testes. Anúncios, moderação e prefixo são verificados pelas suítes de regressão existentes.

Resultado: 61 verificações de conexão/sessão, 99 de totag, 76 ON/OFF, 48 proteção do bot, 135 anúncios + 28 GridFS + 9 conexão de anúncios, 25 prefixo e loader com 580 entradas. Também passaram sessão Mongo (integridade binária/primitivos), antigolpe (178), limitecaractere (116), antiflood (78), antilinkhard (97), figurinhas (44), comunicado (53) e lembretes. Sintaxe e `git diff --check` aprovados.
