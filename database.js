// ============================================================
// 🗄️ database.js — Banco do /ranking (MongoDB)
// ============================================================
// Módulo responsável por TODA a lógica de persistência do ranking.
// Migrado de SQLite (better-sqlite3) para MongoDB.
//
// ESTRATÉGIA: contador agregado (1 documento por usuário por grupo)
//   - Em vez de 1 linha por mensagem (crescimento ilimitado), usamos
//     um campo "total" que é incrementado a cada mensagem via $inc.
//   - Isso evita estourar o limite de 512MB do MongoDB Atlas free tier.
//
// ESTRUTURA DO DOCUMENTO (collection: "ranking"):
//   {
//     grupo_id:       "12036...@g.us",
//     usuario_id:     "5511999999999",
//     nome:           "João",
//     total:          42,
//     ultimaMensagem: 1700000000000
//   }
//
// ÍNDICE ÚNICO COMPOSTO: { grupo_id: 1, usuario_id: 1 }
// CONEXÃO: singleton com ping de saúde e auto-reconexão.
// ============================================================

const { MongoClient } = require('mongodb')

const NOME_BANCO = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO = process.env.MONGODB_COLLECTION_RANKING || 'ranking'

let clienteMongo = null
let colecaoCacheada = null

// -------------------------------------------------------------------
// Obtém a collection de ranking, conectando se necessário.
// Valida a conexão com ping antes de reusar e reconecta se morreu.
// Erros são logados com causa provável e RELANÇADOS.
// -------------------------------------------------------------------
async function obterColecaoRanking() {
  if (colecaoCacheada && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return colecaoCacheada
    } catch (erroPing) {
      console.error(
        '⚠️ [database] conexão anterior com o MongoDB morreu — reconectando:',
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
    console.error('💥 MONGODB_URI NÃO CONFIGURADA — o /ranking ficará desativado!')
    console.error('   Sem ela, o ranking não persiste entre redeploys.')
    console.error('   → No Render: Settings → Environment → variável MONGODB_URI')
    console.error('   → Local: adicione MONGODB_URI no arquivo .env da raiz')
    console.error('════════════════════════════════════════════════════════')
    throw new Error('MONGODB_URI ausente — impossível conectar ao ranking')
  }

  try {
    console.log(`🗄️ [database] conectando ao MongoDB (db: ${NOME_BANCO}, collection: ${NOME_COLECAO})...`)
    clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
    await clienteMongo.connect()
    await clienteMongo.db('admin').command({ ping: 1 })

    const colecao = clienteMongo.db(NOME_BANCO).collection(NOME_COLECAO)

    // Índice único composto: 1 documento por (grupo_id, usuario_id)
    await colecao.createIndex(
      { grupo_id: 1, usuario_id: 1 },
      { unique: true, name: 'idx_ranking_grupo_usuario' }
    )
    // Índice para buscas por grupo ordenadas por total (ranking)
    await colecao.createIndex(
      { grupo_id: 1, total: -1 },
      { name: 'idx_ranking_grupo_total' }
    )

    colecaoCacheada = colecao
    console.log('✅ [database] MongoDB conectado — ranking persiste entre redeploys.')
    return colecaoCacheada
  } catch (erro) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 FALHA AO CONECTAR AO MONGODB (ranking):', erro?.message)
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
// Garante que a conexão está pronta (função exportada para compatibilidade).
// Retorna true se conectou, false se não há MONGODB_URI configurada.
// -------------------------------------------------------------------
async function conectar() {
  try {
    await obterColecaoRanking()
    return true
  } catch (err) {
    return false
  }
}

// -------------------------------------------------------------------
// Normaliza um JID para guardar apenas os dígitos do número
// (remove @, sufixo de dispositivo ":3" e caracteres não numéricos)
// -------------------------------------------------------------------
function normalizarId(jid) {
  return String(jid || '')
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '')
}

// -------------------------------------------------------------------
// RegistrarMensagem: incrementa o contador de 1 usuário em 1 grupo.
// Usa upsert com $inc (atômico) — cria o documento se não existe, ou
// incrementa o campo "total" em 1 se já existe. Também atualiza "nome"
// (caso a pessoa tenha trocado) e "ultimaMensagem".
// -------------------------------------------------------------------
async function registrarMensagem(grupoId, usuarioId, nome) {
  try {
    const colecao = await obterColecaoRanking()
    const idNormalizado = normalizarId(usuarioId)

    await colecao.updateOne(
      { grupo_id: grupoId, usuario_id: idNormalizado },
      {
        $inc: { total: 1 },
        $set: {
          nome: nome || null,
          ultimaMensagem: Date.now()
        }
      },
      { upsert: true }
    )
  } catch (err) {
    console.error('⚠️ [database] falha ao registrar mensagem no ranking:', err?.message)
  }
}

// -------------------------------------------------------------------
// BuscarRanking: retorna os `limite` usuários que MAIS enviaram mensagens
// no grupo `grupoId`.
// ⚠️ Filtro obrigatório por grupo_id — cada grupo tem seu próprio ranking.
// Retorno: [ { usuario_id, nome, total }, ... ] (ordenado do maior p/ menor)
// -------------------------------------------------------------------
async function buscarRanking(grupoId, limite = 10) {
  try {
    const colecao = await obterColecaoRanking()

    const documentos = await colecao
      .find({ grupo_id: grupoId })
      .sort({ total: -1 })
      .limit(limite)
      .toArray()

    // Mantém EXATAMENTE o mesmo formato de retorno do SQLite
    return documentos.map((doc) => ({
      usuario_id: doc.usuario_id,
      nome: doc.nome,
      total: doc.total
    }))
  } catch (err) {
    console.error('⚠️ [database] falha ao buscar ranking:', err?.message)
    return []
  }
}

// -------------------------------------------------------------------
// BuscarEstatisticasUsuario: estatísticas de UM usuário em UM grupo
// (usado pelo /perfil). Retorna:
//   - total         : campo "total" do documento do usuário (ou 0)
//   - posicao       : posição no ranking do grupo (= nº de usuários com
//                     total MAIOR + 1; empates dividem a posição)
//   - totalUsuarios : contagem de documentos distintos daquele grupo
//   - nome          : pushName mais recente do usuário
// Retorna null se o banco não estiver disponível;
// retorna { total: 0, posicao: null, ... } se o usuário ainda não tem
// mensagens registradas (o /perfil mostra os dados básicos mesmo assim).
// -------------------------------------------------------------------
async function buscarEstatisticasUsuario(grupoId, usuarioId) {
  try {
    const colecao = await obterColecaoRanking()
    const alvo = normalizarId(usuarioId)

    // Busca o documento do usuário
    const docUsuario = await colecao.findOne({
      grupo_id: grupoId,
      usuario_id: alvo
    })

    // Conta total de usuários distintos no grupo
    const totalUsuarios = await colecao.countDocuments({ grupo_id: grupoId })

    // Se o usuário não tem documento ainda
    if (!docUsuario) {
      return { total: 0, posicao: null, totalUsuarios, nome: null }
    }

    // Posição = quantos usuários têm total MAIOR + 1 (empates dividem posição)
    const usuariosComTotalMaior = await colecao.countDocuments({
      grupo_id: grupoId,
      total: { $gt: docUsuario.total }
    })
    const posicao = usuariosComTotalMaior + 1

    return {
      total: docUsuario.total,
      posicao,
      totalUsuarios,
      nome: docUsuario.nome || null
    }
  } catch (err) {
    console.error('⚠️ [database] falha ao buscar estatísticas do usuário:', err?.message)
    return null
  }
}

// -------------------------------------------------------------------
// Exporta apenas o que o resto do bot precisa (mesmas funções,
// mesmas assinaturas — implementação interna mudou p/ MongoDB)
// -------------------------------------------------------------------
module.exports = {
  conectar,
  registrarMensagem,
  buscarRanking,
  buscarEstatisticasUsuario,
  normalizarId
}