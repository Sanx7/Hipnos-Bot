// ============================================
// 🎭 AÇÕES — Módulo de interação animada (waifu.pics + nekos.best)
// ============================================
// Cada comando exige menção a um usuário (@user) e busca um GIF
// na API waifu.pics (sem key) da categoria correspondente.
//
// API primária:  https://api.waifu.pics/sfw/{categoria}
// Retorno:       { url: "https://i.waifu.pics/xxxx.gif" }
//
// API fallback:  https://nekos.best/api/v2/{categoria}?amount=1
// Retorno:       { results: [{ url: "https://nekos.best/...gif" }] }
//
// 🔒 Padrão do bot:
//   - axios SEMPRE com timeout (10s) — API fora do ar não prende o bot
//   - retry automático: até 2 retries (3 tentativas) com delay de 500ms
//   - fallback pra nekos.best se waifu.pics falhar em todas as tentativas
//   - ffmpeg como processo filho se precisar de thumbnail (nunca sharp in-process)
//   - try/catch com mensagem amigável em português — a conexão NÃO cai
//   - JID do mencionado vem de contextInfo.mentionedJid[0]
// ============================================

const axios = require('axios');

// ⏳ Timeout das requisições (ms) — API fora do ar não prende o comando
const TIMEOUT_AXIOS_MS = 10000;

// 🔄 Configuração de retry
const MAX_TENTATIVAS = 3;        // 1 chamada inicial + 2 retries
const DELAY_ENTRE_TENTATIVAS = 500; // ms

// 🗺️ Mapeamento de categorias: waifu.pics → nekos.best
// Todas as categorias usadas possuem equivalente na nekos.best
const CATEGORIAS_NEKOS_BEST = {
  slap: 'slap',
  kiss: 'kiss',
  hug: 'hug',
  punch: 'punch',
  kick: 'kick',
  pat: 'pat',
  bite: 'bite',
  poke: 'poke',
  cuddle: 'cuddle',
  nom: 'nom',
};

// ─── ⏱️ Utilitário: delay sem bloquear o event loop ───
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── 🔍 Busca URL do GIF na waifu.pics com retry ───
async function buscarWaifuPics(categoria) {
  const urlApi = `https://api.waifu.pics/sfw/${categoria}`;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      console.log(`[acoes] 🔄 waifu.pics/${categoria} — tentativa ${tentativa}/${MAX_TENTATIVAS}`);

      const resposta = await axios.get(urlApi, {
        timeout: TIMEOUT_AXIOS_MS
      });

      const urlGif = resposta?.data?.url;
      if (!urlGif) {
        throw new Error('waifu.pics não retornou URL do GIF');
      }

      console.log(`[acoes] ✅ waifu.pics/${categoria} — sucesso na tentativa ${tentativa}`);
      return { url: urlGif, api: 'waifu.pics', tentativa };

    } catch (err) {
      console.warn(`[acoes] ⚠️ waifu.pics/${categoria} — tentativa ${tentativa} falhou: ${err?.message || err}`);

      if (tentativa < MAX_TENTATIVAS) {
        console.log(`[acoes] ⏳ aguardando ${DELAY_ENTRE_TENTATIVAS}ms antes da próxima tentativa...`);
        await delay(DELAY_ENTRE_TENTATIVAS);
      }
    }
  }

  return null; // todas as tentativas falharam
}

