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
const { randomUUID } = require('node:crypto')

const FUSO_JORNAL = 'America/Sao_Paulo'
const NOME_BANCO_JORNAL = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO_JORNAL = process.env.MONGODB_COLLECTION_JORNAL || 'jornal_diario'
const MAX_MSG_GRUPO = 500
const MAX_TEXTO_MSG = 500

let clienteJornal = null
let colecaoJornal = null
let inicializando = null
let modoTeste = false
// Uma marca por processo/dia, mantida no próprio documento e no mesmo TTL.
// O maior número confirmado impede reaplicar até uma tentativa muito atrasada.
const escritor = randomUUID()
const persistencias = new Map()

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
  if (modoTeste) return colecaoJornal
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
  if (!inicializando) {
    inicializando = (async () => {
      const cliente = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
      try {
        await cliente.connect()
        const col = cliente.db(NOME_BANCO_JORNAL).collection(NOME_COLECAO_JORNAL)
        await col.createIndex({ grupo: 1, data: 1 }, { unique: true, name: 'idx_jornal_grupo_data' })
        await col.createIndex({ expiraEm: 1 }, { expireAfterSeconds: 0, name: 'idx_jornal_ttl' })
        clienteJornal = cliente
        colecaoJornal = col
        return col
      } catch (e) {
        await cliente.close().catch(() => {})
        throw e
      }
    })()
  }
  try { return await inicializando } finally { inicializando = null }
}

function estadoPersistencia (grupoId, data) {
  const chave = JSON.stringify([grupoId, data])
  if (!persistencias.has(chave)) {
    persistencias.set(chave, { grupoId, data, confirmadas: [], pendentes: [], sequencia: 0, carregado: false, carga: null, execucao: null })
  }
  return persistencias.get(chave)
}

function atualizarMemoria (estado) {
  if (estado.data !== chaveDataLocal()) return
  acumuladoMemoria.set(estado.grupoId, {
    data: estado.data,
    mensagens: estado.confirmadas.concat(estado.pendentes.map(p => p.mensagem)).slice(-MAX_MSG_GRUPO)
  })
}

async function carregarHistorico (estado, col) {
  if (estado.carregado) return
  if (!estado.carga) {
    estado.carga = (async () => {
      const doc = await col.findOne({ grupo: estado.grupoId, data: estado.data }, { projection: { mensagens: 1, _jornalRevisao: 1 } })
      estado.confirmadas = Array.isArray(doc?.mensagens) ? doc.mensagens.slice(-MAX_MSG_GRUPO) : []
      estado.revisao = doc?._jornalRevisao ?? 0
      if (!Number.isSafeInteger(estado.revisao) || estado.revisao < 0) throw new Error('Revisão inválida')
      estado.carregado = true
      atualizarMemoria(estado)
    })()
  }
  try { await estado.carga } finally { estado.carga = null }
}

function atualizacaoIncremental (entrada) {
  // Pipeline atômico: conteúdo nunca é interpretado como expressão MongoDB.
  // A sequência avança junto da entrada; repetir o comando vira um no-op.
  return [{ $replaceWith: { $cond: [
    { $or: [
      { $gte: [{ $ifNull: [`$_jornalGravacoes.${escritor}`, 0] }, entrada.sequencia] },
      { $ne: [{ $ifNull: ['$_jornalRevisao', 0] }, entrada.revisao] }
    ] },
    // Se o TTL removeu o documento entre tentativas, um upsert atrasado
    // sem efeito também precisa expirar (não deixar um documento órfão).
    { $mergeObjects: [{ mensagens: { $literal: [] }, expiraEm: { $literal: entrada.expiraEm } }, '$$ROOT'] },
    { $mergeObjects: ['$$ROOT', {
      mensagens: { $slice: [{ $concatArrays: [{ $ifNull: ['$mensagens', []] }, { $literal: [entrada.mensagem] }] }, -MAX_MSG_GRUPO] },
      expiraEm: { $literal: entrada.expiraEm },
      _jornalRevisao: entrada.revisao + 1,
      _jornalGravacoes: { $mergeObjects: [{ $ifNull: ['$_jornalGravacoes', {}] }, { $literal: { [escritor]: entrada.sequencia } }] }
    }] }
  ] } }]
}

