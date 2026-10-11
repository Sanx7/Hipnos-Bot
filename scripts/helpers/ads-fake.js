// Mongo operators used by ads, with synchronous atomic mutations and cloned reads.
const clone = v => structuredClone(v)
function match(doc, filtro) {
  return Object.entries(filtro).every(([k, v]) => {
    if (k === '$or') return v.some(f => match(doc, f))
    const atual = doc[k]
    if (v && typeof v === 'object' && !(v instanceof Date)) return Object.entries(v).every(([op, val]) => {
      if (op === '$lte') return atual <= val
      if (op === '$gt') return atual > val
      if (op === '$ne') return atual !== val
      throw new Error(`Operador não simulado: ${op}`)
    })
    return atual === v
  })
}
function colecao() {
  const docs = []
  return { docs,
    async insertOne(doc) { if (docs.some(d => d._id === doc._id)) throw Object.assign(new Error('Duplicado'), { code: 11000 }); docs.push(clone(doc)); return { insertedId: doc._id } },
    async findOne(f) { return clone(docs.find(d => match(d, f)) || null) },
    find(f) {
      let ordenacao, limite = Infinity
      return { sort(v) { ordenacao = v; return this }, limit(v) { limite = v; return this }, async toArray() {
        let encontrados = docs.filter(d => match(d, f)).map(clone)
        if (ordenacao) encontrados.sort((a,b) => { const [k, dir] = Object.entries(ordenacao)[0]; return (a[k] - b[k]) * dir })
        return encontrados.slice(0, limite)
      } }
    },
    async updateOne(f, u, op = {}) {
      let doc = docs.find(d => match(d, f))
      if (!doc && op.upsert) { doc = { _id: f._id }; docs.push(doc) }
      if (!doc) return { modifiedCount: 0 }
      Object.assign(doc, clone(u.$set || {}))
      for (const [k, v] of Object.entries(u.$inc || {})) doc[k] = (doc[k] || 0) + v
      for (const k of Object.keys(u.$unset || {})) delete doc[k]
      return { modifiedCount: 1 }
    },
    async deleteOne(f) { const i = docs.findIndex(d => match(d, f)); if (i < 0) return { deletedCount: 0 }; docs.splice(i, 1); return { deletedCount: 1 } }
  }
}
function criarStorage() {
  const arquivos = new Map(), ads = colecao(), controles = colecao()
  return { ads, controles, arquivos,
    async salvar(id, buf) { arquivos.set(id, Buffer.from(buf)) },
    async ler(id, limite) { const b = arquivos.get(id); if (!b || b.length > limite) throw new Error('Mídia ausente'); return Buffer.from(b) },
    async apagar(id) { arquivos.delete(id) }
  }
}
module.exports = { criarStorage, match }
