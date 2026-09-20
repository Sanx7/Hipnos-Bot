// ============================================================
// 📋 MEUSLEMBRETES — Lista os lembretes pendentes do usuário
// ============================================================
// Uso: /meuslembretes (sem argumentos)
//   - Mostra os lembretes ATIVOS (enviado:false) do remetente,
//     ordenados pelo horário do disparo (o mais próximo primeiro);
//   - Cada item: texto + data/hora + onde vai tocar (aqui, outro
//     grupo ou PV);
//   - Número resolvido PROOF-LID (obterNumeroRemetente de
//     lembretes.js — o MESMO do /lembrete, então a lista bate com
//     o que foi agendado).
// ============================================================

const {
  formatarDataHora,
  listarPendentes,
  obterNumeroRemetente
} = require('../../lembretes')

module.exports = {
  nome: 'meuslembretes',
  aliases: ['meus-lembretes'],
  descricao: 'Lista seus lembretes pendentes. Uso: /meuslembretes',

  async executar(sock, jid, msg) {
    try {
      // 🪪 Número REAL do remetente (mesma resolução do /lembrete)
      const { numero } = await obterNumeroRemetente(sock, jid, msg)
      if (!numero) {
        return await sock.sendMessage(jid, {
          text:
            '🪪 *Não consegui identificar seu número agora* (o WhatsApp entregou só o LID).\n\n' +
            'Tente de novo em instantes. 🌙'
        }, { quoted: msg })
      }

      const pendentes = await listarPendentes(numero)

      if (!pendentes.length) {
        return await sock.sendMessage(jid, {
          text:
            '📋 *Você não tem lembretes pendentes...*\n\n' +
            'Agende um com `/lembrete <quando> <o quê>` — ex.: `/lembrete 2h Beber água`. 🌙'
        }, { quoted: msg })
      }

      const linhas = pendentes.map((doc, i) => {
        const onde = !doc.grupo_id
          ? 'no seu PV'
          : doc.grupo_id === jid ? 'aqui' : 'em outro grupo'
        return `${i + 1}. 📝 ${doc.texto}\n   📅 ${formatarDataHora(doc.disparar_em)} — ${onde}`
      })

      await sock.sendMessage(jid, {
        text:
          `📋 *Seus lembretes pendentes (${pendentes.length}):*\n\n` +
          linhas.join('\n\n')
      }, { quoted: msg })
    } catch (erro) {
      console.error('⚠️ [meuslembretes] falha ao listar:', erro?.message || erro)
      await sock.sendMessage(jid, {
        text: '❌ Não consegui buscar seus lembretes agora (falha no banco de dados). Tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
