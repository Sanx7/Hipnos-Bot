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

 🌙 /novidades [tudo|número]
 ➥ Mostra o que mudou recentemente no bot (também: /changelog e /atualizacoes). Ex.: /novidades 5.

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

🧰 /menu-utilitario
➥ Abre o pergaminho das ferramentas do dia a dia.

🏠 /cep <cep>
➥ Consulta o endereço de um CEP: rua, bairro, cidade, estado e coordenadas (ex: /cep 01310-100).

════════════════════

🔮 MENU STICKER (FIGURINHAS)

🔮 /menu-figurinhas (ou /menu-sticker)
➥ Abre o ateliê das figurinhas: criação, texto animado e conversões.
(também: /menu-fig).

════════════════════

🎭 EFEITOS DE IMAGEM

🎭 /menu-efeitos (ou /efeitos)
➥ Abre o grimório dos efeitos: beijos, ships, overlays e filtros para a foto de perfil.
(também: /menu-efeito).

════════════════════

🎲 BRINCADEIRAS

🎲 /menu-brincadeiras (ou /brincadeira)
➥ Abre o pergaminho das brincadeiras, oráculos e ações animadas do sono.

🍀 /sorte
➥ Revela seu nível de sorte de hoje (0-100%) — o mesmo veredito o dia inteiro.

🏳️‍🌈 /gay (@pessoa)
➥ Mede quantos % de gay alguém está hoje (sem menção, mede você mesmo).

🧠 /qi (@pessoa)
➥ Revela o QI (40-200) de alguém — zoeira, normalidade ou gênio.

🪞 /parecido @pessoa
➥ Mede a parecença (0-100%) entre você e a pessoa marcada.

💘 /crush
➥ Sorteia (1x por dia) qual membro do grupo é o seu crush secreto.

✨ /elogio (@pessoa)
➥ Enche alguém de elogios absurdamente exagerados (sem menção, elogia você mesmo).

💭 /frase
➥ Sopro motivacional do oráculo: uma frase aleatória, traduzida pro português.

════════════════════

👑 ADMINISTRAÇÃO

👑 /menu-admin
➥ Abre o arsenal de moderação: gestão de membros, blacklist e guardiões do limbo.

════════════════════

👑 MENU DONO (SÓ DONO)

👑 /menu-dono
➥ Abre o pergaminho dos soberanos: /dono, /seradm e /soadm.

🤖 /ia-interativa (1/0)
➥ Liga/desliga a IA conversacional deste grupo (só dono). Sem argumento, mostra o estado atual.

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