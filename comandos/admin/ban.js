module.exports = {
  nome: 'ban',
  async executar(sock, jid, msg, text) {
    try {
      const ehGrupo = jid.endsWith('@g.us');
      if (!ehGrupo) {
        return await sock.sendMessage(jid, { text: 'Este comando só serve para grupos, gênio. 🥱' }, { quoted: msg });
      }

      const contextInfo = msg.message.extendedTextMessage?.contextInfo;
      let alvo = contextInfo?.mentionedJid?.[0] || contextInfo?.participant;

      if (!alvo) {
        return await sock.sendMessage(jid, { text: 'Você precisa marcar alguém com @ ou responder à mensagem da pessoa para eu chutar daqui! 🥱' }, { quoted: msg });
      }

      // IDs Fixos de Segurança (Mestre e Bot)
      const SEU_NUMERO_WHATSAPP = "14382246600@s.whatsapp.net"; 
      const meuJidCompleto = sock.user?.id || "";

      if (alvo.includes(SEU_NUMERO_WHATSAPP)) {
        return await sock.sendMessage(jid, { text: 'Eu jamais ousaria expulsar o meu Soberano do recinto. 🪐' }, { quoted: msg });
      }

      if (meuJidCompleto.includes(alvo.split('@')[0])) {
        return await sock.sendMessage(jid, { text: 'Tentar me banir usando meu próprio comando? Volte a dormir... 💤' }, { quoted: msg });
      }

      // Execução direta do banimento sem checagem de cache local
      try {
        await sock.groupParticipantsUpdate(jid, [alvo], 'remove');
        return await sock.sendMessage(jid, { text: 'Pronto. Mais um insolente removido do recinto. 🥱' });
      } catch (wsError) {
        // Se falhar, significa que o bot não é admin no grupo real
        return await sock.sendMessage(jid, { text: 'Eu tentei chutar ele, mas o WhatsApp não deixou. Me dê administrador de verdade primeiro. 🥱' }, { quoted: msg });
      }

    } catch (err) {
      console.error('Erro no comando ban:', err);
    }
  }
};