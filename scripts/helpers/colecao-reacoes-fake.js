// Collection offline com snapshots e comparação de versão, sem MongoDB real.
module.exports = function criarColecao() {
  const docs = new Map()
  const api = {
    docs, leituras: 0, escritas: 0, falhar: false,
    async findOne(filtro) {
      if (api.falhar) throw new Error('Banco offline')
      api.leituras++
      return structuredClone(docs.get(filtro.grupo_id) || null)
    },
    async updateOne(filtro, mudanca, opcoes) {
      if (api.falhar) throw new Error('Banco offline')
      const doc = docs.get(filtro.grupo_id)
      const casa = doc && Object.entries(filtro).every(([campo, valor]) =>
        valor && typeof valor === 'object' && '$exists' in valor ? Object.hasOwn(doc, campo) === valor.$exists : doc[campo] === valor)
      if (casa) {
        api.escritas++
        Object.assign(doc, structuredClone(mudanca.$set || {}))
        return { matchedCount: 1, modifiedCount: 1 }
      }
      if (opcoes?.upsert) {
        if (doc) throw Object.assign(new Error('Duplicado'), { code: 11000 })
        api.escritas++
        docs.set(filtro.grupo_id, { ...filtro, ...structuredClone(mudanca.$setOnInsert || {}), ...structuredClone(mudanca.$set || {}) })
        return { matchedCount: 0, upsertedCount: 1 }
      }
      return { matchedCount: 0, modifiedCount: 0 }
    }
  }
  return api
}
