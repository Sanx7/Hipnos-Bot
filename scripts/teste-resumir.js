// ============================================
// 🧪 teste-resumir.js — Valida o /resumir (IA do Limbo)
// ============================================
// RODA 100% OFFLINE: nenhuma requisição de rede é feita.
//   - global.fetch é substituído por um simulador (respeita AbortSignal);
//   - o núcleo de IA é injetado com _injetarIa() na maioria dos casos e,
//     nos testes de integração, usa _restaurarIa() + fetch simulado p/
//     exercitar o código REAL (montagem do body, 401/429/vazio/abort).
// ⚠️ O provedor do /resumir é a OPENROUTER (https://openrouter.ai), com
//    OPENROUTER_API_KEY — os outros comandos de IA seguem na Groq.
// Verifica:
//   - exports (nome, aliases, categoria, ganchos de teste, __internos);
//   - provedor: endpoint openrouter.ai/api/v1/chat/completions, Bearer com a
//     OPENROUTER_API_KEY, headers HTTP-Referer + X-Title e modelo :free;
//   - configuração: RESUMIR_MODEL (e o legado GROQ_MODEL_RESUMIR),
//     OPENROUTER_SITE_URL / RENDER_EXTERNAL_URL e OPENROUTER_APP_TITLE;
//   - fluxo feliz: texto no próprio comando, via reply (conversation e
//     extendedTextMessage), e argumento tendo prioridade sobre o reply;
//   - avisos amigáveis: texto vazio (uso), texto curto demais, reply a
//     áudio/vídeo (manda usar o /transcrever) — sem chamar a IA;
//   - limite de entrada: trunca acima de 8000 chars COM aviso na resposta
//     e sem aviso quando está no limite ou abaixo;
//   - erros de API no MESMO tratamento do /gpt: sem chave/chave inválida
//     (😴), 429/timeout (⏳), api fora/vazia (⛔) — o executor NUNCA lança;
//   - response longa dividida em blocos de 2500 caracteres;
//   - prompt fixo em pt-BR (pontos principais + ~20-30% do original).
// Uso: node scripts/teste-resumir.js
// ============================================

const resumir = require('../comandos/menu-utilitario/resumir')

const JID = '120363000000000000@g.us'
const MSG = { key: { remoteJid: JID, fromMe: false, id: 'MSG' }, message: { conversation: '/resumir' } }
const RESPOSTA_IA = 'Resumo curto do texto entregue ao Limbo.'

// 📜 Texto base (bem acima do mínimo de 200 chars)
const TEXTO_BASE =
  'A noite caiu sobre o Limbo e as sombras dançavam lentamente entre os sonhos. ' +
  'Os guardiões dormiam enquanto as estrelas contavam histórias antigas. ' +
  'Ninguém sabia o que viria depois do amanhecer, mas o silêncio era confortável. ' +
  'E assim o tempo passou, tecendo memórias que ninguém jamais poderia resumir por completo.'

let reprovadas = 0
async function testar (nome, fn) {
  try {
    await fn()
    console.log('✅ ' + nome)
  } catch (err) {
    reprovadas += 1
    console.error('❌ ' + nome + ' →', err?.message || err)
  }
}

function criarSock () {
  const enviadas = []
  return {
    enviadas,
    sock: {
      user: { id: '5555999999999:12@s.whatsapp.net' },
      async sendMessage (jid, conteudo, opcoes) {
        enviadas.push({ jid, conteudo, opcoes })
        return { key: { id: 'fake' } }
      }
    }
  }
}

const textos = (enviadas) => enviadas.map((e) => e.conteudo?.text).filter((x) => typeof x === 'string')

const textoUnico = (enviadas) => {
  const t = textos(enviadas)
  if (t.length !== 1) throw new Error(`esperava 1 mensagem, veio ${t.length}`)
  return t[0]
}

// 🧾 Monta uma mensagem com reply à quotedMessage dada
const msgReply = (quotedMessage) => ({
  ...MSG,
  message: {
    extendedTextMessage: {
      text: '/resumir',
      contextInfo: { quotedMessage }
    }
  }
})

