// ============================================
// 🎨 EFEITOS VISUAIS (menu-efeitos) — leva 2: EFEITOS ESPECIAIS
// ============================================
// 14 comandos novos aplicados em IMAGEM CITADA (reply a foto):
//   - 10 animados (ffmpeg em PROCESSO FILHO, video + gifPlayback: true);
//   - 4 estaticos (jimp/canvas em memoria, image + jpegThumbnail via ffmpeg).
//
// Regra de ouro do projeto (efeitos-imagem.js/meme.js/revelar):
// ffmpeg SEMPRE em PROCESSO FILHO via execFile (args em ARRAY, sem shell).
// A Baileys NUNCA gera thumbnail sozinha (sharp/libvips in-process derruba).
// Limite ~20MB ao baixar + timeout 90s video / 30s thumb + finally limpo.
// Sem reply/midia errada: aviso amigavel, nada escapa para o listener.
//
// Sondas ffmpeg (scripts/sonda-filtros-tmp*.js, build N-92722):
// OK: noise=allf=t, hue, negate/eq, crop tremendo+scale, vignette, rotate,
// tblend, shuffleframes, boxblur, zoompan, drawtext com fontsize por `t`.
// NAO funciona: `perspective` com n/t (so constantes), `rgbashift` com
// expressoes (so constantes), `scale` auto-referente, `geq` sem aspas.
// Por isso os animados por frame usam geq com N entre aspas OU frames
// gerados via canvas + montagem ffmpeg em processo filho.
// ============================================

const {
  downloadContentFromMessage,
  normalizeMessageContent,
  getContentType
} = require('@whiskeysockets/baileys')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { Jimp, JimpMime, loadFont } = require('jimp')
const { SANS_32_WHITE, SANS_64_WHITE } = require('jimp/fonts')
const { createCanvas, loadImage } = require('canvas')

const { caminhoFfmpeg, apagarComRetry } = require('../menu-utilitario/audio-extrator')

const LIMITE_BYTES_IMAGEM = 20 * 1024 * 1024
const TIMEOUT_VIDEO_MS = 90000
const TIMEOUT_THUMB_MS = 30000
const LADO_MAX = 480

const THUMB_FALLBACK_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzU4LjQyLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAEBEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgACAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AD//Z'

class ErroEfeitoVisual extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroEfeitoVisual'
    this.tipo = tipo
  }
}

let baixarMidia = async (imageMessage) => {
  const stream = await downloadContentFromMessage(imageMessage, 'image')
  let buffer = Buffer.from([])
  for await (const parte of stream) {
    buffer = Buffer.concat([buffer, parte])
    if (buffer.length > LIMITE_BYTES_IMAGEM + 1024 * 1024) break
  }
  return buffer
}
let rodarFfmpeg = (args) => new Promise((resolve, reject) => {
  execFile(
    caminhoFfmpeg(),
    args,
    { timeout: TIMEOUT_VIDEO_MS, killSignal: 'SIGKILL', maxBuffer: 10 * 1024 * 1024 },
    (error, stdout, stderr) => {
      if (!error) return resolve({ stdout: stdout || '', stderr: stderr || '' })
      error.mensagemFfmpeg = String(stderr || '').split('\n').filter(Boolean).slice(-3).join(' ')
      reject(error)
    }
  )
})


// --- Foto citada: reply OU legenda direta ---
async function obterFotoCitada(msg) {
  const conteudoMsg = normalizeMessageContent(msg.message) || {}
  const contexto = conteudoMsg.extendedTextMessage?.contextInfo
    || conteudoMsg.imageMessage?.contextInfo
    || conteudoMsg.videoMessage?.contextInfo
  const conteudoCotado = normalizeMessageContent(contexto?.quotedMessage) || {}
  const veioNaLegenda = Boolean(conteudoMsg.imageMessage)
  const origem = veioNaLegenda ? conteudoMsg : conteudoCotado
  if (!origem || typeof origem !== 'object' || !Object.keys(origem).length) {
    throw new ErroEfeitoVisual('sem reply', 'sem_reply')
  }
  const tipo = getContentType(origem)
  const imagem = origem.imageMessage
  if (tipo !== 'imageMessage' || !imagem || typeof imagem !== 'object') {
    throw new ErroEfeitoVisual('nao e imagem', 'midia_errada')
  }
  const buffer = await baixarMidia(imagem)
  if (!buffer || !buffer.length) throw new ErroEfeitoVisual('foto vazia', 'midia_errada')
  if (buffer.length > LIMITE_BYTES_IMAGEM) throw new ErroEfeitoVisual('foto grande', 'grande')
  return { buffer }
}

