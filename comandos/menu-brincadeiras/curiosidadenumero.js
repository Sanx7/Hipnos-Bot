// ============================================
// 🔢 CURIOSIDADENUMERO — Curiosidade de um número (uso LIVRE)
// ============================================
// A curiosidade é GERADA DIRETO pela IA do Groq — o MESMO client já usado
// pela (antiga) tradução deste comando e do /frase, /gatofato (fetch nativo
// + GROQ_API_KEY + response_format json_object — padrão herdado do /nasa).
//
// Histórico: antes a curiosidade vinha do http://numbersapi.com (texto em
// inglês + tradução separada), mas a API ficou INSTÁVEL (404 para todos os
// números). Hoje a curiosidade sai direto em português do Brasil, em uma
// única chamada, sem depender de serviço externo.
//
//   /curiosidadenumero         → sorteia um número entre 1 e 1000
//   /curiosidadenumero 73      → curiosidade do 73
//
// Regras:
//   - timeout de 15s;
//   - sem número → sorteio 1..1000; número inválido → aviso de uso;
//   - resposta: "🔢 Sobre o número {numero}: {curiosidade}";
//   - a IA deve gerar um FATO REAL (matemático/histórico/cultural) — nunca
//     inventar fatos falsos; sem fato específico, curiosidade matemática
//     genuína (primo, múltiplo, perfeito etc.);
//   - erros amigáveis em pt-BR; NADA escapa para o listener do bot;
//   - logs "[curiosidadenumero] ..." para diagnóstico no Render.
// ============================================

// ⏳ Timeout das chamadas (ms) — requisito: 15s
const TIMEOUT_API_MS = 15000
// 🎲 Sorteio quando o usuário não informa número (requisito: 1..1000)
const NUMERO_MIN = 1
const NUMERO_MAX = 1000
// 🤖 MESMO client de IA do /frase e do /gatofato (padrão herdado do /nasa)
const URL_GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions'
const MODELO_GROQ = 'openai/gpt-oss-20b'

function modeloGroq () {
  const personalizado = String(process.env.GROQ_MODEL || '').trim()
  return personalizado || MODELO_GROQ
}

// ─── 🤖 Gera a curiosidade do número via Groq (MESMO client do /gatofato e /nasa) ───
// A curiosidade sai DIRETO em pt-BR (1-2 frases) — sem Numbers API e sem
// tradução separada. Em qualquer falha (sem chave, HTTP errado, JSON
// inválido, timeout) LANÇA com mensagem clara: o executor captura e responde
// com o aviso amigável, sem derrubar a conexão.
const PROMPT_SISTEMA =
  'Você gera curiosidades numéricas em português do Brasil (pt-BR) para um bot de WhatsApp. ' +
  'A curiosidade deve ser um FATO REAL E VERDADEIRO sobre o número (matemático, histórico, cultural, científico etc.). ' +
  'NUNCA invente fatos falsos apresentados como verdade histórica. ' +
  'Se você não souber nada específico sobre o número, gere uma curiosidade MATEMÁTICA genuína e verificável sobre ele ' +
  '(ser primo ou não, múltiplos, par/ímpar, quadrado perfeito, soma dos dígitos, número de Euler, o famoso 42, o 73 de Sheldon etc.). ' +
  'Responda em 1 ou 2 frases curtas. ' +
  'Responda APENAS com um JSON válido no formato {"curiosidade": "..."} sem comentários extras.'

let gerarCuriosidade = async (numero) => {
  const chave = String(process.env.GROQ_API_KEY || '').trim()
  if (!chave) {
    console.error('[curiosidadenumero] ⚠️ GROQ_API_KEY ausente — impossível gerar a curiosidade.')
    throw new Error('GROQ_API_KEY não configurada')
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    console.log(`[curiosidadenumero] 🤖 gerando curiosidade do ${numero} via Groq (${modeloGroq()})...`)
    const resposta = await fetch(URL_GROQ_CHAT, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modeloGroq(),
        temperature: 0.6,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PROMPT_SISTEMA },
          { role: 'user', content: `Qual a curiosidade sobre o número ${numero}?` }
        ]
      }),
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      throw new Error(`o Groq respondeu HTTP ${resposta.status}`)
    }
    const dados = await resposta.json().catch(() => null)
    const bruto = String(dados?.choices?.[0]?.message?.content || '')
    const par = bruto.match(/\{[\s\S]*\}/)
    if (!par) {
      throw new Error('o Groq não devolveu um JSON válido')
    }
    const gerado = JSON.parse(par[0])
    const curiosidade = String(gerado.curiosidade || '').trim()
    if (!curiosidade) {
      throw new Error('o Groq não retornou uma curiosidade válida')
    }
    return curiosidade
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      throw new Error('a geração da curiosidade demorou demais (timeout)')
    }
    throw err
  }
}

// 🔌 Gancho dos testes offline (mesmo padrão do _injetarBuscas do /meme)
function _injetarBuscas (overrides = {}) {
  if (typeof overrides.gerarCuriosidade === 'function') gerarCuriosidade = overrides.gerarCuriosidade
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

      // 2️⃣ 🤖 Curiosidade gerada direto em pt-BR via Groq (sem API externa)
      const curiosidadeFinal = await gerarCuriosidade(numero)
      console.log(`[curiosidadenumero] ✅ curiosidade do ${numero} gerada (${curiosidadeFinal.length} chars)`)

      // 3️⃣ ✉️ "🔢 Sobre o número {numero}: {curiosidade}"
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
