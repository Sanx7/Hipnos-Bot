// ============================================
// 💠 vip.js — Sistema de Membros VIP (MongoDB, com expiração automática)
// ============================================
// Módulo responsável por TODA a lógica de VIPs do bot. Migrado de SQLite
// (mensagens.db/better-sqlite3) para MongoDB — MESMO padrão de conexão do
// database.js (ranking) e do rpg/database.js:
//   - Collection dedicada: banco "whatsapp" (MONGODB_DB), collection "vips"
//     (sobrescrevível via MONGODB_COLLECTION_VIPS);
//   - SINGLETON: um único MongoClient criado uma vez no processo;
//   - PING DE SAÚDE a cada uso + reconexão automática se a conexão morreu;
//   - ERROS RUIDOSOS: falha de conexão é logada com causa provável e
//     RELANÇADA (os comandos /darvip e /listavip tratam).
//
// Funções (todas assíncronas desde a migração):
//   1. adicionarVip(numero, dias) — outorga VIP por N dias (SOMANDO os dias
//      se o alvo já for VIP ativo; se já expirou, recomeça um novo período);
//   2. listarVipsAtivos() — VIPs vigentes ordenados pela expiração mais
//      próxima, removendo os expirados do banco (limpeza automática);
//   3. isVip(numero) — verificação reutilizável p/ qualquer comando que
//      queira restringir a VIPs (apaga o registro se já venceu). Aceita
//      JID "@lid" (resolve o número real pelo mapeamento da sessão);
//   4. corrigirVipsComLid() — correção pontual dos registros gravados com
//      LID no lugar do número real (usada pelo /listavip e pelo script
//      scripts/migrar-vip-lid.js);
//   5. limparExpirados() — remove do banco os VIPs vencidos.
//
// NÃO existe VIP vitalício: todo registro tem `expira_em` obrigatório
// (sempre uma data futura calculada a partir dos dias concedidos).
//
// ESTRUTURA DO DOCUMENTO (collection "vips"):
//   {
//     numero:       "5511999999999",   // apenas dígitos (único)
//     adicionado_em: 1700000000000,    // 1ª outorga (ms)
//     expira_em:     1700864000000     // quando o VIP acaba (ms)
//   }
// ============================================

const { MongoClient } = require('mongodb')
const { limparNumero } = require('./config')
// 🪪 Resolução LID→telefone (mapeamento gravado pela Baileys na sessão) —
// usada pelo isVip (checagem "é VIP?" robusta p/ remetentes que chegam
// como "@lid") e pela correção pontual corrigirVipsComLid().
const { resolverLidParaTelefone } = require('./lid')

const DIA_EM_MS = 24 * 60 * 60 * 1000
// Teto de segurança p/ os dias concedidos (10 anos): evita gravar valores absurdos.
const DIAS_MAX = 3650

const NOME_BANCO = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO = process.env.MONGODB_COLLECTION_VIPS || 'vips'

// Singleton do processo: sobrevive às reconexões do startBot()
let clienteMongo = null
let colecaoCacheada = null
// 🧪 Modo teste (scripts/teste-vip-mongo.js): usa a collection injetada
// pelo gancho __definirColecaoTeste e NÃO conecta ao MongoDB real.
let modoTeste = false

