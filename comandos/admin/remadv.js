// ============================================
// 🕊️ /remadv — Perdoa a advertência mais recente (Mongo)
// ============================================
// Aliases: /removeradv e /perdoaradv.
//
//    /remadv @membro       (ou respondendo a mensagem da pessoa)
//
// Remove a advertência ATIVA mais recente do alvo NESTE grupo — a mais
// simples e previsível das opções (sem escolher índice, sem apagar tudo).
// Depois do perdão, mostra quantas ainda restam até o ban automático.
//
// Permissão: SOMENTE admin do grupo (mesmo critério do /adv e /ban).
// Alvo dono do bot NÃO é bloqueado aqui de propósito: perdoar é uma ação
// BENÉFICA (não muda nada no grupo) e o dono pode ter sido advertido por
// engano — bloquear só criaria um beco sem saída, já que o /adv nunca
// deveria tê-lo advertido.
//
// Reusa os helpers de parse do /adv (isAdmin/extrairAlvo/resolverNumeroReal)
// e a camada de dados advertencias.js.

const { limparNumero } = require('../../config')
const {
  listarAdvertencias,
  removerUltimaAdvertencia,
  formatarData,
  LIMITE_ADVERTENCIAS
} = require('../../advertencias')
const { isAdmin, extrairAlvo, resolverNumeroReal } = require('./adv')

const AVISO_SO_GRUPO = 'Este comando só serve para grupos, gênio. 🥱'

const AVISO_SEM_ALVO =
  '⚠️ Marque alguém com @ ou responda a mensagem da pessoa.\n' +
  'Ex: `/remadv @usuario`'

const AVISO_SEM_PERMISSAO =
  '❌ Apenas administradores podem usar este comando.'

const AVISO_LID =
  '🔍 Não consegui identificar o número real dessa pessoa (o WhatsApp a entrega como @lid).\n' +
  'Peca para ela mandar uma mensagem no grupo e tente de novo.'

const AVISO_ERRO_BANCO =
  '🌫️ As sombras não responderam: não consegui consultar as advertências agora.\n' +
  'Tente novamente em instantes.'

// ✍️ Confirmação do perdão (mostra o que foi removido e o saldo restante)
function montarPerdao ({ alvoNumero, removida, total }) {
  const restantes = Math.max(0, LIMITE_ADVERTENCIAS - total)
  const aviso = restantes > 0
    ? `⚠️ Faltam *${restantes}* advertência${restantes === 1 ? '' : 's'} para o ban automático.`
    : '☠️ Limite atingido!'

  return '🕊️ *ADVERTÊNCIA PERDOADA* 🕊️\n\n' +
    `👤 Alvo: @${alvoNumero}\n` +
    `📝 Motivo perdoado: ${removida.motivo}\n` +
    `🛡️ Aplicada por: @${removida.aplicado_por}\n` +
    `🗓️ Data: ${formatarData(removida.data)}\n` +
    `📊 Advertências ativas: *${total}/${LIMITE_ADVERTENCIAS}*\n\n` +
    aviso
}

module.exports = {
  nome: 'remadv',
  // ♻️ Aliases no padrão do projeto (o loader registra todos)
  aliases: ['removeradv', 'perdoaradv'],
  async executar (sock, jid, msg) {
    try {
      // 1️⃣ Só em grupo
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, { text: AVISO_SO_GRUPO }, { quoted: msg })
      }

      const sender = msg?.key?.participant || msg?.key?.remoteJid

      // 2️⃣ Metadados (permissão + resolução LID)
      let metadados = null
      try {
        metadados = await sock.groupMetadata(jid)
      } catch (erroMeta) {
        console.error('[remadv] ⚠️ sem metadados do grupo:', erroMeta?.message || erroMeta)
        return await sock.sendMessage(jid, { text: AVISO_ERRO_BANCO }, { quoted: msg })
      }
      const participantes = metadados?.participants || []

      // 3️⃣ Permissão: SOMENTE admin (mesmo critério do /adv e /ban)
      const dadosSender = participantes.find((p) => p.id === sender)
      if (!(isAdmin(dadosSender) || metadados?.owner === sender)) {
        return await sock.sendMessage(jid, { text: AVISO_SEM_PERMISSAO }, { quoted: msg })
      }

      // 4️⃣ Alvo: menção (@) ou mensagem respondida
      const alvoBruto = extrairAlvo(msg)
      if (!alvoBruto) {
        return await sock.sendMessage(jid, { text: AVISO_SEM_ALVO }, { quoted: msg })
      }

      // 5️⃣ 🪪 Número REAL do alvo (nunca consultar pelo LID cru)
      const alvoReal = await resolverNumeroReal(participantes, alvoBruto)
      if (!alvoReal) {
        return await sock.sendMessage(jid, { text: AVISO_LID }, { quoted: msg })
      }

      // 6️⃣ Remove a ativa mais recente
      let removida = null
      try {
        removida = await removerUltimaAdvertencia(alvoReal, jid)
      } catch (erro) {
        console.error('[remadv] 💥 erro ao remover no Mongo:', erro?.stack || erro)
        return await sock.sendMessage(jid, { text: AVISO_ERRO_BANCO }, { quoted: msg })
      }

      if (!removida) {
        return await sock.sendMessage(jid, {
          text: `✨ @${alvoReal} está com a ficha limpa — nenhuma advertência ativa neste grupo para perdoar.`,
          mentions: [alvoBruto]
        }, { quoted: msg })
      }

      // 7️⃣ Saldo restante (relê do Mongo logo após o delete)
      let total = 0
      try {
        total = (await listarAdvertencias(alvoReal, jid)).length
      } catch (erro) {
        console.error('[remadv] ⚠️ não consegui recarregar o total:', erro?.message || erro)
      }

      console.log(`[remadv] 🕊️ advertência de ${alvoReal} perdoada em ${jid} (restam ${total})`)
      void limparNumero

      return await sock.sendMessage(jid, {
        text: montarPerdao({ alvoNumero: alvoReal, removida, total }),
        mentions: [alvoBruto, sender]
      }, { quoted: msg })

    } catch (err) {
      console.error('Erro no comando remadv:', err)
    }
  }
}
