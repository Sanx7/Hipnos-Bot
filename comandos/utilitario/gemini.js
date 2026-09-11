// ============================================
// GEMINI — Pergunte ao oráculo do Limbo (via Groq)
// ============================================
// Responde perguntas usando o endpoint de chat da Groq
// (compativel com a API OpenAI, via fetch nativo).
// Uso LIVRE em grupos e no privado:
//
//   /gemini Crie um poema sobre o sono
//   (tambem: /googleia e /bard)
//
// Regras:
//   - pergunta apos o comando; sem pergunta -> aviso de uso;
//   - GROQ_API_KEY ausente/recusada -> "a mente dorme...";
//   - 429/timeout -> "mente sobrecarregada...";
//   - respostas longas em blocos de 2500 caracteres;
//   - timeout de 20s via AbortController;
//   - system prompt Limbo/sono; logs "[gemini] ...".
// ============================================

const TIMEOUT_API_MS = 20000
const TAMANHO_BLOCO = 2500
const URL_GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions'
const MODELO_PADRAO = 'openai/gpt-oss-120b'
const SYSTEM_PROMPT = 'Voce e Hipnos, o guardiao do Limbo e dos sonhos (pt-BR). Responda de forma direta, envolvente e levemente misteriosa, mas sempre precisa. Use Markdown simples do WhatsApp quando ajudar. Nunca diga que e ChatGPT, Gemini ou outro modelo: voce e Hipnos.'

class ErroGemini extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroGemini'
    this.tipo = tipo
  }
}

function modeloGemini() {
  const personalizado = String(process.env.GROQ_MODEL_GEMINI || process.env.GROQ_MODEL || '').trim()
  return personalizado || MODELO_PADRAO
}

function extrairPergunta(texto) {
  return String(texto || '').replace(/^\/\S+\s*/, '').trim()
}

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

async function perguntar(pergunta) {
  const chave = String(process.env.GROQ_API_KEY || '').trim()
  if (!chave) throw new ErroGemini('sem GROQ_API_KEY', 'sem_chave')
  const controller = new AbortController()
  const tout = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  let resposta
  try {
    resposta = await fetch(URL_GROQ_CHAT, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modeloGemini(),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: pergunta }
        ],
        temperature: 0.7,
        max_tokens: 1500
      }),
      signal: controller.signal
    })
  } catch (err) {
    clearTimeout(tout)
    if (err && err.name === 'AbortError') throw new ErroGemini('timeout', 'timeout')
    throw new ErroGemini(String((err && err.message) || err), 'api')
  }
  clearTimeout(tout)
  if (!resposta.ok) {
    if (resposta.status === 401 || resposta.status === 403) throw new ErroGemini('HTTP 401', 'chave_invalida')
    if (resposta.status === 429) throw new ErroGemini('HTTP 429', 'limite')
    throw new ErroGemini('HTTP ' + resposta.status, 'api')
  }
  const dados = await resposta.json().catch(() => null)
  const msgIa = dados && dados.choices && dados.choices[0] && dados.choices[0].message
  const texto = String((msgIa && msgIa.content) || '').trim()
  if (!texto) throw new ErroGemini('resposta vazia', 'vazia')
  return texto
}

function cabecalho(pergunta) {
  const curta = pergunta.length > 120 ? pergunta.slice(0, 117).trim() + '...' : pergunta
  return '🔮 *O ORÁCULO DO LIMBO RESPONDE* 🌙\n\n❓ Pergunta: *' + curta + '*\n\n'
}

function avisoPara(tipo) {
  if (tipo === 'sem_chave' || tipo === 'chave_invalida') {
    return '😴 *A mente da IA ainda dorme neste recinto...*\n\nO recurso precisa da chave GROQ_API_KEY configurada pelo dono do bot (grátis em console.groq.com).'
  }
  if (tipo === 'limite' || tipo === 'timeout') {
    return '⏳ *A mente da IA está sobrecarregada...*\n\nAguarde um pouco e tente de novo.'
  }
  return '⛔ *As sombras engoliram a resposta...*\n\nA IA não respondeu agora. Tente novamente em instantes.'
}

module.exports = {
  nome: 'gemini',
  aliases: ['googleia', 'bard'],
  descricao: 'Faz uma pergunta ou consulta à inteligência artificial Gemini.',
  categoria: 'utilitario',

  async executar(sock, jid, msg, text) {
    try {
      const pergunta = extrairPergunta(text)
      if (!pergunta) {
        return await sock.sendMessage(jid, {
          text: '🔮 *Me conte o que deseja saber...*\n\nEnvie a pergunta depois do comando.\n\n🗝️ Exemplos:\n- `/gemini Crie um poema sobre o sono`\n- `/bard Explique a gravidade de forma simples`'
        }, { quoted: msg })
      }
      const resposta = await perguntar(pergunta)
      const blocos = dividirEmBlocos(resposta)
      const head = cabecalho(pergunta)
      for (let i = 0; i < blocos.length; i++) {
        const corpo = (i === 0 ? head : '') + blocos[i]
        if (i === 0) await sock.sendMessage(jid, { text: corpo }, { quoted: msg })
        else await sock.sendMessage(jid, { text: corpo })
      }
    } catch (err) {
      console.error('[gemini] erro na consulta:', err)
      const aviso = avisoPara(err && err.tipo)
      return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    }
  }
}
