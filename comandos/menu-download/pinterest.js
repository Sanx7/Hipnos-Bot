// ============================================================
// 📌 PINTEREST — Download de imagem ou vídeo (btch-downloader)
// ============================================================
// /pinterest (aliases: pin, pindl) <link>
//   Ex.: /pinterest https://pin.it/xxxxx
//        /pinterest https://www.pinterest.com/pin/xxxxx/
//
// - Valida link (pinterest.com | pin.it) por regex.
// - A lib `pinterest` do btch-downloader resolve o pin.it automaticamente
//   (testado ao vivo: aceita https://pin.it/4CVodSq). Se o resultado vier
//   vazio, fazemos um redirect manual via http(s) antes de reenviar.
// - Detecta imagem vs vídeo pelo conteúdo retornado e envia no formato certo.
// - Thumbnail SEMPRE gerada via ffmpeg em PROCESSO FILHO (helper central
//   gerarJpegThumbnail do webp-animado — nunca sharp/libvips in-process),
//   com fallback de JPEG 8x8 embutido caso até o ffmpeg falhe. O
//   jpegThumbnail é entregue SEMPRE no sendMessage: antes, quando o ffmpeg
//   falhava (ex.: o -ss de 1s nunca achava frame em IMAGEM de 1 frame só),
//   a imagem saía SEM thumbnail, a Baileys gerava a miniatura sozinha via
//   sharp/libvips in-process e CRASHAVA o processo inteiro
//   (GLib-GObject-CRITICAL) — sem chance de try/catch.
// - Limite de 50 MB (mesmo padrão do /tomp3 e /tiktok).
// - Erros amigáveis em pt-BR.
// ============================================================

const fs = require('fs')
const os = require('os')
const path = require('path')
const axios = require('axios')
const { pinterest } = require('btch-downloader')
const { apagarComRetry } = require('../menu-utilitario/audio-extrator')
// 🖼️ Helper CENTRAL de thumbnail do projeto (ffmpeg em processo filho +
// fallback de JPEG 8x8 embutido — NUNCA deixa a Baileys usar sharp/libvips)
const { gerarJpegThumbnail } = require('../menu-fig/webp-animado')

// ─── Configurações ───
const LIMITE_MB = 50 // mesmo padrão do /tomp3
const LIMITE_BYTES = LIMITE_MB * 1024 * 1024
const TIMEOUT_DOWNLOAD_MS = 120000
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

// Regex: pinterest.com (incl. subdomínios regionais tipo br./www., /pin/ ou /<id>/) | pin.it curto
const REGEX_LINK_PINTEREST = /https?:\/\/(?:[a-z]{2}\.|www\.)?pinterest\.com\/[^\s]+|https?:\/\/pin\.it\/[^?\s]+/i

// ─── Mensagens (pt-BR, temática onírica) ───
const AVISO_USO =
  "📌 *Como usar o Pinterest do Hipnos*\n\n" +
  "Envie um link de pin junto do comando:\n" +
  "`/pinterest https://pin.it/xxxxx/`\n\n" +
  "Aceito `pinterest.com/pin/...` e links curtos `pin.it`. 🌙"

const AVISO_INVALIDO =
  "❌ O link que você enviou não é um pin do Pinterest válido. Use `/pinterest https://pin.it/xxxxx` ou o link completo do pinterest.com.\n\n" +
  "Se o pin existir, ele volta sem marca d'água. 🌙"

const AVISO_SEM_MIDIA =
  "❌ Não consegui localizar nenhuma imagem ou vídeo nesse pin — pode ter sido deletado ou é um pin sem mídia.\n\n" +
  "Tente outro link: `/pinterest https://pin.it/xxxxx`. 🌙"

const AVISO_GRANDE = (mb) =>
  `⛔ *Esse pin é pesado demais para os portões do sonho...* (~${mb} MB)\nRespeite o limite de ${LIMITE_MB} MB e tente um pin de imagem ou vídeo mais leve. 🌙`

const ERRO_FINAL =
  "❌ Não consegui baixar esse pin do Pinterest no momento. Tente novamente mais tarde ou com outro link. 🌙"

// ─── Erros tipados ───
class ErroPinterest extends Error {
  constructor (mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroPinterest'
    this.tipo = tipo
  }
}

// ─── Extração do link ───
function extrairLink (texto) {
  const achado = String(texto || '').match(REGEX_LINK_PINTEREST)
  return achado ? achado[0] : null
}

// ─── Ponto de injeção para testes offline ───
const chamarLibPadrao = (query) => pinterest(query)
let chamarLib = chamarLibPadrao

// ─── Resolve redirect manual (caso a lib não resolva um pin.it) ───
async function resolverRedirect (link) {
  if (!/pin\.it/i.test(link)) return link
  const lib = link.startsWith('https') ? require('https') : require('http')
  const url = new URL(link)
  return await new Promise((resolver) => {
    const req = lib.request({
      method: 'GET',
      host: url.hostname,
      path: url.pathname + url.search,
      headers: { 'User-Agent': USER_AGENT }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy()
        const destino = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${link.split(':')[0]}://${url.hostname}${res.headers.location}`
        resolver(destino)
      } else {
        res.destroy()
        resolver(link)
      }
    })
    req.on('error', () => resolver(link))
    req.setTimeout(TIMEOUT_DOWNLOAD_MS, () => { try { req.destroy() } catch (e) {} resolver(link) })
    req.end()
  })
}

