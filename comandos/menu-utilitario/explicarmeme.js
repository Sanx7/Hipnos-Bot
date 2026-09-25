// ============================================
// 😂 EXPLICARMEME — a IA explica o humor/contexto de um meme (VISÃO)
// ============================================
// Explica a piada de uma imagem de meme usando IA com VISÃO (multimodal), via
// OpenRouter (mesmo provedor e formato OpenAI-compatible do /resumir e do
// /reescrever), com a imagem enviada em base64 (data URL) no content da
// mensagem do usuário.
//
// Uso (as DUAS formas, desde o início — o bug do "só reply" do /s NÃO existe
// aqui; a mídia direta tem prioridade, ver "CAPTURA" abaixo):
//   /explicarmeme  (respondendo a uma imagem)
//   /explicarmeme  (com a imagem enviada e o comando na legenda)
//
// 👁️ MODELO COM VISÃO — o modelo padrão dos outros comandos de IA
//    (nvidia/nemotron-3-super-120b-a12b:free) é SÓ TEXTO, então este comando
//    usa um modelo GRATUITO com suporte a IMAGEM. Candidatos verificados no
//    catálogo da OpenRouter (input_modalities com "image") e testados um a um
//    (o #1 respondeu corretamente numa imagem real):
//      1. nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free  (testado OK)
//      2. google/gemma-4-31b-it:free
//      3. google/gemma-4-26b-a4b-it:free
//      4. qwen/qwen3.8-27b:free
//    Os :free dão 429 (rate limit) com frequência, então o núcleo TENTA O
//    PRÓXIMO CANDIDATO quando o atual falha por limite/servidor — só esgotando
//    a lista ele avisa o usuário. Para fixar um: EXPLICARMEME_MODEL.
//
// Regras:
//   - 🖼️ ENTRADA: imagem direta (com o comando na legenda) ou imagem citada
//     (reply) — "ver uma vez", mensagens temporárias e documentos com mime de
//     imagem também são desembrulhados por normalizeMessageContent;
//   - 📦 Formato da API: content em array com um item "text" (instrução em
//     pt-BR) + um item "image_url" com a imagem em data URL base64;
//   - 🧠 PROMPT FIXO (pt-BR): humor/contexto/referência do meme, curto e direto;
//   - 📏 A imagem é limitada (LIMITE_BYTES_IMAGEM) e, se for grande, é
//     reamostrada com o jimp (JS puro — a regra de ouro do projeto: NUNCA
//     sharp/libvips in-process) para caber em base64 sem estourar a API;
//   - ⛔ Erros de API no mesmo tratamento amigável do /resumir (sem chave,
//     chave inválida, 429/timeout, api fora, resposta vazia) — aviso
//     amigável, NADA escapa para o listener do bot;
//   - 🆔 headers da OpenRouter: HTTP-Referer (URL do app) e X-Title;
//   - ✂️ resposta longa → blocos de 2500 caracteres;
//   - logs "[explicarmeme] ..." para diagnóstico no Render.
//
// ⚙️ Config (todas opcionais, exceto a chave):
//   OPENROUTER_API_KEY   — chave da OpenRouter (obrigatória p/ este comando);
//   EXPLICARMEME_MODEL   — fixa o modelo de visão (padrão: o 1º da lista);
//   OPENROUTER_SITE_URL  — sobrescreve o HTTP-Referer (padrão: RENDER_EXTERNAL_URL);
//   OPENROUTER_APP_TITLE — sobrescreve o X-Title (padrão: "Hipnos Bot").
// ============================================

const { downloadContentFromMessage, normalizeMessageContent } = require('@whiskeysockets/baileys')
const { Jimp } = require('jimp')

const TIMEOUT_API_MS = 25000
const TAMANHO_BLOCO = 2500
const LIMITE_BYTES_IMAGEM = 5 * 1024 * 1024   // 5 MB (memes são leves; evita base64 gigante)
const LADO_MAXIMO = 1024                     // reamostragem p/ manter a base64 pequena
const URL_OPENROUTER_CHAT = 'https://openrouter.ai/api/v1/chat/completions'
const APP_TITLE_PADRAO = 'Hipnos Bot'
const SITE_URL_PADRAO = 'https://hipnos-bot.onrender.com'

