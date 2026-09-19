// ============================================
// 💭 FRASE — Frase motivacional aleatória, traduzida pro português
// ============================================
// 1️⃣ BUSCA: GET https://zenquotes.io/api/random (grátis, SEM key)
//     → [ { "q": "frase em inglês", "a": "Autor", "h": "<blockquote>…" } ]
//     ⚠️ Quando o IP estoura o limite gratuito, a ZenQuotes devolve um OBJETO
//     (não um array) com q = "Too many requests…" → tratado como falha.
//
// 2️⃣ TRADUÇÃO: a frase vem em INGLÊS → traduzida para pt-BR com o MESMO client
//     de IA já usado no projeto: fetch nativo + GROQ_API_KEY +
//     response_format json_object (padrão idêntico ao do /gpt, /nasa,
//     /gatofato e /curiosidadenumero). Nenhuma configuração nova é criada aqui.
//     ℹ️ O projeto NÃO usa OpenRouter/DeepSeek em lugar nenhum — o client
//     compartilhado de IA é o Groq; reaproveitamos exatamente ele.
//
// ⏳ TIMEOUT: 15s no TOTAL, somando as DUAS etapas (busca + tradução) — cada
//    etapa só recebe o tempo que sobrou do orçamento (ver criarOrcamento).
//
// Uso:
//   /frase → 💭 "As coisas boas vêm para quem espera." — Autor
//
// Regras:
//   - erros amigáveis em pt-BR; NADA escapa para o listener do bot;
//   - logs "[frase] ..." para diagnóstico no Render;
//   - gancho _injetarBuscas p/ os testes offline (mesmo padrão do /gatofato).
// ============================================

// ⏳ Orçamento TOTAL das duas etapas (ms) — requisito: 15s
const TIMEOUT_TOTAL_MS = 15000
const URL_ZENQUOTES = 'https://zenquotes.io/api/random'
// 🈯 MESMO client de IA do projeto (Groq — padrão do /gatofato e do /nasa)
const URL_GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions'
const MODELO_TRADUCAO = 'openai/gpt-oss-20b'

function modeloTraducao () {
  const personalizado = String(process.env.GROQ_MODEL || '').trim()
  return personalizado || MODELO_TRADUCAO
}

// ─── ⏳ Orçamento ÚNICO de 15s compartilhado pelas duas etapas ───
// A busca da frase e a tradução consomem do MESMO prazo: se a ZenQuotes
// demorar 10s, a tradução só tem os 5s restantes.
function criarOrcamento (totalMs = TIMEOUT_TOTAL_MS) {
  const fim = Date.now() + totalMs
  return {
    totalMs,
    restante: () => fim - Date.now(),
    expirou: () => Date.now() >= fim
  }
}

function erroTimeout (etapa) {
  const erro = new Error(`a ${etapa} demorou demais (timeout)`)
  erro.name = 'TimeoutHipnos'
  return erro
}

