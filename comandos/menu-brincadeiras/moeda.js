// ============================================
// 🪙 MOEDA — O Julgamento do Destino de Hipnos
// ============================================
// Sorteia Cara ou Coroa com o tom místico do
// universo dos sonhos, hipnose e subconsciente.
// ============================================

// Frases escolhidas aleatoriamente a cada giro
const RESULTADOS = {
  cara: [
    'A moeda do destino girou entre o transe e a realidade... e caiu em: ☀️ Cara!',
    'O pêndulo do sono oscilou para os reinos iluminados do subconsciente... ⚖️ Cara!',
    'As sombras se afastaram e o véu revelou o lado claro dos sonhos: ☀️ Cara!',
    'A luz do sonho lúcido guiou a moeda... ela repousou sobre: ☀️ Cara!\n💭 "Desperta para uma realidade mais leve, mortal."'
  ],
  coroa: [
    'O pêndulo do sono decidiu: 🌙 Coroa!',
    'A moeda afundou nas profundezas do inconsciente... e emergiu em: 🌙 Coroa!',
    'Os sonhos sombrios sussurraram a resposta... a face noturna escolhida foi: 🌙 Coroa!',
    'A escuridão abraçou a moeda e a entregou ao lado oculto do destino: 🌙 Coroa!\n💭 "A noite guarda segredos para quem sabe dormir."'
  ]
}

function sortearLado() {
  return Math.random() < 0.5 ? 'cara' : 'coroa'
}

module.exports = {
  nome: 'moeda',
  descricao: 'Sorteia Cara ou Coroa entre os véus do destino.',

  async executar(sock, jid, msg) {
    try {
      const lado = sortearLado()
      const respostas = RESULTADOS[lado]
      const mensagem = respostas[Math.floor(Math.random() * respostas.length)]

      await sock.sendMessage(jid, { text: mensagem }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando moeda:', err)
      await sock.sendMessage(jid, {
        text: '❌ Os véus do destino se embaralharam... Tente novamente.'
      }, { quoted: msg })
    }
  }
}