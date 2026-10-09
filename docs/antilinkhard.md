# Antilink hard

`/antilinkhard on`, `/antilinkhard off` e `/antilinkhard status` funcionam somente
em grupos, para ADM, dono do grupo ou dono do bot. Aliases: `/antilink-hard` e
`/antilinkban`. O roteador e os exemplos usam o prefixo existente. Durante OFF,
somente donos do bot atravessam a barreira interativa; a moderação continua.

## Integração

O comando `/antilink` e seu JSON não foram alterados. Seu detector original foi
extraído para `temLinkBasico`, mantendo a mesma expressão e o mesmo escopo de
texto. O hard usa essa identificação básica e valida URLs/domínios, ampliando
a detecção para domínios sem esquema, convites WhatsApp e legendas de mídia.
Usa `tldts` 6.1.86, já instalado indiretamente e agora declarado como dependência
direta. A lista de sufixos reconhecidos é a embarcada nessa versão:
https://github.com/remusao/tldts

O hard processa o lote antes das outras proteções e retorna as chaves tratadas.
O handler evita que essas mensagens sejam punidas novamente pelo antilink simples
ou pela moderação de figurinhas. Hard desativado preserva o fluxo original.
Hard e antilink simples possuem configurações independentes; desativar um não
altera o outro. Quem está protegido é isento de exclusão e expulsão pelo hard.

Somente texto/legenda da mensagem atual é examinado, com normalização de mensagens
temporárias e envelopes Baileys. Não lê a mídia citada, não baixa mídia, não busca
URLs, não revela nem reenvia conteúdo de visualização única. Emails e endereços
incompletos são ignorados. IPv4 completo com HTTP/HTTPS é aceito; IP solto não.

## Expulsão

Identidades são comprovadas pelos helpers JID/LID existentes. Bot, dono do bot,
dono do grupo e administradores são protegidos; ausência/falha de identificação
ou ausência do bot como ADM impede efeitos. O hard apaga a mensagem infratora e
revalida configuração, identidade, participação e permissões antes de remover.

`removerDoGrupoConfirmado`, extraído da rotina de banimento usada por advertências,
confere explicitamente uma resposta com status 200. O hard usa essa parte da
rotina, sem blacklist e sem escrever em advertências. Só anuncia após a confirmação
do WhatsApp e o registro da ocorrência no MongoDB. Falhas ficam registradas,
sem anúncio de sucesso ou repetição automática do evento.

## MongoDB e concorrência

As novas coleções ficam no banco `MONGODB_DB` (padrão `whatsapp`):

- `configAntilinkHard`: `_id` do grupo, `ativo`, autor e data da alteração.
  Sem documento, fica desativado. Configurações não expiram.
- `ocorrenciasAntilinkHard`: reserva única por grupo/mensagem, estado e resultado
  da exclusão. Retenção de sete dias com índice TTL.
- `travasAntilinkHard`: reserva única por grupo/telefone comprovado, com token e
  estado. Retenção de dez minutos com índice TTL, cobrindo concorrência e resultados
  de transporte incertos, inclusive entre processos.

Nova mensagem durante a trava pode ser apagada, mas não inicia outra expulsão.
Caches em memória têm no máximo 1.000 entradas; operações em andamento não são
descartadas para admitir novas punições. Configuração em cache dura 30 segundos;
antes de remover, a configuração é relida diretamente do MongoDB.

## Limitações e validação

Os testes são offline, com sockets, coleções e handler real de mensagens sob mocks.
Não verificam WhatsApp físico, MongoDB de produção ou Render. Configuração é
persistente no MongoDB; nenhum deploy ou migração de dados existentes foi feito.

A detecção usa sintaxe e sufixos conhecidos, sem verificar existência do domínio.
Um texto que forma um domínio válido pode ser interpretado como link mesmo sem
intenção de navegação. Links ofuscados, QR codes, conteúdo visual e URLs IPv6 não
são analisados. Novos sufixos dependem de atualizar a dependência.

A limpeza TTL do MongoDB é assíncrona: travas podem durar mais de dez minutos.
Durante esse período, uma nova entrada do mesmo usuário não gera outra expulsão.
Eventos são deduplicados por sete dias. WhatsApp e MongoDB não têm transação conjunta;
falha após remoção aceita pode impedir o anúncio, mas preserva a reserva para evitar
repetição. Falha do MongoDB impede nova punição hard; o antilink simples continua
sujeito à sua configuração original. Mudanças entre instâncias podem levar até
30 segundos para aparecer na detecção inicial, mas são revalidadas antes da remoção.

## Arquivos

Criados: `comandos/admin/antilinkhard.js`, `dados/antilinkhard-config.js`,
`dados/moderacao-antilinkhard.js`, `dados/deteccao-links.js`,
`scripts/teste-antilinkhard.js` e este documento.

Modificados: `bot.js`, `comandos/admin/ban.js`, `comandos/admin/menu-admin.js`,
`package.json`, `package-lock.json`, `scripts/teste-loader.js`,
`scripts/teste-on-off.js`, `scripts/teste-protecao-bot.js` e
`scripts/teste-moderacao-figurinhas.js` (ajuste de uma expectativa à mensagem atual).