// 🌐 Simulador de fetch (respeita o AbortSignal do núcleo real)
function instalarFetch (resposta) {
  const chamadas = []
  global.fetch = (url, opcoes = {}) => {
    chamadas.push({ url: String(url), opcoes })
    if (typeof resposta === 'function') return resposta(url, opcoes)
    if (resposta instanceof Error) return Promise.reject(resposta)
    return Promise.resolve({
      ok: resposta?.ok !== false,
      status: resposta?.status ?? 200,
      async json () {
        if (resposta?.jsonErro) throw new Error('JSON inválido (simulado)')
        return resposta?.json ?? null
      }
    })
  }
  return chamadas
}

const respostaIaOk = (conteudo = RESPOSTA_IA) => ({ json: { choices: [{ message: { content: conteudo } }] } })

const fetchOriginal = global.fetch
const chaveOriginal = process.env.OPENROUTER_API_KEY

// 🔧 Variáveis ligadas à configuração do provedor (restauradas no fim)
const envOriginal = {
  RESUMIR_MODEL: process.env.RESUMIR_MODEL,
  GROQ_MODEL_RESUMIR: process.env.GROQ_MODEL_RESUMIR,
  OPENROUTER_SITE_URL: process.env.OPENROUTER_SITE_URL,
  OPENROUTER_APP_TITLE: process.env.OPENROUTER_APP_TITLE,
  RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL
}

// 🧹 Restaura uma variável de ambiente ao valor original (undefined = deleta)
function restaurarEnv (nome) {
  if (envOriginal[nome] === undefined) delete process.env[nome]
  else process.env[nome] = envOriginal[nome]
}

