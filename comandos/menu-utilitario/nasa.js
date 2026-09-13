// ============================================
// 🌌 NASA — Foto Astronômica do Dia (APOD) do Limbo
// ============================================
// Exibe a Foto Astronômica do Dia da NASA com título e explicação
// traduzidos para pt-BR via Groq (com fallback para o inglês).
//
// Como usar (uso LIVRE, funciona em grupos e no privado):
//   /nasa
//   (também: /apod, /astronomia e /foto-nasa)
//
// Regras (mesmo padrão do /ddd e do /wiki):
//   - NASA_API_KEY do ambiente, com fallback para 'DEMO_KEY';
//   - GET https://api.nasa.gov/planetary/apod?api_key=... (timeout 15s);
//   - media_type "image" -> baixa url (fallback hdurl, limite 15 MB) e
//     envia { image: Buffer, caption }; download falhou -> texto + link;
//   - media_type "video" -> texto explicativo + link do vídeo;
//   - tradução título+explicação em UMA chamada Groq (json_object);
//     qualquer falha -> texto original em inglês, sem quebrar;
//   - 429/403 -> aviso de limite citando a NASA_API_KEY;
//   - NASA fora do ar -> mensagem amigável; logs "[nasa] ...".
//
// ⚠️ CAUSA RAIZ DO CRASH (mesmo padrão do /revelar, /perfil e /toimg):
//   O envio de imagem usava { image: Buffer } SEM jpegThumbnail. Ao preparar
//   a mídia, a Baileys gera a miniatura com a lib NATIVA sharp/libvips DENTRO
//   do processo (messages-media.js → extractImageThumb), e uma falha nativa
//   dessa stack mata o processo SEM chance de try/catch — derrubando a
//   conexão inteira.
//   AGORA o thumbnail é gerado ANTES pelo binário do ffmpeg em PROCESSO
//   FILHO e entregue pronto via `jpegThumbnail` (requiresThumbnailComputation
//   vira false e a lib PULA o sharp/libvips por completo). Se até o ffmpeg
//   falhar, usamos um JPEG 8x8 embutido como fallback e a foto ainda sai.
// ============================================

const { exec } = require('child_process')
const fs = require('fs')
const path = require('path')

// Usa o binário de FFmpeg instalado com o projeto, com fallback para o PATH
const binarioFfmpeg = (() => {
  try {
    return require('@ffmpeg-installer/ffmpeg').path
  } catch (err) {
    return 'ffmpeg'
  }
})()

// 🧩 JPEG 8x8 válido (gerado pelo próprio @ffmpeg-installer do projeto) —
// fallback caso até o ffmpeg falhe ao gerar a miniatura da foto do dia.
const THUMB_FALLBACK_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzU4LjQyLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAEBEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgACAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AD//Z'

/** Apaga um temporário com retry (EPERM/EBUSY no Windows). NUNCA lança. */
function apagarComRetry(caminho, tentativas = 3) {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms))
  return (async () => {
    for (let i = 0; i < tentativas; i++) {
      try {
        if (!fs.existsSync(caminho)) return
        fs.unlinkSync(caminho)
        return
      } catch (err) {
        if (i === tentativas - 1) {
          console.error('⚠️ nasa: falha ao apagar temporário', caminho, err?.message)
        } else {
          await espera(150)
        }
      }
    }
  })()
}

/**
 * Gera um thumbnail JPEG (~64px) da imagem usando o binário do ffmpeg em
 * PROCESSO FILHO — nunca toca na stack nativa de imagem da Baileys.
 * NUNCA rejeita: em caso de qualquer falha devolve o fallback 8x8.
 * @returns {Promise<{base64: string, fonte: 'ffmpeg'|'fallback', caminho: string}>}
 */
