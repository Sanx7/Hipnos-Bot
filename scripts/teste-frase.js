// ============================================
// 🧪 teste-frase.js — Valida /frase (ZenQuotes + tradução Groq)
// ============================================
// RODA 100% OFFLINE: nenhuma requisição de rede é feita.
//   - global.fetch é substituído por um simulador (respeita AbortSignal);
//   - o executor é chamado com um sock mock, como nos outros testes do repo.
// Verifica:
//   - exports (nome, aliases, gancho de teste);
//   - fluxo feliz: 💭 "frase traduzida" — Autor (formato EXATO do pedido);
//   - parsing REAL da ZenQuotes (array) e falhas: HTTP 500, JSON lixo,
//     resposta-objeto "Too many requests", array vazio;
//   - fallback: tradução falhando (HTTP 401, JSON inválido, sem chave)
//     → frase original em inglês + nota, sem quebrar;
//   - orçamento ÚNICO de 15s: a 2ª etapa recebe só o tempo que sobrou;
//   - timeout real (AbortSignal) → aviso amigável "⏳";
//   - erro de rede na busca → aviso amigável "⛔";
//   - NADA escapa para o socket (o executor nunca lança).
// Uso: node scripts/teste-frase.js
// ============================================

const frase = require('../comandos/menu-brincadeiras/frase')

const JID = '120363000000000000@g.us'
const MSG = { key: { remoteJid: JID, fromMe: false, id: 'MSG', participant: '5551111111111@s.whatsapp.net' } }

const RESPOSTA_ZEN_OK = [{ q: 'A person is only by the thoughts that he chooses.', a: 'James Allen', h: '<blockquote>…</blockquote>' }]
const RESPOSTA_GROQ_OK = { choices: [{ message: { content: '{"frase": "Uma pessoa é apenas aquilo que pensa."}' } }] }

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

const textoUnico = (enviadas) => {
  const t = enviadas.map((e) => e.conteudo?.text).filter((x) => typeof x === 'string')
  if (t.length !== 1) throw new Error(`esperava 1 mensagem, veio ${t.length}`)
  return t[0]
}

