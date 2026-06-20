const cooldown = new Map();

function isAdmin(p) {
  return p?.admin === "admin" || p?.admin === "superadmin";
}

module.exports = {
  nome: "kick",

  executar: async (sock, jid, msg, text) => {
    try {
      const sender = msg.key.participant || msg.key.remoteJid;

      const mentioned =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

      const motivo = text.split(" ").slice(2).join(" ") || "Não informado";

      // 🔥 cooldown anti spam
      if (cooldown.has(sender)) {
        return sock.sendMessage(jid, {
          text: "⏳ Aguarde alguns segundos antes de usar novamente."
        }, { quoted: msg });
      }

      cooldown.set(sender, true);
      setTimeout(() => cooldown.delete(sender), 4000);

      if (!mentioned) {
        return sock.sendMessage(jid, {
          text: "❌ Marque o usuário para remover.\nEx: /kick @usuario motivo"
        }, { quoted: msg });
      }

      const metadata = await sock.groupMetadata(jid);
      const participants = metadata.participants;

      const senderData = participants.find(p => p.id === sender);
      const targetData = participants.find(p => p.id === mentioned);

      const isSenderAdmin =
        isAdmin(senderData) || metadata.owner === sender;

      if (!isSenderAdmin) {
        return sock.sendMessage(jid, {
          text: "❌ Apenas administradores podem usar este comando."
        }, { quoted: msg });
      }

      if (mentioned === sender) {
        return sock.sendMessage(jid, {
          text: "❌ Você não pode se remover."
        }, { quoted: msg });
      }

      const isTargetAdmin =
        isAdmin(targetData) || metadata.owner === mentioned;

      if (isTargetAdmin) {
        return sock.sendMessage(jid, {
          text: "❌ Você não pode remover outro admin ou o dono do grupo."
        }, { quoted: msg });
      }

      // 🚪 REMOVE MEMBRO
      await sock.groupParticipantsUpdate(jid, [mentioned], "remove");

      // ✅ CONFIRMAÇÃO
      await sock.sendMessage(jid, {
        text:
`🚪 USUÁRIO REMOVIDO

👤 Alvo: @${mentioned.split("@")[0]}
👮‍♂️ Por: @${sender.split("@")[0]}
📌 Motivo: ${motivo}`,
        mentions: [mentioned, sender]
      }, { quoted: msg });

    } catch (err) {
      console.log("Erro no kick:", err);

      await sock.sendMessage(jid, {
        text: "❌ Erro ao executar o kick."
      });
    }
  }
};