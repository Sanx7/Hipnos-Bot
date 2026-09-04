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

// Retorna o JID real e mencionável de um participante do grupo.
// - Prefere `phoneNumber` (número real @s.whatsapp.net) quando o WhatsApp
//   entrega o participante como LID (@lid);
// - Mantém o domínio ORIGINAL do id — NUNCA reconstroi @s.whatsapp.net a
//   partir de um LID (isso gerava números de telefone falsos);
// - Remove o sufixo de dispositivo (:N) para a menção renderizar.
function jidMencionavel(participante) {
  const bruto = participante?.phoneNumber || participante?.id || ''
  const [usuario, servidor] = String(bruto).split('@')
  if (!usuario || !servidor) return ''
  return `${usuario.split(':')[0]}@${servidor}`
}

// Extrai apenas os dígitos de um JID, para comparar com o número do bot
function apenasDigitos(jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
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

      // 1) Busca a lista REAL de participantes do grupo via Baileys
      const metadados = await sock.groupMetadata(jid)
      const participantes = metadados.participants || []

      // 2) Converte para JIDs mencionáveis reais, deduplica e remove o bot
      const numeroDoBot = apenasDigitos(sock.user?.id)
      const alvos = participantes
        .map(jidMencionavel)
        .filter(Boolean)
        .filter((jidAlvo, indice, lista) => lista.indexOf(jidAlvo) === indice) // deduplica
        .filter((jidAlvo) => {
          if (!numeroDoBot) return true
          return apenasDigitos(jidAlvo) !== numeroDoBot
        })

      if (alvos.length === 0) {
        return await sock.sendMessage(jid, {
          text: '🎰 As sombras não encontraram nenhuma alma para sortear neste grupo.'
        }, { quoted: msg })
      }

      // 3) Sorteia um membro REAL aleatório entre os participantes
      const escolhido = alvos[Math.floor(Math.random() * alvos.length)]
      const numeroExibicao = escolhido.split('@')[0]

      const mensagem = `${sortearFrase(SUSPENSE)}\n\n🎰 A sorte onírica escolheu: @${numeroExibicao}\n\n💀 Que os sonhos decidam o seu destino, mortal.`

      // 4) Responde marcando a pessoa sorteada com o JID REAL dela
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