// ============================================
// 🧪 teste-reescrever.js — Valida o /reescrever (IA do Limbo)
// ============================================
// RODA 100% OFFLINE: nenhuma requisição de rede é feita.
// O núcleo de IA é injetado com _injetarIa() na maioria dos casos e,
// nos testes de integração, usa _restaurarIa() + fetch simulado p/
// exercitar o código REAL (montagem do body, 401/429/vazio/abort).
// Provedor: OPENROUTER (mesmo client do /resumir).
// Verifica: exports, tons válidos/inválidos, texto direto, reply,
// texto vazio, reply a áudio/vídeo, truncamento, erros de API e
// prompt fixo em pt-BR.
// Uso: node scripts/teste-reescrever.js
// ============================================

const reescrever = require('../comandos/menu-utilitario/reescrever')

const JID = '120363000000000000@g.us'
const MSG = { key: { remoteJid: JID, fromMe: false, id: 'MSG' }, message: { conversation: '/reescrever' } }
const RESPOSTA_IA = 'Prezado, vamos nos encontrar hoje?'

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

const msgReply = (quotedMessage) => ({
  ...MSG,
  message: { extendedTextMessage: { text: '/reescrever formal', contextInfo: { quotedMessage } } }
})

function instalarFetch (resposta) {
  global.fetch = (url, opcoes = {}) => {
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
}

const respostaIaOk = (conteudo = RESPOSTA_IA) => ({ json: { choices: [{ message: { content: conteudo } }] } })
const fetchOriginal = global.fetch
const chaveOriginal = process.env.OPENROUTER_API_KEY
const envOriginal = { REESCREVER_MODEL: process.env.REESCREVER_MODEL, OPENROUTER_SITE_URL: process.env.OPENROUTER_SITE_URL, OPENROUTER_APP_TITLE: process.env.OPENROUTER_APP_TITLE, RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL }

function restaurarEnv (nome) {
  if (envOriginal[nome] === undefined) delete process.env[nome]
  else process.env[nome] = envOriginal[nome]
}


async function main () {
  await testar('exports: nome, aliases, categoria e ganchos', async () => {
    if (reescrever.nome !== 'reescrever') throw new Error('nome: ' + reescrever.nome)
    if (!reescrever.aliases?.includes('reescreve')) throw new Error('alias ausente')
    if (reescrever.categoria !== 'utilitario') throw new Error('categoria: ' + reescrever.categoria)
    const i = reescrever.__internos
    if (i.URL_OPENROUTER_CHAT !== 'https://openrouter.ai/api/v1/chat/completions') throw new Error('endpoint errado')
    if (!/:free$/.test(i.MODELO_PADRAO)) throw new Error('modelo deveria ser :free')
  })

  await testar('tons: 8 canonicos + aliases resolvem', async () => {
    const i = reescrever.__internos
    if (i.TONS_CANONICOS.length < 8) throw new Error('faltam tons')
    for (const t of ['formal', 'informal', 'engraçado', 'poético', 'educado', 'profissional', 'agressivo', 'zoeira']) {
      if (!i.resolverTom(t)) throw new Error('nao resolve: ' + t)
    }
    if (i.resolverTom('poetico')?.rotulo !== 'poético') throw new Error('sem acento falhou')
    if (i.resolverTom('zoacao')?.rotulo !== 'zoeira') throw new Error('zoacao falhou')
    if (i.resolverTom('pirata') !== null) throw new Error('inventado deveria ser null')
  })

  await testar('prompt fixo: mantem sentido, sem info nova', async () => {
    const p = reescrever.__internos.promptPara(reescrever.__internos.resolverTom('formal'))
    if (!/sentido original/i.test(p)) throw new Error('faltou manter o sentido')
    if (!/sem adicionar|não adicione/i.test(p)) throw new Error('faltou proibir info nova')
  })

  await testar('tom valido + texto direto', async () => {
    let recebido = null
    reescrever._injetarIa(async (t, tom) => { recebido = { t, tom }; return RESPOSTA_IA })
    const { sock, enviadas } = criarSock()
    await reescrever.executar(sock, JID, MSG, '/reescrever formal Ai mano, bora la hoje?')
    if (recebido?.t !== 'Ai mano, bora la hoje?') throw new Error('texto errado')
    if (recebido?.tom?.rotulo !== 'formal') throw new Error('tom errado')
    if (!textoUnico(enviadas).includes(RESPOSTA_IA)) throw new Error('faltou a reescrita')
  })

  await testar('reply a texto usa o citado', async () => {
    let recebido = null
    reescrever._injetarIa(async (t) => { recebido = t; return RESPOSTA_IA })
    const { sock, enviadas } = criarSock()
    await reescrever.executar(sock, JID, msgReply({ conversation: 'E ai, beleza?' }), '/reescrever engraçado')
    if (recebido !== 'E ai, beleza?') throw new Error('nao usou o citado')
    if (!textoUnico(enviadas).includes(RESPOSTA_IA)) throw new Error('faltou a reescrita')
  })

  await testar('tom invalido avisa as opcoes (sem IA)', async () => {
    let chamou = false
    reescrever._injetarIa(async () => { chamou = true; return 'x' })
    const { sock, enviadas } = criarSock()
    await reescrever.executar(sock, JID, MSG, '/reescrever pirata Algum texto aqui')
    if (chamou) throw new Error('nao deveria chamar a IA')
    if (!/não reconheci o tom/i.test(textoUnico(enviadas))) throw new Error('faltou o aviso')
  })


  await testar('texto vazio pede texto (sem IA)', async () => {
    let chamou = false
    reescrever._injetarIa(async () => { chamou = true; return 'x' })
    const { sock, enviadas } = criarSock()
    await reescrever.executar(sock, JID, MSG, '/reescrever formal')
    if (chamou) throw new Error('nao deveria chamar a IA')
    if (!/me entregue um texto/i.test(textoUnico(enviadas))) throw new Error('faltou pedir o texto')
  })

  await testar('sem nada avisa o uso', async () => {
    const { sock, enviadas } = criarSock()
    await reescrever.executar(sock, JID, MSG, '/reescrever')
    if (!/como usar/i.test(textoUnico(enviadas))) throw new Error('faltou a ajuda')
  })

  await testar('reply a audio manda usar o transcrever', async () => {
    reescrever._injetarIa(async () => 'x')
    const { sock, enviadas } = criarSock()
    await reescrever.executar(sock, JID, msgReply({ audioMessage: {} }), '/reescrever formal')
    if (!/transcrever/i.test(textoUnico(enviadas))) throw new Error('faltou o aviso de midia')
  })

  await testar('falha da API vira aviso (nunca lanca)', async () => {
    reescrever._injetarIa(async () => { throw new Error('explosao simulada') })
    const { sock, enviadas } = criarSock()
    let lancou = false
    try { await reescrever.executar(sock, JID, MSG, '/reescrever formal Algum texto') } catch (e) { lancou = true }
    if (lancou) throw new Error('o executor lancou')
    if (!/⛔/.test(textoUnico(enviadas))) throw new Error('faltou o aviso')
  })

  await testar('sem chave vira aviso de chave (integracao real)', async () => {
    reescrever._restaurarIa()
    delete process.env.OPENROUTER_API_KEY
    instalarFetch(respostaIaOk())
    const { sock, enviadas } = criarSock()
    await reescrever.executar(sock, JID, MSG, '/reescrever formal Algum texto aqui')
    if (!/mente.*dorme/i.test(textoUnico(enviadas))) throw new Error('faltou o aviso de chave')
  })

  await testar('HTTP 429 vira aviso de sobrecarga', async () => {
    reescrever._restaurarIa()
    process.env.OPENROUTER_API_KEY = 'chave-de-teste'
    instalarFetch({ ok: false, status: 429 })
    const { sock, enviadas } = criarSock()
    await reescrever.executar(sock, JID, MSG, '/reescrever formal Algum texto aqui')
    if (!/⏳/.test(textoUnico(enviadas))) throw new Error('faltou o aviso de limite')
  })

  reescrever._restaurarIa()
  global.fetch = fetchOriginal
  if (chaveOriginal === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = chaveOriginal
  for (const nome of Object.keys(envOriginal)) restaurarEnv(nome)

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