async function gerarThumbnailJpeg(buffer) {
  const id = `efv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const entrada = path.join(os.tmpdir(), `${id}.png`)
  const saida = path.join(os.tmpdir(), `${id}-thumb.jpg`)
  try {
    fs.writeFileSync(entrada, buffer)
    await new Promise((resolver) => {
      execFile(
        caminhoFfmpeg(),
        ['-y', '-nostdin', '-i', entrada, '-vf', 'scale=64:-1', '-vframes', '1', saida],
        { timeout: TIMEOUT_THUMB_MS, maxBuffer: 10 * 1024 * 1024 },
        () => resolver()
      )
    })
    if (fs.existsSync(saida)) {
      const jpeg = fs.readFileSync(saida)
      if (jpeg.length > 0) return jpeg.toString('base64')
    }
  } catch (err) {
    console.error('[efeitos-visuais] thumb falhou:', err?.message || err)
  } finally {
    await apagarComRetry(entrada)
    await apagarComRetry(saida)
  }
  return THUMB_FALLBACK_JPEG_BASE64
}

async function enviarVideo(sock, jid, msg, buffer, caption) {
  return sock.sendMessage(jid, {
    video: buffer, gifPlayback: true, mimetype: 'video/mp4', caption
  }, { quoted: msg })
}

async function enviarImagem(sock, jid, msg, buffer, caption) {
  const jpegThumbnail = await gerarThumbnailJpeg(buffer)
  return sock.sendMessage(jid, { image: buffer, caption, jpegThumbnail }, { quoted: msg })
}

function avisoPara(nome, err) {
  const tipo = err instanceof ErroEfeitoVisual ? err.tipo : ''
  if (tipo === 'sem_reply') return `🎨 *Falta a foto...*\n\nResponda uma foto com \`/${nome}\`.`
  if (tipo === 'midia_errada') return '🎨 *Isso não é uma foto...*\n\nResponda uma foto com o comando do efeito.'
  if (tipo === 'grande') return '⛔ *Foto grande demais...*\n\nLimite de *20MB*. Mande uma foto menor.'
  if (tipo === 'texto') return `✍️ *Falta o texto...*\n\nUse \`/${nome} <texto>\`.`
  return '❌ Não consegui aplicar o efeito agora. Tente novamente em instantes.'
}

async function avisar(sock, jid, msg, err, nome) {
  console.error(`[efeitos-visuais] 💥 ${nome}:`, err?.stack || err)
  if (err?.mensagemFfmpeg) console.error('[efeitos-visuais] stderr:', err.mensagemFfmpeg)
  await sock.sendMessage(jid, { text: avisoPara(nome, err) }, { quoted: msg }).catch(() => {})
}


// --- Nucleo video: imagem -> MP4 (loop + filtro) ---
async function imagemParaVideo(bufferFoto, vf, opts) {
  const duracao = (opts && opts.duracao) || 2
  const fps = (opts && opts.fps) || 25
  const id = `efv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const caminhoIn = path.join(os.tmpdir(), `${id}-in.png`)
  const caminhoOut = path.join(os.tmpdir(), `${id}-out.mp4`)
  try {
    let normalizada = bufferFoto
    try {
      const img = await Jimp.read(bufferFoto)
      const maior = Math.max(img.width, img.height)
      if (maior > LADO_MAX) {
        if (img.width >= img.height) img.resize({ w: LADO_MAX, h: Jimp.AUTO })
        else img.resize({ w: Jimp.AUTO, h: LADO_MAX })
      }
      normalizada = await img.getBuffer(JimpMime.png)
    } catch (eN) {
      console.error('[efeitos-visuais] jimp falhou:', eN?.message || eN)
    }
    fs.writeFileSync(caminhoIn, normalizada)
    await rodarFfmpeg([
      '-y', '-nostdin', '-loop', '1', '-framerate', String(fps), '-i', caminhoIn,
      '-vf', `${vf},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      '-t', String(duracao), '-r', String(fps), '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-movflags', '+faststart', '-an', caminhoOut
    ])
    if (!fs.existsSync(caminhoOut) || fs.statSync(caminhoOut).size === 0) {
      throw new ErroEfeitoVisual('ffmpeg vazio', 'processo')
    }
    return fs.readFileSync(caminhoOut)
  } finally {
    await apagarComRetry(caminhoIn)
    await apagarComRetry(caminhoOut)
  }
}

