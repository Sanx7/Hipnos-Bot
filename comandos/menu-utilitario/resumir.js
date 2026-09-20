// ============================================
// 📝 RESUMIR — Resume um texto longo com a IA (OpenRouter, uso LIVRE)
// ============================================
// Resume um texto direto ou uma mensagem citada (reply) usando fetch nativo
// + OPENROUTER_API_KEY (https://openrouter.ai) + /api/v1/chat/completions —
// o MESMO formato OpenAI já usado pelos outros comandos de IA do projeto,
// mas com provedor PRÓPRIO: só o /resumir usa OpenRouter; /gpt, /frase,
// /nasa e a IA interativa continuam na Groq.
//
// Uso:
//   /resumir <texto longo aqui>
//   /resumir  (respondendo a uma mensagem de TEXTO longa)
//
// Regras:
//   - ✂️ ENTRADA: acima de 8000 caracteres o texto é TRUNCADO antes de ir
//     p/ a IA (o aviso do truncamento aparece junto da resposta);
//   - 🥱 CURTO DEMAIS: abaixo de 200 caracteres não vale resumir (avisa);
//   - 🎙️ Reply a ÁUDIO/VÍDEO: Hipnos NÃO resume mídia aqui — avisa para
//     usar o /transcrever primeiro (só texto, por design);
//   - 🧠 PROMPT FIXO (pt-BR): resumo objetivo, pontos principais, tamanho
//     proporcional (~20-30% do original), sem inventar nada;
//   - ⛔ Erros de API no MESMO tratamento amigável do /gpt (sem chave, chave
//     inválida, 429/timeout, api fora, resposta vazia) — aviso amigável,
//     NADA escapa para o listener do bot;
//   - 🆔 A requisição vai com os headers recomendados pela OpenRouter:
//     HTTP-Referer (URL do app) e X-Title ("Hipnos Bot") p/ identificar o app;
//   - 🆓 MODELO: gratuito, com sufixo ":free" (ver MODELO_PADRAO) — troque
//     por RESUMIR_MODEL no ambiente se este sair do catálogo da OpenRouter;
//   - ✂️ resposta longa → blocos de 2500 caracteres;
//   - logs "[resumir] ..." para diagnóstico no Render.
//
// ⚙️ Config (todas opcionais, exceto a chave):
//   OPENROUTER_API_KEY   — chave da OpenRouter (obrigatória p/ este comando);
//   RESUMIR_MODEL        — modelo OpenRouter (padrão: qwen/qwen3.8-27b:free).
//                          Obs.: o nome antigo GROQ_MODEL_RESUMIR (da versão
//                          Groq deste comando) ainda é aceito como fallback;
//   OPENROUTER_SITE_URL  — sobrescreve o HTTP-Referer (padrão: RENDER_EXTERNAL_URL);
//   OPENROUTER_APP_TITLE — sobrescreve o X-Title (padrão: "Hipnos Bot").
// ============================================

const { normalizeMessageContent, getContentType } = require('@whiskeysockets/baileys')

const TIMEOUT_API_MS = 20000
const TAMANHO_BLOCO = 2500
const LIMITE_ENTRADA = 8000   // ✂️ acima disso, trunca (e avisa)
const MINIMO_ENTRADA = 200    // 🥱 abaixo disso, "não vale a pena"
const URL_OPENROUTER_CHAT = 'https://openrouter.ai/api/v1/chat/completions'

// 🆓 Modelo GRATUITO da OpenRouter (sufixo ":free" — custo zero).
//    Catálogo vigente em https://openrouter.ai/models (confira antes de trocar):
//    se este modelo sair do ar, defina RESUMIR_MODEL no ambiente.
const MODELO_PADRAO = 'qwen/qwen3.8-27b:free'
const APP_TITLE_PADRAO = 'Hipnos Bot'
const SITE_URL_PADRAO = 'https://hipnos-bot.onrender.com'

// 🧠 Instrução fixa (pt-BR): resumo objetivo e proporcional, sem inventar
const SYSTEM_PROMPT =
  'Você é Hipnos, o guardião do Limbo e dos sonhos (pt-BR). Sua única tarefa é RESUMIR textos. ' +
  'Faça um resumo objetivo em português do Brasil, mantendo os pontos principais do texto. ' +
  'O tamanho do resumo deve ser proporcional ao original (cerca de 20-30% do tamanho). ' +
  'Não invente informações, não dê opiniões e não acrescente comentários seus: ' +
  'devolva SOMENTE o texto do resumo, sem saudações nem observações.'

// 🧪 Erro de domínio: mensagem técnica + tipo p/ o aviso amigável correto
class ErroResumo extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroResumo'
    this.tipo = tipo // 'sem_chave' | 'chave_invalida' | 'limite' | 'timeout' | 'api' | 'vazia'
  }
}

