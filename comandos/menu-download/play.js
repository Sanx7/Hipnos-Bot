// ============================================
// 🎵 PLAY — Música do YouTube (API Bronxys)
// ============================================
// /play <nome da música>
//   Ex.: /play Evidencias Chitãozinho
//
// Fluxo (API Bronxys — api.bronxyshost.com.br):
//   1) 🔎 GET /pesquisa_ytb?nome=<termo> → array de resultados
//      (titulo, url, videoId, thumb, tempo, views, autor, postado, desc).
//      Usamos SEMPRE o 1º resultado.
//   2) 🛡️ Filtros: sem resultado OU duração > 1 hora (o campo "tempo" no
//      formato "1:02:33" tem 7+ caracteres) → avisa e NÃO baixa.
//   3) 🖼️ Preview: envia a thumbnail (thumb) com legenda contendo
//      título/duração/autor — SEMPRE com jpegThumbnail gerado por NÓS via
//      ffmpeg em processo filho (mesma proteção do /wiki, /nasa e
//      /pinterest: evita a geração nativa da Baileys com sharp/libvips,
//      que derruba o processo num crash não capturável).
//   4) 🎧 Áudio: GET /play?nome_url=<termo> retorna o áudio direto —
//      enviado à Baileys como { audio: { url } } com fileName baseado
//      no título da música.
//
// Variáveis de ambiente:
//   BRONXYS_API_KEY — chave da API Bronxys (pesquisa E download).
//                     Obrigatória: sem ela o comando só avisa.
//   PLAY_TIMEOUT_MS — opcional: timeout das chamadas (padrão 30s).
//
// Tratamento de erros (mesmo padrão dos outros comandos):
//   - try/catch em TUDO; nada escapa para o socket (o bot NÃO cai);
//   - aviso amigável em pt-BR pro usuário + console.error do erro real;
//   - lock por JID (1 download por chat por vez) — evita flood.
// ============================================

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile } = require('child_process')

// 🛠️ Helpers compartilhados do projeto (caminho do ffmpeg + delete com
// retry p/ Windows) — mesma fonte usada pelo /pinterest e /tomp3
const { caminhoFfmpeg, apagarComRetry } = require('../menu-utilitario/audio-extrator')

// ─── Configurações da API Bronxys ───
const API_BASE = 'https://api.bronxyshost.com.br/api-bronxys'

// 🔑 Chave da API Bronxys: vem EXCLUSIVAMENTE do ambiente
// (BRONXYS_API_KEY no .env local ou nas variáveis do Render).
// Sem fallback fixo no código: se não estiver configurada, o /play
// avisa e NÃO tenta nenhuma chave alternativa.
const API_KEY = (process.env.BRONXYS_API_KEY || '').trim()

// ⏳ Timeout das chamadas de busca/thumbnail (ms)
const TIMEOUT_BUSCA_MS = Number(process.env.PLAY_TIMEOUT_MS || 30000)

// Limite defensivo do download da thumbnail (5 MB)
const LIMITE_BYTES_THUMB = 5 * 1024 * 1024

// 🔒 1 download por chat por vez (mesmo padrão anti-flood da versão anterior)
const downloadsEmAndamento = new Set()

// 🧩 JPEG 8x8 válido (mesmo fallback do /wiki) — garante que o preview
// sempre saia com jpegThumbnail pronto mesmo se o ffmpeg falhar
const THUMB_FALLBACK_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzU4LjQyLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAEBEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgACAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AD//Z'

// 🚦 Erro tipado: mensagem pro usuário + motivo real pro log
class ErroPlay extends Error {
  constructor(mensagemUsuario, motivo) {
    super(motivo || mensagemUsuario)
    this.name = 'ErroPlay'
    this.mensagemUsuario = mensagemUsuario
  }
}

// ✉️ Resposta sempre com quote e à prova de falha (nunca derruba o bot)
async function responder(sock, jid, msg, texto) {
  try {
    await sock.sendMessage(jid, { text: texto }, { quoted: msg })
  } catch (err) {
    console.error('[play] Falha ao enviar mensagem:', err?.message || err)
  }
}

