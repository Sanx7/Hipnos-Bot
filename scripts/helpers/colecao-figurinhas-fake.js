// Coleção em memória; mesmos métodos do driver usados pelas regras/advertências.
module.exports = function colecaoFake() {
  const docs = []
  let leituras = 0, seq = 0
  const casa = (doc, filtro) => Object.entries(filtro).every(([k, v]) => v && typeof v === 'object' && '$in' in v ? v.$in.includes(doc[k]) : doc[k] === v)
  const api = {
    docs, get leituras() { return leituras }, falhar: false,
    async findOne(filtro) { if (api.falhar) throw new Error('Mongo offline'); leituras++; return docs.find(d => casa(d, filtro)) || null },
    async findOneAndUpdate(filtro, mudanca, opcoes) {
      if (api.falhar) throw new Error('Mongo offline')
      const antigo = docs.find(d => casa(d, filtro))
      const antes = antigo ? { ...antigo } : null
      if (antigo) Object.assign(antigo, mudanca.$set)
      else if (opcoes?.upsert) docs.push({ ...filtro, ...mudanca.$set })
      return antes
    },
    async updateOne(filtro, mudanca, opcoes) {
      if (api.falhar) throw new Error('Mongo offline')
      const antigo = docs.find(d => casa(d, filtro))
      if (antigo) { Object.assign(antigo, mudanca.$set); return { upsertedCount: 0 } }
      if (opcoes?.upsert) { docs.push({ ...filtro, ...mudanca.$setOnInsert, ...mudanca.$set }); return { upsertedCount: 1 } }
      return { upsertedCount: 0 }
    },
    async deleteOne(filtro) {
      if (api.falhar) throw new Error('Mongo offline')
      const i = docs.findIndex(d => casa(d, filtro))
      if (i < 0) return { deletedCount: 0 }
      docs.splice(i, 1); return { deletedCount: 1 }
    },
    find(filtro) {
      if (api.falhar) throw new Error('Mongo offline')
      leituras++
      let encontrados = docs.filter(d => casa(d, filtro))
      return {
        sort(spec) { const [k, ordem] = Object.entries(spec)[0]; encontrados.sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * ordem); return this },
        skip(n) { encontrados = encontrados.slice(n); return this },
        limit(n) { encontrados = encontrados.slice(0, n); return this },
        async toArray() { return encontrados.map(d => ({ ...d })) }
      }
    },
    async insertOne(doc) { if (api.falhar) throw new Error('Mongo offline'); const id = doc._id ?? ++seq; if (docs.some(d => d._id === id)) { const e = new Error('duplicado'); e.code = 11000; throw e }; docs.push({ ...doc, _id: id }); return { insertedId: id } },
    async countDocuments(filtro) { if (api.falhar) throw new Error('Mongo offline'); return docs.filter(d => casa(d, filtro)).length },
    async updateMany(filtro, mudanca) { if (api.falhar) throw new Error('Mongo offline'); let n = 0; for (const d of docs) if (casa(d, filtro)) { Object.assign(d, mudanca.$set); n++ } return { modifiedCount: n } }
  }
  return api
}