// ─── Extrai mídia do resultado da lib (estrutura validada ao vivo) ───
// A resposta tem `result.result` (duplo); inner tem `image`, `images.orig`,
// `video_url`, `videos`. Detectamos tipo pela prioridade: vídeo primeiro.
function extrairMedia (resultado) {
  if (!resultado || resultado.status === false) return null
  const inner = resultado?.result?.result || resultado?.result
  if (!inner || typeof inner !== 'object') return null

  let urlVideo = null
  if (typeof inner.video_url === 'string' && inner.video_url.length > 0) {
    urlVideo = inner.video_url
  } else if (inner.videos && typeof inner.videos === 'object') {
    const cand = Object.values(inner.videos).find((v) => typeof v === 'string' && v.length > 0)
    urlVideo = cand || null
  }

  let urlImagem = null
  if (typeof inner.image === 'string' && inner.image.length > 0) urlImagem = inner.image
  else if (inner.images && typeof inner.images === 'object') {
    for (const chave of ['orig', '736x', '564x', '474x', '236x', '170x']) {
      if (inner.images[chave]?.url) { urlImagem = inner.images[chave].url; break }
    }
  }

  const titulo = String(inner.title || inner.description || '').trim()
  const autor = inner.user ? (inner.user.full_name || inner.user.username || '') : ''

  if (urlVideo) return { tipo: 'video', url: urlVideo, titulo, autor }
  if (urlImagem) return { tipo: 'imagem', url: urlImagem, titulo, autor }
  return null
}

// ─── Resolve a mídia do pin (lib → fallback redirect) ───
// Distingue "pin sem mídia" (lib respondeu ok, mas sem imagem/vídeo → null,
// vira AVISO_SEM_MIDIA) de "api fora do ar" (lib falhou → throw tipo 'api',
// vira ERRO_FINAL).
async function resolverMedia (link) {
  let primeiraFalhou = false
  try {
    const resultado = await chamarLib(link)
    const media = extrairMedia(resultado)
    if (media) return media
    if (!resultado || resultado.status === false) primeiraFalhou = true
  } catch (err) {
    console.error('[pinterest] lib lançou:', err?.message || err)
    primeiraFalhou = true
  }

  if (!/pin\.it/i.test(link)) {
    if (primeiraFalhou) throw new ErroPinterest('falha ao consultar a api do pinterest', 'api')
    return null
  }

  let resolvido = null
  try {
    resolvido = await resolverRedirect(link)
  } catch {
    throw new ErroPinterest('falha ao consultar a api do pinterest', 'api')
  }
  if (resolvido === link || !resolvido.startsWith('https://www.pinterest.com')) {
    if (primeiraFalhou) throw new ErroPinterest('falha ao consultar a api do pinterest', 'api')
    return null
  }

  try {
    const resultado2 = await chamarLib(resolvido)
    const media2 = extrairMedia(resultado2)
    if (media2) return media2
    if (!resultado2 || resultado2.status === false) {
      throw new ErroPinterest('falha ao consultar a api do pinterest', 'api')
    }
    return null
  } catch (err) {
    if (err instanceof ErroPinterest) throw err
    console.error('[pinterest] lib (fallback) lançou:', err?.message || err)
    throw new ErroPinterest('falha ao consultar a api do pinterest', 'api')
  }
}

// ─── Baixa um arquivo via axios (stream → buffer), limite 50 MB ───
async function baixarArquivo (url) {
  const resposta = await axios.get(url, {
    responseType: 'stream',
    timeout: TIMEOUT_DOWNLOAD_MS,
    headers: { 'User-Agent': USER_AGENT, Referer: 'https://www.pinterest.com/' }
  })
  try {
    const declarado = Number(resposta.headers?.['content-length'])
    if (Number.isFinite(declarado) && declarado > LIMITE_BYTES) {
      throw new ErroPinterest(`conteúdo de ~${(declarado / 1048576).toFixed(1)} MB excede o limite de ${LIMITE_MB} MB`, 'grande')
    }
    const partes = []
    let total = 0
    await new Promise((resolver, rejeitar) => {
      resposta.data.on('data', (pedaco) => {
        total += pedaco.length
        if (total > LIMITE_BYTES) {
          resposta.data.destroy()
          rejeitar(new ErroPinterest(`conteúdo de ~${(total / 1048576).toFixed(1)} MB excede o limite de ${LIMITE_MB} MB`, 'grande'))
          return
        }
        partes.push(pedaco)
      })
      resposta.data.on('end', resolver)
      resposta.data.on('error', rejeitar)
    })
    return Buffer.concat(partes)
  } finally {
    try { resposta.data.destroy() } catch (e) {}
  }
}

