function isAdmin(p) {
  return p?.admin === "admin" || p?.admin === "superadmin";
}

const cooldown = new Map();

module.exports = {
  nome: "promover",

  executar: async (sock, jid, msg) => {
    try {
      const sender = msg.key.participant || msg.key.remoteJid;

      const contextInfo =
        msg.message?.extendedTextMessage?.contextInfo;

      const alvo =
        contextInfo?.mentionedJid?.[0] ||
        contextInfo?.participant;

      if (!alvo) {
        return sock.sendMessage(
          jid,
          {
            text: "❌ Marque um usuário ou responda uma mensagem.\nEx: /promover @usuario"
          },
          { quoted: msg }
        );
      }

      if (cooldown.has(sender)) {
        return;
      }

      cooldown.set(sender, true);
      setTimeout(() => cooldown.delete(sender), 3000);

      const metadata = await sock.groupMetadata(jid);

      const senderData = metadata.participants.find(
        p => p.id === sender
      );

      const targetData = metadata.participants.find(
        p => p.id === alvo
      );

      const isSenderAdmin =
        isAdmin(senderData) ||
        metadata.owner === sender;

      if (!isSenderAdmin) {
        return sock.sendMessage(
          jid,
          {
            text: "💀 Apenas administradores podem conceder poder."
          },
          { quoted: msg }
        );
      }

      if (!targetData) {
        return sock.sendMessage(
          jid,
          {
            text: "❌ Usuário não encontrado no grupo."
          },
          { quoted: msg }
        );
      }

      if (isAdmin(targetData)) {
        return sock.sendMessage(
          jid,
          {
            text: "🌙 Este mortal já possui os poderes das sombras."
          },
          { quoted: msg }
        );
      }

      await sock.groupParticipantsUpdate(
        jid,
        [alvo],
        "promote"
      );

      await sock.sendMessage(
        jid,
        {
          text:
`🌙👑 JULGAMENTO DE HIPNOS

☠️ Um mortal ascendeu entre as sombras...

👤 @${alvo.split("@")[0]} foi PROMOVIDO

💀 "Receba agora a autoridade concedida pelo Deus do Sono.
Use este poder com sabedoria, humano insolente."`,
          mentions: [alvo]
        },
        { quoted: msg }
      );

    } catch (err) {
      console.log("Erro no promover:", err);

      await sock.sendMessage(jid, {
        text: "💀 As sombras falharam ao conceder poder."
      });
    }
  }
};