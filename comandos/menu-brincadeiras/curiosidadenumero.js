// ============================================
// 🔢 CURIOSIDADENUMERO — Curiosidade de um número (uso LIVRE)
// ============================================
// GET http://numbersapi.com/{numero}/trivia (grátis, SEM key) → TEXTO PURO
// em inglês, ex.: "73 is the 21st prime number."
//
//   /curiosidadenumero         → sorteia um número entre 1 e 1000
//   /curiosidadenumero 73      → curiosidade do 73
//
// O texto vem em INGLÊS → traduzido para pt-BR com o MESMO client de IA do
// /frase e do /gatofato (fetch nativo + GROQ_API_KEY + response_format
// json_object — o padrão herdado da tradução do /nasa). Qualquer falha na
// tradução (sem chave, HTTP errado, JSON inválido, timeout) → o texto
// ORIGINAL em inglês, sem quebrar.
//
// Regras:
//   - timeout de 15s (API E tradução);
//   - sem número → sorteio 1..1000; número inválido → aviso de uso;
//   - resposta: "🔢 Sobre o número {numero}: {curiosidade}";
//   - erros amigáveis em pt-BR; NADA escapa para o listener do bot;
//   - logs "[curiosidadenumero] ..." para diagnóstico no Render.
// ============================================

// ⏳ Timeout das chamadas (ms) — requisito: 15s
const TIMEOUT_API_MS = 15000
// 🎲 Sorteio quando o usuário não informa número (requisito: 1..1000)
const NUMERO_MIN = 1
const NUMERO_MAX = 1000
// 🈯 MESMO client de IA do /frase e do /gatofato (padrão da tradução do /nasa)
const URL_NUMBERSAPI = 'http://numbersapi.com'
const URL_GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions'
const MODELO_TRADUCAO = 'openai/gpt-oss-20b'

function modeloTraducao () {
  const personalizado = String(process.env.GROQ_MODEL || '').trim()
  return personalizado || MODELO_TRADUCAO
}

// ─── 🔍 Busca a curiosidade (TEXTO PURO) na Numbers API ───
// Devolve { numero, texto }. Qualquer falha lança com mensagem clara.
let buscarCuriosidade = async (numero) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    const resposta = await fetch(`${URL_NUMBERSAPI}/${numero}/trivia`, {
      method: 'GET',
      headers: { 'Accept': 'text/plain', 'User-Agent': 'Hipnos-Bot/1.0' },
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      throw new Error(`a API respondeu HTTP ${resposta.status}`)
    }
    const texto = (await resposta.text()).trim()
    if (!texto) {
      throw new Error('a API não retornou uma curiosidade válida')
    }
    return { numero, texto }
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      throw new Error('a consulta demorou demais (timeout)')
    }
    throw err
  }
}

// ─── 🈯 Traduz a curiosidade via Groq (MESMO client do /gatofato e /nasa) ───
// Devolve a curiosidade em pt-BR ou null (fallback: original em inglês).
// Qualquer falha é só logada — a tradução nunca derruba o comando.
let traduzirCuriosidade = async (texto) => {
  const chave = String(process.env.GROQ_API_KEY || '').trim()
  if (!chave) {
    console.log('[curiosidadenumero] ℹ️ GROQ_API_KEY ausente — seguindo com o texto original.')
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
            content: 'Você traduz curiosidades numéricas para o português do Brasil (pt-BR). Responda APENAS com um JSON válido no formato {"curiosidade": "..."} sem comentários extras. Traduza de forma natural e fiel ao sentido.'
          },
          { role: 'user', content: 'Traduza para o português do Brasil:\n\n' + texto }
        ]
      }),
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      console.error(`[curiosidadenumero] Groq respondeu HTTP ${resposta.status} — usando o texto original.`)
      return null
    }
    const dados = await resposta.json().catch(() => null)
    const bruto = String(dados?.choices?.[0]?.message?.content || '')
    const par = bruto.match(/\{[\s\S]*\}/)
    if (!par) {
      console.error('[curiosidadenumero] Groq devolveu JSON inválido — usando o texto original.')
      return null
    }
    const traduzido = JSON.parse(par[0])
    const curiosidadeTraduzida = String(traduzido.curiosidade || '').trim()
    return curiosidadeTraduzida || null
  } catch (err) {
    clearTimeout(timeoutId)
    console.error('[curiosidadenumero] tradução falhou — usando o texto original:', err?.message || err)
    return null
  }
}

// 🔌 Gancho dos testes offline (mesmo padrão do _injetarBuscas do /meme)
function _injetarBuscas (overrides = {}) {
  if (typeof overrides.buscarCuriosidade === 'function') buscarCuriosidade = overrides.buscarCuriosidade
  if (typeof overrides.traduzirCuriosidade === 'function') traduzirCuriosidade = overrides.traduzirCuriosidade
}

// ============================================
// 🎯 /curiosidadenumero — executor
// ============================================
module.exports = {
  nome: 'curiosidadenumero',
  descricao: 'Revela a curiosidade de um número — sem número, sorteia entre 1 e 1000.',

  async executar (sock, jid, msg, texto) {
    try {
      // 1️⃣ 🔢 Número: informado OU sorteado entre 1 e 1000
      const bruto = String(texto || '').replace(/^\S+\s*/, '').trim()
      const numeroInformado = bruto.replace(/\D/g, '')

      let numero
      if (numeroInformado) {
        numero = Number(numeroInformado)
        if (numero < 0 || numero > 999999999) {
          return await sock.sendMessage(jid, {
            text: `🔢 *Número fora de alcance...*\n\nInforme um número entre *0* e *999999999* (ex: */curiosidadenumero 73*) — ou chame sem número para a sorte entre ${NUMERO_MIN} e ${NUMERO_MAX}.`
          }, { quoted: msg })
        }
      } else {
        numero = Math.floor(Math.random() * (NUMERO_MAX - NUMERO_MIN + 1)) + NUMERO_MIN
        console.log(`[curiosidadenumero] 🎲 sem número informado — sorteado: ${numero}`)
      }

      // 2️⃣ 🔍 Curiosidade (texto puro, inglês)
      const { texto: curiosidade } = await buscarCuriosidade(numero)
      console.log(`[curiosidadenumero] 🔢 curiosidade do ${numero} obtida (${curiosidade.length} chars) — traduzindo via Groq...`)

      // 3️⃣ 🈯 Tradução (fallback: original em inglês, sem quebrar)
      const traduzida = await traduzirCuriosidade(curiosidade)
      const curiosidadeFinal = traduzida || curiosidade
      console.log(traduzida
        ? '[curiosidadenumero] 🈯 tradução OK'
        : '[curiosidadenumero] ⚠️ seguindo com o texto original em inglês')

      // 4️⃣ ✉️ "🔢 Sobre o número {numero}: {curiosidade}"
      return await sock.sendMessage(jid, {
        text: `🔢 *Sobre o número ${numero}:* ${curiosidadeFinal}`
      }, { quoted: msg })
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa para o socket
      console.error('[curiosidadenumero] 💥 erro capturado (o bot segue vivo):', err?.stack || err)

      const foiTimeout = err?.name === 'AbortError' || /timeout/i.test(err?.message || '')
      const aviso = foiTimeout
        ? '⏳ *Os números demoraram demais para se revelar...*\n\nTente novamente em instantes.'
        : '⛔ *Os números esconderam o segredo...*\n\nNão consegui buscar a curiosidade agora. Tente novamente em instantes.'

      return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    }
  },

  // 🔌 Gancho dos testes offline
  _injetarBuscas
}
