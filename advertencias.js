// ============================================
// ⚠️ advertencias.js — Sistema de advertências (MongoDB)
// ============================================
// Módulo responsável por TODA a lógica de advertências do bot. Segue o
// MESMO padrão de conexão do vip.js / database.js (ranking):
//   - Collection dedicada: banco "whatsapp" (MONGODB_DB), collection
//     "advertencias" (sobrescrevível via MONGODB_COLLECTION_ADV);
//   - SINGLETON: um único MongoClient criado uma vez no processo;
//   - PING DE SAÚDE a cada uso + reconexão automática se a conexão morreu;
//   - ERROS RUIDOSOS: falha de conexão é logada com causa provável e
//     RELANÇADA (os comandos /adv, /advs e /remadv tratam).
//
// ESTRUTURA DO DOCUMENTO (collection "advertencias"):
//   {
//     numero:      "5511999999999",   // só dígitos (número REAL, nunca LID)
//     grupo_id:    "12036...@g.us",   // grupo onde a advertência vale
//     motivo:      "texto informado pelo admin",
//     aplicado_por:"5511888888888",   // quem aplicou (número real)
//     data:        1700000000000,     // quando aplicou (ms)
//     ativa:       true               // false = arquivada (após o ban)
//   }
//
// REGRA DO LIMITE CONFIGURADO (padrão 3): quando a 3ª advertência ATIVA da mesma pessoa
// no mesmo grupo é gravada, o comando /adv dispara o ban automático e
// ARQUIVA as advertências dela nesse grupo (ativa: false) — o histórico
// não é apagado, mas a contagem volta a zero.
//
// Funções:
//   1. criarAdvertencia({numero, grupoId, motivo, aplicadoPor}) → {total, doc}
//   2. listarAdvertencias(numero, grupoId) → [] (mais recente primeiro)
//   3. contarAdvertencias(numero, grupoId) → number
//   4. removerUltimaAdvertencia(numero, grupoId) → doc removido | null
//   5. arquivarAdvertencias(numero, grupoId) → quantos foram arquivados
// ============================================

const { MongoClient } = require('mongodb')
const { limparNumero } = require('./config')
const { AsyncLocalStorage } = require('node:async_hooks')
const { randomUUID } = require('node:crypto')

const NOME_BANCO = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO = process.env.MONGODB_COLLECTION_ADV || 'advertencias'

// ⚠️ Limite que dispara o ban automático (3 advertências ativas)
const LIMITE_ADVERTENCIAS = 3

// Singleton do processo: sobrevive às reconexões do startBot()
let clienteMongo = null
let colecaoCacheada = null
// 🧪 Modo teste (scripts/teste-adv.js): usa a collection injetada pelo
// gancho __definirColecaoTeste e NÃO conecta ao MongoDB real.
let modoTeste = false

// -------------------------------------------------------------------
// Obtém a collection de advertências, conectando se necessário. Valida a
// conexão com ping antes de reusar e reconecta se a anterior morreu.
// -------------------------------------------------------------------
let conectando
async function obterColecaoAdvertencias () {
  if (modoTeste && colecaoCacheada) return colecaoCacheada
  if (conectando) return conectando
  conectando = conectarAdvertencias()
  try { return await conectando } finally { conectando = null }
}
async function conectarAdvertencias () {
  // 🧪 No modo teste, devolve a collection injetada SEM tocar em rede.
  if (modoTeste && colecaoCacheada) return colecaoCacheada

  if (colecaoCacheada && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return colecaoCacheada
    } catch (erroPing) {
      console.error(
        '⚠️ [adv] conexão anterior com o MongoDB morreu — reconectando:',
        erroPing?.message
      )
      try { await clienteMongo.close() } catch (e) { /* já morta */ }
      clienteMongo = null
      colecaoCacheada = null
    }
  }

  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 MONGODB_URI NÃO CONFIGURADA — o sistema de advertências ficará desativado!')
    console.error('   Sem ela, as advertências não persistem entre redeploys.')
    console.error('   → No Render: Settings → Environment → variável MONGODB_URI')
    console.error('   → Local: adicione MONGODB_URI no arquivo .env da raiz')
    console.error('════════════════════════════════════════════════════════')
    throw new Error('MONGODB_URI ausente — impossível acessar as advertências')
  }

  try {
    console.log(`🗄️ [adv] conectando ao MongoDB (db: ${NOME_BANCO}, collection: ${NOME_COLECAO})...`)
    clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
    await clienteMongo.connect()
    await clienteMongo.db('admin').command({ ping: 1 })

    const colecao = clienteMongo.db(NOME_BANCO).collection(NOME_COLECAO)

    // Índices: as buscas são sempre por (numero + grupo) e a contagem por ativa.
    await colecao.createIndex(
      { numero: 1, grupo_id: 1, ativa: 1 },
      { name: 'idx_adv_numero_grupo' }
    )
    await colecao.createIndex({ data: -1 }, { name: 'idx_adv_data' })

    colecaoCacheada = colecao
    console.log('✅ [adv] MongoDB conectado — advertências persistem entre redeploys.')
    return colecaoCacheada
  } catch (erro) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 FALHA AO CONECTAR AO MONGODB (advertências):', erro?.message)
    console.error('   Causas mais comuns:')
    console.error('   → MONGODB_URI com usuário/senha/cluster errados')
    console.error('   → IP não liberado no Atlas: Network Access → 0.0.0.0/0')
    console.error('   → Cluster pausado ou sem armazenamento no Atlas free tier')
    console.error('════════════════════════════════════════════════════════')
    try { await clienteMongo?.close() } catch (e) { /* nada a fechar */ }
    clienteMongo = null
    colecaoCacheada = null
    throw erro
  }
}

