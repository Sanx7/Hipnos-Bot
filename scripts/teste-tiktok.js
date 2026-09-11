// teste-tiktok.js — Valida o /tiktok (OFFLINE, fetch mockado).
// Uso: node scripts/teste-tiktok.js
let modoApi = 'ok'
let corpoApi = {}
let modoVideo = 'ok'
const urlsChamadas = []
global.fetch = async (url) => {
  const endereco = String(url)
  urlsChamadas.push(endereco)
  if (endereco.indexOf('tikwm.com/api') >= 0) {
    if (modoApi === '500') return { ok: false, status: 500, json: async () => ({}), text: async () => '' }
    if (modoApi === 'rede-fora') throw new Error('ENOTFOUND')
    return { ok: true, status: 200, json: async () => corpoApi }
  }
  if (modoVideo === 'grande') {
    return { ok: true, status: 200, headers: { get: () => String(60 * 1024 * 1024) }, arrayBuffer: async () => Buffer.alloc(10) }
  }
  if (modoVideo === 'falha') return { ok: false, status: 500, headers: { get: () => null }, arrayBuffer: async () => Buffer.alloc(0) }
  if (modoVideo === 'rede-fora') throw new Error('ENOTFOUND')
  return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => Buffer.from([1, 2, 3, 4]) }
}
const comando = require('../comandos/utilitario/tiktok')
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
function ultima(enviadas) {
  return enviadas.length ? enviadas[enviadas.length - 1] : null
}
async function main() {
  let ruins = 0
  const testar = async (nome, fn) => {
    try { await fn(); console.log('OK ' + nome) }
    catch (e) { ruins++; console.log('FALHOU ' + nome + ' -> ' + (e && e.message)) }
  }
  await testar('exports + aliases', async () => {
    if (comando.nome !== 'tiktok') throw new Error('nome=' + comando.nome)
    if (JSON.stringify(comando.aliases) !== JSON.stringify(['tt', 'tk', 'tiktokdl'])) throw new Error('aliases')
    if (comando.categoria !== 'utilitario') throw new Error('categoria')
    if (typeof comando.executar !== 'function') throw new Error('sem executar')
  })
  await testar('link curto vm.tiktok -> video + legenda', async () => {
    modoApi = 'ok'
    corpoApi = { code: 0, data: { play: 'https://cdn/v.mp4', title: 'Danca do sono', author: { nickname: 'sonhador' } } }
    modoVideo = 'ok'
    urlsChamadas.length = 0
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/tiktok https://vm.tiktok.com/ABC123/', JID_GRUPO), '/tiktok https://vm.tiktok.com/ABC123/')
    const e = ultima(ctx.enviadas)
    if (!e || !e.conteudo.video) throw new Error('sem video')
    if (e.conteudo.caption.indexOf('Danca do sono') < 0) throw new Error('titulo')
    if (e.conteudo.caption.indexOf('@sonhador') < 0) throw new Error('autor')
    if (e.conteudo.caption.indexOf('sonho em movimento resgatado das sombras') < 0) throw new Error('frase')
    if (urlsChamadas[0].indexOf('tikwm.com/api/?url=') < 0) throw new Error('URL=' + urlsChamadas[0])
  })
  await testar('code privado -> aviso indisponivel', async () => {
    modoApi = 'ok'
    corpoApi = { code: -1, msg: 'private' }
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_PRIVADO, criarMsg('/tt https://www.tiktok.com/@u/video/1', JID_PRIVADO), '/tt https://www.tiktok.com/@u/video/1')
    modoApi = 'ok'
    const e = ultima(ctx.enviadas)
    if (!e || !e.conteudo.text || e.conteudo.text.indexOf('privado, deletado ou indispon') < 0) throw new Error('aviso=' + (e && e.conteudo.text))
  })
  await testar('video 60MB -> aviso de limite', async () => {
    modoApi = 'ok'
    corpoApi = { code: 0, data: { play: 'https://cdn/v.mp4', title: 'T', author: 'a' } }
    modoVideo = 'grande'
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/tiktok https://vm.tiktok.com/A/', JID_GRUPO), '/tiktok https://vm.tiktok.com/A/')
    modoVideo = 'ok'
    const e = ultima(ctx.enviadas)
    if (!e || !e.conteudo.text || e.conteudo.text.indexOf('50 MB') < 0) throw new Error('aviso=' + (e && e.conteudo.text))
  })
  await testar('sem link -> aviso, sem rede', async () => {
    urlsChamadas.length = 0
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/tiktok', JID_GRUPO), '/tiktok')
    if (urlsChamadas.length !== 0) throw new Error('consultou=' + urlsChamadas.length)
    const e = ultima(ctx.enviadas)
    if (!e || !e.conteudo.text || e.conteudo.text.indexOf('Me mostre o sonho') < 0) throw new Error('aviso ausente')
  })
  await testar('link invalido -> aviso, sem rede', async () => {
    urlsChamadas.length = 0
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/tiktok https://youtube.com/watch?v=abc', JID_GRUPO), '/tiktok https://youtube.com/watch?v=abc')
    if (urlsChamadas.length !== 0) throw new Error('consultou=' + urlsChamadas.length)
    const e = ultima(ctx.enviadas)
    if (!e || !e.conteudo.text || e.conteudo.text.indexOf('link v') < 0) throw new Error('aviso ausente')
  })
  await testar('link longo www.tiktok -> video', async () => {
    modoApi = 'ok'
    corpoApi = { code: 0, data: { play: 'https://cdn/v.mp4', title: 'Longo', author: 'autora' } }
    modoVideo = 'ok'
    const ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/tiktokdl https://www.tiktok.com/@u/video/123', JID_GRUPO), '/tiktokdl https://www.tiktok.com/@u/video/123')
    const e = ultima(ctx.enviadas)
    if (!e || !e.conteudo.video) throw new Error('sem video')
  })
  await testar('500/rede -> amigavel sem propagar', async () => {
    modoApi = '500'
    let ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/tiktok https://vm.tiktok.com/A/', JID_GRUPO), '/tiktok https://vm.tiktok.com/A/')
    let e = ultima(ctx.enviadas)
    if (!e || !e.conteudo.text || e.conteudo.text.indexOf('sombras engoliram') < 0) throw new Error('500=' + (e && e.conteudo.text))
    modoApi = 'rede-fora'
    ctx = criarSock()
    await comando.executar(ctx.sock, JID_GRUPO, criarMsg('/tiktok https://vm.tiktok.com/A/', JID_GRUPO), '/tiktok https://vm.tiktok.com/A/')
    modoApi = 'ok'
    e = ultima(ctx.enviadas)
    if (!e || !e.conteudo.text || e.conteudo.text.indexOf('sombras engoliram') < 0) throw new Error('rede=' + (e && e.conteudo.text))
  })
  console.log(ruins === 0 ? 'PASSOU tudo.' : ruins + ' reprovado(s).')
  process.exit(ruins === 0 ? 0 : 1)
}
main()
