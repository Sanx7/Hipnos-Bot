// ============================================
// 🎬 TOMP4 — Figurinha animada → Vídeo MP4 (uso LIVRE)
// ============================================
// Converte a figurinha ANIMADA citada em vídeo MP4 comum (sem loop
// "GIF"). Também aceita um vídeo citado (re-encodado p/ MP4 estável).
//
// ⚠️ CAUSA RAIZ DO BUG ANTIGO (igual ao /togif): o ffmpeg embutido NÃO
// decodifica WebP animado (container ANMF) e o fluent-ffmpeg ainda
// pendurava sem disparar 'error' no Windows (banner no stdout). A ponte
// do módulo webp-animado.js (anim_dump → PNGs → ffmpeg MP4) resolve em
// PROCESSO FILHO, com execFile/args em array, timeouts e logs reais.
// ============================================

const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { webpAnimadoParaMp4, webpEhAnimado, rodarExecutavel } = require('./webp-animado')

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
        else console.error('⚠️ tomp4: falha ao apagar', caminho, err?.message)
      }
    }
  })()
}

/** Re-encodação direta de vídeo citado p/ MP4 (ffmpeg decodifica vídeo ok) */
async function reencodarParaMp4(caminhoInput, caminhoMp4) {
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
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=20',
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
  nome: 'tomp4',
  descricao: 'Transforma uma figurinha animada (ou vídeo) em vídeo MP4 comum.',

  async executar(sock, jid, msg, texto) {
    let caminhoInput = null
    let caminhoMp4 = null

    try {
      // 1) 🎯 Exige figurinha (animada) OU vídeo citado (áudio → /tomp3)
      const cotada = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      const stickerMessage = cotada?.stickerMessage
      const videoMessage = cotada?.videoMessage
      const audioMessage = cotada?.audioMessage

      if (!stickerMessage && !videoMessage && !audioMessage) {
        return await sock.sendMessage(jid, {
          text: '🎬 *Falta a mídia...*\n\nResponda (marque) uma figurinha animada (ou um vídeo) com `/tomp4`.'
        }, { quoted: msg })
      }

      if (audioMessage) {
        return await sock.sendMessage(jid, {
          text: '🎵 *Isso é um áudio — não existe imagem pra virar vídeo...*\n\nUse `/tomp3` (responder ao áudio) para extrair o som dele.'
        }, { quoted: msg })
      }

      // 2) ⏳ Sinaliza processamento
      await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {})

      const idUnico = `tomp4-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
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
            text: '🖼️ *Essa figurinha é estática (sem animação)...*\n\nPara ela, use `/toimg` — o /tomp4 só materializa figurinhas ANIMADAS.'
          }, { quoted: msg })
        }

        caminhoInput = path.join(os.tmpdir(), `${idUnico}.webp`)
        fs.writeFileSync(caminhoInput, buffer)

        console.log(`[tomp4] 🌉 ponte anim_dump+ffmpeg sobre webp animado (${buffer.length} bytes)...`)
        const resultado = await webpAnimadoParaMp4(caminhoInput, caminhoMp4, 12)
        console.log(`[tomp4] ✅ MP4 pronto: ${fs.statSync(caminhoMp4).size} bytes (${resultado.quantidadeFrames} frames @ ${resultado.fps}fps)`)
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
        caminhoInput = path.join(os.tmpdir(), `${idUnico}-in.mp4`)
        fs.writeFileSync(caminhoInput, buffer)
        console.log('[tomp4] 🎬 re-encodando vídeo citado...')
        await reencodarParaMp4(caminhoInput, caminhoMp4)
        console.log(`[tomp4] ✅ MP4 pronto: ${fs.statSync(caminhoMp4).size} bytes`)
      }

      // 3) 📤 Envia como VÍDEO COMUM (sem gifPlayback), citando a original
      await sock.sendMessage(jid, {
        video: fs.readFileSync(caminhoMp4),
        caption: '🔮 Aqui está seu vídeo extraído do limbo!'
      }, { quoted: msg })

      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {})
      console.log('[tomp4] ✅ vídeo enviado com sucesso')

    } catch (err) {
      // 🛡️ Nada escapa pro socket: loga o erro REAL e avisa com calma
      console.error('[tomp4] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      if (err?.mensagemExecutavel) {
        console.error('[tomp4] 📎 stderr do conversor:', err.mensagemExecutavel)
      }
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {})
      await sock.sendMessage(jid, {
        text: '❌ Não consegui converter essa mídia agora — o feitiço falhou, mas Hipnos segue de pé. Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    } finally {
      // 🧹 Limpeza SEMPRE — nunca acumula lixo no disco efêmero
      for (const caminho of [caminhoInput, caminhoMp4]) {
        if (caminho) await apagarComRetry(caminho)
      }
    }
  }
}
