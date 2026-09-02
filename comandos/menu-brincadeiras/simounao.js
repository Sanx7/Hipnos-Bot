// ============================================
// 🔮 SIM OU NÃO — O Oráculo Binário de Hipnos
// ============================================
// Recebe uma pergunta e responde aleatoriamente
// "Sim" ou "Não", como um sonho ditando a verdade.
// ============================================

// Frases que anunciam a resposta do oráculo
const INTROS = [
  'Os véus do sono desceram sobre a sua pergunta... e o subconsciente respondeu:',
  'Hipnos consultou os reinos oníricos... o oráculo declarou:',
  'Entre o transe e a realidade, a resposta ecoou:',
  'As sombras do limbo sussurraram o veredito do seu dilema:'
]

// Respostas possíveis sorteadas a cada consulta
const RESPOSTAS = ['Sim', 'Não']

// Mensagem exibida quando a pergunta está vazia
const AVISO_PERGUNTA = '⛔ O oráculo não lê mentes vazias. Escreva uma pergunta depois do comando.\n\n🗝️ Exemplo: `/simounao devo dormir cedo hoje?`'

// Sorteia um item aleatório de uma lista
function sortearItem(lista) {
  return lista[Math.floor(Math.random() * lista.length)]
}

module.exports = {
  nome: 'simounao',
  descricao: 'Responde Sim ou Não para a sua pergunta, como o oráculo dos sonhos.',

  async executar(sock, jid, msg, texto) {
    try {
      // Extrai tudo o que foi digitado depois de "/simounao"
      const pergunta = String(texto || '').replace(/^\/\S+\s*/, '').trim()

      // Sem pergunta: pede para o usuário escrever uma
      if (!pergunta) {
        return await sock.sendMessage(jid, { text: AVISO_PERGUNTA }, { quoted: msg })
      }

      // Sorteia entre Sim e Não
      const resposta = sortearItem(RESPOSTAS)

      const mensagem = `${sortearItem(INTROS)}\n\n🎴 *${resposta}*`

      await sock.sendMessage(jid, { text: mensagem }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando simounao:', err)
      await sock.sendMessage(jid, {
        text: '⛔ O oráculo emudeceu... Tente perguntar novamente.'
      }, { quoted: msg })
    }
  }
}