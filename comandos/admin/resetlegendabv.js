// ============================================
// ♻️ RESETLEGENDABV — Remove a legenda própria do grupo (volta à padrão)
// ============================================
// Uso (dentro de um grupo):  /resetlegendabv
// Restrito a ADMIN do grupo ou DONO do bot — MESMO critério do /welcome,
// do /soadm e do /legendabv (via ehAutorizadoNoGrupo).
//
// Apaga a legenda guardada no MongoDB para ESTE grupo_id; o handler de
// entrada passa a usar a LEGENDA_PADRAO de boasvindas.js.
// É equivalente a "/legendabv reset".
// ============================================

const { removerLegenda } = require('../../configuracoes-grupo')
const { ehAutorizadoNoGrupo, LEGENDA_PADRAO } = require('../../boasvindas')

module.exports = {
  nome: 'resetlegendabv',
  aliases: ['dellegendabv'],
  descricao: 'Remove a legenda personalizada do grupo e volta à legenda padrão (apenas administradores).',

  async executar(sock, jid, msg) {
    try {
      // 🚪 Só dentro de grupos
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, {
          text: '📝 *Hipnos só reescreve portais de um grupo.*\n\nUse este comando em um grupo.'
        }, { quoted: msg })
      }

      const sender = msg.key.participant || msg.key.remoteJid

      // 🔒 Autorização — MESMO critério do /welcome e do /soadm
      const { autorizado } = await ehAutorizadoNoGrupo(sock, jid, sender)
      if (!autorizado) {
        return await sock.sendMessage(jid, {
          text: '🌑 *Hipnos ignora sua petição...*\n\nApenas *administradores do grupo* (ou o dono do bot) podem restaurar a legenda padrão.'
        }, { quoted: msg })
      }

      // ♻️ Volta à legenda padrão (nunca toca nos outros grupos)
      const tinhaLegenda = await removerLegenda(jid)

      return await sock.sendMessage(jid, {
        text: tinhaLegenda
          ? `♻️ *LEGENDA RESTAURADA*\n\nA legenda deste grupo foi apagada. As boas-vindas voltam à legenda padrão:\n\n${LEGENDA_PADRAO}`
          : '⚠️ Este grupo *não tinha* legenda personalizada. Nada mudou (a padrão segue em uso).'
      }, { quoted: msg })

    } catch (err) {
      console.error('[resetlegendabv] 💥 erro:', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras não puderam restaurar a legenda... Tente novamente.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}