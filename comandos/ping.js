module.exports = {
  nome: "ping",

  async executar(sock, jid) {
    await sock.sendMessage(jid, {
      text: "🏓 Pong! Hipnos Bot Online."
    })
  }
}