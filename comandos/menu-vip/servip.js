// ============================================
// 📜 SERVIP — Lista os VIPs ativos (apenas DONOS do bot)
// ============================================
// - Mostra TODOS os VIPs vigentes: número + data de expiração,
//   ordenados pela expiração MAIS PRÓXIMA primeiro.
// - Antes de listar, remove do banco os VIPs já expirados (limpeza automática,
//   feita dentro de listarVipsAtivos()).
// - Autorização idêntica ao /darvip (OWNER_NUMBERS do config.js).
// ============================================

const { OWNER_NUMBERS, limparNumero, formatarNumero } = require('../../config')
const vip = require('../../vip')

module.exports = {
  nome: 'servip',
  descricao: 'Lista os membros VIP ativos e suas expirações (apenas donos).',

  async executar(sock, jid, msg, text) {
    try {
      const sender = msg.key.participant || msg.key.remoteJid

      // 1) 🔒 Apenas donos do bot
      if (!OWNER_NUMBERS.includes(limparNumero(sender))) {
        return await sock.sendMessage(jid, {
          text: '🌑 *Hipnos só obedece aos donos do bot.*\n\nO livro dos VIPs 💠 permanece selado aos olhos dos mortais.'
        }, { quoted: msg })
      }

      // 2) Lista de ativos (expirados já são removidos do banco nessa chamada)
      const lista = vip.listarVipsAtivos()

      if (!lista.length) {
        return await sock.sendMessage(jid, {
          text: '💠 *Nenhum VIP ativo no momento.*\n\nO salão dos privilegiados está vazio... Use */darvip @membro [dias]* para outorgar o primeiro selo.'
        }, { quoted: msg })
      }

      // 3) Lista numerada (a ordem já vem do banco: expiração mais próxima primeiro)
      const linhas = lista.map((v, indice) => {
        const diasRestantes = Math.max(1, Math.ceil((v.expira_em - Date.now()) / vip.DIA_EM_MS))
        return `${indice + 1}. 💠 *${formatarNumero(v.numero)}*\n    ⏳ Expira em *${vip.formatarData(v.expira_em)}* (~${diasRestantes} dia${diasRestantes > 1 ? 's' : ''})`
      })

      const resposta =
        `📜 *LIVRO DOS VIPs* (${lista.length} ativo${lista.length > 1 ? 's' : ''}) 📜\n\n` +
        linhas.join('\n') +
        '\n\n💤 *"Todo privilégio sonha com o seu fim."*'

      await sock.sendMessage(jid, { text: resposta }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando servip:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente.'
      }, { quoted: msg })
    }
  }
}