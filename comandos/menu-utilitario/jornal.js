// ============================================================
// PARTE 1/5 — cabecalho + IA (Groq, mesmo client do /gpt)
// ============================================================
// /jornal: resumo diario do grupo como capa de jornal (imagem jimp).
// Fonte: dados/captura-diaria.js (memoria + espelho Mongo com TTL).
// ============================================================
const { Jimp, JimpMime, loadFont, measureText } = require('jimp')
const { SANS_32_BLACK, SANS_16_BLACK } = require('jimp/fonts')
const { lerAcumulado, chaveDataLocal } = require('../../dados/captura-diaria')

// 📰 Nome do jornal no topo da capa — TROQUE AQUI quando o nome final
// for decidido (é a única constante visual com nome próprio).
const NOME_JORNAL = 'JORNAL DO HIPNOS'

const TIMEOUT_API_MS = 20000
const LIMITE_ENTRADA = 8000
const URL_GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions'
const MODELO_PADRAO = 'openai/gpt-oss-20b'

const SYSTEM_PROMPT =
  'Voce e Hipnos, o guardiao do Limbo (pt-BR). Recebera as mensagens de um dia de um grupo de WhatsApp. ' +
  'Devolva UM JSON valido, sem markdown, com duas chaves: "manchete" (o assunto mais discutido do dia, curto, tipo titulo de jornal, ate 90 caracteres) ' +
  'e "resumo" (resumo em texto corrido das conversas, 2 a 4 paragrafos, tom neutro tipo noticia). ' +
  'Nao invente fatos fora das mensagens. Responda SOMENTE o JSON.'

class ErroJornal extends Error {
  constructor (mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroJornal'
    this.tipo = tipo
  }
}

function modeloJornal () {
  const m = String(process.env.GROQ_MODEL_JORNAL || process.env.GROQ_MODEL || '').trim()
  return m || MODELO_PADRAO
}

function montarTextoDia (dia) {
  const linhas = (dia?.mensagens || []).map((m) => (m.autor + ': ' + m.texto).trim())
  return linhas.join('\n').trim()
}

function truncar (texto) {
  const t = String(texto || '')
  if (t.length <= LIMITE_ENTRADA) return { texto: t, truncado: 0 }
  return { texto: t.slice(0, LIMITE_ENTRADA), truncado: t.length - LIMITE_ENTRADA }
}

function montarPrompt (textoDia) {
  return 'Mensagens do dia no grupo:\n\n' + textoDia + '\n\nDevolva o JSON {"manchete","resumo"}.'
}

let resumirDiaComIaReal = async (textoDia) => {
  const chave = String(process.env.GROQ_API_KEY || '').trim()
  if (!chave) throw new ErroJornal('sem GROQ_API_KEY', 'sem_chave')
  const controller = new AbortController()
  const tout = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  let resposta
  try {
    resposta = await fetch(URL_GROQ_CHAT, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modeloJornal(),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: montarPrompt(textoDia) }
        ],
        temperature: 0.5,
        max_tokens: 1500
      }),
      signal: controller.signal
    })
  } catch (err) {
    clearTimeout(tout)
    if (err && err.name === 'AbortError') throw new ErroJornal('timeout', 'timeout')
    throw new ErroJornal(String((err && err.message) || err), 'api')
  }
  clearTimeout(tout)
  if (!resposta.ok) {
    if (resposta.status === 401 || resposta.status === 403) throw new ErroJornal('HTTP 401', 'chave_invalida')
    if (resposta.status === 429) throw new ErroJornal('HTTP 429', 'limite')
    throw new ErroJornal('HTTP ' + resposta.status, 'api')
  }
  const dados = await resposta.json().catch(() => null)
  const bruto = String((dados && dados.choices && dados.choices[0] && dados.choices[0].message && dados.choices[0].message.content) || '').trim()
  if (!bruto) throw new ErroJornal('resposta vazia', 'vazia')
  const parsed = extrairJson(bruto)
  if (!parsed || !parsed.manchete || !parsed.resumo) throw new ErroJornal('resposta vazia', 'vazia')
  return { manchete: String(parsed.manchete).trim().slice(0, 120), resumo: String(parsed.resumo).trim() }
}
let resumirDiaComIa = resumirDiaComIaReal