// --- Nucleo frames: quadros canvas -> MP4 ---
async function framesParaVideo(frames, opts) {
  const fps = (opts && opts.fps) || 12
  const id = `efv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const pasta = path.join(os.tmpdir(), `${id}-frames`)
  const caminhoOut = path.join(os.tmpdir(), `${id}-out.mp4`)
  try {
    fs.mkdirSync(pasta, { recursive: true })
    frames.forEach((buf, i) => fs.writeFileSync(path.join(pasta, `f-${String(i).padStart(3, '0')}.png`), buf))
    await rodarFfmpeg([
      '-y', '-nostdin', '-framerate', String(fps), '-i', path.join(pasta, 'f-%03d.png'),
      '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
      '-movflags', '+faststart', caminhoOut
    ])
    if (!fs.existsSync(caminhoOut) || fs.statSync(caminhoOut).size === 0) {
      throw new ErroEfeitoVisual('ffmpeg vazio', 'processo')
    }
    return fs.readFileSync(caminhoOut)
  } finally {
    try { fs.rmSync(pasta, { recursive: true, force: true }) } catch (_) {}
    await apagarComRetry(caminhoOut)
  }
}

async function carregarFoto(bufferFoto, lado) {
  const img = await loadImage(bufferFoto)
  const max = lado || LADO_MAX
  const escala = Math.min(1, max / Math.max(img.width, img.height))
  const w = Math.max(2, Math.round(img.width * escala))
  const h = Math.max(2, Math.round(img.height * escala))
  const canvas = createCanvas(w, h)
  canvas.getContext('2d').drawImage(img, 0, 0, w, h)
  return { canvas, w, h }
}

function comandoVideo(cfg) {
  return {
    nome: cfg.nome, aliases: cfg.aliases, descricao: cfg.descricao, categoria: 'fig',
    async executar(sock, jid, msg) {
      try {
        const { buffer } = await obterFotoCitada(msg)
        await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {})
        const video = await imagemParaVideo(buffer, cfg.filtro, { duracao: cfg.duracao, fps: cfg.fps })
        await enviarVideo(sock, jid, msg, video, cfg.legenda)
        await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {})
      } catch (err) {
        await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {})
        await avisar(sock, jid, msg, err, cfg.nome)
      }
    }
  }
}

function comandoFrames(cfg) {
  return {
    nome: cfg.nome, aliases: cfg.aliases, descricao: cfg.descricao, categoria: 'fig',
    async executar(sock, jid, msg) {
      try {
        const { buffer } = await obterFotoCitada(msg)
        await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {})
        const frames = await cfg.gerar(buffer)
        const video = await framesParaVideo(frames, { fps: cfg.fps || 12 })
        await enviarVideo(sock, jid, msg, video, cfg.legenda)
        await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {})
      } catch (err) {
        await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {})
        await avisar(sock, jid, msg, err, cfg.nome)
      }
    }
  }
}

function comandoEstatico(cfg) {
  return {
    nome: cfg.nome, aliases: cfg.aliases, descricao: cfg.descricao, categoria: 'fig',
    async executar(sock, jid, msg) {
      try {
        const { buffer } = await obterFotoCitada(msg)
        const saida = await cfg.compor(buffer)
        await enviarImagem(sock, jid, msg, saida, cfg.legenda)
      } catch (err) {
        await avisar(sock, jid, msg, err, cfg.nome)
      }
    }
  }
}


// --- 1. glitchgif: blocos deslocados + RGB tremendo ---
async function gerarGlitch(bufferFoto) {
  const base = await carregarFoto(bufferFoto)
  const w = base.w
  const h = base.h
  const ctxBase = base.canvas.getContext('2d')
  const dadosBase = ctxBase.getImageData(0, 0, w, h)
  const frames = []
  const N = 10
  for (let f = 0; f < N; f++) {
    const c = createCanvas(w, h)
    const ctx = c.getContext('2d')
    ctx.putImageData(dadosBase, 0, 0)
    const off = 3 + Math.round(6 * Math.abs(Math.sin((f / N) * Math.PI * 2)))
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = 0.55
    ctx.drawImage(base.canvas, off, 0)
    ctx.drawImage(base.canvas, -off, 0)
    ctx.restore()
    const fatias = 3 + (f % 3)
    for (let s = 0; s < fatias; s++) {
      const y = Math.abs((f * 37 + s * 53) % h)
      const alt = 6 + ((f * 13 + s * 29) % Math.max(8, Math.floor(h / 12)))
      const dx = ((f * 31 + s * 47) % 2 === 0 ? 1 : -1) * (8 + ((f * 17 + s * 23) % 28))
      try {
        const faixa = ctx.getImageData(0, y, w, Math.min(alt, h - y))
        ctx.putImageData(faixa, dx, y)
      } catch (_) {}
    }
    if (f % 3 === 0) {
      ctx.fillStyle = 'rgba(0,255,255,0.12)'
      ctx.fillRect(0, (f * 61) % h, w, 3)
      ctx.fillStyle = 'rgba(255,0,255,0.10)'
      ctx.fillRect(0, (f * 91 + 40) % h, w, 2)
    }
    frames.push(c.toBuffer('image/png'))
  }
  return frames
}

// --- 2. rotacao3d: giro pseudo-3D no eixo Y ---
async function gerarRotacao3d(bufferFoto) {
  const base = await carregarFoto(bufferFoto)
  const w = base.w
  const h = base.h
  const frames = []
  const N = 16
  for (let f = 0; f < N; f++) {
    const ang = (f / (N - 1)) * Math.PI * 2
    const fator = Math.abs(Math.cos(ang))
    const larg = Math.max(2, Math.round(w * (0.08 + 0.92 * fator)))
    const c = createCanvas(w, h)
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, w, h)
    const x0 = Math.round((w - larg) / 2)
    ctx.drawImage(base.canvas, x0, 0, larg, h)
    const sombra = Math.round(120 * (1 - fator))
    if (sombra > 4) {
      const g = ctx.createLinearGradient(x0, 0, x0 + larg, 0)
      g.addColorStop(0, `rgba(0,0,0,${(sombra / 255).toFixed(2)})`)
      g.addColorStop(0.5, 'rgba(0,0,0,0)')
      g.addColorStop(1, `rgba(0,0,0,${(sombra / 255).toFixed(2)})`)
      ctx.fillStyle = g
      ctx.fillRect(x0, 0, larg, h)
    }
    frames.push(c.toBuffer('image/png'))
  }
  return frames
}

// --- 5. fogogif: chamas na base (particula sintetica) ---
async function gerarFogo(bufferFoto) {
  const base = await carregarFoto(bufferFoto)
  const w = base.w
  const h = base.h
  const frames = []
  const N = 10
  const topoFogo = Math.floor(h * 0.62)
  for (let f = 0; f < N; f++) {
    const c = createCanvas(w, h)
    const ctx = c.getContext('2d')
    ctx.drawImage(base.canvas, 0, 0)
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    const camadas = [
      { cor: 'rgba(255,60,0,0.55)', amp: 16, comp: 90, alt: h - topoFogo },
      { cor: 'rgba(255,140,0,0.55)', amp: 12, comp: 70, alt: (h - topoFogo) * 0.7 },
      { cor: 'rgba(255,220,80,0.6)', amp: 8, comp: 55, alt: (h - topoFogo) * 0.45 }
    ]
    camadas.forEach((cam, ci) => {
      ctx.fillStyle = cam.cor
      ctx.beginPath()
      ctx.moveTo(0, h)
      for (let px = 0; px <= w; px += 4) {
        const y = topoFogo + (h - topoFogo - cam.alt)
          + cam.amp * Math.sin((2 * Math.PI * px) / cam.comp + (2 * Math.PI * (f + ci * 3)) / N)
          + 3 * Math.sin((2 * Math.PI * px) / 23 + f)
        ctx.lineTo(px, Math.max(0, y))
      }
      ctx.lineTo(w, h)
      ctx.closePath()
      ctx.fill()
    })
    ctx.restore()
    frames.push(c.toBuffer('image/png'))
  }
  return frames
}


// --- 7. derreter: escorre para baixo ---
async function gerarDerreter(bufferFoto) {
  const base = await carregarFoto(bufferFoto)
  const w = base.w
  const h = base.h
  const dados = base.canvas.getContext('2d').getImageData(0, 0, w, h)
  const frames = []
  const N = 10
  for (let f = 0; f < N; f++) {
    const p = f / (N - 1)
    const c = createCanvas(w, h)
    const ctx = c.getContext('2d')
    const saida = ctx.createImageData(w, h)
    const maxDesl = Math.floor(h * 0.35 * p)
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const desl = Math.floor(maxDesl * Math.pow(xx / w, 1.5) * (0.4 + 0.6 * (yy / h)))
        const yo = yy - desl < 0 ? 0 : yy - desl
        const src = yo * w + xx
        const dst = yy * w + xx
        saida.data[dst * 4] = dados.data[src * 4]
        saida.data[dst * 4 + 1] = dados.data[src * 4 + 1]
        saida.data[dst * 4 + 2] = dados.data[src * 4 + 2]
        saida.data[dst * 4 + 3] = 255
      }
    }
    ctx.putImageData(saida, 0, 0)
    frames.push(c.toBuffer('image/png'))
  }
  return frames
}

// --- 8. naoolhe: estatica com flashes da real ---
async function gerarNaoOlhe(bufferFoto) {
  const base = await carregarFoto(bufferFoto)
  const w = base.w
  const h = base.h
  const dados = base.canvas.getContext('2d').getImageData(0, 0, w, h)
  const frames = []
  const padrao = [1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1]
  let semente = 1234567
  const aleatorio = () => {
    semente = (semente * 1103515245 + 12345) & 0x7fffffff
    return semente / 0x7fffffff
  }
  for (const tipo of padrao) {
    const c = createCanvas(w, h)
    const ctx = c.getContext('2d')
    if (tipo === 0) {
      ctx.putImageData(dados, 0, 0)
    } else {
      const ruidoso = ctx.createImageData(w, h)
      for (let i = 0; i < w * h; i++) {
        const n = Math.floor(aleatorio() * 255)
        ruidoso.data[i * 4] = Math.round(dados.data[i * 4] * 0.45 + n * 0.55)
        ruidoso.data[i * 4 + 1] = Math.round(dados.data[i * 4 + 1] * 0.45 + n * 0.55)
        ruidoso.data[i * 4 + 2] = Math.round(dados.data[i * 4 + 2] * 0.45 + n * 0.55)
        ruidoso.data[i * 4 + 3] = 255
      }
      ctx.putImageData(ruidoso, 0, 0)
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) / 4, w / 2, h / 2, Math.max(w, h) / 1.4)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, 'rgba(0,0,0,0.75)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
    frames.push(c.toBuffer('image/png'))
  }
  return frames
}

// --- 9. falha: blocos congelados + inversao piscando ---
async function gerarFalha(bufferFoto) {
  const base = await carregarFoto(bufferFoto)
  const w = base.w
  const h = base.h
  const dados = base.canvas.getContext('2d').getImageData(0, 0, w, h)
  const frames = []
  const N = 10
  for (let f = 0; f < N; f++) {
    const c = createCanvas(w, h)
    const ctx = c.getContext('2d')
    ctx.putImageData(dados, 0, 0)
    const blocos = 2 + (f % 3)
    for (let b = 0; b < blocos; b++) {
      const yOrig = (f * 47 + b * 71) % h
      const alt = 10 + ((f * 19 + b * 31) % 30)
      const yDst = Math.min(h - alt, yOrig + 20 + ((f * 23 + b * 37) % 60))
      try {
        const faixa = ctx.getImageData(0, yOrig, w, Math.min(alt, h - yOrig))
        ctx.putImageData(faixa, 0, yDst)
      } catch (_) {}
    }
    if (f === 3 || f === 7) {
      const inv = ctx.getImageData(0, 0, w, h)
      for (let i = 0; i < w * h; i++) {
        inv.data[i * 4] = 255 - inv.data[i * 4]
        inv.data[i * 4 + 1] = 255 - inv.data[i * 4 + 1]
        inv.data[i * 4 + 2] = 255 - inv.data[i * 4 + 2]
      }
      ctx.putImageData(inv, 0, 0)
      ctx.fillStyle = 'rgba(255,0,0,0.18)'
      ctx.fillRect(0, 0, w, h)
    }
    if (f % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)'
      for (let l = 0; l < 20; l++) ctx.fillRect(0, (f * 53 + l * 29) % h, w, 1)
    }
    frames.push(c.toBuffer('image/png'))
  }
  return frames
}


// --- 3. textopulsar: drawtext com fontsize animado (sonda 4 OK) ---
function sanitizarTextoFiltro(texto) {
  return String(texto || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/'/g, '')
    .replace(/:/g, ' ')
    .replace(/\\/g, '')
    .trim()
    .slice(0, 60)
}

async function videoTextoPulsar(texto) {
  const limpo = sanitizarTextoFiltro(texto)
  if (!limpo) throw new ErroEfeitoVisual('sem texto', 'texto')
  const id = `efv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const caminhoOut = path.join(os.tmpdir(), `${id}-out.mp4`)
  try {
    const vf = `drawtext=text='${limpo}':fontsize=44+18*sin(2*PI*t*2):fontcolor=white:borderw=2:bordercolor=0x7c3aed:x=(w-text_w)/2:y=(h-text_h)/2,scale=trunc(iw/2)*2:trunc(ih/2)*2`
    await rodarFfmpeg([
      '-y', '-nostdin', '-f', 'lavfi', '-i', 'color=c=0x0b141a:s=480x480:r=25:d=2',
      '-vf', vf, '-t', '2', '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-movflags', '+faststart', '-an', caminhoOut
    ])
    if (!fs.existsSync(caminhoOut) || fs.statSync(caminhoOut).size === 0) {
      throw new ErroEfeitoVisual('ffmpeg vazio', 'processo')
    }
    return fs.readFileSync(caminhoOut)
  } finally {
    await apagarComRetry(caminhoOut)
  }
}

