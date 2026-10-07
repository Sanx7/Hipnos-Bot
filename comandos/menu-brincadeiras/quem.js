const perguntas = require('../../dados/perguntas-quem')
const sorteio = require('../../dados/sorteio-sem-repeticao')(perguntas)
const { resolverNumeroAlvo } = require('../../lid')
const { limparNumero, acharParticipante } = require('../../config')
module.exports = {
  nome: 'quem',
  async executar(sock, jid, msg) {
    try {
      if (!String(jid).endsWith('@g.us')) return await sock.sendMessage(jid, { text: '🔮 Use /quem em um grupo.' }, { quoted: msg })
      const participantes = (await sock.groupMetadata(jid))?.participants || []
      const bot = acharParticipante(participantes, sock.user?.id || sock.user?.lid)
      const alvos = participantes.filter(p => p?.id && p !== bot)
      if (!alvos.length) return await sock.sendMessage(jid, { text: '🔮 Não encontrei membros para sortear.' }, { quoted: msg })
      const alvo = alvos[Math.floor(Math.random() * alvos.length)]
      const { numero, via } = await resolverNumeroAlvo(participantes, alvo.id)
      // LID não é telefone. Prefere nome dos metadados e o pushName do
      // autor quando ele for o sorteado; mantém o ID do grupo na menção.
      const autor = acharParticipante(participantes, msg.key?.participant)
      const nome = alvo.notify || alvo.name || alvo.verifiedName || (alvo === autor ? msg.pushName : '')
      const rotulo = nome || (via !== null ? numero : 'membro do grupo')
      await sock.sendMessage(jid, {
        text: `🔮 ${sorteio.sortear(jid)}\n\nO oráculo escolheu: ${rotulo} (@${limparNumero(alvo.id)})!`, mentions: [alvo.id]
      }, { quoted: msg })
    } catch (err) {
      console.error('[quem]', err?.message || err)
      await sock.sendMessage(jid, { text: '⚠️ Não consegui consultar o grupo agora. Tente novamente.' }, { quoted: msg }).catch(() => {})
    }
  },
  _limparMemoria: sorteio.limpar
}
