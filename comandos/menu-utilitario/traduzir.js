// ============================================
// 🌐 TRADUZIR — Traduz textos entre idiomas (uso LIVRE)
// ============================================
// Uso:
//   /traduzir <idioma> <texto>
//   /traduzir <texto>              (destino: português, origem automática)
//   /traduzir <idioma>             (respondendo a uma mensagem de TEXTO)
//
//   Ex.: /traduzir en Bom dia, tudo bem?
//   Ex.: /traduzir inglês Good morning
//   Ex.: /traduzir en (respondendo a um texto)
//
// Regras:
//   - 🌍 IDIOMA: aceita código ISO (en) ou nome comum em pt-BR (inglês),
//     com ou sem acento (ingles = inglês). Desconhecido + sem texto →
//     ajuda amigável;
//   - 📜 REPLY: sem texto após o comando/idioma, usa o texto da mensagem
//     citada (conversation, texto estendido ou legenda). Reply a
//     ÁUDIO/VÍDEO → avisa para usar o /transcrever primeiro (só texto);
//   - ✂️ ENTRADA: acima de 500 caracteres é TRUNCADA antes de traduzir
//     (aviso junto da resposta — APIs gratuitas limitam por requisição);
//   - 🌐 FONTES (ordem, primária + fallback):
//     1) MyMemory (https://api.mymemory.translated.net/get — gratuita,
//        sem key). Origem automática via langpair=autodetect|<destino>;
//     2) Google gtx (https://translate.googleapis.com/translate_a/single
//        ?client=gtx — gratuita, sem key, com sl=auto).
//     ⚠️ Por que NÃO LibreTranslate pública como fallback: verificado em
//        22/09/2026 — libretranslate.de virou página web (HTTP 200 com
//        HTML, sem JSON), libretranslate.com exige API key (HTTP 400) e
//        translate.argosopentech.com estava fora do ar (fetch failed).
//        Google gtx respondeu 200 com detecção de idioma inclusa.
//   - ⏳ Timeout de 10s por fonte via AbortController (API presa não
//     prende o comando); falha nas duas → aviso amigável, nada escapa;
//   - 🪝 Ganchos de teste (__traduzirTexto / _injetarFonte, padrão do
//     /letra e do /pinterest) para os testes offline sem rede.
// ============================================

const { normalizeMessageContent, getContentType } = require('@whiskeysockets/baileys')

const TIMEOUT_API_MS = 10000
const LIMITE_ENTRADA = 500   // ✂️ acima disso, trunca (e avisa)
const URL_MYMEMORY = 'https://api.mymemory.translated.net/get'
const URL_GOOGLE_GTX = 'https://translate.googleapis.com/translate_a/single?client=gtx'

// ─── 🌍 Mapa de aliases → código ISO (chave: minúscula, SEM acento) ───
// Valor: código ISO que a API espera.
const IDIOMAS = {
  // português
  pt: 'pt', por: 'pt', portugues: 'pt', br: 'pt', brasil: 'pt', brasileiro: 'pt',
  // inglês
  en: 'en', eng: 'en', ingles: 'en',
  // espanhol
  es: 'es', esp: 'es', espanhol: 'es', castelhano: 'es',
  // francês
  fr: 'fr', fra: 'fr', frances: 'fr',
  // italiano
  it: 'it', ita: 'it', italiano: 'it',
  // alemão
  de: 'de', ger: 'de', alemao: 'de',
  // outros europeus
  nl: 'nl', holandes: 'nl', neerlandes: 'nl',
  ru: 'ru', rus: 'ru', russo: 'ru',
  pl: 'pl', polones: 'pl',
  uk: 'uk', ucraniano: 'uk',
  ro: 'ro', romeno: 'ro',
  el: 'el', grego: 'el',
  sv: 'sv', sueco: 'sv',
  no: 'no', noruegues: 'no',
  da: 'da', dinamarques: 'da',
  fi: 'fi', finlandes: 'fi',
  hu: 'hu', hungaro: 'hu',
  cs: 'cs', tcheco: 'cs', checo: 'cs',
  sk: 'sk', eslovaco: 'sk',
  bg: 'bg', bulgaro: 'bg',
  hr: 'hr', croata: 'hr',
  sr: 'sr', servio: 'sr',
  // asiáticos e oriente
  ja: 'ja', jpn: 'ja', japones: 'ja',
  zh: 'zh-cn', chines: 'zh-cn', mandarim: 'zh-cn',
  ko: 'ko', coreano: 'ko',
  hi: 'hi', hindi: 'hi',
  ar: 'ar', arabe: 'ar',
  tr: 'tr', turco: 'tr',
  he: 'he', hebraico: 'he',
  th: 'th', tailandes: 'th',
  vi: 'vi', vietnamita: 'vi',
  id: 'id', indonesio: 'id',
  ms: 'ms', malaio: 'ms',
  // outros
  la: 'la', latim: 'la'
}

