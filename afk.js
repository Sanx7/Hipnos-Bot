// ============================================================
// 💤 afk.js — Sistema de Ausente (/afk) (MongoDB)
// ============================================================
// Módulo responsável por TODA a lógica de persistência do status
// AFK ("away from keyboard") dos usuários. Segue EXATAMENTE o
// mesmo padrão de conexão já usado no resto do projeto
// (database.js, vip.js, configuracoes-grupo.js):
//   - Collection dedicada: banco "whatsapp" (MONGODB_DB), collection
//     "afks" (sobrescrevível via MONGODB_COLLECTION_AFK);
//   - SINGLETON: um único MongoClient criado uma vez no processo;
//   - PING DE SAÚDE a cada uso + reconexão automática se a conexão morreu;
//   - ERROS RUIDOSOS: falha de conexão é logada com causa provável e
//     RELANÇADA (o comando /afk e o bloco do bot.js tratam).
//
// ⚠️ NÃO usa arquivo JSON local de propósito: o /welcome antigo já perdeu
// estado a cada redeploy do Render por causa disso (filesystem efêmero).
// Tudo aqui vive no MongoDB e sobrevive a redeploys/restarts.
//
// ESTRUTURA DO DOCUMENTO (collection "afks"):
//   {
//     numero: "5511999999999",   // apenas dígitos (único)
//     motivo: "Ausente no momento",
//     desde:  1700000000000      // início da ausência (ms)
//   }
//
// ÍNDICE ÚNICO: { numero: 1 } — 1 documento por usuário.
// ============================================================

const { MongoClient } = require('mongodb')

// ⚙️ config.js carrega o .env da raiz para o process.env (mesmo padrão de
// vip.js / configuracoes-grupo.js) — garante que MONGODB_URI exista mesmo
// se este módulo for importado antes do bot.js.
require('./config')

const NOME_BANCO = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO = process.env.MONGODB_COLLECTION_AFK || 'afks'

// Motivo padrão quando o usuário usa /afk sem argumento.
const MOTIVO_PADRAO = 'Ausente no momento'

// Singleton do processo: sobrevive às reconexões do startBot() e às
// múltiplas checagens por mensagem.
let clienteMongo = null
let colecaoCacheada = null
// 🧪 Modo teste (gancho __definirColecaoTeste): usa a collection injetada
// e NÃO conecta ao MongoDB real (mesmo padrão de vip.js/config-grupo).
let modoTeste = false

