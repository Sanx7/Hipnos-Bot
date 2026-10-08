// Regras e ocorrências persistentes, sem guardar os bytes da figurinha.
const { MongoClient } = require('mongodb')
const ACOES = new Set(['ban', 'adv', 'del'])
const cache = new Map()
const TTL = 60000
const MAX_CACHE = 2000
let conexao, teste
let revisao = 0

async function colecoes() {
  if (teste) return teste
  if (!conexao) {
    conexao = (async () => {
      if (!process.env.MONGODB_URI) throw new Error('MongoDB indisponível')
      const novo = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
      try {
        await novo.connect()
        const db = novo.db(process.env.MONGODB_DB || 'whatsapp')
        const regras = db.collection('regrasFigurinhas')
        const ocorrencias = db.collection('ocorrenciasFigurinhas')
        await regras.createIndex({ grupo_id: 1, hash: 1 }, { unique: true })
        return { regras, ocorrencias }
      } catch (err) { await novo.close().catch(() => {}); throw err }
    })()
    conexao.catch(() => { conexao = null })
  }
  return conexao
}

function validar(jid, hash) {
  if (!String(jid).endsWith('@g.us') || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Regra inválida')
}
function invalidar(jid) {
  revisao++
  for (const key of cache.keys()) if (key.startsWith(`${jid}:`)) cache.delete(key)
}
async function consulta(key, buscar) {
  const salvo = cache.get(key)
  if (salvo && salvo.expira > Date.now()) return salvo.valor
  cache.delete(key)
  const versao = revisao
  const valor = await buscar()
  // Não cachear falhas. Resultados negativos também têm prazo curto.
  if (versao === revisao) cache.set(key, { valor, expira: Date.now() + TTL })
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value)
  return valor
}
async function temRegras(jid) {
  return consulta(`${jid}:grupo`, async () => Boolean(await (await colecoes()).regras.findOne({ grupo_id: jid }, { projection: { _id: 1 } })))
}
async function consultar(jid, hash) {
  validar(jid, hash)
  return consulta(`${jid}:${hash}`, async () => {
    const doc = await (await colecoes()).regras.findOne({ _id: `${jid}:${hash}` })
    return doc && ACOES.has(doc.acao) ? doc.acao : null
  })
}
async function cadastrar(jid, hash, acao, autor) {
  validar(jid, hash)
  if (!ACOES.has(acao)) throw new Error('Ação inválida')
  try {
    return await (await colecoes()).regras.findOneAndUpdate(
      { _id: `${jid}:${hash}` },
      { $set: { grupo_id: jid, hash, acao, criado_por: autor, atualizado_em: Date.now() } },
      { upsert: true, returnDocument: 'before', includeResultMetadata: false }
    )
  } finally { invalidar(jid) }
}
async function remover(jid, hash, acao) {
  validar(jid, hash)
  try {
    return (await (await colecoes()).regras.deleteOne({ _id: `${jid}:${hash}`, acao })).deletedCount > 0
  } finally { invalidar(jid) }
}
async function listar(jid, pagina = 1) {
  return (await colecoes()).regras.find({ grupo_id: jid }).sort({ hash: 1 }).skip((pagina - 1) * 20).limit(21).toArray()
}
async function reservar(jid, id, hash, acao, sender) {
  const { ocorrencias } = await colecoes()
  const resultado = await ocorrencias.updateOne({ _id: `${jid}:${id}` }, { $setOnInsert: {
    grupo_id: jid, mensagem_id: id, hash, acao, participante: sender,
    estado: 'reservada', data: Date.now()
  } }, { upsert: true })
  return resultado.upsertedCount === 1
}
async function concluir(jid, id, estado) {
  await (await colecoes()).ocorrencias.updateOne({ _id: `${jid}:${id}` }, { $set: { estado } })
}

module.exports = {
  cadastrar, remover, listar, consultar, temRegras, reservar, concluir,
  __definirColecoesTeste(valor) { teste = valor; cache.clear(); revisao++ },
  __limparCacheTeste() { cache.clear(); revisao++ }
}
