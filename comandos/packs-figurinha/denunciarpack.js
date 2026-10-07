// ============================================================
// 🚨 DENUNCIARPACK — registra uma denúncia contra um pack
// ============================================================
// Uso: /denunciarpack <nome> | <motivo>
// Cada pessoa conta UMA vez; com 3 pessoas distintas o pack é
// suspenso sozinho (some do /museu, /abrirpack e /usarpack).
// O dono do pack não pode denunciar o próprio pack.
// ============================================================

const prefixoComandos = require('../../prefixo')
const { resolverNumeroAlvo } = require('../../lid')
const { denunciarPack, LIMITE_DENUNCIAS_SUSPENSAO } = require('../../packs-figurinha')

module.exports = {
  nome: 'denunciarpack',
  descricao: 'Denuncia um pack de figurinhas à moderação.',

  async executar(sock, jid, msg, texto) {
    try {
      const argumentos = prefixoComandos.removerPrefixo(texto).split(' ').slice(1).join(' ').trim()

      let nome = argumentos
      let motivo = ''
      if (argumentos.includes('|')) {
        const partes = argumentos.split('|')
        nome = (partes[0] || '').trim()
        motivo = partes.slice(1).join('|').trim()
      }

      if (!nome) {
        return await sock.sendMessage(jid, {
          text: '🚨 *Denunciar pack*\n\nUso: /denunciarpack <nome> | <motivo>\nEx.: /denunciarpack Memes do limbo | conteúdo ofensivo'
        }, { quoted: msg })
      }

      let participantes = []
      if (String(jid || '').endsWith('@g.us')) {
        try {
          participantes = (await sock.groupMetadata(jid))?.participants || []
        } catch (errMeta) {
          console.error('[denunciarpack] ⚠️ sem metadados do grupo:', errMeta?.message || errMeta)
        }
      }
      const remetente = msg.key?.participant || msg.key?.remoteJid || ''
      const { numero } = await resolverNumeroAlvo(participantes, remetente)

      const resultado = await denunciarPack(nome, numero, motivo)
      if (!resultado.ok) {
        return await sock.sendMessage(jid, { text: `❌ ${resultado.motivo}` }, { quoted: msg })
      }

      if (resultado.suspenso) {
        return await sock.sendMessage(jid, {
          text:
            `⏳ O pack "${resultado.pack}" atingiu ${resultado.denuncias}/${LIMITE_DENUNCIAS_SUSPENSAO} denúncias e foi suspenso para análise.\n` +
            'Ele sumiu do /museu até a moderação decidir (/analisarpack).'
        }, { quoted: msg })
      }

      await sock.sendMessage(jid, {
        text: `🚨 Denúncia registrada contra "${resultado.pack}" (${resultado.denuncias}/${LIMITE_DENUNCIAS_SUSPENSAO}). Obrigado por cuidar do museu. 💤`
      }, { quoted: msg })
    } catch (err) {
      console.error('[denunciarpack] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '❌ Não consegui registrar a denúncia agora — tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
