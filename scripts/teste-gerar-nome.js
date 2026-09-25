// ============================================
// 🧪 teste-gerar-nome.js — Valida o /gerar-nome (IA do Limbo)
// ============================================
// RODA 100% OFFLINE: nenhuma requisição de rede é feita.
// O núcleo de IA é injetado com _injetarIa() na maioria dos casos e,
// nos testes de integração, usa _restaurarIa() + fetch simulado p/ exercitar
// o código REAL (montagem do body, 401/429/vazio/abort).
// Provedor: Groq (mesmo client do RPG/ia-interativa e do /gpt).
// Verifica: exports, prompt fixo, limpeza da lista da IA, tema vazio,
// geração válida (5 nomes numerados), tema truncado e erros de API.
// Uso: node scripts/teste-gerar-nome.js
// ============================================

const gerarNome = require('../comandos/menu-brincadeiras/gerar-nome')

const JID = '120363000000000000@g.us'
const MSG = { key: { remoteJid: JID, fromMe: false, id: 'MSG' }, message: { conversation: '/gerar-nome' } }
const LISTA_IA = 'Sentinela do Vazio\nCripta de Eldoria\nOrdem do Eclipse\nGuardiões do Abismo\nCoroa de Cinzas'

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

const respostaIaOk = (conteudo = LISTA_IA) => ({ json: { choices: [{ message: { content: conteudo } }] } })
const fetchOriginal = global.fetch
const chaveOriginal = process.env.GROQ_API_KEY
const envOriginal = { GROQ_MODEL_GERARNOME: process.env.GROQ_MODEL_GERARNOME, GROQ_MODEL: process.env.GROQ_MODEL }

function restaurarEnv (nome) {
  if (envOriginal[nome] === undefined) delete process.env[nome]
  else process.env[nome] = envOriginal[nome]
}

