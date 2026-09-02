// ============================================
// 🃏 CARTA — A Carta do Destino de Hipnos
// ============================================
// Sorteia uma carta aleatória de um baralho padrão
// (naipes: ouros, copas, espadas, paus; valores:
// A, 2-10, J, Q, K) e responde com a carta sorteada.
// ============================================

// Naipes do baralho padrão com seus símbolos
const NAIPES = [
  { nome: 'ouros', simbolo: '♦️' },
  { nome: 'copas', simbolo: '♥️' },
  { nome: 'espadas', simbolo: '♠️' },
  { nome: 'paus', simbolo: '♣️' }
]

// Valores possíveis do baralho
const VALORES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

// Frases de abertura escolhidas aleatoriamente a cada sorteio
const INTROS = [
  'As sombras do limbo embaralharam o baralho onírico...',
  'O pêndulo da hipnose pairou sobre as cartas do destino...',
  'Os véus do sono revelaram a carta escolhida...',
  'O subconsciente girou o baralho dos sonhos e apontou...'
]

// Sorteia um item aleatório de uma lista
function sortearItem(lista) {
  return lista[Math.floor(Math.random() * lista.length)]
}

module.exports = {
  nome: 'carta',
  descricao: 'Sorteia uma carta aleatória de um baralho padrão.',

  async executar(sock, jid, msg) {
    try {
      // Sorteia um naipe e um valor independentemente
      const naipe = sortearItem(NAIPES)
      const valor = sortearItem(VALORES)

      const simbolo = naipe.simbolo
      // Símbolos de ouros/copas são vermelhos; espadas/paus são pretos
      const emoji = (valor === 'J' || valor === 'Q' || valor === 'K') ? '🃏' : '🎴'

      const mensagem = `${sortearItem(INTROS)}\n\n${emoji} A carta do destino é: *${valor} de ${naipe.nome}* ${simbolo}`

      await sock.sendMessage(jid, { text: mensagem }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando carta:', err)
      await sock.sendMessage(jid, {
        text: '⛔ O baralho onírico se dispersou... Tente novamente.'
      }, { quoted: msg })
    }
  }
}