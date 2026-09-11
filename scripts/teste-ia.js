// ============================================================
// teste-ia.js — Valida /gpt e /gemini (mock, sem gastar a Groq)
// ============================================================
// Substitui global.fetch por respostas controladas do endpoint
// https://api.groq.com/openai/v1/chat/completions e verifica
// exports, aviso sem pergunta, sucesso, blocos, sem chave e
// avisos 401/429/rede — em grupo e no privado.
// Uso: node scripts/teste-ia.js
// ============================================================

let modo = 'ok'
let corpoOk = { choices: [{ message: { content: 'Resposta do oraculo.' } }] }
const chamadas = []
const fetchOriginal = global.fetch
global.fetch = async (url, opcoes) => {
  chamadas.push({ url: String(url), corpo: JSON.parse(opcoes.body) })
  if (modo === '401') return { ok: false, status: 401, json: async () => ({}) }
  if (modo === '429') return { ok: false, status: 429, json: async () => ({}) }
  if (modo === 'rede-fora') throw new Error('ENOTFOUND: sem rede')
  return { ok: true, status: 200, json: async () => corpoOk }
}

const gpt = require('../comandos/utilitario/gpt')
const gemini = require('../comandos/utilitario/gemini')

const JID_GRUPO = '120363000000000000@g.us'
const CHAVE_REAL = process.env.GROQ_API_KEY

function criarMsg(texto, jid) {
  return {
    key: { remoteJid: jid, fromMe: false, id: 'M1', participant: '5555000000002@s.whatsapp.net' },
    message: { conversation: texto }
  }
}

function criarSock() {
  const enviadas = []
  return {
    enviadas,
    sock: {
      sendMessage: async (jid, conteudo, extra) => {
        enviadas.push({ jid, conteudo, extra })
        return { key: { id: 'f' + enviadas.length } }
      }
    }
  }
}


