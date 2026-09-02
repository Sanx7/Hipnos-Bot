// ============================================
// 🔮 ESCOLHA — O Oráculo das Decisões de Hipnos
// ============================================
// Recebe uma lista de opções separadas por vírgula
// e sorteia uma delas, como um sonho decidindo o destino.
// ============================================

// Frases de abertura que anunciam a escolha do destino
const INTROS = [
  'Os sonhos sussurraram entre as opções...',
  'O subconsciente ponderou cada caminho...',
  'Hipnos consultou os véus do destino acerca do seu dilema...',
  'As teias do inconsciente escolheram por você:',
  'Entre os caminhos que dormem à sua frente, o oráculo declarou:'
]

// Mensagem exibida quando faltam opções suficientes
const AVISO_OPCOES = `⛔ O oráculo precisa de pelo menos *duas opções* separadas por vírgula para decidir.\n\n🗝️ Exemplo: \`/escolha dormir, sonhar, conquistar o mundo\``

// Sorteia uma frase aleatória de uma lista
function sortearFrase(lista) {
  return lista[Math.floor(Math.random() * lista.length)]
}

// Sorteia um item aleatório de um array
function sortearItem(lista) {
  return lista[Math.floor(Math.random() * lista.length)]
}

module.exports = {
  nome: 'escolha',
  descricao: 'Sorteia uma opção entre as que você enviar separadas por vírgula.',

  async executar(sock, jid, msg, texto) {
    try {
      // Extrai tudo o que foi digitado depois de "/escolha"
      const listaBruta = String(texto || '').replace(/^\/\S+\s*/, '').trim()

      // Separa por vírgula, limpa espaços extras e remove opções vazias
      const opcoes = listaBruta
        .split(',')
        .map((opcao) => opcao.trim())
        .filter((opcao) => opcao.length > 0)

      // Só decide quando existem pelo menos duas opções válidas
      if (opcoes.length < 2) {
        return await sock.sendMessage(jid, { text: AVISO_OPCOES }, { quoted: msg })
      }

      // Sorteia uma das opções
      const escolhida = sortearItem(opcoes)

      const mensagem = `${sortearFrase(INTROS)}\n\n🔮 Entre ${opcoes.length} caminhos, o destino escolheu: *${escolhida}*`

      await sock.sendMessage(jid, { text: mensagem }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando escolha:', err)
      await sock.sendMessage(jid, {
        text: '⛔ O véu das decisões se rasgou... Tente novamente.'
      }, { quoted: msg })
    }
  }
}