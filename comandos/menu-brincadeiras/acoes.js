// ============================================
// 🎭 AÇÕES — Módulo de interação animada (waifu.pics + nekos.best)
// ============================================
// Cada comando aceita 2 formas de escolher o alvo (nesta prioridade):
//   1) 📩 RESPONDER (reply/quote) uma mensagem da pessoa — o alvo é o
//      autor da mensagem citada (contextInfo.participant);
//   2) 👥 mencionar a pessoa (@usuario) — comportamento original
//      (contextInfo.mentionedJid[0]).
// Depois busca um GIF na API waifu.pics (sem key) da categoria correspondente.
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
//   - JID do alvo: autor da mensagem citada (contextInfo.participant) OU
//     1º mencionado (contextInfo.mentionedJid[0])
//   - GIF é convertido p/ MP4 (H.264) via ffmpeg em PROCESSO FILHO antes do
//     envio: GIF cru enviado como vídeo fica borrado e com o ícone "GIF"
//     travado no WhatsApp — em MP4 com gifPlayback: true anima liso (e o
//     thumbnail é gerado sem sharp/libvips, mesma proteção do /wiki e
//     /pinterest)
// ============================================

const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// 🛠️ Helpers compartilhados do projeto (caminho do ffmpeg + delete com
// retry p/ Windows) — mesma fonte usada pelo /pinterest e /tomp3
const { caminhoFfmpeg, apagarComRetry } = require('../menu-utilitario/audio-extrator');

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

