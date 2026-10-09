// Identidade comprovada: não compara dígitos entre os namespaces PN e LID.
const { limparNumero, OWNER_NUMBERS } = require('../config')
const { ehLid, resolverNumeroAlvo } = require('../lid')
function identidade(jid) {
  if (!/@(?:lid|s\.whatsapp\.net)$/.test(String(jid || ''))) return ''
  return `${ehLid(jid) ? 'lid' : 'pn'}:${limparNumero(jid)}`
}
async function identificar(participantes, jid) {
  const chave = identidade(jid)
  if (!chave) return { participante: null, numero: null, admin: false, dono: false }
  const exatos = participantes.filter(p => [p.id, p.phoneNumber, p.lid && `${limparNumero(p.lid)}@lid`].some(id => identidade(id) === chave))
  // O Baileys também pode informar id=PN + lid em campo separado. Entregar
  // esse par comprovado ao helper existente, sem comparar dígitos de namespaces.
  const pares = exatos.map(p => ({
    ...p,
    id: ehLid(jid) && identidade(p.lid && `${limparNumero(p.lid)}@lid`) === chave ? jid : p.id,
    phoneNumber: p.phoneNumber || (identidade(p.id).startsWith('pn:') ? p.id : undefined)
  }))
  const numero = await resolverNumeroAlvo(pares, jid)
  const real = numero.via && numero.numero || null
  const encontrados = exatos.length ? exatos : real ? participantes.filter(p =>
    [p.id, p.phoneNumber].some(id => identidade(id) === `pn:${real}`)) : []
  // Identidade ambígua não autoriza comandos nem uma punição.
  const participante = encontrados.length === 1 ? encontrados[0] : null
  return { participante, numero: real, admin: participante?.admin === 'admin' || participante?.admin === 'superadmin', dono: Boolean(real && OWNER_NUMBERS.includes(real)) }
}

module.exports = { identificar, identidade }
