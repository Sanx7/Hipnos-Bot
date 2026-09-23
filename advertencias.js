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
// REGRA DAS 3 ADVERTÊNCIAS: quando a 3ª advertência ATIVA da mesma pessoa
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
async function obterColecaoAdvertencias () {
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
async function criarAdvertencia ({ numero, grupoId, motivo, aplicadoPor, data }) {
  const numeroLimpo = limparNumero(numero)
  if (!numeroLimpo || !grupoId) return null

  const doc = {
    numero: numeroLimpo,
    grupo_id: String(grupoId),
    motivo: String(motivo || '').trim() || 'Sem motivo informado',
    aplicado_por: limparNumero(aplicadoPor) || 'desconhecido',
    data: Number(data) || Date.now(),
    ativa: true
  }

  const colecao = await obterColecaoAdvertencias()
  await colecao.insertOne(doc)
  const total = await contarAdvertencias(numeroLimpo, grupoId)
  return { total, doc }
}

// -------------------------------------------------------------------
// 📜 Lista as advertências ATIVAS do alvo no grupo, da mais recente para
// a mais antiga.
// -------------------------------------------------------------------
async function listarAdvertencias (numero, grupoId) {
  const numeroLimpo = limparNumero(numero)
  if (!numeroLimpo || !grupoId) return []

  const colecao = await obterColecaoAdvertencias()
  const docs = await colecao
    .find({ numero: numeroLimpo, grupo_id: String(grupoId), ativa: true })
    .sort({ data: -1, _id: -1 })
    .toArray()
  return Array.isArray(docs) ? docs : []
}

// -------------------------------------------------------------------
// 🔢 Conta quantas advertências ATIVAS o alvo tem no grupo.
// -------------------------------------------------------------------
async function contarAdvertencias (numero, grupoId) {
  const numeroLimpo = limparNumero(numero)
  if (!numeroLimpo || !grupoId) return 0

  const colecao = await obterColecaoAdvertencias()
  return await colecao.countDocuments({
    numero: numeroLimpo,
    grupo_id: String(grupoId),
    ativa: true
  })
}

// -------------------------------------------------------------------
// 🧹 Remove a advertência ATIVA mais recente (usada pelo /remadv).
// Retorno: documento removido | null (não havia nenhuma)
// -------------------------------------------------------------------
async function removerUltimaAdvertencia (numero, grupoId) {
  const ativas = await listarAdvertencias(numero, grupoId)
  if (!ativas.length) return null

  const alvo = ativas[0]
  const colecao = await obterColecaoAdvertencias()
  // Remove pelo _id quando o driver devolveu um; senão cai no filtro lógico.
  const filtro = alvo._id !== undefined && alvo._id !== null
    ? { _id: alvo._id }
    : { numero: alvo.numero, grupo_id: alvo.grupo_id, motivo: alvo.motivo, data: alvo.data }
  await colecao.deleteOne(filtro)
  return alvo
}

// -------------------------------------------------------------------
// 📦 ARQUIVA todas as advertências ativas do alvo no grupo (ativa: false).
// Usado no ban automático: zera a contagem SEM apagar o histórico.
// Retorno: quantas foram arquivadas
// -------------------------------------------------------------------
async function arquivarAdvertencias (numero, grupoId) {
  const numeroLimpo = limparNumero(numero)
  if (!numeroLimpo || !grupoId) return 0

  const colecao = await obterColecaoAdvertencias()
  const agora = Date.now()
  const resultado = await colecao.updateMany(
    { numero: numeroLimpo, grupo_id: String(grupoId), ativa: true },
    { $set: { ativa: false, arquivada_em: agora } }
  )
  return resultado?.modifiedCount ?? resultado?.matchedCount ?? 0
}

// -------------------------------------------------------------------
// 🗓️ Formata ms como "dd/mm/aaaa às hh:mm" (horário local).
// -------------------------------------------------------------------
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
function __definirColecaoTeste (colecao) {
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

