const { criarResolvedor } = require('./casamento-identidade')
const { normalizar } = require('../rpg/identidade')
function pessoa(jid) {
  if (typeof jid !== 'string' || !/@(?:s\.whatsapp\.net|lid)$/.test(jid)) return null
  try { return normalizar(jid).jid } catch { return null }
}
async function autor(sock, jid, msg, participantes) {
  const grupo = String(jid).endsWith('@g.us')
  if (msg?.key?.remoteJid !== jid) throw Error('ANIVERSARIO_IDENTIDADE')
  if (grupo && !participantes) {
    const meta = await sock.groupMetadata(jid)
    if (meta?.id !== jid || !Array.isArray(meta.participants)) throw Error('ANIVERSARIO_METADADOS')
    participantes = meta.participants
  }
  const bruto = pessoa(msg?.key?.participant || (!grupo && msg?.key?.remoteJid))
  if (!bruto) throw Error('ANIVERSARIO_IDENTIDADE')
  const resolvedor = criarResolvedor(participantes || [])
  const identidade = await resolvedor.buscar(bruto)
  if (!/^\d{10,15}$/.test(identidade.numero || '') || (grupo && !identidade.participante)) throw Error('ANIVERSARIO_IDENTIDADE')
  return { numero: identidade.numero, participantes: participantes || [] }
}
async function membros(participantes) {
  if (!Array.isArray(participantes) || !participantes.length || participantes.some(p => !pessoa(p.id))) throw Error('ANIVERSARIO_METADADOS')
  const resolvedor = criarResolvedor(participantes), pessoas = []
  for (const p of participantes) pessoas.push(await resolvedor.buscar(pessoa(p.id)))
  const mapa = new Map()
  for (const p of pessoas.map(resolvedor.conferir)) {
    if (p.numero && p.participante && /^\d{10,15}$/.test(p.numero)) mapa.set(p.numero, pessoa(p.participante.id))
  }
  return mapa
}
module.exports = { pessoa, autor, membros }
