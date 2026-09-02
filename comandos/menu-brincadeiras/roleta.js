// ============================================
// 🎰 ROLETA — A Roda Onírica do Destino de Hipnos
// ============================================
// Busca os participantes do grupo via Baileys,
// sorteia um membro aleatório e responde marcando-o.
// Fora de um grupo, avisa que só funciona em grupos.
// ============================================

// Frases de suspense antes de revelar o sorteado
const SUSPENSE = [
  'As teias do destino giraram entre os presentes...',
  'A roda onírica girou lentamente sobre as almas deste grupo...',
  'O pêndulo da hipnose dançou entre os participantes...',
  'As sombras do limbo apontaram para um nome...'
]

// Sorteia uma frase aleatória de uma lista
function sortearFrase(lista) {
  return lista[Math.floor(Math.random() * lista.length)]
}

module.exports = {
  nome: 'roleta',
  descricao: 'Sorteia e marca um membro aleatório do grupo.',

  async executar(sock, jid, msg) {
    try {
      // Só funciona dentro de grupos
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, {
          text: '🎰 A roleta dos sonhos só gira dentro de um grupo. Use este comando no grupo para que Hipnos sorteie uma alma entre os presentes.'
        }, { quoted: msg })
      }

      // Busca os participantes do grupo via Baileys
      const metadados = await sock.groupMetadata(jid)
      const participantes = metadados.participants.map((p) => p.id)

      // Identifica o número do próprio bot para nunca sortear ele mesmo
      const numeroDoBot = (sock.user?.id || '').split('@')[0].split(':')[0]
      const alvos = participantes.filter((participante) => {
        if (!numeroDoBot) return true
        const numero = participante.split('@')[0].split(':')[0]
        return numero !== numeroDoBot
      })

      if (alvos.length === 0) {
        return await sock.sendMessage(jid, {
          text: '🎰 As sombras não encontraram nenhuma alma para sortear neste grupo.'
        }, { quoted: msg })
      }

      // Sorteia um membro aleatório entre os participantes
      const escolhido = alvos[Math.floor(Math.random() * alvos.length)]
      const numeroExibicao = escolhido.split('@')[0].split(':')[0]

      const mensagem = `${sortearFrase(SUSPENSE)}\n\n🎰 A sorte onírica escolheu: @${numeroExibicao}\n\n💀 Que os sonhos decidam o seu destino, mortal.`

      // Responde marcando a pessoa sorteada
      await sock.sendMessage(jid, {
        text: mensagem,
        mentions: [escolhido]
      }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando roleta:', err)
      await sock.sendMessage(jid, {
        text: '🎰 A roda onírica se quebrou... Tente novamente.'
      }, { quoted: msg })
    }
  }
}