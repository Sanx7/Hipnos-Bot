// ============================================
// 😂 MEME — Meme aleatório do Reddit (uso LIVRE)
// ============================================
// GET https://meme-api.com/gimme (sem key, timeout 10s) →
//   { postLink, subreddit, title, url, ups, downs, author, nsfw, ... }
//
// Comportamento:
//   - envia a MÍDIA (url) com o `title` original como caption — o título
//     fica EM INGLÊS de propósito (a graça do meme é da comunidade;
//     tradução quebraria a piada);
//   - 🛡️ filtro de segurança: nsfw === true → pede OUTRO meme (até 3
//     tentativas); se todas vierem nsfw, avisa e não exibe nada;
//   - roteamento por tipo (pela extensão da url):
//       .gif → video com gifPlayback: true (e conversão GIF→MP4 H.264 via
//              ffmpeg em PROCESSO FILHO — GIF cru como vídeo fica borrado e
//              com o ícone "GIF" travado no WhatsApp; mesma receita do /acoes;
//              sem ffmpeg disponível, envia o gif cru mesmo);
//       .mp4 → video comum (mimetype video/mp4);
//       resto → image + caption;
//   - ⚠️ REGRA DE OURO DO PROJETO (nasa.js/perfil/revelar): a mídia é BAIXADA
//     por nós e enviada como BUFFER com jpegThumbnail PRONTO (jimp, JS puro;
//     fallback JPEG 8x8 embutido) — assim a Baileys pula o sharp/libvips
//     NATIVO in-process, causa raiz dos crashes não capturáveis;
//   - axios SEMPRE com timeout — API fora do ar não prende o bot;
//   - qualquer falha → mensagem amigável; NADA escapa para o listener.
// ============================================

const axios = require('axios')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { Jimp, JimpMime } = require('jimp')

// 🛠️ Helpers compartilhados do projeto (caminho do ffmpeg + delete com
// retry p/ Windows) — a MESMA fonte usada pelo /acoes, /pinterest e /tomp3
const { caminhoFfmpeg, apagarComRetry } = require('./audio-extrator')

// ⏳ Timeout das chamadas HTTP (requisito: 10s) — API fora não prende o bot
const TIMEOUT_API_MS = 10000
// 🛡️ Filtro de segurança: nsfw → pede outro, até 3 tentativas
const MAX_TENTATIVAS_NSFW = 3
// 📥 Limite ao baixar a mídia (mesma folga de 25 MB dos demais comandos)
const LIMITE_BYTES_MIDIA = 25 * 1024 * 1024

// 🧩 JPEG 8x8 válido (o mesmo fallback do nasa.js) — usado se até o jimp
// falhar ao gerar a miniatura, para a Baileys NUNCA tocar no sharp nativo
const THUMB_FALLBACK_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzU4LjQyLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQkICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAEBEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgACAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AD//Z'

// 🧨 Erro de domínio do /meme: mensagem amigável direto (sem stack feia)
class ErroMeme extends Error {
  constructor (mensagem) {
    super(mensagem)
    this.name = 'ErroMeme'
  }
}

// ─── 🔌 Busca na Meme API (variável p/ o gancho de teste offline) ───
// Devolve o JSON do meme. Falha de rede/status/timeout → lança.
let buscarMeme = async () => {
  const resposta = await axios.get('https://meme-api.com/gimme', { timeout: TIMEOUT_API_MS })
  return resposta?.data || null
}

// ─── 📥 Baixa a mídia do meme (i.redd.it etc.) como Buffer ───
// >25 MB → erro (a mesma folga de 25 MB do /togif e do /tomp4)
let baixarMidia = async (url) => {
  const resposta = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: TIMEOUT_API_MS,
    maxContentLength: LIMITE_BYTES_MIDIA
  })
  const buffer = Buffer.from(resposta.data || [])
  if (!buffer.length) throw new ErroMeme('a mídia do meme veio vazia (0 bytes)')
  return buffer
}

// 🔌 Gancho dos testes offline (mesmo padrão do _injetarLib do /pinterest):
// injeta funções fake de busca/download — NADA de rede nos testes.
function _injetarBuscas (overrides = {}) {
  if (typeof overrides.buscarMeme === 'function') buscarMeme = overrides.buscarMeme
  if (typeof overrides.baixarMidia === 'function') baixarMidia = overrides.baixarMidia
}

// ─── 🎨 Miniatura PRONTA (jimp, JS puro — 64px, igual ao padrão do WhatsApp) ───
// Evita o sharp/libvips nativo da Baileys (causa raiz dos crashes). NUNCA
// lança: em qualquer falha devolve o JPEG 8x8 embutido.
async function gerarThumbnailBase64 (buffer) {
  try {
    const imagem = await Jimp.read(buffer)
    imagem.cover({ w: 64, h: 64 })
    const jpeg = await imagem.getBuffer(JimpMime.jpeg, { quality: 60 })
    return jpeg.toString('base64')
  } catch (err) {
    console.error('[meme] ⚠️ falha ao gerar a miniatura (usando o fallback 8x8):', err?.message || err)
    return THUMB_FALLBACK_JPEG_BASE64
  }
}

