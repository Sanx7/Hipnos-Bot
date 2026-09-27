// ============================================================
// 📥 TIKTOK — Download de vídeo sem marca d'água (@tobyg74/tiktok-api-dl)
// ============================================================
// /tiktok (aliases: tt, tk, tik-tok, tiktokdl) <link>
//   Ex.: /tik-tok https://vm.tiktok.com/xxxxx/
//
// CASCATA: Downloader(link, {version:'v1'}) → v2 → v3. Cada versão usa um
// serviço terceiro diferente por trás (TiktokAPI, SSSTik, MusicalDown).
// Timeout de 15s POR tentativa (não soma). Só reporta erro ao usuário se
// as três falharem.
//
// ESTRUTURA DE RESPOSTA (lib 1.3.7 — confirmada nos tipos oficiais da lib):
//   - v1 (TiktokAPI) e v2 (SSSTik): { status, result: { video: { playAddr:
//     string[] }, title, author, ... } } → playAddr[0] vem SEM marca d'água.
//   - v3 (MusicalDown): { status, result: { videoHD, videoSD,
//     videoWatermark, ... } } → NUNCA usar videoWatermark.
//   - status: "success" | "error".
//
// Download via axios (arraybuffer). Limite de 50MB (mesmo padrão do /tomp3):
// checado pelo header content-length ANTES de consumir o corpo, e de novo
// no buffer final. Se passar, avisa o usuário em vez de tentar enviar.
//
// Thumbnail gerado pelo binário do ffmpeg em PROCESSO FILHO (@ffmpeg-installer
// + execFile com args em ARRAY — nunca sharp/libvips in-process). Ao receber
// jpegThumbnail pronto, a Baileys PULA a geração interna de thumb (o único
// caminho onde ela importaria sharp).
//
// ♪ ÁUDIO DIRETO (reaproveitado pelo /tiktok-audio): este módulo é a FONTE
// ÚNICA do link do TikTok. Além de extrairUrlResultado (vídeo sem marca),
// exporta extrairUrlAudio/resolverAudio, que buscam o ÁUDIO da faixa na
// MESMA cascata: music.playUrl (v1 TiktokAPI / v2 SSSTik — string[]) ou
// music como string (v3 MusicalDown). Quando a fonte não entrega faixa
// (vídeo com som original, fonte muda no futuro), devolve a URL do VÍDEO
// com origem:'video' — o /tiktok-audio extrai o áudio com o ffmpeg
// (audio-extrator.js, o mesmo do /tomp3 e do /transcrever).
// ============================================================

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const axios = require('axios')
const { Downloader } = require('@tobyg74/tiktok-api-dl')
const { caminhoFfmpeg, apagarComRetry } = require('../menu-utilitario/audio-extrator')

// ─── Configurações ───
const LIMITE_MB = 50 // mesmo padrão do /tomp3
const LIMITE_BYTES = LIMITE_MB * 1024 * 1024
const TIMEOUT_TENTATIVA_MS = 15000 // 15s por versão (v1/v2/v3 individual)
const TIMEOUT_DOWNLOAD_MS = 120000
const VERSOES_TENTATIVAS = ['v1', 'v2', 'v3'] // ordem exigida da cascata

// Regex: link de vídeo do TikTok (curto vm/vt ou longo www.tiktok.com)
const REGEX_LINK_TIKTOK = /https?:\/\/(?:www\.|vm\.|vt\.)?tiktok\.com\/[^\s]+/i

// ─── Mensagens (pt-BR, temática onírica do bot) ───
const AVISO_USO =
  '📥 *Como usar o TikTok do Hipnos*\n\n' +
  'Envie um link de vídeo do TikTok junto do comando:\n' +
  '`/tik-tok https://vm.tiktok.com/xxxxx/`\n\n' +
  'Aceito links `vm.tiktok.com`, `vt.tiktok.com` e `www.tiktok.com` — o vídeo vem sem marca d\'água (até 50 MB). 🌙'

const AVISO_GRANDE = (mb) =>
  `⛔ *Esse vídeo é pesado demais para os portões do sonho...* (~${mb} MB)\n\nO limite é de *${LIMITE_MB} MB*. Não vou tentar enviar — tente um vídeo mais leve. 🌙`

const ERRO_FINAL =
  '❌ Não consegui baixar esse vídeo do TikTok no momento, tente novamente mais tarde ou com outro link. 🌙'