// --- Filtros ffmpeg diretos (todos validados nas sondas) ---
const FILTRO_ONDA = "geq=r='r(X+10*sin(2*PI*Y/70+2*PI*N/25)\\,Y)':g='g(X+10*sin(2*PI*Y/70+2*PI*N/25)\\,Y)':b='b(X+10*sin(2*PI*Y/70+2*PI*N/25)\\,Y)',vibrance=intensity=0.25"
const FILTRO_VHS = 'noise=alls=12:allf=t,hue=s=0.55,eq=brightness=0.03:contrast=1.15,vignette=PI/4,crop=w=iw-16:h=ih-10:x=(iw-ow)/2+8*sin(2*PI*t*7):y=(ih-oh)/2+5*sin(2*PI*t*11)'
const FILTRO_ENTIDADE = 'hue=s=0.35,eq=brightness=-0.12+0.05*sin(2*PI*t*1.5):contrast=1.35,vignette=PI/3,noise=alls=8:allf=t'


// --- 11. conquista: card com icone circular (jimp) ---
async function comporConquista(bufferFoto) {
  const LARG = 640
  const ALT = 200
  const card = new Jimp({ width: LARG, height: ALT, color: 0x141c26ff })
  for (let xx = 0; xx < LARG; xx++) {
    for (let yy = 0; yy < 8; yy++) card.setPixelColor(0xd9a520ff, xx, yy)
  }
  const foto = await Jimp.read(bufferFoto)
  foto.cover({ w: 140, h: 140 })
  foto.circle()
  card.composite(foto, 30, 32)
  const cx = 100
  const cy = 102
  for (let a = 0; a < 360; a += 2) {
    const px = Math.round(cx + 72 * Math.cos((a * Math.PI) / 180))
    const py = Math.round(cy + 72 * Math.sin((a * Math.PI) / 180))
    if (px >= 0 && py >= 0 && px < LARG && py < ALT) card.setPixelColor(0xd9a520ff, px, py)
  }
  const fT = await loadFont(SANS_32_WHITE)
  const fG = await loadFont(SANS_64_WHITE)
  card.print({ font: fT, x: 200, y: 40, text: 'CONQUISTA DESBLOQUEADA' })
  card.print({ font: fG, x: 200, y: 92, text: 'Lenda do Limbo!' })
  return card.getBuffer(JimpMime.png)
}

