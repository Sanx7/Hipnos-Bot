// ============================================
// ✍️ REESCREVER — Reescreve um texto em outro tom (OpenRouter, uso LIVRE)
// ============================================
// Mesmo client OpenRouter do /resumir (OPENROUTER_API_KEY +
// /api/v1/chat/completions, modelo gratuito ":free").
// Uso: /reescrever formal Aí mano, bora lá hoje?
//      /reescrever engraçado (respondendo a uma mensagem de TEXTO)
// ============================================

const { normalizeMessageContent, getContentType } = require('@whiskeysockets/baileys')

const TIMEOUT_API_MS = 20000
const TAMANHO_BLOCO = 2500
const LIMITE_ENTRADA = 2000
const URL_OPENROUTER_CHAT = 'https://openrouter.ai/api/v1/chat/completions'
const MODELO_PADRAO = 'nvidia/nemotron-3-super-120b-a12b:free'
const APP_TITLE_PADRAO = 'Hipnos Bot'
const SITE_URL_PADRAO = 'https://hipnos-bot.onrender.com'

// ─── 🎭 Tons (chave: minúscula SEM acento → rótulo + estilo p/ a IA) ───
const TONS = {
  formal: { rotulo: 'formal', estilo: 'formal e respeitoso, com vocabulario cuidado' },
  serio: { rotulo: 'formal', estilo: 'formal e respeitoso, com vocabulario cuidado' },
  culta: { rotulo: 'formal', estilo: 'formal e respeitoso, com vocabulario cuidado' },
  culto: { rotulo: 'formal', estilo: 'formal e respeitoso, com vocabulario cuidado' },
  informal: { rotulo: 'informal', estilo: 'informal e descontraido, como conversa entre amigos' },
  casual: { rotulo: 'informal', estilo: 'informal e descontraido, como conversa entre amigos' },
  descontraido: { rotulo: 'informal', estilo: 'informal e descontraido, como conversa entre amigos' },
  engracado: { rotulo: 'engraçado', estilo: 'engracado e bem-humorado, com leveza, sem ofender ninguem' },
  divertido: { rotulo: 'engraçado', estilo: 'engracado e bem-humorado, com leveza, sem ofender ninguem' },
  humor: { rotulo: 'engraçado', estilo: 'engracado e bem-humorado, com leveza, sem ofender ninguem' },
  poetico: { rotulo: 'poético', estilo: 'poetico e lirico, com imagens delicadas e ritmo de poesia' },
  poesia: { rotulo: 'poético', estilo: 'poetico e lirico, com imagens delicadas e ritmo de poesia' },
  romantico: { rotulo: 'poético', estilo: 'poetico e lirico, com imagens delicadas e ritmo de poesia' },
  educado: { rotulo: 'educado', estilo: 'educado e cortes, com gentileza em cada frase' },
  gentil: { rotulo: 'educado', estilo: 'educado e cortes, com gentileza em cada frase' },
  cordial: { rotulo: 'educado', estilo: 'educado e cortes, com gentileza em cada frase' },
  profissional: { rotulo: 'profissional', estilo: 'profissional e objetivo, como e-mail de trabalho bem escrito' },
  corporativo: { rotulo: 'profissional', estilo: 'profissional e objetivo, como e-mail de trabalho bem escrito' },
  trabalho: { rotulo: 'profissional', estilo: 'profissional e objetivo, como e-mail de trabalho bem escrito' },
  agressivo: { rotulo: 'agressivo', estilo: 'agressivo e provocador, com deboche pesado e tom de confronto' },
  bravo: { rotulo: 'agressivo', estilo: 'agressivo e provocador, com deboche pesado e tom de confronto' },
  zoeira: { rotulo: 'zoeira', estilo: 'de pura zoeira, com deboche de grupo de amigos, sem ofensa grave' },
  zoacao: { rotulo: 'zoeira', estilo: 'de pura zoeira, com deboche de grupo de amigos, sem ofensa grave' },
  deboche: { rotulo: 'zoeira', estilo: 'de pura zoeira, com deboche de grupo de amigos, sem ofensa grave' }
}

const TONS_CANONICOS = ['formal', 'informal', 'engraçado', 'poético', 'educado', 'profissional', 'agressivo', 'zoeira']

// 🧠 Prompt fixo (pt-BR): reescrever mantendo o sentido, só mudando o tom
function promptPara (tom) {
  return 'Você é Hipnos, o guardião do Limbo e dos sonhos (pt-BR). ' +
    'Sua única tarefa é REESCREVER o texto do usuário no tom ' + tom.rotulo.toUpperCase() + ' (' + tom.estilo + '). ' +
    'Mantenha o sentido original: não adicione informações novas, não invente fatos e não dê opiniões. ' +
    'Mude apenas o tom e o estilo das frases. ' +
    'Devolva SOMENTE o texto reescrito, sem saudações nem observações.'
}