async function main () {
  await testar('exports: nome, aliases, categoria e ganchos', async () => {
    if (gerarNome.nome !== 'gerar-nome') throw new Error('nome: ' + gerarNome.nome)
    if (!gerarNome.aliases?.includes('gerarnome')) throw new Error('alias gerarnome ausente')
    if (typeof gerarNome.executar !== 'function') throw new Error('sem executar')
    const i = gerarNome.__internos
    if (i.URL_GROQ_CHAT !== 'https://api.groq.com/openai/v1/chat/completions') throw new Error('url errada: ' + i.URL_GROQ_CHAT)
    if (i.QUANTIDADE !== 5) throw new Error('quantidade: ' + i.QUANTIDADE)
  })

  await testar('modelo: env propria > GROQ_MODEL > padrao', async () => {
    const { modeloGerarNome } = gerarNome.__internos
    try {
      delete process.env.GROQ_MODEL_GERARNOME
      delete process.env.GROQ_MODEL
      if (modeloGerarNome() !== gerarNome.__internos.MODELO_PADRAO) throw new Error('padrao errado')
      process.env.GROQ_MODEL = 'modelo-compartilhado'
      if (modeloGerarNome() !== 'modelo-compartilhado') throw new Error('ignorou GROQ_MODEL')
      process.env.GROQ_MODEL_GERARNOME = 'modelo-proprio'
      if (modeloGerarNome() !== 'modelo-proprio') throw new Error('ignorou GROQ_MODEL_GERARNOME')
    } finally {
      restaurarEnv('GROQ_MODEL')
      restaurarEnv('GROQ_MODEL_GERARNOME')
    }
  })

  await testar('prompt fixo: 5 nomes, sem repeticao de estilo, so a lista', async () => {
    const p = gerarNome.__internos.promptPara('rpg fantasia')
    if (!/5 nomes/.test(p)) throw new Error('pediu outra quantidade')
    if (!/rpg fantasia/.test(p)) throw new Error('tema ausente')
    if (!/estilos bem diferentes/i.test(p)) throw new Error('pediu variedade de estilo')
    if (!/SOMENTE com a lista/i.test(p)) throw new Error('pediu lista sem explicação')
  })

  await testar('tema vazio mostra o uso (sem chamar a IA)', async () => {
    let chamou = false
    gerarNome._injetarIa(async () => { chamou = true; return LISTA_IA })
    const { sock, enviadas } = criarSock()
    await gerarNome.executar(sock, JID, MSG, '/gerar-nome')
    if (chamou) throw new Error('nao deveria chamar a IA')
    if (!/me diga o tema/i.test(textoUnico(enviadas))) throw new Error('faltou a ajuda')
  })

  await testar('tema so com espacos tambem mostra o uso', async () => {
    let chamou = false
    gerarNome._injetarIa(async () => { chamou = true; return LISTA_IA })
    const { sock, enviadas } = criarSock()
    await gerarNome.executar(sock, JID, MSG, '/gerar-nome    ')
    if (chamou) throw new Error('nao deveria chamar a IA')
    if (!/me diga o tema/i.test(textoUnico(enviadas))) throw new Error('faltou a ajuda')
  })

  await testar('tema livre em texto chega inteiro na IA', async () => {
    let recebido = ''
    gerarNome._injetarIa(async (tema) => { recebido = tema; return LISTA_IA })
    const { sock, enviadas } = criarSock()
    await gerarNome.executar(sock, JID, MSG, '/gerar-nome nome engraçado pra grupo do whatsapp')
    if (recebido !== 'nome engraçado pra grupo do whatsapp') throw new Error('tema cortado: ' + recebido)
    const t = textoUnico(enviadas)
    if (!/Tema: \*nome engraçado pra grupo do whatsapp\*/.test(t)) throw new Error('faltou o tema no cabecalho')
  })

  await testar('geracao valida: 5 nomes numerados', async () => {
    gerarNome._injetarIa(async () => LISTA_IA)
    const { sock, enviadas } = criarSock()
    await gerarNome.executar(sock, JID, MSG, '/gerar-nome rpg fantasia')
    const t = textoUnico(enviadas)
    for (let i = 1; i <= 5; i++) if (!new RegExp(`\\*${i}\\)\\*`).test(t)) throw new Error('faltou o item ' + i)
    if (!/Sentinela do Vazio/.test(t)) throw new Error('faltou o 1º nome')
    if (!/Coroa de Cinzas/.test(t)) throw new Error('faltou o 5º nome')
  })

  await testar('limpeza: numeracao/bullets/aspas da IA sao removidos', async () => {
    const { limparSugestoes } = gerarNome.__internos
    const nomes = limparSugestoes('1. Alfa\n2) Beta\n- Gama\n• Delta\n"Êpsilon"')
    if (nomes.length !== 5) throw new Error('veio ' + nomes.length)
    if (nomes.join('|') !== 'Alfa|Beta|Gama|Delta|Êpsilon') throw new Error('saida: ' + nomes.join('|'))
  })

  await testar('limpeza: corta em 5 e remove repetidos', async () => {
    const { limparSugestoes } = gerarNome.__internos
    const nomes = limparSugestoes('Um\nDois\nUm\nTres\nQuatro\nCinco\nSeis')
    if (nomes.length !== 5) throw new Error('veio ' + nomes.length)
    if (nomes[2] !== 'Tres') throw new Error('repetido ficou: ' + nomes[2])
  })

  await testar('resposta vazia da IA vira aviso (nunca lanca)', async () => {
    gerarNome._injetarIa(async () => '')
    const { sock, enviadas } = criarSock()
    let lancou = false
    try { await gerarNome.executar(sock, JID, MSG, '/gerar-nome banda de rock') } catch { lancou = true }
    if (lancou) throw new Error('o executor lancou')
    if (!/⛔/.test(textoUnico(enviadas))) throw new Error('faltou o aviso')
  })

  await testar('falha da API vira aviso (nunca lanca)', async () => {
    gerarNome._injetarIa(async () => { throw new Error('explosao simulada') })
    const { sock, enviadas } = criarSock()
    let lancou = false
    try { await gerarNome.executar(sock, JID, MSG, '/gerar-nome time de futebol') } catch { lancou = true }
    if (lancou) throw new Error('o executor lancou')
    if (!/⛔/.test(textoUnico(enviadas))) throw new Error('faltou o aviso')
  })

  await testar('sock quebrado nao derruba o processo', async () => {
    gerarNome._injetarIa(async () => { throw new Error('api fora') })
    const quebrado = { sendMessage: async () => { throw new Error('conexao perdida') } }
    let lancou = false
    try { await gerarNome.executar(quebrado, JID, MSG, '/gerar-nome rpg') } catch { lancou = true }
    if (lancou) throw new Error('vazou excecao')
  })

  await testar('tema muito longo e truncado com aviso', async () => {
    let recebido = ''
    gerarNome._injetarIa(async (tema) => { recebido = tema; return LISTA_IA })
    const { sock, enviadas } = criarSock()
    await gerarNome.executar(sock, JID, MSG, '/gerar-nome ' + 'a'.repeat(500))
    if (recebido.length !== gerarNome.__internos.LIMITE_TEMA) throw new Error('tema nao truncado: ' + recebido.length)
    if (!/Aviso/.test(textoUnico(enviadas))) throw new Error('faltou o aviso de corte')
  })

  await testar('integracao real sem chave vira aviso de chave', async () => {
    gerarNome._restaurarIa()
    delete process.env.GROQ_API_KEY
    instalarFetch(respostaIaOk())
    const { sock, enviadas } = criarSock()
    await gerarNome.executar(sock, JID, MSG, '/gerar-nome rpg fantasia')
    if (!/mente.*dorme/i.test(textoUnico(enviadas))) throw new Error('faltou o aviso de chave')
  })

  await testar('integracao real HTTP 429 vira aviso de sobrecarga', async () => {
    gerarNome._restaurarIa()
    process.env.GROQ_API_KEY = 'chave-de-teste'
    instalarFetch({ ok: false, status: 429 })
    const { sock, enviadas } = criarSock()
    await gerarNome.executar(sock, JID, MSG, '/gerar-nome banda de rock')
    if (!/⏳/.test(textoUnico(enviadas))) throw new Error('faltou o aviso de limite')
  })

  await testar('integracao real monta o body e envia os 5 nomes', async () => {
    gerarNome._restaurarIa()
    process.env.GROQ_API_KEY = 'chave-de-teste'
    let corpo = null
    instalarFetch((url, opcoes) => {
      corpo = JSON.parse(opcoes.body)
      return Promise.resolve({ ok: true, status: 200, async json () { return respostaIaOk().json } })
    })
    const { sock, enviadas } = criarSock()
    await gerarNome.executar(sock, JID, MSG, '/gerar-nome time de futebol')
    if (!corpo) throw new Error('fetch nao chamado')
    if (corpo.model !== gerarNome.__internos.MODELO_PADRAO) throw new Error('modelo: ' + corpo.model)
    if (corpo.messages[0].role !== 'system') throw new Error('sem system prompt')
    if (!/time de futebol/.test(corpo.messages[1].content)) throw new Error('tema nao foi no user')
    const t = textoUnico(enviadas)
    if (!/Ordem do Eclipse/.test(t)) throw new Error('faltou a lista real')
  })

  await testar('integracao real: timeout vira aviso de sobrecarga', async () => {
    gerarNome._restaurarIa()
    process.env.GROQ_API_KEY = 'chave-de-teste'
    instalarFetch(() => {
      const err = new Error('abortado')
      err.name = 'AbortError'
      return Promise.reject(err)
    })
    const { sock, enviadas } = criarSock()
    await gerarNome.executar(sock, JID, MSG, '/gerar-nome rpg')
    if (!/⏳/.test(textoUnico(enviadas))) throw new Error('faltou o aviso de timeout')
  })

  gerarNome._restaurarIa()
  global.fetch = fetchOriginal
  if (chaveOriginal === undefined) delete process.env.GROQ_API_KEY
  else process.env.GROQ_API_KEY = chaveOriginal
  for (const nome of Object.keys(envOriginal)) restaurarEnv(nome)

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