async function main () {
  // ═══════════════ 1) Exports ═══════════════
  await testar('exports: nome "resumir", aliases, categoria e ganchos de teste', async () => {
    if (resumir.nome !== 'resumir') throw new Error('nome inesperado: ' + resumir.nome)
    if (!resumir.aliases?.includes('resumo')) throw new Error('alias resumo ausente')
    if (!resumir.aliases?.includes('sumarizar')) throw new Error('alias sumarizar ausente')
    if (resumir.categoria !== 'utilitario') throw new Error('categoria deveria ser utilitario')
    if (typeof resumir.executar !== 'function') throw new Error('executar ausente')
    if (typeof resumir._injetarIa !== 'function' || typeof resumir._restaurarIa !== 'function') {
      throw new Error('ganchos de injeção ausentes')
    }
    const i = resumir.__internos
    if (i.LIMITE_ENTRADA !== 8000) throw new Error('o limite de entrada deveria ser 8000')
    if (i.MINIMO_ENTRADA !== 200) throw new Error('o mínimo deveria ser 200')
    if (i.TAMANHO_BLOCO !== 2500) throw new Error('os blocos deveriam ter 2500')
    if (i.TIMEOUT_API_MS !== 20000) throw new Error('o timeout deveria ser 20000ms')
    if (i.URL_OPENROUTER_CHAT !== 'https://openrouter.ai/api/v1/chat/completions') {
      throw new Error('o endpoint deveria ser o da OpenRouter: ' + i.URL_OPENROUTER_CHAT)
    }
    if (!/:free$/.test(i.MODELO_PADRAO)) throw new Error('o modelo padrão deveria ser gratuito (:free)')
    if (i.APP_TITLE_PADRAO !== 'Hipnos Bot') throw new Error('o X-Title padrão deveria ser "Hipnos Bot"')
    if (typeof i.modeloResumir !== 'function' || typeof i.urlDoApp !== 'function' || typeof i.tituloDoApp !== 'function') {
      throw new Error('helpers de configuração ausentes nos __internos')
    }
  })

  // ═══════════════ 2) Prompt fixo em pt-BR ═══════════════
  await testar('prompt fixo: resumo objetivo, pontos principais e ~20-30% do original', async () => {
    const p = resumir.__internos.SYSTEM_PROMPT
    if (!/português do Brasil/i.test(p)) throw new Error('o prompt deveria exigir pt-BR')
    if (!/pontos principais/i.test(p)) throw new Error('o prompt deveria citar os pontos principais')
    if (!/20-30%/.test(p)) throw new Error('o prompt deveria pedir ~20-30% do tamanho')
    if (!/objetivo/i.test(p)) throw new Error('o prompt deveria pedir resumo objetivo')
    if (!/não invente/i.test(p)) throw new Error('o prompt deveria proibir invenções')
  })

  // ═══════════════ 3) Fluxo feliz ═══════════════
  await testar('texto direto: IA recebe o texto exato e a resposta vem com cabeçalho', async () => {
    let recebido = null
    resumir._injetarIa(async (t) => { recebido = t; return RESPOSTA_IA })
    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + TEXTO_BASE)

    if (recebido !== TEXTO_BASE) throw new Error('a IA recebeu um texto diferente do enviado')
    const texto = textoUnico(enviadas)
    if (!texto.includes(RESPOSTA_IA)) throw new Error('faltou o resumo na resposta: ' + texto)
    if (!/O LIMBO CONDENSA O TEXTO/.test(texto)) throw new Error('faltou o cabeçalho')
    if (!texto.includes(String(TEXTO_BASE.length))) throw new Error('faltou o tamanho do original')
    if (/truncado/i.test(texto)) throw new Error('não deveria avisar truncamento aqui')
    if (!enviadas[0].opcoes?.quoted) throw new Error('deveria citar a mensagem do usuário')
    if (enviadas[0].jid !== JID) throw new Error('enviou para o jid errado')
  })

  await testar('reply a texto (conversation) → usa o texto citado', async () => {
    let recebido = null
    resumir._injetarIa(async (t) => { recebido = t; return RESPOSTA_IA })
    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, msgReply({ conversation: TEXTO_BASE }), '/resumir')

    if (recebido !== TEXTO_BASE) throw new Error('a IA não recebeu o texto citado')
    if (!textoUnico(enviadas).includes(RESPOSTA_IA)) throw new Error('faltou o resumo')
  })

  await testar('reply a texto (extendedTextMessage.text) → usa o texto citado', async () => {
    let recebido = null
    resumir._injetarIa(async (t) => { recebido = t; return RESPOSTA_IA })
    const { sock } = criarSock()
    await resumir.executar(sock, JID, msgReply({ extendedTextMessage: { text: TEXTO_BASE } }), '/resumir')
    if (recebido !== TEXTO_BASE) throw new Error('não extraiu o text do extendedTextMessage')
  })

  await testar('texto do comando tem prioridade sobre o texto citado', async () => {
    const direto = 'Texto digitado diretamente pelo usuário, bem maior que o mínimo exigido. '.repeat(4).trim()
    let recebido = null
    resumir._injetarIa(async (t) => { recebido = t; return RESPOSTA_IA })
    const { sock } = criarSock()
    await resumir.executar(sock, JID, msgReply({ conversation: TEXTO_BASE }), '/resumir ' + direto)
    if (recebido !== direto) throw new Error('o texto digitado deveria vencer o do reply')
  })

  // ═══════════════ 4) Avisos amigáveis (sem chamar a IA) ═══════════════
  await testar('texto vazio → aviso de uso (IA nem é chamada)', async () => {
    let chamou = false
    resumir._injetarIa(async () => { chamou = true; return RESPOSTA_IA })
    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir')
    if (chamou) throw new Error('a IA não deveria ser chamada')
    const texto = textoUnico(enviadas)
    if (!/pergaminho/i.test(texto) || !/\/resumir/.test(texto)) throw new Error('aviso de uso inesperado: ' + texto)
  })

  await testar('reply a ÁUDIO → avisa para usar o /transcrever (IA nem é chamada)', async () => {
    let chamou = false
    resumir._injetarIa(async () => { chamou = true; return RESPOSTA_IA })
    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, msgReply({ audioMessage: { seconds: 12 } }), '/resumir')
    if (chamou) throw new Error('a IA não deveria ser chamada')
    const texto = textoUnico(enviadas)
    if (!/\/transcrever/.test(texto) || !/áudio/i.test(texto)) throw new Error('esperava o aviso do /transcrever: ' + texto)
  })

  await testar('reply a VÍDEO → também avisa para usar o /transcrever', async () => {
    let chamou = false
    resumir._injetarIa(async () => { chamou = true; return RESPOSTA_IA })
    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, msgReply({ videoMessage: { seconds: 30 } }), '/resumir')
    if (chamou) throw new Error('a IA não deveria ser chamada')
    const texto = textoUnico(enviadas)
    if (!/\/transcrever/.test(texto) || !/vídeo/i.test(texto)) throw new Error('esperava o aviso de vídeo: ' + texto)
  })

  await testar('texto curto demais → aviso "curto demais" (IA nem é chamada)', async () => {
    const curto = 'tudo bem?'
    let chamou = false
    resumir._injetarIa(async () => { chamou = true; return RESPOSTA_IA })
    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + curto)
    if (chamou) throw new Error('a IA não deveria ser chamada')
    const texto = textoUnico(enviadas)
    if (!/curto demais/i.test(texto)) throw new Error('esperava o aviso de texto curto: ' + texto)
    if (!texto.includes('200')) throw new Error('o aviso deveria citar o mínimo de 200')
    if (!texto.includes(String(curto.length))) throw new Error('o aviso deveria citar o tamanho atual (' + curto.length + ')')
  })

  // ═══════════════ 5) Limite de entrada (truncamento) ═══════════════
  await testar('texto EXATAMENTE no mínimo (200 chars) → resume normalmente', async () => {
    const texto200 = 'a'.repeat(resumir.__internos.MINIMO_ENTRADA)
    let recebido = null
    resumir._injetarIa(async (t) => { recebido = t; return RESPOSTA_IA })
    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + texto200)
    if (recebido !== texto200) throw new Error('deveria resumir exatamente no limite mínimo')
    if (/curto demais/i.test(textoUnico(enviadas))) throw new Error('não deveria avisar texto curto')
  })

  await testar('texto gigante (9000) → trunca em 8000 e avisa na resposta', async () => {
    const gigante = 'z'.repeat(9000)
    let recebido = null
    resumir._injetarIa(async (t) => { recebido = t; return RESPOSTA_IA })
    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + gigante)

    if (recebido.length !== 8000) throw new Error('a IA deveria receber 8000 chars, recebeu ' + recebido.length)
    if (recebido !== gigante.slice(0, 8000)) throw new Error('o corte deveria ser o início do texto')
    const texto = textoUnico(enviadas)
    if (!/truncado/i.test(texto)) throw new Error('deveria avisar o truncamento: ' + texto)
    if (!texto.includes('1000')) throw new Error('deveria informar 1000 caracteres descartados')
    if (!texto.includes('9000')) throw new Error('deveria informar o tamanho original (9000)')
  })

  await testar('texto EXATAMENTE no limite (8000) → sem aviso de truncamento', async () => {
    const noLimite = 'b'.repeat(8000)
    let recebido = null
    resumir._injetarIa(async (t) => { recebido = t; return RESPOSTA_IA })
    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + noLimite)
    if (recebido.length !== 8000) throw new Error('deveria passar os 8000 chars inteiros')
    if (/truncado/i.test(textoUnico(enviadas))) throw new Error('não deveria avisar truncamento no limite')
  })

  // ═══════════════ 6) Blocos de 2500 caracteres ═══════════════
  await testar('resumo longo → dividido em blocos, sem citar na 2ª mensagem', async () => {
    const resumoLongo = 'palavra '.repeat(400).trim() // ~3199 chars
    resumir._injetarIa(async () => resumoLongo)
    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + TEXTO_BASE)

    const t = textos(enviadas)
    if (t.length !== 2) throw new Error('esperava 2 blocos, vieram ' + t.length)
    if (!/O LIMBO CONDENSA O TEXTO/.test(t[0])) throw new Error('o cabeçalho deveria ir no 1º bloco')
    if (/O LIMBO CONDENSA O TEXTO/.test(t[1])) throw new Error('o 2º bloco não deveria repetir o cabeçalho')
    if (!enviadas[0].opcoes?.quoted) throw new Error('a 1ª mensagem deveria citar o comando')
    if (enviadas[1].opcoes) throw new Error('a 2ª mensagem não deveria citar nada')
    for (const bloco of t) {
      if (bloco.length > 2500 + 200) throw new Error('bloco grande demais: ' + bloco.length)
    }
  })

  // ═══════════════ 7) Núcleo REAL de IA (fetch simulado) ═══════════════
  await testar('núcleo real (OpenRouter): endpoint, headers do app, body e AbortSignal', async () => {
    resumir._restaurarIa()
    process.env.OPENROUTER_API_KEY = 'chave-de-teste'
    restaurarEnv('RESUMIR_MODEL')
    restaurarEnv('GROQ_MODEL_RESUMIR')
    const chamadas = instalarFetch(respostaIaOk())

    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + TEXTO_BASE)

    if (chamadas.length !== 1) throw new Error('deveria chamar a IA 1x, chamou ' + chamadas.length)
    if (chamadas[0].url !== resumir.__internos.URL_OPENROUTER_CHAT) throw new Error('url inesperada: ' + chamadas[0].url)
    if (!/^https:\/\/openrouter\.ai\/api\/v1\/chat\/completions$/.test(chamadas[0].url)) {
      throw new Error('deveria usar o endpoint da OpenRouter: ' + chamadas[0].url)
    }
    if (/groq\.com/i.test(chamadas[0].url)) throw new Error('não deveria mais usar a Groq: ' + chamadas[0].url)

    const h = chamadas[0].opcoes.headers
    if (h.Authorization !== 'Bearer chave-de-teste') throw new Error('faltou o Bearer da OPENROUTER_API_KEY')
    if (h['Content-Type'] !== 'application/json') throw new Error('faltou o Content-Type JSON')
    if (!h['HTTP-Referer']) throw new Error('faltou o header HTTP-Referer (exigido pela OpenRouter)')
    if (!h['X-Title']) throw new Error('faltou o header X-Title (exigido pela OpenRouter)')
    if (!chamadas[0].opcoes.signal) throw new Error('faltou o AbortSignal do timeout')

    const body = JSON.parse(chamadas[0].opcoes.body)
    if (!body.model) throw new Error('faltou o model')
    if (!/:free$/.test(body.model)) throw new Error('o modelo padrão deveria ser gratuito: ' + body.model)
    if (body.temperature !== 0.3) throw new Error('a temperatura deveria ser 0.3')
    if (body.max_tokens !== 2000) throw new Error('o max_tokens deveria ser 2000')
    if (body.messages[0].role !== 'system') throw new Error('1ª mensagem deveria ser o system')
    if (body.messages[0].content !== resumir.__internos.SYSTEM_PROMPT) throw new Error('system prompt diferente do fixo')
    if (body.messages[1].role !== 'user' || body.messages[1].content !== TEXTO_BASE) throw new Error('o user deveria ser o texto')
    if (!textoUnico(enviadas).includes(RESPOSTA_IA)) throw new Error('faltou o resumo na resposta')
  })

  await testar('modelo: configurável por RESUMIR_MODEL (e legado GROQ_MODEL_RESUMIR)', async () => {
    restaurarEnv('RESUMIR_MODEL')
    restaurarEnv('GROQ_MODEL_RESUMIR')

    // 🕘 nome antigo (da versão Groq) continua aceito como fallback
    process.env.GROQ_MODEL_RESUMIR = 'legado/modelo-de-teste:free'
    if (resumir.__internos.modeloResumir() !== 'legado/modelo-de-teste:free') {
      throw new Error('o nome antigo GROQ_MODEL_RESUMIR deveria continuar funcionando')
    }

    // 🆕 RESUMIR_MODEL tem prioridade
    process.env.RESUMIR_MODEL = 'novo/modelo-de-teste:free'
    if (resumir.__internos.modeloResumir() !== 'novo/modelo-de-teste:free') {
      throw new Error('RESUMIR_MODEL deveria ter prioridade sobre o nome antigo')
    }

    // 🎯 e o modelo configurado é o que vai no body da requisição
    resumir._restaurarIa()
    process.env.OPENROUTER_API_KEY = 'chave-de-teste'
    const chamadas = instalarFetch(respostaIaOk())
    const { sock } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + TEXTO_BASE)
    const enviado = JSON.parse(chamadas[0].opcoes.body).model
    if (enviado !== 'novo/modelo-de-teste:free') throw new Error('o body deveria usar o modelo configurado, veio: ' + enviado)

    restaurarEnv('RESUMIR_MODEL')
    restaurarEnv('GROQ_MODEL_RESUMIR')
  })

  await testar('headers do app: X-Title "Hipnos Bot" e HTTP-Referer do RENDER_EXTERNAL_URL', async () => {
    resumir._restaurarIa()
    process.env.OPENROUTER_API_KEY = 'chave-de-teste'
    restaurarEnv('OPENROUTER_SITE_URL')
    restaurarEnv('OPENROUTER_APP_TITLE')
    process.env.RENDER_EXTERNAL_URL = 'https://hipnos-teste.onrender.com'
    const chamadas = instalarFetch(respostaIaOk())

    const { sock } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + TEXTO_BASE)

    const h = chamadas[0].opcoes.headers
    if (h['HTTP-Referer'] !== 'https://hipnos-teste.onrender.com') {
      throw new Error('HTTP-Referer deveria vir do RENDER_EXTERNAL_URL: ' + h['HTTP-Referer'])
    }
    if (h['X-Title'] !== 'Hipnos Bot') throw new Error('X-Title deveria ser "Hipnos Bot": ' + h['X-Title'])

    restaurarEnv('RENDER_EXTERNAL_URL')
  })

  await testar('headers do app: overrides + padrão do projeto sem env nenhuma', async () => {
    resumir._restaurarIa()
    process.env.OPENROUTER_API_KEY = 'chave-de-teste'

    // 🔧 overrides explícitos ganham de tudo
    process.env.OPENROUTER_SITE_URL = 'https://meu-site.example'
    process.env.OPENROUTER_APP_TITLE = 'Limbo Bot'
    let chamadas = instalarFetch(respostaIaOk())
    let { sock } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + TEXTO_BASE)
    if (chamadas[0].opcoes.headers['HTTP-Referer'] !== 'https://meu-site.example') {
      throw new Error('o override OPENROUTER_SITE_URL não foi aplicado')
    }
    if (chamadas[0].opcoes.headers['X-Title'] !== 'Limbo Bot') {
      throw new Error('o override OPENROUTER_APP_TITLE não foi aplicado')
    }

    // 🏠 sem overrides e sem RENDER_EXTERNAL_URL → cai nos padrões do projeto
    restaurarEnv('OPENROUTER_SITE_URL')
    restaurarEnv('OPENROUTER_APP_TITLE')
    restaurarEnv('RENDER_EXTERNAL_URL')
    chamadas = instalarFetch(respostaIaOk())
    ;({ sock } = criarSock())
    await resumir.executar(sock, JID, MSG, '/resumir ' + TEXTO_BASE)
    const h = chamadas[0].opcoes.headers
    if (h['HTTP-Referer'] !== resumir.__internos.SITE_URL_PADRAO) {
      throw new Error('deveria cair no SITE_URL_PADRAO, veio: ' + h['HTTP-Referer'])
    }
    if (h['X-Title'] !== resumir.__internos.APP_TITLE_PADRAO) {
      throw new Error('deveria cair no APP_TITLE_PADRAO, veio: ' + h['X-Title'])
    }
  })

  await testar('sem OPENROUTER_API_KEY → aviso "😴" (nada escapa)', async () => {
    resumir._restaurarIa()
    delete process.env.OPENROUTER_API_KEY
    instalarFetch(new Error('NÃO deveria haver requisição sem chave'))

    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + TEXTO_BASE)
    const texto = textoUnico(enviadas)
    if (!/😴/.test(texto) || !/OPENROUTER_API_KEY/.test(texto)) throw new Error('esperava o aviso de chave ausente: ' + texto)
  })

  await testar('HTTP 401 → aviso "😴" de chave inválida', async () => {
    resumir._restaurarIa()
    process.env.OPENROUTER_API_KEY = 'chave-de-teste'
    instalarFetch({ ok: false, status: 401 })

    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + TEXTO_BASE)
    if (!/😴/.test(textoUnico(enviadas))) throw new Error('esperava o aviso de chave inválida')
  })

  await testar('HTTP 429 → aviso "⏳" de sobrecarga', async () => {
    resumir._restaurarIa()
    process.env.OPENROUTER_API_KEY = 'chave-de-teste'
    instalarFetch({ ok: false, status: 429 })

    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + TEXTO_BASE)
    const texto = textoUnico(enviadas)
    if (!/⏳/.test(texto) || !/sobrecarregada/i.test(texto)) throw new Error('esperava o aviso de limite: ' + texto)
  })

  await testar('HTTP 500 → aviso "⛔" (api fora)', async () => {
    resumir._restaurarIa()
    process.env.OPENROUTER_API_KEY = 'chave-de-teste'
    instalarFetch({ ok: false, status: 500 })

    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + TEXTO_BASE)
    const texto = textoUnico(enviadas)
    if (!/⛔/.test(texto) || !/sombras/i.test(texto)) throw new Error('esperava o aviso genérico: ' + texto)
  })

  await testar('JSON inválido e resposta VAZIA → aviso "⛔"', async () => {
    resumir._restaurarIa()
    process.env.OPENROUTER_API_KEY = 'chave-de-teste'

    instalarFetch({ jsonErro: true })
    let { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + TEXTO_BASE)
    if (!/⛔/.test(textoUnico(enviadas))) throw new Error('JSON lixo deveria virar aviso amigável')

    instalarFetch({ json: { choices: [{ message: { content: '   ' } }] } })
    ;({ sock, enviadas } = criarSock())
    await resumir.executar(sock, JID, MSG, '/resumir ' + TEXTO_BASE)
    if (!/⛔/.test(textoUnico(enviadas))) throw new Error('resposta vazia deveria virar aviso amigável')
  })

  await testar('timeout (AbortError do AbortSignal) → aviso "⏳"', async () => {
    resumir._restaurarIa()
    process.env.OPENROUTER_API_KEY = 'chave-de-teste'
    instalarFetch(() => {
      const e = new Error('This operation was aborted')
      e.name = 'AbortError'
      return Promise.reject(e)
    })

    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + TEXTO_BASE)
    if (!/⏳/.test(textoUnico(enviadas))) throw new Error('esperava o aviso de timeout')
  })

  await testar('erro de REDE na IA → aviso "⛔"', async () => {
    resumir._restaurarIa()
    process.env.OPENROUTER_API_KEY = 'chave-de-teste'
    instalarFetch(new Error('fetch failed (getaddrinfo ENOTFOUND)'))

    const { sock, enviadas } = criarSock()
    await resumir.executar(sock, JID, MSG, '/resumir ' + TEXTO_BASE)
    if (!/⛔/.test(textoUnico(enviadas))) throw new Error('esperava o aviso genérico')
  })

  // ═══════════════ 8) Robustez do executor ═══════════════
  await testar('IA injetada que LANÇA → executor não lança, manda aviso amigável', async () => {
    resumir._injetarIa(async () => { throw new Error('explosão simulada na IA') })
    const { sock, enviadas } = criarSock()
    let lancou = false
    try { await resumir.executar(sock, JID, MSG, '/resumir ' + TEXTO_BASE) } catch (e) { lancou = true }
    if (lancou) throw new Error('o executor lançou erro (deveria avisar de forma amigável)')
    if (!/⛔/.test(textoUnico(enviadas))) throw new Error('esperava o aviso amigável')
  })

  await testar('mensagem sem conteudo e sem texto → aviso de uso, sem quebrar', async () => {
    resumir._injetarIa(async () => RESPOSTA_IA)
    const { sock, enviadas } = criarSock()
    let lancou = false
    try { await resumir.executar(sock, JID, { key: { id: 'X' } }, undefined) } catch (e) { lancou = true }
    if (lancou) throw new Error('não deveria lançar com mensagem vazia')
    if (!/pergaminho/i.test(textoUnico(enviadas))) throw new Error('esperava o aviso de uso')
  })

  // ─── limpeza ───
  resumir._restaurarIa()
  global.fetch = fetchOriginal
  if (chaveOriginal === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = chaveOriginal
  for (const nome of Object.keys(envOriginal)) restaurarEnv(nome)

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()




