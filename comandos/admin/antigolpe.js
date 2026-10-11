const config = require('../../dados/antigolpe-config')
const { autorizado, identificar } = require('../../dados/advertencias-contexto')
const { extrairTextoComando } = require('../../dados/texto-comando')
const { obterPrefixo } = require('../../prefixo')
module.exports = {
  nome: 'antigolpe', aliases: ['antiscam', 'antifraude'], descricao: 'Configura a detecção de mensagens suspeitas por grupo.',
  async executar(sock, jid, msg, text) {
    // Não citar comandos: podem conter uma tentativa de cadastrar dado sensível.
    const responder = text => sock.sendMessage(jid, { text })
    try {
      if (!String(jid).endsWith('@g.us')) return await responder('🌑 A Vigilância do Olimpo atua somente em grupos.')
      const meta = await sock.groupMetadata(jid), sender = msg?.key?.participant || msg?.key?.remoteJid
      if (!await autorizado(meta, sender, true)) return await responder('🔒 Apenas administradores, dono do grupo ou donos do Hipnos podem configurar esta proteção.')
      const args = String(text ?? extrairTextoComando(msg)).trim().split(/\s+/).slice(1), operacao = args[0]?.toLowerCase()
      const autor = (await identificar(meta.participants || [], sender)).numero
      if (args.length === 1 && ['on', 'off'].includes(operacao)) await config.definir(jid, { ativo: operacao === 'on' }, autor)
      else if (args.length === 2 && operacao === 'modo' && ['alerta', 'apagar', 'adv'].includes(args[1]?.toLowerCase())) await config.definir(jid, { modo: args[1].toLowerCase() }, autor)
      else if (args.length === 2 && operacao === 'sensibilidade' && ['baixa', 'media', 'alta'].includes(args[1]?.toLowerCase())) await config.definir(jid, { sensibilidade: args[1].toLowerCase() }, autor)
      else if (args.length >= 2 && ['permitir', 'remover'].includes(operacao)) await config[operacao](jid, args.slice(1).join(' '), autor)
      else if (!(args.length === 1 && ['status', 'excecoes'].includes(operacao))) {
        const p = await obterPrefixo()
        return await responder(`📜 ${p}antigolpe on/off/status\n${p}antigolpe modo alerta/apagar/adv\n${p}antigolpe sensibilidade baixa/media/alta\n${p}antigolpe permitir sorteio oficial\n${p}antigolpe remover sorteio oficial\n${p}antigolpe excecoes\n\nExceções: até 20 expressões de 8–80 caracteres, com ao menos duas palavras. Reduzem somente premiação sem pedidos de credenciais, dados, pagamento ou promessa financeira.`)
      }
      const c = await config.obter(jid)
      if (operacao === 'excecoes') return await responder(`📜 Exceções (${c.excecoes.length}/20):\n${c.excecoes.map(t => `• ${t}`).join('\n') || 'Nenhuma.'}`)
      await responder(`🌙 *HIPNOS — VIGILÂNCIA DO OLIMPO*\n\n🛡️ Proteção: ${c.ativo ? 'ATIVADA' : 'DESATIVADA'}.\n⚖️ Modo: ${c.modo}.\n📜 Sensibilidade: ${c.sensibilidade}.\n🔱 Exceções: ${c.excecoes.length}/20.\n⏳ Cooldown: 60s por participante e grupo.\n\nDetecção por padrões; mensagens suspeitas exigem revisão humana.`)
    } catch (_) {
      console.warn('[antigolpe] Configuração não concluída.')
      await responder('🌫️ Não consegui concluir a configuração. Confira as opções, permissões e o banco. Exceções precisam ser específicas, sem números, dados sensíveis ou regex; limite de 20 expressões de 8–80 caracteres.').catch(() => {})
    }
  }
}
