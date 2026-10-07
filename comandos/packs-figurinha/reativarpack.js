// ============================================================
// ♻️ REATIVARPACK — absolve o pack (só moderação)
// ============================================================
// Uso: /reativarpack <nome do pack>
// Volta ao /museu com as denúncias ZERADAS.
// ============================================================

const prefixoComandos = require('../../prefixo')
const { reativarPack, ehRevisorJid } = require('../../packs-figurinha')

module.exports = {
  nome: 'reativarpack',
  descricao: 'Reativa um pack suspenso e zera as denúncias (moderação).',

  async executar(sock, jid, msg, texto) {
    try {
      let participantes = []
      if (String(jid || '').endsWith('@g.us')) {
        try {
          participantes = (await sock.groupMetadata(jid))?.participants || []
        } catch (errMeta) {
          console.error('[reativarpack] ⚠️ sem metadados do grupo:', errMeta?.message || errMeta)
        }
      }
      const remetente = msg.key?.participant || msg.key?.remoteJid || ''
      if (!ehRevisorJid(participantes, remetente)) {
        return await sock.sendMessage(jid, {
          text: '🛡️ Só a moderação (admin do grupo ou dono do bot) pode reativar packs.'
        }, { quoted: msg })
      }

      const nome = prefixoComandos.removerPrefixo(texto).split(' ').slice(1).join(' ').trim()
      if (!nome) {
        return await sock.sendMessage(jid, {
          text: '♻️ *Reativar pack*\n\nUso: /reativarpack <nome do pack>'
        }, { quoted: msg })
      }

      const resultado = await reativarPack(nome)
      if (!resultado.ok) {
        return await sock.sendMessage(jid, { text: `❌ ${resultado.motivo}` }, { quoted: msg })
      }

      await sock.sendMessage(jid, {
        text: `♻️ O pack "${resultado.pack}" voltou ao /museu com as denúncias zeradas.`
      }, { quoted: msg })
    } catch (err) {
      console.error('[reativarpack] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '❌ Não consegui reativar agora — tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
