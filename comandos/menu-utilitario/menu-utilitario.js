// ============================================
// 🧰 MENU-UTILITARIO — Pergaminho das Ferramentas
// ============================================
// Lista TODOS os comandos utilitários do bot (comandos/menu-utilitario/),
// seguindo o mesmo estilo visual do /menu principal e do /menu-brincadeiras.
// Consultar este menu é livre — igual ao /menu geral.
// ============================================

const { RODAPE_MENU } = require('../../config')

module.exports = {
  nome: 'menu-utilitario',
  descricao: 'Abre o pergaminho das ferramentas: clima e utilidades do dia a dia.',

  async executar(sock, jid, msg) {
    try {
      await sock.sendMessage(jid, {
        text: `
╔══════════════════════════════╗
║    🧰 𝐌𝐄𝐍𝐔 𝐔𝐓𝐈𝐋𝐈𝐓𝐀𝐑𝐈𝐎 🧰    ║
╚══════════════════════════════╝

🧰 O armário das ferramentas do dia a dia.
(Comandos liberados para todos os mortais.)

════════════════════

🌤️ CLIMA & LOCALIZAÇÃO

🌤️ /clima <cidade>
➥ Consulta a carta do clima da cidade: temperatura, sensação térmica, condição do tempo e umidade (ex: /clima Campinas).

🎵 /tomp3 (responda a um vídeo/áudio)
➥ Extrai o som da mídia citada e envia de volta como MP3.

📜 /transcrever (responda a um áudio/vídeo)
➥ Escreve o que é dito na mídia citada — transcrição em texto (Groq Whisper).

════════════════════

${RODAPE_MENU}
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o menu-utilitario:", err);
    }
  }
};
