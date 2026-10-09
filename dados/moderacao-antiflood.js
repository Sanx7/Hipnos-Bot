const { normalizeMessageContent } = require('@whiskeysockets/baileys')
const config = require('./antiflood-config')
const { identificar } = require('./identidade-participante')
const { ehProprioBot } = require('./protecao-bot')
const { removerDoGrupoConfirmado } = require('../comandos/admin/ban')
const advertencias = require('../advertencias')
const adv = require('../comandos/admin/adv')
const filas = new Map(), contadores = new Map(), vistas = new Map()
const MAX = 10000
let relogio = () => Date.now()
function limpar() {
  const agora = relogio()
  for (const [k, v] of contadores) if (v.expira <= agora) contadores.delete(k)
  for (const [k, v] of vistas) if (!v.ativo && v.expira <= agora) vistas.delete(k)
}
const limpeza = setInterval(limpar, 30000)
limpeza.unref()
function timestamp(valor) {
  const segundos = typeof valor?.toNumber === 'function' ? valor.toNumber() : Number(valor)
  return Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : NaN
}
function real(msg, tipo) {
  const k = msg?.key, t = timestamp(msg?.messageTimestamp), agora = relogio()
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
async function tratar(sock, msg, prioridade) {
  const { remoteJid: jid, participant: sender, id } = msg.key
  let cfg, alvo
  try { cfg = await config.obter(jid); if (!cfg.ativo) return false; alvo = await alvoSeguro(sock, jid, sender) }
  catch (e) { console.warn('[antiflood] Configuração/identidade indisponível; fluxo preservado.'); return false }
  if (!alvo) return false
  limpar()
  const chave = `${jid}:${alvo.numero}`, agora = relogio(), t = timestamp(msg.messageTimestamp)
  if (!contadores.has(chave) && contadores.size >= MAX) return false
  if (t < agora - 60000 || t > agora + 5000) return false
  const item = contadores.get(chave) || { tempos: [] }
  // Ordenar também suporta pequenos atrasos na entrega; limitar a 31 amostras
  // basta para qualquer limite permitido, sem guardar a rajada inteira.
  item.tempos = [...item.tempos.filter(x => x > agora - cfg.janela * 1000), Math.min(t, agora)].sort((a,b) => a-b).slice(-31)
  item.expira = agora + 60000
  contadores.set(chave, item)
  if (item.tempos.filter(x => x > agora - cfg.janela * 1000).length <= cfg.limite) return false
  // Link já julgado pelo hard participa da contagem, mas não recebe outra sanção.
  if (prioridade) { await config.cooldown(jid, alvo.numero, agora); return true }
  const validar = async () => {
    const atualConfig = await config.obter(jid)
    const atual = await alvoSeguro(sock, jid, sender)
    if (!atualConfig.ativo || atualConfig.acao !== cfg.acao || !atual || !atual.botAdmin || atual.numero !== alvo.numero || atual.participante.id !== alvo.participante.id) throw new Error('Punição não autorizada')
    return atual
  }
  if (!alvo.botAdmin) return true
  if (!await config.reservar(jid, id)) return true
  await validar()
  const primeira = await config.cooldown(jid, alvo.numero, agora)
  await validar()
  try { await sock.sendMessage(jid, { delete: { ...msg.key, fromMe: false } }) }
  catch (_) { console.warn('[antiflood] Exclusão não confirmada.') }
  if (!primeira || cfg.acao === 'apagar') return true
  if (cfg.acao === 'ban') {
    await removerDoGrupoConfirmado(sock, jid, alvo.participante.id, { validar })
    await sock.sendMessage(jid, { text: '🌙 *HIPNOS — GUARDIÃO DO SILÊNCIO*\n\n⚠️ Infração: Flood.\n💀 Punição: Expulsão confirmada.\n\n🌑 Até os deuses apreciam o silêncio.' })
    return true
  }
  await advertencias.comAdvertenciasSerializadas(alvo.numero, jid, async () => {
    const atual = await validar()
    if (!atual.autor) throw new Error('Hipnos não identificado')
    const resultado = await advertencias.criarAdvertencia({ numero: alvo.numero, grupoId: jid, motivo: 'Flood: excesso de mensagens', aplicadoPor: atual.autor })
    if (resultado.total >= resultado.limite) {
      await adv.aplicarBanAutomatico(sock, jid, msg, atual.participante.id, atual.numero, atual.autor, { limite: resultado.limite, validar })
    } else {
      await sock.sendMessage(jid, { text: `🌙 *HIPNOS — GUARDIÃO DO SILÊNCIO*\n\n💤 Mortal, suas mensagens perturbam o descanso deste reino.\n\n⚠️ Infração: Flood.\n📜 Punição: Advertência.\n🔱 Advertências: ${resultado.total}/${resultado.limite}.\n\n🌑 Até os deuses apreciam o silêncio.` }, { quoted: msg })
    }
  })
  return true
}
async function processar(sock, msg, tipo = 'notify', prioridade = false) {
  if (!real(msg, tipo)) return false
  limpar()
  const jid = msg.key.remoteJid, chave = `${jid}:${msg.key.id}`
  if (vistas.has(chave)) return vistas.get(chave).promise
  if (vistas.size >= MAX || filas.size >= MAX) return false
  const anterior = filas.get(jid) || Promise.resolve()
  const promise = anterior.catch(() => {}).then(() => tratar(sock, msg, prioridade)).catch(e => {
    console.warn('[antiflood] Operação incompleta:', e.message)
    // Uma falha parcial não deixa o evento virar comando nem repete efeitos.
    return true
  })
  filas.set(jid, promise)
  const visto = { promise, ativo: true, expira: relogio() + 120000 }
  vistas.set(chave, visto)
  promise.finally(() => { visto.ativo = false; visto.expira = relogio() + 120000; if (filas.get(jid) === promise) filas.delete(jid) })
  return promise
}
async function processarLote(sock, mensagens = [], tipo, prioridade = new Set()) {
  const tratadas = new Set()
  for (const msg of mensagens) {
    const chave = `${msg?.key?.remoteJid}:${msg?.key?.id}`
    if (await processar(sock, msg, tipo ?? 'desconhecido', prioridade.has(chave))) tratadas.add(chave)
  }
  return tratadas
}
module.exports = { processar, processarLote, timestamp, __limparTeste(agora) { contadores.clear(); vistas.clear(); filas.clear(); relogio = agora || (() => Date.now()) } }
