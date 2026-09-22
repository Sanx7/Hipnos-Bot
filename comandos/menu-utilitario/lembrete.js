// ============================================================
// ⏰ LEMBRETE — Agenda um aviso futuro (/lembrete)
// ============================================================
// Uso:
//   /lembrete 10m Beber água     -> daqui a 10 minutos
//   /lembrete 2h Ligar p/ a mãe  -> daqui a 2 horas
//   /lembrete 1d Revisar texto   -> daqui a 1 dia
//   /lembrete 20:30 Reunião      -> hoje às 20:30 (ou amanhã, se já passou)
//
// Regras:
//   - Confirmação IMEDIATA com a data/hora calculada;
//   - Persiste no MongoDB (lembretes.js) — sobrevive a redeploys do
//     Render (nada em memória);
//   - Disparo pelo agendador (bot.js): no grupo de origem ou no PV,
//     marcando o usuário;
//   - Máximo de 10 lembretes ATIVOS por usuário (anti-spam);
//   - Número gravado é o REAL (resolução LID→número, padrão /darvip).
// ============================================================

const { resolverNumeroAlvo } = require('../../lid')
const {
  interpretarTempo,
  formatarDataHora,
  formatarDuracaoCurta,
  agendarLembrete,
  obterNumeroRemetente,
  MAX_LEMBRETES_ATIVOS,
  MAX_TEXTO
} = require('../../lembretes')

// 📖 Ajuda de uso (texto vazio, tempo ausente ou formato inválido)
function textoDeUso(motivo) {
  const cabeco = motivo
    ? `⏰ *${motivo}*\n\n`
    : '⏰ *Como agendar um lembrete:*\n\n'
  return (
    cabeco +
    '`/lembrete <quando> <o quê>`\n\n' +
    '🕐 Quando (tempo relativo ou horário):\n' +
    '• `10m` — daqui a 10 minutos\n' +
    '• `2h` — daqui a 2 horas\n' +
    '• `1d` — daqui a 1 dia\n' +
    '• `20:30` — hoje às 20:30 (ou amanhã, se já passou)\n\n' +
    '🗝️ Exemplos:\n' +
    '• `/lembrete 2h Beber água`\n' +
    '• `/lembrete 20:30 Reunião`'
  )
}

module.exports = {
  nome: 'lembrete',
  aliases: ['lembrar', 'remindme'],
  descricao: 'Agenda um aviso futuro. Uso: /lembrete <10m|2h|1d|20:30> <texto>',

  async executar(sock, jid, msg, text) {
    try {
      // 1) Parse: "/lembrete <tempo> <texto...>"
      const partes = String(text || '').trim().split(/\s+/)
      const expressao = partes[1] || ''
      const textoLembrete = partes.slice(2).join(' ').trim()

      if (!expressao || !textoLembrete) {
        return await sock.sendMessage(jid, {
          text: textoDeUso(
            !expressao && !textoLembrete
              ? null
              : 'faltou alguma parte — me diga QUANDO e O QUÊ lembrar.'
          )
        }, { quoted: msg })
      }

      if (textoLembrete.length > MAX_TEXTO) {
        return await sock.sendMessage(jid, {
          text:
            `📏 *Texto longo demais para um lembrete...*\n\n` +
            `Resuma em até *${MAX_TEXTO} caracteres* (o seu tem ${textoLembrete.length}).`
        }, { quoted: msg })
      }

      // 2) Interpreta o tempo (validação pura — sem banco ainda)
      const interp = interpretarTempo(expressao)
      // interpretarQuando devolve { erro } (mensagem de uso JÁ formatada
      // em pt-BR) ou { timestamp, tipo, duracaoMs } em caso de sucesso.
      if (interp.erro) {
        return await sock.sendMessage(jid, { text: interp.erro }, { quoted: msg })
      }

      // 3) 🪪 Número REAL do remetente (PROOF-LID, padrão /darvip):
      // sem número resolvível o disparo quebraria — recusa com retry.
      const { numero } = await obterNumeroRemetente(sock, jid, msg)
      if (!numero) {
        console.warn('[lembrete] 🪪 remetente @lid não resolvível — pedindo retry (sem gravar LID)')
        return await sock.sendMessage(jid, {
          text:
            '🪪 *Não consegui identificar seu número agora* (o WhatsApp entregou só o LID).\n\n' +
            'Tente o comando de novo em instantes que eu agendo seu lembrete. 🌙'
        }, { quoted: msg })
      }

      // 4) Persiste (o limite de ativos é checado lá dentro)
      const ehGrupo = String(jid).endsWith('@g.us')
      let doc
      try {
        doc = await agendarLembrete({
          numero,
          grupoId: ehGrupo ? jid : null,
          texto: textoLembrete,
          dispararEm: interp.timestamp
        })
      } catch (errBanco) {
        if (errBanco?.code === 'LIMITE_ATINGIDO') {
          return await sock.sendMessage(jid, {
            text:
              `📋 *Você já tem ${MAX_LEMBRETES_ATIVOS} lembretes ativos...*\n\n` +
              'Apague/conclua algum antes de agendar outro — ' +
              'veja a lista com */meuslembretes*. 🌙'
          }, { quoted: msg })
        }
        throw errBanco
      }

      // 5) ✅ Confirmação imediata com a data/hora calculada
      const onde = ehGrupo ? 'aqui neste grupo' : 'aqui no seu PV'
      await sock.sendMessage(jid, {
        text:
          '⏰ *Lembrete agendado!*\n\n' +
          `📝 ${doc.texto}\n` +
          `📅 Vai tocar em *${formatarDataHora(doc.disparar_em)}* (daqui a ${formatarDuracaoCurta(interp.duracaoMs)})\n` +
          `📍 ${onde}, te marcando.\n\n` +
          'Ver seus pendentes: */meuslembretes*'
      }, { quoted: msg })
    } catch (erro) {
      console.error('⚠️ [lembrete] falha ao agendar:', erro?.message || erro)
      await sock.sendMessage(jid, {
        text: '❌ Não consegui agendar seu lembrete agora (falha no banco de dados). Tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
