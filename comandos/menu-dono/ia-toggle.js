// ============================================
// 🤖 IA-INTERATIVA — Liga/desliga a IA conversacional POR GRUPO (SÓ DONO)
// ============================================
// Uso (dentro de um grupo):
//   /ia-interativa        -> mostrando o STATUS atual deste grupo
//   /ia-interativa 1      -> LIGA    (aceita: on, ligar, ativar, true, sim)
//   /ia-interativa 0      -> DESLIGA (aceita: off, desligar, desativar,
//                           false, nao/não)
//
// 🔒 PERMISSÃO: APENAS DONOS DO BOT (ehDonoDoBot — checagem PROOF-LID, que
//    resolve o remetente mesmo quando o WhatsApp o entrega como "@lid").
//    Admins de grupo NÃO podem mudar isto (diferente do /welcome).
//
// 🗄️ Persistência: MongoDB — MESMA collection do /welcome
//    ("configuracoesGrupo"), campo `ia_interativa`, 1 documento por
//    grupo_id. Toda a lógica de banco vive em configuracoes-grupo.js
//    (definirIaInterativa / iaInterativaHabilitada).
//
// O COMPORTAMENTO da IA (gatilho por menção/reply, cooldown de 30s por
// usuário, personalidade fixa, falha silenciosa) vive em ia-interativa.js —
// este arquivo é só o interruptor.
// ============================================

const { ehDonoDoBot } = require('../../config')
const { definirIaInterativa, iaInterativaHabilitada } = require('../../configuracoes-grupo')

// Variações aceitas para LIGAR / DESLIGAR (comparadas em minúsculas)
const OPCOES_LIGAR = ['1', 'on', 'ligar', 'ativar', 'true', 'sim']
const OPCOES_DESLIGAR = ['0', 'off', 'desligar', 'desativar', 'false', 'nao', 'não']

module.exports = {
  nome: 'ia-interativa',
  aliases: ['ia-toggle', 'iatoggle', 'toggleia'],
  descricao: 'Liga/desliga a IA conversacional deste grupo (apenas donos do bot).',

  async executar(sock, jid, msg, text) {
    try {
      // 1) 🚪 O interruptor é POR GRUPO — fora de grupo não há o que salvar
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, {
          text: '🤖 *Hipnos só desperta em territórios coletivos.*\n\nUse este comando dentro de um grupo para ligar/desligar a IA interativa.'
        }, { quoted: msg })
      }

      const sender = msg.key.participant || msg.key.remoteJid

      // 2) 👥 Metadados do grupo (necessários p/ a checagem PROOF-LID do dono)
      const metadados = await sock.groupMetadata(jid)
      const participantes = metadados?.participants || []

      // 3) 🔒 SOMENTE DONOS DO BOT (ehDonoDoBot resolve o LID do remetente)
      if (!ehDonoDoBot(participantes, sender)) {
        return await sock.sendMessage(jid, {
          text: '🌑 *Hipnos guarda este segredo apenas para os seus donos.*\n\nSó o dono do bot pode ligar ou desligar a IA interativa.'
        }, { quoted: msg })
      }

      // 4) 🎛️ Lê a opção digitada (sem argumento = mostrar status)
      const args = String(text || '').split(' ').slice(1)
      const opcao = (args[0] || '').trim().toLowerCase()

      // 4.1) SEM ARGUMENTO -> mostra o estado atual deste grupo
      if (!opcao) {
        let ativo = false
        try {
          ativo = await iaInterativaHabilitada(jid)
        } catch (erro) {
          console.error('Erro ao consultar a IA interativa:', erro)
        }
        const linhaStatus = ativo
          ? '✅ *IA interativa está LIGADA* neste grupo.'
          : '❌ *IA interativa está DESLIGADA* neste grupo.'

        return await sock.sendMessage(jid, {
          text: `🤖 *DESPERTAR DE HIPNOS*\n\n${linhaStatus}\n\n⚙️ Para mudar: */ia-interativa 1* (ligar) ou */ia-interativa 0* (desligar).`
        }, { quoted: msg })
      }

      // 4.2) Normaliza a opção para true/false (ou null se for inválida)
      let novoEstado = null
      if (OPCOES_LIGAR.includes(opcao)) novoEstado = true
      else if (OPCOES_DESLIGAR.includes(opcao)) novoEstado = false

      if (novoEstado === null) {
        return await sock.sendMessage(jid, {
          text: '❌ Comando inválido...\n\nUse */ia-interativa 1* para LIGAR ou */ia-interativa 0* para DESLIGAR a IA interativa.\n(ou */ia-interativa* sem nada para ver o estado atual)'
        }, { quoted: msg })
      }

      // 5) 🗄️ Persiste a escolha NESTE grupo (MongoDB — configuracoesGrupo)
      await definirIaInterativa(jid, novoEstado)

      // 6) ✅ Confirma o novo estado
      if (novoEstado) {
        return await sock.sendMessage(jid, {
          text: '🤖 *HIPNOS DESPERTOU*\n\n✅ *IA interativa ATIVADA* neste grupo.\n🌙 Agora, quem mencionar o bot ou responder a uma mensagem dele receberá uma resposta — no máximo uma a cada 30 segundos por pessoa.'
        }, { quoted: msg })
      }

      return await sock.sendMessage(jid, {
        text: '🌑 *HIPNOS VOLTA A DORMIR*\n\n❌ *IA interativa DESATIVADA* neste grupo.\n💤 Menções e respostas ao bot voltam a cair no silêncio — nenhuma chamada de IA será feita aqui.'
      }, { quoted: msg })

    } catch (err) {
      console.error('Erro no comando ia-interativa:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
