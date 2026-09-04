// ============================================
// 🏆 SORTEIO — O Concurso Onírico de Hipnos
// ============================================
// Recebe usuários marcados na mensagem e sorteia
// um vencedor entre eles, anunciando-o.
// Com menos de duas menções, pede para marcar
// pelo menos dois participantes.
// ============================================

// Frases que anunciam o sorteio antes do vencedor
const SUSPENSE = [
  '🎴 As sombras do limbo giraram os nomes dos sorteados...',
  '🔮 O pêndulo da hipnose balançou entre todos os concorrentes...',
  '🌑 Os véus do destino se abriram sobre os participantes...',
  '⚖️ O subconsciente pesou cada alma inscrita no concurso...'
]

// Aviso quando faltam menções suficientes
const AVISO_MENCOES = '⛔ O oráculo precisa de pelo menos *dois* participantes marcados para sortear.\n\n🗝️ Exemplo: `/sorteio de duas passagens aéreas @fulano @cicrano`'

// Sorteia uma frase aleatória de uma lista
function sortearFrase(lista) {
  return lista[Math.floor(Math.random() * lista.length)]
}

// Remove apenas o sufixo de dispositivo (:N), mantendo o domínio ORIGINAL
// do JID mencionado — nunca converte @lid em @s.whatsapp.net (número falso).
function normalizarJid(id) {
  const bruto = String(id || '')
  const [usuario, servidor] = bruto.split('@')
  if (!usuario || !servidor) return ''
  return `${usuario.split(':')[0]}@${servidor}`
}

module.exports = {
  nome: 'sorteio',
  descricao: 'Sorteia um vencedor entre os usuários marcados na mensagem.',

  async executar(sock, jid, msg, texto) {
    try {
      // Lista de usuários marcados na própria mensagem (via Baileys)
      const mencionadosBrutos =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []

      // Deduplica, remove o próprio bot e normaliza os JIDs
      const numeroDoBot = (sock.user?.id || '').split('@')[0].split(':')[0]
      const participantes = [...new Set(mencionadosBrutos)]
        .map(normalizarJid)
        .filter((jidMencionado) => {
          if (!numeroDoBot) return true
          return jidMencionado.split('@')[0] !== numeroDoBot
        })

      // Precisa de pelo menos dois participantes válidos
      if (participantes.length < 2) {
        return await sock.sendMessage(jid, { text: AVISO_MENCOES }, { quoted: msg })
      }

      // Extrai a descrição do prêmio (texto após /sorteio, sem as menções @ número)
      const premio = String(texto || '')
        .replace(/^\/\S+\s*/, '')
        .replace(/@\d+/g, '')
        .replace(/\s+/g, ' ')
        .trim()

      // Sorteia um vencedor entre os participantes
      const vencedor = participantes[Math.floor(Math.random() * participantes.length)]

      const mensagem =
        `${sortearFrase(SUSPENSE)}\n\n` +
        `🏆 O vencedor ${premio ? `do prêmio *${premio}* ` : 'do sorteio'}é... @${vencedor.split('@')[0]}!\n\n` +
        `💤 Que o sucesso não tire o seu sono, eleito dos sonhos.`

      // Responde anunciando o vencedor (marcado na mensagem)
      await sock.sendMessage(jid, {
        text: mensagem,
        mentions: [vencedor]
      }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando sorteio:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As urnas do sono se romperam... Tente novamente.'
      }, { quoted: msg })
    }
  }
}