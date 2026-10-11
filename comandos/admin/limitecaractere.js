const config = require('../../dados/limitecaractere-config')
const { autorizado, identificar } = require('../../dados/advertencias-contexto')
const { extrairTextoComando } = require('../../dados/texto-comando')
const prefixos = require('../../prefixo')
module.exports = {
  nome: 'limitecaractere', aliases: ['limitecaracteres', 'antitextao'],
  descricao: 'Configura o limite de texto e legendas por grupo (ADM ou dono).',
  async executar(sock, jid, msg, text) {
    const responder = text => sock.sendMessage(jid, { text }, { quoted: msg })
    try {
      if (!String(jid).endsWith('@g.us')) return await responder('🌑 Os pergaminhos de Hipnos possuem limites somente nos grupos.')
      const sender = msg?.key?.participant || msg?.key?.remoteJid
      const meta = await sock.groupMetadata(jid)
      if (!await autorizado(meta, sender, true)) return await responder('🔒 Apenas administradores, dono do grupo ou donos do Hipnos podem definir este limite.')
      const args = String(text ?? extrairTextoComando(msg)).trim().split(/\s+/).slice(1)
      const operacao = args[0]?.toLowerCase()
      let mudanca
      if (args.length === 1 && ['on', 'off'].includes(operacao)) mudanca = { ativo: operacao === 'on' }
      else if (args.length === 2 && operacao === 'definir' && /^\d+$/.test(args[1])) mudanca = { limite: Number(args[1]) }
      else if (args.length === 2 && operacao === 'acao' && ['apagar', 'adv', 'ban'].includes(args[1]?.toLowerCase())) mudanca = { acao: args[1].toLowerCase() }
      else if (!(args.length === 1 && operacao === 'status')) {
        const p = await prefixos.obterPrefixo()
        return await responder(`📜 Use ${p}limitecaractere on/off/status; ${p}limitecaractere definir 1000; ${p}limitecaractere acao apagar/adv/ban.\nLimite: 100 a 10000 caracteres. Aliases: ${p}limitecaracteres e ${p}antitextao.`)
      }
      if (mudanca) await config.definir(jid, mudanca, (await identificar(meta.participants || [], sender)).numero)
      const c = await config.obter(jid)
      await responder(`🌙 *HIPNOS — O SILÊNCIO DOS DEUSES*\n\n📜 Proteção: *${c.ativo ? 'ATIVADA' : 'DESATIVADA'}*.\n🔱 Limite: ${c.limite} caracteres Unicode.\n⚖️ Ação configurada: ${c.acao}.\n⏳ Cooldown: 30s por participante e grupo.\n🛡️ Hipnos, donos e administradores protegidos.`)
    } catch (_) {
      console.warn('[limitecaractere] Configuração não concluída.')
      await responder('🌫️ Não consegui concluir a configuração. Confira o limite (100–10000), suas permissões e o acesso ao banco; não há confirmação de alteração.').catch(() => {})
    }
  }
}
