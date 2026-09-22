// ============================================================
// ❌ CANCELARLEMBRETE — Cancela um lembrete pelo índice da listagem
// ============================================================
// Uso: /cancelarlembrete <número>
//   - O NÚMERO é o do item exibido pelo /meuslembretes (1 = o que vai
//     tocar primeiro; a listagem ordena por disparo mais próximo);
//   - Cancela SOMENTE lembretes PENDENTES do PRÓPRIO autor — mesma
//     resolução de número PROOF-LID do /lembrete e do /meuslembretes,
//     então o índice que o usuário vê é o mesmo que ele cancela;
//   - Confirmação com o texto e o horário do que foi cancelado;
//   - Número fora da lista, sem argumento ou lembretes esgotados →
//     aviso amigável, NADA é apagado;
//   - Falha de banco → aviso amigável (o executor NUNCA lança).
// ============================================================

const {
  cancelarLembrete,
  obterNumeroRemetente,
  formatarDataHora
} = require('../../lembretes')

// 📖 Ajuda de uso (sem argumento ou valor que não é um número da lista)
function textoDeUso(motivo) {
  const cabeco = motivo
    ? `❌ *${motivo}*\n\n`
    : '❌ *Como cancelar um lembrete:*\n\n'
  return (
    cabeco +
    '`/cancelarlembrete <número>`\n\n' +
    '🔢 O número é o do item na listagem */meuslembretes* (1 = o mais próximo).\n\n' +
    '🗝️ Exemplos:\n' +
    '• `/meuslembretes` — mostra os números de cada lembrete\n' +
    '• `/cancelarlembrete 1` — cancela o primeiro da lista'
  )
}

// 🪪 Aviso quando o WhatsApp entrega só o LID do remetente (retry)
const AVISO_LID =
  '🪪 *Não consegui identificar seu número agora* (o WhatsApp entregou só o LID).\n\n' +
  'Tente o comando de novo em instantes. 🌙'

module.exports = {
  nome: 'cancelarlembrete',
  aliases: ['cancelalembrete'],
  categoria: 'utilitario',
  descricao: 'Cancela um lembrete pelo número da listagem. Uso: /cancelarlembrete <número>',

  async executar(sock, jid, msg, text) {
    try {
      // 1) Parse: "/cancelarlembrete <número>"
      const partes = String(text || '').trim().split(/\s+/)
      const token = partes[1] || ''

      if (!token) {
        return await sock.sendMessage(jid, { text: textoDeUso() }, { quoted: msg })
      }
      if (!/^\d+$/.test(token)) {
        return await sock.sendMessage(jid, {
          text: textoDeUso('isso não parece com um número da lista...')
        }, { quoted: msg })
      }
      const indice = Number(token)

      // 2) 🪪 Número REAL do remetente (PROOF-LID — mesmo do /lembrete)
      const { numero } = await obterNumeroRemetente(sock, jid, msg)
      if (!numero) {
        console.warn('[cancelarlembrete] 🪪 remetente @lid não resolvível — pedindo retry')
        return await sock.sendMessage(jid, { text: AVISO_LID }, { quoted: msg })
      }

      // 3) Cancela pelo MESMO índice da listagem (mesma consulta/ordem)
      const resultado = await cancelarLembrete(numero, indice)

      if (resultado.status === 'ok') {
        const { cancelado, restantes } = resultado
        return await sock.sendMessage(jid, {
          text:
            '✅ *Lembrete cancelado!*\n\n' +
            `📝 ${cancelado.texto}\n` +
            `📅 Iria tocar em *${formatarDataHora(cancelado.disparar_em)}*.\n\n` +
            (restantes > 0
              ? `Ainda restam *${restantes}* lembrete(s) pendente(s) — veja com */meuslembretes*. 🌙`
              : '📭 Você não tem mais lembretes pendentes. 🌙')
        }, { quoted: msg })
      }

      if (resultado.status === 'sem_lembretes') {
        return await sock.sendMessage(jid, {
          text:
            '📭 *Você não tem lembretes pendentes...*\n\n' +
            'Nada para cancelar. Agende um com `/lembrete 2h Beber água`. 🌙'
        }, { quoted: msg })
      }

      if (resultado.status === 'fora_da_faixa') {
        return await sock.sendMessage(jid, {
          text:
            `⚠️ *Não existe o lembrete nº ${indice}...*\n\n` +
            `Você tem apenas *${resultado.total}* pendente(s) na lista. ` +
            'Confira os números com */meuslembretes* e tente de novo. 🌙'
        }, { quoted: msg })
      }

      if (resultado.status === 'indice_invalido') {
        return await sock.sendMessage(jid, {
          text: textoDeUso('o número da lista começa em 1...')
        }, { quoted: msg })
      }

      // sem_numero (defensivo — já tratado na etapa 2)
      return await sock.sendMessage(jid, { text: AVISO_LID }, { quoted: msg })
    } catch (erro) {
      console.error('⚠️ [cancelarlembrete] falha ao cancelar:', erro?.message || erro)
      await sock.sendMessage(jid, {
        text: '❌ Não consegui cancelar seu lembrete agora (falha no banco de dados). Tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}