function extrairJson (bruto) {
  const limpo = String(bruto || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try { return JSON.parse(limpo) } catch (e) {}
  const ini = limpo.indexOf('{')
  const fim = limpo.lastIndexOf('}')
  if (ini !== -1 && fim > ini) {
    try { return JSON.parse(limpo.slice(ini, fim + 1)) } catch (e) {}
  }
  return null
}

function avisoPara (tipo) {
  if (tipo === 'sem_chave' || tipo === 'chave_invalida') {
    return '😴 *A mente da IA ainda dorme neste recinto...*\n\nO recurso precisa da chave GROQ_API_KEY configurada pelo dono do bot (grátis em console.groq.com).'
  }
  if (tipo === 'limite' || tipo === 'timeout') {
    return '⏳ *A mente da IA está sobrecarregada...*\n\nAguarde um pouco e tente de novo.'
  }
  return '⛔ *As sombras engoliram o jornal...*\n\nA IA não respondeu agora. Tente novamente em instantes.'
}

const AVISO_VAZIO =
  '🗞️ *O jornal de hoje ainda está em branco...*\n\nAinda não há conversa suficiente neste grupo hoje. Converse um pouco e chame o /jornal mais tarde.'


// ============================================================
// PARTE 2/5 — capa de jornal (jimp, JS puro, sem lib nativa)
// ============================================================
// Layout: fundo bege claro, texto preto, divisorias pretas finas.
// Topo: NOME_JORNAL + data. Manchete grande. Foto do grupo (30-35%
// da altura, nunca mais). Resumo em 2 colunas com quebra manual
// palavra por palavra medida na fonte (nunca estoura a coluna).
const CAPA_LARG = 900
const CAPA_ALT = 1200
const MARGEM = 40
const COR_FUNDO = 0xf5efddff
const COR_PRETO = 0x111111ff

const CACHE_FONTE_JORNAL = new Map()
async function fonteJornal (qual) {
  if (!CACHE_FONTE_JORNAL.has(qual)) {
    CACHE_FONTE_JORNAL.set(qual, await loadFont(qual))
  }
  return CACHE_FONTE_JORNAL.get(qual)
}

function pintarReto (imagem, x, y, w, h, cor) {
  const x0 = Math.max(0, x)
  const y0 = Math.max(0, y)
  const x1 = Math.min(imagem.bitmap.width, x + w)
  const y1 = Math.min(imagem.bitmap.height, y + h)
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) imagem.setPixelColor(cor, px, py)
  }
}

function quebrarEmLinhas (font, texto, larguraMax) {
  const linhas = []
  const paras = String(texto || '').split('\n')
  for (const paragrafo of paras) {
    const palavras = String(paragrafo).split(/\s+/).filter(Boolean)
    if (!palavras.length) { linhas.push(''); continue }
    let atual = ''
    for (const palavra of palavras) {
      const tentativa = atual ? atual + ' ' + palavra : palavra
      if (measureText(font, tentativa) <= larguraMax || !atual) atual = tentativa
      else { linhas.push(atual); atual = palavra }
    }
    if (atual) linhas.push(atual)
  }
  return linhas
}

function dataPorExtenso () {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long', year: 'numeric'
    }).format(new Date())
  } catch (e) { return chaveDataLocal() }
}

