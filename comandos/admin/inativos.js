const { listarAtividade, autorizado, PERIODO, NOTA } = require('../../dados/atividade-grupo')
const { obterPrefixo } = require('../../prefixo')

module.exports = {
  nome: 'inativos',
  categoria: 'admin',
  descricao: 'Participantes com 0 a 5 mensagens registradas (ADM ou dono).',
  async executar(sock, jid, msg, text = '') {
    try {
      if (!jid.endsWith('@g.us')) return await sock.sendMessage(jid, { text: '💤 O /inativos só funciona em grupos.' }, { quoted: msg })
      const metadata = await sock.groupMetadata(jid)
      const participantes = metadata.participants || []
      if (!await autorizado(participantes, msg)) return await sock.sendMessage(jid, { text: '⛔ Apenas ADM ou dono do bot pode usar /inativos.' }, { quoted: msg })
      const argumento = text.trim().split(/\s+/).slice(1).join(' ')
      const pagina = argumento ? Number(argumento) : 1
      if ((argumento && !/^[1-9]\d*$/.test(argumento)) || !Number.isSafeInteger(pagina)) {
        return await sock.sendMessage(jid, { text: '⚠️ Informe uma página inteira positiva.' }, { quoted: msg })
      }
      const inativos = (await listarAtividade(sock, jid, participantes))
        .filter(p => p.total >= 0 && p.total <= 5).sort((a, b) => a.total - b.total)
      const paginas = Math.max(1, Math.ceil(inativos.length / 20))
      if (pagina > paginas) return await sock.sendMessage(jid, { text: `⚠️ Página inexistente. Há ${paginas} página(s).` }, { quoted: msg })
      const linhas = inativos.slice((pagina - 1) * 20, pagina * 20)
        .map(p => `👤 ${p.identificacao} — ${p.total} ${p.total === 1 ? 'mensagem' : 'mensagens'}`)
      const proxima = pagina < paginas ? `\nPróxima página: ${await obterPrefixo()}inativos ${pagina + 1}` : ''
      await sock.sendMessage(jid, {
        text: '💤 *HIPNOS — MEMBROS INATIVOS*\n\n👥 Participantes com 0 a 5 mensagens registradas\n\n' +
          (linhas.join('\n') || 'Nenhum membro com baixa atividade.') +
          `\n\n📊 Total: ${inativos.length} membros com baixa atividade.\nPágina ${pagina} de ${paginas}.${proxima}\n\n${PERIODO}\n` +
          `0 = nenhuma mensagem registrada pelo Hipnos; não necessariamente desde a entrada no grupo.\n${NOTA}`
      }, { quoted: msg })
    } catch (err) {
      console.error('[inativos]', err?.message || err)
      await sock.sendMessage(jid, { text: '⚠️ Não consegui consultar os membros ou a contagem agora. Tente novamente.' }, { quoted: msg }).catch(() => {})
    }
  }
}
