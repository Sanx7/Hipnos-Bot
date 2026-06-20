module.exports = {
  nome: "abrir",

  async executar(sock, jid) {
    try {
      await sock.groupSettingUpdate(
        jid,
        "not_announcement"
      )

      await sock.sendMessage(jid, {
        text: "🔓 Grupo aberto com sucesso!"
      })
    } catch {
      await sock.sendMessage(jid, {
        text: "❌ Preciso ser administrador do grupo."
      })
    }
  }
}