function espelharNoMongo (estado) {
  if (estado.execucao) return estado.execucao
  estado.execucao = Promise.resolve().then(async () => {
    const col = await obterColecaoJornal()
    if (!col) return
    await carregarHistorico(estado, col)
    while (estado.pendentes.length) {
      const entrada = estado.pendentes[0]
      // Uma falha nunca deve ressuscitar um documento além da retenção original.
      if (entrada.expiraEm.getTime() <= Date.now()) {
        estado.pendentes.shift()
        continue
      }
      estado.enviando = entrada
      // A revisão impede uma operação antiga de um processo encerrado de
      // inserir conteúdo fora de ordem depois da recuperação por outro processo.
      entrada.revisao ??= estado.revisao
      const atualizacao = atualizacaoIncremental(entrada)
      for (let tentativa = 0; ; tentativa++) {
        try {
          const resultado = await col.updateOne(
            { grupo: estado.grupoId, data: estado.data }, atualizacao, { upsert: true, writeConcern: { w: 'majority' } }
          )
          if (resultado?.acknowledged !== true) throw new Error('Escrita sem confirmação')
          if (!resultado.modifiedCount && !resultado.upsertedCount) {
            const doc = await col.findOne({ grupo: estado.grupoId, data: estado.data }, { projection: { [`_jornalGravacoes.${escritor}`]: 1 } })
            if (!(doc?._jornalGravacoes?.[escritor] >= entrada.sequencia)) throw new Error('Revisão do jornal mudou')
          }
          break
        } catch (e) {
          // Confirmação perdida e corrida de upsert podem repetir exatamente
          // a mesma operação. Após duas falhas, guardar a fila para nova atividade.
          if (tentativa >= 1) throw e
        }
      }
      estado.confirmadas = estado.confirmadas.concat([entrada.mensagem]).slice(-MAX_MSG_GRUPO)
      estado.revisao = entrada.revisao + 1
      estado.pendentes.shift()
      estado.enviando = null
      atualizarMemoria(estado)
    }
  }).catch(() => {
    console.error('[jornal] aviso: persistencia adiada; entradas mantidas em memoria')
  }).finally(() => { estado.execucao = null; estado.enviando = null })
  return estado.execucao
}

function limparPersistenciasExpiradas () {
  const hoje = chaveDataLocal()
  for (const [chave, estado] of persistencias) {
    if (estado.data !== hoje && !estado.execucao && !estado.carga) persistencias.delete(chave)
  }
}

async function lerAcumulado (grupoId) {
  const chave = chaveDataLocal()
  const dia = acumuladoMemoria.get(grupoId)
  const existente = persistencias.get(JSON.stringify([grupoId, chave]))
  if (!existente && dia?.data === chave && dia.mensagens.length) return dia
  const estado = existente || estadoPersistencia(grupoId, chave)
  try {
    if (!estado.carregado) {
      const col = await obterColecaoJornal()
      if (col) await carregarHistorico(estado, col)
    }
    if (estado.pendentes.length) espelharNoMongo(estado)
  } catch (_) {
    console.error('[jornal] aviso: historico Mongo indisponivel')
  }
  const atual = acumuladoMemoria.get(grupoId)
  return atual?.data === chave ? atual : { data: chave, mensagens: [] }
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
    limparPersistenciasExpiradas()
    const dia = registrarNoAcumulado(String(jid), String(autor).slice(0, 60), texto)
    const estado = estadoPersistencia(String(jid), dia.data)
    estado.pendentes.push({ mensagem: { ...dia.mensagens[dia.mensagens.length - 1] }, sequencia: ++estado.sequencia, expiraEm: proximaMeiaNoiteLocal() })
    // Somente as últimas 500 entradas fazem parte do jornal. Preservar também
    // a operação em voo até sua confirmação, sem fila ilimitada durante quedas.
    while (estado.pendentes.length > MAX_MSG_GRUPO + (estado.enviando ? 1 : 0)) {
      estado.pendentes.splice(estado.enviando ? 1 : 0, 1)
    }
    espelharNoMongo(estado)
  } catch (e) {
    console.error('[jornal] captura falhou:', e?.message || e)
  }
}


module.exports = {
  capturarMensagem, lerAcumulado, chaveDataLocal, proximaMeiaNoiteLocal,
  extrairTextoLivre, deveIgnorar, registrarNoAcumulado,
  FUSO_JORNAL, MAX_MSG_GRUPO, MAX_TEXTO_MSG,
  NOME_COLECAO_JORNAL, acumuladoMemoria,
  _injetarColecao: (c) => { modoTeste = true; colecaoJornal = c || null; clienteJornal = null },
  _limparMemoria: () => { acumuladoMemoria.clear(); persistencias.clear() },
  _aguardarPersistencia: () => Promise.all([...persistencias.values()].map(espelharNoMongo))
}
