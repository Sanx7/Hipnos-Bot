// Somente memória. Implementa os filtros e as escritas usados pelo repositório real.
module.exports = function criarColecoes() {
  function colecao() {
    const docs = [], indices = []
    let seq = 0
    const copiar = d => d && structuredClone(d)
    const casa = (doc, filtro) => Object.entries(filtro).every(([k, v]) =>
      v && typeof v === 'object' && '$in' in v ? v.$in.includes(doc[k]) : v === null ? doc[k] == null : doc[k] === v)
    const api = {
      docs, indices,
      async createIndex(chave, opcoes) { indices.push({ chave, opcoes }) },
      async findOne(filtro) { return copiar(docs.find(d => casa(d, filtro))) || null },
      async updateOne(filtro, alteracao, opcoes = {}) {
        if (api.antesAtualizar) await api.antesAtualizar(filtro, alteracao)
        let doc = docs.find(d => casa(d, filtro)), novo = false
        if (!doc && opcoes.upsert) {
          doc = { ...filtro, ...alteracao.$setOnInsert, _id: filtro._id ?? `fake-${++seq}` }
          if (docs.some(d => d._id === doc._id || indices.some(i => i.opcoes?.unique &&
            Object.keys(i.chave).every(k => d[k] === doc[k])))) {
            throw Object.assign(new Error('DUPLICADO_OFFLINE'), { code: 11000 })
          }
          docs.push(doc); novo = true
        }
        if (doc) {
          Object.assign(doc, alteracao.$set)
          for (const key of Object.keys(alteracao.$currentDate || {})) doc[key] = new Date()
        }
        if (api.depoisAtualizar) await api.depoisAtualizar(filtro, alteracao)
        return { acknowledged: true, matchedCount: doc && !novo ? 1 : 0, upsertedCount: novo ? 1 : 0 }
      },
      find(filtro) {
        let lista = docs.filter(d => casa(d, filtro))
        return {
          sort(ordem) {
            lista.sort((a, b) => {
              for (const [key, sentido] of Object.entries(ordem)) {
                const delta = (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * sentido
                if (delta) return delta
              }
              return 0
            }); return this
          },
          skip(n) { lista = lista.slice(n); return this },
          limit(n) { lista = lista.slice(0, n); return this },
          async toArray() { return copiar(lista) }
        }
      }
    }
    return api
  }
  return { patentes: colecao(), eventos: colecao(), controles: colecao() }
}
