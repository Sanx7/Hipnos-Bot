// ============================================
// 🔢 NÚMERO — O Número Revelado pelo Subconsciente
// ============================================
// Sorteia um número inteiro aleatório dentro do
// intervalo [min, max] informado pelo usuário.
// Sem parâmetros, usa o padrão de 1 a 100.
// ============================================

// Intervalo padrão quando o comando é chamado sem argumentos
const PADRAO_MIN = 1
const PADRAO_MAX = 100

// Frases de abertura escolhidas aleatoriamente a cada sorteio
const INTROS = [
  'As névoas do subconsciente revelam o número:',
  'O pêndulo da hipnose oscilou e gravou no ar o número:',
  'Os reinos oníricos sussurram o veredito numérico:',
  'Entre o transe e a realidade, o destino escolheu:',
  'O oráculo do sono declarou o número profético:'
]

// Erro quando faltam números ou a entrada não é um inteiro válido
const ERRO_INVALIDO = '⛔ Os reinos do sono só compreendem números inteiros e em ordem crescente. Use `min` menor que `max`, como `/numero 10 20`.'

// Erro quando o intervalo está invertido ou os números são iguais
const ERRO_INTERVALO = '⛔ O limiar do sonho está invertido: o primeiro número precisa ser *menor* que o segundo. Ex: `/numero 10 20` (ou `/numero -10 5`).'

// Sorteia uma frase aleatória de uma lista
function sortearFrase(lista) {
  return lista[Math.floor(Math.random() * lista.length)]
}

// Rola um número inteiro aleatório entre min e max (inclusive)
function sortearNumero(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

module.exports = {
  nome: 'numero',
  descricao: 'Sorteia um número inteiro aleatório dentro do intervalo informado (padrão: 1 a 100).',

  async executar(sock, jid, msg, texto) {
    try {
      // Extrai tudo o que foi digitado depois de "/numero"
      const argumentos = String(texto || '')
        .replace(/^\/\S+\s*/, '')
        .trim()
        .split(/\s+/)
        .filter((arg) => arg.length > 0)

      // Sem argumentos: usa o padrão de 1 a 100
      if (argumentos.length === 0) {
        const numero = sortearNumero(PADRAO_MIN, PADRAO_MAX)
        const mensagem = `${sortearFrase(INTROS)}\n\n🔢 O destino escolheu: *${numero}* (entre ${PADRAO_MIN} e ${PADRAO_MAX})`
        return await sock.sendMessage(jid, { text: mensagem }, { quoted: msg })
      }

      // Um único número não forma um intervalo
      if (argumentos.length === 1) {
        return await sock.sendMessage(jid, { text: ERRO_INVALIDO }, { quoted: msg })
      }

      const [minTexto, maxTexto] = argumentos

      // Valida que ambos eram números inteiros (permite negativos, sem sinais extras)
      if (!/^-?\d+$/.test(minTexto) || !/^-?\d+$/.test(maxTexto)) {
        return await sock.sendMessage(jid, { text: ERRO_INVALIDO }, { quoted: msg })
      }

      const min = parseInt(minTexto, 10)
      const max = parseInt(maxTexto, 10)

      // Valida que o mínimo é estritamente menor que o máximo
      if (min >= max) {
        return await sock.sendMessage(jid, { text: ERRO_INTERVALO }, { quoted: msg })
      }

      const numero = sortearNumero(min, max)
      const mensagem = `${sortearFrase(INTROS)}\n\n🔢 O destino escolheu: *${numero}* (entre ${min} e ${max})`

      await sock.sendMessage(jid, { text: mensagem }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando numero:', err)
      await sock.sendMessage(jid, {
        text: '⛔ Os números se perderam nos sonhos... Tente novamente.'
      }, { quoted: msg })
    }
  }
}