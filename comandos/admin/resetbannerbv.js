// ============================================
// ♻️ RESETBANNERBV — Remove o banner próprio do grupo (volta ao padrão)
// ============================================
// Uso (dentro de um grupo):  /resetbannerbv
// Restrito a ADMIN do grupo ou DONO do bot — MESMO critério do /welcome,
// do /soadm e do /setbannerbv (via ehAutorizadoNoGrupo).
//
// Apaga o banner guardado no MongoDB para ESTE grupo_id; o handler de
// entrada passa a usar comandos/dados/banners/padrao-boasvindas.png.
// É equivalente a "/setbannerbv reset" (alias deste comando).
// ============================================

const { removerBanner } = require('../../configuracoes-grupo')
const { ehAutorizadoNoGrupo } = require('../../boasvindas')

module.exports = {
  nome: 'resetbannerbv',
  aliases: ['delbannerbv'],
  descricao: 'Remove o banner personalizado do grupo e volta ao banner padrão (apenas administradores).',

  async executar(sock, jid, msg) {
    try {
      // 🚪 Só dentro de grupos
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, {
          text: '️ *Hipnos só restaura portais de um grupo.*\n\nUse este comando em um grupo.'
        }, { quoted: msg })
      }

      const sender = msg.key.participant || msg.key.remoteJid

      // 🔒 Autorização — MESMO critério do /welcome e do /soadm
      const { autorizado } = await ehAutorizadoNoGrupo(sock, jid, sender)
      if (!autorizado) {
        return await sock.sendMessage(jid, {
          text: '🌑 *Hipnos ignora sua petição...*\n\nApenas *administradores do grupo* (ou o dono do bot) podem restaurar o banner padrão.'
        }, { quoted: msg })
      }

      // ♻️ Volta ao banner padrão (nunca toca nos outros grupos)
      const tinhaBanner = await removerBanner(jid)

      return await sock.sendMessage(jid, {
        text: tinhaBanner
          ? '♻️ *BANNER RESTAURADO*\n\nO banner próprio deste grupo foi apagado. As boas-vindas voltam a usar o *banner padrão*. 🌙'
          : '⚠️ Este grupo *não tinha* banner personalizado. Nada mudou (o padrão segue em uso).'
      }, { quoted: msg })

    } catch (err) {
      console.error('[resetbannerbv] 💥 erro:', err?.stack || err)
      await sock.sendMessage(jid, {
        text: ' As sombras não puderam restaurar o banner... Tente novamente.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}