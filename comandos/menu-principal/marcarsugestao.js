// ============================================
// ✅❌ MARCARSUGESTAO — Resolve uma sugestão pendente (só DONOS)
// ============================================
// Uso:
//   /marcarsugestao <número> <atendida|recusada>
//
//   O <número> é a posição da lista do /versugestoes (1 = mais antiga).
//   Ex.: /marcarsugestao 2 atendida
//
// Regras:
//   - SOMENTE donos do bot (mesmo gate PROOF-LID do /versugestoes).
//   - Status aceitos: atendida | recusada (variações: atender, aceitar,
//     aprovar, ok, negar, rejeitar, nao, não).
//   - Grava quem resolveu (resolvido_por) e quando (resolvido_em).
// ============================================

const { limparNumero, ehDonoDoBot } = require('../../config')
const banco = require('../../sugestoes')

// Normaliza as variações de status para "atendida" | "recusada" | null
function normalizarStatus(bruto) {
  const s = String(bruto || '').trim().toLowerCase()
  if (['atendida', 'atendido', 'atender', 'aceita', 'aceito', 'aceitar', 'aprovar', 'aprovada', 'aprovado', 'ok', 'feita', 'feito', 'concluida', 'concluída', 'resolvida', 'resolvido'].includes(s)) {
    return 'atendida'
  }
  if (['recusada', 'recusado', 'recusar', 'rejeitada', 'rejeitado', 'rejeitar', 'negar', 'negada', 'negado', 'nao', 'não', 'descartar', 'descartada'].includes(s)) {
    return 'recusada'
  }
  return null
}

module.exports = {
  nome: 'marcarsugestao',
  aliases: ['resolversugestao', 'marcarsugestoes'],
  descricao: 'Marca uma sugestão pendente como atendida ou recusada (apenas donos).',

  async executar(sock, jid, msg, text) {
    try {
      const sender = msg.key?.participant || msg.key?.remoteJid || ''

      // 1) Gate de dono (PROOF-LID)
      let participantes = null
      if (jid.endsWith('@g.us')) {
        try {
          const metadados = await sock.groupMetadata(jid)
          participantes = metadados?.participants || null
        } catch (err) {
          console.error('[marcarsugestao] sem metadados do grupo:', err?.message || err)
        }
      }
      if (!ehDonoDoBot(participantes, sender)) {
        return await sock.sendMessage(jid, {
          text: '🌑 *Hipnos só obedece aos donos do bot.*\n\nA caixa de sugestões permanece selada aos olhos dos mortais.'
        }, { quoted: msg })
      }

      // 2) Argumentos: número + status
      const args = String(text || '').split(' ').slice(1).filter(Boolean)
      const indice = Math.floor(Number(args[0]))
      const status = normalizarStatus(args[1])

      if (!Number.isFinite(indice) || indice < 1 || !status) {
        return await sock.sendMessage(jid, {
          text: '📋 *Como resolver uma sugestão:*\n\n`/marcarsugestao <número> atendida`\n`/marcarsugestao <número> recusada`\n\n(O número é a posição da lista do /versugestoes — 1 = mais antiga.)'
        }, { quoted: msg })
      }

      // 3) Marca no MongoDB
      let documento = null
      try {
        documento = await banco.marcarSugestaoPorIndice(indice, status, sender)
      } catch (err) {
        console.error('[marcarsugestao] falha ao marcar no MongoDB:', err?.message || err)
        return await sock.sendMessage(jid, {
          text: '⛔ A caixa de sugestões está indisponível no momento... Tente de novo mais tarde. 🌙'
        }, { quoted: msg })
      }

      if (!documento) {
        const total = await banco.contarPendentes().catch(() => null)
        const dica = total
          ? `Há *${total}* pendente(s) — confira o número com /versugestoes.`
          : 'Não há pendentes no momento.'
        return await sock.sendMessage(jid, {
          text: `📭 Não encontrei a sugestão nº *${indice}* entre as pendentes. ${dica}`
        }, { quoted: msg })
      }

      // 4) Confirmação + aviso ao autor original (melhor esforço)
      const selo = status === 'atendida' ? '✅' : '❌'
      const acao = status === 'atendida' ? 'atendida' : 'recusada'
      await sock.sendMessage(jid, {
        text: `${selo} Sugestão nº *${indice}* marcada como *${acao}*.\n\n📝 "${String(documento.texto).slice(0, 200)}"`
      }, { quoted: msg })

      // Tenta avisar quem sugeriu por DM (se não for o próprio dono)
      const numeroAutor = limparNumero(documento.numero)
      const numeroDono = limparNumero(sender)
      if (numeroAutor && numeroAutor !== numeroDono) {
        const textoAutor = status === 'atendida'
          ? `✅ *Boa notícia do reino dos sonhos!* 🙏\n\nSua sugestão foi *atendida* pelos donos do bot:\n📝 "${String(documento.texto).slice(0, 200)}"\n\nObrigado por ajudar a melhorar o Hipnos! 🌙`
          : `📭 *Notícia da caixa de sugestões...*\n\nSua sugestão foi analisada, mas desta vez não será adotada:\n📝 "${String(documento.texto).slice(0, 200)}"\n\nMesmo assim, obrigado por contribuir! Mande mais ideias com /sugestao. 🌙`
        try {
          await sock.sendMessage(`${numeroAutor}@s.whatsapp.net`, { text: textoAutor })
        } catch (err) {
          console.error('[marcarsugestao] DM ao autor falhou:', err?.message || err)
        }
      }
    } catch (err) {
      console.error('Erro no comando marcarsugestao:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente. 🌙'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
