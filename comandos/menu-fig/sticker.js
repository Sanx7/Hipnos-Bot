// ============================================
// 📸 STICKER (/s) — Imagens, GIFs e VÍDEOS → Figurinha de WhatsApp
// ============================================
// - Imagens/GIFs → wa-sticker-formatter (como sempre).
// - Vídeo → pipeline com o ffmpeg EMBUTIDO (@ffmpeg-installer/ffmpeg):
//   1) ⏱️ Limite de 10 segundos: se o metadado `seconds` do vídeo passa o
//      limite, rejeitamos pedindo um clipe mais curto (o ffmpeg também
//      aplica `-t 10` como rede de segurança);
//   2) ffmpeg recorta para quadrado 512×512 (com pad negro só para fontes
//      minúsculas), baixa a 12 fps e codifica WEBP animado (encoder
//      libwebp) SEM áudio;
//   3) os metadados do pack ("Hipnos Bot") são injetados com node-webpmux
//      via a classe Exif de wa-sticker-formatter — SEM re-encodear frames
//      (o sharp tardaria/pesaria; o webp do ffmpeg já é figurinha válida);
//   4) se o webp supera ~1 MB (limite típico de figurinha no WhatsApp)
//      re-codificamos a 8 fps e qualidade menor; se ainda assim fica
//      grande, avisamos o usuário.
// ============================================

const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
const { Sticker, StickerTypes } = require('wa-sticker-formatter')
const { rodarExecutavel } = require('./webp-animado')
const fs = require('fs')
const os = require('os')
const path = require('path')

// ⏱️ Limites
const LIMITE_VIDEO_SEGUNDOS = 10
const LIMITE_BYTES_VIDEO = 25 * 1024 * 1024 // 25 MB ao baixar (igual que /togif e /tomp4)
const LIMITE_BYTES_STICKER = 1024 * 1024    // ~1 MB, limite típico de figurinha no WhatsApp
const FPS_PRIMARIO = 12
const FPS_COMPRIMIDO = 8
const QUALITY_PRIMARIA = 80
const QUALITY_COMPRIMIDA = 60

// ─── ffmpeg: binário embutido (igual que /togif, /tomp4 e /attp) ───
function caminhoFfmpeg() {
  try {
    return require('@ffmpeg-installer/ffmpeg').path
  } catch (err) {
    return 'ffmpeg'
  }
}

/** Apaga temporário com retry (EPERM/EBUSY no Windows). NUNCA lança. */
function apagarComRetry(caminho, tentativas = 3) {
  const espera = (ms) => new Promise((resolver) => setTimeout(resolver, ms))
  return (async () => {
    for (let tentativa = 0; tentativa < tentativas; tentativa += 1) {
      try {
        if (!fs.existsSync(caminho)) return
        fs.unlinkSync(caminho)
        return
      } catch (err) {
        if (tentativa < tentativas - 1) await espera(150)
        else console.error('⚠️ [s] falha ao apagar', caminho, err?.message)
      }
    }
  })()
}

// ─── 🎬 Vídeo → WEBP animado (quadrado 512×512, sem áudio) ───
// @param {string} caminhoVideo
// @param {string} caminhoWebp
// @param {number} [limiteBytes] Limite de bytes que dispara uma 2ª passada
//                                a menor qualidade/fps (por padrão 1 MB).
// @returns {Promise<{bytes: number, segundaPassada: boolean}>}
async function videoParaWebpAnimado(caminhoVideo, caminhoWebp, limiteBytes = LIMITE_BYTES_STICKER) {
  const construirArgs = (fps, qualidade) => [
    '-y', '-nostdin',
    '-i', caminhoVideo,
    '-t', String(LIMITE_VIDEO_SEGUNDOS), // rede de segurança: máximo 10s
    '-vf',
    'scale=512:512:force_original_aspect_ratio=increase,' +
    'crop=min(iw\\,512):min(ih\\,512),' +        // recorta apenas quando sobra
    'pad=512:512:(ow-iw)/2:(oh-ih)/2:black,' +  // preenche fontes minúsculas
    `fps=${fps}`,
    '-c:v', 'libwebp',
    '-lossless', '0',
    '-q:v', String(qualidade),
    '-loop', '0',
    '-an',
    caminhoWebp
  ]

  await rodarExecutavel(caminhoFfmpeg(), construirArgs(FPS_PRIMARIO, QUALITY_PRIMARIA), 120000)

  let bytes = fs.existsSync(caminhoWebp) ? fs.statSync(caminhoWebp).size : 0
  if (bytes === 0) throw new Error('ffmpeg não conseguiu produzir o webp animado do vídeo')

  // 🔽 2ª passada se a figurinha fica pesada demais para WhatsApp
  let segundaPassada = false
  if (bytes > limiteBytes) {
    await rodarExecutavel(caminhoFfmpeg(), construirArgs(FPS_COMPRIMIDO, QUALITY_COMPRIMIDA), 120000)
    bytes = fs.existsSync(caminhoWebp) ? fs.statSync(caminhoWebp).size : 0
    segundaPassada = true
    if (bytes === 0) throw new Error('ffmpeg não conseguiu produzir o webp comprimido')
  }
  return { bytes, segundaPassada }
}

// ─── 🏷️ Injeta os metadados do pack (node-webpmux) sem re-encodear ───
// O Exif de wa-sticker-formatter usa node-webpmux: carrega o webp, injeta
// o chunk EXIF ("sticker-pack-name", etc.) e o guarda — os frames ANMF se
// conservam tal qual (comprovado: 48 → 48 frames).
function inyectarMetadatosWebp(buffer) {
  const { default: ClaseExif } = require('wa-sticker-formatter/dist/internal/Metadata/Exif.js')
  const exif = new ClaseExif({
    pack: 'Hipnos Bot',
    author: 'Sombras do Limbo',
    id: 'hipnos_s_video',
    categories: ['🔮']
  })
  return exif.add(buffer)
}