// --- 12. impostor: astronauta generico com foto de visor ---
async function comporImpostor(bufferFoto) {
  const LADO = 480
  const canvas = createCanvas(LADO, LADO)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0b1026'
  ctx.fillRect(0, 0, LADO, LADO)
  let semente = 987654
  const aleatorio = () => {
    semente = (semente * 1103515245 + 12345) & 0x7fffffff
    return semente / 0x7fffffff
  }
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < 60; i++) ctx.fillRect(Math.floor(aleatorio() * LADO), Math.floor(aleatorio() * LADO), 2, 2)
  const bx = 120
  const by = 90
  const bw = 240
  const bh = 300
  const r = 70
  ctx.fillStyle = '#c1121f'
  ctx.beginPath()
  ctx.moveTo(bx + r, by)
  ctx.lineTo(bx + bw - r, by)
  ctx.arcTo(bx + bw, by, bx + bw, by + r, r)
  ctx.lineTo(bx + bw, by + bh - r)
  ctx.arcTo(bx + bw, by + bh, bx + bw - r, by + bh, r)
  ctx.lineTo(bx + r, by + bh)
  ctx.arcTo(bx, by + bh, bx, by + bh - r, r)
  ctx.lineTo(bx, by + r)
  ctx.arcTo(bx, by, bx + r, by, r)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fillRect(bx + bw - 50, by + 30, 50, bh - 60)
  ctx.fillStyle = '#c1121f'
  ctx.fillRect(bx + 20, by + bh - 10, 70, 60)
  ctx.fillRect(bx + bw - 90, by + bh - 10, 70, 60)
  ctx.fillStyle = '#7a0c14'
  ctx.fillRect(bx - 35, by + 90, 35, 140)
  const img = await loadImage(bufferFoto)
  const vx = bx + 35
  const vy = by + 45
  const vw = bw - 70
  const vh = 110
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(vx, vy, vw, vh, 40)
  ctx.clip()
  const esc = Math.max(vw / img.width, vh / img.height)
  ctx.drawImage(img, vx - ((img.width * esc - vw) / 2), vy - ((img.height * esc - vh) / 2), img.width * esc, img.height * esc)
  ctx.fillStyle = 'rgba(140,200,255,0.35)'
  ctx.beginPath()
  ctx.ellipse(vx + vw * 0.3, vy + vh * 0.3, vw * 0.28, vh * 0.22, -0.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = '#2b2d42'
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.roundRect(vx, vy, vw, vh, 40)
  ctx.stroke()
  return canvas.toBuffer('image/png')
}