// ─── 🎞️ Converte GIF → MP4 (H.264) via ffmpeg em PROCESSO FILHO ───
// Mesma receita do /acoes (yuv420p + faststart): em MP4 com gifPlayback: true
// a animação roda lisa e sem o ícone "GIF" travado do GIF cru.
function converterGifParaMp4 (caminhoInput, caminhoOutput) {
  return new Promise((resolver, rejeitar) => {
    const args = [
      '-y', '-nostdin',
      '-i', caminhoInput,
      '-movflags', '+faststart',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '26',
      '-an',
      caminhoOutput
    ]
    execFile(caminhoFfmpeg(), args, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }, (erro, stdout, stderr) => {
      if (erro) {
        erro.mensagemFfmpeg = (stderr || '').toString().split('\n').filter(Boolean).slice(-3).join(' ')
        return rejeitar(erro)
      }
      resolver()
    })
  })
}


// ============================================
// 🎯 /meme — executor
// ============================================
module.exports = {
  nome: 'meme',
  descricao: 'Puxa um meme aleatório do Reddit com o título original (imagem, GIF ou vídeo).',

  async executar (sock, jid, msg, texto) {
    let caminhoGif = null
    let caminhoMp4 = null

    try {
      // 1️⃣ 🔍 Busca com filtro de segurança (nsfw → pede outro, até 3 tentativas)
      let meme = null
      for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_NSFW; tentativa++) {
        const candidato = await buscarMeme()

        if (!candidato || !candidato.url || !candidato.title) {
          throw new ErroMeme('a API não retornou um resultado válido')
        }

        if (candidato.nsfw === true) {
          console.log(`[meme] 🛡️ nsfw detectado (r/${candidato.subreddit}) — pedindo outro (tentativa ${tentativa}/${MAX_TENTATIVAS_NSFW})`)
          continue
        }

        meme = candidato
        break
      }

      // 🛡️ Todas as tentativas vieram nsfw → aviso, sem exibir nada
      if (!meme) {
        return await sock.sendMessage(jid, {
          text: '🛡️ *Filtro de segurança ativado...*\n\nSó apareceram memes impróprios agora. Tente novamente em instantes.'
        }, { quoted: msg })
      }

      console.log(`[meme] 😂 r/${meme.subreddit} · ${meme.ups ?? '?'} ups · ${meme.url}`)

      // 2️⃣ 📥 Baixa a mídia por nós (a Baileys não toca no sharp nativo)
      const buffer = await baixarMidia(meme.url)
      console.log(`[meme] 📥 mídia baixada: ${buffer.length} bytes`)

      // 3️⃣ 🚦 Roteamento por tipo (pela extensão da url)
      const urlBaixa = String(meme.url).toLowerCase()
      const ehGif = urlBaixa.endsWith('.gif')
      const ehMp4 = urlBaixa.endsWith('.mp4')

      if (ehGif || ehMp4) {
        // ─── 🎬 GIF/VÍDEO → video (gifPlayback anima o GIF no WhatsApp) ───
        let bufferFinal = buffer
        if (ehGif) {
          // GIF cru como vídeo fica borrado/ícone travado → converte p/ MP4;
          // qualquer falha (sem ffmpeg, gif exótico) → envia o gif cru mesmo.
          try {
            const idUnico = `meme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            caminhoGif = path.join(os.tmpdir(), `${idUnico}.gif`)
            caminhoMp4 = path.join(os.tmpdir(), `${idUnico}.mp4`)
            fs.writeFileSync(caminhoGif, buffer)
            console.log('[meme] 🎞️ convertendo GIF → MP4 (ffmpeg em processo filho)...')
            await converterGifParaMp4(caminhoGif, caminhoMp4)
            const mp4 = fs.readFileSync(caminhoMp4)
            if (mp4 && mp4.length > 0) {
              bufferFinal = mp4
              console.log(`[meme] ✅ conversão OK: ${mp4.length} bytes de MP4`)
            }
          } catch (errConv) {
            console.warn(`[meme] ⚠️ conversão GIF→MP4 falhou — enviando o GIF original: ${errConv?.message || errConv}`)
          }
        }

        await sock.sendMessage(jid, {
          video: bufferFinal,
          gifPlayback: ehGif,
          mimetype: 'video/mp4',
          caption: meme.title // ← título original, EM INGLÊS, sem tradução
        }, { quoted: msg })
      } else {
        // ─── 🖼️ IMAGEM → image + caption (com miniatura pronta) ───
        const jpegThumbnail = await gerarThumbnailBase64(buffer)
        await sock.sendMessage(jid, {
          image: buffer,
          caption: meme.title, // ← título original, EM INGLÊS, sem tradução
          jpegThumbnail        // ← pronta: a Baileys pula o sharp/libvips nativo
        }, { quoted: msg })
      }

      console.log('[meme] ✅ meme enviado')
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa para o socket
      console.error('[meme] 💥 erro capturado (o bot segue vivo):', err?.stack || err)

      const foiTimeout = err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '')
      const aviso = err instanceof ErroMeme
        ? `⛔ *Não consegui puxar o meme...*\n\n${err.message}. Tente novamente em instantes.`
        : foiTimeout
          ? '⏳ *O Reddit demorou demais para responder...*\n\nTente puxar outro meme em instantes.'
          : '⛔ *O oráculo dos memes falhou...*\n\nO Reddit não respondeu agora. Tente novamente em instantes.'

      return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    } finally {
      // 🧹 Limpeza tolerante dos temporários (nunca lança)
      for (const caminho of [caminhoGif, caminhoMp4]) {
        if (caminho) await apagarComRetry(caminho)
      }
    }
  },

  // 🔌 Gancho dos testes offline
  _injetarBuscas
}

