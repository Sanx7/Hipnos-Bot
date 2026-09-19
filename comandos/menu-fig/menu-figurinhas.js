// ============================================
// 🔮 MENU-FIGURINHAS — Pergaminho das Figurinhas
// ============================================
// Lista TODOS os comandos de figurinhas do bot (comandos/menu-fig/ e
// comandos/menu-fig/brat.js, ttp.js e fake-chat.js),
// seguindo o mesmo estilo visual do /menu principal e dos demais submenus.
// Consultar este menu é livre — igual ao /menu geral.
//
// Aliases: /menu-sticker e /menu-fig (consultar este menu é livre).
// Dica: digite /menu-fig ou /menu-sticker — todos abrem este pergaminho.
// ============================================

const { RODAPE_MENU } = require('../../config')

module.exports = {
  nome: 'menu-figurinhas',
  aliases: ['menu-sticker', 'menu-fig'],
  descricao: 'Abre o pergaminho das figurinhas: criação, texto animado e conversões.',

  async executar(sock, jid, msg) {
    try {
      await sock.sendMessage(jid, {
        text: `
╔══════════════════════════════╗
║     🔮 𝐌𝐄𝐍𝐔 𝐅𝐈𝐆𝐔𝐑𝐈𝐍𝐇𝐀𝐒 🔮     ║
╚══════════════════════════════╝

🔮 O ateliê das figurinhas do sono.
(Comandos liberados para todos os mortais.)
(também: /menu-sticker e /menu-fig).

════════════════════

✂️ CRIAR

🔮 /s
➥ Transforma imagens em figurinhas.

🎨 /attp <texto>
➥ Gera uma figurinha ANIMADA com o texto que você enviar (ex: /attp Oi mundo).

🟩 /brat <texto>
➥ Gera a capa estilo "Brat" (álbum da Charli XCX) com o seu texto em figurinha (ex: /brat hipnos bot).

🟩 /bratvid <texto>
➥ A mesma capa "Brat", mas ANIMADA: as palavras aparecem aos poucos (ex: /bratvid oi mundo).

🖼️ /ttp <texto>
➥ Gera uma figurinha estilo "citação" com o texto que você enviar (ex: /ttp o sono alcança todos).

💬 /fake-chat <mensagem>
➥ Gera um print falso de conversa estilo WhatsApp (ex: /fake-chat Ana | oi, sumido!).

════════════════════

🔄 CONVERTER

🖼️ /toimg
➥ Converte figurinha estática em imagem comum (Responda ao sticker).

🏷️ /renomear [Pacote] | [Autor]
➥ Altera os metadados de um sticker (Responda ao sticker).

🎞️ /togif
➥ Transforma figurinha animada em GIF em loop (Responda ao sticker).

🎬 /tomp4
➥ Transforma figurinha animada em vídeo MP4 comum (Responda ao sticker).

════════════════════

💀 FRASES DE HIPNOS

"O sono alcança todos."
"As sombras nunca dormem."

════════════════════

${RODAPE_MENU}
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o menu-figurinhas:", err);
    }
  }
};