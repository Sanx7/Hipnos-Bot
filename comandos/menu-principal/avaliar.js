// ============================================
// ⭐ AVALIAR — Registra a nota do mortal (1 número = 1 avaliação)
// ============================================
// Uso:
//   /avaliar <1-5>  -> salva no MongoDB (collection "avaliacoes")
//
// Regras:
//   - Nota OBRIGATÓRIA e entre 1 e 5 (fora disso = aviso de formato).
//   - ANTES de salvar, checa se o número já avaliou: se sim, recusa
//     com carinho SEM sobrescrever, duplicar ou reavaliar.
//   - 1ª avaliação: salva e confirma com agradecimento.
// ============================================

const { limparNumero } = require('../../config')
const banco = require('../../avaliacoes')

module.exports = {
  nome: 'avaliar',
  aliases: ['avalia', 'nota', 'avaliacao', 'avaliar-bot'],
  descricao: 'Avalie o Hipnos Bot com uma nota de 1 a 5 estrelas.',

  async executar(sock, jid, msg, text) {
    try {
      // 1) Extrai a nota: tudo depois de "/avaliar"
      const bruto = String(text || '').replace(/^\s*\/\S+\s*/, '').trim()
      const nota = Math.floor(Number(bruto))

      // 2) Valida o formato (número inteiro entre 1 e 5)
      if (!bruto || !Number.isFinite(nota) || nota < 1 || nota > 5 || !/^[1-5]$/.test(bruto)) {
        return await sock.sendMessage(jid, {
          text: '⭐ *Avalie o Hipnos Bot!*\n\nEnvie uma nota de *1 a 5* junto do comando:\n`/avaliar 5`\n\n(Sua opinião ajuda o bot a evoluir. 🌙)'
        }, { quoted: msg })
      }

      // 3) Quem avaliou (resolve LID → número)
      const sender = msg.key?.participant || msg.key?.remoteJid || ''
      const numero = limparNumero(sender)

      // 4) Salva (com barreira anti-duplicata em 2 camadas no módulo)
      let resultado = null
      try {
        resultado = await banco.salvarAvaliacao(numero, nota)
      } catch (err) {
        console.error('[avaliar] falha ao salvar no MongoDB:', err?.message || err)
        return await sock.sendMessage(jid, {
          text: '⛔ A urna de avaliações está indisponível no momento... Tente de novo mais tarde. 🌙'
        }, { quoted: msg })
      }

      // 5a) Já avaliou antes → recusa com carinho (nada é sobrescrito)
      if (resultado && resultado.duplicada) {
        return await sock.sendMessage(jid, {
          text: '💙 *Você já avaliou o bot anteriormente, obrigado pelo carinho!* 💙\n\n(Cada mortal pode votar uma única vez — sua nota já está guardada. 🌙)'
        }, { quoted: msg })
      }

      // 5b) Resultado inválido (não deveria chegar aqui — formato já validado)
      if (!resultado) {
        return await sock.sendMessage(jid, {
          text: '⭐ Envie uma nota de *1 a 5*: `/avaliar 5` 🌙'
        }, { quoted: msg })
      }

      // 5c) 1ª avaliação salva → confirma
      await sock.sendMessage(jid, {
        text: '⭐ *Nota registrada! Obrigado pelo feedback* ⭐\n\nSua avaliação ajuda Hipnos a evoluir. Veja a média com /mediaavaliacoes. 🌙'
      }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando avaliar:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente. 🌙'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
