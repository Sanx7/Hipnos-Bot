// ============================================
// 💠 DARVIP — Outorga VIP a um mortal (apenas DONOS do bot)
// ============================================
// Uso:
//   /darvip @membro 30        -> 30 dias de VIP a partir de agora
//   /darvip 5511999999999 30  -> também aceita número digitado (sem menção)
//
// Regras:
//   - SOMENTE donos do bot (lista OWNER_NUMBERS do config.js — mesma
//     verificação usada no /soadm e no /dono).
//   - [dias] é OBRIGATÓRIO (não existe VIP vitalício).
//   - Se o alvo já for VIP ATIVO, os dias são SOMADOS à expiração atual;
//     se o VIP dele já expirou, vira um novo período a partir de agora.
// ============================================

const { OWNER_NUMBERS, limparNumero } = require('../../config')
const vip = require('../../vip')

module.exports = {
  nome: 'darvip',
  descricao: 'Outorga dias de VIP a um membro (apenas donos do bot).',

  async executar(sock, jid, msg, text) {
    try {
      const sender = msg.key.participant || msg.key.remoteJid

      // 1) 🔒 Apenas donos do bot podem conceder VIP
      if (!OWNER_NUMBERS.includes(limparNumero(sender))) {
        return await sock.sendMessage(jid, {
          text: '🌑 *Hipnos só obedece aos donos do bot.*\n\nA outorga do selo 💠 *VIP* é privilégio exclusivo dos soberanos.'
        }, { quoted: msg })
      }

      // 2) Argumentos: tudo que vem depois de "/darvip"
      const args = String(text || '').split(' ').slice(1).filter(Boolean)
      const numericos = args.filter((a) => /^\d{1,15}$/.test(a))

      // 3) Alvo: menção direta -> quem foi citado (reply) -> número digitado.
      //    (mesma ordem usada em /addblacklist e /remblacklist)
      const contextInfo = msg.message.extendedTextMessage?.contextInfo
      const alvoBruto = contextInfo?.mentionedJid?.[0] || contextInfo?.participant
      const alvo = alvoBruto
        ? limparNumero(alvoBruto)
        : (numericos.find((n) => n.length >= 10) || '')

      if (!alvo) {
        return await sock.sendMessage(jid, {
          text: '💠 *Marque a alma* que receberá o selo VIP.\n\nExemplo: */darvip @membro 30* — concede 30 dias de VIP.'
        }, { quoted: msg })
      }

      // JID real p/ a menção (preserva @lid do Baileys v7 quando houver)
      const alvoJid = alvoBruto || `${alvo}@s.whatsapp.net`

      // 4) Dias: OBRIGATÓRIO — último número da mensagem que não seja o próprio alvo
      let dias = null
      for (let i = args.length - 1; i >= 0; i--) {
        const token = args[i]
        if (/^\d{1,15}$/.test(token) && limparNumero(token) !== alvo) {
          dias = Number(token)
          break
        }
      }

      if (dias === null) {
        return await sock.sendMessage(jid, {
          text: '💠 *Quantos dias de VIP?*\n\nInforme a duração: */darvip @membro 30*.\n(Não existe VIP vitalício — todo sonho tem seu fim.)'
        }, { quoted: msg })
      }

      if (dias < 1 || dias > vip.DIAS_MAX) {
        return await sock.sendMessage(jid, {
          text: `⚠️ Dias inválidos. Use um número entre *1* e *${vip.DIAS_MAX}* (10 anos).`
        }, { quoted: msg })
      }

      // 5) Outorga no banco (soma automática se já for VIP ativo)
      const resultado = vip.adicionarVip(alvo, dias)
      if (!resultado) {
        return await sock.sendMessage(jid, {
          text: '⛔ Não foi possível outorgar o VIP... Tente novamente.'
        }, { quoted: msg })
      }

      const detalheSelo = resultado.somando
        ? `📜 Selo: *+${resultado.dias} dia(s)* somados ao VIP que já vigorava.`
        : `📜 Selo: *${resultado.dias} dia(s)* de privilégios oníricos.`

      const resposta =
        '💠👑 *VIP OUTORGADO* 💠👑\n\n' +
        `@${alvo} agora descansa entre os privilegiados.\n\n` +
        `${detalheSelo}\n` +
        `🌌 Vigora até: *${vip.formatarData(resultado.expiraEm)}*`

      await sock.sendMessage(jid, { text: resposta, mentions: [alvoJid] }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando darvip:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente.'
      }, { quoted: msg })
    }
  }
}