const { remetenteEhDono } = require('../../estado-bot')
const { ehAdminDoGrupo, limparNumero } = require('../../config')
const { ehLid, resolverNumeroAlvo } = require('../../lid')
const { extrairTextoComando } = require('../../dados/texto-comando')
const historico = require('../../dados/mensagens-enviadas')
const emAndamento = new Set()
const LIMITE = 20

async function permitido(sock, jid, sender) {
  if (await remetenteEhDono(sock, jid, sender)) return true
  try {
    const participantes = (await sock.groupMetadata(jid))?.participants || []
    const correspondentes = ehLid(sender)
      ? participantes.filter(p => ehLid(p?.id) && limparNumero(p.id) === limparNumero(sender))
      : participantes
    if (ehAdminDoGrupo(correspondentes, sender)) return true
    const resolucao = await resolverNumeroAlvo(correspondentes, sender)
    return Boolean(resolucao.via && resolucao.numero && ehAdminDoGrupo(participantes, `${resolucao.numero}@s.whatsapp.net`))
  } catch (_) {
    return false
  }
}

module.exports = {
  nome: 'limpar-chat',
  categoria: 'admin',
  descricao: 'Apaga até 20 mensagens recentes enviadas pelo bot neste grupo (ADM ou dono).',
  async executar(sock, jid, msg, text) {
    const responder = texto => sock.sendMessage(jid, { text: texto }, { quoted: msg })
    if (!String(jid || '').endsWith('@g.us')) return responder('🌑 Use /limpar-chat em um grupo.')
    const sender = msg?.key?.participant || msg?.key?.remoteJid
    if (!(await permitido(sock, jid, sender))) return responder('🔒 Só administradores do grupo ou donos do bot podem usar /limpar-chat.')
    const argumento = String(text ?? extrairTextoComando(msg)).trim().split(/\s+/).slice(1).join(' ')
    const quantidade = Number(argumento)
    if (!/^\d+$/.test(argumento) || !Number.isSafeInteger(quantidade) || quantidade < 1 || quantidade > LIMITE) {
      return responder('📩 Use /limpar-chat <1-20>: entre 1 e 20 mensagens.')
    }
    if (emAndamento.has(jid)) return responder('⏳ Já há uma limpeza em andamento neste grupo.')
    // Snapshot anterior ao aviso final: nunca inclui as próprias revogações.
    const alvos = historico.recentes(jid, quantidade)
    if (!alvos.length) return responder('📭 Não há mensagens do bot registradas para apagar neste grupo. O histórico começa quando o bot é iniciado.')
    emAndamento.add(jid)
    let apagadas = 0
    let falhas = 0
    try {
      for (const key of alvos) {
        try {
          await sock.sendMessage(jid, { delete: key })
          historico.remover(key)
          apagadas++
        } catch (_) {
          // Mantém a chave para nova tentativa, sem impedir os outros envios.
          falhas++
        }
      }
      return await responder(`🧹 Solicitei a exclusão de ${apagadas} mensagem(ns) do bot.${falhas ? ` ${falhas} tentativa(s) falharam.` : ''}${alvos.length < quantidade ? ` Havia apenas ${alvos.length} mensagem(ns) no histórico.` : ''}`)
    } finally {
      emAndamento.delete(jid)
    }
  }
}