// -------------------------------------------------------------------
// Obtém a collection de AFKs, conectando se necessário. Valida a conexão
// com ping antes de reusar e reconecta se a anterior morreu. Erros são
// logados com causa provável e RELANÇADOS.
// -------------------------------------------------------------------
async function obterColecaoAfk() {
  // 🧪 No modo teste, devolve a collection injetada SEM tocar em rede.
  if (modoTeste && colecaoCacheada) return colecaoCacheada

  if (colecaoCacheada && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return colecaoCacheada
    } catch (erroPing) {
      console.error(
        '⚠️ [afk] conexão anterior com o MongoDB morreu — reconectando:',
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
    console.error('💥 MONGODB_URI NÃO CONFIGURADA — o sistema de /afk ficará desativado!')
    console.error('   Sem ela, o status AFK não persiste entre redeploys.')
    console.error('   → No Render: Settings → Environment → variável MONGODB_URI')
    console.error('   → Local: adicione MONGODB_URI no arquivo .env da raiz')
    console.error('════════════════════════════════════════════════════════')
    throw new Error('MONGODB_URI ausente — impossível acessar os AFKs')
  }

  try {
    console.log(`🗄️ [afk] conectando ao MongoDB (db: ${NOME_BANCO}, collection: ${NOME_COLECAO})...`)
    clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
    await clienteMongo.connect()
    await clienteMongo.db('admin').command({ ping: 1 })

    const colecao = clienteMongo.db(NOME_BANCO).collection(NOME_COLECAO)

    // Índice único: 1 registro de AFK por número (evita duplicados)
    await colecao.createIndex(
      { numero: 1 },
      { unique: true, name: 'idx_afks_numero' }
    )

    colecaoCacheada = colecao
    console.log('✅ [afk] MongoDB conectado — o status AFK persiste entre redeploys.')
    return colecaoCacheada
  } catch (erro) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 FALHA AO CONECTAR AO MONGODB (AFKs):', erro?.message)
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
// 💤 definirAfk(numero, motivo): marca (ou atualiza) o usuário como AFK.
// Se já estava AFK, sobrescreve motivo e "desde" (upsert atômico).
// Retorna o documento gravado. Lança em falha de conexão (o chamador
// trata — comando /afk ou bot.js).
// -------------------------------------------------------------------
async function definirAfk(numeroBruto, motivo) {
  const numero = String(numeroBruto || '').replace(/\D/g, '')
  if (!numero) return null

  const documento = {
    numero,
    motivo: String(motivo || '').trim() || MOTIVO_PADRAO,
    desde: Date.now()
  }

  const colecao = await obterColecaoAfk()
  await colecao.updateOne(
    { numero },
    { $set: documento },
    { upsert: true }
  )

  return documento
}

// -------------------------------------------------------------------
// 👋 removerAfk(numero): remove o status AFK do usuário e devolve o
// documento removido (com motivo e "desde", usados pela mensagem de
// "bem-vindo de volta"). Retorna null se não estava AFK.
// Lança em falha de conexão.
// -------------------------------------------------------------------
async function removerAfk(numeroBruto) {
  const numero = String(numeroBruto || '').replace(/\D/g, '')
  if (!numero) return null

  const colecao = await obterColecaoAfk()
  const removido = await colecao.findOneAndDelete({ numero })
  // MongoDB devolve { value: doc } em versões antigas do driver e o doc
  // direto nas novas — cobrimos os dois formatos.
  return removido?.value || removido || null
}

// -------------------------------------------------------------------
// 🔎 buscarAfk(numero): doc do usuário (ou null se não está AFK).
// -------------------------------------------------------------------
async function buscarAfk(numeroBruto) {
  const numero = String(numeroBruto || '').replace(/\D/g, '')
  if (!numero) return null
  const colecao = await obterColecaoAfk()
  return colecao.findOne({ numero })
}

// -------------------------------------------------------------------
// 🔎 buscarVariosAfk(numeros[]): checa TODOS os candidatos (remetente +
// mencionados/respondidos) com UMA ÚNICA consulta $in — eficiência
// exigida pelo bloco do bot.js (1 ida ao Mongo por mensagem recebida).
// Retorna um Map { numero → documento } apenas com quem ESTÁ AFK.
// -------------------------------------------------------------------
async function buscarVariosAfk(numeros) {
  const lista = [...new Set((numeros || [])
    .map((n) => String(n || '').replace(/\D/g, ''))
    .filter(Boolean))]

  const mapa = new Map()
  if (!lista.length) return mapa

  const colecao = await obterColecaoAfk()
  const documentos = await colecao.find({ numero: { $in: lista } }).toArray()
  for (const doc of documentos) mapa.set(doc.numero, doc)
  return mapa
}

// -------------------------------------------------------------------
// ⏳ formatarDuracao(ms): converte uma duração em milissegundos para
// texto legível. Exemplos: "5 minutos", "2 horas e 10 minutos",
// "1 dia e 3 horas", "menos de 1 minuto".
// -------------------------------------------------------------------
function formatarDuracao(ms) {
  const totalSegundos = Math.max(0, Math.floor(Number(ms) / 1000))
  if (totalSegundos < 60) return 'menos de 1 minuto'

  const dias = Math.floor(totalSegundos / 86400)
  const horas = Math.floor((totalSegundos % 86400) / 3600)
  const minutos = Math.floor((totalSegundos % 3600) / 60)

  const partes = []
  if (dias) partes.push(`${dias} dia${dias > 1 ? 's' : ''}`)
  if (horas) partes.push(`${horas} hora${horas > 1 ? 's' : ''}`)
  if (minutos) partes.push(`${minutos} minuto${minutos > 1 ? 's' : ''}`)
  if (!partes.length) return 'menos de 1 minuto'

  // Dois maiores componentes: "1 dia e 3 horas", "2 horas e 10 minutos"
  const principais = partes.slice(0, 2)
  return principais.length > 1
    ? `${principais[0]} e ${principais[1]}`
    : principais[0]
}

// -------------------------------------------------------------------
// 🧪 GANCHO DE TESTE (mesmo padrão dos demais módulos): injeta uma
// collection fake e desativa a conexão real até o fim do processo.
// Passando `null`, o modo teste é desligado.
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
  definirAfk,
  removerAfk,
  buscarAfk,
  buscarVariosAfk,
  formatarDuracao,
  MOTIVO_PADRAO,
  NOME_BANCO,
  NOME_COLECAO,
  __definirColecaoTeste
}

