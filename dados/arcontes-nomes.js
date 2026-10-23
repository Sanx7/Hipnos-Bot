// Catálogo transitório exclusivo da apresentação do histórico. Nunca autoriza ações.
const estados = new WeakMap()
const MAX = 2000, TTL = 6 * 60 * 60 * 1000
function jid(valor, tipo) {
  if (typeof valor !== 'string') return null
  if (tipo && /^\d{1,20}$/.test(valor)) valor += `@${tipo}`
  const m = valor.match(/^(\d{1,20})(?::\d+)?@(s\.whatsapp\.net|lid)$/)
  return m ? `${m[1]}@${m[2]}` : null
}
function identidades(dado) {
  return [...new Set([jid(dado?.id), jid(dado?.phoneNumber, 's.whatsapp.net'), jid(dado?.lid, 'lid')].filter(Boolean))]
}
function campos(dado) {
  const r = {}
  for (const chave of ['id', 'lid', 'phoneNumber', 'name', 'notify', 'verifiedName', 'pushName']) {
    if (typeof dado?.[chave] === 'string') r[chave] = dado[chave].slice(0, 160)
  }
  return r
}
function acompanharSocket(sock, { agora = Date.now } = {}) {
  if (estados.has(sock) || typeof sock?.ev?.process !== 'function') return
  const cache = new Map()
  const estado = { cache, agora }; estados.set(sock, estado)
  function guardar(chave, dado) {
    const anterior = cache.get(chave)
    cache.delete(chave)
    cache.set(chave, { dado: { ...(anterior?.expira > agora() ? anterior.dado : {}), ...dado }, expira: agora() + TTL })
    if (cache.size > MAX) cache.delete(cache.keys().next().value)
  }
  function contatos(lista) {
    for (const c of (Array.isArray(lista) ? lista : []).slice(-MAX)) {
      const id = jid(c?.id)
      if (id) guardar(`c:${id}`, { ...campos(c), id })
    }
  }
  function mensagens(lista) {
    for (const m of (Array.isArray(lista) ? lista : []).slice(-MAX)) {
      if (m?.key?.fromMe || !m?.pushName) continue
      const grupo = m.key?.remoteJid, id = jid(m.key?.participant || grupo)
      if (id && typeof grupo === 'string') guardar(`p:${grupo}:${id}`, { id, grupo, pushName: String(m.pushName).slice(0, 160) })
    }
  }
  const remover = sock.ev.process(eventos => {
    try {
      contatos(eventos['contacts.upsert']); contatos(eventos['contacts.update'])
      contatos(eventos['messaging-history.set']?.contacts)
      mensagens(eventos['messages.upsert']?.messages)
      mensagens(eventos['messaging-history.set']?.messages)
      const par = eventos['lid-mapping.update'], pn = jid(par?.pn), lid = jid(par?.lid)
      if (pn?.endsWith('@s.whatsapp.net') && lid?.endsWith('@lid')) {
        // Conservar contradições: uma atualização conflitante não autoriza associação.
        guardar(`m:${pn}:${lid}`, { id: pn, lid })
      }
    } catch (_) { /* A observação acessória não interfere no Baileys e não imprime dados. */ }
  })
  sock.registerSocketEndHandler?.(() => {
    try { if (typeof remover === 'function') remover() } finally { cache.clear(); estados.delete(sock) }
  })
}
function disponiveis(sock, grupo) {
  const lista = [], estado = estados.get(sock)
  if (estado) for (const [chave, item] of estado.cache) {
    if (item.expira <= estado.agora()) { estado.cache.delete(chave); continue }
    if (!item.dado.grupo || item.dado.grupo === grupo) lista.push(item.dado)
  }
  for (const fonte of [sock.contacts, sock.store?.contacts]) {
    const entradas = fonte instanceof Map ? [...fonte.entries()].slice(-MAX) : Object.entries(fonte || {}).slice(-MAX)
    for (const [id, dado] of entradas) {
      if (!dado || typeof dado !== 'object') continue
      const chave = jid(id), declarado = jid(dado.id)
      // Nunca atribuir a um contato o nome de outra chave do mesmo namespace.
      if (chave && declarado && chave.split('@')[1] === declarado.split('@')[1] && chave !== declarado) continue
      lista.push({ ...campos(dado), id: declarado || chave })
    }
  }
  return lista
}
function criarResolvedorNomes(sock, grupo, participantes, limparNome) {
  const metadados = (participantes || []).map(p => ({ dado: p, meta: true }))
  const registros = [...metadados, ...disponiveis(sock, grupo).map(dado => ({ dado, meta: false }))]
  const paresPn = new Map(), paresLid = new Map(), indice = new Map(), nomes = new Map()
  function par(mapa, chave, valor) { if (!mapa.has(chave)) mapa.set(chave, new Set()); mapa.get(chave).add(valor) }
  for (const r of registros) {
    r.ids = identidades(r.dado)
    const pns = r.ids.filter(id => id.endsWith('@s.whatsapp.net')), lids = r.ids.filter(id => id.endsWith('@lid'))
    r.invalido = pns.length > 1 || lids.length > 1
    // Mesmo declarações contraditórias bloqueiam o uso de aliases, sem inventar pares.
    for (const pn of pns) for (const lid of lids) { par(paresPn, pn, lid); par(paresLid, lid, pn) }
    if (r.invalido) continue
    for (const id of r.ids) { if (!indice.has(id)) indice.set(id, []); indice.get(id).push(r) }
  }
  return numero => {
    if (nomes.has(numero)) return nomes.get(numero)
    const pn = jid(`${numero}@s.whatsapp.net`)
    let resultado = 'Participante não identificado'
    if (pn) {
      const diretos = indice.get(pn) || []
      const metas = diretos.filter(r => r.meta)
      if (metas.length <= 1) {
        const aliases = paresPn.get(pn)
        const lid = aliases?.size === 1 ? [...aliases][0] : null
        const confiavel = lid && paresLid.get(lid)?.size === 1 && (indice.get(lid) || []).filter(r => r.meta).length <= 1
        const candidatos = [...diretos, ...(confiavel ? indice.get(lid) || [] : [])].filter(r =>
          !jid(r.dado.id)?.endsWith('@lid') || (confiavel && r.ids.includes(lid)))
        // Nomes salvos têm prioridade; depois nomes de exibição e pushName.
        for (const campo of ['name', 'notify', 'verifiedName', 'pushName']) {
          const encontrado = candidatos.map(r => limparNome(r.dado[campo], '')).find(Boolean)
          if (encontrado) { resultado = encontrado; break }
        }
      }
    }
    nomes.set(numero, resultado)
    return resultado
  }
}
module.exports = { acompanharSocket, criarResolvedorNomes }