function modeloResumir() {
  const personalizado = String(
    process.env.RESUMIR_MODEL ||
    process.env.GROQ_MODEL_RESUMIR || // 🕘 nome antigo (versão Groq): ainda aceito
    ''
  ).trim()
  return personalizado || MODELO_PADRAO
}

// 🆔 HTTP-Referer exigido/recomendado pela OpenRouter. No Render, a variável
//    RENDER_EXTERNAL_URL já traz a URL pública do serviço automaticamente.
function urlDoApp() {
  const custom = String(process.env.OPENROUTER_SITE_URL || '').trim()
  if (custom) return custom
  const doRender = String(process.env.RENDER_EXTERNAL_URL || '').trim()
  return doRender || SITE_URL_PADRAO
}

// 🏷️ X-Title: nome do app exibido no ranking da OpenRouter (opcional).
function tituloDoApp() {
  return String(process.env.OPENROUTER_APP_TITLE || '').trim() || APP_TITLE_PADRAO
}

// 🎯 Argumento após o comando (cobre /resumir, /resumo, /resumir-agora...)
function extrairArgumento(texto) {
  return String(texto || '').replace(/^\/\S+\s*/, '').trim()
}

// 📜 Extrai o TEXTO de uma mensagem citada (reply). Devolve { texto, midia }:
//   texto — conversation | extendedTextMessage.text | caption (se houver);
//   midia — 'audio' | 'video' | null (p/ o aviso do /transcrever).
function extrairTextoCitado(msg) {
  const conteudoMsg = normalizeMessageContent(msg.message) || {}
  const mQuoted = conteudoMsg.extendedTextMessage?.contextInfo?.quotedMessage
  if (!mQuoted) return { texto: '', midia: null }

  const q = normalizeMessageContent(mQuoted) || {}
  const tipo = getContentType(q)

  if (tipo === 'audioMessage') return { texto: '', midia: 'audio' }
  if (tipo === 'videoMessage') return { texto: '', midia: 'video' }

  const texto =
    String(q.conversation || '') ||
    String(q.extendedTextMessage?.text || '') ||
    String(q.imageMessage?.caption || '') ||
    String(q.documentMessage?.caption || '') ||
    String(q.videoMessage?.caption || '')

  return { texto: texto.trim(), midia: null }
}

// ✂️ Trunca textos absurdamente longos (limite p/ não estourar a IA)
function truncar(texto) {
  if (texto.length <= LIMITE_ENTRADA) return { texto, truncado: 0 }
  return { texto: texto.slice(0, LIMITE_ENTRADA).trim(), truncado: texto.length - LIMITE_ENTRADA }
}

// ✂️ Quebra a resposta em blocos de 2500 caracteres (mesmo padrão do /gpt)
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

// 🌐 Núcleo real: manda o texto p/ a OpenRouter (mesmo formato OpenAI do
//    resto do projeto). Tratamento de erro idêntico ao do /gpt (sem chave,
//    chave inválida, 429/timeout, api fora, resposta vazia) — só muda o provedor.
async function resumirComIa(texto) {
  const chave = String(process.env.OPENROUTER_API_KEY || '').trim()
  if (!chave) throw new ErroResumo('sem OPENROUTER_API_KEY', 'sem_chave')
  const controller = new AbortController()
  const tout = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  let resposta
  try {
    resposta = await fetch(URL_OPENROUTER_CHAT, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + chave,
        'Content-Type': 'application/json',
        // 🆔 headers recomendados pela OpenRouter p/ identificar o app
        'HTTP-Referer': urlDoApp(),
        'X-Title': tituloDoApp()
      },
      body: JSON.stringify({
        model: modeloResumir(),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: texto }
        ],
        temperature: 0.3,
        max_tokens: 2000
      }),
      signal: controller.signal
    })
  } catch (err) {
    clearTimeout(tout)
    if (err && err.name === 'AbortError') throw new ErroResumo('timeout', 'timeout')
    throw new ErroResumo(String((err && err.message) || err), 'api')
  }
  clearTimeout(tout)
  if (!resposta.ok) {
    if (resposta.status === 401 || resposta.status === 403) throw new ErroResumo('HTTP 401', 'chave_invalida')
    if (resposta.status === 429) throw new ErroResumo('HTTP 429', 'limite')
    throw new ErroResumo('HTTP ' + resposta.status, 'api')
  }
  const dados = await resposta.json().catch(() => null)
  const msgIa = dados && dados.choices && dados.choices[0] && dados.choices[0].message
  const resumo = String((msgIa && msgIa.content) || '').trim()
  if (!resumo) throw new ErroResumo('resposta vazia', 'vazia')
  return resumo
}

// 🧪 Gancho de teste: por padrão usa o núcleo real (OpenRouter)
let chamadaIa = resumirComIa

