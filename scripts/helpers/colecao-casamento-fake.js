// Modelo offline das primitivas utilizadas, não substitui um MongoDB real.
module.exports = function criarColecao() {
  const col = { docs: [], indices: [], agora: new Date('2026-10-21T21:00:00Z'), falhar: false,
    falharIndice: false, semConfirmacao: false, falharAposEscrever: false }
  const copiar = v => structuredClone(v)
  const ler = (doc, caminho) => caminho.split('.').reduce((v, k) => v?.[k], doc)
  function definir(doc, caminho, valor) {
    const partes = caminho.split('.'), ultima = partes.pop()
    let alvo = doc
    for (const parte of partes) alvo = alvo[parte] ||= {}
    alvo[ultima] = valor
  }
  function verificar() { if (col.falhar) throw new Error('offline') }
  function expr(v, doc) {
    if (v === '$$NOW') return copiar(col.agora)
    if (v === '$$ROOT') return copiar(doc)
    if (typeof v === 'string' && v.startsWith('$')) return ler(doc, v.slice(1))
    if (!v || typeof v !== 'object' || v instanceof Date) return v
    if (Array.isArray(v)) return v.map(x => expr(x, doc))
    if ('$literal' in v) return copiar(v.$literal)
    if ('$type' in v) return expr(v.$type, doc) === undefined ? 'missing' : 'present'
    if ('$eq' in v) { const [a, b] = expr(v.$eq, doc); return a === b }
    if ('$gt' in v) { const [a, b] = expr(v.$gt, doc); return a > b }
    if ('$lte' in v) { const [a, b] = expr(v.$lte, doc); return a <= b }
    if ('$gte' in v) { const [a, b] = expr(v.$gte, doc); return a >= b }
    if ('$cond' in v) return expr(v.$cond[expr(v.$cond[0], doc) ? 1 : 2], doc)
    if ('$mergeObjects' in v) return Object.assign({}, ...v.$mergeObjects.map(x => expr(x, doc)))
    if ('$add' in v) {
      const [a, b] = expr(v.$add, doc)
      return a instanceof Date ? new Date(+a + b) : a + b
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expr(x, doc)]))
  }
  function casa(doc, filtro) {
    return Object.entries(filtro).every(([k, v]) => {
      if (k === '$expr') return expr(v, doc)
      const valor = ler(doc, k)
      const valores = Array.isArray(valor) ? valor : [valor]
      if (v && typeof v === 'object' && '$in' in v) return valores.some(x => v.$in.includes(x))
      if (v && typeof v === 'object' && '$ne' in v) return !valores.includes(v.$ne)
      if (v && typeof v === 'object' && '$exists' in v) return (valor !== undefined) === v.$exists
      return valores.includes(v)
    })
  }
  function salvar(doc) {
    const outros = col.docs.filter(d => d._id !== doc._id)
    if (doc.bloqueiaParticipantes && col.indices.some(i => i.unique && i.key.participantes)) {
      if (outros.some(d => d.bloqueiaParticipantes && d.participantes.some(n => doc.participantes.includes(n)))) {
        throw Object.assign(new Error('duplicate key'), { code: 11000 })
      }
    }
    const i = col.docs.findIndex(d => d._id === doc._id)
    if (i < 0) col.docs.push(copiar(doc)); else col.docs[i] = copiar(doc)
  }
  col.createIndex = async (key, opts) => {
    verificar()
    if (col.falharIndice) throw new Error('indice indisponivel')
    col.indices.push({ key: copiar(key), ...copiar(opts) })
  }
  col.findOne = async q => { verificar(); return copiar(col.docs.find(d => casa(d, q)) || null) }
  col.updateOne = async (q, u, opts) => {
    verificar()
    const anterior = col.docs.find(d => casa(d, q))
    if (!anterior && !opts?.upsert) return { acknowledged: !col.semConfirmacao, matchedCount: 0 }
    let doc = copiar(anterior || { _id: q._id })
    if (Array.isArray(u)) {
      for (const etapa of u) {
        if (etapa.$replaceWith) doc = expr(etapa.$replaceWith, doc)
        else for (const [chave, valor] of Object.entries(expr(etapa.$set, doc))) definir(doc, chave, valor)
      }
    } else if (!anterior) Object.assign(doc, copiar(u.$setOnInsert))
    salvar(doc)
    if (col.falharAposEscrever) throw new Error('resultado desconhecido')
    return { acknowledged: !col.semConfirmacao, matchedCount: anterior ? 1 : 0, upsertedCount: anterior ? 0 : 1 }
  }
  col.updateMany = async (q, u) => {
    verificar()
    let count = 0
    for (const doc of [...col.docs]) if (casa(doc, q)) {
      await col.updateOne({ _id: doc._id, ...q }, u); count++
    }
    return { acknowledged: !col.semConfirmacao, matchedCount: count }
  }
  col.aggregate = pipeline => ({ async toArray() {
    verificar()
    let docs = col.docs.map(copiar)
    for (const etapa of pipeline) {
      if (etapa.$match) docs = docs.filter(d => casa(d, etapa.$match))
      if (etapa.$set) docs = docs.map(d => ({ ...d, ...expr(etapa.$set, d) }))
    }
    return docs
  } })
  return col
}
