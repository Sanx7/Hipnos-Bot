const { MongoClient } = require('mongodb')
require('../config')
let conexao
async function obterColecoes() {
  if (!conexao) {
    conexao = (async () => {
      if (!process.env.MONGODB_URI) throw new Error('ARCONTES_INDISPONIVEL')
      const cliente = new MongoClient(process.env.MONGODB_URI, {
        maxPoolSize: 4, minPoolSize: 0, maxConnecting: 1, maxIdleTimeMS: 60000,
        waitQueueTimeoutMS: 5000, connectTimeoutMS: 10000,
        serverSelectionTimeoutMS: 10000, socketTimeoutMS: 20000, timeoutMS: 30000
      })
      try {
        await cliente.connect()
        const db = cliente.db(process.env.MONGODB_DB || 'whatsapp')
        const opcoes = { writeConcern: { w: 'majority', wtimeoutMS: 15000 },
          readConcern: { level: 'majority' }, readPreference: 'primary' }
        const cols = { patentes: db.collection('arcontesOlimpo', opcoes),
          eventos: db.collection('historicoExpulsoesArcontes', opcoes),
          controles: db.collection('arcontesControles', opcoes) }
        await preparar(cols)
        return cols
      } catch (erro) { await cliente.close().catch(() => {}); throw erro }
    })()
    conexao.catch(() => { conexao = null })
  }
  return conexao
}
async function preparar({ patentes, eventos }) {
  await patentes.createIndex({ grupo: 1, numero: 1 }, { unique: true, name: 'idx_arconte_grupo_numero' })
  await eventos.createIndex({ grupo: 1, tipo: 1, estado: 1, confirmadoEm: -1, _id: 1 }, { name: 'idx_arconte_historico' })
  await eventos.createIndex({ grupo: 1, tipo: 1, operacao: 1, criadoEm: -1 }, { name: 'idx_arconte_revisoes' })
  await eventos.createIndex({ grupo: 1, tipo: 1, criadoEm: -1, _id: 1 }, { name: 'idx_arconte_revisoes_grupo' })
  // Sem TTL: patentes revogadas, recibos e auditoria permanecem disponíveis.
}
function confirmado(r) {
  if (!r?.acknowledged) throw new Error('ARCONTES_RESULTADO_INCERTO')
  return r
}
function criarRepositorio(obter = obterColecoes) {
  return {
    async ativo(grupo, numero) { return Boolean(await (await obter()).patentes.findOne({ grupo, numero, ativo: true })) },
    async listar(grupo) { return (await obter()).patentes.find({ grupo, ativo: true }).sort({ numero: 1 }).limit(100).toArray() },
    async reservar(doc) {
      const r = confirmado(await (await obter()).eventos.updateOne({ _id: doc._id },
        { $setOnInsert: { ...doc, estado: 'reservada', criadoEm: new Date() } }, { upsert: true }))
      return r.upsertedCount === 1
    },
    async travar(grupo, token, operacao, instancia) {
      const col = (await obter()).controles
      try { confirmado(await col.updateOne({ _id: grupo }, { $setOnInsert: { ocupado: false } }, { upsert: true })) }
      catch (erro) { if (erro.code !== 11000) throw erro }
      const r = confirmado(await col.updateOne({ _id: grupo, ocupado: false },
        { $set: { ocupado: true, token, operacao, instancia, revisaoId: null }, $currentDate: { atualizadoEm: true } }))
      return r.matchedCount === 1
    },
    async travaValida(grupo, token) { return Boolean(await (await obter()).controles.findOne({ _id: grupo, ocupado: true, token, revisaoId: null })) },
    async soltar(grupo, token) {
      const r = confirmado(await (await obter()).controles.updateOne({ _id: grupo, ocupado: true, token, revisaoId: null },
        { $set: { ocupado: false, token: null }, $currentDate: { atualizadoEm: true } }))
      if (r.matchedCount !== 1) throw new Error('ARCONTES_RESERVA_PERDIDA')
    },
    async definir(grupo, numero, ativo, responsavel, operacao) {
      const r = confirmado(await (await obter()).patentes.updateOne({ grupo, numero }, {
        $set: { ativo, responsavel, operacao }, $currentDate: { atualizadoEm: true },
        $setOnInsert: { criadoEm: new Date() }
      }, { upsert: true }))
      if (!(r.matchedCount || r.upsertedCount)) throw new Error('ARCONTES_ESCRITA_NAO_CONFIRMADA')
    },
    async enviando(id, responsavelTipo) {
      const r = confirmado(await (await obter()).eventos.updateOne({ _id: id, estado: 'reservada' },
        { $set: { estado: 'enviando', responsavelTipo }, $currentDate: { solicitadoEm: true } }))
      if (r.matchedCount !== 1) throw new Error('ARCONTES_OPERACAO_PERDIDA')
    },
    async concluir(id, estado) {
      const r = confirmado(await (await obter()).eventos.updateOne({ _id: id, estado: { $in: ['reservada', 'enviando'] } }, {
        $set: { estado }, $currentDate: { atualizadoEm: true, ...(estado === 'confirmada' ? { confirmadoEm: true } : {}) }
      }))
      if (r.matchedCount !== 1) throw new Error('ARCONTES_OPERACAO_PERDIDA')
    },
    async historico(grupo, pagina) {
      return (await obter()).eventos.find({ grupo, tipo: 'kick', estado: 'confirmada' })
        .sort({ confirmadoEm: -1, _id: 1 }).skip((pagina - 1) * 10).limit(10).toArray()
    },
    async controle(grupo) { return (await obter()).controles.findOne({ _id: grupo }) },
    async operacao(grupo, id) { return (await obter()).eventos.findOne({ _id: id, grupo, tipo: 'kick' }) },
    async revisoes(grupo, operacao) {
      return (await obter()).eventos.find({ grupo, tipo: 'revisao', operacao }).sort({ criadoEm: -1 }).limit(20).toArray()
    },
    async listarRevisoes(grupo, pagina) {
      return (await obter()).eventos.find({ grupo, tipo: 'revisao' }).sort({ criadoEm: -1, _id: 1 })
        .skip((pagina - 1) * 10).limit(10).toArray()
    },
    async bloquearRevisao(controle, revisaoId) {
      const r = confirmado(await (await obter()).controles.updateOne({ _id: controle._id, ocupado: true,
        token: controle.token, operacao: controle.operacao, revisaoId: controle.revisaoId || null },
      { $set: { revisaoId }, $currentDate: { atualizadoEm: true } }))
      if (r.matchedCount !== 1) throw new Error('ARCONTES_CONTROLE_MUDOU')
    },
    async registrarRevisao(id, estado) {
      const anterior = estado === 'autorizada' ? 'reservada' : 'autorizada'
      const r = confirmado(await (await obter()).eventos.updateOne({ _id: id, tipo: 'revisao', estado: anterior },
        { $set: { estado }, $currentDate: { atualizadoEm: true } }))
      if (r.matchedCount !== 1) throw new Error('ARCONTES_REVISAO_NAO_CONFIRMADA')
    },
    async liberarRevisada(grupo, token, operacao, revisaoId) {
      // Fixa a liberação ao token E à operação revisados. Nunca alcança uma trava posterior.
      const r = confirmado(await (await obter()).controles.updateOne({ _id: grupo, ocupado: true,
        token, operacao, revisaoId }, { $set: { ocupado: false, token: null, revisaoId: null,
        ultimaRevisao: revisaoId }, $currentDate: { atualizadoEm: true } }))
      if (r.matchedCount !== 1) throw new Error('ARCONTES_CONTROLE_MUDOU')
    }
  }
}
module.exports = { criarRepositorio, preparar }