// -------------------------------------------------------------------
// Obtém a collection de VIPs, conectando se necessário. Valida a conexão
// com ping antes de reusar e reconecta se a anterior morreu. Erros são
// logados com causa provável e RELANÇADOS.
// -------------------------------------------------------------------
async function obterColecaoVips() {
  // 🧪 No modo teste, devolve a collection injetada SEM tocar em rede.
  if (modoTeste && colecaoCacheada) return colecaoCacheada

  if (colecaoCacheada && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return colecaoCacheada
    } catch (erroPing) {
      console.error(
        '⚠️ [vip] conexão anterior com o MongoDB morreu — reconectando:',
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
    console.error('💥 MONGODB_URI NÃO CONFIGURADA — o sistema de VIP ficará desativado!')
    console.error('   Sem ela, os VIPs não persistem entre redeploys.')
    console.error('   → No Render: Settings → Environment → variável MONGODB_URI')
    console.error('   → Local: adicione MONGODB_URI no arquivo .env da raiz')
    console.error('════════════════════════════════════════════════════════')
    throw new Error('MONGODB_URI ausente — impossível acessar os VIPs')
  }

  try {
    console.log(`🗄️ [vip] conectando ao MongoDB (db: ${NOME_BANCO}, collection: ${NOME_COLECAO})...`)
    clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
    await clienteMongo.connect()
    await clienteMongo.db('admin').command({ ping: 1 })

    const colecao = clienteMongo.db(NOME_BANCO).collection(NOME_COLECAO)

    // Índice único: 1 registro por número | Índice acelera as limpezas por expiração
    await colecao.createIndex(
      { numero: 1 },
      { unique: true, name: 'idx_vips_numero' }
    )
    await colecao.createIndex(
      { expira_em: 1 },
      { name: 'idx_vips_expira_em' }
    )

    colecaoCacheada = colecao
    console.log('✅ [vip] MongoDB conectado — VIPs persistem entre redeploys.')
    return colecaoCacheada
  } catch (erro) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 FALHA AO CONECTAR AO MONGODB (VIPs):', erro?.message)
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
// 🧹 Remove do banco todos os VIPs cuja expiração já passou.
// Retorna quantos registros foram removidos.
// -------------------------------------------------------------------
async function limparExpirados() {
  const colecao = await obterColecaoVips()
  const resultado = await colecao.deleteMany({ expira_em: { $lte: Date.now() } })
  return resultado.deletedCount || 0
}

// -------------------------------------------------------------------
// 👑 Outorga `dias` de VIP ao número informado (JID cru ou só dígitos).
// Regra de soma:
//   - Já é VIP ATIVO  -> expira_em = expiração atual + dias (SOMA)
//   - Nunca foi / EXPIROU -> novo período a partir de AGORA
// Retorno: { numero, expiraEm, somando, dias } | null (dados inválidos)
// -------------------------------------------------------------------
async function adicionarVip(numeroBruto, dias) {
  const numero = limparNumero(numeroBruto)
  const diasNum = Math.floor(Number(dias))
  if (!numero || !Number.isFinite(diasNum) || diasNum < 1 || diasNum > DIAS_MAX) {
    return null
  }

  const colecao = await obterColecaoVips()
  const agora = Date.now()

  const existente = await colecao.findOne({ numero })
  const somando = Boolean(existente && existente.expira_em > agora)
  const expiraEm = (somando ? existente.expira_em : agora) + diasNum * DIA_EM_MS

  await colecao.updateOne(
    { numero },
    {
      $set: {
        numero,
        // Somando: preserva a data da 1ª outorga | Expirado: recomeça (nova data)
        adicionado_em: somando ? existente.adicionado_em : agora,
        expira_em: expiraEm
      }
    },
    { upsert: true }
  )

  return { numero, expiraEm, somando, dias: diasNum }
}

// -------------------------------------------------------------------
// 📜 Lista TODOS os VIPs ATIVOS, ordenados pela expiração MAIS PRÓXIMA.
// Antes de montar a lista, remove automaticamente os já expirados.
// Retorno: [ { numero, adicionado_em, expira_em }, ... ]
// -------------------------------------------------------------------
async function listarVipsAtivos() {
  await limparExpirados()
  const colecao = await obterColecaoVips()
  return colecao
    .find({}, { projection: { _id: 0, numero: 1, adicionado_em: 1, expira_em: 1 } })
    .sort({ expira_em: 1 })
    .toArray()
}

// -------------------------------------------------------------------
// 🪪 corrigirVipsComLid(): correção PONTUAL dos registros gravados com o
// LID (ex.: "175952680210489") no lugar do número real. Para cada registro
// que tiver mapeamento na sessão (lid-mapping reverse, gravado pela
// Baileys), troca o LID pelo telefone real. Se o número real já tiver
// registro próprio, os dois são MESCLADOS (menor adicionado_em + maior
// expira_em) e o registro-LID é apagado. Roda no /listavip (auto-correção)
// e no scripts/migrar-vip-lid.js (migração manual). NUNCA lança.
// -------------------------------------------------------------------
async function corrigirVipsComLid() {
  const colecao = await obterColecaoVips()
  const registros = await colecao
    .find({}, { projection: { _id: 0, numero: 1, adicionado_em: 1, expira_em: 1 } })
    .toArray()

  let corrigidos = 0
  for (const registro of registros) {
    const telefoneReal = await resolverLidParaTelefone(registro.numero)
    if (!telefoneReal || telefoneReal === registro.numero) continue

    const existente = await colecao.findOne({ numero: telefoneReal })
    if (existente) {
      // 🔀 Mescla: mantém o 1º outorgado e a expiração MAIS LONGE dos dois
      await colecao.updateOne(
        { numero: telefoneReal },
        {
          $set: {
            numero: telefoneReal,
            adicionado_em: existente.adicionado_em ?? registro.adicionado_em,
            expira_em: Math.max(existente.expira_em || 0, registro.expira_em || 0)
          }
        }
      )
      await colecao.deleteOne({ numero: registro.numero })
    } else {
      // ✏️ Correção in-place: troca o LID pelo número real no mesmo registro
      await colecao.updateOne(
        { numero: registro.numero },
        { $set: { numero: telefoneReal } }
      )
    }
    corrigidos += 1
    console.log(`[vip] 🪪 registro corrigido: LID ${registro.numero} → ${telefoneReal}`)
  }

  return { corrigidos, total: registros.length }
}

// -------------------------------------------------------------------
// ✅ Verificação reutilizável (aceita JID cru ou só dígitos):
//   true  = existe registro E a expiração ainda não passou
//   false = não é VIP — e, se o registro já venceu, ele é APAGADO
//           do banco na hora (auto-limpeza).
// 🪪 Aceita também JID "@lid": se não houver registro pelo LID, resolve
// o número real pelo mapeamento da sessão (lid-mapping) e reconsulta —
// sem isso, comandos restritos a VIP (ex.: o futuro /s) falhariam para
// quem chega como "@lid" em grupos com LID habilitado.
// -------------------------------------------------------------------
async function isVip(numeroBruto) {
  const numero = limparNumero(numeroBruto)
  if (!numero) return false

  const colecao = await obterColecaoVips()
  let registro = await colecao.findOne({ numero })

  // 🪪 Caminho LID: o bruto é "@lid" e não há registro pelo LID cru
  if (!registro && String(numeroBruto || '').endsWith('@lid')) {
    const telefoneReal = await resolverLidParaTelefone(numero)
    if (telefoneReal && telefoneReal !== numero) {
      registro = await colecao.findOne({ numero: telefoneReal })
    }
  }

  if (!registro) return false

  if (registro.expira_em <= Date.now()) {
    // 🧹 VIP vencido deixa de ocupar lugar no banco
    await colecao.deleteOne({ numero: registro.numero })
    return false
  }

  return true
}

// -------------------------------------------------------------------
// 🗓️ Formata um timestamp como "dd/mm/aaaa às HH:MM" (horário local)
// -------------------------------------------------------------------
function formatarData(timestamp) {
  const d = new Date(timestamp)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const aaaa = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const minuto = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${aaaa} às ${hh}:${minuto}`
}

// -------------------------------------------------------------------
// 🧪 GANCHO DE TESTE (usado por scripts/teste-vip-mongo.js): injeta uma
// collection fake e desativa a conexão real até o fim do processo.
// Passando `null`, o modo teste é desligado e o módulo volta a exigir
// MONGODB_URI (útil p/ provar que o erro sem URI é ruidoso, não silencioso).
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
  adicionarVip,
  listarVipsAtivos,
  isVip,
  corrigirVipsComLid,
  limparExpirados,
  formatarData,
  DIAS_MAX,
  DIA_EM_MS,
  NOME_BANCO,
  NOME_COLECAO,
  __definirColecaoTeste
}