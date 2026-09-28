// ============================================
// 🔞 MODOADULTO — Liga/desliga o modo adulto POR GRUPO
// ============================================
// Uso (dentro de um grupo):
//   /modoadulto        -> mostra o STATUS atual deste grupo
//   /modoadulto 1      -> LIGA (aceita: on, ligar, ativar, true, sim)
//   /modoadulto 0      -> DESLIGA (aceita: off, desligar, desativar,
//                         false, nao/não)
//
// Restrito a administradores do grupo (ou dono do grupo / dono do bot),
// MESMO critério de autorização do /welcome (checagem PROOF-LID via
// ehAdminDoGrupo/ehDonoDoBot).
//
// Persistência: MongoDB — collection "modoAdulto", 1 documento por
// grupo_id ({ grupo_id, ativo, atualizado_em }). Toda a lógica de banco
// vive em modoadulto.js (mesmo padrão de conexão do resto do projeto:
// singleton + ping de saúde + reconexão + erros ruidosos).
//
// 🔌 PARA OS COMANDOS ADULTOS: importem a função pronta
//      const { modoAdultoAtivo } = require('../../modoadulto')
//      if (!(await modoAdultoAtivo(grupoId))) { /* bloquear */ }
//    (modoAdultoAtivo NUNCA lança: em falha de banco devolve false.)
//
// Compatibilidade: o nome antigo /modo-adulto continua funcionando
// como alias deste mesmo comando.
// ============================================

const { limparNumero, ehAdminDoGrupo, ehDonoDoBot } = require('../../config')
const { definirModoAdulto, modoAdultoAtivo } = require('../../modoadulto')

// Variações aceitas para LIGAR / DESLIGAR (comparadas em minúsculas)
const OPCOES_LIGAR = ['1', 'on', 'ligar', 'ativar', 'true', 'sim']
const OPCOES_DESLIGAR = ['0', 'off', 'desligar', 'desativar', 'false', 'nao', 'não']

module.exports = {
  nome: 'modoadulto',
  aliases: ['modo-adulto', 'modoadulto-ligar', 'adulto'],
  descricao: 'Liga/desliga o modo adulto deste grupo (apenas administradores).',

  async executar(sock, jid, msg, text) {
    try {
      // 1) 🚪 Só funciona dentro de grupos
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, {
          text: '🔞 *O modo adulto só faz sentido em um território coletivo.*\n\nUse este comando em um grupo para ligar/desligar o modo adulto.'
        }, { quoted: msg })
      }

      const sender = msg.key.participant || msg.key.remoteJid

      // 2) 👥 Metadados do grupo para saber quem manda aqui
      const metadados = await sock.groupMetadata(jid)
      const participantes = metadados?.participants || []

      // 3) 🔒 Autorização (mesmo critério do /welcome):
      //    dono do bot (PROOF-LID) OU admin do grupo OU dono do grupo
      const ehAutorizado =
        ehDonoDoBot(participantes, sender) ||
        ehAdminDoGrupo(participantes, sender) ||
        limparNumero(sender) === limparNumero(metadados?.owner)

      if (!ehAutorizado) {
        return await sock.sendMessage(jid, {
          text: '🌑 *Hipnos ignora sua petição...*\n\nApenas *administradores do grupo* (ou o dono do bot) podem ligar/desligar o modo adulto.'
        }, { quoted: msg })
      }

      // 4) 🎛️ Lê a opção digitada (sem argumento = mostrar status)
      const args = String(text || '').split(' ').slice(1)
      const opcao = (args[0] || '').trim().toLowerCase()

      // 4.1) SEM ARGUMENTO -> mostra o status atual deste grupo
      if (!opcao) {
        const ativo = await modoAdultoAtivo(jid)
        const linhaStatus = ativo
          ? '✅ *Modo adulto ATIVADO* neste grupo.'
          : '❌ *Modo adulto DESATIVADO* neste grupo.'

        return await sock.sendMessage(jid, {
          text: `🔞 *PORTAL DO MODO ADULTO*\n\n${linhaStatus}\n\n⚙️ Para mudar: */modoadulto 1* (ligar) ou */modoadulto 0* (desligar).\n\n💡 Com o modo ligado, use */menu-adulto* para ver os comandos liberados.`
        }, { quoted: msg })
      }

      // 4.2) Normaliza a opção para true/false (ou null se for inválida)
      let novoEstado = null
      if (OPCOES_LIGAR.includes(opcao)) novoEstado = true
      else if (OPCOES_DESLIGAR.includes(opcao)) novoEstado = false

      if (novoEstado === null) {
        return await sock.sendMessage(jid, {
          text: `❌ Comando inválido...\n\nUse */modoadulto 1* para LIGAR ou */modoadulto 0* para DESLIGAR o modo adulto.\n(ou */modoadulto* sem nada para ver o status atual)`
        }, { quoted: msg })
      }

      // 5) 🌙 Já está nesse estado? Avisa e não grava nada
      const estadoAtual = await modoAdultoAtivo(jid)
      if (estadoAtual === novoEstado) {
        return await sock.sendMessage(jid, {
          text: novoEstado
            ? '⚠️ O *modo adulto já está ATIVADO* neste recinto. Nada mudou.'
            : '⚠️ O *modo adulto já está DESATIVADO* neste recinto. Nada mudou.'
        }, { quoted: msg })
      }

      // 6) 🗄️ Persiste a escolha NESTE grupo (MongoDB — modoAdulto)
      await definirModoAdulto(jid, novoEstado)

      // 7) ✅ Confirma o novo estado
      if (novoEstado) {
        return await sock.sendMessage(jid, {
          text: '🔞 *PORTÃO DO PRAZER ABERTO*\n\n✅ *Modo adulto ATIVADO* neste grupo.\n🌙 Use */menu-adulto* para ver os comandos liberados.\n\n⚠️ Conteúdo +18: mantenham o respeito entre os membros.'
        }, { quoted: msg })
      }

      return await sock.sendMessage(jid, {
        text: '🌑 *PORTÃO SELADO*\n\n❌ *Modo adulto DESATIVADO* neste grupo.\n🌙 Os comandos adultos voltam ao silêncio.'
      }, { quoted: msg })

    } catch (err) {
      console.error('Erro no comando modoadulto:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
