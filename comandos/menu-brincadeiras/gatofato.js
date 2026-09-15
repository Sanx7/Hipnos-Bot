// ============================================
// 🐱 GATOFATO — Fato felino aleatório (uso LIVRE)
// ============================================
// GET https://catfact.ninja/fact (grátis, SEM key) → { "fact": "...", "length": 123 }
// O fato vem em INGLÊS → traduzido para pt-BR com o MESMO client de IA do
// projeto (fetch nativo + GROQ_API_KEY + response_format json_object, mesmo
// padrão da tradução do /nasa). Qualquer falha na tradução (sem chave, HTTP
// errado, JSON inválido, timeout) → o fato ORIGINAL em inglês, sem quebrar.
//
// Uso:
//   /gatofato → "🐱 Você sabia? {fato traduzido}"
//
// Regras:
//   - timeout de 15s (API de fatos E tradução);
//   - erros amigáveis em pt-BR; NADA escapa para o listener do bot;
//   - logs "[gatofato] ..." para diagnóstico no Render.
// ============================================

// ⏳ Timeout das chamadas (ms) — requisito: 15s
const TIMEOUT_API_MS = 15000
const URL_CATFACT = 'https://catfact.ninja/fact'
// 🈯 MESMO client de IA do projeto (padrão da tradução do /nasa)
const URL_GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions'
const MODELO_TRADUCAO = 'openai/gpt-oss-20b'

function modeloTraducao () {
  const personalizado = String(process.env.GROQ_MODEL || '').trim()
  return personalizado || MODELO_TRADUCAO
}

// ─── 🔍 Busca o fato na Cat Facts API (variável p/ o gancho de teste) ───
// Devolve o fato (string). Qualquer falha lança Erro com mensagem clara.
let buscarFato = async () => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    const resposta = await fetch(URL_CATFACT, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'Hipnos-Bot/1.0' },
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      throw new Error(`a API respondeu HTTP ${resposta.status}`)
    }
    const dados = await resposta.json().catch(() => null)
    const fato = String(dados?.fact || '').trim()
    if (!fato) {
      throw new Error('a API não retornou um fato válido')
    }
    return fato
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      throw new Error('a consulta demorou demais (timeout)')
    }
    throw err
  }
}

// ─── 🈯 Traduz o fato via Groq (MESMO client do /nasa) ───
// Devolve o fato em pt-BR ou null (fallback: fato original em inglês).
// Qualquer falha é só logada — a tradução nunca derruba o comando.
let traduzirFato = async (fato) => {
  const chave = String(process.env.GROQ_API_KEY || '').trim()
  if (!chave) {
    console.log('[gatofato] ℹ️ GROQ_API_KEY ausente — seguindo com o fato original.')
    return null
  }
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
            content: 'Você traduz fatos sobre gatos para o português do Brasil (pt-BR). Responda APENAS com um JSON válido no formato {"fato": "..."} sem comentários extras. Traduza de forma natural e fiel ao sentido.'
          },
          { role: 'user', content: 'Traduza para o português do Brasil:\n\n' + fato }
        ]
      }),
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      console.error(`[gatofato] Groq respondeu HTTP ${resposta.status} — usando o fato original.`)
      return null
    }
    const dados = await resposta.json().catch(() => null)
    const bruto = String(dados?.choices?.[0]?.message?.content || '')
    const par = bruto.match(/\{[\s\S]*\}/)
    if (!par) {
      console.error('[gatofato] Groq devolveu JSON inválido — usando o fato original.')
      return null
    }
    const traduzido = JSON.parse(par[0])
    const fatoTraduzido = String(traduzido.fato || '').trim()
    return fatoTraduzido || null
  } catch (err) {
    clearTimeout(timeoutId)
    console.error('[gatofato] tradução falhou — usando o fato original:', err?.message || err)
    return null
  }
}

// 🔌 Gancho dos testes offline (mesmo padrão do _injetarBuscas do /meme)
function _injetarBuscas (overrides = {}) {
  if (typeof overrides.buscarFato === 'function') buscarFato = overrides.buscarFato
  if (typeof overrides.traduzirFato === 'function') traduzirFato = overrides.traduzirFato
}

// ============================================
// 🎯 /gatofato — executor
// ============================================
module.exports = {
  nome: 'gatofato',
  descricao: 'Solta um fato aleatório sobre gatos, traduzido pro português.',

  async executar (sock, jid, msg, texto) {
    try {
      // 1️⃣ 🔍 Fato (inglês)
      const fato = await buscarFato()
      console.log(`[gatofato] 🐱 fato obtido (${fato.length} chars) — traduzindo via Groq...`)

      // 2️⃣ 🈯 Tradução (fallback: original em inglês, sem quebrar)
      const traduzido = await traduzirFato(fato)
      const fatoFinal = traduzido || fato
      console.log(traduzido
        ? '[gatofato] 🈯 tradução OK'
        : '[gatofato] ⚠️ seguindo com o fato original em inglês')

      // 3️⃣ ✉️ "🐱 Você sabia? {fato}"
      return await sock.sendMessage(jid, {
        text: `🐱 *Você sabia?* ${fatoFinal}`
      }, { quoted: msg })
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa para o socket
      console.error('[gatofato] 💥 erro capturado (o bot segue vivo):', err?.stack || err)

      const foiTimeout = err?.name === 'AbortError' || /timeout/i.test(err?.message || '')
      const aviso = foiTimeout
        ? '⏳ *O gato demorou demais para ronronar...*\n\nTente novamente em instantes.'
        : '⛔ *O gato fugiu com o fato...*\n\nNão consegui buscar o fato agora. Tente novamente em instantes.'

      return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    }
  },

  // 🔌 Gancho dos testes offline
  _injetarBuscas
}
