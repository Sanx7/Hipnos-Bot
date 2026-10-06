// ============================================
// 📥 MENU-DOWNLOAD — Pergaminho dos Downloads
// ============================================
// Lista os comandos de download do bot (comandos/menu-download/):
// /play (YouTube via Bronxys), /tiktok + /tiktok-audio (via toby),
// /pinterest (via btch) e a leva extra (/insta, /igmp3, /twitter,
// /facebook, /robloxstalk, /videorapido, /videolento, /videocontrario).
// Consultar este menu é livre — igual aos demais submenus.
//
// Aliases: /menudownload, /menu-downloads e /downloads.
// ============================================

const { RODAPE_MENU } = require('../../config')

module.exports = {
  nome: 'menu-download',
  aliases: ['menudownload', 'menu-downloads', 'downloads'],
  descricao: 'Abre o pergaminho dos downloads: músicas, vídeos de redes sociais, perfil do Roblox e velocidade de vídeo.',

  async executar(sock, jid, msg) {
    try {
      await sock.sendMessage(jid, {
        text: `
╔══════════════════════════════╗
║     📥 𝐌𝐄𝐍𝐔 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 📥     ║
╚══════════════════════════════╝

📥 A forja dos downloads do sono.
(também: /menudownload, /menu-downloads e /downloads).

════════════════════

🎵 MÚSICA & VÍDEOS CURTOS

🎵 /play <nome da música>
➥ Pesquisa e baixa o áudio do YouTube direto no chat.

🎬 /tiktok <link> (também: /tt, /tk, /tik-tok)
➥ Baixa vídeo do TikTok sem marca d'água (até 50 MB).

🎵 /tiktok-audio <link>
➥ Só o áudio (MP3) do vídeo do TikTok.

📌 /pinterest <link> (também: /pin)
➥ Baixa imagem ou vídeo de um pin (até 50 MB).

════════════════════

📸 REDES SOCIAIS (melhor esforço*)

📸 /insta <link> (também: /instagram, /igdl)
➥ Foto, vídeo ou reel público do Instagram (até 50 MB).

🎵 /igmp3 <link>
➥ Só o áudio (MP3) do vídeo/reel do Instagram.

🐦 /twitter <link> (também: /x)
➥ Vídeo/gif público do Twitter/X (até 50 MB).

📘 /facebook <link> (também: /fb)
➥ Vídeo público do Facebook (até 50 MB).

(*) Instagram, X e Facebook passam por serviços terceiros
não-oficiais — podem falhar em servidor (IP de datacenter
bloqueado) mesmo funcionando no teste local. Se falhar, o
bot avisa em vez de travar.

════════════════════

🧱 ROBLOX (API oficial, sem risco)

🧱 /robloxstalk <nome> (também: /robloxinfo)
➥ Perfil público do Roblox: nome, ID, criação da conta e avatar.
➥ Ex.: /robloxstalk Builderman.

════════════════════

🎬 VELOCIDADE DE VÍDEO

Responda a um vídeo (máx. 60s) com o efeito:

⏩ /videorapido
➥ Acelera o vídeo em 2x (com áudio).

⏪ /videolento
➥ Desacelera para metade da velocidade (com áudio).

🔁 /videocontrario
➥ Toca o vídeo de trás para frente (com áudio).

════════════════════

💀 FRASES DE HIPNOS

"O sono alcança todos."
"As sombras nunca dormem."

════════════════════

${RODAPE_MENU}
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o menu de downloads:", err);
    }
  }
};
