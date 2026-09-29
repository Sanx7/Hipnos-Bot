// ============================================================
// PARTE 1/4 — cabecalho + data local + captura pura
// ============================================================
// Jornal diario do grupo: captura mensagens de texto em memoria
// (Map por jid) + espelho opcional no Mongo com TTL (sobrevive ao
// restart do Render). Guarda so texto + autor; ignora comandos (/),
// midia sem texto e mensagens vazias.
// Fuso: America/Sao_Paulo (mesmo do restante do projeto).
// ============================================================
const { MongoClient } = require('mongodb')

const FUSO_JORNAL = 'America/Sao_Paulo'
const NOME_BANCO_JORNAL = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO_JORNAL = process.env.MONGODB_COLLECTION_JORNAL || 'jornal_diario'
const MAX_MSG_GRUPO = 500
const MAX_TEXTO_MSG = 500

let clienteJornal = null
let colecaoJornal = null

function chaveDataLocal (agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_JORNAL, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(agora)
  const mapa = {}
  for (const p of partes) mapa[p.type] = p.value
  return mapa.year + '-' + mapa.month + '-' + mapa.day
}

function proximaMeiaNoiteLocal () {
  const agora = new Date()
  const amanha = new Date(agora.getTime() + 24 * 60 * 60 * 1000)
  const chaveAmanha = chaveDataLocal(amanha)
  const [a, m, d] = chaveAmanha.split('-').map(Number)
  const utcMeiaNoite = Date.UTC(a, m - 1, d, 3, 0, 0)
  const diff = Math.max(60 * 1000, utcMeiaNoite - agora.getTime())
  return new Date(agora.getTime() + diff)
}

const acumuladoMemoria = new Map()

function extrairTextoLivre (conteudo) {
  if (!conteudo || typeof conteudo !== 'object') return ''
  const t = conteudo.conversation
    || conteudo.extendedTextMessage?.text
    || conteudo.imageMessage?.caption
    || conteudo.videoMessage?.caption
    || conteudo.documentMessage?.caption
    || ''
  return typeof t === 'string' ? t : ''
}

function deveIgnorar (texto) {
  const t = String(texto || '').trim()
  if (!t) return true
  if (t.startsWith('/')) return true
  return false
}

function registrarNoAcumulado (grupoId, autor, texto) {
  const chave = chaveDataLocal()
  let dia = acumuladoMemoria.get(grupoId)
  if (!dia || dia.data !== chave) dia = { data: chave, mensagens: [] }
  const limpo = String(texto).trim().slice(0, MAX_TEXTO_MSG)
  dia.mensagens.push({ autor: String(autor || 'alguem'), texto: limpo, hora: Date.now() })
  if (dia.mensagens.length > MAX_MSG_GRUPO) {
    dia.mensagens = dia.mensagens.slice(dia.mensagens.length - MAX_MSG_GRUPO)
  }
  acumuladoMemoria.set(grupoId, dia)
  return dia
}

// PARTE 2/4 — Mongo com TTL + leitura + hook do bot
async function obterColecaoJornal () {
  if (colecaoJornal && clienteJornal) {
    try {
      await clienteJornal.db('admin').command({ ping: 1 })
      return colecaoJornal
    } catch (e) {
      try { await clienteJornal.close() } catch (x) {}
      clienteJornal = null
      colecaoJornal = null
    }
  }
  const uri = process.env.MONGODB_URI
  if (!uri) return null
  clienteJornal = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
  await clienteJornal.connect()
  const col = clienteJornal.db(NOME_BANCO_JORNAL).collection(NOME_COLECAO_JORNAL)
  await col.createIndex({ grupo: 1, data: 1 }, { unique: true, name: 'idx_jornal_grupo_data' })
  await col.createIndex({ expiraEm: 1 }, { expireAfterSeconds: 0, name: 'idx_jornal_ttl' })
  colecaoJornal = col
  return col
}

async function espelharNoMongo (grupoId, dia) {
  try {
    const col = await obterColecaoJornal()
    if (!col) return
    await col.updateOne(
      { grupo: grupoId, data: dia.data },
      { $set: { mensagens: dia.mensagens, expiraEm: proximaMeiaNoiteLocal() } },
      { upsert: true }
    )
  } catch (e) {
    console.error('[jornal] aviso: espelho Mongo falhou:', e?.message || e)
  }
}

async function lerAcumulado (grupoId) {
  const chave = chaveDataLocal()
  const dia = acumuladoMemoria.get(grupoId)
  if (dia && dia.data === chave && dia.mensagens.length) return dia
  try {
    const col = await obterColecaoJornal()
    if (!col) return dia && dia.data === chave ? dia : { data: chave, mensagens: [] }
    const doc = await col.findOne({ grupo: grupoId, data: chave })
    if (doc && Array.isArray(doc.mensagens) && doc.mensagens.length) {
      acumuladoMemoria.set(grupoId, { data: chave, mensagens: doc.mensagens.slice(-MAX_MSG_GRUPO) })
      return acumuladoMemoria.get(grupoId)
    }
  } catch (e) {
    console.error('[jornal] aviso: leitura Mongo falhou:', e?.message || e)
  }
  return dia && dia.data === chave ? dia : { data: chave, mensagens: [] }
}

function capturarMensagem (msg, jid) {
  try {
    if (!jid || !String(jid).endsWith('@g.us')) return
    if (!msg || !msg.message) return
    if (msg.key && msg.key.fromMe) return
    const { normalizeMessageContent } = require('@whiskeysockets/baileys')
    const conteudo = normalizeMessageContent(msg.message) || {}
    const tipo = Object.keys(conteudo)[0] || ''
    if (tipo && tipo !== 'conversation' && tipo !== 'extendedTextMessage') {
      const cap = conteudo.imageMessage?.caption || conteudo.videoMessage?.caption || conteudo.documentMessage?.caption
      if (!cap) return
    }
    const texto = extrairTextoLivre(conteudo)
    if (deveIgnorar(texto)) return
    const autor = msg.pushName || 'alguem'
    const dia = registrarNoAcumulado(String(jid), String(autor).slice(0, 60), texto)
    espelharNoMongo(String(jid), dia).catch(() => {})
  } catch (e) {
    console.error('[jornal] captura falhou:', e?.message || e)
  }
}


module.exports = {
  capturarMensagem, lerAcumulado, chaveDataLocal, proximaMeiaNoiteLocal,
  extrairTextoLivre, deveIgnorar, registrarNoAcumulado,
  FUSO_JORNAL, MAX_MSG_GRUPO, MAX_TEXTO_MSG,
  NOME_COLECAO_JORNAL, acumuladoMemoria,
  _injetarColecao: (c) => { colecaoJornal = c || null; clienteJornal = null },
  _limparMemoria: () => acumuladoMemoria.clear()
}
