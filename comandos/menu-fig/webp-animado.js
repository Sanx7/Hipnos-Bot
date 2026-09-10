// ============================================
// 🕸️ WEBP-ANIMADO — Ponte segura entre figurinhas animadas e o ffmpeg
// ============================================
// ⚠️ CONTEXTO DO BUG (causa raiz do /toimg, /togif e /tomp4 quebrados):
//   1) O ffmpeg embutido (@ffmpeg-installer/ffmpeg, build 4.2 de 2018) NÃO
//      decodifica WebP ANIMADO (container VP8X/ANMF) — só WebP ESTÁTICO.
//      Stickers animados do WhatsApp são webp animados, então qualquer
//      "ffmpeg -i sticker.webp" falha com "Invalid data found when
//      processing input" (comprovado localmente).
//   2) A lib webp-converter v2.3.3 mudou p/ assinatura PROMISE: os comandos
//      antigos passavam callback como 4º argumento e a lib INJETAVA a
//      função na linha de comando do shell (DEP0190) — conversão nunca
//      acontecia e ainda havia injeção de shell.
//
// 🌉 A PONTE (validada localmente):
//   webp animado ──anim_dump (libwebp do webp-converter)──► PNGs (%04d)
//   PNGs ──ffmpeg -framerate N -i frame_%04d.png──► MP4 (h264/yuv420p)
//
// 🔒 Segurança: TODAS as chamadas usam execFile com args em ARRAY (nada
//    passa por shell) e timeout — o mesmo padrão do /tomp3 e do /attp.
// ============================================

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// ⏳ Limites de tempo (ms) — mídia travada nunca prende o comando
const TIMEOUT_ANIM_DUMP_MS = 120000;
const TIMEOUT_FFMPEG_MS = 120000;

// ─── 🔎 Localiza os binários nativos da libwebp empacotados no webp-converter ───
// O pacote traz binários p/ win64 e linux — os dois alvos do bot (Windows local
// e Render/Linux). No linux o binário precisa de permissão de execução (chmod).
function caminhoBinarioWebp(nome) {
  const pasta = process.platform === 'win32' ? 'libwebp_win64' : 'libwebp_linux';
  const sufixo = process.platform === 'win32' ? '.exe' : '';
  const caminho = path.join(
    __dirname, '..', '..', 'node_modules', 'webp-converter', 'bin', pasta, 'bin', nome + sufixo
  );
  if (!fs.existsSync(caminho)) {
    throw new Error(`binário ${nome} do webp-converter não encontrado: ${caminho}`);
  }
  // Linux/Render: garante permissão de execução (o grant_permission da lib
  // nem sempre roda antes dos comandos; fazemos nós mesmos, sem lançar)
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(caminho, 0o755);
    } catch (err) {
      console.error(`[webp-animado] falha ao chmod +x ${nome}:`, err?.message || err);
    }
  }
  return caminho;
}

// ─── 🚀 execFile promisificado com timeout, SEM shell, args em array ───
function rodarExecutavel(caminho, argumentos, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      caminho,
      argumentos,
      { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout: stdout || '', stderr: stderr || '' });
        // Preserva o stderr REAL p/ os logs do comando (nunca silenciar!)
        error.mensagemExecutavel = (stderr || error.message || '').toString().trim();
        reject(error);
      }
    );
  });
}

// ─── 🧬 O webp é animado? ───
// O container webp animado carrega chunks "ANMF" (um por frame). A checagem
// por bytes evita depender de decoders externos e é instantânea.
function webpEhAnimado(buffer) {
  try {
    return Buffer.isBuffer(buffer) && buffer.includes('ANMF');
  } catch (err) {
    return false;
  }
}

module.exports = {
  webpEhAnimado,
  rodarExecutavel,
  caminhoBinarioWebp
};

