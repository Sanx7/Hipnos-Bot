// ============================================
// 🎭 AÇÕES — Módulo de interação animada (waifu.pics)
// ============================================
// Cada comando exige menção a um usuário (@user) e busca um GIF
// na API waifu.pics (sem key) da categoria correspondente.
//
// API: https://api.waifu.pics/sfw/{categoria}
// Retorno: { url: "https://i.waifu.pics/xxxx.gif" }
//
// 🔒 Padrão do bot:
//   - axios SEMPRE com timeout (10s) — API fora do ar não prende o bot
//   - ffmpeg como processo filho se precisar de thumbnail (nunca sharp in-process)
//   - try/catch com mensagem amigável em português — a conexão NÃO cai
//   - JID do mencionado vem de contextInfo.mentionedJid[0]
// ============================================

const axios = require('axios');

// ⏳ Timeout das requisições (ms) — API fora do ar não prende o comando
const TIMEOUT_AXIOS_MS = 10000;

// ─── 🎭 Função genérica reutilizável ───
async function enviarAcao(sock, from, quemEnviou, mencionado, categoria, emoji, textoAcao) {
  try {
    console.log(`[acoes] 🎭 ${categoria} — buscando GIF na waifu.pics...`);

    const resposta = await axios.get(`https://api.waifu.pics/sfw/${categoria}`, {
      timeout: TIMEOUT_AXIOS_MS
    });

    const urlGif = resposta?.data?.url;
    if (!urlGif) {
      throw new Error('waifu.pics não retornou URL do GIF');
    }

    console.log(`[acoes] 📥 GIF encontrado: ${urlGif}`);

    const gif = await axios.get(urlGif, {
      responseType: 'arraybuffer',
      timeout: TIMEOUT_AXIOS_MS
    });

    const buffer = Buffer.from(gif.data);
    if (!buffer || buffer.length === 0) {
      throw new Error('GIF baixado veio vazio');
    }

    console.log(`[acoes] ⬇️ GIF baixado: ${buffer.length} bytes`);

    const numeroEnviou = String(quemEnviou || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    const numeroMencionado = String(mencionado || '').split('@')[0].split(':')[0].replace(/\D/g, '');

    const caption = `${emoji} @${numeroEnviou} deu um(a) ${textoAcao} em @${numeroMencionado}`;

    await sock.sendMessage(from, {
      video: buffer,
      gifPlayback: true,
      caption: caption,
      mentions: [mencionado, quemEnviou]
    });

    console.log(`[acoes] ✅ ${categoria} enviado com sucesso`);

  } catch (err) {
    console.error(`[acoes] 💥 erro em ${categoria}:`, err?.message || err);

    const foiTimeout = err?.code === 'ECONNABORTED' || err?.message?.includes('timeout');
    const textoErro = foiTimeout
      ? `⏳ A API do waifu.pics demorou demais para responder... Tente novamente em instantes.`
      : `❌ Não consegui completar a ação... O feitiço falhou, mas Hipnos segue de pé. Tente novamente em instantes.`;

    await sock.sendMessage(from, {
      text: textoErro
    }).catch(() => {});
  }
}

// ─── 📨 Handler padrão para todos os comandos de ação ───
function criarHandler(categoria, emoji, textoAcao) {
  return async function executar(sock, jid, msg) {
    try {
      const quemEnviou = msg.key?.participant || msg.key?.remoteJid;
      const mencionado = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

      if (!mencionado) {
        return await sock.sendMessage(jid, {
          text: '❌ Você precisa mencionar alguém para esta ação!\n\n💡 Exemplo: `/tapa @usuario` — marque um membro do grupo.'
        }, { quoted: msg });
      }

      await enviarAcao(sock, jid, quemEnviou, mencionado, categoria, emoji, textoAcao);

    } catch (err) {
      console.error(`[acoes] 💥 erro no handler de ${categoria}:`, err?.stack || err);
      await sock.sendMessage(jid, {
        text: '❌ Não consegui completar a ação... O feitiço falhou, mas Hipnos segue de pé. Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {});
    }
  };
}

// ─── 📋 Lista de comandos de ação ───
const ACOES = [
  { nome: 'tapa',      descricao: 'Dá um tapa em alguém (marque @usuario).',     categoria: 'slap',   emoji: '👋', textoAcao: 'tapa' },
  { nome: 'beijo',     descricao: 'Dá um beijo em alguém (marque @usuario).',    categoria: 'kiss',   emoji: '💋', textoAcao: 'beijo' },
  { nome: 'abraço',    descricao: 'Dá um abraço em alguém (marque @usuario).',   categoria: 'hug',    emoji: '🤗', textoAcao: 'abraço' },
  { nome: 'soco',      descricao: 'Dá um soco em alguém (marque @usuario).',     categoria: 'punch',  emoji: '👊', textoAcao: 'soco' },
  { nome: 'chute',     descricao: 'Dá um chute em alguém (marque @usuario).',    categoria: 'kick',   emoji: '🦶', textoAcao: 'chute' },
  { nome: 'carinho',   descricao: 'Faz carinho em alguém (marque @usuario).',    categoria: 'pat',    emoji: '🫳', textoAcao: 'carinho' },
  { nome: 'mordida',   descricao: 'Dá uma mordida em alguém (marque @usuario).', categoria: 'bite',   emoji: '🦷', textoAcao: 'mordida' },
  { nome: 'cutucada',  descricao: 'Cutuca alguém (marque @usuario).',            categoria: 'poke',   emoji: '👉', textoAcao: 'cutucada' },
  { nome: 'aconchego', descricao: 'Aconchega alguém (marque @usuario).',         categoria: 'cuddle', emoji: '🫂', textoAcao: 'aconchego' },
  { nome: 'comer',     descricao: 'Come alguém (marque @usuario).',              categoria: 'nom',    emoji: '😋', textoAcao: 'mordida gostosa' },
];

module.exports = ACOES.map(acao => ({
  nome: acao.nome,
  descricao: acao.descricao,
  executar: criarHandler(acao.categoria, acao.emoji, acao.textoAcao)
}));
