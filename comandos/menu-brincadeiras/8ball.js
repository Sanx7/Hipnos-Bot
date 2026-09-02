// ============================================
// 🔮 8BALL — O Orbe do Subconsciente de Hipnos
// ============================================
// Simula uma bola 8 mágica: recebe uma pergunta,
// sorteia uma resposta entre várias e responde
// junto com a pergunta original. Sem pergunta,
// pede para o usuário perguntar algo.
// ============================================

// Respostas possíveis do orbe (Sim / Não / Talvez / Ambíguas)
const RESPOSTAS = [
  // Afirmativas
  'Sim, os sonhos confirmam isso.',
  'Certamente. O subconsciente já decidiu.',
  'Sem dúvidas, o destino já te respondeu durante o sono.',
  'Sim — e as sombras deste reino concordam.',
  'Tudo indica que sim, mortal.',
  // Negativas
  'Não. As névoas do sono fogem dessa ideia.',
  'Dificilmente. O oráculo balançou o pêndulo para o outro lado.',
  'Não conte com isso. Até os sonhos têm limites.',
  'As esferas do limbo dizem que não.',
  'Negativo. O inconsciente já arquivou essa hipótese.',
  // Talvez / Ambíguas
  'Talvez... pergunte novamente quando as sombras clarearem.',
  'As teias do destino ainda estão se tecendo. Pergunte de novo mais tarde.',
  'Não consigo enxergar com clareza agora. O sono está denso demais...',
  'A resposta flutua entre o transe e a realidade. Tente novamente.',
  'Minha bola de cristal onírica está embaçada. Volte a sonhar e pergunte outra vez.'
]

// Sorteia uma resposta aleatória da lista
function sortearFrase(lista) {
  return lista[Math.floor(Math.random() * lista.length)]
}

module.exports = {
  nome: '8ball',
  descricao: 'Bola 8 mágica dos sonhos: responde a sua pergunta com o oráculo do subconsciente.',

  async executar(sock, jid, msg, texto) {
    try {
      // Extrai a pergunta digitada depois de "/8ball"
      const pergunta = String(texto || '').replace(/^\/\S+\s*/, '').trim()

      // Sem pergunta: pede para o usuário perguntar algo
      if (!pergunta) {
        return await sock.sendMessage(jid, {
          text: '🔮 O orbe dos sonhos não responde a silêncios. Faça uma pergunta depois do comando.\n\n🗝️ Exemplo: `/8ball devo mudar de emprego?`'
        }, { quoted: msg })
      }

      // Sorteia uma das respostas
      const resposta = sortearFrase(RESPOSTAS)

      const mensagem = `🔮 *A PERGUNTA:*\n${pergunta}\n\n✨ *O ORBE DE HIPNOS RESPONDE:*\n${resposta}`

      await sock.sendMessage(jid, { text: mensagem }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando 8ball:', err)
      await sock.sendMessage(jid, {
        text: '⛔ O orbe se despedaçou... Tente perguntar novamente.'
      }, { quoted: msg })
    }
  }
}