// fetch com o tempo QUE SOBROU do orçamento (nada além disso).
// Se o orçamento já estourou, nem tenta a requisição.
async function fetchComPrazo (url, opcoes, orcamento, etapa) {
  const restante = orcamento.restante()
  if (restante <= 0) throw erroTimeout(etapa)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), restante)
  try {
    return await fetch(url, { ...opcoes, signal: controller.signal })
  } catch (err) {
    if (err?.name === 'AbortError') throw erroTimeout(etapa)
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

// ─── 🔍 Busca a frase na ZenQuotes (variável p/ o gancho de teste) ───
// Devolve { frase, autor }. Qualquer falha lança Erro com mensagem clara.
let buscarFrase = async (orcamento = criarOrcamento()) => {
  const resposta = await fetchComPrazo(URL_ZENQUOTES, {
    method: 'GET',
    headers: { 'Accept': 'application/json', 'User-Agent': 'Hipnos-Bot/1.0' }
  }, orcamento, 'busca da frase')

  if (!resposta.ok) {
    throw new Error(`a ZenQuotes respondeu HTTP ${resposta.status}`)
  }

  const dados = await resposta.json().catch(() => null)
  // A API devolve um ARRAY com 1 item — se vier objeto, é aviso/erro da API.
  const item = Array.isArray(dados) ? dados[0] : null
  const frase = String(item?.q || '').trim()
  const autor = String(item?.a || '').trim()

  if (!frase) {
    if (orcamento.expirou()) throw erroTimeout('busca da frase')
    // Ex.: limite gratuito estourado → { q: "Too many requests…", a: "ZenQuotes.io" }
    throw new Error('a ZenQuotes não retornou uma frase válida (limite de requisições?)')
  }

  return { frase, autor: autor || 'Autor desconhecido' }
}

// ─── 🈯 Traduz a frase via Groq (MESMO client do /gpt e do /nasa) ───
// Devolve a frase em pt-BR ou null (fallback: frase original em inglês).
// NUNCA lança: qualquer falha (sem chave, HTTP, JSON, timeout) só é logada.
let traduzirFrase = async (frase, autor, orcamento = criarOrcamento()) => {
  const chave = String(process.env.GROQ_API_KEY || '').trim()
  if (!chave) {
    console.log('[frase] ℹ️ GROQ_API_KEY ausente — seguindo com a frase original em inglês.')
    return null
  }

  try {
    const resposta = await fetchComPrazo(URL_GROQ_CHAT, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modeloTraducao(),
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Você traduz frases motivacionais e citações do inglês para o português do Brasil (pt-BR). Responda APENAS com um JSON válido no formato {"frase": "..."}, sem comentários extras. Traduza de forma natural, fiel ao sentido e mantendo o tom inspirador da citação original.'
          },
          {
            role: 'user',
            content: `Traduza para o português do Brasil esta frase de ${autor}:\n\n"${frase}"`
          }
        ]
      })
    }, orcamento, 'tradução')

    if (!resposta.ok) {
      console.error(`[frase] Groq respondeu HTTP ${resposta.status} — usando a frase original.`)
      return null
    }

    const dados = await resposta.json().catch(() => null)
    const bruto = String(dados?.choices?.[0]?.message?.content || '')
    const par = bruto.match(/\{[\s\S]*\}/)
    if (!par) {
      console.error('[frase] Groq devolveu JSON inválido — usando a frase original.')
      return null
    }

    const traduzido = JSON.parse(par[0])
    const fraseTraduzida = String(traduzido.frase || '').trim()
    return fraseTraduzida || null
  } catch (err) {
    console.error('[frase] tradução falhou — usando a frase original:', err?.message || err)
    return null
  }
}

// 🔌 Gancho dos testes offline (mesmo padrão do _injetarBuscas do /gatofato)
function _injetarBuscas (overrides = {}) {
  if (typeof overrides.buscarFrase === 'function') buscarFrase = overrides.buscarFrase
  if (typeof overrides.traduzirFrase === 'function') traduzirFrase = overrides.traduzirFrase
}

// ============================================
// 🎯 /frase — executor
// ============================================
module.exports = {
  nome: 'frase',
  aliases: ['frases', 'frasedodia', 'motivacional'],
  descricao: 'Solta uma frase motivacional aleatória, traduzida pro português.',

  async executar (sock, jid, msg, texto) {
    // ⏳ Um ÚNICO orçamento de 15s para as duas etapas (busca + tradução)
    const orcamento = criarOrcamento()

    try {
      // 1️⃣ 🔍 Frase em inglês (ZenQuotes)
      const { frase, autor } = await buscarFrase(orcamento)
      console.log(`[frase] 💭 frase obtida (${frase.length} chars — ${autor}) — traduzindo via Groq...`)

      // 2️⃣ 🈯 Tradução (fallback: frase original em inglês, sem quebrar)
      const traduzida = await traduzirFrase(frase, autor, orcamento)
      console.log(traduzida
        ? '[frase] 🈯 tradução OK'
        : '[frase] ⚠️ seguindo com a frase original em inglês')

      // 3️⃣ ✉️ 💭 "frase" — autor
      const corpo = `💭 "${traduzida || frase}" — ${autor}`
      const notaTraducao = traduzida
        ? ''
        : '\n\n_(tradução indisponível agora — a frase acima está no original em inglês)_'

      return await sock.sendMessage(jid, {
        text: corpo + notaTraducao
      }, { quoted: msg })
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa para o socket
      console.error('[frase] 💥 erro capturado (o bot segue vivo):', err?.stack || err)

      const foiTimeout = err?.name === 'AbortError' ||
        err?.name === 'TimeoutHipnos' ||
        /timeout/i.test(err?.message || '')
      const aviso = foiTimeout
        ? '⏳ *As vozes do oráculo demoraram a soprar...*\n\nTente novamente em instantes.'
        : '⛔ *O oráculo silenciou por agora...*\n\nNão consegui buscar uma frase motivacional. Tente novamente em instantes.'

      return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    }
  },

  // 🔌 Gancho dos testes offline
  _injetarBuscas,

  // 🧪 Exposto p/ os testes cobrirem a busca/tradução REAIS com fetch simulado
  // (captura as funções REAIS no carregamento — o _injetarBuscas não as troca aqui)
  __internos: { buscarFrase, traduzirFrase, criarOrcamento, TIMEOUT_TOTAL_MS, URL_ZENQUOTES, URL_GROQ_CHAT }
}
