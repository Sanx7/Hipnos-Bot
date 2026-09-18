// ============================================
// 🎭 MENU-EFEITOS — Grimório dos Efeitos de Imagem
// ============================================
// Lista TODOS os comandos de efeito de imagem do bot
// (comandos/menu-fig/efeitos-imagem.js), seguindo o mesmo estilo
// visual do /menu principal e dos demais submenus.
// Consultar este menu é livre — igual ao /menu geral.
//
// Aliases: /menu-efeito e /efeitos (consultar este menu é livre).
// ⚠️ /sfundo NÃO aparece aqui: remoção de fundo depende de serviço
//    pago/com key (ex.: remove.bg) que ainda não foi escolhido.
// ============================================

const { RODAPE_MENU } = require('../../config')

module.exports = {
  nome: 'menu-efeitos',
  aliases: ['menu-efeito', 'efeitos'],
  descricao: 'Abre o grimório dos efeitos de imagem: pares, overlays e filtros para a foto de perfil.',

  async executar(sock, jid, msg) {
    try {
      await sock.sendMessage(jid, {
        text: `
╔══════════════════════════════╗
║     🎭 𝐌𝐄𝐍𝐔 𝐄𝐅𝐄𝐈𝐓𝐎𝐒 🎭     ║
╚══════════════════════════════╝

🎭 O grimório dos efeitos de imagem do sono.
(Beijos, ships, overlays e filtros sobre a foto de perfil.)
(Comandos liberados para todos os mortais.)
(também: /menu-efeito e /efeitos).

════════════════════

💞 PARES & SHIP

💋 /kiss @fulano
➥ Manda um beijo juntando a sua foto com a de quem você mencionar (ou responder).

💌 /kissme
➥ Beijo sem precisar de @: usa a foto de quem você respondeu — ou a sua própria.

💘 /ship @fulano
➥ Mede a compatibilidade entre você e a pessoa, com a % estampada na imagem.

🎲 /shipme
➥ Sorteia um membro aleatório do grupo e revela a % de compatibilidade com você.

════════════════════

🎭 OVERLAYS

⛓️ /jail @fulano
➥ Coloca a foto atrás das grades da prisão.

😤 /triggered @fulano
➥ Meme "TRIGGERED" sobre a foto.

☠️ /wasted @fulano
➥ Overlay "WASTED" estilo GTA sobre a foto.

🌈 /gay @fulano
➥ Overlay arco-íris sobre a foto.

🪞 /glass @fulano
➥ Efeito de vidro estilhaçado sobre a foto.

☭ /comrade @fulano
➥ Pôster soviético com a foto.

════════════════════

🎛️ FILTROS

⭕ /circulo @fulano
➥ Recorta a foto em formato circular.

🌫️ /blur @fulano
➥ Desfoca a foto.

🖤 /greyscale @fulano (ou /grayscale)
➥ Foto em preto e branco — os dois nomes abrem o mesmo efeito.

📜 /sepia @fulano
➥ Foto com tom sépia vintage.

🔁 /invert @fulano
➥ Inverte as cores da foto.

🤡 /clown @fulano
➥ Aplica maquiagem de palhaço na foto.

════════════════════

📌 DICA DO LIMBO

Sem @, o efeito usa a foto de quem você responder —
ou a sua própria. Conta sem foto de perfil visível
não tem efeito (a sombra recusa).

════════════════════

💀 FRASES DE HIPNOS

"O sono alcança todos."
"As sombras nunca dormem."

════════════════════

${RODAPE_MENU}
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o menu de efeitos:", err);
    }
  }
};