// ─── 🧯 THUMBNAIL SEGURO (lição do /revelar, agora p/ QUALQUER envio de imagem) ───
// ⚠️ REGRA DE OURO DO RENDER: enviar `image:` SEM `jpegThumbnail` faz a
// Baileys gerar a miniatura NA HORA com sharp/libvips IN-PROCESS — e o
// libvips/GLib quebra o processo inteiro ("GLib-GObject-CRITICAL: cannot
// retrieve class for invalid (unclassed) type"), sem chance de try/catch
// em JS. O /toimg usava esse caminho e derrubava o bot logo após o log
// "✅ JPG pronto" (a conversão era segura; o ENVIO não).
// Solução: gerar o JPEG (~64px) com o ffmpeg em PROCESSO FILHO e entregar
// `jpegThumbnail` pronto no sendMessage → `requiresThumbnailComputation`
// vira false e a Baileys PULA o sharp/libvips por completo.
// Se até o ffmpeg falhar, o JPEG 8x8 embutido (gerado pelo próprio
// @ffmpeg-installer do projeto) garante que a mensagem sai — com preview
// simples, mas sai — e o bot permanece de pé. NUNCA lança.
const THUMB_FALLBACK_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzU4LjQyLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgACAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AD//Z';

/**
 * Gera um thumbnail JPEG (~64px) da imagem usando o binário do ffmpeg em
 * PROCESSO FILHO (execFile, args em ARRAY — sem shell, sem interpolação).
 * NUNCA rejeita: em qualquer falha devolve o fallback 8x8 embutido.
 * @returns {Promise<{base64: string, fonte: 'ffmpeg'|'fallback', caminho: string}>}
 */
function gerarJpegThumbnail(caminhoImagem, pastaTemp, idUnico) {
  return new Promise((resolve) => {
    const caminhoThumb = path.join(pastaTemp, `thumb_${idUnico}.jpg`);
    const binFfmpeg = (() => {
      try {
        return require('@ffmpeg-installer/ffmpeg').path;
      } catch (err) {
        return 'ffmpeg';
      }
    })();

    rodarExecutavel(
      binFfmpeg,
      ['-y', '-nostdin', '-i', caminhoImagem, '-vf', 'scale=64:-1', '-vframes', '1', caminhoThumb],
      30000
    )
      .then(() => {
        try {
          if (fs.existsSync(caminhoThumb)) {
            const bufferThumb = fs.readFileSync(caminhoThumb);
            if (bufferThumb.length > 0) {
              return resolve({ base64: bufferThumb.toString('base64'), fonte: 'ffmpeg', caminho: caminhoThumb });
            }
          }
        } catch (errLeitura) {
          console.error('[webp-animado] ⚠️ falha ao ler thumbnail gerado — usando fallback 8x8:', errLeitura?.message);
        }
        console.error('[webp-animado] ⚠️ ffmpeg não produziu thumbnail — usando fallback 8x8');
        resolve({ base64: THUMB_FALLBACK_JPEG_BASE64, fonte: 'fallback', caminho: caminhoThumb });
      })
      .catch((err) => {
        console.error('[webp-animado] ⚠️ ffmpeg falhou no thumbnail (fallback 8x8):',
          err?.mensagemExecutavel || err?.message || err);
        resolve({ base64: THUMB_FALLBACK_JPEG_BASE64, fonte: 'fallback', caminho: caminhoThumb });
      });
  });
}

Object.assign(module.exports, {
  extrairFramesAnimados,
  montarMp4DeFrames,
  webpAnimadoParaMp4,
  webpParaJpg,
  gerarJpegThumbnail,
  THUMB_FALLBACK_JPEG_BASE64
});

// Usa o anim_dump da libwebp (binário que ENTENDE o container animado).
// O anim_dump nomeia os frames com prefixo + índice de 4 dígitos:
//   frame_0000.png, frame_0001.png, ...
// @returns {Promise<{pasta: string, padrao: string, quantidade: number, primeiro: string}>}
async function extrairFramesAnimados(caminhoWebp, pastaFrames, prefixo = 'frame_') {
  const binAnimDump = caminhoBinarioWebp('anim_dump');
  fs.mkdirSync(pastaFrames, { recursive: true });

  await rodarExecutavel(
    binAnimDump,
    ['-folder', pastaFrames, '-prefix', prefixo, caminhoWebp],
    TIMEOUT_ANIM_DUMP_MS
  );

  const frames = fs.readdirSync(pastaFrames).filter((f) => f.endsWith('.png')).sort();
  if (!frames.length) {
    throw new Error('anim_dump não extraiu nenhum frame do webp animado');
  }

  return {
    pasta: pastaFrames,
    padrao: path.join(pastaFrames, `${prefixo}%04d.png`),
    quantidade: frames.length,
    primeiro: path.join(pastaFrames, frames[0])
  };
}

