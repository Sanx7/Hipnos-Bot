const fs = require("fs");
const path = require("path");

const pastaDados = path.join(__dirname, "..", "dados");
const arquivoMutados = path.join(pastaDados, "mutados.json");

if (!fs.existsSync(pastaDados)) {
  fs.mkdirSync(pastaDados);
}

if (!fs.existsSync(arquivoMutados)) {
  fs.writeFileSync(arquivoMutados, JSON.stringify([]));
}

const mutadosSalvos = JSON.parse(
  fs.readFileSync(arquivoMutados, "utf8")
);

const mutedUsers = new Map();

for (const usuario of mutadosSalvos) {
  mutedUsers.set(usuario, true);
}

const cooldown = new Map();

function isAdmin(p) {
  return p?.admin === "admin" || p?.admin === "superadmin";
}

module.exports = {
  nome: "mute",

  mutedUsers,

  executar: async (sock, jid, msg) => {
    try {
      const sender = msg.key.participant || msg.key.remoteJid;

      const mentioned =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

      if (cooldown.has(sender)) {
        return sock.sendMessage(
          jid,
          {
            text: "🌑 O silêncio ainda não foi quebrado pelo sono..."
          },
          { quoted: msg }
        );
      }

      cooldown.set(sender, true);
      setTimeout(() => cooldown.delete(sender), 4000);

      if (!mentioned) {
        return sock.sendMessage(
          jid,
          {
            text: "❌ Marque o mortal que será silenciado.\nEx: /mute @usuario"
          },
          { quoted: msg }
        );
      }

      const metadata = await sock.groupMetadata(jid);
      const participants = metadata.participants;

      const senderData = participants.find(
        p => p.id === sender
      );

      const targetData = participants.find(
        p => p.id === mentioned
      );

      const isSenderAdmin =
        isAdmin(senderData) ||
        metadata.owner === sender;

      if (!isSenderAdmin) {
        return sock.sendMessage(
          jid,
          {
            text: "💀 Hipnos nega seu poder... apenas administradores podem impor silêncio."
          },
          { quoted: msg }
        );
      }

      if (mentioned === sender) {
        return sock.sendMessage(
          jid,
          {
            text: "🌑 Nem mesmo Hipnos permite que um mortal silencie a si mesmo..."
          },
          { quoted: msg }
        );
      }

      const isTargetAdmin = isAdmin(targetData);

      if (isTargetAdmin) {
        return sock.sendMessage(
          jid,
          {
            text: "❌ Não é possível silenciar outro administrador."
          },
          { quoted: msg }
        );
      }

      mutedUsers.set(mentioned, true);

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
            `🌑🔇 JULGAMENTO DE HIPNOS

☠️ O silêncio foi imposto...

👤 @${mentioned.split("@")[0]} foi MUTEADO

💀 "Agora suas palavras serão engolidas pelo vazio do sono eterno."`,
          mentions: [mentioned]
        },
        { quoted: msg }
      );

    } catch (err) {
      console.log("Erro no mute:", err);

      await sock.sendMessage(jid, {
        text: "💀 O silêncio falhou ao ser imposto..."
      });
    }
  }
};