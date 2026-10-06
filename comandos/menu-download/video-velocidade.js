// ============================================================
// 🎬 VIDEO-VELOCIDADE — reply num video: rapido/lento/contrario
// ============================================================
// /videorapido: setpts=0.5*PTS (2x) + atempo=2 (audio acompanha)
// /videolento: setpts=2*PTS (0.5x) + atempo=0.5
// /videocontrario: reverse + areverse (video E audio de tras p/ frente)
// ffmpeg em PROCESSO FILHO (execFile, args em ARRAY — regra de ouro),
// reply OBRIGATORIO a videoMessage, limite ~60s de entrada, 50MB ao
// baixar, thumbnail jpegThumbnail via ffmpeg, finally sempre limpo,
// nada escapa para o listener.
// ============================================================

const {
  downloadContentFromMessage,
  normalizeMessageContent,
  getContentType
} = require('@whiskeysockets/baileys')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { apagarComRetry, caminhoFfmpeg } = require('../menu-utilitario/audio-extrator')
const { gerarJpegThumbnail } = require('../menu-fig/webp-animado')

const LIMITE_MB = 50
const LIMITE_BYTES = LIMITE_MB * 1024 * 1024
const LIMITE_SEGUNDOS = 60
const TIMEOUT_FFMPEG_MS = 120000

let baixarMidia = (no) => downloadContentFromMessage(no, 'video')
let rodarFfmpeg = (args) => new Promise((resolve, reject) => {
  execFile(
    caminhoFfmpeg(),
    args,
    { timeout: TIMEOUT_FFMPEG_MS, killSignal: 'SIGKILL', maxBuffer: 10 * 1024 * 1024 },
    (error, stdout, stderr) => {
      if (!error) return resolve()
      error.mensagemFfmpeg = String(stderr || '').split('\n').filter(Boolean).slice(-3).join(' ')
      reject(error)
    }
  )
})


const AVISO_SEM_REPLY =
  '🎬 *Falta o video...*\n\nResponda (marque) um video com o comando de velocidade.\n\nEx.: cite o video e escreva `/videorapido`. 🌙'

const AVISO_NAO_VIDEO =
  '🎬 *Isso não é um video...*\n\nResponda (marque) um video com o comando de velocidade. 🌙'

function avisoLongo (segundos) {
  return `⏱️ *Video longo demais...* (${segundos}s)\n\nO limite da velocidade e de *${LIMITE_SEGUNDOS}s*. Mande um trecho menor. 🌙`
}

async function obterVideoCitado (msg) {
  const conteudoMsg = normalizeMessageContent(msg.message) || {}
  const contexto = conteudoMsg.extendedTextMessage?.contextInfo
    || conteudoMsg.imageMessage?.contextInfo
    || conteudoMsg.videoMessage?.contextInfo
  const cotado = normalizeMessageContent(contexto?.quotedMessage) || {}
  if (!Object.keys(cotado).length) return { erro: 'sem_reply' }
  const tipo = getContentType(cotado)
  if (tipo !== 'videoMessage' || !cotado.videoMessage) return { erro: 'nao_video' }
  const segundos = Number(cotado.videoMessage.seconds || 0)
  if (segundos > LIMITE_SEGUNDOS) return { erro: 'longo', segundos }
  return { no: cotado.videoMessage }
}

async function baixarVideo (no) {
  const stream = await baixarMidia(no)
  let buffer = Buffer.from([])
  for await (const parte of stream) {
    buffer = Buffer.concat([buffer, parte])
    if (buffer.length > LIMITE_BYTES) throw new Error('video passa do limite de 50 MB')
  }
  if (!buffer.length) throw new Error('video vazio')
  return buffer
}