// ─── Chamada GET na API Bronxys (JSON) com timeout ───
async function chamarBronxys(endpoint, params, apiKey) {
  var url = new URL(API_BASE + endpoint)
  Object.keys(params).forEach(function (k) {
    var v = params[k]
    if (v !== undefined && v !== null) url.searchParams.set(k, v)
  })
  url.searchParams.set('apikey', apiKey)

  var controller = new AbortController()
  var timeoutId = setTimeout(function () { controller.abort() }, TIMEOUT_BUSCA_MS)
  try {
    var resp = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Hipnos-Bot/1.0'
      },
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resp.ok) {
      var corpoErro = ''
      try { corpoErro = await resp.text() } catch (e) {}
      console.error('[play] API Bronxys respondeu HTTP ' + resp.status + ':', String(corpoErro).slice(0, 300))
      if (resp.status === 401 || resp.status === 403) {
        throw new ErroPlay('🔑 Chave da API Bronxys inválida ou expirada! Avise o administrador.', 'HTTP ' + resp.status)
      }
      if (resp.status === 429) {
        throw new ErroPlay('⏳ Muitas requisições seguidas. Aguarde um momento e tente de novo!', 'HTTP ' + resp.status)
      }
      throw new ErroPlay('❌ A API do YouTube está fora do ar agora (HTTP ' + resp.status + '). Tente novamente em instantes!', 'HTTP ' + resp.status)
    }
    return await resp.json()
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof ErroPlay) throw err
    if (err.name === 'AbortError') {
      throw new ErroPlay('⏰ A busca demorou demais. Tente novamente!', 'timeout')
    }
    throw new ErroPlay('🌐 Sem conexão com a API do YouTube. Tente novamente em instantes!', err.message || String(err))
  }
}

// ⏱️ O campo "tempo" vem como "3:45" (m:ss) ou "1:02:33" (h:mm:ss).
// A partir de 7 caracteres o vídeo já passou de 1 hora → não baixa.
function tempoExcedeUmaHora(tempo) {
  return String(tempo || '').trim().length >= 7
}

// 🖼️ Baixa a thumbnail com limite de tamanho. Retorna Buffer ou null.
async function baixarImagem(urlImagem) {
  var controller = new AbortController()
  var timeoutId = setTimeout(function () { controller.abort() }, TIMEOUT_BUSCA_MS)
  try {
    var resp = await fetch(urlImagem, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'Hipnos-Bot/1.0' }
    })
    clearTimeout(timeoutId)
    if (!resp.ok) return null
    var buffer = Buffer.from(await resp.arrayBuffer())
    if (buffer.length === 0 || buffer.length > LIMITE_BYTES_THUMB) return null
    return buffer
  } catch (err) {
    clearTimeout(timeoutId)
    console.error('[play] ⚠️ Thumbnail indisponível:', err?.message || err)
    return null
  }
}

// 🖼️ Gera o jpegThumbnail via ffmpeg em PROCESSO FILHO (nunca sharp/libvips).
// Sempre resolve — em caso de falha devolve o JPEG 8x8 de fallback.
function gerarThumbnailJpeg(caminhoImagem, idUnico) {
  return new Promise((resolver) => {
    const pastaTemp = os.tmpdir()
    const caminhoThumb = path.join(pastaTemp, 'play_thumb_' + idUnico + '.jpg')
    const args = ['-y', '-nostdin', '-i', caminhoImagem, '-vf', 'scale=320:-2', '-q:v', '5', caminhoThumb]
    execFile(caminhoFfmpeg(), args, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (erro) => {
      try {
        if (!erro && fs.existsSync(caminhoThumb)) {
          const buf = fs.readFileSync(caminhoThumb)
          if (buf.length > 0) return resolver({ base64: buf.toString('base64'), caminho: caminhoThumb })
        }
        console.error('[play] ⚠️ ffmpeg não gerou thumbnail — usando fallback 8x8:', erro?.message || 'arquivo ausente')
      } catch (errLeitura) {
        console.error('[play] ⚠️ falha ao ler thumbnail:', errLeitura?.message)
      }
      resolver({ base64: THUMB_FALLBACK_JPEG_BASE64, caminho: caminhoThumb })
    })
  })
}

// 🧹 Sanitiza o título p/ virar nome de arquivo seguro (sem \/:*?"<>| etc.)
function limparNomeArquivo(titulo) {
  var nome = String(titulo || 'musica')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (nome.length > 60) nome = nome.slice(0, 60).trim()
  return nome || 'musica'
}

function mensagemAmigavel(err) {
  if (err instanceof ErroPlay) return err.mensagemUsuario
  return '😵 Algo deu errado ao processar o /play. Tente novamente!'
}

