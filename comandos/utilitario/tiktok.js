// ============================================
// 🎵 TIKTOK — Sonho em Movimento do Limbo
// ============================================
// Baixa vídeos do TikTok sem marca d'água via API pública TikWM
// (https://www.tikwm.com/api/?url={link}) e envia no WhatsApp.
//
// Como usar (uso LIVRE, funciona em grupos e no privado):
//   /tiktok https://vm.tiktok.com/XXXXXXX
//   (também: /tt, /tk e /tiktokdl)
//
// Tratamento de erros (mesmo padrão do /nasa e do /ddd):
//   - link ausente/inválido -> instruções de uso, sem consultar a rede;
//   - vídeo privado/deletado/indisponível -> aviso amigável;
//   - vídeo maior que 50 MB -> recusa antes de estourar a memória;
//   - API fora do ar / sem rede / timeout -> aviso amigável;
//   - logs "[tiktok] ..." no console; nada derruba o listener.
// ============================================

// ⏳ Timeout da API TikWM (ms) — requisito: 15s a 20s
const TIMEOUT_API_MS = 20000

// ⏳ Timeout do download do MP4 (ms) — vídeo demora mais que JSON
const TIMEOUT_VIDEO_MS = 30000

// 📦 Limite defensivo do MP4 (requisito: 50 MB — evita estouro de
// memória e respeita os limites do WhatsApp)
const LIMITE_BYTES_VIDEO = 50 * 1024 * 1024

const URL_TIKWM = 'https://www.tikwm.com/api/?url='

// ─── 🔗 Valida o link do TikTok ───
// Aceita: tiktok.com (www, m, vm e v, com ou sem subdomínio) e os
// encurtadores vm./vt./v./vm.tiktok.com. Retorna o link limpo ou null.
const REGEX_TIKTOK = /https?:\/\/(?:www\.|m\.|vm\.|v\.)?(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com|v\.tiktok\.com)\/\S*/i

function extrairLink(texto) {
  const limpo = String(texto || '').replace(/^\/\S+\s*/, '').trim()
  if (!limpo) return null
  const achado = limpo.match(REGEX_TIKTOK)
  return achado ? achado[0].replace(/[)\].,;!?]+$/, '') : null
}

// ─── 🌐 GET na TikWM com timeout → JSON parseado ───
async function buscarJson(url) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    const resposta = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Hipnos-Bot/1.0'
      },
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      throw new ErroTiktok(`a API do TikTok respondeu HTTP ${resposta.status}`, 'api')
    }
    return await resposta.json()
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof ErroTiktok) throw err
    if (err.name === 'AbortError') {
      throw new ErroTiktok('a consulta demorou demais (timeout)', 'api')
    }
    throw new ErroTiktok(err?.message || String(err), 'api')
  }
}

// ─── 📦 Extrai título, autor e MP4 sem marca d'água ───
// TikWM responde { code, msg, data: { play, wmplay, title, author: { nickname, unique_id } } }.
// Prioriza play (sem marca) e cai para wmplay se faltar.
function extrairVideo(dados) {
  const corpo = dados?.data
  if (dados?.code !== 0 || !corpo) {
    throw new ErroTiktok(`vídeo recusado pela API: ${dados?.msg || 'resposta inválida'}`, 'indisponivel')
  }
  const urlVideo = corpo.play || corpo.wmplay || corpo.hdplay
  if (!urlVideo) {
    throw new ErroTiktok('a API não devolveu o vídeo (privado, deletado ou indisponível)', 'indisponivel')
  }
  const autor = corpo.author?.nickname || corpo.author?.unique_id || corpo.author || ''
  return {
    urlVideo: String(urlVideo).trim(),
    titulo: String(corpo.title || '').trim(),
    autor: String(autor).trim()
  }
}


// 🧪 Erro de domínio: mensagem amigável + tipo p/ o aviso correto
class ErroTiktok extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroTiktok'
    this.tipo = tipo // 'uso' | 'indisponivel' | 'grande' | 'api'
  }
}


