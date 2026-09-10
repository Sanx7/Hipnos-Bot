// ============================================
// 📜 TRANSCREVER — Voz → Texto via Groq Whisper (uso LIVRE)
// ============================================
// Transcreve o áudio de uma mensagem citada (áudio do WhatsApp ou faixa de
// áudio de um vídeo) usando a API da Groq (modelo whisper-large-v3-turbo,
// language=pt p/ melhor precisão em português).
//
// Fluxo:
//   1) Usuário responde (cita) um áudio/vídeo com /transcrever;
//   2) A mídia é baixada via downloadMediaMessage p/ os.tmpdir() (o Render
//      tem disco efêmero — tudo vira lixo apagável no finally);
//   3) Se for VÍDEO, o ffmpeg (PROCESSO FILHO — a mesma conversão do
//      /tomp3, agora no módulo compartilhado audio-extrator.js) extrai
//      só a faixa de áudio em MP3 antes do upload (menos bytes, sem
//      mandar imagem desnecessária p/ a API);
//   4) O áudio vai p/ a Groq via fetch + FormData/Blob (Node 18+ nativos);
//   5) O texto volta citando a mensagem original.
//
// ⚠️ Requisito: GROQ_API_KEY no .env (grátis em https://console.groq.com).
// Sem a chave o comando NÃO quebra — responde avisando que o recurso
// ainda não está disponível no servidor.
//
// Tratamento de erros (todos com log REAL no console + aviso amigável):
//   - mídia > 25MB (limite da Groq) | vídeo sem áudio | corrompido
//   - timeout da API | 401 chave inválida | 429 limite atingido
//   - transcrição vazia (áudio mudo/sem fala)
// ============================================