function gerarThumbnailJpeg(caminhoImagem, pastaTemp, idUnico) {
  return new Promise((resolve) => {
    const caminhoThumb = path.join(pastaTemp, `thumb_${idUnico}.jpg`)
    const cmd = `"${binarioFfmpeg}" -y -nostdin -i "${caminhoImagem}" -vf "scale=64:-1" -vframes 1 "${caminhoThumb}"`
    exec(cmd, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (error) => {
      try {
        if (!error && fs.existsSync(caminhoThumb)) {
          const bufferThumb = fs.readFileSync(caminhoThumb)
          if (bufferThumb.length > 0) {
            return resolve({ base64: bufferThumb.toString('base64'), fonte: 'ffmpeg', caminho: caminhoThumb })
          }
        }
        console.error('[nasa] ⚠️ ffmpeg não produziu thumbnail — usando fallback 8x8. Motivo:', error?.message || 'arquivo ausente')
      } catch (errLeitura) {
        console.error('[nasa] ⚠️ falha ao ler thumbnail gerado — usando fallback 8x8:', errLeitura?.message)
      }
      // Fallback não cria arquivo (só devolve o JPEG embutido em memória)
      resolve({ base64: THUMB_FALLBACK_JPEG_BASE64, fonte: 'fallback', caminho: caminhoThumb })
    })
  })
}

const TIMEOUT_API_MS = 15000
const LIMITE_BYTES_IMAGEM = 15 * 1024 * 1024
const URL_APOD = 'https://api.nasa.gov/planetary/apod?api_key='
const URL_GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions'
const MODELO_TRADUCAO = 'openai/gpt-oss-20b'

class ErroNasa extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroNasa'
    this.tipo = tipo
  }
}

function chaveNasa() {
  const chave = String(process.env.NASA_API_KEY || '').trim()
  return chave || 'DEMO_KEY'
}

function modeloTraducao() {
  const personalizado = String(process.env.GROQ_MODEL || '').trim()
  return personalizado || MODELO_TRADUCAO
}

// ─── 🌌 GET no APOD com timeout → JSON parseado ───
async function buscarApod() {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    const resposta = await fetch(URL_APOD + encodeURIComponent(chaveNasa()), {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'HipnosBot/1.0' },
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      if (resposta.status === 429 || resposta.status === 403) {
        throw new ErroNasa('limite da API atingido (HTTP ' + resposta.status + ')', 'limite')
      }
      throw new ErroNasa('a API da NASA respondeu HTTP ' + resposta.status, 'api')
    }
    const dados = await resposta.json().catch(() => null)
    if (!dados || typeof dados !== 'object') {
      throw new ErroNasa('a NASA devolveu resposta inválida', 'api')
    }
    return dados
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof ErroNasa) throw err
    if (err && err.name === 'AbortError') {
      throw new ErroNasa('a consulta demorou demais (timeout)', 'api')
    }
    throw new ErroNasa(String((err && err.message) || err), 'api')
  }
}

// ─── 🈯 Traduz título+explicação via Groq (UMA chamada) ───
// Qualquer falha (sem chave, timeout, JSON inválido) -> null e o
// comando segue com o texto original em inglês (fallback).
async function traduzir(titulo, explicacao) {
  const chave = String(process.env.GROQ_API_KEY || '').trim()
  if (!chave) return null
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    const resposta = await fetch(URL_GROQ_CHAT, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modeloTraducao(),
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Você traduz textos astronômicos para o português do Brasil (pt-BR). Responda APENAS com um JSON válido no formato {"titulo": "...", "explicacao": "..."} sem comentários extras.'
          },
          { role: 'user', content: 'Traduza para o português do Brasil:\n\nTÍTULO: ' + titulo + '\n\nEXPLICAÇÃO: ' + explicacao }
        ]
      }),
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      console.error('[nasa] Groq respondeu HTTP ' + resposta.status + ' — usando texto original.')
      return null
    }
    const dados = await resposta.json().catch(() => null)
    const bruto = String((dados && dados.choices && dados.choices[0] && dados.choices[0].message && dados.choices[0].message.content) || '')
    const par = bruto.match(/\{[\s\S]*\}/)
    if (!par) {
      console.error('[nasa] Groq devolveu JSON inválido — usando texto original.')
      return null
    }
    const traduzido = JSON.parse(par[0])
    const tituloTraduzido = String(traduzido.titulo || '').trim()
    const explicacaoTraduzida = String(traduzido.explicacao || '').trim()
    if (!tituloTraduzido || !explicacaoTraduzida) return null
    return { titulo: tituloTraduzido, explicacao: explicacaoTraduzida }
  } catch (err) {
    clearTimeout(timeoutId)
    console.error('[nasa] tradução falhou — usando texto original:', (err && err.message) || err)
    return null
  }
}

