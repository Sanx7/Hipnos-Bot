// teste-dicionario.js — Valida o /dicionario (OFFLINE, fetch mockado).
// Uso: node scripts/teste-dicionario.js
// Fontes atuais: 1) Dicio (www.dicio.com.br HTML) 2) Significados (fallback).
// (A antiga dictionaryapi.dev foi removida do comando: HTTP 522 na origem.)
let modoA = 'ok' // 'ok' | '404' | '500' | 'rede-fora' | 'esquema-quebrado'
let htmlA = ''
let modoB = 'ok'
let htmlB = ''
const urlsChamadas = []
global.fetch = async (url) => {
  const endereco = String(url)
  urlsChamadas.push(endereco)
  const ehA = endereco.indexOf('www.dicio.com.br') >= 0
  const modo = ehA ? modoA : modoB
  const corpo = ehA ? htmlA : htmlB
  if (modo === '404') return { ok: false, status: 404, text: async () => '' }
  if (modo === '500') return { ok: false, status: 500, text: async () => '<html>erro</html>' }
  if (modo === 'rede-fora') {
    const e = new Error('fetch failed')
    e.cause = Object.assign(new Error('getaddrinfo ENOTFOUND host'), { code: 'ENOTFOUND' })
    throw e
  }
  if (modo === 'esquema-quebrado') return { ok: true, status: 200, text: async () => '<html><body>nada aqui</body></html>' }
  return { ok: true, status: 200, text: async () => corpo }
}
const comando = require('../comandos/menu-utilitario/dicionario')
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
// 🟦 HTML real do Dicio (estrutura observada em produção): h1 (com o botão
// de áudio aninhado) + h2.tit-significado + p.significado com spans
// cl/definição/tag/etimologia.
function fakeDicio(defs, classe) {
  const spans = defs.map((d) => '<span>' + d + '</span>').join('')
  return '<!DOCTYPE html><html><body>' +
    '<h1>casa<sg-speech-button text="casa" language="pt-BR" hideicon><img src="/img/btn-audio.svg" alt="Ouvir"></sg-speech-button></h1>' +
    '<h2 class="tit-significado">Significado de Casa</h2>' +
    '<p class="significado textonovo"><span class="cl">' + classe + '</span> ' + spans +
    '<span><span class="tag">[Botânica]</span> def com área de teste.</span>' +
    '<span class="etim">Etimologia (origem da palavra <i>casa</i>). Deriva do latim.</span>' +
    '</p></body></html>'
}
// 🟨 HTML real do Significados (fallback): article > h1.t + parágrafos.
function fakeSignificados(paragrafos) {
  const ps = paragrafos.map((p) => '<p>' + p + '</p>').join('')
  return '<html><body><article class="article" id="js-article">' +
    '<h1 class="t">Casa</h1>' + ps +
    '<p>curto</p></article></body></html>'
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
  await testar('normaliza, codifica e usa a URL do dicio', async () => {
    modoA = 'ok'; htmlA = fakeDicio(['Moradia.'], 'substantivo')
    urlsChamadas.length = 0
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/dicionario   CASA  ', JID_GRUPO), '/dicionario   CASA  ')
    if (!urlsChamadas[0] || urlsChamadas[0].indexOf('www.dicio.com.br/casa/') < 0) throw new Error('URL=' + urlsChamadas[0])
  })
  await testar('sucesso: classe + definições + área + sem etimologia', async () => {
    modoA = 'ok'; htmlA = fakeDicio(['Moradia.', 'Lar.'], 'substantivo')
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/dicionario casa', JID_GRUPO), '/dicionario casa')
    const t = textoUnico(ctx.enviadas)
    if (!t || t.indexOf('substantivo') < 0) throw new Error('classe: ' + t)
    if (!t || t.indexOf('1. Moradia.') < 0) throw new Error('lista: ' + t)
    if (!t || t.indexOf('Botânica') < 0) throw new Error('area: ' + t)
    if (!t || t.indexOf('Etimologia') >= 0) throw new Error('etimologia vazou: ' + t)
  })
  await testar('fallback A->B (dicio 500 -> significados)', async () => {
    modoA = '500'; modoB = 'ok'
    htmlB = fakeSignificados(['Moradia, residência, habitação — conteúdo do verbete do fallback pelo significados em teste.'])
    urlsChamadas.length = 0
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/dicio casa', JID_GRUPO), '/dicio casa')
    modoA = 'ok'; modoB = 'ok'
    const t = textoUnico(ctx.enviadas)
    if (urlsChamadas.length !== 2) throw new Error('consultas=' + urlsChamadas.length)
    if (!t || t.indexOf('residência, habitação') < 0) throw new Error('fallback: ' + t)
  })
  await testar('esquema A quebrado -> cai pro B', async () => {
    modoA = 'esquema-quebrado'; modoB = 'ok'
    htmlB = fakeSignificados(['Conteúdo do verbete pelo significados — parágrafo de teste do fallback com mais de quarenta caracteres.'])
    urlsChamadas.length = 0
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/dicionario casa', JID_GRUPO), '/dicionario casa')
    modoA = 'ok'; modoB = 'ok'
    const t = textoUnico(ctx.enviadas)
    if (urlsChamadas.length !== 2) throw new Error('consultas=' + urlsChamadas.length)
    if (!t || t.indexOf('significados — parágrafo') < 0) throw new Error('fallback: ' + t)
  })
  await testar('esquemas A e B quebrados -> erro amigavel', async () => {
    modoA = 'esquema-quebrado'; modoB = 'esquema-quebrado'
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/dicionario casa', JID_GRUPO), '/dicionario casa')
    modoA = 'ok'; modoB = 'ok'
    const t = textoUnico(ctx.enviadas)
    if (!t || t.indexOf('fora do alcance') < 0) throw new Error('aviso=' + t)
  })
  await testar('muitas defs -> 5 + nota', async () => {
    modoA = 'ok'; htmlA = fakeDicio(['D1.', 'D2.', 'D3.', 'D4.', 'D5.', 'D6.', 'D7.'], 'substantivo')
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/dicionario t', JID_GRUPO), '/dicionario t')
    const t = textoUnico(ctx.enviadas)
    if (!t || t.indexOf('5. D5.') < 0) throw new Error('5a: ' + t)
    if (t.indexOf('D6.') >= 0) throw new Error('6a apareceu')
    // 7 defs + 1 span fixa com área ([Botânica]) do mock = 8 → nota "+3"
    if (t.indexOf('+3 nos pergaminhos') < 0) throw new Error('nota: ' + t)
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