// ─── 🧪 Erro de domínio: mensagem técnica + tipo p/ o aviso correto ───
class ErroTraducao extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroTraducao'
    this.tipo = tipo // 'rede' | 'timeout' | 'api' | 'limite'
  }
}

// ─── 🔤 Normaliza o nome do idioma (minúsculo, sem acento, sem espaços) ───
function normalizarIdioma(nome) {
  return String(nome || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

// ─── 🌍 Resolve idioma (código ou nome comum) → ISO ou null ───
function resolverIdioma(nome) {
  const chave = normalizarIdioma(nome)
  if (!chave) return null
  return IDIOMAS[chave] || null
}

// ─── 🎯 Argumento após o comando (cobre /traduzir, /translate...) ───
function extrairArgumento(texto) {
  return String(texto || '').replace(/^\/\S+\s*/, '').trim()
}

// ─── 📜 Extrai o TEXTO de uma mensagem citada (reply) ───
// Devolve { texto, midia }: midia = 'audio' | 'video' | null.
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

// ─── ✂️ Trunca textos longos (limite p/ não estourar a API gratuita) ───
function truncar(texto) {
  if (texto.length <= LIMITE_ENTRADA) return { texto, truncado: 0 }
  return { texto: texto.slice(0, LIMITE_ENTRADA).trim(), truncado: texto.length - LIMITE_ENTRADA }
}

// ─── 🌐 fetch com timeout de 10s (AbortController, padrão do projeto) ───
async function buscarJson(url) {
  const controller = new AbortController()
  const tout = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'Hipnos-Bot/1.0' },
      signal: controller.signal
    })
    clearTimeout(tout)
    if (!r.ok) throw new ErroTraducao('HTTP ' + r.status, 'api')
    return await r.json()
  } catch (err) {
    clearTimeout(tout)
    if (err instanceof ErroTraducao) throw err
    if (err?.name === 'AbortError') throw new ErroTraducao('timeout de 10s', 'timeout')
    throw new ErroTraducao((err && err.message) || String(err), 'rede')
  }
}

// ─── 1) MyMemory (primária): langpair=autodetect|<destino> ───
async function traduzirMyMemory(texto, destino) {
  const url = URL_MYMEMORY + '?q=' + encodeURIComponent(texto) + '&langpair=autodetect|' + encodeURIComponent(destino)
  const dados = await buscarJson(url)
  if (String(dados?.responseStatus) === '429') {
    throw new ErroTraducao('limite diário da MyMemory (429)', 'limite')
  }
  const traduzido = String(dados?.responseData?.translatedText || '').trim()
  if (!traduzido) throw new ErroTraducao('resposta vazia da MyMemory', 'api')
  const origem = String(dados?.responseData?.match || '').trim() || null
  return { texto: traduzido, origem, fonte: 'MyMemory' }
}

