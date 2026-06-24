const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
const ffmpeg = require('fluent-ffmpeg')
const fs = require('fs')
const path = require('path')

module.exports = {
  nome: 'tomp4',
  descricao: 'Transforma uma figurinha animada em um vídeo MP4 comum.',
  async executar(sock, jid, msg, texto) {
    try {
      // Verifica se o usuário está respondendo a uma mensagem
      const cotada = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      const ehSticker = cotada?.stickerMessage

      if (!ehSticker) {
        return await sock.sendMessage(jid, { 
          text: '❌ Você precisa responder a uma figurinha animada usando o comando `/tomp4`!' 
        }, { quoted: msg })
      }

      // Avisa que o processo começou
      await sock.sendMessage(jid, { text: '⏳ Materializando a figurinha em formato de vídeo...' }, { quoted: msg })

      // Cria a pasta temp se ela não existir
      const pastaTemp = path.join(__dirname, 'dados', 'temp')
      if (!fs.existsSync(pastaTemp)) {
        fs.mkdirSync(pastaTemp, { recursive: true })
      }

      // Baixa o arquivo .webp animado
      const stream = await downloadContentFromMessage(cotada.stickerMessage, 'image')
      let buffer = Buffer.from([])
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk])
      }

      // Define os caminhos temporários
      const nomeArquivo = `tomp4_${Date.now()}`
      const caminhoWebp = path.join(pastaTemp, `${nomeArquivo}.webp`)
      const caminhoMp4 = path.join(pastaTemp, `${nomeArquivo}.mp4`)

      // Salva o buffer temporariamente
      fs.writeFileSync(caminhoWebp, buffer)

      // Converte WebP animado para MP4 puro
      ffmpeg(caminhoWebp)
        .outputOptions([
          '-pix_fmt yuv420p',
          '-c:v libx264',
          '-movflags faststart',
          '-filter:v fps=fps=25' // Mantém uma taxa de quadros fluida para vídeo
        ])
        .toFormat('mp4')
        .save(caminhoMp4)
        .on('end', async () => {
          // Envia como vídeo normal (repare que NÃO usamos gifPlayback: true aqui)
          await sock.sendMessage(jid, { 
            video: fs.readFileSync(caminhoMp4),
            caption: '🔮 Aqui está seu vídeo extraído do limbo!'
          }, { quoted: msg })

          // Limpa os arquivos temporários do disco
          if (fs.existsSync(caminhoWebp)) fs.unlinkSync(caminhoWebp)
          if (fs.existsSync(caminhoMp4)) fs.unlinkSync(caminhoMp4)
        })
        .on('error', async (err) => {
          console.error('Erro no FFmpeg:', err)
          await sock.sendMessage(jid, { text: '❌ Ocorreu um erro ao processar o vídeo com FFmpeg.' }, { quoted: msg })
          if (fs.existsSync(caminhoWebp)) fs.unlinkSync(caminhoWebp)
        })

    } catch (err) {
      console.error('Erro ao converter figurinha em MP4:', err)
      await sock.sendMessage(jid, { text: '❌ Ocorreu um erro ao tentar converter essa figurinha.' }, { quoted: msg })
    }
  }
}