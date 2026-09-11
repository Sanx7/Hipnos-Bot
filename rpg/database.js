// ============================================================
// 🎲 rpg/database.js — Persistência do RPG "vida real" no MongoDB
// ============================================================
// Módulo de acesso a dados da Fase 0 do sistema de RPG.
// Segue EXATAMENTE o mesmo padrão de conexão já usado no resto do
// projeto (sessao-mongo.js e database.js):
//   - SINGLETON: um único MongoClient criado uma vez no processo
//   - PING DE SAÚDE a cada uso + reconexão automática se a conexão
//     anterior morreu
//   - ERROS RUIDOSOS: falha de conexão/autenticação é logada com causa
//     provável e RELANÇADA — o bot nunca fica travado em silêncio
//
// Collection dedicada: banco "whatsapp" (MONGODB_DB, mesmo do ranking),
// collection "rpgPlayers" (sobrescrevível via MONGODB_COLLECTION_RPG).
// ============================================================

const { MongoClient } = require('mongodb')

const NOME_BANCO = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO = process.env.MONGODB_COLLECTION_RPG || 'rpgPlayers'

// Singleton do processo: sobrevive a reconexões do startBot() e a
// múltiplas chamadas de getPlayer/savePlayer
let clienteMongo = null
let colecaoCacheada = null

// ⚠️ IMPORTANTE: valores padrão c/ referência
// (objetos/arrays) NÃO podem ser compartilhados entre chamadas.
// A função cria um objeto novo a cada getPlayer().
function criarJogadorPadrao(jid) {
  return {
    jid: String(jid || ''),
    nome: null,
    genero: null,       // "M" ou "F", definido no /registrar
    idade: 18,
    carteira: 0,
    banco: 0,
    emprego: null,
    cargo: 1,
    xpTrabalho: 0,       // XP do cargo atual, reseta ao trocar de emprego
    xpTierTotal: 0,      // XP acumulado de todos os empregos, nunca reseta
    empregosAnteriores: [],
    casado: null,
    filhos: [],
    casas: [],           // array de chaves de imóveis possuídos (acumulativo)
    carros: [],           // array de chaves de carros possuídos (máx 5, validado depois)
    fama: 0,
    fome: 100,
    energia: 100,
    preso: false,
    inventario: [],
    cooldowns: {},
    criadoEm: Date.now()
  }
}

// -------------------------------------------------------------------
// Obtém a collection de jogadores do RPG, conectando se necessário.
// Valida a conexão com ping antes de reusar e reconecta se morreu.
// Erros são logados com causa provável e RELANÇADOS.
// -------------------------------------------------------------------
async function obterColecaoRpg() {
  if (colecaoCacheada && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return colecaoCacheada
    } catch (erroPing) {
      console.error(
        '⚠️ [rpg] conexão anterior com o MongoDB morreu — reconectando:',
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
    console.error('💥 MONGODB_URI NÃO CONFIGURADA — o sistema de RPG ficará desativado!')
    console.error('   Sem ela, os dados dos jogadores não persistem entre redeploys.')
    console.error('   → No Render: Settings → Environment → variável MONGODB_URI')
    console.error('   → Local: adicione MONGODB_URI no arquivo .env da raiz')
    console.error('════════════════════════════════════════════════════════')
    throw new Error('MONGODB_URI ausente — impossível conectar ao RPG')
  }

  try {
    console.log(`🗄️ [rpg] conectando ao MongoDB (db: ${NOME_BANCO}, collection: ${NOME_COLECAO})...`)
    clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
    await clienteMongo.connect()
    await clienteMongo.db('admin').command({ ping: 1 })

    const colecao = clienteMongo.db(NOME_BANCO).collection(NOME_COLECAO)

    // Índice único por jid: 1 jogador por número (evita duplicados)
    await colecao.createIndex(
      { jid: 1 },
      { unique: true, name: 'idx_rpg_jid' }
    )

    colecaoCacheada = colecao
    console.log('✅ [rpg] MongoDB conectado — dados dos jogadores persistem entre redeploys.')
    return colecaoCacheada
  } catch (erro) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 FALHA AO CONECTAR AO MONGODB (RPG):', erro?.message)
    console.error('   Causas mais comuns:')
    console.error('   → MONGODB_URI com usuário/senha/cluster errados')
    console.error('   → IP não liberado no Atlas: Network Access → 0.0.0.0/0')
    console.error('     (o Render free usa IPs de saída dinâmicos)')
    console.error('   → Cluster pausado ou sem armazenamento no Atlas free tier')
    console.error('════════════════════════════════════════════════════════')
    try { await clienteMongo?.close() } catch (e) { /* nada a fechar */ }
    clienteMongo = null
    colecaoCacheada = null
    throw erro
  }
}

// -------------------------------------------------------------------
// getPlayer(jid): busca o jogador pelo JID. Se não existir, CRIA
// automaticamente com os valores padrão da Fase 0.
// Retorna o documento COMPLETO (já com o jid normalizado).
// Lança erro em caso de falha de conexão (o comando trata).
// -------------------------------------------------------------------
async function getPlayer(jid) {
  const colecao = await obterColecaoRpg()
  const jidLimpo = String(jid || '').trim()

  let jogador = await colecao.findOne({ jid: jidLimpo })
  if (!jogador) {
    const novo = criarJogadorPadrao(jidLimpo)
    // upsert com $setOnInsert: se outro processo criar ao mesmo tempo,
    // o insert não sobrescreve o que já existe
    await colecao.updateOne(
      { jid: jidLimpo },
      { $setOnInsert: novo },
      { upsert: true }
    )
    jogador = await colecao.findOne({ jid: jidLimpo })
  }

  return jogador
}

// -------------------------------------------------------------------
// savePlayer(jid, data): salva/atualiza o jogador (upsert por jid).
// O documento é sobrescrito (upsert) com os dados informados.
// -------------------------------------------------------------------
async function savePlayer(jid, data) {
  const colecao = await obterColecaoRpg()
  const jidLimpo = String(jid || '').trim()

  const jogadorGravado = {
    jid: jidLimpo,
    ...(data || {})
  }

  await colecao.updateOne(
    { jid: jidLimpo },
    { $set: jogadorGravado },
    { upsert: true }
  )

  // Substitui o jid do objeto retornado pelo limpo (defensivo)
  if (jogadorGravado.jid !== jidLimpo) jogadorGravado.jid = jidLimpo
  return jogadorGravado
}

// -------------------------------------------------------------------
// Utilitário: merge defensivo de um objeto parcial sobre o jogador.
// Usa o getPlayer (que garante os padrões) e preenche apenas os campos
// fornecidos. Evita deletar campos acidentalmente.
// -------------------------------------------------------------------
async function mergeAtualizacao(jid, dadosParciais) {
  const jogador = await getPlayer(jid)
  if (!dadosParciais || typeof dadosParciais !== 'object') return jogador
  return { ...jogador, ...dadosParciais }
}

module.exports = {
  getPlayer,
  savePlayer,
  mergeAtualizacao,
  obterColecaoRpg,
  criarJogadorPadrao
}