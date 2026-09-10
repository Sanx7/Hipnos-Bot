const fs = require('fs')
const path = require('path')
const os = require('os')

const DURACAO_MAXIMA_SEGUNDOS = 600
const TIMEOUT_DOWNLOAD_MS = Number(process.env.PLAY_TIMEOUT_MS || 90000)
const LIMITE_BYTES = Number(process.env.PLAY_LIMITE_MB || 20) * 1024 * 1024
const QUALIDADE_PADRAO = process.env.TUNELIO_QUALIDADE || 'mp3'
const API_BASE = 'https://tunelio.dev'
const API_KEY = process.env.TUNELIO_API_KEY

const REGEX_EH_LINK = /^https?:\/\//i
const REGEX_YOUTUBE = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/i
const downloadsEmAndamento = new Set()

class ErroPlay extends Error {
  constructor(mensagemUsuario, motivo) {
    super(motivo || mensagemUsuario)
    this.name = 'ErroPlay'
    this.mensagemUsuario = mensagemUsuario
  }
}

async function responder(sock, jid, msg, texto) {
  try {
    await sock.sendMessage(jid, { text: texto }, { quoted: msg })
  } catch (err) {
    console.error('[play] Falha ao enviar mensagem:', err?.message || err)
  }
}

async function chamarTunelio(endpoint, params) {
  params = params || {}
  if (!API_KEY) {
    throw new ErroPlay('\u{1F511} O /play nao esta configurado no servidor!', 'TUNELIO_API_KEY nao definida')
  }
  var url = new URL(API_BASE + endpoint)
  Object.keys(params).forEach(function(k) {
    var v = params[k]
    if (v !== undefined && v !== null) url.searchParams.set(k, v)
  })
  var controller = new AbortController()
  var timeoutId = setTimeout(function() { controller.abort() }, 30000)
  try {
    var resp = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Accept': 'application/json',
        'User-Agent': 'Hipnos-Bot/1.0'
      },
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resp.ok) {
      var corpoErro = ''
      try { corpoErro = await resp.text() } catch (e) {}
      if (resp.status === 401 || resp.status === 403) {
        throw new ErroPlay('\u{1F511} Chave da API Tunelio invalida ou expirada!', 'HTTP ' + resp.status)
      }
      if (resp.status === 402) {
        throw new ErroPlay('\u{1F4B3} Creditos insuficientes na conta Tunelio!', 'HTTP ' + resp.status)
      }
      if (resp.status === 404) {
        throw new ErroPlay('\u{1F50E} Video nao encontrado no YouTube!', 'HTTP ' + resp.status)
      }
      if (resp.status === 429) {
        throw new ErroPlay('\u{23F3} Muitas requisicoes. Aguarde um momento!', 'HTTP ' + resp.status)
      }
      throw new ErroPlay('\u{274C} Erro ao consultar a API Tunelio (HTTP ' + resp.status + ')!', 'HTTP ' + resp.status)
    }
    return await resp.json()
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof ErroPlay) throw err
    if (err.name === 'AbortError') {
      throw new ErroPlay('\u{23F1}\u{FE0F} A API demorou demais. Tente novamente!', 'timeout')
    }
    throw new ErroPlay('\u{1F310} Sem conexao com a API Tunelio!', err.message || String(err))
  }
}

async function baixarArquivo(urlDownload, destinoFinal) {
  var controller = new AbortController()
  var timeoutId = setTimeout(function() { controller.abort() }, TIMEOUT_DOWNLOAD_MS)
  try {
    var resp = await fetch(urlDownload, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'Hipnos-Bot/1.0' }
    })
    clearTimeout(timeoutId)
    if (!resp.ok) {
      throw new ErroPlay('\u{274C} Falha ao baixar (HTTP ' + resp.status + '). Link pode ter expirado!', 'download HTTP ' + resp.status)
    }
    var buffer = Buffer.from(await resp.arrayBuffer())
    if (buffer.length === 0) {
      throw new ErroPlay('\u{274C} Arquivo baixado esta vazio!', 'buffer vazio')
    }
    fs.writeFileSync(destinoFinal, buffer)
    return buffer.length
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof ErroPlay) throw err
    if (err.name === 'AbortError') {
      throw new ErroPlay('\u{23F1}\u{FE0F} Download demorou demais. Tente uma musica mais curta!', 'timeout')
    }
    throw new ErroPlay('\u{1F310} Erro durante o download!', err.message || String(err))
  }
}

function limparTemporarios(pasta, prefixo) {
  try {
    var arquivos = fs.readdirSync(pasta)
    for (var i = 0; i < arquivos.length; i++) {
      var arq = arquivos[i]
      if (arq.indexOf(prefixo) === 0) {
        try { fs.unlinkSync(path.join(pasta, arq)) } catch (e) {}
      }
    }
  } catch (e) {}
}

