const { listarAtividade, PERIODO, NOTA } = require('../../dados/atividade-grupo')
const cooldowns = require('../../dados/cooldowns')
const { limparNumero } = require('../../config')

module.exports = {
  nome: 'rankativo',
  categoria: 'utilitario',
  descricao: 'Top 10 participantes atuais mais ativos do grupo.',
  async executar(sock, jid, msg) {
    try {
      if (!jid.endsWith('@g.us')) return await sock.sendMessage(jid, { text: '💤 O /rankativo só funciona em grupos.' }, { quoted: msg })
      const chave = `rankativo:${jid}:${limparNumero(msg.key.participant)}`
      const espera = cooldowns.verificar(chave, 10000)
      if (espera.emCooldown) return await sock.sendMessage(jid, { text: `⏳ Aguarde ${espera.restanteFormatado} para usar /rankativo novamente.` }, { quoted: msg })
      const metadata = await sock.groupMetadata(jid)
      const top = (await listarAtividade(sock, jid, metadata.participants || []))
        .sort((a, b) => b.total - a.total).slice(0, 10)
      const mentions = top.map(p => p.jid)
      const linhas = top.map((p, i) => `${['🥇', '🥈', '🥉'][i] || '🏅'} ${i + 1}º — @${limparNumero(p.jid)} — ${p.total.toLocaleString('pt-BR')} ${p.total === 1 ? 'mensagem' : 'mensagens'}`)
      await sock.sendMessage(jid, {
        text: '🌙 *HIPNOS — RANKING DE ATIVIDADE*\n\n🏆 *TOP 10 MAIS ATIVOS*\n\n' +
          (linhas.join('\n') || 'Nenhum participante elegível.') + `\n\n${PERIODO}\n${NOTA}`,
        mentions, contextInfo: { mentionedJid: mentions }
      }, { quoted: msg })
      cooldowns.marcar(chave)
    } catch (err) {
      console.error('[rankativo]', err?.message || err)
      await sock.sendMessage(jid, { text: '⚠️ Não consegui consultar os membros ou a contagem agora. Tente novamente.' }, { quoted: msg }).catch(() => {})
    }
  }
}
