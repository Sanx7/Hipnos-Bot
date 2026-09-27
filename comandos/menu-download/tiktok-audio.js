// ============================================================
// 🎵 TIKTOK-ÁUDIO — Só o SOM do vídeo do TikTok
// ============================================================
// /tiktok-audio (aliases: tiktok-aud, tiktok-mp3, tt-audio, tk-audio)
//   Ex.: /tiktok-audio https://vm.tiktok.com/xxxxx/
//
// REAPROVEITA O /tik-tok (mesmo módulo, menu-download/tiktok.js):
//   - mesma lib (@tobyg74/tiktok-api-dl) e MESMA cascata v1→v2→v3 (15s por
//     tentativa, fonte por trás diferente em cada versão);
//   - MESMA validação de link (extrairLink, o mesmo regex do /tik-tok) —
//     vm.tiktok.com / vt.tiktok.com / www.tiktok.com;
//   - mesmo teto de 50MB (baixarComLimite) e a mesma limpeza de temporário
//     em os.tmpdir() com apagarComRetry (padrão do /tomp3).
//
// DOIS CAMINHOS (o primeiro que resolver, sem baixar o vídeo à toa):
//   1) ♪ ÁUDIO DIRETO — a lib entrega a faixa (music.playUrl em v1/v2,
//      music em string no v3): baixa só o áudio e envia. Sem ffmpeg.
//   2) 🎬 VÍDEO → MP3 — quando a fonte não publica faixa (som original,
//      mudança de API): baixa o vídeo e extrai o áudio com o ffmpeg em
//      PROCESSO FILHO via audio-extrator.js (o MESMO módulo compartilhado
//      do /tomp3 e do /transcrever) — args em array, sem shell.
//
// Envio: { audio, mimetype: 'audio/mpeg', ptt: false } — mesmo formato do
// /play e do /tomp3 (áudio comum, NÃO vira "voz").
//
// 🛡️ Garantias: erro de ffmpeg traduzido (sem faixa / corrompido /
// timeout) em aviso amigável pt-BR; tudo é envolvido em try/catch (a
// conexão nunca cai); os temporários são apagados no finally, com retry
// para o EPERM/EBUSY do Windows.
// ============================================================

const fs = require('fs')
const os = require('os')
const path = require('path')
// 🔗 Fonte ÚNICA do link: o próprio módulo do /tik-tok (lib + cascata +
// regex de validação + teto de 50MB).
const tiktok = require('./tiktok')
// 🎛️ Conversão por ffmpeg + limpeza com retry — módulo COMPARTILHADO do
// /tomp3 e do /transcrever (nunca sharp/libvips in-process).
const { converterParaMp3, apagarComRetry } = require('../menu-utilitario/audio-extrator')

// ─── Avisos (pt-BR, temática onírica) ───
const AVISO_USO =
  '🎵 *Como usar o áudio do TikTok*\n\n' +
  'Envie um link de vídeo do TikTok junto do comando:\n' +
  '`/tiktok-audio https://vm.tiktok.com/xxxxx/`\n\n' +
  'Aceito `vm.tiktok.com`, `vt.tiktok.com` e `www.tiktok.com` — o comando manda só o som, em MP3 (até 50 MB). 🌙'

const AVISO_GRANDE = (mb) =>
  `⛔ *Esse arquivo é pesado demais para os portões do sonho...* (~${mb} MB)\n\nO limite é de *${tiktok.LIMITE_MB} MB*. Tente um vídeo mais leve. 🌙`

const ERRO_SEM_AUDIO =
  '🔇 *Esse vídeo não tem som algum...*\n\n' +
  'Hipnos ouviu apenas silêncio. Tente um vídeo que tenha faixa de áudio. 🌙'

const ERRO_CORROMPIDO =
  '📼 *Esse arquivo parece corrompido...*\n\nNão consegui ler o áudio do vídeo. Tente com outro link. 🌙'

const ERRO_TIMEOUT =
  '⏳ *A conversão demorou demais e foi interrompida...*\n\n' +
  'O vídeo deve ser muito longo ou pesado. Tente com um trecho menor. 🌙'

const ERRO_FINAL =
  '❌ Não consegui baixar o áudio desse TikTok no momento. Tente novamente mais tarde ou com outro link. 🌙'

