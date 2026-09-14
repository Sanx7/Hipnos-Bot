// ============================================
// 👋 WELCOME — Liga/desliga o sistema de boas-vindas POR GRUPO
// ============================================
// Uso (dentro de um grupo):
//   /welcome        -> mostra o STATUS atual deste grupo
//   /welcome 1      -> LIGA as boas-vindas (aceita: on, ligar, ativar, true, sim)
//   /welcome 0      -> DESLIGA as boas-vindas (aceita: off, desligar, desativar,
//                      false, nao/não)
//
// Restrito a administradores do grupo (ou dono do grupo / dono do bot),
// MESMO critério de autorização do /soadm e /delete (checagem PROOF-LID
// via ehAdminDoGrupo/ehDonoDoBot — o WhatsApp às vezes entrega o remetente
// como "@lid", e a comparação bruta com a lista de donos falharia).
//
// Persistência: MongoDB — collection "configuracoesGrupo", 1 documento por
// grupo_id ({ grupo_id, welcome, atualizado_em }). Toda a lógica de banco
// vive em configuracoes-grupo.js (mesmo padrão de conexão do resto do
// projeto: singleton + ping de saúde + reconexão + erros ruidosos).
//
// 🔌 PARA O HANDLER DE ENTRADA DE MEMBROS: importe a função pronta
//      const { welcomeHabilitado } = require('../../configuracoes-grupo')
//      if (await welcomeHabilitado(grupoId)) { /* saudar */ }
//    (welcomeHabilitado NUNCA lança: em falha de banco devolve false.)
//
// Compatibilidade: o nome antigo /bemvindo (e /boasvindas) continua
// funcionando como alias deste mesmo comando.
// ============================================

const { limparNumero, ehAdminDoGrupo, ehDonoDoBot } = require('../../config')
const { definirWelcome, welcomeHabilitado } = require('../../configuracoes-grupo')

// Variações aceitas para LIGAR / DESLIGAR (comparadas em minúsculas)
const OPCOES_LIGAR = ['1', 'on', 'ligar', 'ativar', 'true', 'sim']
const OPCOES_DESLIGAR = ['0', 'off', 'desligar', 'desativar', 'false', 'nao', 'não']

module.exports = {
  nome: 'welcome',
  aliases: ['bemvindo', 'boasvindas'],
  descricao: 'Liga/desliga o sistema de boas-vindas deste grupo (apenas administradores).',

  async executar(sock, jid, msg, text) {
    try {
      // 1) 🚪 Só funciona dentro de grupos
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, {
          text: '👋 *Hipnos não saúda almas fora de um território coletivo.*\n\nUse este comando em um grupo para ligar/desligar as boas-vindas.'
        }, { quoted: msg })
      }

      const sender = msg.key.participant || msg.key.remoteJid

      // 2) 👥 Metadados do grupo para saber quem manda aqui
      const metadados = await sock.groupMetadata(jid)
      const participantes = metadados?.participants || []

      // 3) 🔒 Autorização (mesmo critério do /soadm):
      //    dono do bot (PROOF-LID) OU admin do grupo OU dono do grupo
      const ehAutorizado =
        ehDonoDoBot(participantes, sender) ||
        ehAdminDoGrupo(participantes, sender) ||
        limparNumero(sender) === limparNumero(metadados?.owner)

      if (!ehAutorizado) {
        return await sock.sendMessage(jid, {
          text: '🌑 *Hipnos ignora sua petição...*\n\nApenas *administradores do grupo* (ou o dono do bot) podem ligar/desligar as boas-vindas.'
        }, { quoted: msg })
      }

      // 4) 🎛️ Lê a opção digitada (sem argumento = mostrar status)
      const args = String(text || '').split(' ').slice(1)
      const opcao = (args[0] || '').trim().toLowerCase()

      // 4.1) SEM ARGUMENTO -> mostra o status atual deste grupo
      if (!opcao) {
        const ativo = await welcomeHabilitado(jid)
        const linhaStatus = ativo
          ? '✅ *Boas-vindas ATIVADAS* neste grupo.'
          : '❌ *Boas-vindas DESATIVADAS* neste grupo.'

        return await sock.sendMessage(jid, {
          text: `👋 *PORTAL DAS BOAS-VINDAS*\n\n${linhaStatus}\n\n⚙️ Para mudar: */welcome 1* (ligar) ou */welcome 0* (desligar).`
        }, { quoted: msg })
      }

      // 4.2) Normaliza a opção para true/false (ou null se for inválida)
      let novoEstado = null
      if (OPCOES_LIGAR.includes(opcao)) novoEstado = true
      else if (OPCOES_DESLIGAR.includes(opcao)) novoEstado = false

      if (novoEstado === null) {
        return await sock.sendMessage(jid, {
          text: `❌ Comando inválido...\n\nUse */welcome 1* para LIGAR ou */welcome 0* para DESLIGAR as boas-vindas.\n(ou */welcome* sem nada para ver o status atual)`
        }, { quoted: msg })
      }

      // 5) 🌙 Já está nesse estado? Avisa e não grava nada
      const estadoAtual = await welcomeHabilitado(jid)
      if (estadoAtual === novoEstado) {
        return await sock.sendMessage(jid, {
          text: novoEstado
            ? '⚠️ As *boas-vindas já estão ATIVADAS* neste recinto. Nada mudou.'
            : '⚠️ As *boas-vindas já estão DESATIVADAS* neste recinto. Nada mudou.'
        }, { quoted: msg })
      }

      // 6) 🗄️ Persiste a escolha NESTE grupo (MongoDB — configuracoesGrupo)
      await definirWelcome(jid, novoEstado)

      // 7) ✅ Confirma o novo estado
      if (novoEstado) {
        return await sock.sendMessage(jid, {
          text: '🚪 *PORTÃO DOS SONHOS*\n\n✅ *Boas-vindas ATIVADAS* neste grupo.\n🌙 Hipnos agora vigia as entradas: os novos mortais serão devidamente recebidos.'
        }, { quoted: msg })
      }

      return await sock.sendMessage(jid, {
        text: '🌑 *SILÊNCIO RESTAURADO*\n\n❌ *Boas-vindas DESATIVADAS* neste grupo.\n🌙 Hipnos recolheu as saudações: os novos membros entrarão no limbo em absoluto silêncio.'
      }, { quoted: msg })

    } catch (err) {
      console.error('Erro no comando welcome:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}