// ─── 🖼️ Baixa a imagem com limite defensivo (15 MB) ───
// Retorna Buffer ou null (o chamador cai para o modo "texto + link").
async function baixarImagem(url) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    const resposta = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'HipnosBot/1.0' },
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      console.error('[nasa] download da imagem falhou (HTTP ' + resposta.status + ') — enviando link.')
      return null
    }
    const tamanhoDeclarado = Number(resposta.headers && resposta.headers.get && resposta.headers.get('content-length'))
    if (Number.isFinite(tamanhoDeclarado) && tamanhoDeclarado > LIMITE_BYTES_IMAGEM) {
      console.error('[nasa] imagem de ~' + Math.round(tamanhoDeclarado / 1024 / 1024) + ' MB excede o limite — enviando link.')
      return null
    }
    const buffer = Buffer.from(await resposta.arrayBuffer())
    if (!buffer.length || buffer.length > LIMITE_BYTES_IMAGEM) {
      console.error('[nasa] imagem inválida ou grande demais — enviando link.')
      return null
    }
    return buffer
  } catch (err) {
    clearTimeout(timeoutId)
    console.error('[nasa] download da imagem falhou — enviando link:', (err && err.message) || err)
    return null
  }
}

// ─── ✉️ Monta a legenda temática da foto do dia ───
function montarLegenda(apod, traducao) {
  const titulo = (traducao && traducao.titulo) || apod.title || 'Sonho sem título'
  const explicacao = (traducao && traducao.explicacao) || apod.explanation || ''
  const linhaCreditos = apod.copyright ? '\n📸 Créditos: *' + String(apod.copyright).trim() + '*' : ''
  return (
    '🌌 *FOTO ASTRONÔMICA DO DIA* ✨\n\n' +
    '🔭 *' + titulo + '*\n' +
    '📅 Data: *' + (apod.date || 'desconhecida') + '*' +
    linhaCreditos +
    '\n\n' + explicacao +
    '\n\n💤 *"Enquanto os mortais dormem, o universo sonha junto."*'
  )
}

