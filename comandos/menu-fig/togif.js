const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
const ffmpeg = require('fluent-ffmpeg')
const fs = require('fs')
const path = require('path')

module.exports = {
  nome: 'togif',
  descricao: 'Transforma uma figurinha animada em GIF.',
  async executar(sock, jid, msg, texto) {
    try {
      // Verifica se o usuário está respondendo a uma mensagem
      const cotada = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      const ehSticker = cotada?.stickerMessage

      if (!ehSticker) {
        return await sock.sendMessage(jid, { 
          text: '❌ Você precisa responder a uma figurinha animada usando o comando `/togif`!' 
        }, { quoted: msg })
      }

      // Avisa que está processando
      await sock.sendMessage(jid, { text: '⏳ Invocando as forças do limbo para converter seu GIF...' }, { quoted: msg })

      // Cria a pasta temp se ela não existir
      const pastaTemp = path.join(__dirname, 'dados', 'temp')
      if (!fs.existsSync(pastaTemp)) {
        fs.mkdirSync(pastaTemp, { recursive: true })
      }

      // Baixa o arquivo .webp da figurinha animada
      const stream = await downloadContentFromMessage(cotada.stickerMessage, 'image')
      let buffer = Buffer.from([])
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk])
      }

      // Define os caminhos temporários dos arquivos
      const nomeArquivo = `togif_${Date.now()}`
      const caminhoWebp = path.join(pastaTemp, `${nomeArquivo}.webp`)
      const caminhoMp4 = path.join(pastaTemp, `${nomeArquivo}.mp4`)

      // Salva o buffer do webp animado temporariamente
      fs.writeFileSync(caminhoWebp, buffer)

      // Converte o WebP animado para MP4 (que o WhatsApp interpreta como GIF se enviado corretamente)
      ffmpeg(caminhoWebp)
        .outputOptions([
          '-pix_fmt yuv420p',
          '-c:v libx264',
          '-movflags faststart',
          '-filter:v fps=fps=20'
        ])
        .toFormat('mp4')
        .save(caminhoMp4)
        .on('end', async () => {
          // Envia o arquivo como vídeo curto/GIF (gifPlayback: true faz ele rodar em loop igual um GIF)
          await sock.sendMessage(jid, { 
            video: fs.readFileSync(caminhoMp4),
            caption: '🔮 Aqui está seu GIF desperto!',
            gifPlayback: true
          }, { quoted: msg })

          // Deleta os arquivos temporários do disco
          if (fs.existsSync(caminhoWebp)) fs.unlinkSync(caminhoWebp)
          if (fs.existsSync(caminhoMp4)) fs.unlinkSync(caminhoMp4)
        })
        .on('error', async (err) => {
          console.error('Erro no FFmpeg:', err)
          await sock.sendMessage(jid, { text: '❌ Ocorreu um erro interno no FFmpeg ao processar o GIF.' }, { quoted: msg })
          if (fs.existsSync(caminhoWebp)) fs.unlinkSync(caminhoWebp)
        })

    } catch (err) {
      console.error('Erro ao converter figurinha em GIF:', err)
      await sock.sendMessage(jid, { text: '❌ Ocorreu um erro ao tentar converter essa figurinha.' }, { quoted: msg })
    }
  }
}