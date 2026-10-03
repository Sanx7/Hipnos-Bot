// ============================================
// 🗑️ ANTIAPAGADA — Liga/desliga a recuperação de mensagens apagadas POR GRUPO
// ============================================
// Uso (dentro de um grupo):
//   /antiapagada        -> mostra o STATUS atual deste grupo
//   /antiapagada 1      -> LIGA (aceita: on, ligar, ativar, true, sim)
//   /antiapagada 0      -> DESLIGA (aceita: off, desligar, desativar,
//                          false, nao/não)
//
// Restrito a administradores do grupo (ou dono do bot), MESMO critério do
// /welcome (checagem PROOF-LID via ehAdminDoGrupo/ehDonoDoBot).
//
// O que faz: com LIGADO, o bot guarda cada mensagem do grupo por ~2h e,
// quando alguém usa "apagar para todos", reenvia o conteúdo original +
// registra no histórico do dia (/apagadas). Com DESLIGADO, nada é capturado
// nem reenviado naquele grupo.
//
// DECISÃO DE PADRÃO: LIGADO por padrão (grupo sem registro = ligado). O
// valor do recurso está em recuperar sem configurar nada; quem se incomoda
// com a privacidade desliga com 1 comando. Em falha de banco o reenvio
// assume DESLIGADO (fail-safe de privacidade).
//
// Persistência: MongoDB — MESMA collection "configuracoesGrupo" do /welcome
// (campo `antiapagada`, 1 documento por grupo_id). Lógica de banco em
// configuracoes-grupo.js (definirAntiApagada/antiApagadaHabilitada).
// ============================================

const { limparNumero, ehAdminDoGrupo, ehDonoDoBot } = require('../../config')
const { definirAntiApagada, antiApagadaHabilitada } = require('../../configuracoes-grupo')

const OPCOES_LIGAR = ['1', 'on', 'ligar', 'ativar', 'true', 'sim']
const OPCOES_DESLIGAR = ['0', 'off', 'desligar', 'desativar', 'false', 'nao', 'não']

module.exports = {
  nome: 'antiapagada',
  aliases: ['anti-apagada', 'antidelete'],
  descricao: 'Liga/desliga a recuperação de mensagens apagadas neste grupo (apenas administradores).',

  async executar(sock, jid, msg, text) {
    try {
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, {
          text: '🗑️ *Hipnos não vigia apagadas fora de um território coletivo.*\n\nUse este comando em um grupo para ligar/desligar a recuperação.'
        }, { quoted: msg })
      }

      const sender = msg.key.participant || msg.key.remoteJid
      const metadados = await sock.groupMetadata(jid)
      const participantes = metadados?.participants || []

      const ehAutorizado =
        ehDonoDoBot(participantes, sender) ||
        ehAdminDoGrupo(participantes, sender) ||
        limparNumero(sender) === limparNumero(metadados?.owner)

      if (!ehAutorizado) {
        return await sock.sendMessage(jid, {
          text: '🌑 *Hipnos ignora sua petição...*\n\nApenas *administradores do grupo* (ou o dono do bot) podem ligar/desligar a recuperação de apagadas.'
        }, { quoted: msg })
      }

      const args = String(text || '').split(' ').slice(1)
      const opcao = (args[0] || '').trim().toLowerCase()

      if (!opcao) {
        const ativo = await antiApagadaHabilitada(jid)
        const linhaStatus = ativo
          ? '✅ *Recuperação de apagadas ATIVADA* neste grupo.'
          : '❌ *Recuperação de apagadas DESATIVADA* neste grupo.'
        return await sock.sendMessage(jid, {
          text: `🗑️ *GUARDIÃO DAS APAGADAS*\n\n${linhaStatus}\n\nCom ligada, o que for apagado "para todos" volta ao grupo com o conteúdo original (texto ou mídia de até ~5MB) e entra no /apagadas do dia.\n\n⚙️ Para mudar: */antiapagada 1* (ligar) ou */antiapagada 0* (desligar).`
        }, { quoted: msg })
      }

      let novoEstado = null
      if (OPCOES_LIGAR.includes(opcao)) novoEstado = true
      else if (OPCOES_DESLIGAR.includes(opcao)) novoEstado = false

      if (novoEstado === null) {
        return await sock.sendMessage(jid, {
          text: '❌ Comando inválido...\n\nUse */antiapagada 1* para LIGAR ou */antiapagada 0* para DESLIGAR.\n(ou */antiapagada* sem nada para ver o status atual)'
        }, { quoted: msg })
      }

      const estadoAtual = await antiApagadaHabilitada(jid)
      if (estadoAtual === novoEstado) {
        return await sock.sendMessage(jid, {
          text: novoEstado
            ? '⚠️ A *recuperação de apagadas já está ATIVADA* neste recinto. Nada mudou.'
            : '⚠️ A *recuperação de apagadas já está DESATIVADA* neste recinto. Nada mudou.'
        }, { quoted: msg })
      }

      await definirAntiApagada(jid, novoEstado)

      if (novoEstado) {
        return await sock.sendMessage(jid, {
          text: '🗑️ *GUARDIÃO DESPERTO*\n\n✅ *Recuperação de apagadas ATIVADA* neste grupo.\n🌙 O que for apagado "para todos" volta ao grupo com o conteúdo original.'
        }, { quoted: msg })
      }

      return await sock.sendMessage(jid, {
        text: '🌑 *VÉU RESTAURADO*\n\n❌ *Recuperação de apagadas DESATIVADA* neste grupo.\n🌙 O que for apagado "para todos" descansa em silêncio — nada volta.'
      })
    } catch (err) {
      console.error('Erro no comando antiapagada:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
