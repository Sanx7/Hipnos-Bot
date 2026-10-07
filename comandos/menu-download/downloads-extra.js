// ============================================================
// 📥 DOWNLOADS-EXTRA — parte 1/3: base compartilhada (HTTP direto)
// ============================================================
// /insta (instagram, igdl) /igmp3 /twitter (x) /facebook (fb):
// fonte = btch-downloader (JA INSTALADA, v6.3.6, mesma do /pinterest).
// Endpoints HTTP de terceiros, SEM yt-dlp, SEM scraping pesado, SEM
// nova dependencia. Formatos confirmados em sonda real (06/10/2026):
//   - igdl(url) -> { status, result: [{ thumbnail, url }] }
//   - twitter(url) -> { status, title, url: [{hd},{sd}] | string }
//   - fbdown(url) -> { status, Normal_video | HD | hd }
// RISCO RENDER (nao escondido): terceiros nao-oficiais; IP de
// datacenter pode ser bloqueado. Sao "melhor esforco" com erro
// amigavel. /robloxstalk NAO tem esse risco (API OFICIAL Roblox).
// Resiliencia igual /tiktok//pinterest: retry + timeout 25s +
// fallback + erros tipados + finally + thumb ffmpeg + limite 50MB.
// ============================================================

const fs = require('fs')
const os = require('os')
const path = require('path')
const axios = require('axios')
const { igdl, twitter, fbdown } = require('btch-downloader')
const { apagarComRetry, converterParaMp3 } = require('../menu-utilitario/audio-extrator')
const { gerarJpegThumbnail } = require('../menu-fig/webp-animado')

const LIMITE_MB = 50
const LIMITE_BYTES = LIMITE_MB * 1024 * 1024
const TIMEOUT_FONTE_MS = 25000
const TIMEOUT_DOWNLOAD_MS = 120000
const TENTATIVAS_POR_FONTE = 2
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

class ErroDownloadExtra extends Error {
  constructor (mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroDownloadExtra'
    this.tipo = tipo
  }
}

let chamarIgdl = (url) => igdl(url)
let chamarTwitter = (url) => twitter(url)
let chamarFbdown = (url) => fbdown(url)
let baixarHttp = null

