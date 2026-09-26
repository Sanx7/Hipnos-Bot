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

// ============================================================
// ✍️ ASSINATURA VIP — marca d'água da figurinha (drawtext do ffmpeg)
// ============================================================
// O VIP pode pedir (via /assinatura, campo `assinatura` do doc de VIP) que o
// texto saia estampado no canto da figurinha criada pelo /s e pelo /figurinha.
// Aqui mora TODO o desenho da marca d'água, para os dois comandos
// compartilharem exatamente a mesma peça:
//   - 🔤 resolverFonteAssinatura(): acha uma fonte TTF no sistema;
//   - ✍️ criarArquivoAssinatura(): grava o texto num .txt temporário;
//   - 🎨 filtroDrawtextAssinatura(): monta o fragmento de filtro;
//   - 🔗 comAssinatura(): encosta esse fragmento no filtro que já existia.
//
// ⚙️ POR QUE `textfile=` E NÃO `text=` (medido no ffmpeg embutido 4.2):
//   Escapar o texto dentro do -vf funciona para quase tudo (`: , % ; = ] |`),
//   mas o APOSTROFO não sai igual por NENHUM modo — comparando byte a byte com
//   o `textfile=` (que não depende de escaping), as três variantes de escaping
//   inline renderizam um caractere diferente. Então o texto vai num arquivo e o
//   filtro só carrega o caminho: o que o usuário digitou é exatamente o que
//   aparece na figurinha, sem trocar nenhum caractere em silêncio.
//
// 🛡️ Sem assinatura (ou sem fonte no sistema) o filtro volta IDÊNTICO ao de
//    hoje: nenhuma marca d'água, nenhum arquivo extra, nenhum comportamento
//    novo — é o que garante "sem assinatura, o /s e o /figurinha não mudam".
// ============================================================

// 📐 Aparência da marca d'água (canto inferior direito da figurinha 512×512)
const ASSINATURA_FONTE_PX = 22        // fonte pequena (a figurinha é 512×512)
const ASSINATURA_MARGEM_PX = 10       // respiro até a borda
const ASSINATURA_CONTORNE = 2         // leve contorno preto (legibilidade)
const ASSINATURA_OPACIDADE_CONTORNE = 0.6

// 🔤 Fontes candidatas, na ordem de preferência: Windows (dev local), Linux
// (Render) e, por último, a fonte que JÁ viaja versionada no repo — assim a
// marca d'água funciona em qualquer máquina, mesmo sem fonte do sistema.
const CANDIDATAS_FONTE_ASSINATURA = [
  'C:/Windows/Fonts/segoeuib.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/tahoma.ttf',
  'C:/Windows/Fonts/verdana.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
  '/usr/share/fonts/noto/NotoSans-Bold.ttf',
  path.join(__dirname, '..', '..', 'assets', 'fonts', 'LuckiestGuy-Regular.ttf')
];

let fonteAssinaturaCache = null; // null = ainda não tentou | string | false (sem fonte)

// 🔤 resolverFonteAssinatura(): caminho de uma fonte existente, ou null.
// O resultado é cacheado (inclusive o "não tem fonte") p/ não varrer o disco a
// cada figurinha; a marca d'água é opcional, então falta de fonte NÃO é erro —
// só significa que a figurinha sai sem a marca.
function resolverFonteAssinatura() {
  if (fonteAssinaturaCache !== null) {
    return fonteAssinaturaCache === false ? null : fonteAssinaturaCache;
  }

  for (const candidata of CANDIDATAS_FONTE_ASSINATURA) {
    try {
      if (fs.existsSync(candidata)) {
        fonteAssinaturaCache = candidata;
        console.log(`[webp-animado] 🔤 fonte da assinatura: ${candidata}`);
        return candidata;
      }
    } catch (err) {
      // fs.existsSync raramente lança; se lançar, segue para a próxima
    }
  }

  fonteAssinaturaCache = false;
  console.error('[webp-animado] ⚠️ nenhuma fonte TTF encontrada — a assinatura NÃO será aplicada');
  return null;
}

// 🧹 Escapar caminho p/ a sintaxe de filtro do ffmpeg: barras normais (o
// ffmpeg prefere "/" mesmo no Windows) e dois-pontos escapados (drive letter).
// Validado no ffmpeg embutido: `textfile='C\:/Users/.../x.txt'` carrega certo.
function escaparCaminhoParaFiltro(caminho) {
  return String(caminho).replace(/\\/g, '/').replace(/:/g, '\\:');
}

// ✍️ prepararAssinatura(texto, idUnico): transforma o texto numa peça de
// marca d'água — { texto, caminhoTexto } — ou devolve null quando não dá para
// aplicar (sem texto, sem fonte no sistema ou sem gravar o .txt). Só nesse
// último caso (assinatura de verdade) o chamador cria um arquivo temporário,
// que precisa ser apagado no finally.
function prepararAssinatura(texto, idUnico) {
  const limpo = String(texto || '').trim();
  if (!limpo) return null;
  if (!resolverFonteAssinatura()) return null;

  const caminho = path.join(require('os').tmpdir(), `assinatura-${idUnico || Date.now()}.txt`);
  try {
    fs.writeFileSync(caminho, limpo, 'utf8');
    return { texto: limpo, caminhoTexto: caminho };
  } catch (err) {
    console.error('[webp-animado] ⚠️ não foi possível gravar a assinatura:', err?.message || err);
    return null;
  }
}

// 🎨 filtroDrawtextAssinatura(assinatura): fragmento de filtro com o drawtext,
// ou '' quando não há assinatura. Recebe a peça de prepararAssinatura().
// Canto inferior direito (x=w-tw-M, y=h-th-M), texto branco com contorno preto
// leve — legível tanto em foto clara quanto escura.
function filtroDrawtextAssinatura(assinatura) {
  if (!assinatura || !assinatura.texto || !assinatura.caminhoTexto) return '';
  if (!resolverFonteAssinatura()) return '';

  return (
    'drawtext=' +
    `fontfile='${escaparCaminhoParaFiltro(resolverFonteAssinatura())}':` +
    `textfile='${escaparCaminhoParaFiltro(assinatura.caminhoTexto)}':` +
    'fontcolor=white:' +
    `fontsize=${ASSINATURA_FONTE_PX}:` +
    `borderw=${ASSINATURA_CONTORNE}:` +
    `bordercolor=black@${ASSINATURA_OPACIDADE_CONTORNE}:` +
    `x=w-tw-${ASSINATURA_MARGEM_PX}:` +
    `y=h-th-${ASSINATURA_MARGEM_PX}`
  );
}

// 🔗 comAssinatura(filtroBase, assinatura): devolve o filtro ORIGINAL quando não
// há assinatura (comportamento de hoje intacto) e o mesmo filtro com o drawtext
// encostado no FIM quando há (aí as coordenadas w/h já são as do quadrado
// 512×512 final, que é onde a marca d'água deve cair).
function comAssinatura(filtroBase, assinatura) {
  const drawtext = filtroDrawtextAssinatura(assinatura);
  if (!drawtext) return filtroBase;
  return filtroBase ? `${filtroBase},${drawtext}` : drawtext;
}

module.exports = {
  webpEhAnimado,
  rodarExecutavel,
  caminhoBinarioWebp,
  resolverFonteAssinatura,
  prepararAssinatura,
  filtroDrawtextAssinatura,
  comAssinatura,
  ASSINATURA_FONTE_PX
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

