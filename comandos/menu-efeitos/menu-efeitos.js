// ============================================
// 🎭 MENU-EFEITOS — Grimório dos Efeitos de Imagem
// ============================================
// Lista TODOS os comandos de efeito de imagem do bot
// (comandos/menu-efeitos/efeitos-imagem.js), seguindo o mesmo estilo
// visual do /menu principal e dos demais submenus.
// Consultar este menu é livre — igual ao /menu geral.
//
// Aliases: /menuefeitos, /menu-efeito e /efeitos (consultar é livre).
// ⚠️ /sfundo NÃO é efeito de imagem: remoção de fundo depende de serviço
//    pago, com chave (ex.: remove.bg) que ainda não foi escolhido.
// 📌 Escopo: só os EFEITOS sobre a foto de perfil (efeitos-imagem.js, na
//    pasta commands/menu-efeitos/). Conversões de figurinha e mídia (attp,
//    brat, figurinha, togif, toimg, tomp4, renomear) ficam no
//    /menu-figurinhas.
// ============================================

const { RODAPE_MENU } = require('../../config')

module.exports = {
  nome: 'menu-efeitos',
  aliases: ['menuefeitos', 'menu-efeito', 'efeitos'],
  descricao: 'Abre o grimório dos efeitos de imagem: pares, memes, overlays e filtros para a foto de perfil.',

  async executar(sock, jid, msg) {
    try {
      await sock.sendMessage(jid, {
        text: `
╔══════════════════════════════╗
║     🎭 𝐌𝐄𝐍𝐔 𝐄𝐅𝐄𝐈𝐓𝐎𝐒 🎭     ║
╚══════════════════════════════╝

🎭 O grimório dos efeitos de imagem do sono.
(Beijos, ships, memes, overlays e filtros sobre a foto de perfil.)
(Comandos liberados para todos os mortais.)
(também: /menuefeitos, /menu-efeito e /efeitos).

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

⛓️ /jail @fulano (também: /cadeia)
➥ Coloca a foto atrás das grades da prisão.

😤 /triggered @fulano
➥ Meme "TRIGGERED" sobre a foto.

☠️ /wasted @fulano
➥ Overlay "WASTED" estilo GTA sobre a foto.

🍃 /passed @fulano
➥ Overlay "PASSED" sobre a foto.

🌈 /gay @fulano
➥ Overlay arco-íris sobre a foto.

🪞 /glass @fulano
➥ Efeito de vidro estilhaçado sobre a foto.

☭ /comrade @fulano
➥ Pôster soviético com a foto.

════════════════════

💥 MEMES (gerados no próprio bot, sem depender de API)

💢 /slap @fulano
➥ Tapa estilizada juntando a sua foto com a de quem você mencionar.

🍑 /spank @fulano
➥ Aplica um spank na foto (a sua, ou a de quem você mencionar).

🦇 /batslap @fulano
➥ Meme "BATS LAP" sobre a foto.

🥹 /beautiful @fulano
➥ Meme "tão bonito(a) que até chorei" com a foto.

🎨 /bobross @fulano
➥ Coloca a foto dentro de uma pintura emoldurada estilo Bob Ross.

📢 /ad @fulano
➥ Transforma a foto num outdoor de propaganda.

🗑️ /apagar @fulano (também: /deletar)
➥ Gera o meme "esta mensagem foi apagada" com a foto.

════════════════════

🎛️ FILTROS

⭕ /circulo @fulano
➥ Recorta a foto em formato circular.

🌫️ /blur @fulano
➥ Desfoca a foto.

🖤 /greyscale @fulano (também: /gray, /grayscale)
➥ Foto em preto e branco — todos os nomes abrem o mesmo efeito.

📜 /sepia @fulano
➥ Foto com tom sépia vintage.

🔁 /invert @fulano (também: /inverter)
➥ Inverte as cores da foto.

💜 /heart @fulano
➥ Coloca a foto dentro de um coração.

🤡 /clown @fulano
➥ Aplica maquiagem de palhaço na foto (feito no próprio bot).

🎚️ /contraste @fulano (também: /contrast)
➥ Aumenta o contraste da foto (feito no próprio bot, sem API).

🪞 /espelhar @fulano (também: /espelho)
➥ Espelha a foto horizontalmente (feito no próprio bot).

🟪 /pixel @fulano (também: /pixelate)
➥ Pixeliza a foto em blocos (feito no próprio bot).

════════════════════

🪦 MEME DE LÁPIDE

🪦 /rip @fulano (também: /lápide)
➥ Coloca a foto numa lápide com "RIP" (desenhada pelo próprio bot).

════════════════════

🔉 MODIFICADOR DE VOZ

Responda a uma nota de voz ou audio com o efeito:

🐿️ /esquilo
➥ Voz aguda e rápida (responda a um áudio).

🦣 /gigante
➥ Voz grave e lenta (responda a um áudio).

🤖 /robo
➥ Voz robótica metálica (responda a um áudio).

😈 /demonio
➥ Voz grave com eco sombrio (responda a um áudio).

⏩ /rapido
➥ Acelera sem mudar o tom (responda a um áudio).

⏪ /lento
➥ Desacelera sem mudar o tom (responda a um áudio).

🔁 /reverso
➥ Toca o áudio de trás para frente (responda a um áudio).

📢 /estourar
➥ Áudio estourado, caixa de som no talo (responda a um áudio).

════════════════════

🚧 INDISPONÍVEIS (dependiam da Some Random API)

🚧 /bolsonaro
➥ Template do meme saiu da API — não tentamos desenhar um improviso.

🚧 /sfundo
➥ Remoção de fundo exige serviço pago, com chave (ex.: remove.bg), ainda sem provedor.

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