// 👁️ Candidatos GRATUITOS (:free) que aceitam IMAGEM, em ordem de preferência.
//    Todos confirmados no catálogo da OpenRouter com input_modalities "image".
//    O #1 foi testado de verdade com uma imagem e respondeu corretamente.
const MODELOS_VISAO = [
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'qwen/qwen3.8-27b:free'
]
const MODELO_PADRAO = MODELOS_VISAO[0]

// 🧠 Instrução fixa (pt-BR): explicar o humor do meme, curto e direto
const SYSTEM_PROMPT =
  'Você é Hipnos, o guardião do Limbo e dos sonhos (pt-BR). Você recebeu a imagem de um meme. ' +
  'Explique o CONTEXTO, o HUMOR e a possível REFERÊNCIA/CULTURA por trás do meme. ' +
  'Seja direto e objetivo: responda em no máximo 3 frases curtas, em português do Brasil. ' +
  'Descreva também o que aparece na imagem. Não invente informações, não julgue o meme e ' +
  'não acrescente comentários pessoais: devolva SOMENTE a explicação, sem saudações.'

// 🧪 Erro de domínio: mensagem técnica + tipo p/ o aviso amigável correto
class ErroExplicarMeme extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroExplicarMeme'
    // 'sem_chave'|'chave_invalida'|'sem_imagem'|'imagem_invalida'|
    // 'limite'|'timeout'|'api'|'vazia'|'sem_visao'
    this.tipo = tipo
  }
}

// 📥 Baixa a mídia da mensagem (Baileys). É uma variável (e não uma chamada
//    direta) para o teste offline conseguir injetar um stream falso.
let baixarMidia = (midia) => downloadContentFromMessage(midia, 'image')

// 👁️ Modelo de visão a usar. EXPLICARMEME_MODEL fixa um; senão usa o padrão.
function modeloExplicarMeme() {
  const personalizado = String(process.env.EXPLICARMEME_MODEL || '').trim()
  return personalizado || MODELO_PADRAO
}

// 🆔 HTTP-Referer exigido/recomendado pela OpenRouter.
function urlDoApp() {
  const custom = String(process.env.OPENROUTER_SITE_URL || '').trim()
  if (custom) return custom
  const doRender = String(process.env.RENDER_EXTERNAL_URL || '').trim()
  return doRender || SITE_URL_PADRAO
}

function tituloDoApp() {
  return String(process.env.OPENROUTER_APP_TITLE || '').trim() || APP_TITLE_PADRAO
}

// ─── 🖼️ CAPTURA DA IMAGEM (as DUAS formas, desde o início) ───
// Prioridade: (a) imagem enviada JUNTO com o comando na legenda, depois
// (b) imagem citada (reply), depois (c) documento com mime de imagem.
// 🔓 normalizeMessageContent desembrulha view-once, temporárias, documentWithCaption.
// Devolve { midia, origem } ou null.
function localizarImagem(msg) {
  const conteudo = normalizeMessageContent(msg?.message) || {}
  const contexto = conteudo.extendedTextMessage?.contextInfo ||
    conteudo.imageMessage?.contextInfo
  const citada = normalizeMessageContent(contexto?.quotedMessage) || {}

  // 1) 🖼️ Imagem enviada com o comando na legenda (prioridade)
  if (conteudo.imageMessage) return { midia: conteudo.imageMessage, origem: 'enviada' }
  // 2) 💬 Imagem citada (reply)
  if (citada.imageMessage) return { midia: citada.imageMessage, origem: 'citada' }
  // 3) 📄 Documento com mime de imagem (enviado junto ou citado)
  if (conteudo.documentMessage?.mimetype?.startsWith('image/')) {
    return { midia: conteudo.documentMessage, origem: 'documento enviado' }
  }
  if (citada.documentMessage?.mimetype?.startsWith('image/')) {
    return { midia: citada.documentMessage, origem: 'documento citado' }
  }
  return null
}

