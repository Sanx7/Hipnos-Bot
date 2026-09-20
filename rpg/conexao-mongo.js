// ============================================================
// 🗄️ rpg/conexao-mongo.js — Conexão DEDICADA do RPG (cluster separado)
// ============================================================
// O RPG usa um CLUSTER MongoDB PRÓPRIO (Atlas), diferente do cluster
// principal do bot (que guarda a sessão do Baileys, ranking, VIPs, afk,
// advertências, lembretes, histórico de IA etc.).
//
// ❓ POR QUÊ: isolar o crescimento dos dados do RPG do risco de estourar a
//    quota de 512MB do cluster principal — a sessão do WhatsApp NÃO pode
//    ficar sem espaço (sem ela o bot cai e precisa reescanear o QR Code).
//
// 🔑 URI: variável de ambiente MONGO_URI_RPG (a MONGODB_URI do cluster
//    principal permanece intocada). Opcionalmente:
//      MONGODB_DB_RPG          → banco no cluster dedicado (padrão: mesmo
//                                valor de MONGODB_DB, ou "whatsapp")
//      MONGODB_COLLECTION_RPG  → collection dos jogadores (padrão: "rpgPlayers")
//
// 🧩 Padrão idêntico ao database.js/sessao-mongo.js:
//   - SINGLETON: um único MongoClient por processo
//   - PING de saúde a cada uso + reconexão automática
//   - ERROS RUIDOSOS: falha loga a causa provável e RELANÇA
//
// ⚠️ TODA collection futura do RPG (Fase 3+: empregos, mercado, habitação,
//    roubo etc.) DEVE nascer através DESTE módulo (ou de um módulo irmão
//    que o use) — nunca pela conexão principal do bot.
// ============================================================

const { MongoClient } = require('mongodb')
// Garante que o .env da raiz foi carregado (config.js faz isso no bot, mas
// scripts isolados podem carregar só este módulo)
require('../config')

// -------------------------------------------------------------------
// 🏷️ nomeBancoDaUri(uri): extrai o nome do banco do PATH da connection
// string (ex.: "...mongodb.net/hipnos-rpg?appName=..." → "hipnos-rpg").
// Assim, quem já embute o banco na URI não precisa repetir MONGODB_DB_RPG.
// -------------------------------------------------------------------
function nomeBancoDaUri(uri) {
  try {
    const aposEsquema = String(uri || '').split('://')[1] || ''
    const hostECaminho = (aposEsquema.split('@').pop() || '').split('?')[0]
    // "host.com/hipnos-rpg" → partes = ["host.com", "hipnos-rpg"]
    const nome = (hostECaminho.split('/')[1] || '').trim()
    return nome || null
  } catch (e) {
    return null
  }
}

// Prioridade do nome do banco do RPG:
//   MONGODB_DB_RPG → banco na URI (path "/nome") → MONGODB_DB → "whatsapp"
const NOME_BANCO = process.env.MONGODB_DB_RPG
  || nomeBancoDaUri(process.env.MONGO_URI_RPG)
  || process.env.MONGODB_DB
  || 'whatsapp'
const NOME_COLECAO_PADRAO = process.env.MONGODB_COLLECTION_RPG || 'rpgPlayers'

let clienteMongo = null
let bancoCacheado = null
let indicesCriados = false