function criarHandler (nome, filtro, legenda, emoji) {
  return async function executar (sock, jid, msg) {
    let caminhoIn = null
    let caminhoOut = null
    let caminhoThumb = null
    try {
      const citado = await obterVideoCitado(msg)
      if (citado.erro === 'sem_reply') return await sock.sendMessage(jid, { text: AVISO_SEM_REPLY.replace('/videorapido', `/${nome}`) }, { quoted: msg }).catch(() => {})
      if (citado.erro === 'nao_video') return await sock.sendMessage(jid, { text: AVISO_NAO_VIDEO }, { quoted: msg }).catch(() => {})
      if (citado.erro === 'longo') return await sock.sendMessage(jid, { text: avisoLongo(citado.segundos) }, { quoted: msg }).catch(() => {})
      await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {})
      const buffer = await baixarVideo(citado.no)
      const id = `vvel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      caminhoIn = path.join(os.tmpdir(), `${id}-in.mp4`)
      caminhoOut = path.join(os.tmpdir(), `${id}-out.mp4`)
      fs.writeFileSync(caminhoIn, buffer)
      console.log(`[${nome}] ${emoji} processando (${buffer.length}b, filtro ${filtro})...`)
      await rodarFfmpeg(['-y', '-nostdin', '-i', caminhoIn, '-vf', filtro.v, '-af', filtro.a, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-movflags', '+faststart', caminhoOut])
      if (!fs.existsSync(caminhoOut) || fs.statSync(caminhoOut).size === 0) throw new Error('ffmpeg nao gerou o video')
      const thumb = await gerarJpegThumbnail(caminhoOut, os.tmpdir(), id)
      caminhoThumb = thumb.caminho
      await sock.sendMessage(jid, {
        video: fs.readFileSync(caminhoOut),
        caption: legenda,
        mimetype: 'video/mp4',
        jpegThumbnail: Buffer.from(thumb.base64, 'base64')
      }, { quoted: msg })
      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {})
    } catch (err) {
      console.error(`[${nome}] erro:`, err?.stack || err)
      if (err?.mensagemFfmpeg) console.error(`[${nome}] stderr:`, err.mensagemFfmpeg)
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {})
      await sock.sendMessage(jid, { text: '❌ Não consegui alterar esse video agora. Tente de novo em instantes. 🌙' }, { quoted: msg }).catch(() => {})
    } finally {
      if (caminhoIn) await apagarComRetry(caminhoIn)
      if (caminhoOut) await apagarComRetry(caminhoOut)
      if (caminhoThumb) await apagarComRetry(caminhoThumb)
    }
  }
}

module.exports = [
  { nome: 'videorapido', aliases: ['video-rapido', 'vrapido'], descricao: 'Acelera um video citado em 2x (responda ao video, max 60s).', executar: criarHandler('videorapido', { v: 'setpts=0.5*PTS', a: 'atempo=2' }, '⏩ *Video acelerado (2x)* 🌙', '⏩') },
  { nome: 'videolento', aliases: ['video-lento', 'vlento'], descricao: 'Desacelera um video citado p/ metade da velocidade (max 60s).', executar: criarHandler('videolento', { v: 'setpts=2*PTS', a: 'atempo=0.5' }, '⏪ *Video desacelerado (0.5x)* 🌙', '⏪') },
  { nome: 'videocontrario', aliases: ['video-contrario', 'vreverso', 'video-reverso'], descricao: 'Reverte um video citado de tras p/ frente (max 60s).', executar: criarHandler('videocontrario', { v: 'reverse', a: 'areverse' }, '🔁 *Video ao contrario* 🌙', '🔁') }
]

module.exports.LIMITE_SEGUNDOS = LIMITE_SEGUNDOS
module.exports.LIMITE_BYTES = LIMITE_BYTES
module.exports.AVISO_SEM_REPLY = AVISO_SEM_REPLY
module.exports.AVISO_NAO_VIDEO = AVISO_NAO_VIDEO
module.exports._injetar = (o) => {
  o = o || {}
  if (typeof o.baixarMidia === 'function') baixarMidia = o.baixarMidia
  if (typeof o.rodarFfmpeg === 'function') rodarFfmpeg = o.rodarFfmpeg
}
