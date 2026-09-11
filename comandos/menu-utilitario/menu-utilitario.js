// ============================================
// 🧰 MENU-UTILITARIO — Pergaminho das Ferramentas
// ============================================
// Lista TODOS os comandos utilitários do bot (comandos/menu-utilitario/ e
// comandos/utilitario/), seguindo o mesmo estilo visual do /menu principal.
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

🗺️ /ddd <ddd ou número>
➥ Revela o estado e as cidades de um DDD (também: /estado-ddd e /cidades-ddd). Ex.: /ddd 11 ou /ddd 11999998888.

🎵 /tomp3 (responda a um vídeo/áudio)
➥ Extrai o som da mídia citada e envia de volta como MP3.

🎵 /tiktok <link>
➥ Baixa e envia vídeos do TikTok sem marca d'água (também: /tt, /tk e /tiktokdl). Ex.: /tiktok https://vm.tiktok.com/XXXXXXX

📜 /transcrever (responda a um áudio/vídeo)
➥ Escreve o que é dito na mídia citada — transcrição em texto (Groq Whisper).

📊 /checkativo (@membro ou respondendo uma mensagem)
➥ Mostra quantas mensagens a pessoa ecoou no recinto (também: /mensagens, /msgs e /ativo).

════════════════════

🌌 ASTRONOMIA

🌌 /nasa
➥ Foto Astronômica do Dia (APOD) da NASA, com título e explicação traduzidos (também: /apod, /astronomia e /foto-nasa).

════════════════════

📚 CONHECIMENTO

📚 /wiki <termo>
➥ Busca o resumo de um artigo da Wikipédia em português (também: /wikipedia, /wikipredia e /pesquisar). Ex.: /wiki Buraco Negro

📖 /dicionario <palavra>
➥ Exibe a classe gramatical e os significados de uma palavra (também: /significado, /dicio e /definicao). Ex.: /dicionario efêmero

════════════════════

🤖 INTELIGÊNCIA ARTIFICIAL

🤖 /gpt <pergunta>
➥ Pergunte à mente do Limbo — respostas diretas e precisas (também: /chatgpt, /ia e /ask). Ex.: /gpt O que é a teoria da relatividade?

🔮 /gemini <pergunta>
➥ Consulte o oráculo do Limbo (também: /googleia e /bard). Ex.: /gemini Crie um poema sobre o sono

════════════════════

${RODAPE_MENU}
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o menu-utilitario:", err);
    }
  }
};