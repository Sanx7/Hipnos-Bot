// ============================================
// 🎛️ AUDIO-EXTRATOR — Conversão mídia → MP3 (compartilhado)
// ============================================
// Extraído do /tomp3 para ser REUSADO por outros comandos (ex.: o
// /transcrever extrai o áudio de vídeos antes de mandar p/ a API).
//
// 🔒 Mesmas garantias de lá:
//   - ffmpeg como PROCESSO FILHO via execFile (args em ARRAY — nada passa
//     por shell, sem risco de injeção mesmo com caminhos dinâmicos);
//   - timeout nativo do execFile (SIGKILL) — mídia travada não prende o
//     comando para sempre;
//   - o stderr REAL é preservado em erro.mensagemFfmpeg (os comandos logam
//     antes de mandar o aviso amigável);
//   - apagarComRetry nunca lança (protege o finally contra EPERM/EBUSY do
//     Windows/antivírus).
// ============================================

const { execFile } = require('child_process');
const fs = require('fs');

// Usa o binário de FFmpeg instalado com o projeto, com fallback para o PATH
// (mesma estratégia do /revelar, /tomp4 e /attp)
function caminhoFfmpeg() {
  try {
    return require('@ffmpeg-installer/ffmpeg').path;
  } catch (err) {
    return 'ffmpeg';
  }
}

// ⏳ Tempo máximo do ffmpeg (ms): mídia muito longa/corrompida não pode
// prender o comando para sempre (mesma janela de 120s do /tomp4)
const TIMEOUT_FFMPEG_MS = 120000;

/**
 * Apaga um arquivo temporário com pequenas tentativas extras: no Windows o
 * ffmpeg/antivírus pode segurar o handle por alguns instantes (EPERM/EBUSY).
 * No Render (Linux) a 1ª tentativa costuma bastar. NUNCA lança.
 * (mesmo helper do /revelar e do /tomp3)
 */
function apagarComRetry(caminho, tentativas = 3) {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  return (async () => {
    for (let i = 0; i < tentativas; i++) {
      try {
        if (!fs.existsSync(caminho)) return;
        fs.unlinkSync(caminho);
        return;
      } catch (err) {
        if (i === tentativas - 1) {
          console.error('⚠️ audio-extrator: falha ao apagar temporário', caminho, err?.message);
        } else {
          await espera(150); // pequena pausa antes de tentar de novo (não trava o event loop)
        }
      }
    }
  })();
}

/**
 * Converte input → MP3 com o ffmpeg em PROCESSO FILHO (execFile).
 * - Args em ARRAY: nada passa por shell → sem risco de injeção.
 * - timeout nativo do execFile mata o processo se travar.
 * - O stderr é lido p/ traduzir falhas em mensagens amigáveis:
 *     · vídeo sem faixa de áudio  → erro.semAudio = true
 *     · arquivo corrompido/ilegível → erro.corrompido = true
 *     · timeout do ffmpeg          → erro.timeout = true
 */
function converterParaMp3(caminhoInput, caminhoOutput) {
  return new Promise((resolve, reject) => {
    execFile(
      caminhoFfmpeg(),
      [
        '-y',                 // sobrescreve o output sem perguntar
        '-nostdin',           // nunca espera input do terminal (evita travar)
        '-i', caminhoInput,   // entrada
        '-vn',                // descarta a faixa de vídeo
        '-acodec', 'libmp3lame', // codifica p/ MP3
        '-q:a', '2',          // qualidade VBR alta (~190kbps) sem estourar tamanho
        caminhoOutput         // saída
      ],
      {
        timeout: TIMEOUT_FFMPEG_MS,
        killSignal: 'SIGKILL',
        maxBuffer: 10 * 1024 * 1024 // o stderr do ffmpeg pode ser verboso
      },
      (error, stdout, stderr) => {
        if (!error) return resolve();

        const saida = (stderr || '').toString();
        const detalhe = saida.split('\n').filter(Boolean).slice(-3).join(' ');

        // Tradução das falhas comuns do ffmpeg p/ avisos de chat:
        if (error.killed || error.signal === 'SIGKILL' || error.code === 'ETIMEDOUT') {
          error.timeout = true;
        } else if (/does not contain any stream|matches no streams|does not match any streams/i.test(saida)) {
          // ffmpeg terminou sem gerar stream de áudio nenhum: o vídeo é mudo
          error.semAudio = true;
        } else if (/Invalid data found when processing input|Unable to find a suitable output format/i.test(saida)) {
          error.corrompido = true;
        }
        error.mensagemFfmpeg = detalhe;
        reject(error);
      }
    );
  });
}

module.exports = { converterParaMp3, apagarComRetry, caminhoFfmpeg, TIMEOUT_FFMPEG_MS };