function formatarDuracao(segundos) {
  var min = Math.floor(segundos / 60)
  var seg = Math.floor(segundos % 60)
  return min + ':' + seg.toString().padStart(2, '0')
}

function mensagemAmigavel(err) {
  if (err instanceof ErroPlay) return err.mensagemUsuario
  return '\u{1F615} Algo deu errado ao processar o /play. Tente novamente!'
}
// ---- EXPORTACAO PRINCIPAL ----
module.exports = {
  nome: 'play',
  descricao: 'Baixa e envia audio de video do YouTube',
  executar: async function(sock, jid, msg, texto) {
    var args = String(texto || '').split(' ').slice(1).filter(Boolean)
    var estampaTemp = null
    try {
      if (!API_KEY) {
        return await responder(sock, jid, msg, '*Indisponivel:* o /play nao foi configurado. Avise o administrador.')
      }
      if (!args || args.length === 0) {
        return await responder(sock, jid, msg, '*Uso:* /play <link do YouTube>')
      }
      if (downloadsEmAndamento.has(jid)) {
        return await responder(sock, jid, msg, 'Ja tem um download em andamento. Aguarde!')
      }
      downloadsEmAndamento.add(jid)
      var termo = args.join(' ').trim()
      var url = null
      var titulo = null
      var duracaoSegundos = null
      if (REGEX_EH_LINK.test(termo)) {
        if (!REGEX_YOUTUBE.test(termo)) {
          return await responder(sock, jid, msg, 'Esse link nao parece ser do YouTube!')
        }
        url = termo
        await responder(sock, jid, msg, '*Link recebido!* Buscando na Tunelio...')
      } else {
        return await responder(sock, jid, msg, 'A Tunelio so aceita links diretos. Use: /play <url>')
      }
      var info = await chamarTunelio('/info', { url: url })
      titulo = info.title || 'musica'
      duracaoSegundos = info.duration_seconds
      if (!duracaoSegundos || duracaoSegundos <= 0) {
        return await responder(sock, jid, msg, 'Nao da para baixar transmissoes ao vivo!')
      }
      if (duracaoSegundos > DURACAO_MAXIMA_SEGUNDOS) {
        return await responder(sock, jid, msg, 'A musica nao pode ter mais de 10 minutos!')
      }
      await responder(sock, jid, msg, '*Encontrado!*\n\n*Titulo:* ' + titulo + '\n*Duracao:* ' + formatarDuracao(duracaoSegundos) + '\n\n*Processando...*')
      var resultado = await chamarTunelio('/create', { url: url, quality: QUALIDADE_PADRAO })
      if (!resultado.url) {
        throw new ErroPlay('Tunelio nao retornou link de download valido!', 'url ausente')
      }
      var pastaTemp = os.tmpdir()
      estampaTemp = Date.now()
      var extensao = QUALIDADE_PADRAO === 'mp3' ? 'mp3' : 'opus'
      var caminhoFinal = path.join(pastaTemp, 'play_' + estampaTemp + '.' + extensao)
      var tamanhoBytes = await baixarArquivo(resultado.url, caminhoFinal)
      if (tamanhoBytes > LIMITE_BYTES) {
        return await responder(sock, jid, msg, 'Audio muito grande (' + (tamanhoBytes / 1048576).toFixed(1) + ' MB). Limite: ' + Math.floor(LIMITE_BYTES / 1048576) + ' MB.')
      }
      if (!fs.existsSync(caminhoFinal) || fs.statSync(caminhoFinal).size === 0) {
        throw new ErroPlay('Arquivo baixado esta vazio!', 'arquivo nao criado')
      }
      var mimetype = QUALIDADE_PADRAO === 'opus' ? 'audio/ogg; codecs=opus' : 'audio/mpeg'
      try {
        await sock.sendMessage(jid, {
          audio: fs.readFileSync(caminhoFinal),
          mimetype: mimetype,
          ptt: false
        }, { quoted: msg })
      } catch (errEnvio) {
        console.error('[play] Falha ao enviar:', errEnvio)
        await responder(sock, jid, msg, 'Baixei mas nao consegui enviar. Tente novamente!')
      }
    } catch (err) {
      console.error('[play] Erro tratado:', err)
      await responder(sock, jid, msg, mensagemAmigavel(err))
    } finally {
      downloadsEmAndamento.delete(jid)
      if (estampaTemp) limparTemporarios(os.tmpdir(), 'play_' + estampaTemp)
    }
  }
}
