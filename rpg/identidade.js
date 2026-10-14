// Camada local: não muda associações globais nem renomeia documentos.
const { identidade } = require('../dados/identidade-participante')
const { resolverLidParaTelefone } = require('../lid')
function erro(codigo) { return Object.assign(new Error(codigo), { codigo }) }
function normalizar(bruto) {
  const texto = String(bruto || '').trim()
  if (/^\d{10,15}$/.test(texto)) return { tipo: 'pn', numero: texto, jid: texto + '@s.whatsapp.net' }
  const m = /^(\d+)(?::\d+)?@(s\.whatsapp\.net|lid)$/.exec(texto)
  if (!m || (m[2] !== 'lid' && (m[1].length < 10 || m[1].length > 15))) throw erro('identidade_invalida')
  return { tipo: m[2] === 'lid' ? 'lid' : 'pn', numero: m[1], jid: m[1] + '@' + m[2] }
}
async function resolverIdentidade(bruto, participantes = []) {
  const entrada = normalizar(bruto)
  const chave = identidade(entrada.jid)
  const exatos = participantes.filter(p =>
    [p.id, p.phoneNumber, p.lid].filter(Boolean).some(id => {
      try { return identidade(normalizar(id === p.lid && /^\d+$/.test(id) ? id + '@lid' : id).jid) === chave } catch { return false }
    }))
  if (exatos.length > 1) throw erro('identidade_ambigua')
  const paresPn = new Set()
  const lids = new Set(entrada.tipo === 'lid' ? [entrada.jid] : [])
  for (const p of exatos) {
    for (const id of [p.id, p.phoneNumber, p.lid].filter(Boolean)) {
      const n = normalizar(id === p.lid && /^\d+$/.test(id) ? id + '@lid' : id)
      if (n.tipo === 'pn') paresPn.add(n.numero)
      else lids.add(n.jid)
    }
  }
  if (entrada.tipo === 'pn') paresPn.add(entrada.numero)
  for (const lid of lids) {
    const pn = await resolverLidParaTelefone(lid, { silencioso: true })
    if (pn) paresPn.add(normalizar(pn).numero)
  }
  if (!paresPn.size) throw erro('identidade_nao_comprovada')
  if (paresPn.size !== 1) throw erro('identidade_ambigua')
  const numero = [...paresPn][0]
  const canonico = numero + '@s.whatsapp.net'
  const aliases = [...new Set([numero, canonico, ...lids])]
  return Object.freeze({ numero, canonico, aliases: Object.freeze(aliases),
    filtro: { $or: [{ jid: { $in: aliases } }, { jid: { $regex: '^' + numero + ':\\d+@s\\.whatsapp\\.net$' } },
      ...[...lids].map(lid => ({ jid: { $regex: '^' + lid.split('@')[0] + ':\\d+@lid$' } }))] } })
}
async function participantesDoContexto(sock, jid) {
  if (!String(jid).endsWith('@g.us')) return []
  try { return (await sock.groupMetadata(jid)).participants || [] } catch { return [] }
}
module.exports = { normalizar, resolverIdentidade, participantesDoContexto, erro }