async function main() {
  process.env.GROQ_API_KEY = CHAVE_REAL && CHAVE_REAL.trim() ? CHAVE_REAL : 'chave-fake-de-teste'
  let ruins = 0
  const testar = async (nome, fn) => {
    try { await fn(); console.log('OK ' + nome) }
    catch (e) { ruins++; console.log('FALHOU ' + nome + ' -> ' + (e && e.message)) }
  }
  await testar('exports gpt + gemini', async () => {
    if (gpt.nome !== 'gpt') throw new Error('gpt.nome=' + gpt.nome)
    if (JSON.stringify(gpt.aliases) !== JSON.stringify(['chatgpt', 'ia', 'ask'])) throw new Error('gpt.aliases')
    if (gemini.nome !== 'gemini') throw new Error('gemini.nome=' + gemini.nome)
    if (JSON.stringify(gemini.aliases) !== JSON.stringify(['googleia', 'bard'])) throw new Error('gemini.aliases')
    if (gpt.categoria !== 'utilitario' || gemini.categoria !== 'utilitario') throw new Error('categoria')
    if (typeof gpt.executar !== 'function' || typeof gemini.executar !== 'function') throw new Error('sem executar')
  })
  await testar('sem pergunta -> aviso, sem rede', async () => {
    chamadas.length = 0
    const ctx = criarSock()
    await gpt.executar(ctx.sock, JID_GRUPO, criarMsg('/gpt', JID_GRUPO), '/gpt')
    await gemini.executar(ctx.sock, JID_GRUPO, criarMsg('/gemini   ', JID_GRUPO), '/gemini   ')
    if (chamadas.length !== 0) throw new Error('consultou sem pergunta')
    const texto = textoUnico(ctx.enviadas)
    if (!texto || texto.indexOf('Me conte o que deseja saber') < 0) throw new Error('aviso=' + texto)
  })
  await testar('sucesso -> cabecalho + modelos certos', async () => {
    modo = 'ok'
    corpoOk = { choices: [{ message: { content: 'Brasilia e a capital.' } }] }
    chamadas.length = 0
    let ctx = criarSock()
    await gpt.executar(ctx.sock, JID_GRUPO, criarMsg('/gpt capital?', JID_GRUPO), '/gpt capital?')
    let texto = textoUnico(ctx.enviadas)
    if (!texto || texto.indexOf('A MENTE DO LIMBO RESPONDE') < 0) throw new Error('cabecalho gpt=' + texto)
    if (chamadas[0].corpo.model !== 'openai/gpt-oss-20b') throw new Error('modelo gpt=' + chamadas[0].corpo.model)
    if (chamadas[0].corpo.messages[0].role !== 'system') throw new Error('sem system prompt')
    ctx = criarSock()
    await gemini.executar(ctx.sock, JID_GRUPO, criarMsg('/gemini poema?', JID_GRUPO), '/gemini poema?')
    texto = textoUnico(ctx.enviadas)
    if (!texto || texto.indexOf('O ORACULO DO LIMBO RESPONDE') < 0 && texto.indexOf('O ORÁCULO DO LIMBO RESPONDE') < 0) throw new Error('cabecalho gemini=' + texto)
    if (chamadas[1].corpo.model !== 'openai/gpt-oss-120b') throw new Error('modelo gemini=' + chamadas[1].corpo.model)
  })
  await testar('resposta longa -> blocos', async () => {
    modo = 'ok'
    corpoOk = { choices: [{ message: { content: 'Linha sonhada.\n'.repeat(400) } }] }
    const ctx = criarSock()
    await gpt.executar(ctx.sock, JID_GRUPO, criarMsg('/gpt fale muito', JID_GRUPO), '/gpt fale muito')
    if (ctx.enviadas.length < 2) throw new Error('esperava 2+ blocos, houve ' + ctx.enviadas.length)
    if (ctx.enviadas.some((e) => e.conteudo.text.length > 4000)) throw new Error('bloco gigante')
  })
  await testar('sem chave -> mente dorme', async () => {
    process.env.GROQ_API_KEY = ''
    chamadas.length = 0
    const ctx = criarSock()
    await gemini.executar(ctx.sock, JID_GRUPO, criarMsg('/gemini oi?', JID_GRUPO), '/gemini oi?')
    process.env.GROQ_API_KEY = CHAVE_REAL && CHAVE_REAL.trim() ? CHAVE_REAL : 'chave-fake-de-teste'
    if (chamadas.length !== 0) throw new Error('consultou sem chave')
    const texto = textoUnico(ctx.enviadas)
    if (!texto || texto.indexOf('ainda dorme') < 0) throw new Error('aviso=' + texto)
  })
  await testar('401/429/rede -> avisos por tipo (privado)', async () => {
    const privado = '5555000000001@s.whatsapp.net'
    modo = '401'
    let ctx = criarSock()
    await gpt.executar(ctx.sock, privado, criarMsg('/gpt oi?', privado), '/gpt oi?')
    let texto = textoUnico(ctx.enviadas)
    if (!texto || texto.indexOf('ainda dorme') < 0) throw new Error('aviso 401=' + texto)
    modo = '429'
    ctx = criarSock()
    await gemini.executar(ctx.sock, privado, criarMsg('/gemini oi?', privado), '/gemini oi?')
    texto = textoUnico(ctx.enviadas)
    if (!texto || texto.indexOf('sobrecarregada') < 0) throw new Error('aviso 429=' + texto)
    modo = 'rede-fora'
    ctx = criarSock()
    await gpt.executar(ctx.sock, privado, criarMsg('/gpt oi?', privado), '/gpt oi?')
    modo = 'ok'
    texto = textoUnico(ctx.enviadas)
    if (!texto || texto.indexOf('sombras engoliram') < 0) throw new Error('aviso rede=' + texto)
  })
  global.fetch = fetchOriginal
  console.log(ruins === 0 ? 'PASSOU tudo.' : ruins + ' reprovado(s).')
  process.exit(ruins === 0 ? 0 : 1)
}
main()

function textoUnico(enviadas) {
  const textos = enviadas.filter((e) => e.conteudo && e.conteudo.text)
  if (!textos.length) return null
  return textos.map((e) => e.conteudo.text).join('\n---BLOCO---\n')
}
