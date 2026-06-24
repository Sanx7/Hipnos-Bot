const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
const { Sticker, StickerTypes } = require('wa-sticker-formatter')

module.exports = {
  nome: 'renomear',
  descricao: 'Altera o nome do pacote e do autor de uma figurinha existente.',
  async ejecutar(sock, jid, msg, texto) {
    try {
      // Verifica se está respondendo a uma mensagem
      const cotada = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      const ehSticker = cotada?.stickerMessage

      if (!ehSticker) {
        return await sock.sendMessage(jid, { 
          text: '❌ Você precisa responder a uma figurinha usando o comando `/renomear Nome do Pacote | Nome do Autor`!' 
        }, { quoted: msg })
      }

      // Separa o texto enviado pelo usuário usando a barra vertical "|"
      // Exemplo: /renomear Meu Pack | Hipnos
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

      // Avisa que está processando
      await sock.sendMessage(jid, { text: '⏳ Alterando os metadados da figurinha no limbo...' }, { quoted: msg })

      // Baixa o arquivo da figurinha original
      const stream = await downloadContentFromMessage(cotada.stickerMessage, 'image')
      let buffer = Buffer.from([])
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk])
      }

      // Cria a nova figurinha com os novos metadados digitados pelo usuário
      const sticker = new Sticker(buffer, {
        pack: nomePacote,
        author: nomeAutor,
        type: StickerTypes.CROPPED,
        quality: 70
      })

      const stickerBuffer = await sticker.toBuffer()

      // Envia a figurinha renomeada de volta
      await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg })

    } catch (err) {
      console.error('Erro ao renomear figurinha:', err)
      await sock.sendMessage(jid, { text: '❌ Ocorreu um erro ao tentar renomear esta figurinha.' }, { quoted: msg })
    }
  }
}