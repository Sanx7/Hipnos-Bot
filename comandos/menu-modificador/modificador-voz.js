// ============================================
// 🔉 MODIFICADOR DE VOZ — parte 1/3: base + filtros
// ============================================
// 8 comandos que aplicam efeitos de áudio numa nota de voz ou áudio
// citado (REPLY), com ffmpeg em PROCESSO FILHO (regra de ouro do
// projeto — execFile com args em ARRAY, sem shell, sem injeção).
// Entrada obrigatória: reply a audioMessage (ptt ou áudio comum).
// Saída: reenvia preservando ptt — mesmo padrão do /revelaraudio.
// Limites: > 20MB ou > ~3 min (180s) → aviso amigável.
// Filtros testados de verdade no ffmpeg em 29/09/2026
// (scripts/sonda-voz.cjs, tom 440+660Hz 2s/44100Hz): todos os 8 OK.
// ============================================

const {
  downloadMediaMessage,
  normalizeMessageContent,
  getContentType
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const { caminhoFfmpeg, apagarComRetry } = require('../menu-utilitario/audio-extrator');

const LIMITE_MB = 20;
const LIMITE_BYTES = LIMITE_MB * 1024 * 1024;
const LIMITE_SEGUNDOS = 180;
const TIMEOUT_FFMPEG_MS = 120000;

let baixarMidia = (alvo) => downloadMediaMessage(alvo, 'buffer', {});
let rodarFfmpeg = (args) => new Promise((resolve, reject) => {
  execFile(
    caminhoFfmpeg(),
    args,
    { timeout: TIMEOUT_FFMPEG_MS, killSignal: 'SIGKILL', maxBuffer: 10 * 1024 * 1024 },
    (error, stdout, stderr) => {
      if (!error) return resolve();
      error.mensagemFfmpeg = String(stderr || '').split('\n').filter(Boolean).slice(-3).join(' ');
      reject(error);
    }
  );
});

const AVISO_SEM_REPLY = (cmd) =>
  `🔉 *Falta o áudio...*\n\nResponda (marque) uma nota de voz ou áudio com \`/${cmd}\` para aplicar o efeito.\n\n🗝️ Exemplo: cite a nota de voz e escreva \`/${cmd}\``;

const AVISO_NAO_EH_AUDIO =
  '🔉 *Isso não é um áudio...*\n\nHipnos só distorce vozes — responda (marque) uma nota de voz ou áudio comum com o comando do efeito.';

const AVISO_GRANDE =
  `⛔ *Esse áudio é grande demais para o caldeirão...*\n\nO limite do modificador de voz é de *${LIMITE_MB}MB* ou *~3 minutos*. Mande um trecho menor e tente de novo.`;

const AVISO_GENERICO =
  '❌ Não consegui aplicar o efeito nesse áudio agora — o feitiço falhou, mas Hipnos segue de pé. Tente novamente em instantes.';

function aplicarFiltro(caminhoInput, caminhoOutput, filtro) {
  return rodarFfmpeg([
    '-y',
    '-nostdin',
    '-i', caminhoInput,
    '-af', filtro,
    '-c:a', 'libopus',
    caminhoOutput
  ]);
}
// ─── 📨 Fábrica de handlers (um por efeito) ───
function criarHandler(nome, filtro, emoji, rotulo) {
  return async function executar(sock, jid, msg) {
    let caminhoInput = null;
    let caminhoOutput = null;
    try {
      const conteudoMsg = normalizeMessageContent(msg.message) || {};
      const contexto = conteudoMsg.extendedTextMessage?.contextInfo
        || conteudoMsg.imageMessage?.contextInfo
        || conteudoMsg.videoMessage?.contextInfo
        || conteudoMsg.audioMessage?.contextInfo;
      const mQuoted = contexto?.quotedMessage;
      if (!mQuoted) {
        return await sock.sendMessage(jid, { text: AVISO_SEM_REPLY(nome) }, { quoted: msg }).catch(() => {});
      }
      const conteudoQuoted = normalizeMessageContent(mQuoted) || {};
      const tipoConteudo = getContentType(conteudoQuoted);
      const audioCit = conteudoQuoted.audioMessage;
      const ehAudio = tipoConteudo === 'audioMessage' && typeof audioCit === 'object';
      if (!ehAudio) {
        return await sock.sendMessage(jid, { text: AVISO_NAO_EH_AUDIO }, { quoted: msg }).catch(() => {});
      }
      const segundos = Number(audioCit?.seconds);
      if (Number.isFinite(segundos) && segundos > LIMITE_SEGUNDOS) {
        await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {});
        return await sock.sendMessage(jid, { text: AVISO_GRANDE }, { quoted: msg }).catch(() => {});
      }
      await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {});
      const mensagemAlvo = { key: msg.key, message: mQuoted };
      console.log(`[${nome}] ⬇️ baixando áudio citado via downloadMediaMessage...`);
      const buffer = await baixarMidia(mensagemAlvo);
      console.log(`[${nome}] ✅ download concluído: ${buffer?.length ?? 'n/d'} bytes`);
      if (!buffer || buffer.length === 0) {
        throw new Error('O áudio foi baixado vazio (0 bytes).');
      }
      if (buffer.length > LIMITE_BYTES) {
        await sock.sendMessage(jid, { text: AVISO_GRANDE }, { quoted: msg }).catch(() => {});
        return await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {});
      }
      const idUnico = `${nome}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      caminhoInput = path.join(os.tmpdir(), `${idUnico}-in.ogg`);
      caminhoOutput = path.join(os.tmpdir(), `${idUnico}-out.ogg`);
      fs.writeFileSync(caminhoInput, buffer);
      console.log(`[${nome}] 🎛️ aplicando filtro via ffmpeg (processo filho): ${filtro}`);
      await aplicarFiltro(caminhoInput, caminhoOutput, filtro);
      if (!fs.existsSync(caminhoOutput) || fs.statSync(caminhoOutput).size === 0) {
        throw new Error('ffmpeg não produziu o áudio de saída.');
      }
      console.log(`[${nome}] ✅ efeito pronto: ${fs.statSync(caminhoOutput).size} bytes`);
      const ptt = audioCit?.ptt === true;
      await sock.sendMessage(jid, {
        audio: fs.readFileSync(caminhoOutput),
        mimetype: 'audio/ogg; codecs=opus',
        ptt
      }, { quoted: msg });
      await sock.sendMessage(jid, { text: `${emoji} *${rotulo}* ${emoji}\n\n🪐 Hipnos distorceu a voz no limbo.` }).catch(() => {});
      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {});
      console.log(`[${nome}] ✅ áudio com efeito enviado (ptt: ${ptt})`);
    } catch (err) {
      console.error(`[${nome}] erro:`, err?.stack || err);
      if (err?.mensagemFfmpeg) console.error(`[${nome}] stderr:`, err.mensagemFfmpeg);
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {});
      await sock.sendMessage(jid, { text: AVISO_GENERICO }, { quoted: msg }).catch(() => {});
    } finally {
      for (const caminho of [caminhoInput, caminhoOutput]) {
        if (caminho) await apagarComRetry(caminho);
      }
    }
  };
}

// FILTROS-FIM
// Efeitos: filtros testados no ffmpeg em 29/09/2026 (sonda-voz.cjs).
const EFEITOS = [
  { nome: 'esquilo', descricao: 'Voz de esquilo (responda a um audio).', emoji: '\uD83D\uDC3F', rotulo: 'MODO ESQUILO', filtro: 'asetrate=44100*1.5,aresample=44100,atempo=1.1' },
  { nome: 'gigante', descricao: 'Voz de gigante (responda a um audio).', emoji: '\uD83E\uDDA3', rotulo: 'MODO GIGANTE', filtro: 'asetrate=44100*0.7,aresample=44100,atempo=1.2' },
  { nome: 'robo', descricao: 'Voz robotica (responda a um audio).', emoji: '\uD83E\uDD16', rotulo: 'MODO ROBO', filtro: 'aresample=44100,flanger=delay=15:depth=0.6:regen=60:width=70:speed=2,chorus=0.7:0.9:55:0.4:0.25:2,tremolo=f=8:d=0.6' },
  { nome: 'demonio', descricao: 'Voz de demonio (responda a um audio).', emoji: '\uD83D\uDE08', rotulo: 'MODO DEMONIO', filtro: 'asetrate=44100*0.6,aresample=44100,aecho=0.8:0.7:60:0.4,volume=1.5' },
  { nome: 'rapido', descricao: 'Acelera sem mudar o tom (responda a um audio).', emoji: '\u23E9', rotulo: 'MODO RAPIDO', filtro: 'atempo=1.5' },
  { nome: 'lento', descricao: 'Desacelera sem mudar o tom (responda a um audio).', emoji: '\u23EA', rotulo: 'MODO LENTO', filtro: 'atempo=0.6' },
  { nome: 'reverso', descricao: 'Toca de tras para frente (responda a um audio).', emoji: '\uD83D\uDD01', rotulo: 'MODO REVERSO', filtro: 'areverse' },
  { nome: 'estourar', descricao: 'Audio estourado (responda a um audio).', emoji: '\uD83D\uDCE2', rotulo: 'MODO ESTOURADO', filtro: 'volume=10,acrusher=level_in=8:level_out=8:bits=4:mode=log,volume=2' },
];

module.exports = EFEITOS.map((e) => ({
  nome: e.nome,
  descricao: e.descricao,
  executar: criarHandler(e.nome, e.filtro, e.emoji, e.rotulo),
  _filtro: e.filtro,
  _emoji: e.emoji,
}));

module.exports._injetar = (overrides = {}) => {
  if (typeof overrides.baixarMidia === 'function') baixarMidia = overrides.baixarMidia;
  if (typeof overrides.rodarFfmpeg === 'function') rodarFfmpeg = overrides.rodarFfmpeg;
};
module.exports.LIMITE_BYTES = LIMITE_BYTES;
module.exports.LIMITE_SEGUNDOS = LIMITE_SEGUNDOS;
module.exports.AVISO_SEM_REPLY = AVISO_SEM_REPLY;
module.exports.AVISO_NAO_EH_AUDIO = AVISO_NAO_EH_AUDIO;
module.exports.AVISO_GRANDE = AVISO_GRANDE;
module.exports.AVISO_GENERICO = AVISO_GENERICO;
