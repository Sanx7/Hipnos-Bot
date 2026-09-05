// ============================================
// 🌐 REDES — Redes sociais do criador (uso LIVRE)
// ============================================
// Mostra os perfis do criador do bot. QUALQUER PESSOA pode chamar /redes:
// não há checagem de OWNER_NUMBERS nem de admin aqui DE PROPÓSITO.
// A entrada aparece no /menu-dono (ao lado dos comandos do criador),
// com a nota de que o uso é livre.
// O rodapé vem de RODAPE_MENU (config.js) — fonte única da assinatura.
// ============================================

const { RODAPE_MENU } = require('../../config')

module.exports = {
  nome: 'redes',
  descricao: 'Mostra as redes sociais do criador do bot (Instagram e TikTok) — uso livre.',

  async executar(sock, jid, msg) {
    try {
      await sock.sendMessage(jid, {
        text: `
╔══════════════════════════════╗
║    🌐 𝐑𝐄𝐃𝐄𝐒 𝐃𝐎 𝐂𝐑𝐈𝐀𝐃𝐎𝐑 🌐    ║
╚══════════════════════════════╝

🔮 Siga o criador de Hipnos nos reinos de fora:

📷 Instagram: @edu_013k
🎵 TikTok: @edu_sccp7x

(Uso livre — qualquer mortal pode consultar este pergaminho.)

════════════════════

${RODAPE_MENU}
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o redes:", err);
    }
  }
};