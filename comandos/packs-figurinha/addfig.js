// ============================================================
// ➕ ADDFIG — guarda a figurinha citada dentro de um pack
// ============================================================
// Uso: responda (marque) uma figurinha com /addfig <nome do pack>
// Travas (núcleo): pack ativo, até 30 figurinhas, 1MB por
// figurinha e 12MB por pack.
// ============================================================

const { downloadContentFromMessage, normalizeMessageContent } = require('@whiskeysockets/baileys')
const prefixoComandos = require('../../prefixo')
const { adicionarFigurinha, LIMITE_FIGURINHAS } = require('../../packs-figurinha')

// Teto de segurança do download (o núcleo valida 1MB de novo).
const TETO_DOWNLOAD = 2 * 1024 * 1024

module.exports = {
  nome: 'addfig',
  descricao: 'Guarda a figurinha citada dentro de um pack.',

  async executar(sock, jid, msg, texto) {
    try {
      const nomePack = prefixoComandos.removerPrefixo(texto).split(' ').slice(1).join(' ').trim()

      const conteudo = normalizeMessageContent(msg.message) || {}
      const citado = normalizeMessageContent(
        conteudo.extendedTextMessage?.contextInfo?.quotedMessage
      ) || {}
      const figurinha = citado.stickerMessage

      if (!figurinha) {
        return await sock.sendMessage(jid, {
          text: '🖼️ *Falta a figurinha...*\n\nResponda (marque) uma figurinha com `/addfig Nome do pack` para guardá-la.'
        }, { quoted: msg })
      }

      if (!nomePack) {
        return await sock.sendMessage(jid, {
          text: '📦 *Falta o nome do pack...*\n\nUso: responda a figurinha com `/addfig Nome do pack`.'
        }, { quoted: msg })
      }

      const stream = await downloadContentFromMessage(figurinha, 'image')
      let buffer = Buffer.from([])
      for await (const parte of stream) {
        buffer = Buffer.concat([buffer, parte])
        if (buffer.length > TETO_DOWNLOAD) break
      }

      const resultado = await adicionarFigurinha(nomePack, buffer)
      if (!resultado.ok) {
        return await sock.sendMessage(jid, { text: `❌ ${resultado.motivo}` }, { quoted: msg })
      }

      await sock.sendMessage(jid, {
        text: `✅ Figurinha guardada no pack "${resultado.pack}"! (${resultado.total}/${LIMITE_FIGURINHAS})`
      }, { quoted: msg })
    } catch (err) {
      console.error('[addfig] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '❌ Não consegui guardar a figurinha agora — tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
