// ============================================
// 🧪 teste-tiktok.js — Valida /tik-tok (cascata toby v1→v2→v3, offline)
// ============================================
// RODA OFFLINE: injeta uma `chamarLib` fake via _injetarLib (mesmo padrão
// dos extras do velha.js) e usa sock mockado. Verifica:
//   - exports (nome/aliases/executar/extras);
//   - extrairLink (regex vm/vt/www, link ausente, link estrangeiro);
//   - extrairUrlResultado nos formatos v1/v2 (playAddr[]) e v3 (videoHD/SD);
//   - cascata: v1 ok não chama v2; v1 falha → v2 assume; tudo falha → erro;
//   - timeout por tentativa (15s configurável — testado com 100ms);
//   - executar sem link → aviso de uso SEM tocar na rede.
// Uso: node scripts/teste-tiktok.js
// ============================================

const path = require('path')
const tiktok = require(path.resolve(__dirname, '..', 'comandos', 'menu-utilitario', 'tiktok'))

// ─── Sock mockado (sendMessage registrador) ───
function criarSock () {
  const enviadas = []
  return {
    enviadas,
    sock: {
      sendMessage: async (jid, conteudo) => {
        enviadas.push({ jid, conteudo })
        return { key: { id: `fake-${enviadas.length}` } }
      }
    }
  }
}

function criarMsg (texto = '/tik-tok') {
  return {
    key: { remoteJid: 'G@g.us', fromMe: false, id: 'MSG', participant: 'A@s.whatsapp.net' },
    message: { conversation: texto }
  }
}

const ultimoTexto = (enviadas) => {
  const e = [...enviadas].reverse().find((x) => x.conteudo?.text)
  return e?.conteudo?.text || null
}

