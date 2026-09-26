// ============================================================
// 😜 EMOJIMIX — Parte 1/3: mistura 2 emojis (Google Emoji Kitchen)
// ============================================================
//   /emojimix 😂😭        → imagem combinada (PNG do Google)
//   /emojimix 😂 + 😭     → idem (aceita "+", espaço ou "-")
//   /emojimix fig 😂😭    → figurinha (webp via wa-sticker-formatter)
// Aliases: /mixemoji, /emoji-mix.
//
// Motor: lib emoji-mixer (npm, MIT, dados offline do Emoji Kitchen)
//   getEmojiMixUrl(a, b) → URL https://www.gstatic.com/android/...
//   A URL aponta para o MESMO CDN que o Gboard usa (gstatic).
// Sem key, sem endpoint privado: combinação = metadata + download.
//
// Formatos:
//   - padrão → image PNG (fundo transparente) + jpegThumbnail
//     (ffmpeg em PROCESSO FILHO — regra de ouro do projeto);
//   - "fig"  → sticker webp (wa-sticker-formatter, igual ao /s).
// Sem combinação / emoji inválido / rede fora → aviso amigável.
// ============================================================

const fs = require('fs')
const os = require('os')
const path = require('path')
const axios = require('axios')
const { Sticker, StickerTypes } = require('wa-sticker-formatter')
const { gerarJpegThumbnail } = require('../menu-fig/webp-animado')
const { caminhoFfmpeg, apagarComRetry } = require('../menu-utilitario/audio-extrator')

const TIMEOUT_HTTP_MS = 15000
const LIMITE_BYTES_IMAGEM = 10 * 1024 * 1024
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

const AVISO_USO =
  '😜 *EMOJIMIX*\n\n' +
  'Misture dois emojis numa imagem só (cozinha do Google, igual ao Gboard).\n\n' +
  '*Como usar:*\n' +
  '• `/emojimix 😂😭` — imagem combinada\n' +
  '• `/emojimix 😂 + 😭` — idem (vale espaço, + ou -)\n' +
  '• `/emojimix fig 😂😭` — manda como figurinha'

const AVISO_SEM_COMBINACAO =
  '😢 *Essa mistura ainda não existe na cozinha do Google...*\n\n' +
  'Nem todo par de emojis tem combinação pronta. Tente outro par — ex.: `/emojimix 😂😭`.'

const AVISO_EMOJI_INVALIDO =
  '🤔 *Preciso de dois emojis válidos!*\n\n' +
  'Ex.: `/emojimix 😂😭` ou `/emojimix 😂 + 😭`.'

// ─── 📚 Lib emoji-mixer (ESM) sob demanda ───
let _libMix = null
async function libMix () {
  if (!_libMix) _libMix = await import('emoji-mixer')
  return _libMix
}

// ─── 🔤 Extrai emojis via emoji-regex da própria lib ───
async function extrairEmojis (texto) {
  await libMix()
  const modRegex = await import('emoji-regex')
  const criarRegex = modRegex.default || modRegex
  const matches = String(texto || '').match(criarRegex())
  return (matches || []).map((m) => String(m))
}

// ─── 🧹 Interpreta o pedido ───
// "/emojimix 😂😭" | "/emojimix 😂 + 😭" | "/emojimix fig 😂😭"
function interpretarPedido (texto) {
  const resto = String(texto || '').replace(/^\/\S+\s*/, '').trim()
  const comoFig = /^(fig|figurinha|sticker|s)\b/i.test(resto)
  const semFig = comoFig ? resto.replace(/^(fig|figurinha|sticker|s)\b/i, '').trim() : resto
  return { comoFig, semFig }
}

// ─── 🔗 Monta a URL da mistura (metadata offline da lib) ───
async function montarUrl (a, b) {
  const lib = await libMix()
  const getUrl = lib.default || lib.getEmojiMixUrl
  // Tenta nas duas ordens: a cozinha nem sempre é simétrica.
  try { const u1 = getUrl(a, b); if (u1) return u1 } catch (e) {}
  try { const u2 = getUrl(b, a); if (u2) return u2 } catch (e) {}
  return null
}

// ─── ⬇️ Baixa a imagem (com HEAD de cortesia p/ 404 rápido) ───
async function baixarImagem (url) {
  const resposta = await axios.get(url, {
    responseType: 'arraybuffer', timeout: TIMEOUT_HTTP_MS,
    maxContentLength: LIMITE_BYTES_IMAGEM,
    headers: { 'User-Agent': USER_AGENT, Accept: 'image/png,image/*' }
  })
  const buf = Buffer.from(resposta.data)
  if (!buf.length) throw new Error('imagem vazia')
  return buf
}

