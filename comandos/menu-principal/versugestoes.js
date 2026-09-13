// ============================================
// 📋 VERSUGESTOES — Lista as sugestões pendentes (só DONOS do bot)
// ============================================
// Uso:
//   /versugestoes [limite]  -> pendentes numeradas (1 = mais antiga)
//
// Regras:
//   - SOMENTE donos do bot (lista OWNER_NUMBERS — mesma verificação
//     PROOF-LID do /darvip: resolve o sender nos metadados quando ele
//     vem como "@lid"; no privado cai na comparação direta).
//   - Cada número da lista é o índice do /marcarsugestao.
// ============================================

const { ehDonoDoBot } = require('../../config')
const banco = require('../../sugestoes')

// Corta textos longos p/ a lista não estourar o limite do WhatsApp
function resumir(texto, teto = 120) {
  const limpo = String(texto || '').replace(/\s+/g, ' ').trim()
  if (limpo.length <= teto) return limpo
  return limpo.slice(0, teto - 1).trimEnd() + '…'
}

module.exports = {
  nome: 'versugestoes',
  aliases: ['versugestao', 'listarsugestoes', 'sugestoes-pendentes'],
  descricao: 'Lista as sugestões pendentes (apenas donos do bot).',

  async executar(sock, jid, msg, text) {
    try {
      const sender = msg.key?.participant || msg.key?.remoteJid || ''

      // 1) Gate de dono (PROOF-LID)
      let participantes = null
      if (jid.endsWith('@g.us')) {
        try {
          const metadados = await sock.groupMetadata(jid)
          participantes = metadados?.participants || null
        } catch (err) {
          console.error('[versugestoes] sem metadados do grupo:', err?.message || err)
        }
      }
      if (!ehDonoDoBot(participantes, sender)) {
        return await sock.sendMessage(jid, {
          text: '🌑 *Hipnos só obedece aos donos do bot.*\n\nA caixa de sugestões permanece selada aos olhos dos mortais.'
        }, { quoted: msg })
      }

      // 2) Limite opcional: /versugestoes 10
      const args = String(text || '').split(' ').slice(1).filter(Boolean)
      const pedido = Math.floor(Number(args[0]))
      const limite = Number.isFinite(pedido) ? Math.max(1, Math.min(pedido, 50)) : 15

      // 3) Busca no MongoDB
      let pendentes = null
      try {
        pendentes = await banco.listarPendentes(limite)
      } catch (err) {
        console.error('[versugestoes] falha ao ler o MongoDB:', err?.message || err)
        return await sock.sendMessage(jid, {
          text: '⛔ A caixa de sugestões está indisponível no momento... Tente de novo mais tarde. 🌙'
        }, { quoted: msg })
      }

      if (!pendentes || pendentes.length === 0) {
        return await sock.sendMessage(jid, {
          text: '📭 *Caixa de sugestões vazia!*\n\nNenhuma sugestão pendente no momento. Os mortais estão sem ideias... 🌙'
        }, { quoted: msg })
      }

      // 4) Monta a lista numerada (1 = mais antiga = índice do /marcarsugestao)
      const linhas = pendentes.map((doc, i) => {
        const origem = doc.nome_grupo ? `📍 ${doc.nome_grupo}` : '📍 privado'
        const autor = doc.nome_remetente
          ? `${doc.nome_remetente} (@${doc.numero})`
          : `@${doc.numero}`
        return (
          `*${i + 1}.* 📝 "${resumir(doc.texto)}"\n` +
          `   👤 ${autor} · ${origem}\n` +
          `   🗓️ ${banco.formatarDataHora(doc.criado_em)}`
        )
      })

      const resposta =
        `📋 *Sugestões pendentes (${pendentes.length})*\n` +
        '(da mais antiga para a mais nova)\n\n' +
        linhas.join('\n\n') +
        '\n\nPara resolver: `/marcarsugestao <número> atendida` ou `/marcarsugestao <número> recusada`'

      await sock.sendMessage(jid, { text: resposta }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando versugestoes:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente. 🌙'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
