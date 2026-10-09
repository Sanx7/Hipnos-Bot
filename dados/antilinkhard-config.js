const { MongoClient } = require('mongodb')
const { randomUUID } = require('node:crypto')
const cache = new Map()
const MAX_CACHE = 1000
const TTL_CACHE = 30000
const TTL_EVENTO = 7 * 24 * 60 * 60 * 1000
const TTL_TRAVA = 10 * 60 * 1000
let conexao, teste, revisao = 0

async function colecoes() {
  if (teste) return teste
  if (!conexao) {
    conexao = (async () => {
      if (!process.env.MONGODB_URI) throw new Error('MongoDB indisponível')
      const cliente = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
      try {
        await cliente.connect()
        const db = cliente.db(process.env.MONGODB_DB || 'whatsapp')
        const config = db.collection('configAntilinkHard')
        const eventos = db.collection('ocorrenciasAntilinkHard')
        const travas = db.collection('travasAntilinkHard')
        await eventos.createIndex({ expira_em: 1 }, { expireAfterSeconds: 0 })
        await travas.createIndex({ expira_em: 1 }, { expireAfterSeconds: 0 })
        return { config, eventos, travas }
      } catch (erro) { await cliente.close().catch(() => {}); throw erro }
    })()
    conexao.catch(() => { conexao = null })
  }
  return conexao
}
function validar(jid) { if (!String(jid).endsWith('@g.us')) throw new Error('Somente grupos') }
async function obter(jid, fresco = false) {
  validar(jid)
  const salvo = cache.get(jid)
  if (!fresco && salvo?.expira > Date.now()) return salvo.ativo
  cache.delete(jid)
  const versao = revisao
  const doc = await (await colecoes()).config.findOne({ _id: jid })
  if (doc && typeof doc.ativo !== 'boolean') throw new Error('Configuração inválida')
  const ativo = doc?.ativo === true
  if (versao === revisao) cache.set(jid, { ativo, expira: Date.now() + TTL_CACHE })
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value)
  return ativo
}
async function definir(jid, ativo, autor) {
  validar(jid)
  if (typeof ativo !== 'boolean' || !autor) throw new Error('Configuração inválida')
  try {
    await (await colecoes()).config.updateOne({ _id: jid }, {
      $set: { ativo, atualizado_por: autor, atualizado_em: Date.now() }
    }, { upsert: true })
  } finally { revisao++; cache.delete(jid) }
}
async function reservarEvento(jid, id, sender) {
  try {
    await (await colecoes()).eventos.insertOne({
      _id: `${jid}:${id}`, grupo_id: jid, mensagem_id: id, participante: sender,
      estado: 'reservada', data: Date.now(), expira_em: new Date(Date.now() + TTL_EVENTO)
    })
    return true
  } catch (erro) { if (erro.code === 11000) return false; throw erro }
}
async function concluirEvento(jid, id, estado, extra = {}) {
  await (await colecoes()).eventos.updateOne({ _id: `${jid}:${id}` }, {
    $set: { estado, atualizado_em: Date.now(), ...extra }
  })
}
async function reservarParticipante(jid, numero) {
  const token = randomUUID()
  try {
    await (await colecoes()).travas.insertOne({ _id: `${jid}:${numero}`, token,
      grupo_id: jid, numero, estado: 'em_andamento', expira_em: new Date(Date.now() + TTL_TRAVA) })
    return token
  } catch (erro) { if (erro.code === 11000) return null; throw erro }
}
async function concluirParticipante(jid, numero, token, estado) {
  // Mantém a trava por dez minutos inclusive após falha: uma queda de conexão
  // pode ter ocorrido depois de o WhatsApp aceitar a remoção. Não repetir.
  await (await colecoes()).travas.updateOne({ _id: `${jid}:${numero}`, token }, { $set: { estado } })
}
module.exports = {
  obter, definir, reservarEvento, concluirEvento, reservarParticipante, concluirParticipante,
  MAX_CACHE, TTL_TRAVA, __definirColecoesTeste(valor) { teste = valor; cache.clear(); revisao++ }
}