// -------------------------------------------------------------------
// ⚠️ Grava uma advertência ATIVA e devolve o total de ativas do alvo no
// grupo (o total é o que decide o ban automático).
// Retorno: { total, doc } | null (dados inválidos)
// -------------------------------------------------------------------
// Serialização por pessoa/grupo, também entre processos: reserva única no Mongo.
// Sem expiração automática: um crash durante efeito WhatsApp é ambíguo e exige
// reconciliação, em vez de repetir uma expulsão que pode ter sido aceita.
const operacao = new AsyncLocalStorage()
const filas = new Map()
let auxiliaresTeste
function fakeAuxiliar() {
  const docs = new Map()
  return {
    async insertOne(doc) { if (docs.has(doc._id)) { const e = new Error('Reserva ocupada'); e.code = 11000; throw e } docs.set(doc._id, { ...doc }) },
    async deleteOne(f) { const d = docs.get(f._id); if (d && (!f.token || d.token === f.token)) docs.delete(f._id) },
    async findOne(f) { return docs.get(f._id) || null },
    async updateOne(f, u) { docs.set(f._id, { _id: f._id, ...docs.get(f._id), ...u.$set }) }
  }
}
async function auxiliar(nome) {
  await obterColecaoAdvertencias()
  if (modoTeste) return auxiliaresTeste[nome]
  return clienteMongo.db(NOME_BANCO).collection(nome)
}
async function comAdvertenciasSerializadas(numero, grupoId, executar) {
  const chave = `${grupoId}:${limparNumero(numero)}`
  if (operacao.getStore()?.chave === chave) return executar()
  const anterior = filas.get(chave) || Promise.resolve()
  const trabalho = anterior.catch(() => {}).then(async () => {
    const reservas = await auxiliar('advertenciasOperacoes')
    const token = randomUUID()
    try { await reservas.insertOne({ _id: chave, token, numero: limparNumero(numero), grupo_id: String(grupoId), data: Date.now(), estado: 'em_andamento' }) }
    catch (erro) {
      if (erro.code === 11000) throw new Error('Há uma operação pendente para este mortal. Aguarde ou solicite reconciliação ao dono.')
      throw erro
    }
    const contexto = { chave, reter: false }
    try { return await operacao.run(contexto, executar) }
    finally { if (!contexto.reter) await reservas.deleteOne({ _id: chave, token }) }
  })
  filas.set(chave, trabalho)
  try { return await trabalho } finally { if (filas.get(chave) === trabalho) filas.delete(chave) }
}
async function registrarRemocaoConfirmada(numero, grupoId) {
  const contexto = operacao.getStore()
  if (contexto) contexto.reter = true
  await (await auxiliar('advertenciasOperacoes')).updateOne(
    { _id: `${grupoId}:${limparNumero(numero)}` },
    { $set: { estado: 'remocao_confirmada', confirmado_em: Date.now() } }
  )
}
function reterOperacao() { const contexto = operacao.getStore(); if (contexto) contexto.reter = true }
function concluirOperacao() { const contexto = operacao.getStore(); if (contexto) contexto.reter = false }
async function obterLimiteAdvertencias(grupoId) {
  const doc = await (await auxiliar('configAdvertencias')).findOne({ _id: String(grupoId) })
  if (!doc) return LIMITE_ADVERTENCIAS
  if (!Number.isInteger(doc.limite) || doc.limite < 1 || doc.limite > 10) throw new Error('Limite inválido no banco')
  return doc.limite
}
async function definirLimiteAdvertencias(grupoId, limite, autor) {
  if (!String(grupoId).endsWith('@g.us') || !Number.isInteger(limite) || limite < 1 || limite > 10) throw new Error('Limite deve ser de 1 a 10')
  await (await auxiliar('configAdvertencias')).updateOne({ _id: String(grupoId) }, {
    $set: { limite, atualizado_por: limparNumero(autor), atualizado_em: Date.now() }
  }, { upsert: true })
}
function filtroAtivas(numero, grupoId) {
  return { numero: limparNumero(numero), grupo_id: String(grupoId), ativa: true }
}
async function criarAdvertencia({ numero, grupoId, motivo, aplicadoPor, data }) {
  if (!limparNumero(numero) || !grupoId) return null
  return comAdvertenciasSerializadas(numero, grupoId, async () => {
    const limite = await obterLimiteAdvertencias(grupoId)
    const doc = {
      ...filtroAtivas(numero, grupoId), estado: 'ativa',
      motivo: String(motivo || '').trim() || 'Sem motivo informado',
      aplicado_por: limparNumero(aplicadoPor) || 'desconhecido', data: Number(data) || Date.now()
    }
    await (await obterColecaoAdvertencias()).insertOne(doc)
    return { total: await contarAdvertencias(numero, grupoId), doc, limite }
  })
}
async function listarAdvertencias(numero, grupoId) {
  if (!limparNumero(numero) || !grupoId) return []
  return (await obterColecaoAdvertencias()).find(filtroAtivas(numero, grupoId)).sort({ data: -1, _id: -1 }).toArray()
}
async function contarAdvertencias(numero, grupoId) {
  if (!limparNumero(numero) || !grupoId) return 0
  return (await obterColecaoAdvertencias()).countDocuments(filtroAtivas(numero, grupoId))
}
async function removerUltimaAdvertencia(numero, grupoId, autor) {
  return comAdvertenciasSerializadas(numero, grupoId, async () => {
    const alvo = (await listarAdvertencias(numero, grupoId))[0]
    if (!alvo) return null
    const filtro = alvo._id != null ? { _id: alvo._id, ativa: true } : { ...filtroAtivas(numero, grupoId), motivo: alvo.motivo, data: alvo.data }
    const mudanca = { ativa: false, estado: 'perdoada', removido_por: limparNumero(autor) || 'desconhecido', removida_em: Date.now() }
    const resultado = await (await obterColecaoAdvertencias()).updateMany(filtro, { $set: mudanca })
    if (!resultado.modifiedCount) return null
    return { ...alvo, ...mudanca }
  })
}
async function arquivarAdvertencias(numero, grupoId, autor, ids) {
  if (!limparNumero(numero) || !grupoId) return 0
  return comAdvertenciasSerializadas(numero, grupoId, async () => {
    const filtro = filtroAtivas(numero, grupoId)
    if (ids) filtro._id = { $in: ids }
    const resultado = await (await obterColecaoAdvertencias()).updateMany(filtro, { $set: {
      ativa: false, estado: 'arquivada', arquivada_em: Date.now(), arquivada_por: limparNumero(autor) || 'desconhecido'
    } })
    return resultado.modifiedCount
  })
}
async function listarHistorico(numero, grupoId, pagina = 1) {
  if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 100000) throw new Error('Página inválida')
  const registros = await (await obterColecaoAdvertencias()).find({ numero: limparNumero(numero), grupo_id: String(grupoId) })
    .sort({ data: -1, _id: -1 }).skip((pagina - 1) * 5).limit(6).toArray()
  return { registros: registros.slice(0, 5), temProxima: registros.length > 5 }
}
function estadoAdvertencia(doc) { return doc.estado || (doc.ativa ? 'ativa' : 'arquivada') }