// --- 13. cerebro: 4 copias cada vez maiores ---
async function comporCerebro(bufferFoto) {
  const PEQUENO = 130
  const foto = await Jimp.read(bufferFoto)
  const escalas = [1, 1.5, 2.1, 2.8]
  const rotulos = ['foto', 'foto?', 'FOTO?!', 'F O T O']
  const quadros = []
  for (const esc of escalas) {
    const lado = Math.round(PEQUENO * esc)
    const copia = foto.clone()
    copia.cover({ w: lado, h: lado })
    quadros.push(copia)
  }
  const ALT = Math.round(PEQUENO * 2.8) + 60
  const LARG = quadros.reduce((s, q) => s + q.width + 12, 12)
  const meme = new Jimp({ width: LARG, height: ALT, color: 0x000000ff })
  const fonte = await loadFont(SANS_32_WHITE)
  let xx = 12
  for (let i = 0; i < quadros.length; i++) {
    const q = quadros[i]
    meme.composite(q, xx, ALT - 12 - q.height)
    meme.print({ font: fonte, x: xx, y: 8, text: rotulos[i] })
    xx += q.width + 12
  }
  return meme.getBuffer(JimpMime.png)
}

// --- 14. gun: mira sobre a foto ---
async function comporGun(bufferFoto) {
  const img = await loadImage(bufferFoto)
  const LADO = 480
  const escala = Math.max(LADO / img.width, LADO / img.height)
  const canvas = createCanvas(LADO, LADO)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, (LADO - img.width * escala) / 2, (LADO - img.height * escala) / 2, img.width * escala, img.height * escala)
  const cx = LADO / 2 + ((bufferFoto.length % 61) - 30)
  const cy = LADO / 2 + ((bufferFoto.length % 47) - 23)
  ctx.strokeStyle = '#ff0000'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(cx, cy, 70, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, 40, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx - 95, cy)
  ctx.lineTo(cx + 95, cy)
  ctx.moveTo(cx, cy - 95)
  ctx.lineTo(cx, cy + 95)
  ctx.stroke()
  ctx.fillStyle = '#ff0000'
  ctx.beginPath()
  ctx.arc(cx, cy, 6, 0, Math.PI * 2)
  ctx.fill()
  return canvas.toBuffer('image/png')
}


