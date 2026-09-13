// ============================================
// 📊 MEDIAAVALIACOES — Média geral das notas (público)
// ============================================
// Uso:
//   /mediaavaliacoes  -> calcula via agregação $avg no MongoDB
//
// Regras:
//   - Comando PÚBLICO: qualquer mortal pode consultar.
//   - Formato: "⭐ 4.3/5 baseado em 127 avaliações".
//   - Sem avaliações: aviso amigável pedindo a 1ª nota.
// ============================================

const banco = require('../../avaliacoes')

// 4.25 → "4.3" (1 casa, arredondamento padrão)
function formatarMedia(media) {
  const arredondada = Math.round(Number(media) * 10) / 10
  return String(arredondada.toFixed(1)).replace('.', ',')
}

module.exports = {
  nome: 'mediaavaliacoes',
  aliases: ['media-avaliacoes', 'mediaavaliacao', 'notamedia', 'media-notas'],
  descricao: 'Mostra a média geral das avaliações do bot.',

  async executar(sock, jid, msg) {
    try {
      let estatistica = null
      try {
        estatistica = await banco.calcularMedia()
      } catch (err) {
        console.error('[mediaavaliacoes] falha ao ler o MongoDB:', err?.message || err)
        return await sock.sendMessage(jid, {
          text: '⛔ A urna de avaliações está indisponível no momento... Tente de novo mais tarde. 🌙'
        }, { quoted: msg })
      }

      if (!estatistica || !estatistica.total) {
        return await sock.sendMessage(jid, {
          text: '📭 *Ainda não há avaliações...*\n\nSeja o primeiro a avaliar Hipnos com `/avaliar 5`! ⭐🌙'
        }, { quoted: msg })
      }

      const unidade = estatistica.total === 1 ? 'avaliação' : 'avaliações'
      await sock.sendMessage(jid, {
        text: `⭐ *${formatarMedia(estatistica.media)}/5* baseado em *${estatistica.total}* ${unidade}.\n\nAvalie você também: /avaliar <1-5> 🌙`
      }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando mediaavaliacoes:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente. 🌙'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
