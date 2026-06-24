const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
const { Sticker, StickerTypes } = require('wa-sticker-formatter')

module.exports = {
  nome: 's',
  descricao: 'Transforma imagens, GIFs ou vídeos em figurinhas.',
  async executar(sock, jid, msg, texto) {
    try {
      // Verifica se a mensagem é uma imagem ou se está respondendo a uma imagem
      const cotada = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      const tipoMensagem = msg.message?.imageMessage ? msg.message.imageMessage : cotada?.imageMessage

      if (!tipoMensagem) {
        return await sock.sendMessage(jid, { 
          text: '❌ Você precisa enviar uma imagem com o comando `/s` ou responder a uma imagem existente!' 
        }, { quoted: msg })
      }

      // Envia uma mensagem de carregamento
      await sock.sendMessage(jid, { text: '⏳ Tecendo sua figurinha nas sombras... Aguarde.' }, { quoted: msg })

      // Define de onde vai baixar a imagem (da mensagem direta ou da mensagem respondida)
      const mensagemParaBaixar = msg.message?.imageMessage ? msg.message : { message: cotada }
      
      // Baixa a mídia do WhatsApp
      const stream = await downloadContentFromMessage(
        mensagemParaBaixar.message.imageMessage,
        'image'
      )
      
      let buffer = Buffer.from([])
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk])
      }

      // Cria e formata a figurinha
      const sticker = new Sticker(buffer, {
        pack: 'Hipnos Bot', // Nome do pacote de figurinhas
        author: 'Sombras do Limbo', // Nome do autor
        type: StickerTypes.CROPPED, // Corta a imagem para caber perfeitamente no quadrado
        categories: ['🔮'],
        id: 'hipnos_s',
        quality: 70 // Mantém uma qualidade boa sem pesar no envio
      })

      const stickerBuffer = await sticker.toBuffer()

      // Envia a figurinha de volta para o grupo ou chat privado
      await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg })

    } catch (err) {
      console.error('Erro ao criar figurinha:', err)
      await sock.sendMessage(jid, { text: '❌ Ocorreu um erro ao tentar gerar a figurinha.' }, { quoted: msg })
    }
  }
}