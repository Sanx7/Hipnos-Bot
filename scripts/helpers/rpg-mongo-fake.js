// MVCC offline: snapshots isolados, conflitos no commit, índices únicos,
// rollback e cópias profundas. Não arredonda $inc nem compartilha objetos.
const clone = x => x == null ? x : structuredClone(x)
function casa(doc, filtro) {
  return Object.entries(filtro).every(([k, v]) => {
    if (k === '$or') return v.some(f => casa(doc, f))
    if (v && typeof v === 'object') {
      if ('$in' in v) return v.$in.includes(doc[k])
      if ('$regex' in v) return new RegExp(v.$regex).test(doc[k] || '')
      if ('$gte' in v) return doc[k] >= v.$gte
    }
    return doc[k] === v
  })
}
function falha(codigo, mensagem = 'falha simulada') {
  return Object.assign(new Error(mensagem), { code: codigo })
}
function criarMongoFake() {
  const estado = { jogadores: new Map(), operacoes: new Map() }
  const versoes = { jogadores: new Map(), operacoes: new Map() }
  let sequencia = 0
  const mongo = { estado, versoes, hooks: {}, falhaCommit: null, semTransacoes: false }
  function tabela(nome, options = {}) {
    const session = options.session
    if (session && mongo.semTransacoes) throw falha(20, 'Transaction numbers are only allowed on a replica set')
    if (session && !session.ativa) throw new Error('sessão inativa')
    return session ? session.snapshot[nome] : estado[nome]
  }
  function marcar(nome, id, options) {
    if (options?.session) options.session.escritas[nome].add(id)
    else versoes[nome].set(id, (versoes[nome].get(id) || 0) + 1)
  }
  function unica(nome, tab, doc, id) {
    if (tab.has(id)) throw falha(11000)
    if (nome === 'jogadores' && [...tab.values()].some(p => p.jid === doc.jid)) throw falha(11000)
  }
  function colecao(nome) {
    return {
      find(filtro = {}, options = {}) {
        let limite = Infinity
        return {
          limit(n) { limite = n; return this },
          async toArray() { return [...tabela(nome, options).values()].filter(d => casa(d, filtro)).slice(0, limite).map(clone) }
        }
      },
      async findOne(filtro, options = {}) {
        return clone([...tabela(nome, options).values()].find(d => casa(d, filtro)) || null)
      },
      async countDocuments(filtro = {}) { return [...estado[nome].values()].filter(d => casa(d, filtro)).length },
      async insertOne(doc, options = {}) {
        const tab = tabela(nome, options)
        const novo = clone({ ...doc, _id: doc._id || nome + ':' + ++sequencia })
        unica(nome, tab, novo, novo._id)
        tab.set(novo._id, novo)
        marcar(nome, novo._id, options)
        return { acknowledged: true, insertedId: novo._id }
      },
      async updateOne(filtro, update, options = {}) {
        await mongo.hooks.antesUpdate?.({ nome, filtro, update, options })
        const tab = tabela(nome, options)
        const doc = [...tab.values()].find(d => casa(d, filtro))
        if (!doc) {
          if (!options.upsert) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 }
          await this.insertOne({ ...filtro, ...clone(update.$setOnInsert || {}), ...clone(update.$set || {}) }, options)
          return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
        }
        const novo = clone(doc)
        Object.assign(novo, clone(update.$set || {}))
        for (const [k, n] of Object.entries(update.$inc || {})) novo[k] = (novo[k] || 0) + n
        const changed = JSON.stringify(novo) !== JSON.stringify(doc)
        if (changed) { tab.set(novo._id, novo); marcar(nome, novo._id, options) }
        await mongo.hooks.depoisUpdate?.({ nome, filtro, update, options })
        return { acknowledged: true, matchedCount: 1, modifiedCount: changed ? 1 : 0 }
      }
    }
  }
  mongo.jogadores = colecao('jogadores')
  mongo.operacoes = colecao('operacoes')
  mongo.cliente = {
    startSession() {
      const session = {
        ativa: false,
        startTransaction(options) {
          if (options.readConcern.level !== 'snapshot' || options.writeConcern.w !== 'majority') throw new Error('concerns ausentes')
          this.ativa = true
          this.snapshot = { jogadores: clone(estado.jogadores), operacoes: clone(estado.operacoes) }
          this.versoes = { jogadores: clone(versoes.jogadores), operacoes: clone(versoes.operacoes) }
          this.escritas = { jogadores: new Set(), operacoes: new Set() }
        },
        async commitTransaction() {
          if (mongo.erroCommit) throw mongo.erroCommit
          if (mongo.falhaCommit === 'antes') throw new Error('commit sem confirmação')
          for (const nome of Object.keys(estado)) {
            for (const id of this.escritas[nome]) {
              if (versoes[nome].get(id) !== this.versoes[nome].get(id)) {
                const erro = falha(112)
                erro.hasErrorLabel = label => label === 'TransientTransactionError'
                throw erro
              }
              const novo = this.snapshot[nome].get(id)
              if (nome === 'jogadores' && [...estado[nome].values()].some(d => d._id !== id && d.jid === novo.jid)) throw falha(11000)
            }
          }
          // Validar tudo ANTES de aplicar: commit não é uma série de updates.
          for (const nome of Object.keys(estado)) for (const id of this.escritas[nome]) {
            estado[nome].set(id, clone(this.snapshot[nome].get(id)))
            versoes[nome].set(id, (versoes[nome].get(id) || 0) + 1)
          }
          this.ativa = false
          if (mongo.falhaCommit === 'depois') throw new Error('resposta de commit perdida')
        },
        async abortTransaction() { this.ativa = false },
        async endSession() { this.ativa = false }
      }
      return session
    }
  }
  return mongo
}
module.exports = { criarMongoFake }