// 🎯 Adivinha o mime pelos "magic bytes" (fallback quando a msg não traz mime)
function mimePeloBuffer(buffer) {
  if (buffer?.[0] === 0xff && buffer?.[1] === 0xd8) return 'image/jpeg'
  if (buffer?.[0] === 0x89 && buffer?.[1] === 0x50) return 'image/png'
  if (buffer?.[0] === 0x47 && buffer?.[1] === 0x49) return 'image/gif'
  if (buffer?.[8] === 0x57 && buffer?.[9] === 0x45) return 'image/webp'
  return null
}

// 📥 Baixa a imagem da mensagem e devolve um data URL base64 p/ a API.
// - limite de 5 MB; acima disso, reamostra com jimp (JS puro) p/ caber;
// - buffer vazio/ilegível → erro 'imagem_invalida' (imagem corrompida).
// 🧪 A função que faz o download é substituível nos testes (ver _injetarDownload).
async function imagemParaBase64(midia) {
  const stream = await baixarMidia(midia)
  let buffer = Buffer.from([])
  for await (const parte of stream) {
    buffer = Buffer.concat([buffer, parte])
    if (buffer.length > 40 * 1024 * 1024) break // rede de segurança
  }
  if (!buffer || buffer.length === 0) {
    throw new ErroExplicarMeme('imagem vazia/corrompida', 'imagem_invalida')
  }

  const mime = String(midia.mimetype || '').startsWith('image/')
    ? midia.mimetype
    : mimePeloBuffer(buffer)

  let dados = buffer
  let mimeFinal = mime

  try {
    dados = await comprimirSePrecisar(buffer)
    mimeFinal = mime || mimePeloBuffer(dados) || 'image/jpeg'
  } catch (err) {
    throw new ErroExplicarMeme('imagem corrompida ou não suportada', 'imagem_invalida')
  }

  return `data:${mimeFinal};base64,${dados.toString('base64')}`
}

// 📏 Reamostra a imagem p/ base64 enxuta — SÓ quando ela é grande demais ou o
//    mime veio duvidoso. Usa o jimp (JS puro; a regra de ouro do projeto é NUNCA
//    tocar no sharp/libvips in-process). Buffer já pequeno e com mime confiável
//    volta intacto (sem custo de reencode).
async function comprimirSePrecisar (buffer) {
  if (buffer.length <= LIMITE_BYTES_IMAGEM) return buffer
  const img = await Jimp.read(buffer)
  // ⬇️ só reamostra se for maior que o lado máximo
  if (Math.max(img.bitmap.width, img.bitmap.height) > LADO_MAXIMO) {
    img.resize(LADO_MAXIMO, LADO_MAXIMO)
  }
  return await img.getBuffer('image/jpeg') // jpeg: sem alfa, leve p/ base64
}

// 🧪 Erros que valem a pena tentar o PRÓXIMO modelo com visão (rate limit/ser-
//    vidor). Chave inválida ou modelo sem visão não: aí a lista toda vai falhar.
function errosTentamProximo(tipo) {
  return tipo === 'limite' || tipo === 'api' || tipo === 'timeout'
}

