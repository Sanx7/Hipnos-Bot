// teste-dicionario.js — Valida o /dicionario (OFFLINE, fetch mockado).
// Uso: node scripts/teste-dicionario.js
let modoA = 'ok'
let corpoA = []
let modoB = 'ok'
let corpoB = {}
const urlsChamadas = []
global.fetch = async (url) => {
  const endereco = String(url)
  urlsChamadas.push(endereco)
  const ehA = endereco.indexOf('dictionaryapi.dev') >= 0
  const modo = ehA ? modoA : modoB
  const corpo = ehA ? corpoA : corpoB
  if (modo === '404') return { ok: false, status: 404, text: async () => '{}' }
  if (modo === '500') return { ok: false, status: 500, text: async () => '<html>erro</html>' }
  if (modo === 'rede-fora') throw new Error('ENOTFOUND')
  return { ok: true, status: 200, text: async () => JSON.stringify(corpo) }
}
const comando = require('../comandos/utilitario/dicionario')
const JID_GRUPO = '120363000000000000@g.us'
const JID_PRIVADO = '5555000000001@s.whatsapp.net'
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

function textoUnico(enviadas) {
  const t = enviadas.filter((e) => e.conteudo && e.conteudo.text)
  return t.length === 1 ? t[0].conteudo.text : null
}
function fakeA(defs, classe) {
  return [{ word: 'casa', meanings: [{ partOfSpeech: classe || 'noun', definitions: defs.map((d) => ({ definition: d })) }] }]
}
async function main() {
  let ruins = 0
  const testar = async (nome, fn) => {
    try { await fn(); console.log('OK ' + nome) }
    catch (e) { ruins++; console.log('FALHOU ' + nome + ' -> ' + (e && e.message)) }
  }
  await testar('exports + aliases', async () => {
    if (comando.nome !== 'dicionario') throw new Error('nome=' + comando.nome)
    if (JSON.stringify(comando.aliases) !== JSON.stringify(['significado', 'dicio', 'definicao'])) throw new Error('aliases')
    if (comando.categoria !== 'utilitario') throw new Error('categoria')
    if (typeof comando.executar !== 'function') throw new Error('sem executar')
  })
  await testar('sem palavra -> aviso, sem rede', async () => {
    urlsChamadas.length = 0
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/dicionario', JID_GRUPO), '/dicionario')
    if (urlsChamadas.length !== 0) throw new Error('consultou')
    const t = textoUnico(ctx.enviadas)
    if (!t || t.indexOf('Me diga qual palavra') < 0) throw new Error('aviso=' + t)
  })
  await testar('normaliza e codifica URL', async () => {
    modoA = 'ok'; corpoA = fakeA(['Moradia.'])
    urlsChamadas.length = 0
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/dicionario   CASA  ', JID_GRUPO), '/dicionario   CASA  ')
    if (!urlsChamadas[0] || urlsChamadas[0].indexOf('/pt/casa') < 0) throw new Error('URL=' + urlsChamadas[0])
  })
  await testar('sucesso: classe + lista', async () => {
    modoA = 'ok'; corpoA = fakeA(['Moradia.', 'Lar.'], 'noun')
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/dicionario casa', JID_GRUPO), '/dicionario casa')
    const t = textoUnico(ctx.enviadas)
    if (!t || t.indexOf('substantivo') < 0) throw new Error('classe: ' + t)
    if (!t || t.indexOf('1. Moradia.') < 0) throw new Error('lista: ' + t)
  })
  await testar('fallback A->B', async () => {
    modoA = '500'; modoB = 'ok'
    corpoB = { palavra: 'casa', definicoes: ['Moradia pelo dicio.'] }
    urlsChamadas.length = 0
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/dicio casa', JID_GRUPO), '/dicio casa')
    modoA = 'ok'; modoB = 'ok'
    const t = textoUnico(ctx.enviadas)
    if (urlsChamadas.length !== 2) throw new Error('consultas=' + urlsChamadas.length)
    if (!t || t.indexOf('Moradia pelo dicio.') < 0) throw new Error('fallback: ' + t)
  })
  await testar('7 defs -> 5 + nota', async () => {
    modoA = 'ok'; corpoA = fakeA(['D1.', 'D2.', 'D3.', 'D4.', 'D5.', 'D6.', 'D7.'])
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/dicionario t', JID_GRUPO), '/dicionario t')
    const t = textoUnico(ctx.enviadas)
    if (!t || t.indexOf('5. D5.') < 0) throw new Error('5a: ' + t)
    if (t.indexOf('D6.') >= 0) throw new Error('6a apareceu')
    if (t.indexOf('+2 nos pergaminhos') < 0) throw new Error('nota: ' + t)
  })
  await testar('404 duplo -> nao existe', async () => {
    modoA = '404'; modoB = '404'
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/dicionario zzz', JID_GRUPO), '/dicionario zzz')
    modoA = 'ok'; modoB = 'ok'
    const t = textoUnico(ctx.enviadas)
    if (!t || t.indexOf('pergaminhos do Limbo') < 0) throw new Error('aviso=' + t)
  })
  await testar('500/rede -> amigavel (privado)', async () => {
    modoA = '500'; modoB = '500'
    let ctx = criarSock()
    await comando.executar(ctx.sock, JID_PRIVADO, criarMsg('/dicionario casa', JID_PRIVADO), '/dicionario casa')
    let t = textoUnico(ctx.enviadas)
    if (!t || t.indexOf('fora do alcance') < 0) throw new Error('500=' + t)
    modoA = 'rede-fora'; modoB = 'rede-fora'
    ctx = criarSock()
    await comando.executar(ctx.sock, JID_PRIVADO, criarMsg('/dicionario casa', JID_PRIVADO), '/dicionario casa')
    modoA = 'ok'; modoB = 'ok'
    t = textoUnico(ctx.enviadas)
    if (!t || t.indexOf('fora do alcance') < 0) throw new Error('rede=' + t)
  })
  console.log(ruins === 0 ? 'PASSOU tudo.' : ruins + ' reprovado(s).')
  process.exit(ruins === 0 ? 0 : 1)
}
main()
