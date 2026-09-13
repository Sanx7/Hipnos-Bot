// ============================================
// 💡 sugestoes.js — Caixa de sugestões (MongoDB)
// ============================================
// Módulo responsável por TODA a persistência das sugestões do /sugestao.
// MESMO padrão de conexão de vip.js (VIPs), database.js (ranking) e
// rpg/database.js:
//   - Collection dedicada: banco "whatsapp" (MONGODB_DB), collection
//     "sugestoes" (sobrescrevível via MONGODB_COLLECTION_SUGESTOES);
//   - SINGLETON: um único MongoClient criado uma vez no processo;
//   - PING DE SAÚDE a cada uso + reconexão automática se a conexão morreu;
//   - ERROS RUIDOSOS: falha de conexão é logada com causa provável e
//     RELANÇADA (os comandos tratam e avisam o usuário em pt-BR).
//
// ESTRUTURA DO DOCUMENTO (collection "sugestoes"):
//   {
//     numero:         "5511999999999",
//     nome_remetente: "João" | null,
//     nome_grupo:     "Família" | null,
//     texto:          "criar comando de lembretes",
//     status:         "pendente" | "atendida" | "recusada",
//     criado_em:      1700000000000,
//     resolvido_em:   null | 1700000000000,
//     resolvido_por:  null | "5511999999999"
//   }
// ============================================

const { MongoClient, ObjectId } = require('mongodb')
const { limparNumero } = require('./config')

const NOME_BANCO = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO = process.env.MONGODB_COLLECTION_SUGESTOES || 'sugestoes'
const STATUS_VALIDOS = ['pendente', 'atendida', 'recusada']
// Teto anti-abuso: sugestão maior que isso é recusada com aviso
const LIMITE_TEXTO = 1000

// Singleton do processo: sobrevive às reconexões do startBot()
let clienteMongo = null
let colecaoCacheada = null
// Modo teste (scripts/teste-sugestao.js): collection fake injetada,
// SEM tocar no MongoDB real.
let modoTeste = false

// Obtém a collection, conectando se necessário (ping + reconexão).
async function obterColecaoSugestoes() {
  if (modoTeste && colecaoCacheada) return colecaoCacheada

  if (colecaoCacheada && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return colecaoCacheada
    } catch (erroPing) {
      console.error(
        '⚠️ [sugestoes] conexão anterior com o MongoDB morreu — reconectando:',
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
    console.error('💥 MONGODB_URI NÃO CONFIGURADA — a caixa de sugestões ficará desativada!')
    console.error('   Sem ela, as sugestões não persistem entre redeploys.')
    console.error('   → No Render: Settings → Environment → variável MONGODB_URI')
    console.error('   → Local: adicione MONGODB_URI no arquivo .env da raiz')
    console.error('════════════════════════════════════════════════════════')
    throw new Error('MONGODB_URI ausente — impossível acessar as sugestões')
  }

  try {
    console.log(`🗄️ [sugestoes] conectando ao MongoDB (db: ${NOME_BANCO}, collection: ${NOME_COLECAO})...`)
    clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
    await clienteMongo.connect()
    await clienteMongo.db('admin').command({ ping: 1 })

    const colecao = clienteMongo.db(NOME_BANCO).collection(NOME_COLECAO)
    await colecao.createIndex(
      { status: 1, criado_em: 1 },
      { name: 'idx_sugestoes_status_criado' }
    )
    await colecao.createIndex(
      { numero: 1 },
      { name: 'idx_sugestoes_numero' }
    )

    colecaoCacheada = colecao
    console.log('✅ [sugestoes] MongoDB conectado — sugestões persistem entre redeploys.')
    return colecaoCacheada
  } catch (erro) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 FALHA AO CONECTAR AO MONGODB (sugestões):', erro?.message)
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

// Salva uma sugestão com status inicial "pendente".
// Retorno: { id, criadoEm } | null (número/texto inválidos ou longos)
async function salvarSugestao({ numero, nomeRemetente, nomeGrupo, texto }) {
  const numeroLimpo = limparNumero(numero)
  const textoLimpo = String(texto || '').trim()
  if (!numeroLimpo || !textoLimpo || textoLimpo.length > LIMITE_TEXTO) {
    return null
  }

  const colecao = await obterColecaoSugestoes()
  const agora = Date.now()

  const resultado = await colecao.insertOne({
    numero: numeroLimpo,
    nome_remetente: nomeRemetente ? String(nomeRemetente).trim().slice(0, 100) || null : null,
    nome_grupo: nomeGrupo ? String(nomeGrupo).trim().slice(0, 100) || null : null,
    texto: textoLimpo,
    status: 'pendente',
    criado_em: agora,
    resolvido_em: null,
    resolvido_por: null
  })

  return { id: resultado.insertedId, criadoEm: agora }
}

// Lista as pendentes das MAIS ANTIGAS p/ as mais novas — a posição
// na lista é o número usado pelo /marcarsugestao (1 = mais antiga).
async function listarPendentes(limite = 30) {
  const colecao = await obterColecaoSugestoes()
  const teto = Math.max(1, Math.min(Math.floor(Number(limite)) || 30, 100))
  return colecao
    .find({ status: 'pendente' })
    .sort({ criado_em: 1 })
    .limit(teto)
    .toArray()
}

// Quantas pendentes há no momento (usado no aviso aos donos).
async function contarPendentes() {
  const colecao = await obterColecaoSugestoes()
  return colecao.countDocuments({ status: 'pendente' })
}

// Marca UMA sugestão como "atendida" ou "recusada" pelo _id
// (aceita ObjectId ou string hexadecimal de 24 chars).
// Retorno: documento atualizado | null (não achou / status inválido)
async function marcarPorId(id, status, resolvidoPor) {
  if (!STATUS_VALIDOS.includes(status) || status === 'pendente') return null

  let chave = id
  if (typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id)) {
    try { chave = new ObjectId(id) } catch (e) { return null }
  }
  if (!chave) return null

  const colecao = await obterColecaoSugestoes()
  const resultado = await colecao.updateOne(
    { _id: chave },
    {
      $set: {
        status,
        resolvido_em: Date.now(),
        resolvido_por: resolvidoPor ? limparNumero(resolvidoPor) || null : null
      }
    }
  )
  if (!resultado || resultado.matchedCount === 0) return null
  return colecao.findOne({ _id: chave })
}

// Marca o N-ésimo pendente (1 = mais antigo, mesma ordem do
// /versugestoes). Retorno: documento atualizado | null.
async function marcarSugestaoPorIndice(indice, status, resolvidoPor) {
  const n = Math.floor(Number(indice))
  if (!Number.isFinite(n) || n < 1) return null
  const pendentes = await listarPendentes(n)
  const alvo = pendentes[n - 1]
  if (!alvo) return null
  return marcarPorId(alvo._id, status, resolvidoPor)
}

// Formata um timestamp como "dd/mm/aaaa às HH:MM" (horário local)
function formatarDataHora(timestamp) {
  const d = new Date(timestamp)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const aaaa = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const minuto = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${aaaa} às ${hh}:${minuto}`
}

// Gancho de teste (scripts/teste-sugestao.js): injeta collection fake.
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
  salvarSugestao,
  listarPendentes,
  contarPendentes,
  marcarPorId,
  marcarSugestaoPorIndice,
  formatarDataHora,
  STATUS_VALIDOS,
  LIMITE_TEXTO,
  __definirColecaoTeste
}