// ─── Erros tipados ───
// tipo: 'uso' (link ausente/inválido) | 'grande' (>50MB) | 'falha' (cascata)
class ErroTiktok extends Error {
  constructor (mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroTiktok'
    this.tipo = tipo
  }
}

// ─── Extração do link (texto após o comando) ───
function extrairLink (texto) {
  const achado = String(texto || '').match(REGEX_LINK_TIKTOK)
  return achado ? achado[0] : null
}

// ─── Executa uma promessa com limite de tempo ───
function comTimeout (promessa, ms, motivo) {
  let timer = null
  return Promise.race([
    Promise.resolve(promessa),
    new Promise((_resolver, rejeitar) => {
      timer = setTimeout(() => rejeitar(new ErroTiktok(motivo, 'falha')), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

// ─── Ponto de injeção para testes offline (padrão dos extras do velha.js) ───
let chamarLib = (link, versao) => Downloader(link, { version: versao })
let timeoutTentativaMs = TIMEOUT_TENTATIVA_MS
const PADRAO_LIB = chamarLib
const PADRAO_TIMEOUT = timeoutTentativaMs

// ─── Extrai a URL SEM marca d'água do resultado (formatos v1/v2/v3) ───
function extrairUrlResultado (resultado) {
  if (!resultado || resultado.status === 'error' || !resultado.result) return null
  const r = resultado.result

  // v1 (TiktokAPI) / v2 (SSSTik): video.playAddr (string[]) sem marca d'água
  const play = r.video?.playAddr
  const base = { titulo: String(r.title || r.description || '').trim(), autor: String(r.author?.nickname || r.author?.unique_id || '').trim() }
  if (Array.isArray(play)) {
    const url = play.find((u) => typeof u === 'string' && u.length > 0)
    if (url) return { url, ...base }
  } else if (typeof play === 'string' && play.length > 0) {
    return { url: play, ...base }
  }

  // v3 (MusicalDown): videoHD > videoSD — JAMAIS videoWatermark
  for (const chave of ['videoHD', 'videoSD', 'video']) {
    const valor = r[chave]
    if (typeof valor === 'string' && valor.length > 0) return { url: valor, ...base }
  }
  return null
}

// ─── Tenta UMA versão da lib (15s de teto, individual) ───
async function tentarVersao (link, versao) {
  const resultado = await comTimeout(
    chamarLib(link, versao),
    timeoutTentativaMs,
    `versão ${versao} excedeu ${Math.round(timeoutTentativaMs / 1000)}s`
  )
  if (!resultado || resultado.status === 'error') {
    throw new ErroTiktok(`versão ${versao} recusou o vídeo (${resultado?.message || 'sem detalhes'})`, 'falha')
  }
  const video = extrairUrlResultado(resultado)
  if (!video || !video.url) {
    throw new ErroTiktok(`versão ${versao} não trouxe URL de vídeo utilizável`, 'falha')
  }
  return video
}

// ─── Cascata v1 → v2 → v3 (só falha de verdade se TODAS falharem) ───
async function resolverVideo (link) {
  const falhas = []
  for (const versao of VERSOES_TENTATIVAS) {
    try {
      return await tentarVersao(link, versao)
    } catch (err) {
      falhas.push(`${versao}: ${err?.message || err}`)
      console.error(`[tiktok] tentativa ${versao} falhou:`, err?.message || err)
    }
  }
  console.error('[tiktok] todas as versões falharam:', falhas.join(' | '))
  throw new ErroTiktok('todas as fontes falharam', 'falha')
}

// ─── Extrai a URL de ÁUDIO do resultado; sem faixa, cai no vídeo ───
// Devolve { url, origem: 'audio' | 'video', titulo, autor, musica }.
// A ordem de preferência é SEMPRE a faixa (music) — quando ela existe, o
// /tiktok-audio nem precisa do ffmpeg.
function extrairUrlAudio (resultado) {
  if (!resultado || resultado.status === 'error' || !resultado.result) return null
  const r = resultado.result
  const base = {
    titulo: String(r.title || r.description || '').trim(),
    autor: String(r.author?.nickname || r.author?.unique_id || r.author?.username || '').trim()
  }

  // v1 (TiktokAPI) / v2 (SSSTik): music.playUrl (string[])
  const faixa = r.music?.playUrl
  if (Array.isArray(faixa)) {
    const url = faixa.find((u) => typeof u === 'string' && u.length > 0)
    if (url) return { url, origem: 'audio', musica: String(r.music?.title || '').trim(), ...base }
  } else if (typeof faixa === 'string' && faixa.length > 0) {
    return { url: faixa, origem: 'audio', musica: String(r.music?.title || '').trim(), ...base }
  }

  // v3 (MusicalDown): music é a própria URL do áudio (string)
  if (typeof r.music === 'string' && r.music.length > 0) {
    return { url: r.music, origem: 'audio', musica: '', ...base }
  }

  // Sem faixa publicada → devolve o vídeo (o comando extrai o áudio depois)
  const video = extrairUrlResultado(resultado)
  if (video?.url) return { url: video.url, origem: 'video', musica: '', ...base }
  return null
}

// ─── Tenta UMA versão da lib buscando o ÁUDIO (15s de teto) ───
async function tentarVersaoAudio (link, versao) {
  const resultado = await comTimeout(
    chamarLib(link, versao),
    timeoutTentativaMs,
    `versão ${versao} excedeu ${Math.round(timeoutTentativaMs / 1000)}s`
  )
  if (!resultado || resultado.status === 'error') {
    throw new ErroTiktok(`versão ${versao} recusou o vídeo (${resultado?.message || 'sem detalhes'})`, 'falha')
  }
  const audio = extrairUrlAudio(resultado)
  if (!audio || !audio.url) {
    throw new ErroTiktok(`versão ${versao} não trouxe áudio nem vídeo utilizável`, 'falha')
  }
  return audio
}

// ─── Cascata de ÁUDIO v1 → v2 → v3 (mesma ordem do vídeo) ───
async function resolverAudio (link) {
  const falhas = []
  for (const versao of VERSOES_TENTATIVAS) {
    try {
      return await tentarVersaoAudio(link, versao)
    } catch (err) {
      falhas.push(`${versao}: ${err?.message || err}`)
      console.error(`[tiktok-audio] tentativa ${versao} falhou:`, err?.message || err)
    }
  }
  console.error('[tiktok-audio] todas as versões falharam:', falhas.join(' | '))
  throw new ErroTiktok('todas as fontes falharam', 'falha')
}

// ─── Baixa o MP4 via axios (arraybuffer), com limite de 50MB ───
async function baixarVideo (url) {
  return baixarComLimite(url, 'vídeo')
}

// ─── Download genérico com teto de tamanho (usado p/ áudio e vídeo) ───
// `rotulo` só muda o texto do erro ("vídeo de X MB" / "áudio de X MB").
async function baixarComLimite (url, rotulo = 'mídia') {
  const resposta = await axios.get(url, {
    responseType: 'stream',
    timeout: TIMEOUT_DOWNLOAD_MS,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Referer: 'https://www.tiktok.com/'
    }
  })
  try {
    // ⛔ Limite pelo header ANTES de consumir o corpo
    const declarado = Number(resposta.headers?.['content-length'])
    if (Number.isFinite(declarado) && declarado > LIMITE_BYTES) {
      throw new ErroTiktok(`${rotulo} de ${(declarado / 1048576).toFixed(1)} MB excede o limite de ${LIMITE_MB} MB`, 'grande')
    }
    const partes = []
    let total = 0
    await new Promise((resolver, rejeitar) => {
      resposta.data.on('data', (pedaco) => {
        total += pedaco.length
        if (total > LIMITE_BYTES) {
          resposta.data.destroy()
          rejeitar(new ErroTiktok(`${rotulo} de ${(total / 1048576).toFixed(1)} MB excede o limite de ${LIMITE_MB} MB`, 'grande'))
          return
        }
        partes.push(pedaco)
      })
      resposta.data.on('end', resolver)
      resposta.data.on('error', rejeitar)
    })
    const buffer = Buffer.concat(partes)
    if (buffer.length === 0) throw new ErroTiktok(`o download do ${rotulo} voltou vazio`, 'falha')
    return buffer
  } catch (err) {
    resposta.data.destroy()
    throw err
  }
}

// ─── Gera o jpegThumbnail do MP4 com o ffmpeg em PROCESSO FILHO ───
// execFile com args em ARRAY: nada passa por shell → sem injeção.
// NUNCA rejeita: em falha devolve null e a mensagem sai sem preview
// (nunca sharp/libvips — único caminho da Baileys que importaria sharp).
function gerarThumbnailVideo (caminhoVideo, idUnico) {
  return new Promise((resolver) => {
    const pastaTemp = os.tmpdir()
    const caminhoThumb = path.join(pastaTemp, `tiktok_thumb_${idUnico}.jpg`)
    const args = [
      '-y', '-nostdin',
      '-ss', '00:00:01.000', // pega um frame do início (skip rápido)
      '-i', caminhoVideo,
      '-vframes', '1',
      '-vf', 'scale=320:-2',
      '-q:v', '5',
      caminhoThumb
    ]
    execFile(caminhoFfmpeg(), args, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (erro) => {
      try {
        if (!erro && fs.existsSync(caminhoThumb)) {
          const bufferThumb = fs.readFileSync(caminhoThumb)
          if (bufferThumb.length > 0) {
            return resolver({ base64: bufferThumb.toString('base64'), caminho: caminhoThumb })
          }
        }
        console.error('[tiktok] ⚠️ ffmpeg não gerou thumbnail — enviando sem preview:', erro?.message || 'arquivo ausente')
      } catch (errLeitura) {
        console.error('[tiktok] ⚠️ falha ao ler thumbnail:', errLeitura?.message)
      }
      resolver({ base64: null, caminho: caminhoThumb })
    })
  })
}

// ─── Grava o buffer em temporário, gera thumb, envia e limpa ───
async function enviarVideo (sock, jid, msg, buffer, video) {
  const idUnico = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const caminhoTemp = path.join(os.tmpdir(), `tiktok_${idUnico}.mp4`)
  let caminhoThumb = null
  try {
    fs.writeFileSync(caminhoTemp, buffer)

    // Thumbnail via ffmpeg (processo filho) — ao passar jpegThumbnail pronto,
    // a Baileys PULA a geração interna (o único ponto onde ela usaria sharp).
    const thumb = await gerarThumbnailVideo(caminhoTemp, idUnico)
    caminhoThumb = thumb.caminho

    const legenda = [
      '📥 *TikTok sem marca d\'água*',
      video.titulo ? `\n🎬 ${video.titulo}` : '',
      video.autor ? `\n👤 @${video.autor}` : ''
    ].filter(Boolean).join('')

    const conteudo = {
      video: buffer,
      caption: legenda,
      mimetype: 'video/mp4'
    }
    if (thumb.base64) conteudo.jpegThumbnail = Buffer.from(thumb.base64, 'base64')

    return await sock.sendMessage(jid, conteudo, { quoted: msg })
  } finally {
    await apagarComRetry(caminhoTemp)
    await apagarComRetry(caminhoThumb)
  }
}

// ─── Traduz o erro tipado em aviso amigável (pt-BR) ───
function avisoParaErro (err) {
  if (err instanceof ErroTiktok && err.tipo === 'uso') return AVISO_USO
  if (err instanceof ErroTiktok && err.tipo === 'grande') return AVISO_GRANDE((err.message.match(/[\d.]+/) || [])[0] || LIMITE_MB + 1)
  return ERRO_FINAL
}

// ─── Executar (padrão do loader: nome/executar) ───
async function executar (sock, jid, msg, text) {
  try {
    const link = extrairLink(text)
    if (!link) throw new ErroTiktok('link ausente ou inválido', 'uso')

    // 1) Resolve a URL do vídeo (cascata v1 → v2 → v3, 15s por tentativa)
    const video = await resolverVideo(link)

    // 2) Baixa o MP4 (axios, arraybuffer, limite de 50MB)
    const buffer = await baixarVideo(video.url)

    // 3) Envia como vídeo com thumbnail do ffmpeg
    await enviarVideo(sock, jid, msg, buffer, video)
  } catch (err) {
    console.error('[tiktok] erro ao baixar o vídeo:', err)
    await sock.sendMessage(jid, { text: avisoParaErro(err) }, { quoted: msg }).catch(() => {})
  }
}

module.exports = {
  nome: 'tiktok',
  aliases: ['tt', 'tk', 'tik-tok', 'tiktokdl'],
  descricao: 'Baixa um vídeo do TikTok sem marca d\'água a partir do link (até 50 MB).',
  executar,
  // Extras internos para os testes offline (padrão dos extras do velha.js)
  extrairLink,
  resolverVideo,
  baixarVideo,
  extrairUrlResultado,
  // ♪ Reaproveitados pelo /tiktok-audio (mesma lib, mesma cascata, mesmo teto)
  extrairUrlAudio,
  resolverAudio,
  baixarComLimite,
  ErroTiktok,
  LIMITE_MB,
  _injetarLib: (fn, timeoutMs) => {
    chamarLib = fn || PADRAO_LIB
    timeoutTentativaMs = timeoutMs || PADRAO_TIMEOUT
  }
}