// ─── 🌐 Simulador de fetch (respeita o AbortSignal do orçamento) ───
function instalarFetch ({ zenquotes = null, groq = null, travar = false } = {}) {
  const chamadas = []
  global.fetch = (url, opcoes = {}) => {
    chamadas.push({ url: String(url), opcoes })

    if (travar) {
      // Nunca responde — só rejeita quando o orçamento abortar
      return new Promise((_, reject) => {
        const sinal = opcoes.signal
        const abortar = () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        }
        if (sinal) {
          if (sinal.aborted) return abortar()
          sinal.addEventListener('abort', abortar)
        }
      })
    }

    const ehGroq = String(url).includes('api.groq.com')
    const resposta = ehGroq ? groq : zenquotes
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

const fetchOriginal = global.fetch
const chaveOriginal = process.env.GROQ_API_KEY

async function main () {
  // ═══════════════ 1) Exports ═══════════════
  await testar('exports: nome "frase", aliases e gancho de teste', async () => {
    if (frase.nome !== 'frase') throw new Error('nome inesperado: ' + frase.nome)
    if (!frase.aliases?.includes('frases')) throw new Error('alias frases ausente')
    if (typeof frase.executar !== 'function') throw new Error('executar ausente')
    if (typeof frase._injetarBuscas !== 'function') throw new Error('_injetarBuscas ausente')
    if (frase.__internos?.TIMEOUT_TOTAL_MS !== 15000) throw new Error('o timeout total deveria ser 15000ms')
  })

  // ═══════════════ 2) Fluxo feliz (com os injetores) ═══════════════
  await testar('fluxo feliz: 💭 "frase traduzida" — Autor', async () => {
    frase._injetarBuscas({
      buscarFrase: async () => ({ frase: 'Stay hungry, stay foolish.', autor: 'Steve Jobs' }),
      traduzirFrase: async () => 'Continue faminto, continue tolo.'
    })
    const { sock, enviadas } = criarSock()
    await frase.executar(sock, JID, MSG, '/frase')

    const texto = textoUnico(enviadas)
    if (texto !== '💭 "Continue faminto, continue tolo." — Steve Jobs') {
      throw new Error('formato inesperado: ' + texto)
    }
    if (!enviadas[0].opcoes?.quoted) throw new Error('não citou a mensagem do usuário')
  })

  // ═══════════════ 3) Busca REAL da ZenQuotes (fetch simulado) ═══════════════
  await testar('ZenQuotes (real): array com a frase → extrai q e a', async () => {
    const chamadas = instalarFetch({ zenquotes: { json: RESPOSTA_ZEN_OK } })
    const recebido = await frase.__internos.buscarFrase(frase.__internos.criarOrcamento())
    if (recebido.frase !== RESPOSTA_ZEN_OK[0].q) throw new Error('frase errada: ' + recebido.frase)
    if (recebido.autor !== 'James Allen') throw new Error('autor errado: ' + recebido.autor)
    if (chamadas[0].url !== frase.__internos.URL_ZENQUOTES) throw new Error('URL errada: ' + chamadas[0].url)
    if (!chamadas[0].opcoes.signal) throw new Error('a requisição saiu SEM o sinal de timeout')
  })

  await testar('ZenQuotes (real): autor ausente → "Autor desconhecido"', async () => {
    instalarFetch({ zenquotes: { json: [{ q: 'Keep it simple.' }] } })
    const recebido = await frase.__internos.buscarFrase(frase.__internos.criarOrcamento())
    if (recebido.autor !== 'Autor desconhecido') throw new Error('autor inesperado: ' + recebido.autor)
  })

  await testar('ZenQuotes (real): limite gratuito (objeto "Too many requests") → lança', async () => {
    instalarFetch({
      zenquotes: { json: { q: 'Too many requests. Obtain an auth key for unlimited access.', a: 'ZenQuotes.io' } }
    })
    let erro = null
    try {
      await frase.__internos.buscarFrase(frase.__internos.criarOrcamento())
    } catch (err) { erro = err }
    if (!erro) throw new Error('aceitou uma resposta que não é frase')
    if (!/frase válida/i.test(erro.message)) throw new Error('mensagem inesperada: ' + erro.message)
  })

  await testar('ZenQuotes (real): HTTP 500 e JSON quebrado → lança', async () => {
    instalarFetch({ zenquotes: { ok: false, status: 500 } })
    let erro1 = null
    try { await frase.__internos.buscarFrase(frase.__internos.criarOrcamento()) } catch (e) { erro1 = e }
    if (!erro1 || !/HTTP 500/.test(erro1.message)) throw new Error('não detectou o HTTP 500')

    instalarFetch({ zenquotes: { jsonErro: true } })
    let erro2 = null
    try { await frase.__internos.buscarFrase(frase.__internos.criarOrcamento()) } catch (e) { erro2 = e }
    if (!erro2) throw new Error('aceitou JSON quebrado')
  })

  await testar('ZenQuotes (real): array vazio → lança', async () => {
    instalarFetch({ zenquotes: { json: [] } })
    let erro = null
    try { await frase.__internos.buscarFrase(frase.__internos.criarOrcamento()) } catch (e) { erro = e }
    if (!erro) throw new Error('aceitou array vazio')
  })

  // ═══════════════ 4) Tradução REAL via Groq (fetch simulado) ═══════════════
  await testar('Groq (real): JSON puro e JSON com enfeite → traduz', async () => {
    process.env.GROQ_API_KEY = 'chave-de-teste'
    const chamadas = instalarFetch({ groq: { json: RESPOSTA_GROQ_OK } })
    const ok = await frase.__internos.traduzirFrase(RESPOSTA_ZEN_OK[0].q, 'James Allen', frase.__internos.criarOrcamento())
    if (ok !== 'Uma pessoa é apenas aquilo que pensa.') throw new Error('tradução inesperada: ' + ok)
    if (chamadas[0].url !== frase.__internos.URL_GROQ_CHAT) throw new Error('URL do Groq errada')
    const corpo = JSON.parse(chamadas[0].opcoes.body)
    if (corpo.response_format?.type !== 'json_object') throw new Error('faltou response_format json_object')
    if (!/Bearer /.test(chamadas[0].opcoes.headers.Authorization)) throw new Error('faltou o Bearer da chave')

    instalarFetch({
      groq: { json: { choices: [{ message: { content: 'Claro! Aqui vai:\n{"frase": "Viva o agora."}\n😊' } }] } }
    })
    const cercado = await frase.__internos.traduzirFrase('Live now.', 'Anônimo', frase.__internos.criarOrcamento())
    if (cercado !== 'Viva o agora.') throw new Error('não extraiu o JSON cercado de texto: ' + cercado)
  })

  await testar('Groq (real): HTTP 401 / JSON inválido / frase vazia → null', async () => {
    process.env.GROQ_API_KEY = 'chave-de-teste'
    instalarFetch({ groq: { ok: false, status: 401 } })
    if (await frase.__internos.traduzirFrase('x', 'y', frase.__internos.criarOrcamento()) !== null) {
      throw new Error('deveria devolver null no HTTP 401')
    }

    instalarFetch({ groq: { json: { choices: [{ message: { content: 'sem json nenhum' } }] } } })
    if (await frase.__internos.traduzirFrase('x', 'y', frase.__internos.criarOrcamento()) !== null) {
      throw new Error('deveria devolver null com JSON inválido')
    }

    instalarFetch({ groq: { json: { choices: [{ message: { content: '{"frase": "   "}' } }] } } })
    if (await frase.__internos.traduzirFrase('x', 'y', frase.__internos.criarOrcamento()) !== null) {
      throw new Error('deveria devolver null com frase vazia')
    }
  })

  await testar('Groq (real): SEM GROQ_API_KEY → null e NEM chama o fetch', async () => {
    delete process.env.GROQ_API_KEY
    const chamadas = instalarFetch({ groq: { json: RESPOSTA_GROQ_OK } })
    const resultado = await frase.__internos.traduzirFrase('x', 'y', frase.__internos.criarOrcamento())
    if (resultado !== null) throw new Error('deveria devolver null sem chave')
    if (chamadas.length !== 0) throw new Error('fez requisição sem chave configurada')
    process.env.GROQ_API_KEY = chaveOriginal
  })

  // ═══════════════ 5) Orçamento ÚNICO de 15s (as duas etapas somadas) ═══════════════
  await testar('orçamento: 15s no TOTAL — a 2ª etapa recebe só o que sobrou', async () => {
    const now = Date.now
    let agora = now()
    Date.now = () => agora
    try {
      const orcamento = frase.__internos.criarOrcamento()
      if (orcamento.restante() !== 15000) throw new Error('restante inicial != 15000')
      agora += 9000 // a busca da frase gastou 9s
      if (orcamento.restante() !== 6000) throw new Error('restante após a 1ª etapa != 6000')
      if (orcamento.expirou()) throw new Error('não deveria ter expirado com 6s restantes')

      agora += 6000 // estourou o total
      if (!orcamento.expirou()) throw new Error('deveria ter expirado aos 15s')
      if (orcamento.restante() > 0) throw new Error('restante deveria ser <= 0')
    } finally {
      Date.now = now
    }
  })

  await testar('orçamento estourado: a 2ª etapa nem tenta a requisição', async () => {
    process.env.GROQ_API_KEY = 'chave-de-teste'
    const chamadas = instalarFetch({ groq: { json: RESPOSTA_GROQ_OK } })
    const resultado = await frase.__internos.traduzirFrase('x', 'y', frase.__internos.criarOrcamento(0))
    if (resultado !== null) throw new Error('deveria devolver null (fallback)')
    if (chamadas.length !== 0) throw new Error('fez a requisição mesmo com o orçamento estourado')
  })

  await testar('timeout REAL: fetch que travou é abortado pelo orçamento', async () => {
    const chamadas = instalarFetch({ travar: true })
    const inicio = Date.now()
    let erro = null
    try {
      await frase.__internos.buscarFrase(frase.__internos.criarOrcamento(150))
    } catch (e) { erro = e }
    const duracao = Date.now() - inicio
    if (!erro) throw new Error('deveria ter estourado o timeout')
    if (erro.name !== 'TimeoutHipnos') throw new Error('erro inesperado: ' + erro.name + ' — ' + erro.message)
    if (duracao > 1500) throw new Error(`demorou demais para abortar (${duracao}ms)`)
    if (chamadas.length !== 1) throw new Error('deveria ter tentado a requisição 1x')
  })

  // ═══════════════ 6) Fallbacks do executor ═══════════════
  await testar('fallback: tradução falhou → frase em inglês + nota, sem quebrar', async () => {
    frase._injetarBuscas({
      buscarFrase: async () => ({ frase: 'Time is an illusion.', autor: 'Albert Einstein' }),
      traduzirFrase: async () => null
    })
    const { sock, enviadas } = criarSock()
    await frase.executar(sock, JID, MSG, '/frase')
    const texto = textoUnico(enviadas)
    if (!texto.startsWith('💭 "Time is an illusion." — Albert Einstein')) {
      throw new Error('não usou a frase original: ' + texto)
    }
    if (!/tradução indisponível/i.test(texto)) throw new Error('faltou a nota amigável da tradução')
  })

  await testar('fallback: busca falhou → aviso amigável "⛔" (nada escapa)', async () => {
    frase._injetarBuscas({
      buscarFrase: async () => { throw new Error('a ZenQuotes respondeu HTTP 500') },
      traduzirFrase: async () => 'não deveria ser chamada'
    })
    const { sock, enviadas } = criarSock()
    let lancou = false
    try { await frase.executar(sock, JID, MSG, '/frase') } catch (e) { lancou = true }
    if (lancou) throw new Error('o executor lançou erro')
    const texto = textoUnico(enviadas)
    if (!/⛔/.test(texto)) throw new Error('esperava o aviso de erro amigável: ' + texto)
  })

  await testar('fallback: erro de REDE na busca → aviso amigável, não quebra', async () => {
    frase._injetarBuscas({
      buscarFrase: async () => { throw new Error('fetch failed (getaddrinfo ENOTFOUND)') }
    })
    const { sock, enviadas } = criarSock()
    await frase.executar(sock, JID, MSG, '/frase')
    if (!/⛔/.test(textoUnico(enviadas))) throw new Error('esperava aviso amigável')
  })

  await testar('timeout: aviso amigável "⏳"', async () => {
    const erroTimeout = new Error('a busca da frase demorou demais (timeout)')
    erroTimeout.name = 'TimeoutHipnos'
    frase._injetarBuscas({ buscarFrase: async () => { throw erroTimeout } })
    const { sock, enviadas } = criarSock()
    await frase.executar(sock, JID, MSG, '/frase')
    const texto = textoUnico(enviadas)
    if (!/⏳/.test(texto) || !/instantes/i.test(texto)) throw new Error('esperava o aviso de timeout: ' + texto)
  })

  // ═══════════════ 7) Integração: as DUAS etapas reais (fetch simulado) ═══════════════
  await testar('integração: busca + tradução reais → 💭 "…" — Autor', async () => {
    frase._injetarBuscas(frase.__internos) // restaura as funções REAIS
    process.env.GROQ_API_KEY = 'chave-de-teste'
    instalarFetch({ zenquotes: { json: RESPOSTA_ZEN_OK }, groq: { json: RESPOSTA_GROQ_OK } })

    const { sock, enviadas } = criarSock()
    await frase.executar(sock, JID, MSG, '/frase')
    const texto = textoUnico(enviadas)
    if (texto !== '💭 "Uma pessoa é apenas aquilo que pensa." — James Allen') {
      throw new Error('mensagem final inesperada: ' + texto)
    }
  })

  // ─── limpeza ───
  global.fetch = fetchOriginal
  process.env.GROQ_API_KEY = chaveOriginal

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
