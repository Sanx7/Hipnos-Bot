// =========================================================================
// comandos/menu-adulto/comandos-adulto.js
// -------------------------------------------------------------------------
// Lê dados/comandos-adulto.js e cria os comandos automaticamente.
// Suporta frases com:
//   [autor] -> menciona quem executou o comando
//   [alvo]  -> menciona quem foi marcado/respondido
//
// Exemplos:
//
// frase: '[autor] deu um soco 👊'
// frase: '[autor] deu um tapa em [alvo] 👋'
//
// O alvo pode ser:
// - alguém mencionado no comando
// - alguém cuja mensagem foi respondida
//
// 📹 ENVIO DE MÍDIA: .mp4 vai como video+gifPlayback; .gif é convertido
// para .mp4 via ffmpeg em processo filho (igual ao acoes.js) e enviado
// como video+gifPlayback. Motivo: GIF cru enviado como `image` passa pelo
// sharp interno da Baileys p/ gerar thumbnail e o libvips cospe
// "GLib-GObject-CRITICAL ... cannot retrieve class for invalid
// (unclassed) type '<invalid>'" — o GIF chega quebrado/não anima. Em MP4
// com gifPlayback o WhatsApp anima liso. Se a conversão falhar, cai para
// o envio do GIF original como video (nunca como image).
// =========================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const CONFIGURACOES = require('../../dados/comandos-adulto');

// 🛠️ Helpers compartilhados do projeto (caminho do ffmpeg + delete com
// retry p/ Windows) — mesma fonte usada pelo /pinterest e /tomp3
const { caminhoFfmpeg, apagarComRetry } = require('../menu-utilitario/audio-extrator');

// Tenta carregar o helper do /modoadulto.
// Se ainda não existir, bloqueia por segurança.
let modoAdultoAtivo;

try {
  ({ modoAdultoAtivo } = require('../../modoadulto'));
} catch (e) {
  modoAdultoAtivo = async () => false;
}

// Raiz do projeto
const RAIZ_PROJETO = path.join(__dirname, '..', '..');

function sortearGif(gifs) {
  return gifs[Math.floor(Math.random() * gifs.length)];
}

function extensaoDoArquivo(caminho) {
  return path.extname(caminho).replace('.', '').toLowerCase();
}

// Descobre quem foi mencionado ou quem é o dono da mensagem respondida.
function acharAlvo(msg) {
  const contexto =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    msg.message?.documentMessage?.contextInfo ||
    {};

  // Pessoa mencionada no comando
  if (contexto.mentionedJid && contexto.mentionedJid.length > 0) {
    return contexto.mentionedJid[0];
  }

  // Pessoa cuja mensagem foi respondida
  if (contexto.participant) {
    return contexto.participant;
  }

  return null;
}

// Substitui os marcadores da frase pelas menções reais.
function montarLegenda(frase, autorJid, alvoJid) {
  if (!frase) {
    return {
      legenda: undefined,
      mentions: [],
    };
  }

  const autor = `@${autorJid.split('@')[0]}`;

  let legenda = frase
    .replace(/\[autor\]/gi, autor)
    .replace(/\{autor\}/gi, autor);

  const mentions = [autorJid];

  // Só substitui [alvo] se realmente existir um alvo.
  if (alvoJid) {
    const alvo = `@${alvoJid.split('@')[0]}`;

    legenda = legenda
      .replace(/\[alvo\]/gi, alvo)
      .replace(/\{alvo\}/gi, alvo);

    mentions.push(alvoJid);
  } else {
    // Se não existe alvo, remove o marcador para não ficar "[alvo]"
    legenda = legenda
      .replace(/\[alvo\]/gi, '')
      .replace(/\{alvo\}/gi, '');
  }

  return {
    legenda: legenda.trim(),
    mentions,
  };
}

// ─── 🎞️ Converte GIF → MP4 (H.264) via ffmpeg em PROCESSO FILHO ───
// O WhatsApp não reproduz GIF cru dentro de "video" nem de "image" de
// forma confiável: como image o sharp/libvips da Baileys quebra o
// thumbnail (GLib-GObject-CRITICAL + GIF parado/quebrado no chat); como
// video+gifPlayback em MP4 (yuv420p + faststart) anima liso. Mesmos args
// do acoes.js.
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