// ─── 2) Google gtx (fallback): sl=auto, com idioma detectado ───
async function traduzirGoogle(texto, destino) {
  const url = URL_GOOGLE_GTX + '&sl=auto&tl=' + encodeURIComponent(destino) + '&dt=t&q=' + encodeURIComponent(texto)
  const dados = await buscarJson(url)
  try {
    const trechos = Array.isArray(dados?.[0]) ? dados[0] : []
    const traduzido = trechos.map((t) => (Array.isArray(t) ? t[0] : '')).join('').trim()
    if (!traduzido) throw new ErroTraducao('resposta vazia do Google', 'api')
    const origem = typeof dados?.[2] === 'string' ? dados[2] : null
    return { texto: traduzido, origem, fonte: 'Google' }
  } catch (err) {
    if (err instanceof ErroTraducao) throw err
    throw new ErroTraducao('esquema irreconhecível do Google', 'api')
  }
}

// ─── 🔀 Orquestra primária + fallback (padrão do /dicionario e /clima) ───
let fontePrimaria = traduzirMyMemory
let fonteFallback = traduzirGoogle

async function traduzirTexto(texto, destino) {
  let ultimo = null
  const fontes = [fontePrimaria, fonteFallback]
  for (const fonte of fontes) {
    try {
      return await fonte(texto, destino)
    } catch (err) {
      ultimo = err
      console.error('[traduzir] ' + (fonte === fontePrimaria ? 'primária (MyMemory)' : 'fallback (Google)') + ' falhou:', (err && err.message) || err)
    }
  }
  throw ultimo || new ErroTraducao('falha geral', 'api')
}


// ─── 🧩 Divide o argumento em (idioma?, texto) ───
// Se a 1ª palavra for idioma conhecido → destino = ela, resto = texto.
// Senão → destino = 'pt' e o argumento inteiro é o texto, EXCETO se for
// UM token curto de 2 letras (ex.: /traduzir xx): aí sim parece uma
// TENTATIVA de código de idioma inválido — marca idiomaInformado com o
// token para que o executar avise "Não reconheci o idioma" (em vez de
// tratar o token como texto a traduzir, que chamaria a API à toa).
function separarIdiomaETexto(argumento) {
  if (!argumento) return { destino: 'pt', texto: '', idiomaInformado: null }
  const primeiroEspaco = argumento.search(/\s/)
  const primeira = primeiroEspaco === -1 ? argumento : argumento.slice(0, primeiroEspaco)
  const resto = primeiroEspaco === -1 ? '' : argumento.slice(primeiroEspaco).trim()
  const codigo = resolverIdioma(primeira)
  if (codigo) return { destino: codigo, texto: resto, idiomaInformado: primeira }
  if (primeiroEspaco === -1 && /^[a-zA-Z]{2}$/.test(primeira)) {
    return { destino: 'pt', texto: '', idiomaInformado: primeira }
  }
  return { destino: 'pt', texto: argumento, idiomaInformado: null }
}

// ─── 🏷️ Nome bonito do idioma p/ o cabeçalho (pt → Português...) ───
const NOMES_IDIOMAS = {
  pt: 'Português', en: 'Inglês', es: 'Espanhol', fr: 'Francês', it: 'Italiano',
  de: 'Alemão', nl: 'Holandês', ru: 'Russo', pl: 'Polonês', uk: 'Ucraniano',
  ro: 'Romeno', el: 'Grego', sv: 'Sueco', no: 'Norueguês', da: 'Dinamarquês',
  fi: 'Finlandês', hu: 'Húngaro', cs: 'Tcheco', sk: 'Eslovaco', bg: 'Búlgaro',
  hr: 'Croata', sr: 'Sérvio', ja: 'Japonês', 'zh-cn': 'Chinês', ko: 'Coreano',
  hi: 'Híndi', ar: 'Árabe', tr: 'Turco', he: 'Hebraico', th: 'Tailandês',
  vi: 'Vietnamita', id: 'Indonésio', ms: 'Malaio', la: 'Latim'
}

