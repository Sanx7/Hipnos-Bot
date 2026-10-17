// Banco em memória para isolamento AFK/migração, sem driver ou rede.
module.exports = function criarBanco() {
  const colecoes = new Map()
  function criarColecao() {
    const col = { docs: [], indices: [{ name: '_id_', key: { _id: 1 }, unique: true }], consultas: [], existe: false, falhar: false, embrulhar: false }
    const copiar = d => d ? structuredClone(d) : null
    const casa = (d, q) => Object.entries(q).every(([k, v]) => v && typeof v === 'object' && '$in' in v ? v.$in.includes(d[k]) : d[k] === v)
    const verificar = () => { if (col.falhar) throw new Error('Mongo offline') }
    col.createIndex = async (key, opts) => {
      verificar()
      const chaves = col.docs.map(d => JSON.stringify(Object.keys(key).map(k => d[k])))
      if (opts.unique && new Set(chaves).size !== chaves.length) throw Object.assign(new Error('Duplicados'), { code: 11000 })
      col.existe = true
      if (!col.indices.some(i => i.name === opts.name)) col.indices.push({ key: { ...key }, ...opts })
      return opts.name
    }
    col.listIndexes = () => ({ toArray: async () => { verificar(); return structuredClone(col.indices) } })
    col.countDocuments = async q => { verificar(); return col.docs.filter(d => casa(d, q)).length }
    col.updateOne = async (q, u, opts) => {
      verificar(); col.consultas.push({ operacao: 'update', filtro: structuredClone(q) })
      const doc = col.docs.find(d => casa(d, q))
      if (doc) { Object.assign(doc, structuredClone(u.$set)); return { matchedCount: 1 } }
      if (opts?.upsert) { col.existe = true; col.docs.push({ ...q, ...structuredClone(u.$set) }); return { upsertedCount: 1 } }
      return { matchedCount: 0 }
    }
    col.findOne = async q => { verificar(); col.consultas.push({ operacao: 'findOne', filtro: structuredClone(q) }); return copiar(col.docs.find(d => casa(d, q))) }
    col.find = q => ({ toArray: async () => { verificar(); col.consultas.push({ operacao: 'find', filtro: structuredClone(q) }); return col.docs.filter(d => casa(d, q)).map(copiar) } })
    col.findOneAndDelete = async q => {
      verificar(); col.consultas.push({ operacao: 'delete', filtro: structuredClone(q) })
      const indice = col.docs.findIndex(d => casa(d, q))
      const doc = indice < 0 ? null : col.docs.splice(indice, 1)[0]
      return col.embrulhar ? { value: copiar(doc) } : copiar(doc)
    }
    return col
  }
  return {
    colecoes,
    collection(nome) { if (!colecoes.has(nome)) colecoes.set(nome, criarColecao()); return colecoes.get(nome) },
    listCollections({ name }) { return { hasNext: async () => colecoes.get(name)?.existe === true } }
  }
}