// ─── 📨 Execução do comando ───
module.exports = {
  nome: 'nasa',
  aliases: ['apod', 'astronomia', 'foto-nasa'],
  descricao: 'Exibe a Foto Astronômica do Dia (APOD) da NASA com explicação traduzida.',
  categoria: 'utilitario',

  async executar(sock, jid, msg) {
    let caminhoImagemTemp = null
    let caminhoThumbTemp = null

    try {
      // 1) 🌌 Busca o APOD do dia
      console.log('[nasa] ① buscando o APOD na NASA...')
      const apod = await buscarApod()
      const titulo = String(apod.title || '').trim()
      const explicacao = String(apod.explanation || '').trim()
      if (!titulo && !explicacao) {
        throw new ErroNasa('a NASA devolveu o dia vazio', 'api')
      }

      // 2) 🈯 Traduz (fallback silencioso para o inglês)
      console.log(`[nasa] ② APOD OK (media_type=${apod.media_type}) — traduzindo título+explicação via Groq...`)
      const traducao = await traduzir(titulo, explicacao)
      const legenda = montarLegenda(apod, traducao)
      console.log(`[nasa] ③ legenda montada (${legenda.length} chars)`)

      // 3) 🎬 Vídeo -> texto explicativo + link
      if (apod.media_type === 'video') {
        const link = String(apod.url || '').trim()
        console.log('[nasa] ④ media_type=video — enviando texto + link.')
        return await sock.sendMessage(jid, {
          text: legenda + (link ? '\n\n▶️ Assista ao vídeo: ' + link : '')
        }, { quoted: msg })
      }

      // 4) 🖼️ Imagem -> foto com legenda (ou texto + link se o download falhar)
      // ⚠️ Envia SEMPRE com jpegThumbnail gerado por nós (ffmpeg em processo
      // filho): sem isso a Baileys geraria a miniatura com sharp/libvips
      // in-process e poderia matar o processo (crash não capturável).
      const urlImagem = String(apod.url || apod.hdurl || '').trim()
      if (urlImagem) {
        const buffer = await baixarImagem(urlImagem)
        if (buffer && buffer.length > 0) {
          const idUnico = Math.random().toString(36).substring(2, 10)
          const pastaTemp = path.join(__dirname, '..', 'dados', 'temp')
          if (!fs.existsSync(pastaTemp)) fs.mkdirSync(pastaTemp, { recursive: true })
          caminhoImagemTemp = path.join(pastaTemp, `nasa_${idUnico}.jpg`)
          fs.writeFileSync(caminhoImagemTemp, buffer)
          console.log(`[nasa] ④ imagem baixada (${buffer.length} bytes) — gerando thumbnail via ffmpeg (processo filho)...`)
          const thumb = await gerarThumbnailJpeg(caminhoImagemTemp, pastaTemp, idUnico)
          caminhoThumbTemp = thumb.caminho
          const jpegThumbnail = thumb.base64
          console.log(`[nasa] ⑤ jpegThumbnail pronto (fonte: ${thumb.fonte}, ${jpegThumbnail.length} chars base64)`)
          try {
            console.log('[nasa] ⑥ enviando imagem COM jpegThumbnail (Baileys pula sharp/libvips)...')
            return await sock.sendMessage(jid, {
              image: buffer,
              caption: legenda,
              jpegThumbnail // ← entrega pronto: Baileys NÃO gera miniatura nativa
            }, { quoted: msg })
          } catch (erroEnvio) {
            // 🪵 Ponto exato de falha no log, sem derrubar nada
            console.error('[nasa] 💥 falha no envio da imagem (capturada — a conexão NÃO cai):', erroEnvio?.stack || erroEnvio)
            throw new ErroNasa('falha ao enviar a foto do dia', 'envio')
          }
        }
        console.error('[nasa] ④ imagem indisponível — enviando texto + link.')
        return await sock.sendMessage(jid, { text: legenda + '\n\n🔗 Ver a foto: ' + urlImagem }, { quoted: msg })
      }
      console.log('[nasa] ④ sem URL de imagem — enviando só o texto.')
      return await sock.sendMessage(jid, { text: legenda }, { quoted: msg })
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa para o socket.
      console.error('[nasa] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      let aviso = '⛔ *A NASA está fora do ar...*\n\nO telescópio do limbo não alcançou as estrelas agora. Tente novamente em instantes.'
      if (err?.tipo === 'limite') {
        aviso = '⏳ *O telescópio atingiu o limite de consultas...*\n\nA chave atual estourou a cota da NASA. O dono pode configurar uma NASA_API_KEY própria (grátis em https://api.nasa.gov) e tentar de novo em instantes.'
      } else if (err?.tipo === 'envio') {
        aviso = '⛔ *O mensageiro do limbo tropeçou ao entregar a foto...*\n\nA imagem foi capturada, mas não consegui enviá-la agora. Tente novamente em instantes.'
      }
      return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    } finally {
      // 🧹 Limpeza tolerante dos temporários (nunca lança)
      for (const caminho of [caminhoImagemTemp, caminhoThumbTemp]) {
        if (caminho && fs.existsSync(caminho)) await apagarComRetry(caminho)
      }
    }
  }
}