function montarResposta(resultado, destino, truncado) {
  const nomeDestino = NOMES_IDIOMAS[destino] || destino.toUpperCase()
  let texto = '🌐 *TRADUÇÃO* (' + nomeDestino + ')\n\n' + resultado.texto
  if (truncado > 0) {
    texto += '\n\n✂️ *Texto original truncado em ' + truncado + ' caracteres* (limite de ' + LIMITE_ENTRADA + ' por tradução).'
  }
  return texto
}

function ajudaUso() {
  return '🌐 *Como usar o tradutor*\n\n' +
    '`/traduzir <idioma> <texto>`\n' +
    '`/traduzir <texto>` (traduz para português)\n' +
    '`/traduzir <idioma>` respondendo a um texto\n\n' +
    '🗝️ Exemplos:\n' +
    '• `/traduzir en Bom dia, tudo bem?`\n' +
    '• `/traduzir inglês Good morning`\n' +
    '• `/traduzir es` respondendo a uma mensagem\n\n' +
    '🌍 Idiomas comuns: `pt` (português), `en` (inglês), `es` (espanhol), `fr` (francês), `it` (italiano), `de` (alemão), `ja` (japonês).'
}

// ---- EXPORTAÇÃO PRINCIPAL (mesmo contrato do loader: nome + executar) ----
module.exports = {
  nome: 'traduzir',
  aliases: ['traducao', 'tradutor', 'translate'],
  descricao: 'Traduz um texto para outro idioma (padrão: português). Formato: /traduzir idioma texto.',
  categoria: 'utilitario',

  executar: async function (sock, jid, msg, texto) {
    try {
      const argumento = extrairArgumento(texto)
      const { destino, texto: textoDireto, idiomaInformado } = separarIdiomaETexto(argumento)

      let original = textoDireto
      if (!original) {
        const citado = extrairTextoCitado(msg)
        if (citado.midia) {
          return await sock.sendMessage(jid, {
            text: '🎙️ *Aqui só traduzo texto, não mídia...*\n\nResponda a uma mensagem de TEXTO com `/traduzir' + (idiomaInformado ? ' ' + idiomaInformado : '') + '` — para áudio/vídeo, use o /transcrever primeiro.'
          }, { quoted: msg })
        }
        original = citado.texto
      }

      // Nada para traduzir: idioma desconhecido sozinho → explica o idioma;
      // resto (sem nada, ou idioma válido sem texto) → ajuda geral de uso.
      if (!original) {
        const sohUmaPalavra = argumento && !/\s/.test(argumento)
        if (sohUmaPalavra && !resolverIdioma(argumento)) {
          return await sock.sendMessage(jid, {
            text: '🌍 *Não reconheci o idioma \"' + argumento + '\"...*\n\nUse o código ISO ou o nome em português. Ex.: `en`, `inglês`, `es`, `espanhol`, `fr`, `francês`.\n\n🗝️ Exemplo: `/traduzir en Bom dia`'
          }, { quoted: msg })
        }
        return await sock.sendMessage(jid, { text: ajudaUso() }, { quoted: msg })
      }

      const { texto: pronto, truncado } = truncar(original)
      const resultado = await traduzirTexto(pronto, destino)
      return await sock.sendMessage(jid, { text: montarResposta(resultado, destino, truncado) }, { quoted: msg })
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa para o socket
      console.error('[traduzir] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⛔ *As línguas do limbo se calaram...*\n\nOs tradutores não responderam agora. Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  // Extras internos para os testes offline (mesmo padrão do /letra e /pinterest)
  resolverIdioma,
  separarIdiomaETexto,
  truncar,
  LIMITE_ENTRADA,
  __traduzirTexto: traduzirTexto,
  _injetarFonte: (primaria, fallback) => {
    if (primaria) fontePrimaria = primaria
    if (fallback) fonteFallback = fallback
  },
  _restaurarFontes: () => { fontePrimaria = traduzirMyMemory; fonteFallback = traduzirGoogle }
}

