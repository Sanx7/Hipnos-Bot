// ============================================
// 🎤 RIMAS — Sorteia uma palavra e desafia o grupo a rimar (/rimas)
// ============================================
// Uso LIVRE: /rimas. Sem argumentos, sem alvo — só sorteia uma palavra
// com terminação sonora fácil de rimar e lança o desafio no grupo.
// A galera responde livremente no chat e decide entre si quem mandou
// melhor (rima é subjetiva — sem validação automática de propósito).
//
// Banco de conteúdo: dados/palavras-rima.js (curadoria manual).
// Anti-repetição: guarda em memória (Map por grupo, sem Mongo) a última
// palavra sorteada — nunca repete a mesma duas vezes seguidas.
// Mesmo padrão do /eununca.
// ============================================

const PALAVRAS = require('../../dados/palavras-rima')

// Última palavra sorteada por grupo (chave: jid, valor: palavra).
const ultimaPorGrupo = new Map()

function sortearPalavra(lista, ultima) {
  if (!Array.isArray(lista) || lista.length === 0) return null
  if (lista.length === 1) return lista[0]
  let palavra = lista[Math.floor(Math.random() * lista.length)]
  let tentativas = 0
  while (palavra === ultima && tentativas < 10) {
    palavra = lista[Math.floor(Math.random() * lista.length)]
    tentativas += 1
  }
  if (palavra === ultima) {
    const outra = lista.find((p) => p !== ultima)
    if (outra) palavra = outra
  }
  return palavra
}

module.exports = {
  nome: 'rimas',
  aliases: ['rima'],
  descricao: 'Sorteia uma palavra e desafia o grupo a completar uma rima com ela (também: /rima).',

  async executar(sock, jid, msg) {
    try {
      const palavra = sortearPalavra(PALAVRAS, ultimaPorGrupo.get(jid))
      if (!palavra) {
        return await sock.sendMessage(jid, {
          text: '🎤 O pergaminho das rimas está vazio... tente de novo em instantes.'
        }, { quoted: msg })
      }
      ultimaPorGrupo.set(jid, palavra)
      await sock.sendMessage(jid, {
        text: '🎤 *DESAFIO DA RIMA*\n\nRime com: *' + palavra + '*\n\nMandem suas rimas no chat e decidam entre vocês quem mandou melhor! 🔥'
      }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando rimas:', err)
      await sock.sendMessage(jid, {
        text: '⛔ A lira do sonho desafinou... tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  PALAVRAS,
  sortearPalavra,
  _ultimaPorGrupo: ultimaPorGrupo,
  _limparMemoria: () => ultimaPorGrupo.clear()
}