const {
  downloadMediaMessage,
  normalizeMessageContent,
  getContentType
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { converterParaMp3, apagarComRetry } = require('./audio-extrator');

// ⛔ Limite de tamanho (a Groq recusa arquivos acima de 25MB)
const LIMITE_BYTES = 25 * 1024 * 1024;

// ⏳ Timeout da chamada à API (transcrição do turbo costuma ser rápida)
const TIMEOUT_API_MS = 60000;

// ✂️ Divide transcrições longas em blocos legíveis no WhatsApp
const TAMANHO_BLOCO = 2000;

// 🧪 Erro de domínio: mensagem amigável + tipo p/ o aviso correto
class ErroTranscricao extends Error {
  constructor(mensagem, tipo) {
    super(mensagem);
    this.name = 'ErroTranscricao';
    this.tipo = tipo; // 'chave_invalida' | 'limite' | 'timeout' | 'api' | 'vazia'
  }
}

// ─── 📡 Chamada à API da Groq (multipart, igual à API OpenAI) ───
// POST /openai/v1/audio/transcriptions com file, model, language e
// response_format. Retorna o texto limpo; lança ErroTranscricao em falhas.
async function transcreverNaGroq(caminhoAudio, mimetype) {
  const chave = (process.env.GROQ_API_KEY || '').trim();
  if (!chave) {
    throw new ErroTranscricao('GROQ_API_KEY não configurada', 'sem_chave');
  }

  const buffer = fs.readFileSync(caminhoAudio);
  const nomeArquivo = mimetype.startsWith('audio/ogg') ? 'audio.ogg' : 'audio.mp3';

  const formulario = new FormData();
  formulario.append('file', new Blob([buffer], { type: mimetype }), nomeArquivo);
  formulario.append('model', 'whisper-large-v3-turbo');
  formulario.append('language', 'pt');
  formulario.append('response_format', 'json');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_API_MS);

  let resposta;
  try {
    resposta = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}` },
      body: formulario,
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new ErroTranscricao('timeout na chamada da Groq', 'timeout');
    }
    throw new ErroTranscricao(`falha de rede: ${err?.message || err}`, 'api');
  }
  clearTimeout(timeoutId);

  if (!resposta.ok) {
    // Lê o corpo do erro REAL (a Groq devolve {"error": {"message": ...}})
    let corpo = '';
    try {
      corpo = await resposta.text();
    } catch (err) { /* corpo ilegível — segue com status */ }
    console.error(`[transcrever] 📎 Groq respondeu HTTP ${resposta.status}: ${corpo.slice(0, 500)}`);

    if (resposta.status === 401 || resposta.status === 403) {
      throw new ErroTranscricao('chave da Groq inválida/expirada', 'chave_invalida');
    }
    if (resposta.status === 413) {
      throw new ErroTranscricao('áudio acima do limite da Groq (25MB)', 'limite');
    }
    if (resposta.status === 429) {
      throw new ErroTranscricao('limite de uso da Groq atingido', 'limite');
    }
    throw new ErroTranscricao(`Groq respondeu HTTP ${resposta.status}`, 'api');
  }

  const dados = await resposta.json();
  return String(dados?.text || '').trim();
}

// ─── ✂️ Divide um texto longo em blocos (quebrando em fim de linha/palavra) ───
function dividirEmBlocos(texto, tamanho = TAMANHO_BLOCO) {
  if (texto.length <= tamanho) return [texto];
  const blocos = [];
  let restante = texto;
  while (restante.length > tamanho) {
    let corte = restante.lastIndexOf('\n', tamanho);
    if (corte < tamanho / 2) corte = restante.lastIndexOf(' ', tamanho);
    if (corte <= 0) corte = tamanho;
    blocos.push(restante.slice(0, corte).trim());
    restante = restante.slice(corte).trim();
  }
  if (restante) blocos.push(restante);
  return blocos;
}

// ─── 📨 Execução do comando ───
module.exports = {
  nome: 'transcrever',
  descricao: 'Transcreve o áudio de um áudio/vídeo citado para texto (responda à mídia).',

  async executar(sock, jid, msg, texto) {
    let caminhoOrigem = null;
    let caminhoAudio = null;

    try {
      // 0) 🚫 Sem GROQ_API_KEY: aviso ANTES de baixar mídia à toa. O recurso
      //    simplesmente não existe ainda neste servidor — e o bot não quebra.
      if (!(process.env.GROQ_API_KEY || '').trim()) {
        return await sock.sendMessage(jid, {
          text: '📜 *O poder da transcrição ainda está selado neste recinto...*\n\nO /transcrever precisa da chave GROQ_API_KEY configurada pelo dono do bot (grátis em console.groq.com). Enquanto isso, Hipnos segue sem ouvir o que os mortais gravam. 💤'
        }, { quoted: msg })
      }

      // 1) 🎯 Localizar a mensagem citada — mesmo trio do /tomp3
      //    (normalizeMessageContent desembrulha viewOnce/ephemeral/edited)
      const conteudoMsg = normalizeMessageContent(msg.message) || {};
      const contexto = conteudoMsg.extendedTextMessage?.contextInfo;
      const mQuoted = contexto?.quotedMessage;

      if (!mQuoted) {
        return await sock.sendMessage(jid, {
          text: '📜 *Falta a mídia...*\n\nResponda (marque) um áudio ou vídeo com `/transcrever` para que eu escreva o que ele diz.\n\n🗝️ Exemplo: cite o áudio e escreva `/transcrever`'
        }, { quoted: msg }).catch(() => {});
      }

      const conteudoQuoted = normalizeMessageContent(mQuoted) || {};
      const tipoConteudo = getContentType(conteudoQuoted);

      const ehVideo = tipoConteudo === 'videoMessage' && typeof conteudoQuoted.videoMessage === 'object';
      const ehAudio = tipoConteudo === 'audioMessage' && typeof conteudoQuoted.audioMessage === 'object';

      if (!ehVideo && !ehAudio) {
        return await sock.sendMessage(jid, {
          text: '📜 *Isso não é um áudio nem um vídeo...*\n\nHipnos transcreve falas — responda (marque) um dos dois com `/transcrever`.'
        }, { quoted: msg }).catch(() => {});
      }

      // 2) ⏳ Sinaliza processamento
      await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {});

      // 3) 📥 Baixa a mídia citada (mensagem COMPLETA { key, message } —
      //    mesmo padrão do /tomp3 e do /revelar)
      const mensagemAlvo = { key: msg.key, message: mQuoted };
      console.log('[transcrever] ⬇️ baixando mídia citada via downloadMediaMessage...');
      const buffer = await downloadMediaMessage(mensagemAlvo, 'buffer', {});
      console.log(`[transcrever] ✅ download concluído: ${buffer?.length ?? 'n/d'} bytes`);

      if (!buffer || buffer.length === 0) {
        throw new Error('A mídia foi baixada vazia (0 bytes).');
      }
      if (buffer.length > LIMITE_BYTES) {
        const mb = (buffer.length / 1048576).toFixed(1);
        await sock.sendMessage(jid, {
          text: `⛔ *Essa mídia é pesada demais até para as orelhas de Hipnos...* (${mb} MB)\n\nO limite é de *25 MB* — corte o áudio/vídeo e tente de novo.`
        }, { quoted: msg }).catch(() => {});
        return await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {});
      }

      // 4) 🗑️ Temporários em os.tmpdir() (/tmp no Render — disco efêmero)
      const idUnico = `transcrever-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      caminhoOrigem = path.join(os.tmpdir(), `${idUnico}${ehVideo ? '.mp4' : '.ogg'}`);
      fs.writeFileSync(caminhoOrigem, buffer);

      let mimetypeEnvio;
      if (ehVideo) {
        // 5) 🎬 VÍDEO → extrai SÓ o áudio em MP3 (menos bytes no upload;
        //    mesma conversão do /tomp3, módulo audio-extrator.js)
        caminhoAudio = path.join(os.tmpdir(), `${idUnico}.mp3`);
        console.log('[transcrever] 🎛️ extraindo faixa de áudio do vídeo via ffmpeg...');
        await converterParaMp3(caminhoOrigem, caminhoAudio);
        if (!fs.existsSync(caminhoAudio) || fs.statSync(caminhoAudio).size === 0) {
          throw new Error('ffmpeg não produziu o MP3 do vídeo');
        }
        mimetypeEnvio = 'audio/mpeg';
        console.log(`[transcrever] ✅ MP3 pronto: ${fs.statSync(caminhoAudio).size} bytes`);
      } else {
        // Áudio do WhatsApp já vem comprimido (opus/ogg, aceito pela Groq)
        mimetypeEnvio = 'audio/ogg';
        caminhoAudio = caminhoOrigem; // usa o próprio arquivo baixado
      }

      // 6) 📡 Transcrição na Groq
      console.log('[transcrever] 📡 enviando à Groq (whisper-large-v3-turbo, language=pt)...');
      const texto = await transcreverNaGroq(caminhoAudio, mimetypeEnvio);
      console.log(`[transcrever] ✅ transcrição recebida: ${texto.length} caracteres`);

      // 7) 🤫 Áudio sem fala / mudo → aviso amigável
      if (!texto) {
        return await sock.sendMessage(jid, {
          text: '🤫 *Hipnos escutou apenas silêncio...*\n\nNão há fala identificável nesse áudio. Se era mesmo pra ter voz, tente reenviar a mídia e usar /transcrever de novo.'
        }, { quoted: msg }).catch(() => {});
      }

      // 8) 📤 Envia o texto citando a mensagem original (longo → em blocos)
      const blocos = dividirEmBlocos(texto);
      const cabecalho = '📜 *TRANSCRIÇÃO* 📜\n\n';
      await sock.sendMessage(jid, { text: cabecalho + blocos[0] }, { quoted: msg });
      for (let i = 1; i < blocos.length; i++) {
        await sock.sendMessage(jid, { text: blocos[i] }).catch(() => {});
      }

      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {});
      console.log('[transcrever] ✅ texto enviado com sucesso');

    } catch (err) {
      // 🛡️ Loga o erro REAL antes de qualquer aviso — nada silenciado
      console.error('[transcrever] 💥 erro capturado (o bot segue vivo):', err?.stack || err);
      if (err?.mensagemFfmpeg) {
        console.error('[transcrever] 📎 stderr do ffmpeg:', err.mensagemFfmpeg);
      }
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {});

      // Avisos amigáveis por tipo de falha
      let aviso;
      if (err?.semAudio) {
        aviso = '🔇 *Este vídeo não tem som algum...*\n\nHipnos ouviu apenas silêncio. Envie uma mídia que tenha faixa de áudio.';
      } else if (err?.corrompido) {
        aviso = '📼 *Esse arquivo parece corrompido...*\n\nNão consegui ler o conteúdo da mídia. Tente reenviá-la e use /transcrever de novo.';
      } else if (err instanceof ErroTranscricao) {
        switch (err.tipo) {
          case 'chave_invalida':
            aviso = '🔑 *A chave da Groq foi recusada...*\n\nPeça ao dono do bot para conferir a GROQ_API_KEY no .env (grátis em console.groq.com).';
            break;
          case 'limite':
            aviso = '⛔ *O limite de uso/tamanho da Groq foi atingido...*\n\nTente novamente mais tarde ou envie uma mídia menor.';
            break;
          case 'timeout':
            aviso = '⏳ *A Groq demorou demais para responder...*\n\nTente novamente em instantes, ou com uma mídia mais curta.';
            break;
          default:
            aviso = '❌ Não consegui transcrever essa mídia agora — o feitiço falhou, mas Hipnos segue de pé. Tente novamente em instantes.';
        }
      } else {
        aviso = '❌ Não consegui transcrever essa mídia agora — o feitiço falhou, mas Hipnos segue de pé. Tente novamente em instantes.';
      }

      await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {});

    } finally {
      // 🧹 Limpeza SEMPRE (mesmo padrão de retry do /tomp3) — a mídia
      // original E o áudio extraído vão embora, sucesso ou falha
      for (const caminho of [caminhoOrigem, caminhoAudio]) {
        if (caminho) await apagarComRetry(caminho);
      }
    }
  }
}
