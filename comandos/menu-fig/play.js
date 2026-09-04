const ytdlpBase = require('youtube-dl-exec')
const fs = require('fs')
const path = require('path')
const os = require('os')

// ============================================================
// /play — download de áudio do YouTube via BINÁRIO REAL do yt-dlp
// ============================================================
// Por que yt-dlp e não ytdl-core?
// O YouTube passou a exigir a resolução de desafios em JavaScript antes de
// liberar os streams. Bibliotecas JS puras (ytdl-core, @distube/ytdl-core)
// quebram com frequência porque não conseguem resolver esses desafios.
// O yt-dlp resolve isso executando os scripts de desafio oficiais (EJS) num
// runtime JavaScript — aqui, o próprio Node.js, conforme a documentação
// oficial: https://github.com/yt-dlp/yt-dlp/wiki/EJS
//
// Este módulo NÃO reimplementa a lógica de download: ele apenas orquestra o
// binário yt-dlp (baixado automaticamente pelo pacote youtube-dl-exec no
// `npm install`), com timeout, limite de tamanho e isolamento total de erros.
// ============================================================

// Permite apontar para outro binário do yt-dlp (ex.: instalado via pip no
// servidor de deploy, variável YTDLP_PATH). Por padrão usa o binário que o
// youtube-dl-exec baixa para node_modules/youtube-dl-exec/bin.
const youtubedl = process.env.YTDLP_PATH
  ? ytdlpBase.create(process.env.YTDLP_PATH)
  : ytdlpBase

// --- Configurações (podem ser sobrescritas por variáveis de ambiente) ---
const DURACAO_MAXIMA_SEGUNDOS = 600 // 10 minutos (proteção do servidor)
const TIMEOUT_DOWNLOAD_MS = Number(process.env.PLAY_TIMEOUT_MS || 90000) // 90s
const LIMITE_BYTES = Number(process.env.PLAY_LIMITE_MB || 20) * 1024 * 1024
const MAX_FILESIZE_YTDLP = '25M' // trava ANTES de baixar (estimativa do yt-dlp)

// Se o texto começa com http/https é tratado como LINK direto (o yt-dlp
// extrai os dados do vídeo); qualquer outra coisa é TERMO DE BUSCA
const REGEX_EH_LINK = /^https?:\/\//i

// 1 download por chat por vez — evita sobrecarregar o servidor com vários /play
const downloadsEmAndamento = new Set()

// Caminho do ffmpeg embutido no projeto (@ffmpeg-installer/ffmpeg) — o yt-dlp
// precisa do ffmpeg para extrair/converter o áudio em MP3. Se não estiver
// disponível, o yt-dlp usa o ffmpeg do PATH do sistema.
let caminhoFfmpeg = null
try {
  const instaladorFfmpeg = require('@ffmpeg-installer/ffmpeg')
  if (instaladorFfmpeg?.path && fs.existsSync(instaladorFfmpeg.path)) {
    caminhoFfmpeg = instaladorFfmpeg.path
  }
} catch (err) {
  console.error('[play] @ffmpeg-installer indisponível, usando ffmpeg do PATH:', err?.message)
}

// Erro já "traduzido" para linguagem de usuário
class ErroPlay extends Error {
  constructor(mensagemUsuario, motivo) {
    super(motivo || mensagemUsuario)
    this.name = 'ErroPlay'
    this.mensagemUsuario = mensagemUsuario
  }
}

// Envia mensagem SEMPRE com segurança: se o envio falhar, apenas registra o
// erro no console (nunca estoura pra fora do comando)
async function responder(sock, jid, msg, texto) {
  try {
    await sock.sendMessage(jid, { text: texto }, { quoted: msg })
  } catch (err) {
    console.error('[play] Falha ao enviar mensagem:', err?.message || err)
  }
}