// ─── 🎬 Baixa o MP4 p/ Buffer (com limite de 50 MB) ───
async function baixarVideo(url) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_VIDEO_MS)
  try {
    const resposta = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Hipnos-Bot/1.0' },
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      throw new ErroTiktok(`o download falhou (HTTP ${resposta.status})`, 'api')
    }
    const tamanhoDeclarado = Number(resposta.headers?.get?.('content-length'))
    if (Number.isFinite(tamanhoDeclarado) && tamanhoDeclarado > LIMITE_BYTES_VIDEO) {
      throw new ErroTiktok(`vídeo de ~${Math.round(tamanhoDeclarado / 1024 / 1024)} MB excede o limite de 50 MB`, 'grande')
    }
    const buffer = Buffer.from(await resposta.arrayBuffer())
    if (buffer.length === 0) {
      throw new ErroTiktok('o download voltou vazio', 'api')
    }
    if (buffer.length > LIMITE_BYTES_VIDEO) {
      throw new ErroTiktok(`vídeo de ~${Math.round(buffer.length / 1024 / 1024)} MB excede o limite de 50 MB`, 'grande')
    }
    return buffer
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof ErroTiktok) throw err
    if (err.name === 'AbortError') {
      throw new ErroTiktok('o download demorou demais (timeout)', 'api')
    }
    throw new ErroTiktok(err?.message || String(err), 'api')
  }
}

// ─── ✉️ Monta a legenda temática do sonho em movimento ───
function montarLegenda(video) {
  const titulo = video.titulo || 'Sonho sem título'
  const linhaAutor = video.autor ? `\n👤 Autor: *@${video.autor.replace(/^@/, '')}*` : ''
  return (
    `🎵 *SONHO EM MOVIMENTO* ✨\n\n` +
    `🎬 *${titulo}*` +
    linhaAutor +
    `\n\n💤 *"Um sonho em movimento resgatado das sombras."*`
  )
}


// ─── 📨 Execução do comando ───
module.exports = {
  nome: 'tiktok',
  aliases: ['tt', 'tk', 'tiktokdl'],
  descricao: 'Baixa e envia vídeos do TikTok através de um link enviado pelo usuário.',
  categoria: 'utilitario',

  async executar(sock, jid, msg, text) {
    try {
      // 1) 🔗 Valida o link (sem link válido não há consulta à rede)
      const link = extrairLink(text)
      if (!link) {
        return await sock.sendMessage(jid, {
          text: '🎵 *Me mostre o sonho em movimento...*\n\n' +
            'Envie um link válido do TikTok logo após o comando.\n\n' +
            '🗝️ Exemplos: `/tiktok https://vm.tiktok.com/XXXXXXX` • `/tiktok https://www.tiktok.com/@usuario/video/123...`'
        }, { quoted: msg })
      }

      // 2) 🌐 Resolve o MP4 sem marca d'água na TikWM
      const dados = await buscarJson(`${URL_TIKWM}${encodeURIComponent(link)}`)
      const video = extrairVideo(dados)

      // 3) 🎬 Baixa o vídeo (limite de 50 MB) e envia com a legenda
      const buffer = await baixarVideo(video.urlVideo)
      return await sock.sendMessage(jid, { video: buffer, caption: montarLegenda(video) }, { quoted: msg })
    } catch (err) {
      console.error('[tiktok] erro ao baixar o vídeo:', err)
      let aviso = '⛔ *As sombras engoliram o sonho...*\n\n' +
        'A API do TikTok não respondeu agora. Tente novamente em instantes.'
      if (err?.tipo === 'indisponivel') {
        aviso = '🎵 *Esse sonho não pôde ser resgatado...*\n\n' +
          'O vídeo pode estar privado, deletado ou indisponível. Confira o link e tente outro.\n\n' +
          '🗝️ Exemplo: `/tiktok https://vm.tiktok.com/XXXXXXX`'
      } else if (err?.tipo === 'grande') {
        aviso = '🎵 *Esse sonho é grande demais para o limbo...*\n\n' +
          'O vídeo excede o limite de 50 MB. Tente um vídeo mais curto.'
      }
      return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    }
  }
}