function formatarData (ms) {
  const d = new Date(Number(ms) || Date.now())
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const aaaa = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const minuto = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${aaaa} às ${hh}:${minuto}`
}

// -------------------------------------------------------------------
// 🧪 GANCHO DE TESTE (usado por scripts/teste-adv.js): injeta uma
// collection fake e desativa a conexão real até o fim do processo.
// Passando `null`, o modo teste é desligado e o módulo volta a exigir
// MONGODB_URI (útil p/ provar que o erro sem URI é ruidoso).
// -------------------------------------------------------------------
function __definirColecaoTeste (colecao, auxiliares) {
  auxiliaresTeste = auxiliares || { configAdvertencias: fakeAuxiliar(), advertenciasOperacoes: fakeAuxiliar() }
  if (colecao) {
    colecaoCacheada = colecao
    clienteMongo = null
    modoTeste = true
  } else {
    colecaoCacheada = null
    clienteMongo = null
    modoTeste = false
  }
}

module.exports = {
  comAdvertenciasSerializadas,
  obterLimiteAdvertencias,
  definirLimiteAdvertencias,
  listarHistorico,
  estadoAdvertencia,
  registrarRemocaoConfirmada,
  reterOperacao,
  concluirOperacao,
  criarAdvertencia,
  listarAdvertencias,
  contarAdvertencias,
  removerUltimaAdvertencia,
  arquivarAdvertencias,
  formatarData,
  LIMITE_ADVERTENCIAS,
  NOME_BANCO,
  NOME_COLECAO,
  __definirColecaoTeste
}