class ErroReescrever extends Error {
  constructor (mensagem, tipo) { super(mensagem); this.name = 'ErroReescrever'; this.tipo = tipo }
}

function modeloReescrever () {
  return String(process.env.REESCREVER_MODEL || '').trim() || MODELO_PADRAO
}

function urlDoApp () {
  const custom = String(process.env.OPENROUTER_SITE_URL || '').trim()
  if (custom) return custom
  return String(process.env.RENDER_EXTERNAL_URL || '').trim() || SITE_URL_PADRAO
}

function tituloDoApp () {
  return String(process.env.OPENROUTER_APP_TITLE || '').trim() || APP_TITLE_PADRAO
}

// Normaliza o tom (minúsculas, sem acento) p/ bater com as chaves de TONS
function normalizarTom (texto) {
  return String(texto || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function resolverTom (bruto) {
  const chave = normalizarTom(bruto)
  return TONS[chave] || null
}

// 🎯 "tom + resto": 1ª palavra = tom, resto = texto direto
function separarTomETexto (argumento) {
  const limpo = String(argumento || '').trim()
  if (!limpo) return { tomBruto: '', textoDireto: '' }
  const espaco = limpo.search(/\s/)
  if (espaco === -1) return { tomBruto: limpo, textoDireto: '' }
  return { tomBruto: limpo.slice(0, espaco), textoDireto: limpo.slice(espaco + 1).trim() }
}

function extrairArgumento (texto) {
  return String(texto || '').replace(/^\/\S+\s*/, '').trim()
}

function extrairTextoCitado (msg) {
  const conteudoMsg = normalizeMessageContent(msg.message) || {}
  const mQuoted = conteudoMsg.extendedTextMessage?.contextInfo?.quotedMessage
  if (!mQuoted) return { texto: '', midia: null }
  const q = normalizeMessageContent(mQuoted) || {}
  const tipo = getContentType(q)
  if (tipo === 'audioMessage') return { texto: '', midia: 'audio' }
  if (tipo === 'videoMessage') return { texto: '', midia: 'video' }
  const texto = String(q.conversation || '') || String(q.extendedTextMessage?.text || '') ||
    String(q.imageMessage?.caption || '') || String(q.documentMessage?.caption || '') || String(q.videoMessage?.caption || '')
  return { texto: texto.trim(), midia: null }
}

function truncar (texto) {
  if (texto.length <= LIMITE_ENTRADA) return { texto, truncado: 0 }
  return { texto: texto.slice(0, LIMITE_ENTRADA).trim(), truncado: texto.length - LIMITE_ENTRADA }
}

function dividirEmBlocos (texto) {
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

function ajudaUso () {
  return '✍️ *Como usar a pena do Limbo*\n\n' +
    '`/reescrever <tom> <texto>`\n' +
    '`/reescrever <tom>` respondendo a um texto\n\n' +
    '🎭 Tons: `' + TONS_CANONICOS.join('`, `') + '`\n\n' +
    '🗝️ Exemplos:\n- `/reescrever formal Aí mano, bora lá hoje?`\n- `/reescrever engraçado` (respondendo a uma mensagem)'
}

function ajudaTomInvalido (tomBruto) {
  return '🎭 *Não reconheci o tom "' + tomBruto + '"...*\n\n' +
    'Escolha um destes: `' + TONS_CANONICOS.join('`, `') + '`\n\n' +
    '🗝️ Exemplo: `/reescrever formal Aí mano, bora lá hoje?`'
}

async function reescreverComIa (texto, tom) {
  const chave = String(process.env.OPENROUTER_API_KEY || '').trim()
  if (!chave) throw new ErroReescrever('sem OPENROUTER_API_KEY', 'sem_chave')
  const controller = new AbortController()
  const tout = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  let resposta
  try {
    resposta = await fetch(URL_OPENROUTER_CHAT, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + chave, 'Content-Type': 'application/json', 'HTTP-Referer': urlDoApp(), 'X-Title': tituloDoApp() },
      body: JSON.stringify({ model: modeloReescrever(), messages: [{ role: 'system', content: promptPara(tom) }, { role: 'user', content: texto }], temperature: 0.8, max_tokens: 2000 }),
      signal: controller.signal
    })
  } catch (err) {
    clearTimeout(tout)
    if (err && err.name === 'AbortError') throw new ErroReescrever('timeout', 'timeout')
    throw new ErroReescrever(String((err && err.message) || err), 'api')
  }
  clearTimeout(tout)
  if (!resposta.ok) {
    if (resposta.status === 401 || resposta.status === 403) throw new ErroReescrever('HTTP 401', 'chave_invalida')
    if (resposta.status === 429) throw new ErroReescrever('HTTP 429', 'limite')
    throw new ErroReescrever('HTTP ' + resposta.status, 'api')
  }
  const dados = await resposta.json().catch(() => null)
  const msgIa = dados && dados.choices && dados.choices[0] && dados.choices[0].message
  const reescrito = String((msgIa && msgIa.content) || '').trim()
  if (!reescrito) throw new ErroReescrever('resposta vazia', 'vazia')
  return reescrito
}

let chamadaIa = reescreverComIa

function cabecalho (tom) {
  return '✍️ *A PENA DO LIMBO REESCREVE* 🌙\n\n🎭 Tom: *' + tom.rotulo + '*\n\n'
}

function avisoPara (tipo) {
  if (tipo === 'sem_chave' || tipo === 'chave_invalida') {
    return '😴 *A mente da IA ainda dorme neste recinto...*\n\nO recurso precisa da chave OPENROUTER_API_KEY configurada pelo dono do bot (grátis em openrouter.ai).'
  }
  if (tipo === 'limite' || tipo === 'timeout') {
    return '⏳ *A mente da IA está sobrecarregada...*\n\nAguarde um pouco e tente reescrever de novo.'
  }
  return '⛔ *As sombras engoliram a reescrita...*\n\nA IA não respondeu agora. Tente novamente em instantes.'
}

module.exports = {
  nome: 'reescrever',
  aliases: ['reescreve', 'reetexto', 'rewrite'],
  descricao: 'Reescreve um texto em outro tom com a IA (no próprio comando ou respondendo a uma mensagem).',
  categoria: 'utilitario',

  async executar (sock, jid, msg, text) {
    try {
      const argumento = extrairArgumento(text)
      if (!argumento) {
        return await sock.sendMessage(jid, { text: ajudaUso() }, { quoted: msg })
      }
      const { tomBruto, textoDireto } = separarTomETexto(argumento)
      const tom = resolverTom(tomBruto)
      if (!tom) {
        return await sock.sendMessage(jid, { text: ajudaTomInvalido(tomBruto) }, { quoted: msg })
      }
      let bruto = textoDireto
      if (!bruto) {
        const citado = extrairTextoCitado(msg)
        if (citado.midia) {
          const tipoMidia = citado.midia === 'audio' ? 'áudio' : 'vídeo'
          return await sock.sendMessage(jid, { text: '🎙️ *Aqui só reescrevo texto, não mídia...*\n\nResponda a uma mensagem de TEXTO com `/reescrever ' + tomBruto + '` — para áudio/vídeo, use o /transcrever primeiro.' }, { quoted: msg })
        }
        bruto = citado.texto
      }
      if (!bruto) {
        return await sock.sendMessage(jid, { text: '📝 *Me entregue um texto para reescrever...*\n\nEnvie o texto depois do tom ou RESPONDA a uma mensagem com o comando sozinho.\n\n🗝️ Exemplos:\n- `/reescrever formal Aí mano, bora lá hoje?`\n- `/reescrever engraçado` (respondendo a uma mensagem)' }, { quoted: msg })
      }
      const { texto, truncado } = truncar(bruto)
      const reescrito = await chamadaIa(texto, tom)
      const avisoTruncado = truncado ? '\n\n✂️ *Aviso:* o texto era muito longo e foi truncado em ' + LIMITE_ENTRADA + ' caracteres (' + truncado + ' descartados).' : ''
      const head = cabecalho(tom) + avisoTruncado + (avisoTruncado ? '\n' : '')
      const blocos = dividirEmBlocos(reescrito)
      for (let i = 0; i < blocos.length; i++) {
        const corpo = (i === 0 ? head : '') + blocos[i]
        if (i === 0) await sock.sendMessage(jid, { text: corpo }, { quoted: msg })
        else await sock.sendMessage(jid, { text: corpo })
      }
    } catch (err) {
      console.error('[reescrever] erro ao reescrever:', err)
      const aviso = avisoPara(err && err.tipo)
      return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    }
  },

  _injetarIa (fn) { chamadaIa = fn },
  _restaurarIa () { chamadaIa = reescreverComIa },
  __internos: {
    TIMEOUT_API_MS, TAMANHO_BLOCO, LIMITE_ENTRADA, MODELO_PADRAO, URL_OPENROUTER_CHAT,
    APP_TITLE_PADRAO, SITE_URL_PADRAO, TONS, TONS_CANONICOS, modeloReescrever, urlDoApp,
    tituloDoApp, normalizarTom, resolverTom, separarTomETexto, promptPara,
    extrairArgumento, extrairTextoCitado, truncar, dividirEmBlocos, cabecalho, avisoPara, ajudaUso, ajudaTomInvalido
  }
}
