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

 💡 /sugestao <texto>
 ➥ Envia uma ideia de melhoria direto aos donos do bot (ex: /sugestao criar comando de lembretes).

 ⭐ /avaliar <1-5>
 ➥ Avalie o bot com uma nota de 1 a 5 (ex: /avaliar 5). Veja a média com /mediaavaliacoes.

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

🔮 /horoscopo <signo>
➥ Leitura do dia do Limbo para o seu signo — a mesma para todos no mesmo dia (ex: /horoscopo leao).

🎤 /letra <artista> - <musica>
➥ Busca a letra de uma música (ex: /letra Coldplay - Yellow).

😂 /meme
➥ Puxa um meme aleatório do Reddit com o título original (imagem, GIF ou vídeo).

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
➥ Abre o pergaminho das brincadeiras, oráculos e ações animadas do sono.

🎭 /tapa, /beijo, /abraço, /soco, /chute, /carinho, /mordida, /cutucada, /aconchego, /comer
➥ Ações animadas com GIFs — responda a mensagem da pessoa (reply) ou mencione com @usuario.

🔠 /anagrama [categoria]
➥ Descubra a palavra secreta letra por letra (um jogo por grupo; ex: /anagrama animais).

🎨 /gartic [categoria]
➥ Adivinhe a palavra pela imagem (Pixabay) — 3 min por rodada, um jogo por grupo (ex: /gartic animais).

🐱 /gatofato
➥ Solta um fato aleatório sobre gatos, traduzido pro português.

🔢 /curiosidadenumero [número]
➥ Revela a curiosidade de um número — sem número, a sorte escolhe entre 1 e 1000 (ex: /curiosidadenumero 73).

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
➥ Abre o pergaminho dos privilegiados: /darvip (outorgar dias de VIP) e /listavip (listar VIPs ativos).

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