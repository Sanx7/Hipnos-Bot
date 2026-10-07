const estadoBot = require('../../estado-bot')

function criarComando(nome, ligado) {
  return {
    nome,
    categoria: 'dono',
    descricao: `${ligado ? 'Liga' : 'Desliga'} o uso geral do bot (somente dono).`,
    async executar(sock, jid, msg) {
      const sender = msg.key.participant || msg.key.remoteJid
      if (!(await estadoBot.remetenteEhDono(sock, jid, sender))) {
        return sock.sendMessage(jid, { text: '👑 Só o dono do bot pode ligar ou desligar o uso geral.' }, { quoted: msg })
      }
      try {
        await estadoBot.definirLigado(ligado)
      } catch (_) {
        return sock.sendMessage(jid, { text: '❌ Não consegui salvar o estado no banco. Nenhuma alteração foi confirmada; tente novamente.' }, { quoted: msg })
      }
      return sock.sendMessage(jid, {
        text: ligado
          ? '☀️ Hipnos está ligado! Os comandos estão liberados para uso geral.'
          : '💤 Hipnos está em modo manutenção. Somente os donos podem interagir; moderação e tarefas automáticas continuam funcionando.'
      }, { quoted: msg })
    }
  }
}

module.exports = [criarComando('on', true), criarComando('off', false)]
