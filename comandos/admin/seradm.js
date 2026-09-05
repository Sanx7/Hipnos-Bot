// ============================================
// 👑 SERADM — Promove um mortal a ADMINISTRADOR DO GRUPO (apenas donos)
// ============================================
// Diferente do /promover (que exige ser admin do grupo), este comando é
// RESTRITO AOS DONOS DO BOT:
//   - Sem @menção -> promove o PRÓPRIO autor (o dono que chamou o comando)
//   - Com @menção -> promove a pessoa mencionada
// Usa a função NATIVA do WhatsApp via Baileys (groupParticipantsUpdate
// com 'promote') para elevar o cargo de admin DENTRO DO GRUPO.
//
// IMPORTANTE: o BOT precisa ser admin do grupo para conseguir promover
// outra pessoa. Se não for, respondemos um aviso claro em vez de deixar
// o erro cru do Baileys estourar (e qualquer erro da chamada também é
// convertido nesse aviso, seguindo o modelo do /ban).
//
// Checagem de dono PROOF-LID: dentro de grupos o WhatsApp às vezes entrega
// o remetente como "@lid", e comparar esse JID bruto com OWNER_NUMBERS
// barrava donos de verdade. Por isso buscamos os metadados ANTES da checagem
// e usamos ehDonoDoBot(participantes, sender) — que resolve o participante
// e compara tanto o id (LID) quanto o phoneNumber (número real).
// ============================================

const { acharParticipante, ehDonoDoBot } = require('../../config')

function ehParticipanteAdmin(participante) {
  return Boolean(
    participante &&
      (participante.admin === 'admin' || participante.admin === 'superadmin')
  )
}

module.exports = {
  nome: 'seradm',
  descricao: 'Promove o autor (ou um @mencionado) a administrador do grupo (apenas donos do bot).',

  async executar(sock, jid, msg, text) {
    try {
      // 0) Só funciona em grupos (o cargo de admin de grupo só existe lá)
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, {
          text: '👑 O trono só se concede dentro de um grupo. Use este comando no grupo para Hipnos coroar alguém.'
        }, { quoted: msg })
      }

      const sender = msg.key.participant || msg.key.remoteJid

      // 1) Metadados do grupo (participantes + hierarquia) — buscados ANTES
      //    da checagem de dono, pois é deles que sai a resolução do LID.
      const metadados = await sock.groupMetadata(jid)
      const participantes = metadados.participants || []

      // 2) 🔒 Apenas donos do bot — checagem PROOF-LID via ehDonoDoBot:
      //    se o sender vier como "123456@lid", a comparação bruta com
      //    OWNER_NUMBERS falharia; a função resolve o participante e compara
      //    o id (LID) E o phoneNumber (número real) contra a lista de donos.
      if (!ehDonoDoBot(participantes, sender)) {
        return await sock.sendMessage(jid, {
          text: '🌑 *Hipnos só obedece aos donos do bot.*\n\nA coroação de administradores é privilégio exclusivo dos soberanos.'
        }, { quoted: msg })
      }

      // 3) Alvo: @menção (se houver) OU o próprio autor da mensagem
      const contextInfo = msg.message?.extendedTextMessage?.contextInfo
      const alvoJid = contextInfo?.mentionedJid?.[0] || sender

      // 4) ⚠️ O BOT precisa ser admin do grupo para promover outra pessoa
      const botNoGrupo = acharParticipante(participantes, sock.user?.id)
      if (!ehParticipanteAdmin(botNoGrupo)) {
        return await sock.sendMessage(jid, {
          text: '⚠️ *O bot precisa ser administrador deste grupo* para conseguir promover outra pessoa.\n\n👉 Adicione Hipnos como *admin do grupo* (Configurações do grupo → Administradores) e tente novamente.'
        }, { quoted: msg })
      }

      // 5) O alvo precisa existir no grupo e ainda não ser admin
      const alvoNoGrupo = acharParticipante(participantes, alvoJid)
      if (!alvoNoGrupo) {
        return await sock.sendMessage(jid, {
          text: '❌ A alma a ser coroada não está neste grupo... Marque alguém que esteja presente no recinto.'
        }, { quoted: msg })
      }

      if (ehParticipanteAdmin(alvoNoGrupo)) {
        return await sock.sendMessage(jid, {
          text: '👑 Esta alma *já é administradora* deste grupo. O trono não precisa de nova coroação.'
        }, { quoted: msg })
      }

      // 6) Efetiva a promoção com a função nativa do WhatsApp/Baileys
      await sock.groupParticipantsUpdate(jid, [alvoJid], 'promote')

      // 7) Confirmação
      const numeroExibicao = String(alvoJid).split('@')[0]
      await sock.sendMessage(jid, {
        text: `👑 @${numeroExibicao} *agora é administrador do grupo* 👑\n\n💀 "Use este poder com sabedoria, mortal."`,
        mentions: [alvoJid]
      }, { quoted: msg })

    } catch (err) {
      // Qualquer erro da chamada ao Baileys (especialmente falta de permissão
      // do bot) vira aviso claro — nunca um erro cru quebrando o comando.
      console.error('[seradm] Erro ao promover:', err?.message || err)
      await sock.sendMessage(jid, {
        text: '⚠️ *Não foi possível promover.*\n\nConfira se o *bot é administrador do grupo* (sem isso o WhatsApp recusa a promoção) e tente novamente.'
      }, { quoted: msg })
    }
  }
}