// ─── O arquivo direto da lib já é MP3? ───
// /\.mp3(\?|#|$)/i — as URLs do TikTok vêm com query string; o ffmpeg é
// acionado quando o formato NÃO é mp3 (m4a/aac/ogg) ou não dá pra saber.
function ehMp3 (url) {
  return /\.mp3(\?|#|$)/i.test(String(url || ''))
}

// ─── Título/legenda do envio (só o que a lib entregou) ───
function legenda (info) {
  const linhas = ['🎵 *Áudio do TikTok*']
  if (info.musica) linhas.push(`\n🎼 ${info.musica}`)
  if (info.titulo) linhas.push(`\n🎬 ${info.titulo}`)
  if (info.autor) linhas.push(`\n👤 @${info.autor}`)
  return linhas.join('')
}

// ─── Caminho temporário único (os.tmpdir() = /tmp no Render) ───
function caminhoTemporario (idUnico, extensao) {
  return path.join(os.tmpdir(), `tiktok-audio_${idUnico}.${extensao}`)
}

// ─── Traduz QUALQUER falha em aviso amigável ───
function avisoParaErro (err) {
  if (err instanceof tiktok.ErroTiktok && err.tipo === 'uso') return AVISO_USO
  if (err instanceof tiktok.ErroTiktok && err.tipo === 'grande') {
    return AVISO_GRANDE((String(err.message).match(/[\d.]+/) || [])[0] || tiktok.LIMITE_MB + 1)
  }
  if (err?.semAudio) return ERRO_SEM_AUDIO
  if (err?.corrompido) return ERRO_CORROMPIDO
  if (err?.timeout) return ERRO_TIMEOUT
  return ERRO_FINAL
}

// ─── Executar (padrão do loader: nome/executar) ───
async function executar (sock, jid, msg, text) {
  let caminhoTemp = null

  try {
    // 1) Validação de link IDÊNTICA à do /tik-tok (mesmo regex, mesma lib)
    const link = tiktok.extrairLink(text)
    if (!link) throw new tiktok.ErroTiktok('link ausente ou inválido', 'uso')

    const idUnico = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // 2) Procura o ÁUDIO na cascata v1 → v2 → v3 (ou o vídeo, se não houver
    //    faixa publicada). 15s por tentativa, sem somar entre as versões.
    const info = await tiktok.resolverAudio(link)

    // 3) Caminho 1 — faixa direto: já é MP3, envia sem passar pelo ffmpeg
    if (info.origem === 'audio' && ehMp3(info.url)) {
      console.log('[tiktok-audio] ♪ faixa direta em MP3 — sem ffmpeg')
      const buffer = await tiktok.baixarComLimite(info.url, 'áudio')
      return await sock.sendMessage(jid, {
        audio: buffer,
        mimetype: 'audio/mpeg',
        ptt: false,
        caption: legenda(info)
      }, { quoted: msg })
    }

    // 4) Caminho 2 — vídeo (ou áudio em outro formato): extrai p/ MP3
    const rotulo = info.origem === 'audio' ? 'áudio' : 'vídeo'
    console.log(`[tiktok-audio] 🎬 baixando o ${rotulo} e extraindo o áudio via ffmpeg...`)
    const buffer = await tiktok.baixarComLimite(info.url, rotulo)

    const entrada = info.origem === 'audio' ? 'm4a' : 'mp4'
    caminhoTemp = caminhoTemporario(idUnico, entrada)
    const saidaMp3 = caminhoTemporario(idUnico, 'mp3')

    fs.writeFileSync(caminhoTemp, buffer)
    await converterParaMp3(caminhoTemp, saidaMp3)

    if (!fs.existsSync(saidaMp3) || fs.statSync(saidaMp3).size === 0) {
      throw new Error('ffmpeg não produziu o arquivo MP3')
    }
    console.log(`[tiktok-audio] ✅ MP3 pronto: ${fs.statSync(saidaMp3).size} bytes`)

    // 5) Envia como ÁUDIO comum (ptt: false), citando o comando
    await sock.sendMessage(jid, {
      audio: fs.readFileSync(saidaMp3),
      mimetype: 'audio/mpeg',
      ptt: false,
      caption: legenda(info)
    }, { quoted: msg })

    // 6) Limpa o MP3 gerado (o finally cuida do resto)
    await apagarComRetry(saidaMp3)
  } catch (err) {
    console.error('[tiktok-audio] erro ao baixar o áudio:', err?.message || err)
    if (err?.mensagemFfmpeg) console.error('[tiktok-audio] 📎 detalhe do ffmpeg:', err.mensagemFfmpeg)
    await sock.sendMessage(jid, { text: avisoParaErro(err) }, { quoted: msg }).catch(() => {})
  } finally {
    // 🧹 Limpeza SEMPRE (sucesso ou falha) — apagarComRetry nunca lança
    if (caminhoTemp) await apagarComRetry(caminhoTemp)
  }
}

module.exports = {
  nome: 'tiktok-audio',
  aliases: ['tiktok-aud', 'tiktok-mp3', 'tt-audio', 'tk-audio', 'tiktokmusica'],
  descricao: 'Baixa só o áudio (MP3) de um vídeo do TikTok a partir do link (até 50 MB).',
  executar,
  // Extras internos para os testes offline (padrão do tiktok.js)
  ehMp3,
  legenda,
  avisoParaErro,
  caminhoTemporario,
  AVISO_USO,
  AVISO_GRANDE,
  ERRO_SEM_AUDIO,
  ERRO_CORROMPIDO,
  ERRO_TIMEOUT,
  ERRO_FINAL
}