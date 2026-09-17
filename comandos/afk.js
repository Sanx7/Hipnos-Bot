// ============================================
// 💤 AFK — Marca o usuário como ausente (/afk)
// ============================================
// Uso: /afk <motivo opcional>
//   - Marca o remetente como AFK no MongoDB (collection "afks", via afk.js);
//   - Se já estava AFK, atualiza motivo e timestamp;
//   - Motivo padrão quando não informado: "Ausente no momento".
//
// A remoção automática (quando o usuário volta a mandar QUALQUER mensagem)
// e o aviso quando alguém menciona/respond a um usuário AFK ficam no
// bot.js (bloco "SISTEMA AFK" do messages.upsert) — este arquivo é só o
// comando de ativação/atualização.
// ============================================

const { definirAfk, MOTIVO_PADRAO } = require('../afk')
const { limparNumero } = require('../config')

module.exports = {
  nome: 'afk',
  descricao: 'Marca você como ausente. Uso: /afk <motivo opcional>',

  async executar(sock, jid, msg, text) {
    try {
      const sender = msg.key.participant || msg.key.remoteJid
      const numero = limparNumero(sender)
      if (!numero) return

      // Motivo: tudo depois de "/afk " (o texto chega cru ao comando).
      // Extrai o 1º token (o nome do comando) e junta o resto.
      const partes = String(text || '').trim().split(/\s+/)
      const motivo = partes.slice(1).join(' ').trim() || MOTIVO_PADRAO

      const registro = await definirAfk(numero, motivo)

      await sock.sendMessage(jid, {
        text:
          `💤 *Modo ausente ativado!*\n\n` +
          `📝 Motivo: ${registro.motivo}\n\n` +
          `Avisarei quem te mencionar ou responder. Assim que você mandar ` +
          `qualquer mensagem por aqui, removo o status automaticamente. 🌙`
      }, { quoted: msg })
    } catch (erro) {
      console.error('⚠️ [afk] falha ao ativar o modo ausente:', erro?.message || erro)
      await sock.sendMessage(jid, {
        text: '❌ Não consegui registrar seu status AFK agora (falha no banco de dados). Tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