async function comporCapaJornal (args) {
  const manchete = args.manchete
  const resumo = args.resumo
  const fotoBuffer = args.fotoBuffer
  const fontTitulo = await fonteJornal(SANS_32_BLACK)
  const fontTexto = await fonteJornal(SANS_16_BLACK)
  const imagem = new Jimp({ width: CAPA_LARG, height: CAPA_ALT, color: COR_FUNDO })
  const largUtil = CAPA_LARG - MARGEM * 2
  let y = MARGEM
  imagem.print({ font: fontTitulo, x: MARGEM, y, w: largUtil, text: { text: NOME_JORNAL, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER } })
  y += 44
  pintarReto(imagem, MARGEM, y, largUtil, 3, COR_PRETO)
  y += 12
  imagem.print({ font: fontTexto, x: MARGEM, y, w: largUtil, text: { text: dataPorExtenso(), alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER } })
  y += 30
  pintarReto(imagem, MARGEM, y, largUtil, 2, COR_PRETO)
  y += 14
  const linhasManchete = quebrarEmLinhas(fontTitulo, manchete, largUtil).slice(0, 3)
  for (const linha of linhasManchete) {
    imagem.print({ font: fontTitulo, x: MARGEM, y, w: largUtil, text: { text: ' ' + linha, alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT } })
    y += 40
  }
  y += 6
  pintarReto(imagem, MARGEM, y, largUtil, 2, COR_PRETO)
  y += 14
  const ALT_MAX_FOTO = Math.round(CAPA_ALT * 0.35)
  const ALT_MIN_FOTO = Math.round(CAPA_ALT * 0.20)
  if (fotoBuffer && fotoBuffer.length > 0) {
    try {
      const foto = await Jimp.read(fotoBuffer)
      const altAlvo = Math.min(ALT_MAX_FOTO, Math.max(ALT_MIN_FOTO, 300))
      foto.cover({ w: largUtil, h: altAlvo })
      imagem.composite(foto, MARGEM, y)
      y += altAlvo + 14
      pintarReto(imagem, MARGEM, y, largUtil, 2, COR_PRETO)
      y += 14
    } catch (e) {
      console.error('[jornal] foto ignorada (seguindo sem foto):', e?.message || e)
    }
  }
  const largCol = Math.floor((largUtil - 24) / 2)
  const linhasResumo = quebrarEmLinhas(fontTexto, resumo, largCol).slice(0, 60)
  const meio = Math.ceil(linhasResumo.length / 2)
  const colEsq = linhasResumo.slice(0, meio)
  const colDir = linhasResumo.slice(meio)
  pintarReto(imagem, MARGEM + largCol + 12, y, 2, CAPA_ALT - y - MARGEM, COR_PRETO)
  let yEsq = y
  for (const linha of colEsq) {
    if (yEsq + 22 > CAPA_ALT - MARGEM) break
    imagem.print({ font: fontTexto, x: MARGEM, y: yEsq, text: ' ' + linha })
    yEsq += 22
  }
  let yDir = y
  const xDir = MARGEM + largCol + 24
  for (const linha of colDir) {
    if (yDir + 22 > CAPA_ALT - MARGEM) break
    imagem.print({ font: fontTexto, x: xDir, y: yDir, text: ' ' + linha })
    yDir += 22
  }
  return imagem.getBuffer(JimpMime.png)
}


// PARTE 3/5 — foto do grupo + thumbnail + fallback texto
async function baixarImagem (url, limiteBytes, timeoutMs) {
  const lim = limiteBytes || 8 * 1024 * 1024
  const tmo = timeoutMs || 20000
  if (typeof url !== 'string' || !url.startsWith('https://')) return null
  if (typeof globalThis.fetch !== 'function') return null
  let timer = null
  try {
    const resp = await Promise.race([
      globalThis.fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'WhatsApp/2.24.6.77' } }),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout foto')), tmo) })
    ]).finally(() => { if (timer) clearTimeout(timer) })
    if (!resp.ok) return null
    const bytes = new Uint8Array(await resp.arrayBuffer())
    if (!bytes.length || bytes.length > lim) return null
    return Buffer.from(bytes)
  } catch (e) {
    console.error('[jornal] foto nao baixada:', e?.message || e)
    return null
  }
}

