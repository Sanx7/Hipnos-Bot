// Primitivas Mongo em memória, com unicidade de _id e falhas injetáveis.
const clone = structuredClone
function casa(doc, q) {
  return Object.entries(q).every(([k, v]) => {
    if (k === '$or') return v.some(q => casa(doc, q))
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(doc[k])
    return doc[k] === v
  })
}
module.exports = function criarBanco() {
  const colecoes = new Map(), opcoes = [], hooks = {}
  function collection(nome, opts) {
    opcoes.push({ nome, opts })
    if (colecoes.has(nome)) return colecoes.get(nome)
    const col = { docs: new Map(), indices: [], falhar: false, semConfirmacao: false }
    const checar = () => { if (col.falhar) throw Error('OFFLINE') }
    const resultado = extras => ({ acknowledged: !col.semConfirmacao, ...extras })
    col.createIndex = async (key, opts) => { checar(); col.indices.push({ key, opts }) }
    col.findOne = async q => {
      checar(); await hooks.antesLer?.(nome, q)
      return clone([...col.docs.values()].find(d => casa(d, q)) || null)
    }
    col.find = q => ({ async toArray() { checar(); return clone([...col.docs.values()].filter(d => casa(d, q))) } })
    col.insertOne = async doc => {
      checar(); await hooks.antesInserir?.(nome, doc)
      if (col.docs.has(doc._id)) throw Object.assign(Error('DUPLICADA'), { code: 11000 })
      col.docs.set(doc._id, clone(doc))
      await hooks.depoisInserir?.(nome, doc)
      return resultado({ insertedId: doc._id })
    }
    col.updateOne = async (q, u, opts = {}) => {
      checar(); await hooks.antesAtualizar?.(nome, q, u)
      let doc = [...col.docs.values()].find(d => casa(d, q))
      const existe = !!doc
      if (!doc && !opts.upsert) return resultado({ matchedCount: 0, modifiedCount: 0 })
      if (!doc) { if (col.docs.has(q._id)) throw Object.assign(Error('DUPLICADA'), { code: 11000 }); doc = { ...clone(q), ...clone(u.$setOnInsert || {}) } }
      Object.assign(doc, clone(u.$set || {}))
      col.docs.set(doc._id, doc)
      await hooks.depoisAtualizar?.(nome, q, u)
      return resultado({ matchedCount: existe ? 1 : 0, modifiedCount: existe ? 1 : 0, upsertedCount: existe ? 0 : 1 })
    }
    col.deleteOne = async q => {
      checar()
      const doc = [...col.docs.values()].find(d => casa(d, q))
      if (doc) col.docs.delete(doc._id)
      return resultado({ deletedCount: doc ? 1 : 0 })
    }
    colecoes.set(nome, col)
    return col
  }
  const banco = { collection }
  return { banco, colecoes, opcoes, hooks, usar: fn => fn({ perfis: collection('aniversariosHipnos'), entregas: collection('aniversariosEntregas') }) }
}