// -------------------------------------------------------------------
// obterBancoRpg(): devolve o handle do BANCO no cluster dedicado,
// conectando se necessário. Valida com ping antes de reusar e reconecta
// se a conexão anterior morreu. Erros são logados com causa e RELANÇADOS.
// -------------------------------------------------------------------
async function obterBancoRpg() {
  if (bancoCacheado && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return bancoCacheado
    } catch (erroPing) {
      console.error(
        '⚠️ [rpg-mongo] conexão anterior com o cluster do RPG morreu — reconectando:',
        erroPing?.message
      )
      try { await clienteMongo.close() } catch (e) { /* já morta */ }
      clienteMongo = null
      bancoCacheado = null
    }
  }

  const uri = process.env.MONGO_URI_RPG
  if (!uri) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 MONGO_URI_RPG NÃO CONFIGURADA — o sistema de RPG ficará desativado!')
    console.error('   O RPG usa um cluster MongoDB DEDICADO (isolamento de quota/risco')
    console.error('   p/ proteger a sessão do WhatsApp no cluster principal).')
    console.error('   → No Render: Settings → Environment → variável MONGO_URI_RPG')
    console.error('   → Local: adicione MONGO_URI_RPG no arquivo .env da raiz')
    console.error('   (a MONGODB_URI do cluster principal NÃO serve para o RPG)')
    console.error('════════════════════════════════════════════════════════')
    throw new Error('MONGO_URI_RPG ausente — impossível conectar ao cluster do RPG')
  }

  try {
    console.log(`🗄️ [rpg-mongo] conectando ao cluster DEDICADO do RPG (db: ${NOME_BANCO})...`)
    clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
    await clienteMongo.connect()
    await clienteMongo.db('admin').command({ ping: 1 })

    bancoCacheado = clienteMongo.db(NOME_BANCO)
    console.log('✅ [rpg-mongo] cluster do RPG conectado — dados isolados do cluster principal.')
    return bancoCacheado
  } catch (erro) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 FALHA AO CONECTAR AO CLUSTER DO RPG:', erro?.message)
    console.error('   Causas mais comuns:')
    console.error('   → MONGO_URI_RPG com usuário/senha/cluster errados')
    console.error('   → IP não liberado no Atlas do cluster NOVO: Network Access → 0.0.0.0/0')
    console.error('   → Cluster do RPG pausado ou sem armazenamento no Atlas free tier')
    console.error('════════════════════════════════════════════════════════')
    try { await clienteMongo?.close() } catch (e) { /* nada a fechar */ }
    clienteMongo = null
    bancoCacheado = null
    throw erro
  }
}

// -------------------------------------------------------------------
// obterColecaoRpg(nome): devolve uma collection NO CLUSTER DEDICADO.
//   - sem argumento → collection padrão dos jogadores (MONGODB_COLLECTION_RPG)
//   - com nome      → collection do RPG de mesmo nome (Fase 3+: empregos etc.)
// Cria o índice único de jogadores na primeira conexão (idempotente no Mongo).
// -------------------------------------------------------------------
async function obterColecaoRpg(nome) {
  const banco = await obterBancoRpg()
  const colecao = banco.collection(String(nome || NOME_COLECAO_PADRAO))

  // Índices dos jogadores (uma vez por processo; idempotente no Mongo)
  if (!indicesCriados && (!nome || nome === NOME_COLECAO_PADRAO)) {
    await colecao.createIndex(
      { jid: 1 },
      { unique: true, name: 'idx_rpg_jid' }
    )
    indicesCriados = true
  }
  return colecao
}

// -------------------------------------------------------------------
// clienteRpg(): expõe o MongoClient do cluster dedicado (usado pelo
// executarTransacao() do rpg/database.js p/ sessões de transação).
// -------------------------------------------------------------------
function clienteRpg() {
  return clienteMongo
}

// -------------------------------------------------------------------
// 🧪 fecharConexaoRpg(): fecha a conexão do RPG (usado em testes/scripts
// que precisam encerrar o processo limpo). Nunca lança.
// -------------------------------------------------------------------
async function fecharConexaoRpg() {
  try { await clienteMongo?.close() } catch (e) { /* já fechado */ }
  clienteMongo = null
  bancoCacheado = null
  indicesCriados = false
}

module.exports = {
  obterBancoRpg,
  obterColecaoRpg,
  clienteRpg,
  fecharConexaoRpg,
  NOME_BANCO,
  NOME_COLECAO_PADRAO
}