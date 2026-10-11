// Guardas compartilhadas por antiflood e limite de caracteres.
const { normalizeMessageContent } = require('@whiskeysockets/baileys')
const { identificar } = require('./identidade-participante')
const { ehProprioBot } = require('./protecao-bot')

function timestamp(valor) {
  const segundos = typeof valor?.toNumber === 'function' ? valor.toNumber() : Number(valor)
  return Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : NaN
}
function mensagemAtual(msg, tipo, agora = Date.now()) {
  const k = msg?.key, t = timestamp(msg?.messageTimestamp)
  if (tipo !== 'notify' || !k?.remoteJid?.endsWith('@g.us') || !k.id || !k.participant || k.fromMe || msg.messageStubType ||
      !Number.isFinite(t) || t < agora - 60000 || t > agora + 5000) return false
  const m = normalizeMessageContent(msg.message)
  return Boolean(m && ['conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'].some(k => m[k] != null))
}
async function alvoSeguro(sock, jid, sender) {
  const meta = await sock.groupMetadata(jid), ps = meta?.participants || []
  if (await ehProprioBot(sock, jid, sender, ps)) return null
  const alvo = await identificar(ps, sender)
  if (!alvo.numero || !alvo.participante || alvo.admin || alvo.dono) return null
  const dono = meta.owner && await identificar(ps, meta.owner)
  if (meta.owner && !dono?.numero) throw new Error('Dono do grupo não identificado')
  if (dono?.numero === alvo.numero) return null
  let botAdmin = false
  for (const p of ps.filter(p => ['admin', 'superadmin'].includes(p.admin))) {
    if (await ehProprioBot(sock, jid, p.id, ps)) { botAdmin = true; break }
  }
  const bot = await identificar(ps, sock.user?.id)
  return { ...alvo, botAdmin, autor: bot.numero }
}
module.exports = { timestamp, mensagemAtual, alvoSeguro }