// ─── 🎬 Monta MP4 (h264/yuv420p/faststart) a partir de PNGs sequenciais ───
// scale par por segurança: o libx264 recusa largura/altura ÍMPARES
// ("width not divisible by 2") — stickers às vezes têm 501x501.
async function montarMp4DeFrames(padraoPngs, fps, caminhoMp4) {
  const binFfmpeg = (() => {
    try {
      return require('@ffmpeg-installer/ffmpeg').path;
    } catch (err) {
      return 'ffmpeg';
    }
  })();

  await rodarExecutavel(
    binFfmpeg,
    [
      '-y', '-nostdin',
      '-framerate', String(fps),
      '-i', padraoPngs,
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', // dimensões pares
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264',
      '-movflags', 'faststart',
      caminhoMp4
    ],
    TIMEOUT_FFMPEG_MS
  );
}

// ─── 🌉 PONTE PRINCIPAL: webp animado → MP4 ───
// É o que o /togif e o /tomp4 chamam. fps padrão 12 (bom equilíbrio entre
// fluidez e tamanho no WhatsApp).
async function webpAnimadoParaMp4(caminhoWebp, caminhoMp4, fps = 12) {
  const pastaFrames = caminhoMp4 + '.frames';
  try {
    const extracao = await extrairFramesAnimados(caminhoWebp, pastaFrames);
    await montarMp4DeFrames(extracao.padrao, fps, caminhoMp4);
    if (!fs.existsSync(caminhoMp4) || fs.statSync(caminhoMp4).size === 0) {
      throw new Error('ffmpeg não produziu o MP4 a partir dos frames');
    }
    return { quantidadeFrames: extracao.quantidade, fps };
  } finally {
    // Os PNGs intermediários são lixo assim que o MP4 sai — limpa já
    try {
      fs.rmSync(pastaFrames, { recursive: true, force: true });
    } catch (err) {
      console.error('[webp-animado] falha ao limpar frames:', err?.message || err);
    }
  }
}

// ─── 🖼️ WebP → JPG ───
// - webp ESTÁTICO: o ffmpeg decodifica direto (comprovado);
// - webp ANIMADO: extrai o 1º frame (anim_dump) e converte — avisamos o
//   usuário de que a imagem sai estática (1º frame).
// @returns {Promise<{animado: boolean}>}
async function webpParaJpg(caminhoWebp, caminhoJpg) {
  const binFfmpeg = (() => {
    try {
      return require('@ffmpeg-installer/ffmpeg').path;
    } catch (err) {
      return 'ffmpeg';
    }
  })();

  const ehAnimado = webpEhAnimado(fs.readFileSync(caminhoWebp));

  if (!ehAnimado) {
    await rodarExecutavel(
      binFfmpeg,
      ['-y', '-nostdin', '-i', caminhoWebp, '-q:v', '2', caminhoJpg],
      TIMEOUT_FFMPEG_MS
    );
  } else {
    const pastaFrames = caminhoJpg + '.frames';
    try {
      const extracao = await extrairFramesAnimados(caminhoWebp, pastaFrames);
      await rodarExecutavel(
        binFfmpeg,
        ['-y', '-nostdin', '-i', extracao.primeiro, '-q:v', '2', caminhoJpg],
        TIMEOUT_FFMPEG_MS
      );
    } finally {
      try {
        fs.rmSync(pastaFrames, { recursive: true, force: true });
      } catch (err) {
        console.error('[webp-animado] falha ao limpar frames:', err?.message || err);
      }
    }
  }

  if (!fs.existsSync(caminhoJpg) || fs.statSync(caminhoJpg).size === 0) {
    throw new Error('ffmpeg não produziu o JPG');
  }
  return { animado: ehAnimado };
}

Object.assign(module.exports, {
  extrairFramesAnimados,
  montarMp4DeFrames,
  webpAnimadoParaMp4,
  webpParaJpg
});

