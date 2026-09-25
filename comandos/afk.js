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

const { definirAfk, resolverJidAfk, MOTIVO_PADRAO } = require('../afk')

module.exports = {
  nome: 'afk',
  descricao: 'Marca você como ausente. Uso: /afk <motivo opcional>',

  async executar(sock, jid, msg, text) {
    try {
      const sender = msg.key.participant || msg.key.remoteJid

      // 🪪 CAMINHO INVERSO (ativação): o remetente também pode chegar como
      // "@lid" no WhatsApp v7 — resolve para o NÚMERO REAL antes de gravar,
      // senão a base guardaria o LID cru e a comparação na hora da menção
      // (que resolve para o número real) nunca bateria. Mesmo padrão de
      // VIP/RPG//ban//adv (lid.js, via resolverJidAfk do afk.js).
      let participantes = null
      if (String(sender || '').endsWith('@lid') && String(jid || '').endsWith('@g.us')) {
        try {
          participantes = (await sock.groupMetadata(jid))?.participants || null
        } catch (errMeta) {
          console.error('[afk] sem metadados do grupo p/ resolver @lid do remetente:', errMeta?.message || errMeta)
        }
      }
      const { numero, via } = await resolverJidAfk(participantes, sender)
      if (!numero) return
      if (String(sender || '').endsWith('@lid')) {
        if (via) console.log(`[afk] 🪪 remetente resolvido de @lid p/ o número real ${numero} via ${via}`)
        else console.warn('[afk] 🪪 @lid do remetente não resolvível — gravando o LID cru (best-effort)')
      }

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
