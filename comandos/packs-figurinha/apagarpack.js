// ============================================================
// 🗑️ APAGARPACK — destrói o pack (dono do pack ou moderação)
// ============================================================
// Uso: /apagarpack <nome do pack>
// O dono apaga o próprio; a moderação apaga qualquer um.
// Sem volta: o documento sai do museu para sempre.
// ============================================================

const prefixoComandos = require('../../prefixo')
const { limparNumero } = require('../../config')
const { resolverNumeroAlvo } = require('../../lid')
const { apagarPack, buscarPackPorNome, ehRevisorJid } = require('../../packs-figurinha')

module.exports = {
  nome: 'apagarpack',
  descricao: 'Apaga um pack de figurinhas (dono ou moderação).',

  async executar(sock, jid, msg, texto) {
    try {
      const nome = prefixoComandos.removerPrefixo(texto).split(' ').slice(1).join(' ').trim()
      if (!nome) {
        return await sock.sendMessage(jid, {
          text: '🗑️ *Apagar pack*\n\nUso: /apagarpack <nome do pack>'
        }, { quoted: msg })
      }

      let participantes = []
      if (String(jid || '').endsWith('@g.us')) {
        try {
          participantes = (await sock.groupMetadata(jid))?.participants || []
        } catch (errMeta) {
          console.error('[apagarpack] ⚠️ sem metadados do grupo:', errMeta?.message || errMeta)
        }
      }
      const remetente = msg.key?.participant || msg.key?.remoteJid || ''
      const { numero } = await resolverNumeroAlvo(participantes, remetente)

      const pack = await buscarPackPorNome(nome)
      if (!pack) {
        return await sock.sendMessage(jid, {
          text: `❌ Não achei nenhum pack chamado "${nome}".`
        }, { quoted: msg })
      }

      const ehRevisor = ehRevisorJid(participantes, remetente)
      if (pack.dono !== limparNumero(numero) && !ehRevisor) {
        return await sock.sendMessage(jid, {
          text: `🛡️ Só o dono do pack "${pack.nome}" (ou a moderação) pode apagá-lo.`
        }, { quoted: msg })
      }

      const resultado = await apagarPack(nome, numero, { forcarAdmin: ehRevisor })
      if (!resultado.ok) {
        return await sock.sendMessage(jid, { text: `❌ ${resultado.motivo}` }, { quoted: msg })
      }

      await sock.sendMessage(jid, {
        text: `🗑️ O pack "${resultado.pack}" foi apagado do museu.`
      }, { quoted: msg })
    } catch (err) {
      console.error('[apagarpack] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '❌ Não consegui apagar agora — tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
