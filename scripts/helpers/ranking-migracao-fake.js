// Mongo fictício: snapshots, rollback, unicidade e falhas injetáveis. Nunca abre rede.
const { BSON } = require('mongodb')
const { registrarContexto } = require('./ranking-migracao-segura')
const clone = v => v === undefined ? undefined : BSON.deserialize(BSON.serialize({ v })).v
const igual = (a, b) => BSON.serialize({ v: a }).equals(BSON.serialize({ v: b }))
const ler = (d, k) => k.split('.').reduce((o, p) => o?.[p], d)
function set(d, k, v) { const partes = k.split('.'), ultimo = partes.pop(); let alvo = d; for (const p of partes) alvo = alvo[p] ||= {}; alvo[ultimo] = clone(v) }
function casa(d, q) {
  return Object.entries(q).every(([k, v]) => {
    if (k === '$expr') return igual(d, v.$eq[1].$literal)
    const valor = ler(d, k)
    if (v && typeof v === 'object' && '$exists' in v) return (valor !== undefined) === v.$exists
    if (v && typeof v === 'object' && '$regex' in v) return new RegExp(v.$regex).test(String(valor || ''))
    return igual(valor, v)
  })
}
module.exports = function criarFake(docs = [], recibos = []) {
  const mapas = { ranking: new Map(docs.map(d => [String(d._id), clone(d)])), diario: new Map(recibos.map(d => [String(d._id), clone(d)])) }
  const fake = { hooks: {}, semTransacoes: false, sessoesEncerradas: 0, chamadas: [] }
  const foto = () => Object.fromEntries(Object.entries(mapas).map(([n, m]) => [n, clone([...m.entries()])]))
  async function evento(etapa, dados) { fake.chamadas.push(etapa); await fake.hooks[etapa]?.(dados) }
  function tabela(nome, opts) { return opts?.session?.mapas?.[nome] || mapas[nome] }
  function unico(nome, tab, doc, ignorar) {
    for (const [id, outro] of tab) {
      if (id === ignorar) continue
      if (igual(outro._id, doc._id) || (nome === 'ranking' && outro.grupo_id === doc.grupo_id && outro.usuario_id === doc.usuario_id)) {
        throw Object.assign(Error('DUPLICADA'), { code: 11000 })
      }
    }
  }
  function colecao(nome) {
    const col = { _docs: mapas[nome], semConfirmacao: false }
    col.findOne = async (q, opts) => {
      await evento(nome+'.antesLer', { q, opts })
      return clone([...tabela(nome, opts).values()].find(d => casa(d, q)) || null)
    }
    col.find = q => ({ toArray: async () => clone([...mapas[nome].values()].filter(d => casa(d, q))) })
    col.insertOne = async (doc, opts) => {
      await evento(nome+'.antesInserir', { doc, opts })
      const tab = tabela(nome, opts); unico(nome, tab, doc)
      tab.set(String(doc._id), clone(doc))
      await evento(nome+'.depoisInserir', { doc, opts })
      return { acknowledged: !col.semConfirmacao, insertedId: doc._id }
    }
    col.updateOne = async (q, u, opts) => {
      await evento(nome+'.antesAtualizar', { q, u, opts })
      const tab = tabela(nome, opts), doc = [...tab.values()].find(d => casa(d, q))
      if (!doc) return { acknowledged: !col.semConfirmacao, matchedCount: 0 }
      const novo = clone(doc)
      for (const [k, v] of Object.entries(u.$set || {})) set(novo, k, v)
      for (const [k, v] of Object.entries(u.$inc || {})) set(novo, k, (ler(novo, k) || 0) + v)
      for (const [k, v] of Object.entries(u.$max || {})) set(novo, k, Math.max(ler(novo, k) || 0, v))
      unico(nome, tab, novo, String(doc._id))
      // Também modelar uma inserção concorrente contra o índice único real.
      if (opts?.session) unico(nome, mapas[nome], novo, String(doc._id))
      tab.set(String(doc._id), novo)
      await evento(nome+'.depoisAtualizar', { q, u, opts })
      return { acknowledged: !col.semConfirmacao, matchedCount: 1, modifiedCount: 1 }
    }
    col.deleteOne = async (q, opts) => {
      await evento(nome+'.antesExcluir', { q, opts })
      const tab = tabela(nome, opts), doc = [...tab.values()].find(d => casa(d, q))
      if (doc) tab.delete(String(doc._id))
      await evento(nome+'.depoisExcluir', { q, opts })
      return { acknowledged: !col.semConfirmacao, deletedCount: doc ? 1 : 0 }
    }
    return col
  }
  fake.ranking = colecao('ranking'); fake.diario = colecao('diario')
  fake.cliente = { startSession() {
    const session = { mapas: null,
      async withTransaction(fn, opts) {
        if (fake.semTransacoes) throw Object.assign(Error('TRANSACOES_INDISPONIVEIS'), { code: 20 })
        if (opts.readConcern.level !== 'snapshot' || opts.writeConcern.w !== 'majority') throw Error('CONCERNS_AUSENTES')
        for (let tentativa = 0; tentativa < 5; tentativa++) {
          const base = foto()
          session.mapas = Object.fromEntries(Object.entries(base).map(([n, pares]) => [n, new Map(clone(pares))]))
          try {
            const r = await fn()
            await evento('antesCommit', { session })
            if (!igual(foto(), base)) throw Object.assign(Error('CONFLITO'), { hasErrorLabel: l => l === 'TransientTransactionError' })
            for (const [n, tab] of Object.entries(session.mapas)) { mapas[n].clear(); for (const [id, d] of tab) mapas[n].set(id, clone(d)) }
            session.mapas = null
            await evento('depoisCommit', { session })
            return r
          } catch (e) {
            session.mapas = null
            if (e.hasErrorLabel?.('TransientTransactionError') && tentativa < 4) continue
            throw e
          }
        }
      },
      async endSession() { session.mapas = null; fake.sessoesEncerradas++ }
    }
    return session
  } }
  registrarContexto(fake.ranking, { cliente: fake.cliente, diario: fake.diario })
  return fake
}
