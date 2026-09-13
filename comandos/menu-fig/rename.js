const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
const { Sticker, StickerTypes } = require('wa-sticker-formatter')
const { webpEhAnimado } = require('./webp-animado')

// ============================================================
// 🏷️ /renomear — renomeia figurinha (estática OU animada)
// ============================================================
// - ESTÁTICO: caminho histórico (wa-sticker-formatter, funciona).
// - ANIMADO: NÃO passa pelo wa-sticker-formatter — ele re-encoda via
//   crop.js + fluent-ffmpeg (ffmpeg 4.2 não decodifica VP8X/ANMF →
//   "Invalid data found" em nível de processo, fora do try/catch).
//   Em vez disso, reescreve SÓ o EXIF via Exif interno do
//   wa-sticker-formatter (node-webpmux por baixo) — método idêntico
//   ao do /s (comprovado: preserva frames ANMF 1:1).
// ============================================================
module.exports = {
  nome: 'renomear',
  descricao: 'Altera o nome do pacote e do autor de uma figurinha existente.',
  async executar(sock, jid, msg, texto) {
    try {
      const cotada = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      const ehSticker = cotada?.stickerMessage

      if (!ehSticker) {
        return await sock.sendMessage(jid, {
          text: '❌ Você precisa responder a uma figurinha usando o comando `/renomear Nome do Pacote | Nome do Autor`!'
        }, { quoted: msg })
      }

      const argumentos = texto.slice(1).split(' ').slice(1).join(' ')
      let nomePacote = 'Hipnos Bot'
      let nomeAutor = 'Sombras do Limbo'

      if (argumentos && argumentos.includes('|')) {
        const partes = argumentos.split('|')
        nomePacote = partes[0].trim()
        nomeAutor = partes[1].trim()
      } else if (argumentos) {
        nomePacote = argumentos.trim()
      }

      await sock.sendMessage(jid, { text: '⏳ Alterando os metadados da figurinha no limbo...' }, { quoted: msg })

      const stream = await downloadContentFromMessage(cotada.stickerMessage, 'image')
      let buffer = Buffer.from([])
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk])
      }
      if (!buffer.length) throw new Error('a figurinha foi baixada vazia (0 bytes)')

      const ehAnimado = webpEhAnimado(buffer)
      console.log('[renomear] 📥 figurinha baixada: ' + buffer.length + ' bytes | ' + (ehAnimado ? 'ANIMADA' : 'estática'))

      let stickerBuffer
      if (ehAnimado) {
        // Animado: injeta EXIF via Exif interno do wa-sticker-formatter
        // (node-webpmux por baixo) — mesmo método do /s, preserva frames.
        // ⚠️ exif.add() é ASYNC — precisa de await!
        console.log('[renomear] 🎬 ANIMADA detectada — reescrevendo EXIF via Exif do wa-sticker-formatter (animação preservada)...')
        const { default: ClaseExif } = require('wa-sticker-formatter/dist/internal/Metadata/Exif.js')
        const exif = new ClaseExif({
          pack: nomePacote,
          author: nomeAutor,
          id: 'hipnos_renomear',
          categories: ['🔮']
        })
        stickerBuffer = await exif.add(buffer)
        console.log('[renomear] ✅ EXIF reescrito (' + (stickerBuffer?.length || 0) + ' bytes)')
      } else {
        // Estático: caminho histórico
        console.log('[renomear] 🖼️ ESTÁTICA detectada — re-encodando via wa-sticker-formatter...')
        const sticker = new Sticker(buffer, {
          pack: nomePacote,
          author: nomeAutor,
          type: StickerTypes.CROPPED,
          quality: 70
        })
        stickerBuffer = await sticker.toBuffer()
        console.log('[renomear] ✅ estática re-encodada (' + stickerBuffer.length + ' bytes)')
      }

      if (!Buffer.isBuffer(stickerBuffer) || stickerBuffer.length === 0) {
        throw new Error('a figurinha renomeada saiu vazia')
      }

      await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg })
      console.log('[renomear] ✅ figurinha renomeada enviada com sucesso')

    } catch (err) {
      console.error('[renomear] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '❌ Não consegui renomear esta figurinha... O feitiço falhou, mas Hipnos segue de pé. Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}