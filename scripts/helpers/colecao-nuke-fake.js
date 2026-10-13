// MongoDB em memória, incluindo filtro atômico e chave _id única.
module.exports = function criarColecao() {
  const docs = new Map()
  function casa(doc, filtro) {
    return Object.entries(filtro).every(([k, v]) => {
      if (k === '$or') return v.some(f => casa(doc, f))
      if (v && typeof v === 'object') {
        if ('$in' in v) return v.$in.includes(doc[k])
        if ('$gt' in v) return doc[k] > v.$gt
        if ('$lte' in v) return doc[k] <= v.$lte
      }
      return doc[k] === v
    })
  }
  const col = {
    docs, falhar: false,
    async findOne(filtro) {
      if (col.falhar) throw new Error('Mongo offline')
      const doc = [...docs.values()].find(d => casa(d, filtro))
      return doc ? structuredClone(doc) : null
    },
    async updateOne(filtro, mudanca, opcoes) {
      if (col.falhar) throw new Error('Mongo offline')
      const doc = [...docs.values()].find(d => casa(d, filtro))
      if (doc) {
        Object.assign(doc, structuredClone(mudanca.$set))
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 }
      }
      if (opcoes?.upsert) {
        if (docs.has(filtro._id)) throw Object.assign(new Error('duplicado'), { code: 11000 })
        docs.set(filtro._id, { _id: filtro._id, ...structuredClone(mudanca.$setOnInsert || {}), ...structuredClone(mudanca.$set) })
        return { acknowledged: true, upsertedCount: 1 }
      }
      return { acknowledged: true, matchedCount: 0 }
    }
  }
  return col
}