// ─── 🔍 Busca URL do GIF na nekos.best com retry ───
async function buscarNekosBest(categoria) {
  const categoriaNekos = CATEGORIAS_NEKOS_BEST[categoria];

  // Se não há equivalente na nekos.best, não tenta
  if (!categoriaNekos) {
    console.log(`[acoes] ℹ️ ${categoria} não possui equivalente na nekos.best — pulando fallback`);
    return null;
  }

  const urlApi = `https://nekos.best/api/v2/${categoriaNekos}?amount=1`;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      console.log(`[acoes] 🔄 nekos.best/${categoriaNekos} — tentativa ${tentativa}/${MAX_TENTATIVAS}`);

      const resposta = await axios.get(urlApi, {
        timeout: TIMEOUT_AXIOS_MS
      });

      // nekos.best retorna { results: [{ url: "..." }] }
      const urlGif = resposta?.data?.results?.[0]?.url;
      if (!urlGif) {
        throw new Error('nekos.best não retornou URL do GIF');
      }

      console.log(`[acoes] ✅ nekos.best/${categoriaNekos} — sucesso na tentativa ${tentativa}`);
      return { url: urlGif, api: 'nekos.best', tentativa };

    } catch (err) {
      console.warn(`[acoes] ⚠️ nekos.best/${categoriaNekos} — tentativa ${tentativa} falhou: ${err?.message || err}`);

      if (tentativa < MAX_TENTATIVAS) {
        console.log(`[acoes] ⏳ aguardando ${DELAY_ENTRE_TENTATIVAS}ms antes da próxima tentativa...`);
        await delay(DELAY_ENTRE_TENTATIVAS);
      }
    }
  }

  return null; // todas as tentativas falharam
}

// ─── 🎭 Função genérica reutilizável ───
async function enviarAcao(sock, from, quemEnviou, mencionado, categoria, emoji, textoAcao) {
  try {
    console.log(`[acoes] 🎭 ${categoria} — iniciando busca de GIF...`);

    // 1️⃣ Tenta waifu.pics (com retry interno)
    let resultado = await buscarWaifuPics(categoria);

    // 2️⃣ Se waifu.pics falhou, tenta nekos.best como fallback
    if (!resultado) {
      console.log(`[acoes] 🔄 waifu.pics falhou em todas as tentativas — acionando fallback nekos.best...`);
      resultado = await buscarNekosBest(categoria);
    }

    // 3️⃣ Se ambas falharam, retorna erro amigável
    if (!resultado) {
      console.error(`[acoes] 💥 ${categoria} — ambas as APIs falharam após ${MAX_TENTATIVAS} tentativas cada`);

      await sock.sendMessage(from, {
        text: `❌ Não consegui completar a ação... As APIs de GIFs estão indisponíveis no momento. Tente novamente em instantes.`
      }).catch(() => {});

      return;
    }

    const { url: urlGif, api, tentativa } = resultado;
    console.log(`[acoes] 📥 GIF encontrado via ${api} (tentativa ${tentativa}): ${urlGif}`);

    // 4️⃣ Baixa o GIF
    const gif = await axios.get(urlGif, {
      responseType: 'arraybuffer',
      timeout: TIMEOUT_AXIOS_MS
    });

    const buffer = Buffer.from(gif.data);
    if (!buffer || buffer.length === 0) {
      throw new Error('GIF baixado veio vazio');
    }

    console.log(`[acoes] ⬇️ GIF baixado: ${buffer.length} bytes`);

    // 5️⃣ Monta e envia a mensagem
    const numeroEnviou = String(quemEnviou || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    const numeroMencionado = String(mencionado || '').split('@')[0].split(':')[0].replace(/\D/g, '');

    const caption = `${emoji} @${numeroEnviou} deu um(a) ${textoAcao} em @${numeroMencionado}`;

    await sock.sendMessage(from, {
      video: buffer,
      gifPlayback: true,
      caption: caption,
      mentions: [mencionado, quemEnviou]
    });

    console.log(`[acoes] ✅ ${categoria} enviado com sucesso via ${api}`);

  } catch (err) {
    console.error(`[acoes] 💥 erro em ${categoria}:`, err?.message || err);

    const foiTimeout = err?.code === 'ECONNABORTED' || err?.message?.includes('timeout');
    const textoErro = foiTimeout
      ? `⏳ A API demorou demais para responder... Tente novamente em instantes.`
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