function criarComando(config) {
  return {
    nome: config.nome,
    aliases: config.aliases || [],
    categoria: 'adulto',
    descricao: config.legenda || config.frase || `Comando ${config.nome}`,

    async executar(sock, jid, msg) {
      try {
        // Só funciona em grupos
        if (!jid.endsWith('@g.us')) {
          await sock.sendMessage(
            jid,
            {
              text: '⚠️ Esse comando só funciona dentro de grupos.',
            },
            { quoted: msg }
          );
          return;
        }

        // Verifica modo adulto
        const ligado = await modoAdultoAtivo(jid);

        if (!ligado) {
          await sock.sendMessage(
            jid,
            {
              text:
                `🔞 O comando /${config.nome} só funciona com o *modo adulto* ligado neste grupo.\n` +
                `Um admin pode ativar com /modoadulto ligar.`,
            },
            { quoted: msg }
          );
          return;
        }

        // Verifica se existem mídias
        if (!config.gifs || config.gifs.length === 0) {
          await sock.sendMessage(
            jid,
            {
              text:
                `⚠️ O comando /${config.nome} ainda não tem nenhum gif ` +
                `configurado em dados/comandos-adulto.js.`,
            },
            { quoted: msg }
          );
          return;
        }

        // Sorteia a mídia
        const caminhoRelativo = sortearGif(config.gifs);
        const caminhoCompleto = path.join(
          RAIZ_PROJETO,
          caminhoRelativo
        );

        // Verifica se o arquivo existe
        if (!fs.existsSync(caminhoCompleto)) {
          console.error(
            `[comandos-adulto] arquivo não encontrado: ${caminhoCompleto}`
          );

          await sock.sendMessage(
            jid,
            {
              text:
                `⚠️ Não encontrei o arquivo de mídia do /${config.nome} ` +
                `no servidor. Confira se ele foi enviado (git push) certinho.`,
            },
            { quoted: msg }
          );

          return;
        }

        const buffer = fs.readFileSync(caminhoCompleto);
        const ext = extensaoDoArquivo(caminhoCompleto);

        // Quem executou o comando
        const autorJid =
          msg.key.participant ||
          msg.participant ||
          msg.key.remoteJid;

        // Quem foi mencionado/respondido
        const alvoJid = acharAlvo(msg);

        // Monta a legenda
        //
        // Se existir "frase", usa:
        // [autor] -> quem executou
        // [alvo]  -> quem foi mencionado/respondido
        //
        // Se não existir "frase", usa a legenda antiga.
        let legendaFinal = config.legenda || undefined;
        let mentions = [];

        if (config.frase) {
          const resultado = montarLegenda(
            config.frase,
            autorJid,
            alvoJid
          );

          legendaFinal = resultado.legenda;
          mentions = resultado.mentions;
        }

        const opcoesEnvio = {
          quoted: msg,
        };

        // 📹 Envia SEMPRE como video+gifPlayback (anima liso no WhatsApp).
        // .mp4 vai direto; .gif é convertido p/ .mp4 via ffmpeg em processo
        // filho (igual ao acoes.js). Enviar GIF como `image` quebra o
        // thumbnail no sharp/libvips (GLib-GObject-CRITICAL + GIF parado).
        let bufferVideo = buffer;
        if (ext !== 'mp4') {
          const idUnico = `${config.nome}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const caminhoMp4 = path.join(os.tmpdir(), `adulto_${idUnico}.mp4`);
          try {
            console.log(`[comandos-adulto] 🎞️ convertendo GIF → MP4 (/${config.nome})...`);
            await converterGifParaMp4(caminhoCompleto, caminhoMp4);
            const mp4 = fs.readFileSync(caminhoMp4);
            if (mp4 && mp4.length > 0) {
              bufferVideo = mp4;
              console.log(`[comandos-adulto] ✅ conversão OK (/${config.nome}): ${mp4.length} bytes de MP4`);
            }
          } catch (errConv) {
            console.warn(`[comandos-adulto] ⚠️ conversão GIF→MP4 falhou (/${config.nome}) — enviando o GIF original como vídeo: ${errConv?.message || errConv}${errConv?.mensagemFfmpeg ? ' | ffmpeg: ' + errConv.mensagemFfmpeg : ''}`);
          } finally {
            await apagarComRetry(caminhoMp4);
          }
        }

        await sock.sendMessage(
          jid,
          {
            video: bufferVideo,
            gifPlayback: true,
            mimetype: 'video/mp4',
            caption: legendaFinal,
            mentions: mentions.length
              ? mentions
              : undefined,
          },
          opcoesEnvio
        );
      } catch (erro) {
        console.error(
          `[comandos-adulto] erro no /${config.nome}:`,
          erro.message
        );

        try {
          await sock.sendMessage(
            jid,
            {
              text:
                `⚠️ Não consegui enviar o gif do /${config.nome} agora. ` +
                `Tente de novo mais tarde.`,
            },
            { quoted: msg }
          );
        } catch (_) {}
      }
    },
  };
}

module.exports = CONFIGURACOES.map(criarComando);