async function main () {
  let reprovadas = 0
  const testar = async (nome, fn) => {
    try {
      await fn()
      console.log(`✅ ${nome}`)
    } catch (err) {
      reprovadas += 1
      console.log(`❌ ${nome}:`, err?.message || err)
    }
  }

  const LINK = 'https://vm.tiktok.com/ZMhq123/'

  await testar('exports do comando', async () => {
    if (tiktok.nome !== 'tiktok') throw new Error(`nome: ${tiktok.nome}`)
    for (const a of ['tt', 'tk', 'tik-tok', 'tiktokdl']) {
      if (!tiktok.aliases.includes(a)) throw new Error(`alias faltando: ${a}`)
    }
    if (typeof tiktok.executar !== 'function') throw new Error('executar não é função')
    if (typeof tiktok.resolverVideo !== 'function' || typeof tiktok.extrairLink !== 'function') {
      throw new Error('extras não expostos')
    }
  })

  await testar('extrairLink: vm/vt/www ok, inválido/ausente -> null', async () => {
    const casos = [
      ['/tik-tok https://vm.tiktok.com/ZMhq123/', 'https://vm.tiktok.com/ZMhq123/'],
      ['/tiktok https://vt.tiktok.com/ZSabc/', 'https://vt.tiktok.com/ZSabc/'],
      ['/tt https://www.tiktok.com/@user/video/123456', 'https://www.tiktok.com/@user/video/123456'],
      ['/tik-tok', null],
      ['/tik-tok https://youtube.com/watch?v=1', null]
    ]
    for (const [texto, esperado] of casos) {
      const r = tiktok.extrairLink(texto)
      if ((r || null) !== (esperado || null)) throw new Error(`"${texto}" → ${r} (esperado ${esperado})`)
    }
  })

  await testar('extrairUrlResultado: v1/v2 (playAddr[]) e v3 (videoHD/SD)', async () => {
    const v2 = { status: 'success', result: { video: { playAddr: ['', 'http://sem-wm.mp4'] }, title: 'Título', author: { nickname: 'Fulano' } } }
    const r2 = tiktok.extrairUrlResultado(v2)
    if (r2?.url !== 'http://sem-wm.mp4' || r2.titulo !== 'Título' || r2.autor !== 'Fulano') throw new Error(`v2: ${JSON.stringify(r2)}`)

    const v3 = { status: 'success', result: { videoHD: 'http://hd.mp4', videoSD: 'http://sd.mp4', videoWatermark: 'http://wm.mp4' } }
    if (tiktok.extrairUrlResultado(v3)?.url !== 'http://hd.mp4') throw new Error('v3 deveria preferir videoHD')

    const soSd = { status: 'success', result: { videoSD: 'http://sd.mp4', videoWatermark: 'http://wm.mp4' } }
    if (tiktok.extrairUrlResultado(soSd)?.url !== 'http://sd.mp4') throw new Error('v3 sem HD deveria usar SD')

    if (tiktok.extrairUrlResultado({ status: 'error', message: 'private' }) !== null) throw new Error('status error deveria dar null')
    if (tiktok.extrairUrlResultado(null) !== null) throw new Error('null deveria dar null')

    // videoWatermark NUNCA é usado, nem sozinho
    const soWm = { status: 'success', result: { videoWatermark: 'http://wm.mp4' } }
    if (tiktok.extrairUrlResultado(soWm) !== null) throw new Error('usou videoWatermark — proibido')
  })

  await testar('cascata: v1 ok não tenta v2', async () => {
    const chamadas = []
    tiktok._injetarLib(async (link, versao) => {
      chamadas.push(versao)
      if (versao === 'v1') return { status: 'success', result: { video: { playAddr: ['http://ok.mp4'] }, title: 'A', author: {} } }
      throw new Error(`não deveria chamar ${versao}`)
    }, 15000)
    const r = await tiktok.resolverVideo(LINK)
    if (r.url !== 'http://ok.mp4' || chamadas.join() !== 'v1') throw new Error(`chamadas: ${chamadas.join()}`)
    tiktok._injetarLib()
  })

  await testar('cascata: v1 e v2 falham -> v3 assume', async () => {
    const chamadas = []
    tiktok._injetarLib(async (link, versao) => {
      chamadas.push(versao)
      if (versao === 'v3') return { status: 'success', result: { videoHD: 'http://v3.mp4' } }
      return { status: 'error', message: 'falhou de propósito' }
    }, 15000)
    const r = await tiktok.resolverVideo(LINK)
    if (r.url !== 'http://v3.mp4' || chamadas.join() !== 'v1,v2,v3') throw new Error(`chamadas: ${chamadas.join()}`)
    tiktok._injetarLib()
  })

  await testar('cascata: tudo falha -> ErroTiktok tipo falha', async () => {
    tiktok._injetarLib(async () => ({ status: 'error', message: 'down' }), 15000)
    let capturado = null
    try { await tiktok.resolverVideo(LINK) } catch (err) { capturado = err }
    if (!capturado || capturado.tipo !== 'falha') throw new Error(`erro: ${capturado}`)
    tiktok._injetarLib()
  })

  await testar('timeout por tentativa (injetado em 100ms)', async () => {
    const t0 = Date.now()
    tiktok._injetarLib(() => new Promise(() => {}), 100) // promessa eterna
    let capturado = null
    try { await tiktok.resolverVideo(LINK) } catch (err) { capturado = err }
    const duracao = Date.now() - t0
    if (!capturado || capturado.tipo !== 'falha') throw new Error(`erro: ${capturado}`)
    if (duracao > 1500) throw new Error(`demorou ${duracao}ms — timeout não respeitado`)
    tiktok._injetarLib()
  })

  await testar('executar sem link: aviso de uso sem tocar na rede', async () => {
    tiktok._injetarLib(() => { throw new Error('NÃO deveria tocar na rede') }, 15000)
    const { sock, enviadas } = criarSock()
    await tiktok.executar(sock, 'G@g.us', criarMsg('/tik-tok'), '/tik-tok')
    const texto = ultimoTexto(enviadas)
    if (!texto || !/Como usar/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
    tiktok._injetarLib()
  })

  await testar('executar com cascata toda falha: erro amigável final', async () => {
    tiktok._injetarLib(async () => ({ status: 'error', message: 'down' }), 15000)
    const { sock, enviadas } = criarSock()
    await tiktok.executar(sock, 'G@g.us', criarMsg('/tik-tok ' + LINK), '/tik-tok ' + LINK)
    const texto = ultimoTexto(enviadas)
    if (!texto || !/Não consegui baixar esse vídeo/i.test(texto)) throw new Error(`aviso final: ${texto}`)
    tiktok._injetarLib()
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
