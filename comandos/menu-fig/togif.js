// ============================================
// 🎞️ TOGIF — Figurinha animada → GIF (uso LIVRE)
// ============================================
// Converte a figurinha ANIMADA citada em vídeo MP4 com gifPlayback: true
// (roda em loop como GIF no WhatsApp). Também aceita um vídeo citado
// (reenvia em formato GIF-playback).
//
// ⚠️ CAUSA RAIZ DO BUG ANTIGO: o ffmpeg embutido NÃO decodifica WebP
// animado (container ANMF) — "Invalid data found when processing input".
// A ponte (módulo webp-animado.js) usa o anim_dump da libwebp p/ extrair
// os frames e o ffmpeg p/ montar o MP4 — tudo em PROCESSO FILHO
// (execFile, args em array, sem shell injection), com timeouts e logs do
// stderr reais.
// ============================================

const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { webpAnimadoParaMp4, webpEhAnimado } = require('./webp-animado')

const LIMITE_BYTES = 25 * 1024 * 1024

/** Apaga temporário com retry (EPERM/EBUSY no Windows). NUNCA lança. */
function apagarComRetry(caminho, tentativas = 3) {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms))
  return (async () => {
    for (let i = 0; i < tentativas; i++) {
      try {
        if (!fs.existsSync(caminho)) return
        fs.unlinkSync(caminho)
        return
      } catch (err) {
        if (i < tentativas - 1) await espera(150)
        else console.error('⚠️ togif: falha ao apagar', caminho, err?.message)
      }
    }
  })()
}

/** Re-encodação direta de vídeo citado p/ MP4 (ffmpeg decodifica vídeo ok) */
async function reencodarParaMp4(caminhoInput, caminhoMp4) {
  const { rodarExecutavel } = require('./webp-animado')
  const binFfmpeg = (() => {
    try {
      return require('@ffmpeg-installer/ffmpeg').path
    } catch (err) {
      return 'ffmpeg'
    }
  })()
  await rodarExecutavel(binFfmpeg, [
    '-y', '-nostdin',
    '-i', caminhoInput,
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=15',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-movflags', 'faststart',
    caminhoMp4
  ], 120000)
  if (!fs.existsSync(caminhoMp4) || fs.statSync(caminhoMp4).size === 0) {
    throw new Error('ffmpeg não produziu o MP4 do vídeo')
  }
}

module.exports = {
  nome: 'togif',
  descricao: 'Transforma uma figurinha animada em GIF (vídeo em loop).',

  async executar(sock, jid, msg, texto) {
    let caminhoWebp = null
    let caminhoMp4 = null

    try {
      // 1) 🎯 Exige figurinha (animada) OU vídeo citado
      const cotada = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      const stickerMessage = cotada?.stickerMessage
      const videoMessage = cotada?.videoMessage

      if (!stickerMessage && !videoMessage) {
        return await sock.sendMessage(jid, {
          text: '🎞️ *Falta a mídia...*\n\nResponda (marque) uma figurinha animada (ou um vídeo) com `/togif`.'
        }, { quoted: msg })
      }

      // 2) ⏳ Sinaliza processamento
      await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {})

      const idUnico = `togif-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
      caminhoMp4 = path.join(os.tmpdir(), `${idUnico}.mp4`)

      if (stickerMessage) {
        // ─── CAMINHO 1: figurinha animada → MP4 (ponte anim_dump + ffmpeg) ───
        const stream = await downloadContentFromMessage(stickerMessage, 'image')
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk])
          if (buffer.length > LIMITE_BYTES) {
            throw new Error('A figurinha excede o limite de 25MB suportado.')
          }
        }
        if (buffer.length === 0) {
          throw new Error('A figurinha foi baixada vazia (0 bytes).')
        }

        if (!webpEhAnimado(buffer)) {
          await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {})
          return await sock.sendMessage(jid, {
            text: '🖼️ *Essa figurinha é estática (sem animação)...*\n\nPara ela, use `/toimg` — o /togif só desperta figurinhas ANIMADAS.'
          }, { quoted: msg })
        }

        caminhoWebp = path.join(os.tmpdir(), `${idUnico}.webp`)
        fs.writeFileSync(caminhoWebp, buffer)

        console.log(`[togif] 🌉 ponte anim_dump+ffmpeg sobre webp animado (${buffer.length} bytes)...`)
        const resultado = await webpAnimadoParaMp4(caminhoWebp, caminhoMp4, 12)
        console.log(`[togif] ✅ MP4 pronto: ${fs.statSync(caminhoMp4).size} bytes (${resultado.quantidadeFrames} frames @ ${resultado.fps}fps)`)
      } else {
        // ─── CAMINHO 2: vídeo citado → MP4 (re-encode direto, ffmpeg decodifica) ───
        const stream = await downloadContentFromMessage(videoMessage, 'video')
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk])
          if (buffer.length > LIMITE_BYTES) {
            throw new Error('O vídeo excede o limite de 25MB suportado.')
          }
        }
        if (buffer.length === 0) {
          throw new Error('O vídeo foi baixado vazio (0 bytes).')
        }
        caminhoWebp = path.join(os.tmpdir(), `${idUnico}-in.mp4`)
        fs.writeFileSync(caminhoWebp, buffer)
        console.log('[togif] 🎬 re-encodando vídeo citado p/ GIF-playback...')
        await reencodarParaMp4(caminhoWebp, caminhoMp4)
        console.log(`[togif] ✅ MP4 pronto: ${fs.statSync(caminhoMp4).size} bytes`)
      }

      // 3) 📤 Envia em loop (gifPlayback: true = roda como GIF), citando a original
      await sock.sendMessage(jid, {
        video: fs.readFileSync(caminhoMp4),
        caption: '🔮 Aqui está seu GIF desperto!',
        gifPlayback: true
      }, { quoted: msg })

      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {})
      console.log('[togif] ✅ GIF enviado com sucesso')

    } catch (err) {
      // 🛡️ Nada escapa pro socket: loga o erro REAL e avisa com calma
      console.error('[togif] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      if (err?.mensagemExecutavel) {
        console.error('[togif] 📎 stderr do conversor:', err.mensagemExecutavel)
      }
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {})
      await sock.sendMessage(jid, {
        text: '❌ Não consegui converter essa mídia agora — o feitiço falhou, mas Hipnos segue de pé. Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    } finally {
      // 🧹 Limpeza SEMPRE — nunca acumula lixo no disco efêmero
      for (const caminho of [caminhoWebp, caminhoMp4]) {
        if (caminho) await apagarComRetry(caminho)
      }
    }
  }
}
