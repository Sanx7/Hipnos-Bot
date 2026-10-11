const { MongoClient } = require('mongodb')
const { normalizar } = require('./deteccao-golpes')
const PADRAO = Object.freeze({ ativo: false, modo: 'alerta', sensibilidade: 'media', excecoes: Object.freeze([]) })
const MAX_EXCECOES = 20
const GENERICOS = new Set('voce seu sua todos todas qualquer mensagem mensagens link links clique agora premio premios ganhou ganhe liberado saque gratis golpe golpes seguro segura seguros seguras confiavel confiaveis oficial quero permitido permitida verdadeiro verdadeira'.split(' '))
function termoValido(termo) {
  if (typeof termo !== 'string' || Array.from(termo).length > 80 || !/^[\p{L}\s'-]+$/u.test(termo)) throw new Error('Exceção inválida')
  const n = normalizar(termo), palavras = n.split(' ')
  if (n.length < 8 || palavras.filter(p => p.length >= 3).length < 2 || !palavras.some(p => p.length >= 3 && !GENERICOS.has(p)) ||
      /\b(?:senha|codigo|sms|cpf|pix|token|cartao|bancarios)\b/.test(n)) throw new Error('Exceção genérica ou sensível')
  return n
}
let conexao, teste
async function colecoes() {
  if (teste) return teste
  if (!conexao) {
    conexao = (async () => {
      if (!process.env.MONGODB_URI) throw new Error('Mongo indisponível')
      const cliente = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
      try {
        await cliente.connect()
        const db = cliente.db(process.env.MONGODB_DB || 'whatsapp')
        const config = db.collection('configAntigolpe'), eventos = db.collection('ocorrenciasAntigolpe'), cooldowns = db.collection('cooldownsAntigolpe')
        await eventos.createIndex({ expira_em: 1 }, { expireAfterSeconds: 0 })
        await cooldowns.createIndex({ expira_em: 1 }, { expireAfterSeconds: 0 })
        return { config, eventos, cooldowns }
      } catch (e) { await cliente.close().catch(() => {}); throw e }
    })()
    conexao.catch(() => { conexao = null })
  }
  return conexao
}
function validar(c) {
  if (typeof c.ativo !== 'boolean' || !['alerta', 'apagar', 'adv'].includes(c.modo) || !['baixa', 'media', 'alta'].includes(c.sensibilidade) ||
      !Array.isArray(c.excecoes) || c.excecoes.length > MAX_EXCECOES || new Set(c.excecoes).size !== c.excecoes.length ||
      c.excecoes.some(t => termoValido(t) !== t)) throw new Error('Configuração inválida')
  return c
}
function grupo(jid) { if (!String(jid).endsWith('@g.us')) throw new Error('Somente grupos') }
async function obter(jid) {
  grupo(jid)
  const doc = await (await colecoes()).config.findOne({ _id: jid })
  return validar(doc ? { ativo: doc.ativo, modo: doc.modo, sensibilidade: doc.sensibilidade, excecoes: [...(doc.excecoes || [])] } : { ...PADRAO, excecoes: [] })
}
async function definir(jid, mudanca, autor) {
  grupo(jid)
  if (!autor || Object.keys(mudanca).some(k => !['ativo', 'modo', 'sensibilidade'].includes(k))) throw new Error('Configuração inválida')
  validar({ ...PADRAO, ...mudanca })
  const defaults = Object.fromEntries(Object.entries(PADRAO).filter(([k]) => !Object.hasOwn(mudanca, k)))
  await (await colecoes()).config.updateOne({ _id: jid }, { $setOnInsert: defaults, $set: { ...mudanca, atualizado_por: autor, atualizado_em: Date.now() } }, { upsert: true })
}
async function permitir(jid, termo, autor) {
  const n = termoValido(termo)
  await obter(jid); await definir(jid, {}, autor)
  const r = await (await colecoes()).config.updateOne({ _id: jid, excecoes: { $ne: n },
    $expr: { $lt: [{ $size: '$excecoes' }, MAX_EXCECOES] } },
  { $push: { excecoes: n }, $set: { atualizado_por: autor, atualizado_em: Date.now() } })
  if (!r.modifiedCount && !(await obter(jid)).excecoes.includes(n)) throw new Error('Limite de exceções')
}
async function remover(jid, termo, autor) {
  const n = termoValido(termo)
  await obter(jid); await definir(jid, {}, autor)
  await (await colecoes()).config.updateOne({ _id: jid }, { $pull: { excecoes: n }, $set: { atualizado_por: autor, atualizado_em: Date.now() } })
}
async function reservar(jid, id, bloqueada) {
  const col = (await colecoes()).eventos, _id = `${jid}:${id}`
  try { await col.insertOne({ _id, bloqueada, expira_em: new Date(Date.now() + 86400000) }); return { nova: true, bloqueada } }
  catch (e) { if (e.code !== 11000) throw e; return { nova: false, bloqueada: (await col.findOne({ _id }))?.bloqueada === true } }
}
async function cooldown(jid, numero, agora) {
  const col = (await colecoes()).cooldowns, _id = `${jid}:${numero}`, ate = agora + 60000
  try { await col.insertOne({ _id, ate, expira_em: new Date(ate) }); return true }
  catch (e) { if (e.code !== 11000) throw e }
  const r = await col.updateOne({ _id, ate: { $lte: agora } }, { $set: { ate, expira_em: new Date(ate) } })
  return r.modifiedCount === 1
}
module.exports = { PADRAO, MAX_EXCECOES, termoValido, obter, definir, permitir, remover, reservar, cooldown, __definirColecoesTeste(c) { teste = c } }