async function gerarThumbnailBase64 (bufferPng) {
  try {
    const img = await Jimp.read(bufferPng)
    img.cover({ w: 64, h: 64 })
    const mini = await img.getBuffer(JimpMime.jpeg, { quality: 80 })
    return mini.toString('base64')
  } catch (e) {
    console.error('[jornal] thumbnail falhou:', e?.message || e)
    return null
  }
}

function textoFallback (manchete, resumo, truncado) {
  let t = 'MANCHETE: ' + manchete + '\n\n' + resumo
  if (truncado) t += '\n\n(Aviso: conversa longa, truncada em ' + LIMITE_ENTRADA + ' caracteres.)'
  return t
}


let comporCapa = comporCapaJornal

module.exports = {
  nome: 'jornal',
  aliases: ['resumododia', 'manchetes'],
  descricao: 'Resume o dia do grupo como capa de jornal (imagem).',
  categoria: 'utilitario',

  async executar (sock, jid, msg) {
    try {
      if (!String(jid || '').endsWith('@g.us')) {
        return await sock.sendMessage(jid, {
          text: 'O jornal so circula nos grupos. Chame o /jornal dentro de um grupo.'
        }, { quoted: msg }).catch(() => {})
      }
      const dia = await lerAcumulado(String(jid))
      const textoDia = montarTextoDia(dia)
      if (!textoDia || (dia.mensagens || []).length < 3) {
        return await sock.sendMessage(jid, { text: AVISO_VAZIO }, { quoted: msg }).catch(() => {})
      }
      const parte = truncar(textoDia)
      let manchete = ''
      let resumo = ''
      try {
        const ia = await resumirDiaComIa(parte.texto)
        manchete = ia.manchete
        resumo = ia.resumo
      } catch (errIa) {
        console.error('[jornal] erro na IA:', errIa)
        return await sock.sendMessage(jid, { text: avisoPara(errIa && errIa.tipo) }, { quoted: msg }).catch(() => {})
      }
      let fotoBuffer = null
      try {
        const url = await sock.profilePictureUrl(jid, 'image')
        fotoBuffer = await baixarImagem(url)
      } catch (e) {
        console.error('[jornal] sem foto do grupo:', e?.message || e)
      }
      const legenda = 'Resumo do dia - ' + manchete
      try {
        const capa = await comporCapa({ manchete, resumo, fotoBuffer })
        const thumb = await gerarThumbnailBase64(capa)
        const payload = { image: capa, caption: legenda }
        if (thumb) payload.jpegThumbnail = thumb
        await sock.sendMessage(jid, payload, { quoted: msg })
      } catch (errCapa) {
        console.error('[jornal] capa falhou, texto:', errCapa?.message || errCapa)
        await sock.sendMessage(jid, {
          text: 'Versao em imagem falhou, segue em texto:\n\n' + textoFallback(manchete, resumo, parte.truncado)
        }, { quoted: msg }).catch(() => {})
      }
    } catch (err) {
      console.error('[jornal] erro (bot vivo):', err?.stack || err)
      await sock.sendMessage(jid, { text: avisoPara() }, { quoted: msg }).catch(() => {})
    }
  },

  _injetarIa (fn) { resumirDiaComIa = fn },
  _restaurarIa () { resumirDiaComIa = resumirDiaComIaReal },
  _injetarCapa (fn) { comporCapa = fn },
  _restaurarCapa () { comporCapa = comporCapaJornal },
  __internos: {
    NOME_JORNAL, TIMEOUT_API_MS, LIMITE_ENTRADA, URL_GROQ_CHAT, MODELO_PADRAO,
    SYSTEM_PROMPT, CAPA_LARG, CAPA_ALT, MARGEM,
    montarTextoDia, truncar, montarPrompt, extrairJson, avisoPara,
    quebrarEmLinhas, comporCapaJornal, textoFallback, dataPorExtenso,
    modeloJornal, AVISO_VAZIO, ErroJornal
  }
}