module.exports = {
  nome: 's',
  descricao: 'Transforma imagens, GIFs ou vídeos (máx. 10 segundos) em figurinhas.',

  async executar(sock, jid, msg, texto) {
    let caminhoVideo = null
    let caminhoWebp = null

    try {
      // Verifica se a mensagem é imagem/GIF ou vídeo, direta ou respondida
      const cotada = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      const imagem = msg.message?.imageMessage || cotada?.imageMessage
      const video = msg.message?.videoMessage || cotada?.videoMessage

      if (!imagem && !video) {
        return await sock.sendMessage(jid, {
          text: '❌ Para tecer uma figurinha, envia uma imagem, GIF ou vídeo (máx. 10s) com `/s` — ou responde a uma mídia existente.'
        }, { quoted: msg })
      }

      // Envia uma mensagem de carregamento
      await sock.sendMessage(jid, {
        text: '⏳ Tecendo sua figurinha nas sombras... Aguarde.'
      }, { quoted: msg })

      let stickerBuffer

      if (video) {
        // ─── 🎬 CAMINHO VÍDEO → figurinha animada ───
        const segundos = Number(video.seconds || 0)
        if (segundos > LIMITE_VIDEO_SEGUNDOS) {
          return await sock.sendMessage(jid, {
            text: `⏱️ *Limite de ${LIMITE_VIDEO_SEGUNDOS} segundos*...\n\nSeu vídeo dura ${segundos}s. Envie um clipe mais curto (máx. ${LIMITE_VIDEO_SEGUNDOS}s) e ele será tecido nas sombras.`
          }, { quoted: msg })
        }

        // Baixa o vídeo do WhatsApp
        const stream = await downloadContentFromMessage(video, 'video')
        let buffer = Buffer.from([])
        for await (const parte of stream) {
          buffer = Buffer.concat([buffer, parte])
          if (buffer.length > LIMITE_BYTES_VIDEO) {
            throw new Error('O vídeo supera o limite de 25 MB ao ser baixado.')
          }
        }
        if (buffer.length === 0) throw new Error('O vídeo foi baixado vazio (0 bytes).')

        // Converte vídeo → webp animado com o ffmpeg embutido
        const idUnico = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        caminhoVideo = path.join(os.tmpdir(), `${idUnico}.mp4`)
        caminhoWebp = path.join(os.tmpdir(), `${idUnico}.webp`)
        fs.writeFileSync(caminhoVideo, buffer)

        const { bytes, segundaPassada } = await videoParaWebpAnimado(caminhoVideo, caminhoWebp)
        console.log(`[s] 🎬 webp animado pronto: ${bytes} bytes${segundaPassada ? ' (2ª passada comprimida)' : ''}`)

        if (bytes > LIMITE_BYTES_STICKER) {
          throw new Error(`A figurinha animada ficou em ${bytes} bytes (queríamos ${LIMITE_BYTES_STICKER} ou menos).`)
        }

        stickerBuffer = fs.readFileSync(caminhoWebp)

        // Injeta pack/autor; se falha, o webp do ffmpeg já vale como figurinha
        try {
          const conMetadatos = await inyectarMetadatosWebp(stickerBuffer)
          if (conMetadatos && conMetadatos.length > 0) stickerBuffer = conMetadatos
        } catch (errMetadatos) {
          console.error('[s] ⚠️ não foi possível injetar os metadados (enviando o webp cru):', errMetadatos?.message || errMetadatos)
        }
      } else {
        // ─── 🖼️ CAMINHO IMAGEM/GIF → figurinha (como sempre) ───
        const mensagemParaBaixar = msg.message?.imageMessage ? msg.message : { message: cotada }

        // Baixa a imagem do WhatsApp
        const stream = await downloadContentFromMessage(mensagemParaBaixar.message.imageMessage, 'image')

        let buffer = Buffer.from([])
        for await (const parte of stream) {
          buffer = Buffer.concat([buffer, parte])
        }

        // Cria e formata a figurinha
        const sticker = new Sticker(buffer, {
          pack: 'Hipnos Bot',         // Nome do pacote de figurinhas
          author: 'Sombras do Limbo', // Nome do autor
          type: StickerTypes.CROPPED, // Corta a imagem para caber perfeitamente no quadrado
          categories: ['🔮'],
          id: 'hipnos_s',
          quality: 70                 // Mantém uma qualidade boa sem pesar no envio
        })

        stickerBuffer = await sticker.toBuffer()
      }

      // Envia a figurinha de volta para o grupo ou chat privado
      await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg })

    } catch (err) {
      console.error('[s] 💥 erro ao criar figurinha:', err?.stack || err)
      if (err?.mensagemExecutavel) console.error('[s] 📎 stderr do ffmpeg:', err.mensagemExecutavel)
      await sock.sendMessage(jid, {
        text: '❌ Ocorreu um erro ao tentar gerar a figurinha.'
      }, { quoted: msg }).catch(() => {})
    } finally {
      // 🧹 Limpeza sempre (incluso em erros)
      for (const caminho of [caminhoVideo, caminhoWebp]) {
        if (caminho) await apagarComRetry(caminho)
      }
    }
  }
}

// Exporta utilidades para os testes (mesmo padrão que webp-animado.js)
Object.assign(module.exports, {
  videoParaWebpAnimado,
  inyectarMetadatosWebp,
  LIMITE_VIDEO_SEGUNDOS,
  LIMITE_BYTES_STICKER
})