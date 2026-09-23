// ============================================
// 📜 /advs — Advertências ativas de um membro (Mongo)
// ============================================
// Aliases: /advertencias e /warns.
//
//    /advs @membro          (ou respondendo a mensagem da pessoa)
//
// Mostra as advertências ATIVAS do alvo NESTE grupo (motivo, quem aplicou e
// quando), da mais recente para a mais antiga. Sem advertências, avisa de
// forma amigável.
//
// Permissão: admin do grupo OU dono do bot (a consulta não é pública —
// o alvo das advertências é assunto de moderação).
// Reusa os helpers de parse do /adv (extrairAlvo/resolverNumeroReal/isAdmin)
// e a camada de dados advertencias.js.

const { ehDonoDoBot, limparNumero } = require('../../config')
const { listarAdvertencias, formatarData, LIMITE_ADVERTENCIAS } = require('../../advertencias')
const { isAdmin, extrairAlvo, resolverNumeroReal } = require('./adv')

const AVISO_SO_GRUPO = 'Este comando só serve para grupos, gênio. 🥱'

const AVISO_SEM_ALVO =
  '⚠️ Marque alguém com @ ou responda a mensagem da pessoa.\n' +
  'Ex: `/advs @usuario`'

const AVISO_SEM_PERMISSAO =
  '❌ Apenas administradores podem usar este comando.'

const AVISO_LID =
  '🔍 Não consegui identificar o número real dessa pessoa (o WhatsApp a entrega como @lid).\n' +
  'Peca para ela mandar uma mensagem no grupo e tente de novo.'

const AVISO_ERRO_BANCO =
  '🌫️ As sombras não responderam: não consegui consultar as advertências agora.\n' +
  'Tente novamente em instantes.'

// 🧾 Ficha com todas as advertências ativas
function montarLista ({ alvoNumero, advertencias }) {
  const linhas = advertencias
    .map((a, i) => `${i + 1}. 📝 ${a.motivo}\n   ↳ por @${a.aplicado_por} em ${formatarData(a.data)}`)
    .join('\n')

  const restantes = Math.max(0, LIMITE_ADVERTENCIAS - advertencias.length)
  const aviso = restantes > 0
    ? `⚠️ Faltam *${restantes}* advertência${restantes === 1 ? '' : 's'} para o ban automático.`
    : '☠️ Limite atingido!'

  return '📜 *ADVERTÊNCIAS ATIVAS* 📜\n\n' +
    `👤 Alvo: @${alvoNumero}\n` +
    `📊 Total: *${advertencias.length}/${LIMITE_ADVERTENCIAS}*\n\n` +
    linhas + '\n\n' +
    aviso
}

module.exports = {
  nome: 'advs',
  // ♻️ Aliases no padrão do projeto
  aliases: ['advertencias', 'warns'],
  async executar (sock, jid, msg, text) {
    try {
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, { text: AVISO_SO_GRUPO }, { quoted: msg })
      }

      const sender = msg?.key?.participant || msg?.key?.remoteJid

      let metadados = null
      try {
        metadados = await sock.groupMetadata(jid)
      } catch (erroMeta) {
        console.error('[advs] ⚠️ sem metadados do grupo:', erroMeta?.message || erroMeta)
        return await sock.sendMessage(jid, { text: AVISO_ERRO_BANCO }, { quoted: msg })
      }
      const participantes = metadados?.participants || []

      // 🔒 Admin do grupo OU dono do bot (mesmo critério de moderação)
      const dadosSender = participantes.find((p) => p.id === sender)
      const autorizado =
        isAdmin(dadosSender) ||
        metadados?.owner === sender ||
        ehDonoDoBot(participantes, sender)

      if (!autorizado) {
        return await sock.sendMessage(jid, { text: AVISO_SEM_PERMISSAO }, { quoted: msg })
      }

      const alvoBruto = extrairAlvo(msg)
      if (!alvoBruto) {
        return await sock.sendMessage(jid, { text: AVISO_SEM_ALVO }, { quoted: msg })
      }

      // 🪪 Número real (nunca consultar pelo LID cru)
      const alvoReal = await resolverNumeroReal(participantes, alvoBruto)
      if (!alvoReal) {
        return await sock.sendMessage(jid, { text: AVISO_LID }, { quoted: msg })
      }

      let advertencias = []
      try {
        advertencias = await listarAdvertencias(alvoReal, jid)
      } catch (erro) {
        console.error('[advs] 💥 erro ao consultar o Mongo:', erro?.stack || erro)
        return await sock.sendMessage(jid, { text: AVISO_ERRO_BANCO }, { quoted: msg })
      }

      if (!advertencias.length) {
        return await sock.sendMessage(jid, {
          text: `✨ @${alvoReal} está com a ficha limpa neste grupo — nenhuma advertência ativa.`,
          mentions: [alvoBruto]
        }, { quoted: msg })
      }

      return await sock.sendMessage(jid, {
        text: montarLista({ alvoNumero: alvoReal, advertencias }),
        mentions: [alvoBruto]
      }, { quoted: msg })

    } catch (err) {
      console.error('Erro no comando advs:', err)
    }
  }
}
