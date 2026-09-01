function isAdmin(p) {
  return p?.admin === "admin" || p?.admin === "superadmin";
}

module.exports = {
  nome: "fechar",

  async executar(sock, jid, msg) {
    try {
      // Só administradores ou o dono do grupo podem fechar
      const sender = msg.key.participant || msg.key.remoteJid;
      const metadados = await sock.groupMetadata(jid);
      const dadosSender = metadados.participants.find(p => p.id === sender);
      const ehAdmin = isAdmin(dadosSender) || metadados.owner === sender;

      if (!ehAdmin) {
        return await sock.sendMessage(jid, {
          text: "❌ Apenas administradores podem usar este comando."
        }, { quoted: msg });
      }

      await sock.groupSettingUpdate(
        jid,
        "announcement"
      )

      await sock.sendMessage(jid, {
        text: "🔒 Grupo fechado com sucesso!"
      })
    } catch (err) {
      console.error("Erro no comando fechar:", err);
      await sock.sendMessage(jid, {
        text: "❌ Preciso ser administrador do grupo."
      })
    }
  }
}