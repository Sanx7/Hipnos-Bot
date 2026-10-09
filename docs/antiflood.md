# Antiflood

`/antiflood on`, `off`, `status`, `config`, `limite 6 10`, `acao apagar`, `acao adv`, `acao ban`. O roteador aceita o prefixo global vigente. Configuração somente em grupos, por administradores, dono do grupo ou dono do bot. Durante OFF somente o dono do bot pode configurar; a proteção automática continua.

Padrão: desligado, 6 mensagens/10 segundos, ação adv. Limite 3–30, janela 3–60 segundos. MongoDB `configAntiflood`, chave `_id` do grupo; nenhum JSON. Leitura do banco antes da contagem e revalidação antes dos efeitos. Banco/configuração/identidade indisponível não autoriza punição.

Janela deslizante por grupo e número comprovado pelos helpers JID/LID. Texto, imagens, vídeo, áudio, figurinha e documento (inclusive legenda) contam uma vez, sem download. Normalização Baileys de wrappers. Só upsert `notify` com id, participante e timestamp válido, de no máximo 60 segundos atrás (tolerância futura 5s). Eventos históricos `append`, protocolo, stub e mensagens próprias são ignorados. Relógio do servidor deve estar sincronizado. Não é possível distinguir um replay `notify` com id desconhecido e timestamp ainda recente de uma mensagem nova.

Fila por grupo serializa chegadas concorrentes neste processo; cache de ids por dois minutos. Contadores guardam até 31 timestamps, expiram após 60s; limpeza a cada 30s, limites de 10.000 entradas, sem baixar mídia. Reinícios limpam contadores recentes. Processos independentes não compartilham essas contagens; executar uma instância consumidora de mensagens por conta. Reservas persistentes de eventos (`ocorrenciasAntiflood`, TTL 24h) impedem repetir efeitos do mesmo excesso, inclusive após falha parcial.

Cooldown Mongo atômico em `cooldownsAntiflood`, por grupo+número, 30s: TTL para limpeza e comparação do prazo para liberação exata. Continua apagando excessos, sem novos avisos, advertências ou tentativas de remoção. Reserva permanece após falha para evitar repetição incerta. Reinício não elimina cooldown persistente.

Bot, donos e administradores são protegidos; VIP comum segue a regra. Revalidar configuração, identidade, presença e bot ADM antes de efeitos. Sem bot ADM, excessos são bloqueados no fluxo sem tentar punições.

Apagar não adverte. Adv reutiliza `advertencias.js`, sua serialização, histórico e limite `/setlimiteadv`; no limite usa `aplicarBanAutomatico`, incluindo blacklist somente depois da confirmação e arquivo das advertências. Ban direto usa `removerDoGrupoConfirmado`, exige status 200 e não adiciona blacklist. Falhas não anunciam expulsão como sucesso. Falha de exclusão não duplica nem impede a ação permitida restante.

Em `bot.js`, antilink hard primeiro, antiflood depois, figurinhas em mensagens ainda não tratadas. Links tratados pelo hard contam quando a identidade ainda está disponível, porém suprimem a punição de flood e abrem seu cooldown se excedentes. Mensagens de flood não recebem outra sanção de figurinha/antilink básico e não chegam a comandos, jogos ou IA. Ranking existente ocorre antes do retorno de mensagens tratadas. Lembretes e o gate OFF permanecem na arquitetura existente.

Validação offline: `node scripts/teste-antiflood.js`, `node scripts/teste-on-off.js` e suites de advertências, antilinkhard, figurinhas, proteção do bot e loader. Nenhuma expulsão, conexão Mongo de produção ou sessão WhatsApp real nos testes. Sem deploy automático.
