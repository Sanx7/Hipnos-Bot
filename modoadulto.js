// ============================================================
// 🔞 modoadulto.js — Modo adulto POR GRUPO (MongoDB)
// ============================================================
// Mesmo padrão de conexão do resto do projeto (database.js, vip.js,
// configuracoes-grupo.js): collection "modoAdulto", SINGLETON,
// ping de saúde + reconexão, erros ruidosos relançados.
// Documento: { grupo_id, ativo, atualizado_em }.
// Índice único: { grupo_id: 1 }.
// Exporta: definirModoAdulto(grupoId, ativo), modoAdultoAtivo(grupoId)
// (NUNCA lança — em falha assume DESLIGADO por segurança).
// ============================================================

const { MongoClient } = require('mongodb')

// ⚙️ config.js carrega o .env da raiz para o process.env — garante que
// MONGODB_URI exista mesmo se este módulo for importado antes do bot.js.
require('./config')

const NOME_BANCO = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO = process.env.MONGODB_COLLECTION_MODO_ADULTO || 'modoAdulto'

// Singleton do processo: sobrevive às reconexões do startBot().
let clienteMongo = null
let colecaoCacheada = null
// 🧪 Modo teste: usa a collection injetada pelo gancho
// __definirColecaoTeste e NÃO conecta ao MongoDB real.
let modoTeste = false

// -------------------------------------------------------------------
// Obtém a collection do modo adulto, conectando se necessário.
// Valida a conexão com ping antes de reusar e reconecta se a
// anterior morreu. Erros são logados com causa provável e RELANÇADOS.
// -------------------------------------------------------------------
async function obterColecaoModoAdulto() {
  // No modo teste, devolve a collection injetada SEM tocar em rede.
  if (modoTeste && colecaoCacheada) return colecaoCacheada

  if (colecaoCacheada && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return colecaoCacheada
    } catch (erroPing) {
      console.error(
        '⚠️ [modo-adulto] conexão anterior com o MongoDB morreu — reconectando:',
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
    console.error('💥 MONGODB_URI NÃO CONFIGURADA — o modo adulto fica DESLIGADO!')
    console.error('   Sem ela, o liga/desliga do /modoadulto não persiste entre redeploys.')
    console.error('   → No Render: Settings → Environment → variável MONGODB_URI')
    console.error('   → Local: adicione MONGODB_URI no arquivo .env da raiz')
    console.error('════════════════════════════════════════════════════════')
    throw new Error('MONGODB_URI ausente — impossível persistir o modo adulto')
  }

  try {
    console.log(`🗄️ [modo-adulto] conectando ao MongoDB (db: ${NOME_BANCO}, collection: ${NOME_COLECAO})...`)
    clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
    await clienteMongo.connect()
    // Ping de verdade: valida credenciais + rede + whitelist de IP do Atlas
    await clienteMongo.db('admin').command({ ping: 1 })

    const colecao = clienteMongo.db(NOME_BANCO).collection(NOME_COLECAO)

    // Índice único por grupo: 1 documento por grupo_id (evita duplicados)
    await colecao.createIndex(
      { grupo_id: 1 },
      { unique: true, name: 'idx_modo_adulto_grupo_id' }
    )

    colecaoCacheada = colecao
    console.log('✅ [modo-adulto] MongoDB conectado — o modo adulto persiste entre redeploys.')
    return colecaoCacheada
  } catch (erro) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 FALHA AO CONECTAR AO MONGODB (modo adulto):', erro?.message)
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
// definirModoAdulto(grupoId, ativo): liga/desliga o modo adulto NESTE
// grupo (upsert por grupo_id). Devolve o documento gravado.
// Lança erro em falha de conexão (o /modoadulto avisa o admin).
// -------------------------------------------------------------------
async function definirModoAdulto(grupoIdBruto, ativo) {
  const grupoId = String(grupoIdBruto || '').trim()
  if (!grupoId) return null

  const colecao = await obterColecaoModoAdulto()
  const documento = {
    grupo_id: grupoId,
    ativo: Boolean(ativo),
    atualizado_em: Date.now()
  }

  await colecao.updateOne(
    { grupo_id: grupoId },
    { $set: documento },
    { upsert: true }
  )

  console.log(`🔞 [modo-adulto] modo adulto ${ativo ? 'LIGADO' : 'DESLIGADO'} p/ ${grupoId}`)
  return documento
}

// -------------------------------------------------------------------
// modoAdultoAtivo(grupoId): usada pelos comandos adultos.
// true = LIGADO neste grupo; false = desligado/sem registro/banco fora.
// NUNCA lança: em falha assume DESLIGADO (fail-safe: melhor bloquear o
// conteúdo adulto do que liberar sem permissão por erro de banco).
// -------------------------------------------------------------------
async function modoAdultoAtivo(grupoIdBruto) {
  const grupoId = String(grupoIdBruto || '').trim()
  if (!grupoId) return false

  try {
    const colecao = await obterColecaoModoAdulto()
    const config = await colecao.findOne({ grupo_id: grupoId })
    return config?.ativo === true
  } catch (erro) {
    console.error(
      '⚠️ [modo-adulto] falha ao consultar o modo adulto — assumindo DESLIGADO:',
      erro?.message
    )
    return false
  }
}

// -------------------------------------------------------------------
// 🧪 GANCHO DE TESTE: injeta uma collection fake e desativa a conexão
// real até o fim do processo. Passando `null`, desliga o modo teste.
// -------------------------------------------------------------------
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
  definirModoAdulto,
  modoAdultoAtivo,
  obterColecaoModoAdulto,
  NOME_BANCO,
  NOME_COLECAO,
  __definirColecaoTeste
}

