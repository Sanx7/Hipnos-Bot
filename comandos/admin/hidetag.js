module.exports = {
  nome: "hidetag",
  async executar(sock, jid, msg, text) {
    try {
      const ehGrupo = jid.endsWith('@g.us');
      if (!ehGrupo) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos não convoca almas fora de um território coletivo. Use este comando em um grupo.' 
        }, { quoted: msg });
      }

      // Validação do Dono (O Soberano)
      const sender = msg.key.participant || msg.key.remoteJid;
      const numeroDoSender = sender.split('@')[0].split(':')[0].replace(/\D/g, '');
      const SEU_LID = '177060848861240';

      if (numeroDoSender !== SEU_LID) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos recusa sua ordem... você não possui a voz que ecoa no subconsciente deste reino.' 
        }, { quoted: msg });
      }

      // Extrai o motivo/texto após o comando
      const args = text.split(' ').slice(1);
      const motivo = args.join(' ').trim();

      // Busca os metadados e participantes do grupo
      const metadados = await sock.groupMetadata(jid);
      const participantes = metadados.participants.map(p => p.id);

      // Convocação em massa com menção oculta
      const mensagemInvocacao = `🔔 **CONVOCAÇÃO DO LIMBO** 🔔\n\n🪐 Hipnos exige sua atenção imediata.\n\n📝 **Mensagem:** ${motivo || 'O Soberano não deu explicações, apenas apareçam.'}`;

      await sock.sendMessage(jid, {
        text: mensagemInvocacao,
        mentions: participantes
      });

    } catch (err) {
      console.error('Erro no comando hidetag:', err);
    }
  }
};