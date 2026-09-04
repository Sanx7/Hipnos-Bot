// ============================================
// 👑 DONO — Quem Comanda o Sono
// ============================================
// Lista os números configurados como donos do bot.
//
// - A lista vem SEMPRE do config.js (getDonos()), que é a fonte única de
//   verdade e contém TODOS os donos do array OWNER_NUMBERS (carregado do
//   .env ou, na ausência dele, do fallback hardcoded no config.js) —
//   nunca apenas o primeiro item.
// - Comando PÚBLICO: qualquer pessoa pode consultar quem são os donos
//   (os números já aparecem no rodapé do /menu, então nada sensível é exposto).
// ============================================

// Fonte única dos donos + formatação legível dos números (ambas do config.js)
const { getDonos, formatarNumero } = require('../config')

module.exports = {
  nome: 'dono',
  descricao: 'Mostra quem são os donos do bot.',

  async executar(sock, jid, msg, text) {
    try {
      // 1) Busca a lista de donos direto no config.js (já normalizada/deduplicada)
      const donos = getDonos()

      // 2) Nenhum dono configurado -> aviso amigável
      if (!donos.length) {
        return await sock.sendMessage(jid, {
          text:
            '👑 *Nenhum dono foi coroado ainda...*\n\n' +
            'Os tronos do sono estão vazios. Edite o *OWNER_NUMBERS* no arquivo *.env* (ou no *config.js*) para coroar os donos do bot.'
        }, { quoted: msg })
      }

      // 3) Monta a lista numerada com os números em formato legível
      const linhas = donos.map((dono, indice) => {
        return `${indice + 1}. 👑 *${formatarNumero(dono)}*`
      })

      const resposta =
        '👑 *DONOS DO BOT* 👑\n\n' +
        `Os soberanos do sono (${donos.length}):\n\n` +
        linhas.join('\n') +
        '\n\n💤 *"Todo reino tem seu guardião."*'

      await sock.sendMessage(jid, { text: resposta }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando dono:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente.'
      }, { quoted: msg })
    }
  }
}