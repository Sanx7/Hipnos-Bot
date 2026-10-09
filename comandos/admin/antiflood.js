const config = require('../../dados/antiflood-config')
const { autorizado, identificar } = require('../../dados/advertencias-contexto')
const { extrairTextoComando } = require('../../dados/texto-comando')
const prefixos = require('../../prefixo')
module.exports = {
  nome: 'antiflood', aliases: [], descricao: 'Configura a proteção contra excesso de mensagens (ADM ou dono).',
  async executar(sock, jid, msg, text) {
    const responder = text => sock.sendMessage(jid, { text }, { quoted: msg })
    try {
      if (!String(jid).endsWith('@g.us')) return await responder('🌑 O Guardião do Silêncio atua somente em grupos.')
      const sender = msg?.key?.participant || msg?.key?.remoteJid, meta = await sock.groupMetadata(jid)
      if (!await autorizado(meta, sender, true)) return await responder('🔒 Apenas administradores, dono do grupo ou donos do Hipnos podem abrir este pergaminho.')
      const args = String(text ?? extrairTextoComando(msg)).trim().split(/\s+/).slice(1)
      const acao = args[0]?.toLowerCase()
      let mudanca
      if (args.length === 1 && ['on', 'off'].includes(acao)) mudanca = { ativo: acao === 'on' }
      else if (args.length === 3 && acao === 'limite' && args.slice(1).every(a => /^\d+$/.test(a))) mudanca = { limite: Number(args[1]), janela: Number(args[2]) }
      else if (args.length === 2 && acao === 'acao' && ['apagar', 'adv', 'ban'].includes(args[1]?.toLowerCase())) mudanca = { acao: args[1].toLowerCase() }
      else if (!(args.length === 1 && ['status', 'config'].includes(acao))) {
        const p = await prefixos.obterPrefixo()
        return await responder(`📜 Use ${p}antiflood on/off/status/config; ${p}antiflood limite 6 10; ${p}antiflood acao apagar/adv/ban.\nLimite: 3 a 30 mensagens. Janela: 3 a 60 segundos.`)
      }
      if (mudanca) await config.definir(jid, mudanca, (await identificar(meta.participants || [], sender)).numero)
      const c = await config.obter(jid)
      await responder(`🌙 *HIPNOS — GUARDIÃO DO SILÊNCIO*\n\n💤 Antiflood: *${c.ativo ? 'ATIVADO' : 'DESATIVADO'}*.\n📜 Limite: ${c.limite} mensagens em ${c.janela}s.\n⚖️ Ação: ${c.acao}.\n⏳ Cooldown: 30s por participante e grupo.\n🛡️ Hipnos, donos e administradores protegidos.`)
    } catch (e) {
      console.warn('[antiflood] Configuração não concluída:', e.message)
      await responder('🌫️ Não consegui concluir a configuração. Confira os limites (3–30 mensagens em 3–60s), permissões e acesso ao banco; não há confirmação de alteração.').catch(() => {})
    }
  }
}