// ─── Monta a legenda do pin ───
function montarLegenda (media) {
  const linhas = ['📌 *Pin do Pinterest baixado*']
  if (media.titulo) linhas.push(`📝 ${media.titulo}`)
  if (media.autor) linhas.push(`👤 ${media.autor}`)
  return linhas.join('\n')
}

// ─── Envia imagem (SEMPRE com thumbnail do ffmpeg — nunca sharp) ───
async function enviarImagem (sock, jid, msg, buffer, media) {
  const idUnico = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const caminhoTemp = path.join(os.tmpdir(), `pinterest_${idUnico}.jpg`)
  let caminhoThumb = null
  try {
    fs.writeFileSync(caminhoTemp, buffer)
    // 🖼️ jpegThumbnail SEMPRE presente: gerado por nós (ffmpeg processo
    // filho) com fallback 8x8 — sem isso a Baileys usaria sharp/libvips
    // in-process e mataria o processo (crash não capturável).
    const thumb = await gerarJpegThumbnail(caminhoTemp, os.tmpdir(), idUnico)
    caminhoThumb = thumb.caminho
    console.log(`[pinterest] 🧯 jpegThumbnail pronto (fonte: ${thumb.fonte}, ${thumb.base64.length} chars base64)`)
    return await sock.sendMessage(jid, {
      image: buffer,
      caption: montarLegenda(media),
      jpegThumbnail: Buffer.from(thumb.base64, 'base64')
    }, { quoted: msg })
  } finally {
    await apagarComRetry(caminhoTemp)
    await apagarComRetry(caminhoThumb)
  }
}

// ─── Envia vídeo (SEMPRE com thumbnail do ffmpeg — nunca sharp) ───
async function enviarVideo (sock, jid, msg, buffer, media) {
  const idUnico = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const caminhoTemp = path.join(os.tmpdir(), `pinterest_${idUnico}.mp4`)
  let caminhoThumb = null
  try {
    fs.writeFileSync(caminhoTemp, buffer)
    // 🖼️ Mesma proteção da imagem: ffmpeg extrai o 1º frame do mp4 em
    // processo filho e entregamos o jpegThumbnail pronto (fallback 8x8).
    const thumb = await gerarJpegThumbnail(caminhoTemp, os.tmpdir(), idUnico)
    caminhoThumb = thumb.caminho
    console.log(`[pinterest] 🧯 jpegThumbnail pronto (fonte: ${thumb.fonte}, ${thumb.base64.length} chars base64)`)
    return await sock.sendMessage(jid, {
      video: buffer,
      caption: montarLegenda(media),
      mimetype: 'video/mp4',
      jpegThumbnail: Buffer.from(thumb.base64, 'base64')
    }, { quoted: msg })
  } finally {
    await apagarComRetry(caminhoTemp)
    await apagarComRetry(caminhoThumb)
  }
}

// ─── Traduz erro tipado em aviso (pt-BR) ───
function avisoParaErro (err) {
  if (err instanceof ErroPinterest && err.tipo === 'uso') return AVISO_INVALIDO
  if (err instanceof ErroPinterest && err.tipo === 'grande') {
    return AVISO_GRANDE(parseFloat(err.message) || 51)
  }
  if (err instanceof ErroPinterest && err.tipo === 'indisponivel') return AVISO_SEM_MIDIA
  return ERRO_FINAL
}

// ─── Executar (padrão do loader: nome/executar) ───
async function executar (sock, jid, msg, text) {
  try {
    const link = extrairLink(text)
    if (!link) {
      // Sem link algum → mostra como usar; com algo parecido com URL → link inválido.
      if (!/https?:\/\//i.test(String(text || ''))) {
        return await sock.sendMessage(jid, { text: AVISO_USO }, { quoted: msg })
      }
      throw new ErroPinterest('link ausente ou inválido', 'uso')
    }

    const media = await resolverMedia(link)
    if (!media) throw new ErroPinterest('sem mídia para este pin', 'indisponivel')

    const buffer = await baixarArquivo(media.url)
    const dadosMedia = { titulo: media.titulo, autor: media.autor }
    if (media.tipo === 'video') {
      await enviarVideo(sock, jid, msg, buffer, dadosMedia)
    } else {
      await enviarImagem(sock, jid, msg, buffer, dadosMedia)
    }
  } catch (err) {
    console.error('[pinterest] erro:', err?.message || err)
    await sock.sendMessage(jid, { text: avisoParaErro(err) }, { quoted: msg }).catch(() => {})
  }
}

module.exports = {
  nome: 'pinterest',
  aliases: ['pin', 'pindl'],
  descricao: "Baixa imagem ou vídeo de um pin do Pinterest sem marca d'água (até 50 MB).",
  executar,
  // Extras internos para os testes offline (padrão do tiktok/velha)
  extrairLink,
  extrairMedia,
  resolverMedia,
  avisoParaErro,
  ErroPinterest,
  _injetarLib: (fn) => { chamarLib = fn || chamarLibPadrao }
}
