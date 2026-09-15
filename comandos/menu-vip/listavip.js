// ============================================
// 📜 LISTAVIP — Lista os VIPs ativos (apenas DONOS do bot)
// ============================================
// - Mostra TODOS os VIPs vigentes: número + data de expiração,
//   ordenados pela expiração MAIS PRÓXIMA primeiro.
// - Antes de listar, remove do banco os VIPs já expirados (limpeza automática,
//   feita dentro de listarVipsAtivos()).
// - 🪪 Antes de listar, corrige registros antigos gravados com o LID
//   (identificador @lid do WhatsApp) no lugar do número real — a MESMA
//   correção do scripts/migrar-vip-lid.js (vip.corrigirVipsComLid()).
// - Autorização idêntica ao /darvip (OWNER_NUMBERS do config.js).
// - Renomeado de /servip p/ /listavip.
// ============================================

const { formatarNumero, ehDonoDoBot } = require('../../config')
const vip = require('../../vip')

module.exports = {
  nome: 'listavip',
  descricao: 'Lista os membros VIP ativos e suas expirações (apenas donos).',

  async executar(sock, jid, msg, text) {
    try {
      const sender = msg.key.participant || msg.key.remoteJid

      // 1) 🔒 Apenas donos do bot.
      //    Checagem PROOF-LID: em grupo buscamos os metadados para resolver
      //    o sender mesmo quando ele vem como "@lid"; no privado (sem
      //    metadados) a própria função cai na comparação direta.
      let participantes = null
      if (jid.endsWith('@g.us')) {
        try {
          const metadados = await sock.groupMetadata(jid)
          participantes = metadados.participants
        } catch (err) {
          console.error('[listavip] Sem metadados do grupo:', err?.message || err)
        }
      }
      if (!ehDonoDoBot(participantes, sender)) {
        return await sock.sendMessage(jid, {
          text: '🌑 *Hipnos só obedece aos donos do bot.*\n\nO livro dos VIPs 💠 permanece selado aos olhos dos mortais.'
        }, { quoted: msg })
      }

      // 2) 🪪 Correção pontual: registros gravados com LID no lugar do
      //    número real são trocados pelo número (best-effort — se o
      //    mapeamento da sessão não conhecer o LID, o registro fica como está).
      try {
        const correcao = await vip.corrigirVipsComLid()
        if (correcao.corrigidos > 0) {
          console.log(`[listavip] 🪪 ${correcao.corrigidos} registro(s) VIP corrigido(s) de LID p/ o número real`)
        }
      } catch (err) {
        console.error('[listavip] ⚠️ falha ao corrigir registros com LID (listando como estão):', err?.message || err)
      }

      // 3) Lista de ativos (expirados já são removidos do banco nessa chamada)
      const lista = await vip.listarVipsAtivos()

      if (!lista.length) {
        return await sock.sendMessage(jid, {
          text: '💠 *Nenhum VIP ativo no momento.*\n\nO salão dos privilegiados está vazio... Use */darvip @membro [dias]* para outorgar o primeiro selo.'
        }, { quoted: msg })
      }

      // 4) Lista numerada (a ordem já vem do banco: expiração mais próxima primeiro)
      const linhas = lista.map((v, indice) => {
        const diasRestantes = Math.max(1, Math.ceil((v.expira_em - Date.now()) / vip.DIA_EM_MS))
        return `${indice + 1}. 💠 *${formatarNumero(v.numero)}*\n    ⏳ Expira em *${vip.formatarData(v.expira_em)}* (~${diasRestantes} dia${diasRestantes > 1 ? 's' : ''})`
      })

      const resposta =
        `📜 *LIVRO DOS VIPs* (${lista.length} ativo${lista.length > 1 ? 's' : ''}) 📜\n\n` +
        linhas.join('\n') +
        '\n\n💤 *"Todo privilégio sonha com o seu fim."*'

      await sock.sendMessage(jid, { text: resposta }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando listavip:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente.'
      }, { quoted: msg })
    }
  }
}