// Executa o binário real do yt-dlp com timeout + cancelamento garantido.
// Retorna a saída bruta (stdout) do processo.
async function executarYtDlp(url, flags, timeoutMs) {
  const subprocess = youtubedl.exec(url, flags, {
    windowsHide: true,
    // Redes de segurança NATIVAS do spawn: se o processo travar, ele é
    // morto sozinho mesmo que o timer abaixo falhe
    timeout: timeoutMs + 10000,
    killSignal: 'SIGKILL'
  })

  let expirou = false
  const timer = setTimeout(() => {
    expirou = true
    try {
      subprocess.kill('SIGKILL')
    } catch (errKill) { /* o processo já morreu */ }
  }, timeoutMs)

  try {
    const processo = await subprocess
    // O await do wrapper (tinyspawn) devolve o PROCESSO; a saída do yt-dlp
    // fica na propriedade .stdout (string), preenchida quando ele termina.
    if (processo && typeof processo.stdout === 'string') return processo.stdout
    return processo
  } catch (err) {
    if (expirou) {
      throw new ErroPlay(
        '⏱️ O download demorou demais e foi cancelado. Tente uma música mais leve ou tente novamente em instantes.',
        'timeout do download'
      )
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// Flags compartilhadas: diz ao yt-dlp para resolver os desafios JS do
// YouTube usando o Node.js (--no-js-runtimes --js-runtimes node), conforme a
// documentação oficial (https://github.com/yt-dlp/yt-dlp/wiki/EJS).
// O Node mínimo exigido é o 22.0.0 (o projeto já roda em Node 24).
function flagsBase(extra = {}) {
  const flags = {
    // Runtime de JavaScript: força SOMENTE o Node — comportamento idêntico
    // no Windows local e em deploys tipo Render (onde não existe deno)
    noJsRuntimes: true,
    jsRuntimes: 'node',
    // Cliente Android do YouTube: contorna o bloqueio "Sign in to confirm
    // you're not a bot" aplicado a IPs de datacenter (ex.: Render). O
    // cliente android fala direto com a API interna (youtubei) e não passa
    // pelo muro anti-bot do cliente web — sem precisar de cookies/login.
    extractorArgs: ['youtube:player_client=android'],
    // Rede: nunca trava sem resposta
    socketTimeout: 30,
    retries: 3,
    noWarnings: true,
    ...extra
  }

  if (caminhoFfmpeg) flags.ffmpegLocation = caminhoFfmpeg

  // Opcional: baixa automaticamente os scripts de desafio (yt-dlp-ejs)
  // direto do GitHub, conforme a documentação oficial. Útil quando o
  // binário empacotado fica desatualizado e o YouTube muda os desafios.
  // Habilite com PLAY_REMOTE_EJS=true.
  if (String(process.env.PLAY_REMOTE_EJS || '').toLowerCase() === 'true') {
    flags.remoteComponents = 'ejs:github'
  }

  // Cookies do YouTube (formato Netscape) — contorna o bloqueio
  // "Sign in to confirm you're not a bot" em IPs de datacenter (ex.: Render).
  // O yt-dlp entende o cookies.txt nativamente (sem precisar converter nada).
  //
  // Prioridade:
  //   1. Variável PLAY_COOKIES_PATH (caminho absoluto; no Render aponta para
  //      /etc/secrets/cookies.txt — Secret File subido manualmente no painel)
  //   2. Fallback: cookies.txt na raiz do projeto (uso local)
  // Se nenhum existir, segue sem cookies normalmente (não trava, não dá erro).
  const caminhoCookies = (process.env.PLAY_COOKIES_PATH || '').trim()
  const cookiesPath = caminhoCookies
    ? caminhoCookies
    : path.join(process.cwd(), 'cookies.txt')
  if (fs.existsSync(cookiesPath)) flags.cookies = cookiesPath

  return flags
}

// Converte um erro bruto do yt-dlp em mensagem amigável para o usuário
function mensagemAmigavel(err) {
  if (err instanceof ErroPlay) return err.mensagemUsuario

  const bruto = String(err?.stderr || err?.message || err || '')
  const baixo = bruto.toLowerCase()

  if (baixo.includes('unavailable') || baixo.includes('does not exist') || baixo.includes('no longer available') || baixo.includes('has been removed')) {
    return '❌ Esse vídeo não está disponível (pode ter sido removido, ser privado ou o link estar errado).'
  }
  if (baixo.includes('private video')) {
    return '🔒 Esse vídeo é privado e não pode ser baixado.'
  }
  if (baixo.includes('no results')) {
    return '🔎 Nenhuma música encontrada com esse nome. Tente outras palavras-chave!'
  }
  if (baixo.includes('sign in to confirm') || (baixo.includes('age') && baixo.includes('confirm'))) {
    return '🔞 O YouTube exigiu login/verificação de idade para esse vídeo, então não consigo baixá-lo.'
  }
  if (baixo.includes('live event will begin') || baixo.includes('is live')) {
    return '🔴 Não dá para baixar transmissões ao vivo. Espere terminar e tente de novo.'
  }
  if (baixo.includes('larger than') || baixo.includes('max-filesize') || baixo.includes('too large')) {
    return '📦 O áudio ficou grande demais para o WhatsApp. Tente uma música mais curta.'
  }
  if (baixo.includes('requested format') || baixo.includes('no supported format')) {
    return '🎧 Não encontrei um formato de áudio compatível para esse vídeo.'
  }
  if (baixo.includes('enoent') && (baixo.includes('yt-dlp') || baixo.includes('ffmpeg'))) {
    return '⚠️ Faltou um componente no ambiente deste bot (yt-dlp/ffmpeg). Rode `npm install` na pasta do projeto.'
  }
  if (baixo.includes('unsupported url')) {
    return '❌ Não reconheci esse link. Envie um link do YouTube ou o nome da música.'
  }
  if (baixo.includes('getaddrinfo') || baixo.includes('econn') || baixo.includes('network') || baixo.includes('unable to download') || baixo.includes('timed out') || baixo.includes('connection')) {
    return '🌍 Problema de rede ao falar com o YouTube. Tente novamente em instantes.'
  }
  return '❌ Não consegui baixar esse vídeo, tente novamente ou verifique o link. 🎶'
}

// Formata segundos em m:ss
function formatarDuracao(segundos) {
  const m = Math.floor(segundos / 60)
  const s = Math.round(segundos % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// Apaga os arquivos temporários de um download sem NUNCA estourar erro
function limparTemporarios(pastaTemp, estampa) {
  try {
    for (const arquivo of fs.readdirSync(pastaTemp)) {
      if (arquivo.startsWith(`play_${estampa}`)) {
        try { fs.unlinkSync(path.join(pastaTemp, arquivo)) } catch (errDel) { /* ignora */ }
      }
    }
  } catch (err) {
    console.error('[play] Falha ao limpar temporários:', err?.message)
  }
}

module.exports = {
  nome: 'play',
  descricao: 'Pesquisa e baixa uma música do YouTube usando o binário real do yt-dlp (com o Node.js resolvendo os desafios JS do YouTube).',
  async executar(sock, jid, msg, texto) {
    let estampaTemp = null

    try {
      const termoPesquisa = texto.replace(/^\/\S+\s*/, '').trim()

      if (!termoPesquisa) {
        return await responder(sock, jid, msg, '❌ Digite o nome da música ou um link do YouTube! Exemplo: `/play Linkin Park In The End`')
      }

      // 🔒 Trava simples: 1 download por chat por vez
      if (downloadsEmAndamento.has(jid)) {
        return await responder(sock, jid, msg, '⏳ Já existe um download em andamento neste chat. Aguarde terminar e tente de novo!')
      }
      downloadsEmAndamento.add(jid)

      let url, titulo, duracaoSegundos

      if (REGEX_EH_LINK.test(termoPesquisa)) {
        // Usuário mandou um LINK: consulta os dados do vídeo antes de baixar
        await responder(sock, jid, msg, '🔎 Identificando o vídeo...')

        const saidaBruta = await executarYtDlp(termoPesquisa, flagsBase({
          dumpSingleJson: true,
          skipDownload: true,
          noPlaylist: true,
          noProgress: true,
          restrictFilenames: true
        }), 30000)

        let info
        try {
          info = JSON.parse(saidaBruta)
        } catch (errParse) {
          throw new ErroPlay('❌ Não consegui ler os dados desse vídeo. Confira o link e tente de novo.', 'saída do yt-dlp não é um JSON válido: ' + String(saidaBruta || '').slice(0, 200))
        }

        url = info?.webpage_url || termoPesquisa
        titulo = info?.title || 'vídeo'
        duracaoSegundos = info?.duration
      } else {
        // Usuário mandou um NOME: usa a busca NATIVA do yt-dlp ("ytsearch1:"
        // = pegar apenas o 1º resultado), pelo mesmo wrapper do download.
        // (Substitui o yt-search, que fazia scraping do HTML da página de
        // busca e quebrava quando o YouTube mudava a estrutura dela.)
        await responder(sock, jid, msg, `🔍 Buscando por "${termoPesquisa}" no YouTube...`)

        const saidaBruta = await executarYtDlp(`ytsearch1:${termoPesquisa}`, flagsBase({
          dumpSingleJson: true,
          noProgress: true,
          restrictFilenames: true
        }), 30000)

        let busca
        try {
          busca = JSON.parse(saidaBruta)
        } catch (errParse) {
          throw new ErroPlay('❌ Não consegui consultar a busca do YouTube agora. Tente novamente em instantes.', 'saída da busca do yt-dlp não é um JSON válido: ' + String(saidaBruta || '').slice(0, 200))
        }

        // "ytsearch1:" devolve uma playlist com 1 entrada
        const video = busca?.entries?.[0] || (busca?._type === 'video' ? busca : null)

        if (!video) {
          return await responder(sock, jid, msg, '🔎 Nenhuma música encontrada com esse nome. Tente outras palavras-chave!')
        }

        url = video.webpage_url || video.url || (video.id ? `https://www.youtube.com/watch?v=${video.id}` : null)
        titulo = video.title || 'música'
        duracaoSegundos = video.duration
      }

      // Validações de duração (ao vivo = duração indefinida)
      if (!duracaoSegundos) {
        return await responder(sock, jid, msg, '🔴 Não dá para baixar transmissões ao vivo ou vídeos sem duração definida.')
      }
      if (duracaoSegundos > DURACAO_MAXIMA_SEGUNDOS) {
        return await responder(sock, jid, msg, '❌ A música não pode ter mais de 10 minutos para proteger o servidor.')
      }

      await responder(sock, jid, msg, `🎵 *Música Encontrada!*\n\n📌 *Título:* ${titulo}\n⏱️ *Duração:* ${formatarDuracao(duracaoSegundos)}\n\n⏳ *Baixando áudio via yt-dlp...*`)

      // ---- DOWNLOAD (executa o binário yt-dlp de verdade) ----
      const pastaTemp = os.tmpdir()
      estampaTemp = Date.now()
      const templateSaida = path.join(pastaTemp, `play_${estampaTemp}.%(ext)s`)

      await executarYtDlp(url, flagsBase({
        output: templateSaida,
        extractAudio: true,
        audioFormat: 'mp3',
        audioQuality: '0',
        noPlaylist: true,
        noProgress: true,
        restrictFilenames: true,
        // Trava de tamanho ANTES de baixar (economia de banda)
        maxFilesize: MAX_FILESIZE_YTDLP
      }), TIMEOUT_DOWNLOAD_MS)

      // ---- VALIDAÇÕES PÓS-DOWNLOAD ----
      const caminhoFinal = path.join(pastaTemp, `play_${estampaTemp}.mp3`)

      if (!fs.existsSync(caminhoFinal) || fs.statSync(caminhoFinal).size === 0) {
        throw new ErroPlay('❌ O download não produziu um áudio válido. Tente novamente.', 'arquivo de saída não foi criado')
      }

      const tamanhoBytes = fs.statSync(caminhoFinal).size
      if (tamanhoBytes > LIMITE_BYTES) {
        return await responder(sock, jid, msg, `📦 O áudio ficou com ${(tamanhoBytes / (1024 * 1024)).toFixed(1)} MB, acima do limite de ${Math.floor(LIMITE_BYTES / (1024 * 1024))} MB para envio. Tente uma música mais curta!`)
      }

      // ---- ENVIO ----
      // try/catch próprio: uma falha de envio NUNCA pode estourar pra fora
      try {
        await sock.sendMessage(jid, {
          audio: fs.readFileSync(caminhoFinal),
          mimetype: 'audio/mpeg',
          ptt: false
        }, { quoted: msg })
      } catch (errEnvio) {
        console.error('[play] Falha ao enviar o áudio ao WhatsApp:', errEnvio)
        await responder(sock, jid, msg, '😕 Baixei a música, mas não consegui enviar o áudio pelo WhatsApp. Tente novamente!')
      }
    } catch (err) {
      // 🛡️ ISOLAMENTO TOTAL: qualquer erro do yt-dlp (vídeo indisponível, erro
      // de rede, timeout, formato não suportado etc) morre AQUI, dentro do
      // /play. O listener principal (messages.upsert) e a conexão do Baileys
      // continuam 100% intactos para os demais comandos e usuários.
      console.error('[play] Erro tratado dentro do comando /play:', err)
      await responder(sock, jid, msg, mensagemAmigavel(err))
    } finally {
      // Libera o lock do chat e limpa os arquivos temporários
      downloadsEmAndamento.delete(jid)
      if (estampaTemp) limparTemporarios(os.tmpdir(), estampaTemp)
    }
  }
}
