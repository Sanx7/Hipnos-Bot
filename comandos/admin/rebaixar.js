function isAdmin(p) {
  return p?.admin === "admin" || p?.admin === "superadmin";
}

const cooldown = new Map();

module.exports = {
  nome: "rebaixar",

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
            text: "❌ Marque um usuário ou responda uma mensagem.\nEx: /rebaixar @usuario"
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
            text: "💀 Apenas administradores podem retirar poder."
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

      if (!isAdmin(targetData)) {
        return sock.sendMessage(
          jid,
          {
            text: "🌙 Este mortal não possui poderes administrativos."
          },
          { quoted: msg }
        );
      }

      if (alvo === metadata.owner) {
        return sock.sendMessage(
          jid,
          {
            text: "💀 Nem mesmo Hipnos pode remover o poder do criador do grupo."
          },
          { quoted: msg }
        );
      }

      await sock.groupParticipantsUpdate(
        jid,
        [alvo],
        "demote"
      );

      await sock.sendMessage(
        jid,
        {
          text:
`🌙⚖️ JULGAMENTO DE HIPNOS

☠️ O poder foi retirado...

👤 @${alvo.split("@")[0]} foi REBAIXADO

💀 "As sombras recolhem aquilo que haviam concedido.
Volte ao lugar dos simples mortais."`,
          mentions: [alvo]
        },
        { quoted: msg }
      );

    } catch (err) {
      console.log("Erro no rebaixar:", err);

      await sock.sendMessage(jid, {
        text: "💀 As sombras falharam ao retirar o poder."
      });
    }
  }
};