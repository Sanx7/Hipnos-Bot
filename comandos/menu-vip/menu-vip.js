// ============================================
// 💠 MENU-VIP — Pergaminho dos Privilegiados
// ============================================
// Lista SOMENTE os comandos do sistema de VIP (hoje: /darvip e /servip),
// seguindo o mesmo estilo visual do /menu principal.
// Os comandos em si são exclusivos dos DONOS do bot (OWNER_NUMBERS),
// mas consultar este menu é livre — igual ao /menu geral.
// ============================================

const { RODAPE_MENU } = require('../../config')

module.exports = {
  nome: "menu-vip",

  async executar(sock, jid, msg) {
    try {
      await sock.sendMessage(jid, {
        text: `
╔══════════════════════════════╗
║      💠 𝐌𝐄𝐍𝐔 𝐕𝐈𝐏 💠      ║
╚══════════════════════════════╝

💠 O salão dos privilegiados do sono.
(Comandos exclusivos dos DONOS do bot.)

════════════════════

👑 /darvip @membro [dias]
➥ Outorga dias de VIP a um mortal (ex: /darvip @membro 30).
➥ Aceita também número digitado: /darvip 5511999999999 30.
➥ Se o membro já for VIP ativo, os dias são SOMADOS à expiração atual.

📜 /servip
➥ Lista os VIPs ativos e suas expirações, da mais próxima para a mais distante.
➥ VIPs vencidos são varridos do livro automaticamente.

════════════════════

💀 FRASES DE HIPNOS

"Todo privilégio sonha com o seu fim."
"Os coroados descansam mais fundo."

════════════════════

${RODAPE_MENU}
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o menu-vip:", err);
    }
  }
};