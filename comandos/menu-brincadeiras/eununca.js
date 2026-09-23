// ============================================
// 🍻 EUNUNCA — Sorteia uma frase "Eu nunca..." (/eununca)
// ============================================
// Uso LIVRE: /eununca (também: /nuncaeu). Sem argumentos, sem alvo —
// só uma frase solta no grupo pra todo mundo reagir por conta própria
// (não rastreia quem "bebeu" ou não).
//
// Banco de conteúdo: dados/frases-eununca.js (curadoria manual).
// Anti-repetição: guarda em memória (Map por grupo, sem Mongo) a última
// frase sorteada — nunca repete a mesma duas vezes seguidas.
// ============================================

const FRASES = require('../../dados/frases-eununca')

// Última frase sorteada por grupo (chave: jid, valor: frase).
const ultimaPorGrupo = new Map()

function sortearFrase(lista, ultima) {
  if (!Array.isArray(lista) || lista.length === 0) return null
  if (lista.length === 1) return lista[0]
  let frase = lista[Math.floor(Math.random() * lista.length)]
  let tentativas = 0
  while (frase === ultima && tentativas < 10) {
    frase = lista[Math.floor(Math.random() * lista.length)]
    tentativas += 1
  }
  if (frase === ultima) {
    const outra = lista.find((f) => f !== ultima)
    if (outra) frase = outra
  }
  return frase
}

module.exports = {
  nome: 'eununca',
  aliases: ['nuncaeu'],
  descricao: 'Sorteia uma frase "Eu nunca..." pra brincadeira de grupo (também: /nuncaeu).',

  async executar(sock, jid, msg) {
    try {
      const frase = sortearFrase(FRASES, ultimaPorGrupo.get(jid))
      if (!frase) {
        return await sock.sendMessage(jid, {
          text: '🍻 O copo do limbo está vazio... tente de novo em instantes.'
        }, { quoted: msg })
      }
      ultimaPorGrupo.set(jid, frase)
      await sock.sendMessage(jid, {
        text: '🍻 *EU NUNCA...*\n\n' + frase + '\n\nQuem já fez, conta pra gente! 😏'
      }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando eununca:', err)
      await sock.sendMessage(jid, {
        text: '⛔ O copo do limbo quebrou... tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  FRASES,
  sortearFrase,
  _ultimaPorGrupo: ultimaPorGrupo,
  _limparMemoria: () => ultimaPorGrupo.clear()
}
