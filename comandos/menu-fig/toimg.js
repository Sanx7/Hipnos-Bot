const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
const webp = require('webp-converter')
const fs = require('fs')
const path = require('path')

module.exports = {
  nome: 'toimg',
  descricao: 'Transforma uma figurinha estática em imagem.',
  async executar(sock, jid, msg, texto) {
    try {
      // Verifica se o usuário está respondendo a uma mensagem
      const cotada = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      const ehSticker = cotada?.stickerMessage

      if (!ehSticker) {
        return await sock.sendMessage(jid, { 
          text: '❌ Você precisa responder a uma figurinha estática usando o comando `/toimg`!' 
        }, { quoted: msg })
      }

      // Avisa que está processando
      await sock.sendMessage(jid, { text: '⏳ Extraindo a imagem das profundezas do sticker...' }, { quoted: msg })

      // Cria a pasta temp se ela não existir
      const pastaTemp = path.join(__dirname, 'dados', 'temp')
      if (!fs.existsSync(pastaTemp)) {
        fs.mkdirSync(pastaTemp, { recursive: true })
      }

      // Baixa o arquivo .webp da figurinha
      const stream = await downloadContentFromMessage(cotada.stickerMessage, 'image')
      let buffer = Buffer.from([])
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk])
      }

      // Define os caminhos temporários dos arquivos
      const nomeArquivo = `toimg_${Date.now()}`
      const caminhoWebp = path.join(pastaTemp, `${nomeArquivo}.webp`)
      const caminhoJpg = path.join(pastaTemp, `${nomeArquivo}.jpg`)

      // Salva o buffer do webp temporariamente
      fs.writeFileSync(caminhoWebp, buffer)

      // Converte WebP para JPG
      await webp.dwebp(caminhoWebp, caminhoJpg, '-o')

      // Envia a imagem de volta para o chat
      await sock.sendMessage(jid, { 
        image: { url: caminhoJpg }, 
        caption: '🔮 Aqui está sua imagem trazida do limbo!' 
      }, { quoted: msg })

      // Deleta os arquivos temporários (Corrigido aqui!)
      if (fs.existsSync(caminhoWebp)) fs.unlinkSync(caminhoWebp)
      if (fs.existsSync(caminhoJpg)) fs.unlinkSync(caminhoJpg)

    } catch (err) {
      console.error('Erro ao converter figurinha em imagem:', err)
      await sock.sendMessage(jid, { text: '❌ Ocorreu um erro ao tentar converter essa figurinha. Certifique-se de que não é uma figurinha animada (GIF).' }, { quoted: msg })
    }
  }
}