// 📡 Uma chamada real a UM modelo (formato multimodal OpenAI)
async function chamarModelo(modelo, chave, dataUrl) {
  const controller = new AbortController()
  const tout = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  let resposta
  try {
    resposta = await fetch(URL_OPENROUTER_CHAT, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + chave,
        'Content-Type': 'application/json',
        'HTTP-Referer': urlDoApp(),
        'X-Title': tituloDoApp()
      },
      body: JSON.stringify({
        model: modelo,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Explique o humor, o contexto e a referência deste meme:' },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }
        ],
        temperature: 0.4,
        max_tokens: 800
      }),
      signal: controller.signal
    })
  } catch (err) {
    clearTimeout(tout)
    if (err && err.name === 'AbortError') throw new ErroExplicarMeme('timeout', 'timeout')
    throw new ErroExplicarMeme(String((err && err.message) || err), 'api')
  }
  clearTimeout(tout)
  if (!resposta.ok) {
    if (resposta.status === 401 || resposta.status === 403) throw new ErroExplicarMeme('HTTP 401', 'chave_invalida')
    if (resposta.status === 429) throw new ErroExplicarMeme('HTTP 429', 'limite')
    throw new ErroExplicarMeme('HTTP ' + resposta.status, 'api')
  }
  const dados = await resposta.json().catch(() => null)
  const msgIa = dados && dados.choices && dados.choices[0] && dados.choices[0].message
  const explicacao = String((msgIa && msgIa.content) || '').trim()
  if (!explicacao) throw new ErroExplicarMeme('resposta vazia', 'vazia')
  return explicacao
}

// 🌐 Núcleo real: manda a imagem p/ um dos modelos de visão da OpenRouter.
//    Se o modelo atual falhar por rate limit/servidor, tenta o próximo da lista.
async function explicarComIa(dataUrl) {
  const chave = String(process.env.OPENROUTER_API_KEY || '').trim()
  if (!chave) throw new ErroExplicarMeme('sem OPENROUTER_API_KEY', 'sem_chave')

  // EXPLICARMEME_MODEL fixa UM modelo (sem fallback); senão tenta a lista toda.
  const fixo = String(process.env.EXPLICARMEME_MODEL || '').trim()
  const modelos = fixo ? [fixo] : MODELOS_VISAO

  let ultimoErro = null
  for (const modelo of modelos) {
    try {
      return await chamarModelo(modelo, chave, dataUrl)
    } catch (err) {
      if (!(err instanceof ErroExplicarMeme)) throw err
      ultimoErro = err
      console.warn(`[explicarmeme] ⚠️ modelo ${modelo} falhou (${err.tipo}: ${err.message}), tentando o próximo...`)
      if (!errosTentamProximo(err.tipo)) break // erro fatal p/ este comando
    }
  }
  throw ultimoErro || new ErroExplicarMeme('nenhum modelo disponível', 'sem_visao')
}

// 🧪 Gancho de teste: por padrão usa o núcleo real (OpenRouter)
let chamadaIa = explicarComIa

// ✂️ Quebra a resposta em blocos de 2500 caracteres
function dividirEmBlocos(texto) {
  const limpo = String(texto || '').trim()
  if (!limpo) return []
  if (limpo.length <= TAMANHO_BLOCO) return [limpo]
  const blocos = []
  let restante = limpo
  while (restante.length > TAMANHO_BLOCO) {
    let corte = restante.lastIndexOf('\n', TAMANHO_BLOCO)
    if (corte < TAMANHO_BLOCO / 2) corte = restante.lastIndexOf(' ', TAMANHO_BLOCO)
    if (corte <= 0) corte = TAMANHO_BLOCO
    blocos.push(restante.slice(0, corte).trim())
    restante = restante.slice(corte).trim()
  }
  if (restante) blocos.push(restante)
  return blocos
}

const AJUDA =
  '😂 *EXPLICAR MEME*\n\n' +
  'Envie uma imagem de meme com o comando na *legenda*, ou *responda* a uma imagem com o comando sozinho.\n\n' +
  '🗝️ Como usar:\n' +
  '• /explicarmeme (com a imagem na legenda)\n' +
  '• /explicarmeme (respondendo a uma imagem)\n\n' +
  'A IA explica o humor, o contexto e a referência do meme.'

