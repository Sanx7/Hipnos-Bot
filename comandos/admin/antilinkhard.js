const config = require('../../dados/antilinkhard-config')
const { autorizado, identificar } = require('../../dados/advertencias-contexto')
const { extrairTextoComando } = require('../../dados/texto-comando')
const prefixos = require('../../prefixo')

module.exports = {
  nome: 'antilinkhard', aliases: ['antilink-hard', 'antilinkban'],
  descricao: 'Configura exclusão de links e expulsão direta neste grupo (ADM ou dono).',
  async executar(sock, jid, msg, text) {
    const responder = texto => sock.sendMessage(jid, { text: texto }, { quoted: msg })
    try {
      if (!String(jid).endsWith('@g.us')) return await responder('🌑 O Julgamento das Sombras só pode ser invocado em grupos.')
      const sender = msg?.key?.participant || msg?.key?.remoteJid
      const meta = await sock.groupMetadata(jid)
      if (!await autorizado(meta, sender, true)) return await responder('🔒 Apenas administradores, dono do grupo ou donos do Hipnos podem abrir este pergaminho.')
      const partes = String(text ?? extrairTextoComando(msg)).trim().split(/\s+/).slice(1)
      const acao = partes[0]?.toLowerCase()
      if (partes.length !== 1 || !['on', 'off', 'status'].includes(acao)) {
        const prefixo = await prefixos.obterPrefixo()
        return await responder(`📜 Use ${prefixo}antilinkhard on, ${prefixo}antilinkhard off ou ${prefixo}antilinkhard status.`)
      }
      const autor = await identificar(meta.participants || [], sender)
      if (acao !== 'status') await config.definir(jid, acao === 'on', autor.numero)
      const ativo = await config.obter(jid, true)
      return await responder(`🌙 *HIPNOS — JULGAMENTO DAS SOMBRAS*\n\n🔗 Antilink hard: *${ativo ? 'ATIVADO' : 'DESATIVADO'}*.\n${ativo ? '⚖️ Links de membros comuns serão apagados; expulsão direta após confirmação.' : '🌑 O julgamento rigoroso está em repouso.'}\n🛡️ Hipnos, donos e administradores estão protegidos.\n📜 A configuração do /antilink permanece independente.`)
    } catch (erro) {
      console.warn('[antilinkhard] Não foi possível consultar/alterar a regra:', erro.message)
      await responder('🌫️ Não consegui concluir a consulta ou alteração agora. Verifique o grupo e o acesso ao banco; não há confirmação de mudança.').catch(() => {})
    }
  }
}
