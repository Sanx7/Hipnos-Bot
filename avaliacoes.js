// ============================================
// ⭐ avaliacoes.js — Notas do bot (MongoDB)
// ============================================
// Módulo responsável por TODA a persistência das avaliações do /avaliar.
// MESMO padrão de conexão de sugestoes.js, vip.js e database.js:
//   - Collection dedicada: banco "whatsapp" (MONGODB_DB), collection
//     "avaliacoes" (sobrescrevível via MONGODB_COLLECTION_AVALIACOES);
//   - SINGLETON: um único MongoClient criado uma vez no processo;
//   - PING DE SAÚDE a cada uso + reconexão automática se a conexão morreu;
//   - ERROS RUIDOSOS: falha de conexão é logada com causa provável e
//     RELANÇADA (os comandos tratam e avisam o usuário em pt-BR).
//
// REGRA DE OURO: 1 número = 1 avaliação (sem reavaliar, sem duplicar).
// Garantida em 2 camadas:
//   1) checagem prévia via jaAvaliou() (mensagem amigável);
//   2) índice ÚNICO em { numero: 1 } (barreira física contra corrida).
//
// ESTRUTURA DO DOCUMENTO (collection "avaliacoes"):
//   {
//     numero:   "5511999999999",  // apenas dígitos (único)
//     nota:     5,                // 1..5
//     criado_em: 1700000000000
//   }
// ============================================

const { MongoClient } = require('mongodb')
const { limparNumero } = require('./config')

const NOME_BANCO = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO = process.env.MONGODB_COLLECTION_AVALIACOES || 'avaliacoes'

// Singleton do processo: sobrevive às reconexões do startBot()
let clienteMongo = null
let colecaoCacheada = null
// Modo teste (scripts/teste-avaliacao.js): collection fake injetada,
// SEM tocar no MongoDB real.
let modoTeste = false

// Obtém a collection, conectando se necessário (ping + reconexão).
async function obterColecaoAvaliacoes() {
  if (modoTeste && colecaoCacheada) return colecaoCacheada

  if (colecaoCacheada && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return colecaoCacheada
    } catch (erroPing) {
      console.error(
        '⚠️ [avaliacoes] conexão anterior com o MongoDB morreu — reconectando:',
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
    console.error('💥 MONGODB_URI NÃO CONFIGURADA — as avaliações ficarão desativadas!')
    console.error('   Sem ela, as notas não persistem entre redeploys.')
    console.error('   → No Render: Settings → Environment → variável MONGODB_URI')
    console.error('   → Local: adicione MONGODB_URI no arquivo .env da raiz')
    console.error('════════════════════════════════════════════════════════')
    throw new Error('MONGODB_URI ausente — impossível acessar as avaliações')
  }

  try {
    console.log(`🗄️ [avaliacoes] conectando ao MongoDB (db: ${NOME_BANCO}, collection: ${NOME_COLECAO})...`)
    clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
    await clienteMongo.connect()
    await clienteMongo.db('admin').command({ ping: 1 })

    const colecao = clienteMongo.db(NOME_BANCO).collection(NOME_COLECAO)
    // Barreira física anti-duplicata: 1 documento por número
    await colecao.createIndex(
      { numero: 1 },
      { unique: true, name: 'idx_avaliacoes_numero' }
    )

    colecaoCacheada = colecao
    console.log('✅ [avaliacoes] MongoDB conectado — notas persistem entre redeploys.')
    return colecaoCacheada
  } catch (erro) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 FALHA AO CONECTAR AO MONGODB (avaliações):', erro?.message)
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

// Já existe avaliação deste número? (checagem prévia — camada 1)
async function jaAvaliou(numeroBruto) {
  const numero = limparNumero(numeroBruto)
  if (!numero) return false
  const colecao = await obterColecaoAvaliacoes()
  const doc = await colecao.findOne({ numero })
  return Boolean(doc)
}

// Salva a nota (1..5) com barreira anti-duplicata em 2 camadas:
//  - nota inválida → null (o comando avisa o formato);
//  - número já avaliado → { duplicada: true } (o comando agradece
//    sem sobrescrever);
//  - corrida entre checagem e escrita → o índice único lança erro de
//    duplicate key, convertido aqui também em { duplicada: true }.
// Sucesso → { id, criadoEm }.
async function salvarAvaliacao(numeroBruto, notaBruta) {
  const numero = limparNumero(numeroBruto)
  const nota = Math.floor(Number(notaBruta))
  if (!numero || !Number.isFinite(nota) || nota < 1 || nota > 5) {
    return null
  }

  const colecao = await obterColecaoAvaliacoes()

  if (await colecao.findOne({ numero })) {
    return { duplicada: true }
  }

  try {
    const agora = Date.now()
    const resultado = await colecao.insertOne({ numero, nota, criado_em: agora })
    return { id: resultado.insertedId, criadoEm: agora }
  } catch (err) {
    // Corrida: outro processo inseriu entre o findOne e o insertOne
    if (err && (err.code === 11000 || /duplicate key/i.test(err?.message || ''))) {
      return { duplicada: true }
    }
    throw err
  }
}

// Média geral via agregação ($avg): { media, total }.
// Sem avaliações → { media: null, total: 0 }.
async function calcularMedia() {
  const colecao = await obterColecaoAvaliacoes()
  const cursor = await colecao.aggregate([
    { $group: { _id: null, media: { $avg: '$nota' }, total: { $sum: 1 } } }
  ])
  const linhas = await cursor.toArray()
  if (!linhas.length) return { media: null, total: 0 }
  return { media: linhas[0].media, total: linhas[0].total }
}

// Gancho de teste (scripts/teste-avaliacao.js): injeta collection fake.
// Com `null`, desliga o modo teste e volta a exigir MONGODB_URI.
function __definirColecaoTeste(colecao) {
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
  jaAvaliou,
  salvarAvaliacao,
  calcularMedia,
  __definirColecaoTeste
}
