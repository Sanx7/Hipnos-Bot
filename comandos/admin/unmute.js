const fs = require("fs");
const path = require("path");

const pastaDados = path.join(__dirname, "..", "dados");
const arquivoMutados = path.join(pastaDados, "mutados.json");

function isAdmin(p) {
  return p?.admin === "admin" || p?.admin === "superadmin";
}

module.exports = {
  nome: "unmute",

  executar: async (sock, jid, msg) => {
    try {
      const muteCmd = require("./mute");
      const mutedUsers = muteCmd.mutedUsers;

      const sender = msg.key.participant || msg.key.remoteJid;

      const mentioned =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

      if (!mentioned) {
        return sock.sendMessage(
          jid,
          {
            text: "❌ Marque o mortal que terá sua voz restaurada.\nEx: /unmute @usuario"
          },
          { quoted: msg }
        );
      }

      const metadata = await sock.groupMetadata(jid);

      const senderData = metadata.participants.find(
        p => p.id === sender
      );

      const isSenderAdmin =
        isAdmin(senderData) ||
        metadata.owner === sender;

      if (!isSenderAdmin) {
        return sock.sendMessage(
          jid,
          {
            text: "💀 Apenas administradores podem quebrar o silêncio imposto por Hipnos."
          },
          { quoted: msg }
        );
      }

      if (!mutedUsers.has(mentioned)) {
        return sock.sendMessage(
          jid,
          {
            text: "🌙 Este mortal não está sob o silêncio de Hipnos."
          },
          { quoted: msg }
        );
      }

      mutedUsers.delete(mentioned);

      fs.writeFileSync(
        arquivoMutados,
        JSON.stringify(
          [...mutedUsers.keys()],
          null,
          2
        )
      );

      await sock.sendMessage(
        jid,
        {
          text:
`🌙✨ O JULGAMENTO FOI REVOGADO

👤 @${mentioned.split("@")[0]}

💀 "Hipnos retira o véu do silêncio.
Suas palavras podem voltar a ecoar entre os mortais."`,
          mentions: [mentioned]
        },
        { quoted: msg }
      );

    } catch (err) {
      console.log("Erro no unmute:", err);

      await sock.sendMessage(
        jid,
        {
          text: "💀 As sombras falharam ao restaurar a voz deste mortal."
        }
      );
    }
  }
};