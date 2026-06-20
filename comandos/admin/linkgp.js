module.exports = {
  nome: "linkgp",
  async executar(sock, jid, msg, text) {
    try {
      const ehGrupo = jid.endsWith('@g.us');
      if (!ehGrupo) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos não gerencia portais fora de um território coletivo. Use este comando em um grupo.' 
        }, { quoted: msg });
      }

      // Validação do Dono (O Soberano)
      const sender = msg.key.participant || msg.key.remoteJid;
      const numeroDoSender = sender.split('@')[0].split(':')[0].replace(/\D/g, '');
      const SEU_LID = '177060848861240';

      if (numeroDoSender !== SEU_LID) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos recusa sua ordem... apenas o Soberano pode revelar as coordenadas deste território.' 
        }, { quoted: msg });
      }

      // Tenta obter o código de convite do grupo usando a função nativa do Baileys
      try {
        const codigoConvite = await sock.groupInviteCode(jid);
        
        if (!codigoConvite) {
          return await sock.sendMessage(jid, { 
            text: '❌ Erro ao invocar o portal. Certifique-se de que Hipnos possui privilégios de Administrador neste recinto.' 
          }, { quoted: msg });
        }

        const linkCompleto = `https://chat.whatsapp.com/${codigoConvite}`;

        await sock.sendMessage(jid, {
          text: `🌌 **PORTAL DO LIMBO REVELADO** 🌌\n\n🪐 Aqui está o caminho para novos mortais entrarem no reino:\n🔗 ${linkCompleto}`
        }, { quoted: msg });

      } catch (err) {
        // Se cair no catch aqui, geralmente significa que o bot não é admin
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos está impotente... Conceda-me o cargo de Administrador para que eu possa ler os pergaminhos de convite.' 
        }, { quoted: msg });
      }

    } catch (err) {
      console.error('Erro no comando linkgp:', err);
    }
  }
};