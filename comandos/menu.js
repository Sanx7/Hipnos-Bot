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

📖 /menu
➥ Exibe este pergaminho.

🏆 /ranking
➥ Mostra os 10 membros mais ativos do grupo (mais mensagens enviadas).

👁️‍🗨️ /revelar
➥ Revela fotos/vídeos de visualização única (Responda à mídia).

🎵 /play <nome da música>
➥ Pesquisa e baixa o áudio do YouTube direto no chat.

════════════════════

🔮 MENU STICKER (FIGURINHAS)

🔮 /s
➥ Transforma imagens em figurinhas.

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

🌙 Hipnos Bot v1.0.0
🔮 Criador: Sanx7 (+1 (438) 224-6600)
💤 Guardião Supremo dos Sonhos
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o menu:", err);
    }
  }
};