const { MongoClient } = require('mongodb')
const PADRAO = Object.freeze({ ativo: false, limite: 6, janela: 10, acao: 'adv' })
let conexao, teste
async function colecoes() {
  if (teste) return teste
  if (!conexao) {
    conexao = (async () => {
      if (!process.env.MONGODB_URI) throw new Error('MongoDB indisponível')
      const cliente = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
      try {
        await cliente.connect()
        const db = cliente.db(process.env.MONGODB_DB || 'whatsapp')
        const config = db.collection('configAntiflood')
        const eventos = db.collection('ocorrenciasAntiflood')
        const cooldowns = db.collection('cooldownsAntiflood')
        await eventos.createIndex({ expira_em: 1 }, { expireAfterSeconds: 0 })
        await cooldowns.createIndex({ expira_em: 1 }, { expireAfterSeconds: 0 })
        return { config, eventos, cooldowns }
      } catch (erro) { await cliente.close().catch(() => {}); throw erro }
    })()
    conexao.catch(() => { conexao = null })
  }
  return conexao
}
function validar(c) {
  if (typeof c.ativo !== 'boolean' || !Number.isInteger(c.limite) || c.limite < 3 || c.limite > 30 ||
      !Number.isInteger(c.janela) || c.janela < 3 || c.janela > 60 || !['apagar', 'adv', 'ban'].includes(c.acao)) throw new Error('Configuração inválida')
  return c
}
function grupo(jid) { if (!String(jid).endsWith('@g.us')) throw new Error('Somente grupos') }
async function obter(jid) {
  grupo(jid)
  const doc = await (await colecoes()).config.findOne({ _id: jid })
  return validar(doc ? { ativo: doc.ativo, limite: doc.limite, janela: doc.janela, acao: doc.acao } : { ...PADRAO })
}
async function definir(jid, mudanca, autor) {
  grupo(jid)
  if (!autor || Object.keys(mudanca).some(k => !Object.hasOwn(PADRAO, k))) throw new Error('Configuração inválida')
  validar({ ...PADRAO, ...mudanca })
  const defaults = Object.fromEntries(Object.entries(PADRAO).filter(([k]) => !Object.hasOwn(mudanca, k)))
  await (await colecoes()).config.updateOne({ _id: jid }, {
    $setOnInsert: defaults, $set: { ...mudanca, atualizado_por: autor, atualizado_em: Date.now() }
  }, { upsert: true })
}
async function reservar(jid, id) {
  try {
    await (await colecoes()).eventos.insertOne({ _id: `${jid}:${id}`, expira_em: new Date(Date.now() + 86400000) })
    return true
  } catch (e) { if (e.code === 11000) return false; throw e }
}
async function cooldown(jid, numero, agora) {
  const col = (await colecoes()).cooldowns
  const _id = `${jid}:${numero}`, ate = agora + 30000
  try { await col.insertOne({ _id, ate, expira_em: new Date(ate) }); return true }
  catch (e) { if (e.code !== 11000) throw e }
  // TTL do Mongo é assíncrono; a comparação atômica libera exatamente aos 30s.
  const r = await col.updateOne({ _id, ate: { $lte: agora } }, { $set: { ate, expira_em: new Date(ate) } })
  return r.modifiedCount === 1
}
module.exports = { PADRAO, obter, definir, reservar, cooldown, __definirColecoesTeste(c) { teste = c } }
