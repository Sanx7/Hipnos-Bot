// ============================================================
// PARTE 1/2 — Mongo com TTL ate meia-noite + registro
// ============================================================
// Ao reenviar, salva UM registro por mensagem apagada (SEM buffer de midia:
// so o fato de que era midia + tipo). Mesmo padrao TTL do /jornal
// (captura-diaria.js): expiraEm = proxima meia-noite local.
const { MongoClient } = require('mongodb')

const FUSO_APAGADAS = 'America/Sao_Paulo'
const NOME_BANCO_APAGADAS = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO_APAGADAS = process.env.MONGODB_COLLECTION_APAGADAS || 'apagadas_dia'
const MAX_TEXTO_HISTORICO = 500
const MAX_REGISTROS_GRUPO = 200

let clienteApagadas = null
let colecaoApagadas = null
let modoTesteApagadas = false

function chaveDataLocal(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_APAGADAS, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(agora)
  const mapa = {}
  for (const p of partes) mapa[p.type] = p.value
  return mapa.year + '-' + mapa.month + '-' + mapa.day
}

function proximaMeiaNoiteLocal() {
  const agora = new Date()
  const amanha = new Date(agora.getTime() + 24 * 60 * 60 * 1000)
  const chaveAmanha = chaveDataLocal(amanha)
  const [a, m, d] = chaveAmanha.split('-').map(Number)
  const utcMeiaNoite = Date.UTC(a, m - 1, d, 3, 0, 0)
  const diff = Math.max(60 * 1000, utcMeiaNoite - agora.getTime())
  return new Date(agora.getTime() + diff)
}

async function obterColecaoApagadas() {
  if (colecaoApagadas && !modoTesteApagadas && clienteApagadas) {
    try {
      await clienteApagadas.db('admin').command({ ping: 1 })
      return colecaoApagadas
    } catch (e) {
      try { await clienteApagadas.close() } catch (x) {}
      clienteApagadas = null
      colecaoApagadas = null
    }
  }
  if (modoTesteApagadas && colecaoApagadas) return colecaoApagadas
  const uri = process.env.MONGODB_URI
  if (!uri) return null
  clienteApagadas = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
  await clienteApagadas.connect()
  const col = clienteApagadas.db(NOME_BANCO_APAGADAS).collection(NOME_COLECAO_APAGADAS)
  await col.createIndex({ grupo: 1, data: 1 }, { name: 'idx_apagadas_grupo_data' })
  await col.createIndex({ expiraEm: 1 }, { expireAfterSeconds: 0, name: 'idx_apagadas_ttl' })
  colecaoApagadas = col
  return col
}

module.exports = {
  chaveDataLocal, proximaMeiaNoiteLocal, obterColecaoApagadas,
  registrarApagada, listarDoDia,
  FUSO_APAGADAS, NOME_BANCO_APAGADAS, NOME_COLECAO_APAGADAS,
  MAX_TEXTO_HISTORICO, MAX_REGISTROS_GRUPO,
  _injetarColecao: (c) => {
    if (c) { colecaoApagadas = c; clienteApagadas = null; modoTesteApagadas = true }
    else { colecaoApagadas = null; clienteApagadas = null; modoTesteApagadas = false }
  }
}

// ─── registrarApagada: 1 doc por mensagem apagada (SEM buffer) ───
// { grupo, autor, autorNome, tipo, texto } — nunca lanca.
async function registrarApagada({ grupo, autor, autorNome, tipo, texto }) {
  try {
    const col = await obterColecaoApagadas()
    if (!col) return null
    if (!grupo) return null
    const doc = {
      grupo: String(grupo || ''),
      data: chaveDataLocal(),
      autor: String(autor || ''),
      autorNome: String(autorNome || '').slice(0, 60),
      tipo: String(tipo || 'texto'),
      texto: String(texto || '').slice(0, MAX_TEXTO_HISTORICO),
      horario: Date.now(),
      expiraEm: proximaMeiaNoiteLocal()
    }
    await col.insertOne(doc)
    return doc
  } catch (e) {
    console.error('[apagadas] registro no historico falhou:', e?.message || e)
    return null
  }
}

// ─── listarDoDia(grupo): apagadas de hoje, ordem cronologica ───
async function listarDoDia(grupo) {
  try {
    const col = await obterColecaoApagadas()
    if (!col) return []
    const docs = await col.find(
      { grupo: String(grupo || ''), data: chaveDataLocal() }
    ).sort({ horario: 1 }).toArray()
    return Array.isArray(docs) ? docs.slice(-MAX_REGISTROS_GRUPO) : []
  } catch (e) {
    console.error('[apagadas] leitura do historico falhou:', e?.message || e)
    return []
  }
}