let buscarUrl = montarUrl
let baixar = baixarImagem

// ─── 🖼️ Envia como imagem (com thumbnail seguro) ───
async function enviarImagem (sock, jid, msg, buffer, legenda) {
  const idUnico = `emojimix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const caminhoImg = path.join(os.tmpdir(), `${idUnico}.png`)
  let thumb = null
  try {
    fs.writeFileSync(caminhoImg, buffer)
    const mini = await gerarJpegThumbnail(caminhoImg, os.tmpdir(), idUnico)
    thumb = Buffer.from(mini.base64, 'base64')
    return await sock.sendMessage(jid, {
      image: buffer, caption: legenda, mimetype: 'image/png', jpegThumbnail: thumb
    }, { quoted: msg })
  } finally {
    await apagarComRetry(caminhoImg)
    if (thumb && thumb.caminho) await apagarComRetry(thumb.caminho)
  }
}

// ─── 💠 Envia como figurinha (wa-sticker-formatter, igual ao /s) ───
async function enviarFigurinha (sock, jid, msg, buffer) {
  const sticker = new Sticker(buffer, {
    pack: 'Hipnos Bot', author: 'Sombras do Limbo',
    type: StickerTypes.FULL, categories: ['🔮'], id: 'hipnos_emojimix', quality: 80
  })
  const buf = await sticker.toBuffer()
  return await sock.sendMessage(jid, { sticker: buf }, { quoted: msg })
}

// ─── 🎮 Execução principal ───
async function executarMix (sock, jid, msg, texto) {
  const { comoFig, semFig } = interpretarPedido(texto)
  const emojis = await extrairEmojis(semFig)
  if (emojis.length < 2) {
    return await sock.sendMessage(jid, { text: emojis.length === 0 ? AVISO_USO : AVISO_EMOJI_INVALIDO }, { quoted: msg })
  }
  const a = emojis[0]
  const b = emojis[1]
  let url = null
  try {
    url = await buscarUrl(a, b)
  } catch (err) {
    console.error('[emojimix] erro ao montar URL:', err?.message || err)
    return await sock.sendMessage(jid, { text: AVISO_SEM_COMBINACAO }, { quoted: msg })
  }
  if (!url) {
    return await sock.sendMessage(jid, { text: AVISO_SEM_COMBINACAO }, { quoted: msg })
  }
  let buffer = null
  try {
    buffer = await baixar(url)
  } catch (err) {
    const status = err?.response?.status
    console.error('[emojimix] erro ao baixar:', status || err?.message || err)
    if (status === 404) {
      return await sock.sendMessage(jid, { text: AVISO_SEM_COMBINACAO }, { quoted: msg })
    }
    return await sock.sendMessage(jid, {
      text: '🌩️ *A cozinha do Google está fora do ar...*\n\nTente de novo em instantes.'
    }, { quoted: msg })
  }
  const legenda = `😜 ${a} + ${b}`
  if (comoFig) return await enviarFigurinha(sock, jid, msg, buffer)
  return await enviarImagem(sock, jid, msg, buffer, legenda)
}

const comandoEmojimix = {
  nome: 'emojimix',
  aliases: ['mixemoji', 'emoji-mix'],
  descricao: 'Mistura dois emojis numa imagem só (cozinha do Google, igual ao Gboard). Ex.: /emojimix 😂😭 — /emojimix fig 😂😭 manda como figurinha.',
  executar: async function (sock, jid, msg, texto) {
    try {
      return await executarMix(sock, jid, msg, texto)
    } catch (err) {
      console.error('[emojimix] erro:', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras embaralharam os emojis... Tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}

module.exports = [comandoEmojimix]

// Ganchos p/ testes offline (na exportação, não como comando —
// o loader só registra os ITENS do array, então nada vaza p/ o /menu).
module.exports._test = {
  comando: comandoEmojimix,
  interpretarPedido, extrairEmojis, enviarImagem, enviarFigurinha,
  AVISO_USO, AVISO_SEM_COMBINACAO, AVISO_EMOJI_INVALIDO,
  _injetar: (novoBuscar, novoBaixar) => {
    if (novoBuscar) buscarUrl = novoBuscar
    if (novoBaixar) baixar = novoBaixar
  },
  _restaurar: () => { buscarUrl = montarUrl; baixar = baixarImagem }
}