function avisoPara(tipo) {
  if (tipo === 'sem_imagem') return AJUDA
  if (tipo === 'imagem_invalida') {
    return '🖼️ *Hipnos não conseguiu ler essa imagem...*\n\nEla pode estar corrompida ou num formato não suportado. Tente reenviar a imagem.'
  }
  if (tipo === 'sem_chave' || tipo === 'chave_invalida') {
    return '😴 *A mente da IA ainda dorme neste recinto...*\n\nO recurso precisa da chave da OpenRouter configurada (OPENROUTER_API_KEY). O dono do bot pode ajustar isso.'
  }
  if (tipo === 'sem_visao') {
    return '👁️ *Nenhum modelo de visão disponível agora...*\n\nOs modelos gratuitos de visão estão todos indisponíveis no momento. Tente novamente mais tarde.'
  }
  if (tipo === 'limite' || tipo === 'timeout') {
    return '⏳ *Os sonhos estão CONFUSOS agora...*\n\nA IA de visão está sobrecarregada. Tente novamente em instantes.'
  }
  return '⛔ *As sombras engoliram a explicação...*\n\nA IA não respondeu agora. Tente novamente em instantes.'
}

module.exports = {
  nome: 'explicarmeme',
  aliases: ['explicameme', 'explicar-meme', 'meme', 'explica-meme'],
  descricao: 'Explica o humor e o contexto de uma imagem de meme com a IA (visão).',
  categoria: 'utilitario',

  async executar(sock, jid, msg, text) {
    try {
      // 📎 CAPTURA: imagem direta (legenda) OU imagem citada (reply)
      const achado = localizarImagem(msg)

      if (!achado) {
        return await sock.sendMessage(jid, { text: avisoPara('sem_imagem') }, { quoted: msg })
      }
      console.log(`[explicarmeme] 📎 imagem capturada: ${achado.origem}`)

      // ⏳ Aviso de processamento (a visão demora alguns segundos)
      await sock.sendMessage(jid, {
        text: '⏳ Hipnos está decifrando a zoeira... Aguarde.'
      }, { quoted: msg })

      // 📥 Baixa a imagem e monta o data URL (base64) p/ a API
      //    Qualquer falha do download (stream quebrado, mídia expirada, itemKey
      //    inválido) é do domínio do comando: vira aviso de imagem, não erro
      //    genérico de IA.
      let dataUrl
      try {
        dataUrl = await imagemParaBase64(achado.midia)
      } catch (err) {
        console.warn('[explicarmeme] falha ao baixar a imagem:', err?.message || err)
        throw new ErroExplicarMeme(String(err?.message || err), 'imagem_invalida')
      }

      // 👁️ Manda p/ a IA de visão
      const explicacao = await chamadaIa(dataUrl)

      // 😄 Envia a explicação (citando a imagem do usuário)
      const blocos = dividirEmBlocos(explicacao)
      const cabecalho = '😂 *O LIMBO DECIFROU A ZOEIRA*\n\n'
      for (let i = 0; i < blocos.length; i++) {
        const corpo = (i === 0 ? cabecalho : '') + blocos[i]
        if (i === 0) await sock.sendMessage(jid, { text: corpo }, { quoted: msg })
        else await sock.sendMessage(jid, { text: corpo })
      }
    } catch (err) {
      console.error('[explicarmeme] erro ao explicar meme:', err)
      const aviso = avisoPara(err && err.tipo)
      return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    }
  },

  // 🧪 Ganchos de teste (nunca usados em produção)
  _injetarIa(fn) {
    chamadaIa = fn
  },
  _restaurarIa() {
    chamadaIa = explicarComIa
  },
  _injetarDownload(fn) {
    baixarMidia = fn
  },
  _restaurarDownload() {
    baixarMidia = (midia) => downloadContentFromMessage(midia, 'image')
  },
  __internos: {
    TIMEOUT_API_MS,
    TAMANHO_BLOCO,
    LIMITE_BYTES_IMAGEM,
    LADO_MAXIMO,
    MODELOS_VISAO,
    MODELO_PADRAO,
    URL_OPENROUTER_CHAT,
    APP_TITLE_PADRAO,
    SITE_URL_PADRAO,
    SYSTEM_PROMPT,
    modeloExplicarMeme,
    urlDoApp,
    tituloDoApp,
    localizarImagem,
    mimePeloBuffer,
    imagemParaBase64,
    explicarComIa,
    chamarModelo,
    dividirEmBlocos,
    avisoPara,
    AJUDA
  }
}
