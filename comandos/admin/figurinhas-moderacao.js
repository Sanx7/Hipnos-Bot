const { normalizeMessageContent } = require('@whiskeysockets/baileys')
const regras = require('../../dados/figurinhas-regras')
const { calcularHash, identificar } = require('../../dados/moderacao-figurinhas')
const { remetenteEhDono } = require('../../estado-bot')
const { extrairTextoComando } = require('../../dados/texto-comando')
const ACOES = { ban: 'banimento', adv: 'advertência', del: 'exclusão' }

function comando(nome, acao, remover = false) {
  return {
    nome, categoria: 'admin',
    descricao: nome === 'figlistanegra' ? 'Lista as regras de figurinhas deste grupo (ADM ou dono).' : `${remover ? 'Remove' : 'Cadastra'} regra de ${ACOES[acao]} respondendo à figurinha (ADM ou dono).`,
    async executar(sock, jid, msg, text) {
      const responder = texto => sock.sendMessage(jid, { text: texto }, { quoted: msg })
      try {
        if (!String(jid).endsWith('@g.us')) return await responder('🌑 Este pergaminho só pode ser aberto em grupos.')
        const sender = msg?.key?.participant || msg?.key?.remoteJid
        const participantes = (await sock.groupMetadata(jid))?.participants || []
        const autor = await identificar(participantes, sender)
        if (!autor.admin && !autor.dono && !await remetenteEhDono(sock, jid, sender)) {
          return await responder('🔒 Só administradores ou donos do bot podem governar as figurinhas do limbo.')
        }
        if (nome === 'figlistanegra') {
          const arg = String(text ?? extrairTextoComando(msg)).trim().split(/\s+/).slice(1).join(' ')
          const pagina = arg ? Number(arg) : 1
          if (arg && !/^\d+$/.test(arg) || !Number.isSafeInteger(pagina) || pagina < 1 || pagina > 100000) return await responder('📜 Use /figlistanegra [página].')
          const lista = await regras.listar(jid, pagina)
          if (!lista.length) return await responder('🌑 Nenhuma regra de figurinha nesta página do pergaminho.')
          const linhas = lista.slice(0, 20).map((r, i) => `${(pagina - 1) * 20 + i + 1}. ${ACOES[r.acao]} · SHA-256: ${r.hash}`)
          return await responder(`🌑 *FIGURINHAS DO LIMBO*\n\n${linhas.join('\n')}\n\n📜 Página ${pagina}${lista.length > 20 ? ` · Próxima: /figlistanegra ${pagina + 1}` : ''}`)
        }
        const conteudo = normalizeMessageContent(msg?.message)
        const contexto = conteudo?.extendedTextMessage?.contextInfo
        const quoted = contexto?.quotedMessage
        if (!normalizeMessageContent(quoted)?.stickerMessage || !contexto.stanzaId) {
          return await responder(`📩 Responda diretamente à figurinha com /${nome}.`)
        }
        const alvo = { key: {
          remoteJid: contexto.remoteJid || jid, id: contexto.stanzaId,
          participant: contexto.participant, fromMe: false
        }, message: quoted }
        const hash = await calcularHash(alvo)
        if (remover) {
          const apagada = await regras.remover(jid, hash, acao)
          return await responder(apagada ? `🕊️ Regra de ${ACOES[acao]} removida do pergaminho deste grupo.` : `🌑 Esta figurinha não tem regra de ${ACOES[acao]} neste grupo.`)
        }
        const anterior = await regras.cadastrar(jid, hash, acao, autor.numero || sender)
        const substituida = anterior && anterior.acao !== acao ? `\nA regra anterior de ${ACOES[anterior.acao]} foi substituída.` : ''
        return await responder(`🌑 Figurinha registrada para ${ACOES[acao]} neste grupo.${substituida}`)
      } catch (_) {
        console.warn('[figurinhas] Falha ao gerenciar a regra; sem confirmação de alteração.')
        await responder('⚠️ Não consegui concluir. Verifique o acesso ao grupo e ao banco; a figurinha pode estar indisponível ou exceder 2 MB.').catch(() => {})
      }
    }
  }
}
module.exports = [
  comando('figban', 'ban'), comando('figadv', 'adv'), comando('figdel', 'del'),
  comando('delfigban', 'ban', true), comando('delfigadv', 'adv', true), comando('delfigdel', 'del', true),
  comando('figlistanegra')
]