// --- Exporta os 14 comandos (loader registra cada item) ---
module.exports = [
  comandoFrames({ nome: 'glitchgif', descricao: 'Glitch digital animado na foto (responda a foto).', legenda: '📺 Glitch no sinal do limbo', gerar: gerarGlitch, fps: 10 }),
  comandoFrames({ nome: 'rotacao3d', descricao: 'Gira a foto em pseudo-3D (responda a foto).', legenda: '🔄 Girando entre os mundos', gerar: gerarRotacao3d, fps: 8 }),
  {
    nome: 'textopulsar', descricao: 'Texto pulsando em video (ex: /textopulsar bom dia).', categoria: 'fig',
    async executar(sock, jid, msg, texto) {
      try {
        const conteudo = String(texto || '').trim()
        if (!conteudo) throw new ErroEfeitoVisual('sem texto', 'texto')
        await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {})
        const video = await videoTextoPulsar(conteudo)
        await enviarVideo(sock, jid, msg, video, '✨ Texto pulsando no limbo')
        await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {})
      } catch (err) {
        await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {})
        await avisar(sock, jid, msg, err, 'textopulsar')
      }
    }
  },
  comandoVideo({ nome: 'ondasanim', descricao: 'Ondas na agua animadas (responda a foto).', legenda: '🌊 Ondas do sono profundo', filtro: FILTRO_ONDA, duracao: 2, fps: 25 }),
  comandoFrames({ nome: 'fogogif', descricao: 'Chamas animadas na base (responda a foto).', legenda: '🔥 Fogo do limbo', gerar: gerarFogo, fps: 10 }),
  comandoVideo({ nome: 'vhs', descricao: 'Fita VHS antiga (responda a foto).', legenda: '📼 Direto dos anos 90', filtro: FILTRO_VHS, duracao: 2, fps: 25 }),
  comandoFrames({ nome: 'derreter', descricao: 'Derrete a foto p/ baixo (responda a foto).', legenda: '🫠 Derretendo no limbo', gerar: gerarDerreter, fps: 10 }),
  comandoFrames({ nome: 'naoolhe', aliases: ['nao-olhe'], descricao: 'Estatica que revela em flashes (responda a foto).', legenda: '👁️ NAO OLHE...', gerar: gerarNaoOlhe, fps: 6 }),
  comandoFrames({ nome: 'falha', descricao: 'Falha de sistema animada (responda a foto).', legenda: '⚠️ FALHA DE SISTEMA', gerar: gerarFalha, fps: 10 }),
  comandoVideo({ nome: 'entidade', descricao: 'Sombra assombrada (responda a foto).', legenda: '👤 Ela esta atras de voce...', filtro: FILTRO_ENTIDADE, duracao: 2, fps: 25 }),
  comandoEstatico({ nome: 'conquista', descricao: 'Card conquista desbloqueada (responda a foto).', legenda: '🏆 Conquista desbloqueada!', compor: comporConquista }),
  comandoEstatico({ nome: 'impostor', descricao: 'Astronauta com a foto de visor (responda a foto).', legenda: '🚀 Ha um impostor...', compor: comporImpostor }),
  comandoEstatico({ nome: 'cerebro', descricao: 'Cerebro expandindo (responda a foto).', legenda: '🧠 Cerebro expandindo', compor: comporCerebro }),
  comandoEstatico({ nome: 'gun', descricao: 'Mira sobre a foto (responda a foto).', legenda: '🎯 Na mira do limbo', compor: comporGun })
]

module.exports._injetar = (overrides) => {
  overrides = overrides || {}
  if (typeof overrides.baixarMidia === 'function') baixarMidia = overrides.baixarMidia
  if (typeof overrides.rodarFfmpeg === 'function') rodarFfmpeg = overrides.rodarFfmpeg
}

module.exports.compor = {
  glitch: gerarGlitch, rotacao3d: gerarRotacao3d, fogo: gerarFogo,
  derreter: gerarDerreter, naoolhe: gerarNaoOlhe, falha: gerarFalha,
  conquista: comporConquista, impostor: comporImpostor,
  cerebro: comporCerebro, gun: comporGun,
  textoPulsar: videoTextoPulsar, sanitizarTexto: sanitizarTextoFiltro
}
module.exports.ErroEfeitoVisual = ErroEfeitoVisual
module.exports.LIMITE_BYTES_IMAGEM = LIMITE_BYTES_IMAGEM
module.exports.FILTROS = { onda: FILTRO_ONDA, vhs: FILTRO_VHS, entidade: FILTRO_ENTIDADE }