function comTimeout (promessa, ms, motivo) {
  let timer = null
  return Promise.race([
    Promise.resolve(promessa),
    new Promise((_res, rej) => {
      timer = setTimeout(() => rej(new ErroDownloadExtra(motivo, 'timeout')), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

async function tentarFonte (rotulo, fn) {
  let ultimo = null
  for (let t = 1; t <= TENTATIVAS_POR_FONTE; t++) {
    try {
      return await comTimeout(fn(), TIMEOUT_FONTE_MS, `${rotulo}: tentativa ${t} passou de 25s`)
    } catch (err) {
      ultimo = err
      console.error(`[dl-extra] ${rotulo} t${t} falhou:`, err?.message || err)
      if (t < TENTATIVAS_POR_FONTE) await new Promise((r) => setTimeout(r, 800 * t))
    }
  }
  throw ultimo
}


function extrairLink (texto, regex) {
  const achado = String(texto || '').match(regex)
  return achado ? achado[0] : null
}

function ehTimeout (err) {
  return (err instanceof ErroDownloadExtra && err.tipo === 'timeout')
    || err?.code === 'ECONNABORTED' || /timeout|timed out|exceeded/i.test(err?.message || '')
}

async function baixarComLimite (url, rotulo, referer, opcoes = {}) {
  rotulo = rotulo || 'midia'
  const get = baixarHttp || axios.get
  const resposta = await get(url, {
    responseType: 'stream',
    timeout: TIMEOUT_DOWNLOAD_MS,
    headers: { 'User-Agent': USER_AGENT, ...(referer ? { Referer: referer } : {}) }
  })
  try {
    const contentType = String(resposta.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase()
    if (opcoes.comMetadados && ehRespostaDeErro(contentType)) {
      throw new ErroDownloadExtra('a CDN devolveu texto/HTML/JSON em vez de mídia', 'fonte')
    }
    const declarado = Number(resposta.headers?.['content-length'])
    if (Number.isFinite(declarado) && declarado > LIMITE_BYTES) {
      throw new ErroDownloadExtra(`${rotulo} passa do limite de ${LIMITE_MB} MB`, 'grande')
    }
    const partes = []
    let total = 0
    await new Promise((resolver, rejeitar) => {
      resposta.data.on('data', (pedaco) => {
        total += pedaco.length
        if (total > LIMITE_BYTES) {
          try { resposta.data.destroy() } catch (e) {}
          rejeitar(new ErroDownloadExtra(`${rotulo} passa do limite de ${LIMITE_MB} MB`, 'grande'))
          return
        }
        partes.push(pedaco)
      })
      resposta.data.on('end', resolver)
      resposta.data.on('error', rejeitar)
    })
    const buffer = Buffer.concat(partes)
    if (!buffer.length) throw new ErroDownloadExtra(`download da ${rotulo} vazio`, 'fonte')
    return opcoes.comMetadados ? { buffer, contentType } : buffer
  } finally {
    try { resposta.data.destroy() } catch (e) {}
  }
}

function ehRespostaDeErro (contentType) {
  return /^text\//.test(contentType) || /(?:json|xml)/.test(contentType)
}

function tipoDeclarado (valor) {
  const tipo = String(valor || '').split(';')[0].trim().toLowerCase()
  if (/^video\//.test(tipo) || ['video', 'mp4', 'mov', 'webm'].includes(tipo)) return 'video'
  if (/^image\//.test(tipo) || ['image', 'imagem', 'photo', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic'].includes(tipo)) return 'imagem'
  return null
}

function tipoDoConteudo (buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'imagem'
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'imagem'
  if (/^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) return 'imagem'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'imagem'
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    // AVIF/HEIF também usam ISO BMFF; não confundir com MP4 de vídeo.
    const brand = buffer.toString('ascii', 8, 12)
    if (/^(avif|avis|heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return 'imagem'
    if (/^(isom|iso[2-9]|mp4[12]|avc1|M4V |qt  )$/.test(brand)) return 'video'
  }
  return null
}

function classificarMidiaInsta (item, contentType, buffer) {
  // Rejeita respostas de erro mesmo quando a API/URL afirma ser vídeo.
  const inicio = buffer.subarray(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart()
  if (ehRespostaDeErro(contentType) || /^(?:<|\{|\[)/.test(inicio)) {
    throw new ErroDownloadExtra('a CDN devolveu HTML/JSON em vez de mídia', 'fonte')
  }
  const tipo = tipoDeclarado(item.tipo) || tipoDeclarado(contentType) || tipoDoConteudo(buffer)
  if (tipo) return tipo
  // A extensão é só fallback; ausência dela não significa imagem.
  let pathname = ''
  try { pathname = new URL(item.url).pathname } catch (e) {}
  if (/\.(mp4|mov|webm)$/i.test(pathname)) return 'video'
  if (/\.(jpe?g|png|gif|webp|avif|heic)$/i.test(pathname)) return 'imagem'
  throw new ErroDownloadExtra('não consegui identificar o tipo da mídia do Instagram', 'fonte')
}

async function enviarMidia (sock, jid, msg, buffer, tipo, legenda, prefixo) {
  const idUnico = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const caminhoTemp = path.join(os.tmpdir(), `${prefixo}_${idUnico}.${tipo === 'video' ? 'mp4' : 'jpg'}`)
  let caminhoThumb = null
  try {
    fs.writeFileSync(caminhoTemp, buffer)
    const thumb = await gerarJpegThumbnail(caminhoTemp, os.tmpdir(), `${prefixo}_${idUnico}`)
    caminhoThumb = thumb.caminho
    const jpegThumbnail = Buffer.from(thumb.base64, 'base64')
    if (tipo === 'video') {
      return await sock.sendMessage(jid, { video: buffer, caption: legenda, mimetype: 'video/mp4', jpegThumbnail }, { quoted: msg })
    }
    return await sock.sendMessage(jid, { image: buffer, caption: legenda, jpegThumbnail }, { quoted: msg })
  } finally {
    await apagarComRetry(caminhoTemp)
    await apagarComRetry(caminhoThumb)
  }
}

// --- Parsers (formatos confirmados em sonda real 06/10/2026) ---
function parseIgdl (resultado) {
  if (!resultado || resultado.status === false) return null
  const lista = Array.isArray(resultado.result) ? resultado.result : []
  const itens = lista
    .filter((i) => i && typeof i.url === 'string' && i.url.length > 0)
    .map((i) => ({
      url: i.url,
      thumb: i.thumbnail || '',
      tipo: i.type || i.mimetype || i.mime_type || i.tipo || '',
      legenda: typeof i.caption === 'string' ? i.caption : typeof i.legenda === 'string' ? i.legenda : ''
    }))
  return itens.length ? itens : null
}

function parseTwitter (resultado) {
  if (!resultado || resultado.status === false) return null
  const u = resultado.url
  let urls = []
  if (typeof u === 'string' && u.length > 0) urls = [u]
  else if (Array.isArray(u)) {
    for (const item of u) {
      if (typeof item === 'string' && item.length > 0) urls.push(item)
      else if (item && typeof item === 'object') {
        for (const v of Object.values(item)) if (typeof v === 'string' && /^https?:\/\//i.test(v)) urls.push(v)
      }
    }
  }
  if (!urls.length) return null
  const hd = urls.find((x) => /1280x720|\bhd\b/i.test(x)) || urls[0]
  return { url: hd, titulo: String(resultado.title || '').trim() }
}

function parseFbdown (resultado) {
  if (!resultado || resultado.status === false) return null
  for (const k of ['HD', 'hd', 'Normal_video', 'normal_video', 'url']) {
    if (typeof resultado[k] === 'string' && resultado[k].length > 0) return { url: resultado[k] }
  }
  return null
}


// --- Regex de dominio (validacao ANTES de processar) ---
const REGEX_INSTA = /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/[^\s/?#]+/i
const REGEX_TWITTER = /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^\s]+\/status\/\d+[^\s]*/i
const REGEX_FACEBOOK = /https?:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch)\/[^\s]+/i

const AVISO = {
  instaUso: '📥 *Como usar o Insta do Hipnos*\n\nEnvie o link junto do comando:\n`/insta https://www.instagram.com/reel/xxxxx/`\n\nAceito foto, video e reel publico (ate 50 MB). 🌙',
  igmp3Uso: '🎵 *Como usar o IgMP3 do Hipnos*\n\nEnvie o link do video/reel junto do comando:\n`/igmp3 https://www.instagram.com/reel/xxxxx/`\n\nDevolvo so o audio em MP3 (ate 50 MB). 🌙',
  twitterUso: '🐦 *Como usar o Twitter do Hipnos*\n\nEnvie o link do post junto do comando:\n`/twitter https://x.com/usuario/status/123.../`\n\nAceito video/gif publico (ate 50 MB). 🌙',
  fbUso: '📘 *Como usar o Facebook do Hipnos*\n\nEnvie o link do video junto do comando:\n`/facebook https://www.facebook.com/watch/?v=.../`\n\nAceito video publico (ate 50 MB). 🌙'
}

function avisoDominio (exemplo, nome) {
  return `❌ *Esse link não é do ${nome}...*\n\nUse \`${exemplo}\` com um link da plataforma certa. 🌙`
}

function avisoFonte (nome) {
  return `❌ *Não consegui baixar esse ${nome} agora...*\n\nPode ser post privado/apagado ou a fonte externa instavel (principalmente em servidor — IP de datacenter as vezes e bloqueado). Tente outro link mais tarde. 🌙`
}

// --- Resolvers com retry+timeout (tentarFonte) + fallback interno ---
async function resolverInsta (link) {
  const r = await tentarFonte('igdl', () => chamarIgdl(link))
  const itens = parseIgdl(r)
  if (!itens) throw new ErroDownloadExtra('sem midia no resultado do instagram', 'sem_midia')
  return itens
}

async function resolverTwitter (link) {
  const r = await tentarFonte('twitter', () => chamarTwitter(link))
  const video = parseTwitter(r)
  if (!video) throw new ErroDownloadExtra('sem video no resultado do twitter', 'sem_midia')
  return video
}

async function resolverFacebook (link) {
  const r = await tentarFonte('fbdown', () => chamarFbdown(link))
  const video = parseFbdown(r)
  if (!video) throw new ErroDownloadExtra('sem video no resultado do facebook', 'sem_midia')
  return video
}


// --- /insta: foto/video/reel ---
async function executarInsta (sock, jid, msg, text) {
  try {
    const bruto = String(text || '')
    if (!/https?:\/\//i.test(bruto)) return await sock.sendMessage(jid, { text: AVISO.instaUso }, { quoted: msg })
    const link = extrairLink(bruto, REGEX_INSTA)
    if (!link) return await sock.sendMessage(jid, { text: avisoDominio('/insta', 'Instagram') }, { quoted: msg })
    let itens
    try {
      itens = await resolverInsta(link)
    } catch (err) {
      console.error('[insta] fonte falhou:', err?.message || err)
      if (ehTimeout(err)) return await sock.sendMessage(jid, { text: '⏳ *O Instagram demorou demais...*\n\nTente de novo em instantes. 🌙' }, { quoted: msg })
      return await sock.sendMessage(jid, { text: avisoFonte('post do Instagram') }, { quoted: msg })
    }
    const primeiro = itens[0]
    const { buffer, contentType } = await baixarComLimite(primeiro.url, 'mídia do Instagram', 'https://www.instagram.com/', { comMetadados: true })
    const tipo = classificarMidiaInsta(primeiro, contentType, buffer)
    await enviarMidia(sock, jid, msg, buffer, tipo, primeiro.legenda || '📸 *Instagram baixado* 🌙', 'insta')
  } catch (err) {
    console.error('[insta] erro:', err?.message || err)
    if (err instanceof ErroDownloadExtra && err.tipo === 'grande') {
      return await sock.sendMessage(jid, { text: `⛔ *Pesado demais...* Limite de *${LIMITE_MB} MB*. 🌙` }, { quoted: msg }).catch(() => {})
    }
    await sock.sendMessage(jid, { text: avisoFonte('post do Instagram') }, { quoted: msg }).catch(() => {})
  }
}

// --- /igmp3: audio do reel/video (mesma extracao, + converterParaMp3) ---
async function executarIgmp3 (sock, jid, msg, text) {
  let caminhoTemp = null
  let caminhoMp3 = null
  try {
    const bruto = String(text || '')
    if (!/https?:\/\//i.test(bruto)) return await sock.sendMessage(jid, { text: AVISO.igmp3Uso }, { quoted: msg })
    const link = extrairLink(bruto, REGEX_INSTA)
    if (!link) return await sock.sendMessage(jid, { text: avisoDominio('/igmp3', 'Instagram') }, { quoted: msg })
    let itens
    try {
      itens = await resolverInsta(link)
    } catch (err) {
      console.error('[igmp3] fonte falhou:', err?.message || err)
      if (ehTimeout(err)) return await sock.sendMessage(jid, { text: '⏳ *O Instagram demorou demais...*\n\nTente de novo em instantes. 🌙' }, { quoted: msg })
      return await sock.sendMessage(jid, { text: avisoFonte('audio do Instagram') }, { quoted: msg })
    }
    const video = itens.find((i) => /\.mp4(\?|#|$)/i.test(i.url)) || itens[0]
    const buffer = await baixarComLimite(video.url, 'video', 'https://www.instagram.com/')
    const idUnico = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    caminhoTemp = path.join(os.tmpdir(), `igmp3_${idUnico}.mp4`)
    caminhoMp3 = path.join(os.tmpdir(), `igmp3_${idUnico}.mp3`)
    fs.writeFileSync(caminhoTemp, buffer)
    await converterParaMp3(caminhoTemp, caminhoMp3)
    if (!fs.existsSync(caminhoMp3) || fs.statSync(caminhoMp3).size === 0) throw new Error('ffmpeg nao gerou o MP3')
    await sock.sendMessage(jid, { audio: fs.readFileSync(caminhoMp3), mimetype: 'audio/mpeg', ptt: false }, { quoted: msg })
  } catch (err) {
    console.error('[igmp3] erro:', err?.message || err)
    if (err?.semAudio) return await sock.sendMessage(jid, { text: '🔇 *Esse video nao tem som...* Tente outro reel. 🌙' }, { quoted: msg }).catch(() => {})
    if (err?.timeout || ehTimeout(err)) return await sock.sendMessage(jid, { text: '⏳ *A conversao demorou demais...* Tente um video menor. 🌙' }, { quoted: msg }).catch(() => {})
    if (err instanceof ErroDownloadExtra && err.tipo === 'grande') {
      return await sock.sendMessage(jid, { text: `⛔ *Pesado demais...* Limite de *${LIMITE_MB} MB*. 🌙` }, { quoted: msg }).catch(() => {})
    }
    await sock.sendMessage(jid, { text: avisoFonte('audio do Instagram') }, { quoted: msg }).catch(() => {})
  } finally {
    if (caminhoTemp) await apagarComRetry(caminhoTemp)
    if (caminhoMp3) await apagarComRetry(caminhoMp3)
  }
}


// --- /twitter e /facebook ---
async function executarTwitter (sock, jid, msg, text) {
  try {
    const bruto = String(text || '')
    if (!/https?:\/\//i.test(bruto)) return await sock.sendMessage(jid, { text: AVISO.twitterUso }, { quoted: msg })
    const link = extrairLink(bruto, REGEX_TWITTER)
    if (!link) return await sock.sendMessage(jid, { text: avisoDominio('/twitter', 'Twitter/X') }, { quoted: msg })
    let video
    try {
      video = await resolverTwitter(link)
    } catch (err) {
      console.error('[twitter] fonte falhou:', err?.message || err)
      if (ehTimeout(err)) return await sock.sendMessage(jid, { text: '⏳ *O X demorou demais...*\n\nTente de novo em instantes. 🌙' }, { quoted: msg })
      return await sock.sendMessage(jid, { text: avisoFonte('video do X') }, { quoted: msg })
    }
    const buffer = await baixarComLimite(video.url, 'video', 'https://x.com/')
    await enviarMidia(sock, jid, msg, buffer, 'video', `🐦 *Video do X baixado*${video.titulo ? `\n📝 ${video.titulo.slice(0, 120)}` : ''} 🌙`, 'twitter')
  } catch (err) {
    console.error('[twitter] erro:', err?.message || err)
    if (err instanceof ErroDownloadExtra && err.tipo === 'grande') {
      return await sock.sendMessage(jid, { text: `⛔ *Pesado demais...* Limite de *${LIMITE_MB} MB*. 🌙` }, { quoted: msg }).catch(() => {})
    }
    await sock.sendMessage(jid, { text: avisoFonte('video do X') }, { quoted: msg }).catch(() => {})
  }
}

async function executarFacebook (sock, jid, msg, text) {
  try {
    const bruto = String(text || '')
    if (!/https?:\/\//i.test(bruto)) return await sock.sendMessage(jid, { text: AVISO.fbUso }, { quoted: msg })
    const link = extrairLink(bruto, REGEX_FACEBOOK)
    if (!link) return await sock.sendMessage(jid, { text: avisoDominio('/facebook', 'Facebook') }, { quoted: msg })
    let video
    try {
      video = await resolverFacebook(link)
    } catch (err) {
      console.error('[facebook] fonte falhou:', err?.message || err)
      if (ehTimeout(err)) return await sock.sendMessage(jid, { text: '⏳ *O Facebook demorou demais...*\n\nTente de novo em instantes. 🌙' }, { quoted: msg })
      return await sock.sendMessage(jid, { text: avisoFonte('video do Facebook') }, { quoted: msg })
    }
    const buffer = await baixarComLimite(video.url, 'video', 'https://www.facebook.com/')
    await enviarMidia(sock, jid, msg, buffer, 'video', '📘 *Video do Facebook baixado* 🌙', 'facebook')
  } catch (err) {
    console.error('[facebook] erro:', err?.message || err)
    if (err instanceof ErroDownloadExtra && err.tipo === 'grande') {
      return await sock.sendMessage(jid, { text: `⛔ *Pesado demais...* Limite de *${LIMITE_MB} MB*. 🌙` }, { quoted: msg }).catch(() => {})
    }
    await sock.sendMessage(jid, { text: avisoFonte('video do Facebook') }, { quoted: msg }).catch(() => {})
  }
}


// --- /robloxstalk: API OFICIAL (sem risco de datacenter) ---
// POST users.roblox.com/v1/usernames/users {usernames:[nome]} -> id
// GET users.roblox.com/v1/users/{id} -> nome/display/criacao/descricao
// GET thumbnails.roblox.com/v1/users/avatar-headshot -> avatar PNG
// Tudo gratuito, sem chave, confirmado em sonda real 06/10/2026.
let buscarRoblox = null

async function robloxApi (metodo, url, dados) {
  const get = baixarHttp || axios.get
  if (metodo === 'post') {
    const post = (baixarHttp && baixarHttp.post) || axios.post
    const r = await post(url, dados, { timeout: TIMEOUT_FONTE_MS, headers: { 'User-Agent': USER_AGENT } })
    return r.data
  }
  const r = await get(url, { timeout: TIMEOUT_FONTE_MS, headers: { 'User-Agent': USER_AGENT }, params: dados })
  return r.data
}

async function resolverRoblox (nome) {
  const fn = buscarRoblox || robloxApi
  const achado = await tentarFonte('roblox-id', () => fn('post', 'https://users.roblox.com/v1/usernames/users', { usernames: [nome], excludeBannedUsers: true }))
  const usuario = achado?.data?.[0]
  if (!usuario || !usuario.id) throw new ErroDownloadExtra('usuario nao encontrado', 'sem_midia')
  const id = usuario.id
  const detalhes = await tentarFonte('roblox-detalhe', () => fn('get', `https://users.roblox.com/v1/users/${id}`))
  let avatar = ''
  try {
    const th = await tentarFonte('roblox-avatar', () => fn('get', 'https://thumbnails.roblox.com/v1/users/avatar-headshot', { userIds: String(id), size: '420x420', format: 'Png', isCircular: 'false' }))
    avatar = th?.data?.[0]?.imageUrl || ''
  } catch (err) {
    console.error('[robloxstalk] avatar falhou (segue sem foto):', err?.message || err)
  }
  return {
    id,
    nome: detalhes?.name || usuario.name || nome,
    display: detalhes?.displayName || usuario.displayName || '',
    criadoEm: detalhes?.created || '',
    descricao: String(detalhes?.description || '').slice(0, 200),
    banido: Boolean(detalhes?.isBanned),
    avatar
  }
}

function formatarDataRoblox (iso) {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch (e) {
    return iso
  }
}

async function executarRobloxstalk (sock, jid, msg, text) {
  try {
    const nome = String(text || '').replace(/^\/\S+\s*/, '').trim().split(/\s+/)[0] || ''
    if (!nome || /https?:\/\//i.test(nome) || nome.length > 20) {
      return await sock.sendMessage(jid, { text: '🧱 *Como usar o Robloxstalk*\n\nEnvie o nome de usuario junto do comando:\n`/robloxstalk Builderman`\n\nMostro ID, criacao da conta e avatar. 🌙' }, { quoted: msg })
    }
    let perfil
    try {
      perfil = await resolverRoblox(nome)
    } catch (err) {
      console.error('[robloxstalk] fonte falhou:', err?.message || err)
      if (ehTimeout(err)) return await sock.sendMessage(jid, { text: '⏳ *O Roblox demorou demais...*\n\nTente de novo em instantes. 🌙' }, { quoted: msg })
      return await sock.sendMessage(jid, { text: `🔎 *Não achei "${nome}" no Roblox...*\n\nConfira a grafia do nome de usuario e tente de novo. 🌙` }, { quoted: msg })
    }
    const linhas = [
      '🧱 *Perfil do Roblox*',
      `👤 Nome: ${perfil.nome}${perfil.display && perfil.display !== perfil.nome ? ` (${perfil.display})` : ''}`,
      `🆔 ID: ${perfil.id}`,
      perfil.criadoEm ? `📅 Conta criada em: ${formatarDataRoblox(perfil.criadoEm)}` : null,
      perfil.banido ? '⛔ Conta banida' : null,
      perfil.descricao ? `📝 ${perfil.descricao}` : null
    ].filter(Boolean)
    const legenda = linhas.join('\n')
    if (perfil.avatar) {
      try {
        const buffer = await baixarComLimite(perfil.avatar, 'avatar', 'https://www.roblox.com/')
        return await enviarMidia(sock, jid, msg, buffer, 'imagem', legenda, 'roblox')
      } catch (err) {
        console.error('[robloxstalk] avatar nao baixou (texto puro):', err?.message || err)
      }
    }
    return await sock.sendMessage(jid, { text: legenda }, { quoted: msg })
  } catch (err) {
    console.error('[robloxstalk] erro:', err?.message || err)
    await sock.sendMessage(jid, { text: '❌ Não consegui consultar o Roblox agora. Tente de novo em instantes. 🌙' }, { quoted: msg }).catch(() => {})
  }
}


// --- Exporta os 5 comandos de link (o loader registra cada item) ---
module.exports = [
  { nome: 'insta', aliases: ['instagram', 'ig'], descricao: 'Baixa foto/video/reel do Instagram a partir do link (ate 50 MB).', executar: executarInsta },
  { nome: 'igmp3', aliases: ['ig-audio', 'instagram-audio','igaudio',], descricao: 'Baixa so o audio (MP3) de um video/reel do Instagram (ate 50 MB).', executar: executarIgmp3 },
  { nome: 'twitter', aliases: ['x', 'twt', 'xdl'], descricao: 'Baixa video/gif do Twitter/X a partir do link (ate 50 MB).', executar: executarTwitter },
  { nome: 'facebook', aliases: ['fb', 'fbdl','face'], descricao: 'Baixa video do Facebook a partir do link (ate 50 MB).', executar: executarFacebook },
  { nome: 'robloxstalk', aliases: ['robloxinfo', 'rbxstalk'], descricao: 'Mostra perfil publico do Roblox (ID, criacao, avatar) a partir do nome.', executar: executarRobloxstalk }
]

module.exports.extrairLink = extrairLink
module.exports.parseIgdl = parseIgdl
module.exports.parseTwitter = parseTwitter
module.exports.parseFbdown = parseFbdown
module.exports.resolverInsta = resolverInsta
module.exports.resolverTwitter = resolverTwitter
module.exports.resolverFacebook = resolverFacebook
module.exports.resolverRoblox = resolverRoblox
module.exports.formatarDataRoblox = formatarDataRoblox
module.exports.baixarComLimite = baixarComLimite
module.exports.enviarMidia = enviarMidia
module.exports.ErroDownloadExtra = ErroDownloadExtra
module.exports.LIMITE_MB = LIMITE_MB
module.exports.LIMITE_BYTES = LIMITE_BYTES
module.exports.REGEX_INSTA = REGEX_INSTA
module.exports.REGEX_TWITTER = REGEX_TWITTER
module.exports.REGEX_FACEBOOK = REGEX_FACEBOOK
module.exports.AVISO = AVISO
module.exports._injetar = (o) => {
  o = o || {}
  if (typeof o.igdl === 'function') chamarIgdl = o.igdl
  if (typeof o.twitter === 'function') chamarTwitter = o.twitter
  if (typeof o.fbdown === 'function') chamarFbdown = o.fbdown
  if (typeof o.roblox === 'function') buscarRoblox = o.roblox
  if (o.baixarHttp) baixarHttp = o.baixarHttp
}