// ─── 🎞️ Converte GIF → MP4 (H.264) via ffmpeg em PROCESSO FILHO ───
// O WhatsApp não reproduz GIF cru dentro de "video": fica borrado e com o
// ícone "GIF" travado. Convertendo p/ MP4 (yuv420p + faststart) e enviando
// com gifPlayback: true, o WhatsApp exibe e anima corretamente.
function converterGifParaMp4(caminhoInput, caminhoOutput) {
  return new Promise((resolver, rejeitar) => {
    const args = [
      '-y', '-nostdin',
      '-i', caminhoInput,
      '-movflags', '+faststart',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '26',
      '-an',
      caminhoOutput
    ];
    execFile(caminhoFfmpeg(), args, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }, (erro, stdout, stderr) => {
      if (erro) {
        erro.mensagemFfmpeg = (stderr || '').toString().split('\n').filter(Boolean).slice(-3).join(' ');
        return rejeitar(erro);
      }
      resolver();
    });
  });
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
async function enviarAcao(sock, from, msg, quemEnviou, mencionado, categoria, emoji, textoAcao) {
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

    // 5️⃣ Converte GIF → MP4: GIF cru enviado como vídeo é o que fazia a
    // animação sair borrada e com o ícone "GIF" travado no WhatsApp
    const idUnico = `${categoria}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const caminhoGif = path.join(os.tmpdir(), `acoes_${idUnico}.gif`);
    const caminhoMp4 = path.join(os.tmpdir(), `acoes_${idUnico}.mp4`);
    let bufferFinal = buffer;
    try {
      fs.writeFileSync(caminhoGif, buffer);
      console.log('[acoes] 🎞️ convertendo GIF → MP4 (ffmpeg em processo filho)...');
      await converterGifParaMp4(caminhoGif, caminhoMp4);
      const mp4 = fs.readFileSync(caminhoMp4);
      if (mp4 && mp4.length > 0) {
        bufferFinal = mp4;
        console.log(`[acoes] ✅ conversão OK: ${mp4.length} bytes de MP4`);
      }
    } catch (errConv) {
      console.warn(`[acoes] ⚠️ conversão GIF→MP4 falhou — enviando o GIF original: ${errConv?.message || errConv}`);
    } finally {
      await apagarComRetry(caminhoGif);
      await apagarComRetry(caminhoMp4);
    }

    // 6️⃣ Monta e envia a mensagem
    const numeroEnviou = String(quemEnviou || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    const numeroMencionado = String(mencionado || '').split('@')[0].split(':')[0].replace(/\D/g, '');

    const caption = `${emoji} @${numeroEnviou} deu um(a) ${textoAcao} em @${numeroMencionado}`;

    await sock.sendMessage(from, {
      video: bufferFinal,
      gifPlayback: true,
      mimetype: 'video/mp4',
      caption: caption,
      mentions: [mencionado, quemEnviou]
    }, { quoted: msg });

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

// ─── 🎯 Extrai o contextInfo de QUALQUER tipo de mensagem ───
// O contextInfo pode morar em extendedTextMessage, imageMessage,
// videoMessage, documentMessage, stickerMessage etc. — então varremos
// todos os tipos em vez de olhar só o extendedTextMessage.
function extrairContexto(msg) {
  const conteudo = msg?.message || {};
  for (const chave of Object.keys(conteudo)) {
    const ctx = conteudo[chave]?.contextInfo;
    if (ctx) return ctx;
  }
  return null;
}

// ─── 🎯 Alvo da ação, com prioridade ───
//   1) mensagem citada (reply/quote) → autor da citada (contextInfo.participant)
//   2) menção (@usuario) → mentionedJid[0] (comportamento original, mantido)
//   3) nada → null (o handler mantém o aviso pedindo pra marcar alguém)
function extrairAlvo(msg) {
  const ctx = extrairContexto(msg);
  if (!ctx) return null;

  // 1) Reply/quote: o alvo é quem enviou a mensagem original
  if (ctx.quotedMessage && ctx.participant) {
    return { alvo: String(ctx.participant).split(':')[0], via: 'reply' };
  }

  // 2) Menção @usuario
  const mencionado = ctx.mentionedJid?.[0];
  if (mencionado) {
    return { alvo: String(mencionado).split(':')[0], via: 'mencao' };
  }

  return null;
}

// ─── 📨 Handler padrão para todos os comandos de ação ───
function criarHandler(categoria, emoji, textoAcao) {
  return async function executar(sock, jid, msg) {
    try {
      const quemEnviou = msg.key?.participant || msg.key?.remoteJid;
      const alvoInfo = extrairAlvo(msg);

      if (!alvoInfo) {
        return await sock.sendMessage(jid, {
          text: '❌ Você precisa marcar alguém para esta ação!\n\n💡 Responda (reply) a mensagem da pessoa, ou mencione: `/tapa @usuario`.'
        }, { quoted: msg });
      }

      console.log(`[acoes] 🎯 alvo de ${categoria}: ${alvoInfo.alvo} (via ${alvoInfo.via})`);
      await enviarAcao(sock, jid, msg, quemEnviou, alvoInfo.alvo, categoria, emoji, textoAcao);

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
  { nome: 'tapa',      descricao: 'Dá um tapa em alguém — responda a mensagem da pessoa (reply) ou mencione com @usuario.',      categoria: 'slap',   emoji: '👋', textoAcao: 'tapa' },
  { nome: 'beijo',     descricao: 'Dá um beijo em alguém — responda a mensagem da pessoa (reply) ou mencione com @usuario.',     categoria: 'kiss',   emoji: '💋', textoAcao: 'beijo' },
  { nome: 'abraço',    descricao: 'Dá um abraço em alguém — responda a mensagem da pessoa (reply) ou mencione com @usuario.',    categoria: 'hug',    emoji: '🤗', textoAcao: 'abraço' },
  { nome: 'soco',      descricao: 'Dá um soco em alguém — responda a mensagem da pessoa (reply) ou mencione com @usuario.',      categoria: 'punch',  emoji: '👊', textoAcao: 'soco' },
  { nome: 'chute',     descricao: 'Dá um chute em alguém — responda a mensagem da pessoa (reply) ou mencione com @usuario.',     categoria: 'kick',   emoji: '🦶', textoAcao: 'chute' },
  { nome: 'carinho',   descricao: 'Faz carinho em alguém — responda a mensagem da pessoa (reply) ou mencione com @usuario.',     categoria: 'pat',    emoji: '🫳', textoAcao: 'carinho' },
  { nome: 'mordida',   descricao: 'Dá uma mordida em alguém — responda a mensagem da pessoa (reply) ou mencione com @usuario.',  categoria: 'bite',   emoji: '🦷', textoAcao: 'mordida' },
  { nome: 'cutucada',  descricao: 'Cutuca alguém — responda a mensagem da pessoa (reply) ou mencione com @usuario.',             categoria: 'poke',   emoji: '👉', textoAcao: 'cutucada' },
  { nome: 'aconchego', descricao: 'Aconchega alguém — responda a mensagem da pessoa (reply) ou mencione com @usuario.',          categoria: 'cuddle', emoji: '🫂', textoAcao: 'aconchego' },
  { nome: 'comer',     descricao: 'Come alguém — responda a mensagem da pessoa (reply) ou mencione com @usuario.',               categoria: 'nom',    emoji: '😋', textoAcao: 'mordida gostosa' },
];

module.exports = ACOES.map(acao => ({
  nome: acao.nome,
  descricao: acao.descricao,
  executar: criarHandler(acao.categoria, acao.emoji, acao.textoAcao)
}));
