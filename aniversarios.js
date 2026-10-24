const { criarRepositorio } = require('./dados/aniversarios-mongo')
const identidade = require('./dados/aniversarios-identidade')
const tempo = require('./dados/aniversarios-tempo')
const seguro = require('./dados/socket-seguro')
const estadoBot = require('./estado-bot')
const prazo = require('./dados/ads-prazo')
const GRUPO = /^\d+(?:-\d+)?@g\.us$/
function elegivel(sock, meta, jid) {
  if (meta?.id !== jid || !Array.isArray(meta.participants) || !meta.participants.length ||
      meta.isCommunity || meta.isCommunityAnnounce || meta.participants.some(p => !identidade.pessoa(p.id))) return false
  const idsBot = new Set([sock.user?.id, sock.user?.lid].map(identidade.pessoa).filter(Boolean))
  const bot = meta.participants.filter(p => [p.id, p.phoneNumber, p.lid].some(id => idsBot.has(identidade.pessoa(id))))
  if (bot.length !== 1 || (meta.announce !== undefined && typeof meta.announce !== 'boolean')) return false
  return !meta.announce || ['admin', 'superadmin'].includes(bot[0].admin)
}
function homenagem(alvo, mentions) {
  return {
    text: `📣 @Todos\n\n🏛️ *O OLIMPO CELEBRA UMA VIDA!*\n\n🎂 Hoje, as estrelas de Hipnos brilham para @${alvo.split('@')[0]}!\n\nQue Atena ilumine suas escolhas, Apolo aqueça os seus dias e Hermes abra caminhos para encontros felizes. Que Héstia reserve um lugar de paz, e que Hipnos cuide dos sonhos que você ainda está criando.\n\n🌙 Neste novo ciclo, que não faltem afeto, coragem e boas razões para sorrir. Seu lugar nesta história merece ser celebrado.\n\n✨ *Feliz aniversário! Que seus sonhos encontrem um belo caminho até a realidade.*`,
    mentions, contextInfo: { mentionedJid: mentions }
  }
}
function criarAgendador({ repo = criarRepositorio(), relogio = Date.now, intervalo = setInterval, cancelar = clearInterval,
  ligado = () => estadoBot.obterLigado(), limitar = prazo } = {}) {
  let socket = null, geracao = 0, timer = null, rodando = false, pendente = false
  const vivo = (sock, g) => socket === sock && geracao === g && seguro.exclusivoDisponivel(sock)
  async function verificar() {
    if (rodando) { pendente = true; return }
    if (!socket || !seguro.exclusivoDisponivel(socket)) return
    rodando = true
    const sock = socket, g = geracao
    try {
      if (await ligado() !== true || !vivo(sock, g)) return
      const hoje = tempo.calendario(relogio())
      const docs = (await repo.hoje(hoje)).filter(d => d.publico === true && tempo.ocorre(d, hoje))
      if (!docs.length || !vivo(sock, g)) return
      const grupos = await limitar(sock.groupFetchAllParticipating(), 30000)
      if (!grupos || typeof grupos !== 'object' || !vivo(sock, g)) return
      for (const jid of Object.keys(grupos).filter(jid => GRUPO.test(jid)).sort()) {
        if (!vivo(sock, g) || tempo.calendario(relogio()).chave !== hoje.chave) break
        try {
          const meta = await limitar(sock.groupMetadata(jid), 15000)
          if (!elegivel(sock, meta, jid)) continue
          const mapa = await limitar(identidade.membros(meta.participants), 30000)
          for (const doc of docs) {
            if (!mapa.has(doc._id) || !vivo(sock, g)) continue
            let reserva = null, invocado = false
            try {
              const atual = await repo.consultar(doc._id)
              if (!atual || atual.publico !== true || atual.revisao !== doc.revisao || !tempo.ocorre(atual, hoje)) continue
              reserva = await repo.reservar(doc._id, jid, hoje.ano, relogio())
              if (!reserva) continue
              // Consulta nova: não usar o snapshot de grupos para provar permanência.
              const fresco = await limitar(sock.groupMetadata(jid), 15000)
              if (!elegivel(sock, fresco, jid)) continue
              const membros = await limitar(identidade.membros(fresco.participants), 30000)
              const alvo = membros.get(doc._id)
              if (!alvo || await ligado() !== true) continue
              const final = await repo.consultar(doc._id)
              if (!final || final.publico !== true || final.revisao !== doc.revisao ||
                  !tempo.ocorre(final, hoje) || tempo.calendario(relogio()).chave !== hoje.chave || !vivo(sock, g)) continue
              const mentions = [...new Set(fresco.participants.map(p => identidade.pessoa(p.id)))]
              if (!mentions.includes(alvo)) continue
              // Reserva durável confirmada antes de invocar o transporte. Um resultado
              // incerto nunca é reenviado, nem por outro processo ou após reinício.
              invocado = true
              const r = await limitar(sock.sendMessage(jid, homenagem(alvo, mentions)), 60000)
              if (r?.key?.remoteJid && r.key.remoteJid !== jid) throw Error('ANIVERSARIO_RESULTADO_DIVERGENTE')
              await repo.concluir(reserva, r?.key?.id, relogio())
              console.info('[aniversarios]', { evento: 'envio_confirmado' })
            } catch (_) {
              console.warn('[aniversarios]', { evento: invocado ? 'envio_ou_confirmacao_incerta' : 'preparacao_adiada' })
            } finally {
              if (reserva && !invocado) await repo.liberar(reserva).catch(() => {})
            }
          }
        } catch (_) { console.warn('[aniversarios]', { evento: 'grupo_adiado' }) }
      }
    } catch (_) { console.warn('[aniversarios]', { evento: 'ciclo_adiado' }) }
    finally {
      rodando = false
      if (pendente) { pendente = false; queueMicrotask(() => verificar().catch(() => {})) }
    }
  }
  function abrir(sock) {
    if (socket !== sock) { socket = sock; geracao++ }
    if (!timer) { timer = intervalo(() => verificar().catch(() => {}), 60000); timer?.unref?.() }
    return verificar()
  }
  function fechar(sock) {
    if (sock && socket !== sock) return
    socket = null; geracao++; pendente = false
    if (timer) cancelar(timer)
    timer = null
  }
  return { abrir, fechar, parar: () => fechar(), verificar }
}
module.exports = { criarAgendador, agendador: criarAgendador(), elegivel, homenagem }
