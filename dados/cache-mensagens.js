// ============================================================
// PARTE 1/3 — constantes + estado + limpeza
// ============================================================
// Guarda TODA mensagem recebida em grupo (texto ou midia) por ~2h, para o
// reenvio automatico recuperar o conteudo no "apagar para todos"
// (protocolMessage REVOKE). Midia so fica em memoria se <= ~5MB.
// So grupos (@g.us), nunca PV. Nunca lanca: captura e acessoria.
const TTL_MS = 2 * 60 * 60 * 1000
const MAX_ENTRADAS = 500
const MAX_MIDIA_BYTES = 5 * 1024 * 1024
const MAX_TEXTO = 2000
const INTERVALO_LIMPEZA_MS = 10 * 60 * 1000

// id da mensagem (msg.key.id) -> entrada
const cache = new Map()

let timerLimpeza = null
let baixarMidia = null

function _definirBaixarMidia(fn) {
  baixarMidia = typeof fn === 'function' ? fn : null
}

function _limparTudo() {
  cache.clear()
}

function tamanho() {
  return cache.size
}

function limparExpiradas(agora = Date.now()) {
  let removidas = 0
  for (const [id, entrada] of cache) {
    if (agora - entrada.criadoEm >= TTL_MS) {
      cache.delete(id)
      removidas += 1
    }
  }
  return removidas
}

function garantirLimpezaPeriodica() {
  if (timerLimpeza) return
  try {
    timerLimpeza = setInterval(() => {
      try { limparExpiradas() } catch (e) {}
    }, INTERVALO_LIMPEZA_MS)
    if (timerLimpeza && typeof timerLimpeza.unref === 'function') timerLimpeza.unref()
  } catch (e) {}
}

function _pararLimpeza() {
  if (timerLimpeza) {
    try { clearInterval(timerLimpeza) } catch (e) {}
    timerLimpeza = null
  }
}

// Desembrulha containers de protocolo (view-once, efemera etc.) sem
// modificar a mensagem original.
function desembrulhar(conteudo) {
  try {
    const { normalizeMessageContent } = require('@whiskeysockets/baileys')
    return normalizeMessageContent(conteudo) || conteudo
  } catch (e) {
    return conteudo
  }
}

function identificarTipo(conteudo) {
  if (!conteudo || typeof conteudo !== 'object') return null
  if (conteudo.conversation || conteudo.extendedTextMessage?.text) return 'texto'
  if (conteudo.imageMessage) return 'imagem'
  if (conteudo.videoMessage) return 'video'
  if (conteudo.audioMessage) return 'audio'
  if (conteudo.documentMessage || conteudo.documentWithCaptionMessage) return 'documento'
  if (conteudo.stickerMessage) return 'figurinha'
  return null
}

function extrairTexto(conteudo) {
  if (!conteudo || typeof conteudo !== 'object') return ''
  const t = conteudo.conversation
    || conteudo.extendedTextMessage?.text
    || conteudo.imageMessage?.caption
    || conteudo.videoMessage?.caption
    || conteudo.documentMessage?.caption
    || conteudo.documentWithCaptionMessage?.message?.documentMessage?.caption
    || ''
  return typeof t === 'string' ? t.slice(0, MAX_TEXTO) : ''
}

// Download real da midia (ou stub injetado nos testes via _definirBaixarMidia).
function resolvedorDownload() {
  if (baixarMidia) return baixarMidia
  try {
    const { downloadMediaMessage } = require('@whiskeysockets/baileys')
    return async (msg) => downloadMediaMessage(msg, 'buffer', {})
  } catch (e) {
    return null
  }
}

module.exports = {
  TTL_MS, MAX_ENTRADAS, MAX_MIDIA_BYTES, MAX_TEXTO, INTERVALO_LIMPEZA_MS,
  cache, tamanho, limparExpiradas, garantirLimpezaPeriodica,
  desembrulhar, identificarTipo, extrairTexto,
  capturarMensagem, buscar, remover,
  _definirBaixarMidia, _limparTudo, _pararLimpeza,
  _temTimer: () => Boolean(timerLimpeza)
}

// ─── capturarMensagem(msg, jid): guarda texto/midia no cache ───
// Assincrona por causa do download da midia. NUNCA lanca nem bloqueia.
// Ignora: PV, mensagens do proprio bot, protocolMessage (revogacao),
// figurinha sem texto util ja cai no tipo 'figurinha' (guarda metadado).
async function capturarMensagem(msg, jid) {
  try {
    garantirLimpezaPeriodica()
    if (!msg || !msg.message) return null
    if (!jid || !String(jid).endsWith('@g.us')) return null
    if (msg.key && msg.key.fromMe) return null
    const id = msg.key && msg.key.id
    if (!id) return null
    const bruto = desembrulhar(msg.message) || {}
    if (bruto.protocolMessage) return null
    const tipo = identificarTipo(bruto)
    if (!tipo) return null
    const texto = extrairTexto(bruto)
    if (tipo === 'texto' && !String(texto || '').trim()) return null
    if (tipo === 'texto' && String(texto || '').trim().startsWith('/')) return null
    const autorJid = msg.key.participant || msg.key.remoteJid || ''
    const entrada = {
      grupoId: String(jid),
      autorJid: String(autorJid || ''),
      autorNome: String(msg.pushName || '').slice(0, 60) || '',
      tipo,
      texto: String(texto || ''),
      buffer: null,
      mime: '',
      grandeDemais: false,
      criadoEm: Date.now()
    }
    if (tipo === 'imagem' || tipo === 'video' || tipo === 'audio' || tipo === 'documento') {
      const baixar = resolvedorDownload()
      if (baixar) {
        try {
          const bruto2 = await baixar(msg)
          const buffer = Buffer.isBuffer(bruto2) ? bruto2 : (bruto2 ? Buffer.from(bruto2) : null)
          if (buffer && buffer.length > 0) {
            if (buffer.length <= MAX_MIDIA_BYTES) {
              entrada.buffer = buffer
              const no = bruto.imageMessage || bruto.videoMessage || bruto.audioMessage
                || bruto.documentMessage || bruto.documentWithCaptionMessage?.message?.documentMessage || {}
              entrada.mime = String(no.mimetype || '')
            } else {
              entrada.grandeDemais = true
            }
          }
        } catch (e) {
          console.error('[cache-mensagens] download falhou (metadado mantido):', e?.message || e)
        }
      }
    }
    cache.set(id, entrada)
    while (cache.size > MAX_ENTRADAS) {
      const maisAntiga = cache.keys().next().value
      cache.delete(maisAntiga)
    }
    return entrada
  } catch (e) {
    console.error('[cache-mensagens] captura falhou (fluxo segue):', e?.message || e)
    return null
  }
}

function buscar(id) {
  const entrada = cache.get(String(id || ''))
  if (!entrada) return null
  if (Date.now() - entrada.criadoEm >= TTL_MS) {
    cache.delete(String(id || ''))
    return null
  }
  return entrada
}

function remover(id) {
  return cache.delete(String(id || ''))
}