function cabecalho(original, resumo) {
  return (
    '📝 *O LIMBO CONDENSA O TEXTO* 🌙\n\n' +
    '📄 Original: *' + original + '* caracteres\n' +
    '🧠 Resumo: *' + resumo + '* caracteres\n\n'
  )
}

function avisoPara(tipo) {
  if (tipo === 'sem_chave' || tipo === 'chave_invalida') {
    return '😴 *A mente da IA ainda dorme neste recinto...*\n\nO recurso precisa da chave OPENROUTER_API_KEY configurada pelo dono do bot (grátis em openrouter.ai).'
  }
  if (tipo === 'limite' || tipo === 'timeout') {
    return '⏳ *A mente da IA está sobrecarregada...*\n\nAguarde um pouco e tente resumir de novo.'
  }
  return '⛔ *As sombras engoliram o resumo...*\n\nA IA não respondeu agora. Tente novamente em instantes.'
}

module.exports = {
  nome: 'resumir',
  aliases: ['resumo', 'sumarizar', 'summarize'],
  descricao: 'Resume um texto longo com a IA (no próprio comando ou respondendo a uma mensagem).',
  categoria: 'utilitario',

  async executar(sock, jid, msg, text) {
    try {
      const direto = extrairArgumento(text)
      const { texto: textoCitado, midia } = extrairTextoCitado(msg)
      const bruto = direto || textoCitado

      // 🎙️ Reply a áudio/vídeo sem texto digitado → manda usar o /transcrever
      if (!bruto && midia) {
        const tipoMidia = midia === 'audio' ? 'áudio' : 'vídeo'
        return await sock.sendMessage(jid, {
          text:
            '🎙️ *Hipnos ouve, mas não resume mídia diretamente...*\n\n' +
            'Para resumir esse ' + tipoMidia + ', primeiro use o */transcrever* respondendo a ele ' +
            'e depois mande o */resumir* no texto transcrito.'
        }, { quoted: msg })
      }

      // 📭 Nada de texto (nem digitado, nem citado)
      if (!bruto) {
        return await sock.sendMessage(jid, {
          text:
            '📝 *Me entregue um pergaminho para condensar...*\n\n' +
            'Envie o texto depois do comando ou RESPONDA a uma mensagem longa com o comando sozinho.\n\n' +
            '🗝️ Exemplos:\n- `/resumir <texto longo aqui>`\n- `/resumir` (respondendo ao texto)'
        }, { quoted: msg })
      }

      // 🥱 Curto demais: não vale a pena resumir
      if (bruto.length < MINIMO_ENTRADA) {
        return await sock.sendMessage(jid, {
          text:
            '🥱 *Esse texto é curto demais para resumir...*\n\n' +
            'Me mande algo com pelo menos *' + MINIMO_ENTRADA + ' caracteres* ' +
            '(o seu tem ' + bruto.length + ') — ou responda a uma mensagem maior.'
        }, { quoted: msg })
      }

      // ✂️ Trunca textos absurdamente longos (com aviso junto da resposta)
      const { texto, truncado } = truncar(bruto)
      const resumo = await chamadaIa(texto)

      const avisoTruncado = truncado
        ? '\n\n✂️ *Aviso:* o texto era muito longo e foi truncado em ' + LIMITE_ENTRADA +
          ' caracteres (' + truncado + ' descartados).'
        : ''
      const head = cabecalho(bruto.length, resumo.length) + avisoTruncado
      const blocos = dividirEmBlocos(resumo)
      for (let i = 0; i < blocos.length; i++) {
        const corpo = (i === 0 ? head + '\n' : '') + blocos[i]
        if (i === 0) await sock.sendMessage(jid, { text: corpo }, { quoted: msg })
        else await sock.sendMessage(jid, { text: corpo })
      }
    } catch (err) {
      console.error('[resumir] erro ao resumir:', err)
      const aviso = avisoPara(err && err.tipo)
      return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    }
  },

  // 🧪 Ganchos de teste (nunca usados em produção)
  _injetarIa(fn) {
    chamadaIa = fn
  },
  _restaurarIa() {
    chamadaIa = resumirComIa
  },
  __internos: {
    TIMEOUT_API_MS,
    TAMANHO_BLOCO,
    LIMITE_ENTRADA,
    MINIMO_ENTRADA,
    MODELO_PADRAO,
    URL_OPENROUTER_CHAT,
    APP_TITLE_PADRAO,
    SITE_URL_PADRAO,
    SYSTEM_PROMPT,
    modeloResumir,
    urlDoApp,
    tituloDoApp,
    extrairArgumento,
    extrairTextoCitado,
    truncar,
    dividirEmBlocos,
    cabecalho,
    avisoPara
  }
}
