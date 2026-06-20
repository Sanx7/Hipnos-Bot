module.exports = {
  nome: "fechar",

  async executar(sock, jid) {
    try {
      await sock.groupSettingUpdate(
        jid,
        "announcement"
      )

      await sock.sendMessage(jid, {
        text: "🔒 Grupo fechado com sucesso!"
      })
    } catch {
      await sock.sendMessage(jid, {
        text: "❌ Preciso ser administrador do grupo."
      })
    }
  }
}