// ---- EXPORTACAO PRINCIPAL (mesmo contrato do loader: nome + executar) ----
module.exports = {
  nome: 'play',
  descricao: 'Busca e envia música do YouTube (API Bronxys)',
  executar: async function (sock, jid, msg, texto) {
    var args = String(texto || '').split(' ').slice(1).filter(Boolean)
    var caminhoImagemTemp = null
    var caminhoThumbTemp = null
    try {
      if (!API_KEY) {
        return await responder(sock, jid, msg,
          '⚠️ *BRONXYS_API_KEY não configurada!*\n\n' +
          'O /play precisa da chave da API Bronxys definida no ambiente\n' +
          '(.env local ou variável BRONXYS_API_KEY no Render).\n\n' +
          'Avise o administrador do bot. 🌙')
      }
      if (!args || args.length === 0) {
        return await responder(sock, jid, msg,
          '🎧 *Como usar o /play*\n\n' +
          'Envie o nome da música junto do comando:\n' +
          '`/play Evidencias Chitãozinho`')
      }
      if (downloadsEmAndamento.has(jid)) {
        return await responder(sock, jid, msg, '⌛ Já tem uma música sendo baixada nesse chat. Aguarde um instante!')
      }
      downloadsEmAndamento.add(jid)

      var termo = args.join(' ').trim()
      console.log('[play] 🔎 buscando: ' + termo)

      // 1) 🔎 Busca na Bronxys — usa sempre o 1º resultado
      var resultados = await chamarBronxys('/pesquisa_ytb', { nome: termo }, API_KEY)
      if (!Array.isArray(resultados) || resultados.length === 0) {
        return await responder(sock, jid, msg,
          '🔎 Não achei nenhuma música com esse nome.\n\n' +
          'Tente outras palavras: `/play <nome da música>`')
      }
      var video = resultados[0]
      var titulo = String(video.titulo || 'Música sem título')
      var autor = String(video.autor || 'Autor desconhecido')
      var tempo = String(video.tempo || 'duração desconhecida')
      console.log('[play] ① 1º resultado: ' + titulo + ' | ' + autor + ' | ' + tempo)

      // 2) 🛡️ Duração > 1 hora ("tempo" tipo "1:02:33" tem 7+ caracteres)
      if (tempoExcedeUmaHora(video.tempo)) {
        return await responder(sock, jid, msg,
          '⏱️ Essa música é longa demais (' + tempo + ').\n\n' +
          'Só aceito vídeos de até *1 hora*. Tente outra!')
      }

      // 3) 🖼️ Preview: thumbnail + legenda (título/duração/autor)
      var legenda =
        '🎵 *' + titulo + '*\n' +
        '👤 ' + autor + '\n' +
        '⏱️ ' + tempo + '\n\n' +
        '🔗 ' + String(video.url || ('https://youtu.be/' + video.videoId)) + '\n\n' +
        '🌙 *Preparando o áudio... aguarde!*'
      var bufferThumb = video.thumb ? await baixarImagem(video.thumb) : null
      if (bufferThumb) {
        const idUnico = Date.now() + '_' + Math.random().toString(36).slice(2, 8)
        caminhoImagemTemp = path.join(os.tmpdir(), 'play_img_' + idUnico + '.jpg')
        fs.writeFileSync(caminhoImagemTemp, bufferThumb)
        const thumb = await gerarThumbnailJpeg(caminhoImagemTemp, idUnico)
        caminhoThumbTemp = thumb.caminho
        try {
          await sock.sendMessage(jid, {
            image: bufferThumb,
            caption: legenda,
            jpegThumbnail: Buffer.from(thumb.base64, 'base64')
          }, { quoted: msg })
        } catch (erroEnvio) {
          // Preview falhou → cai pro texto (o áudio ainda é enviado)
          console.error('[play] falha no envio do preview (capturada):', erroEnvio?.message || erroEnvio)
          await responder(sock, jid, msg, legenda)
        }
      } else {
        await responder(sock, jid, msg, legenda) // sem thumbnail: só texto
      }

      // 4) 🎧 Baixa e envia o áudio (endpoint /play da Bronxys)
      var nomeArquivo = limparNomeArquivo(titulo) + '.mp3'
      var urlAudio = API_BASE + '/play?' +
        new URLSearchParams({ nome_url: termo, apikey: API_KEY }).toString()
      await sock.sendMessage(jid, {
        audio: { url: urlAudio },
        mimetype: 'audio/mpeg',
        fileName: nomeArquivo,
        ptt: false
      }, { quoted: msg })
      console.log('[play] ✅ áudio enviado: ' + nomeArquivo)
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa para o socket
      console.error('[play] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await responder(sock, jid, msg, mensagemAmigavel(err))
    } finally {
      downloadsEmAndamento.delete(jid)
      if (caminhoImagemTemp) await apagarComRetry(caminhoImagemTemp)
      if (caminhoThumbTemp) await apagarComRetry(caminhoThumbTemp)
    }
  }
}

