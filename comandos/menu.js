const { RODAPE_MENU } = require('../config')

module.exports = {
  nome: "menu",

  async executar(sock, jid, msg) {
    try {
      await sock.sendMessage(jid, {
        text: `
╔══════════════════════════════╗
║       🌙 𝐇𝐈𝐏𝐍𝐎𝐒 𝐁𝐎𝐓 🌙       ║
║     💀 𝐃𝐄𝐔𝐒 𝐃𝐎 𝐒𝐎𝐍𝐎 💀     ║
╚══════════════════════════════╝

🌑 Bem-vindo ao domínio de Hipnos.

"Aqueles que perturbam o sono
enfrentam o julgamento das sombras."

════════════════════

📜 COMANDOS GERAIS

🏓 /ping
➥ Mede a pulsação do bot.

ℹ️ /info
➥ Mostra a identidade do bot: versão, comandos disponíveis, tempo online e grupos.

📖 /menu
➥ Exibe este pergaminho.

🏆 /ranking
➥ Mostra os 10 membros mais ativos do grupo (mais mensagens enviadas).

👤 /perfil
➥ Mostra o perfil do autor (ou de um @mencionado): foto, número, cargo e posição no ranking do grupo.

👁️‍🗨️ /revelar
➥ Revela fotos/vídeos de visualização única (Responda à mídia).

🎵 /play <nome da música>
➥ Pesquisa e baixa o áudio do YouTube direto no chat.

════════════════════

🌤️ UTILITÁRIOS

🌤️ /clima <cidade>
➥ Consulta a carta do clima: temperatura, sensação térmica, condição e umidade (ex: /clima Campinas).

🎵 /tomp3 (responda a um vídeo/áudio)
➥ Extrai o som da mídia citada e envia de volta como MP3.

📜 /transcrever (responda a um áudio/vídeo)
➥ Transcreve o que é dito na mídia citada (áudio/vídeo) para texto.

🧰 /menu-utilitario
➥ Abre o pergaminho das ferramentas do dia a dia.

════════════════════

🔮 MENU STICKER (FIGURINHAS)

🔮 /s
➥ Transforma imagens em figurinhas.

🎨 /attp <texto>
➥ Gera uma figurinha ANIMADA com o texto que você enviar (ex: /attp Oi mundo).

🎨 /attp <texto>
➥ Cria uma figurinha ANIMADA com o texto pulsando e girando (ex: /attp Oi mundo).

🖼️ /toimg
➥ Converte figurinha estática em imagem comum (Responda ao sticker).

🏷️ /renomear [Pacote] | [Autor]
➥ Altera os metadados de um sticker (Responda ao sticker).

🎞️ /togif
➥ Transforma figurinha animada em GIF em loop (Responda ao sticker).

🎬 /tomp4
➥ Transforma figurinha animada em vídeo MP4 comum (Responda ao sticker).

════════════════════

🎲 BRINCADEIRAS

🎲 /menu-brincadeiras (ou /brincadeira)
➥ Abre o pergaminho das brincadeiras e oráculos do sono.

════════════════════

👑 ADMINISTRAÇÃO

👑 /menu-admin
➥ Abre o arsenal de moderação: gestão de membros, blacklist e guardiões do limbo.

════════════════════

👑 MENU DONO (SÓ DONO)

👑 /menu-dono
➥ Abre o pergaminho dos soberanos: /dono, /seradm e /soadm.

════════════════════

💠 MEMBROS VIP (SÓ DONO)

💠 /menu-vip
➥ Abre o pergaminho dos privilegiados: /darvip (outorgar dias de VIP) e /servip (listar VIPs ativos).

════════════════════

💀 FRASES DE HIPNOS

"O sono alcança todos."
"As sombras nunca dormem."
"O silêncio é inevitável."

════════════════════

${RODAPE_MENU}
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o menu:", err);
    }
  }
};