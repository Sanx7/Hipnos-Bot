// ============================================
// 📜 MEUSLEMBRETES — Lista os lembretes pendentes (/meuslembretes)
// ============================================
// Uso: /meuslembretes   (sem argumentos)
//
// Mostra os lembretes AINDA PENDENTES do autor (enviado: false), em ordem
// de disparo, com a data/hora calculada, quanto falta e onde o aviso será
// enviado (neste grupo / em outro grupo / no PV).
//
// Persistência: lembretes.js (collection "lembretes"). Nada de memória
// local — sobrevive a redeploys do Render.
// ============================================

const { listarLembretesPendentes, formatarDataHora, agoraAtual, MAX_ATIVOS } = require('../lembretes')
const { formatarDuracao } = require('../afk')
const { resolverNumeroAlvo } = require('../lid')

module.exports = {
  nome: 'meuslembretes',
  aliases: ['lembretes', 'listalembretes'],
  descricao: 'Lista os lembretes pendentes. Uso: /meuslembretes',

  async executar(sock, jid, msg) {
    try {
      // 👤 Mesmo padrão do /afk, /registrar e /darvip: em grupo o remetente
      // autêntico é msg.key.participant; no privado, o próprio chat.
      let sender = msg.key?.participant || msg.key?.remoteJid || jid

      // 🪪 RESOLUÇÃO LID→NÚMERO REAL (lid.js): os lembretes são gravados pelo
      // NÚMERO real, então listamos pelo número também (o sender pode vir
      // como "@lid" no WhatsApp v7) — mesma abordagem do /registrar.
      if (String(sender).endsWith('@lid')) {
        let participantes = null
        if (jid.endsWith('@g.us')) {
          try {
            participantes = (await sock.groupMetadata(jid)).participants
          } catch (err) {
            console.error('[meuslembretes] sem metadados do grupo p/ resolver @lid:', err?.message || err)
          }
        }
        const resolucao = await resolverNumeroAlvo(participantes, sender)
        if (resolucao.numero && resolucao.via !== null) {
          console.log(`[meuslembretes] 🪪 remetente resolvido de @lid p/ o número real ${resolucao.numero} via ${resolucao.via}`)
          sender = resolucao.numero
        } else {
          console.warn('[meuslembretes] 🪪 @lid do remetente não resolvível — seguindo com o LID cru')
        }
      }

      const numero = String(sender).split('@')[0].split(':')[0].replace(/\D/g, '')
      if (!numero) return

      const pendentes = await listarLembretesPendentes(numero)

      if (!pendentes.length) {
        return await sock.sendMessage(jid, {
          text:
            '📭 *Nenhum lembrete pendente nas areias do sonho...*\n\n' +
            'Agende um com o comando:\n`/lembrete 2h Beber água`\n' +
            '`/lembrete 20:30 Reunião`'
        }, { quoted: msg })
      }

      const agora = agoraAtual()
      const linhas = pendentes.map((doc, i) => {
        const falta = doc.disparar_em - agora
        const origem = !doc.grupo_id
          ? 'no seu PV'
          : (doc.grupo_id === jid ? 'neste grupo' : `no grupo ${doc.grupo_id}`)
        return (
          `*${i + 1}.* 📝 ${doc.texto}\n` +
          `   ⏰ ${formatarDataHora(doc.disparar_em)} _(em ${formatarDuracao(falta)})_ • ${origem}`
        )
      })

      await sock.sendMessage(jid, {
        text:
          `📜 *SEUS LEMBRETES PENDENTES* (${pendentes.length}/${MAX_ATIVOS})\n\n` +
          linhas.join('\n\n') +
          '\n\n💤 Quando a hora chegar, eu te chamo.'
      }, { quoted: msg })
    } catch (err) {
      // 🛡️ Nunca derruba o listener: aviso amigável e fluxo segue
      console.error('[meuslembretes] ⚠️ falha ao listar os lembretes:', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⚠️ *Não consegui consultar seus lembretes agora.*\n\nO banco de dados não respondeu — tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
