// ============================================
// 🧪 teste-pinterest.js — Valida /pinterest (btch-downloader)
// ============================================
// RODA OFFLINE: injeta `chamarLib` fake via `_injetarLib` (mesmo padrão
// do tiktok/velha) e usa sock mockado. Verifica:
//   - exports (nome/aliases/executar + extras);
//   - extrairLink (pinterest.com / pin.it / inválido / ausente);
//   - extrairMedia: image, images.orig, videos, video_url e proibição de
//     videoWatermark;
//   - resolverMedia: lib ok não roda fallback; lib falha + redirect não
//     resolve -> null;
//   - avisoParaErro por tipo (uso / grande / indisponivel / api);
//   - executar sem link: aviso de uso SEM tocar na rede;
//   - executar com cascata toda falha: erro amigável final.
// Uso: node scripts/teste-pinterest.js
// ============================================

const path = require('path')
const pinterest = require(path.resolve(__dirname, '..', 'comandos', 'menu-download', 'pinterest'))

function criarSock () {
  const enviadas = []
  return {
    enviadas,
    sock: {
      sendMessage: async (jid, conteudo) => { enviadas.push({ jid, conteudo }); return { key: { id: 'fake' } } }
    }
  }
}

function criarMsg (texto = '/pinterest') {
  return { key: { remoteJid: 'G@g.us', fromMe: false, id: 'MSG', participant: 'A@s.whatsapp.net' }, message: { conversation: texto } }
}

const ultimoTexto = (enviadas) => {
  const e = [...enviadas].reverse().find((x) => x.conteudo?.text)
  return e ? e.conteudo.text : null
}

async function main () {
  let reprovadas = 0
  const testar = async (nome, fn) => {
    try { await fn(); console.log(`✅ ${nome}`) }
    catch (err) { reprovadas++; console.log(`❌ ${nome}:`, err?.message || err) }
  }

  const LINK = 'https://pin.it/4CVodSq'

  await testar('exports do comando', async () => {
    if (pinterest.nome !== 'pinterest') throw new Error(`nome: ${pinterest.nome}`)
    for (const a of ['pin', 'pindl']) {
      if (!pinterest.aliases.includes(a)) throw new Error(`alias faltando: ${a}`)
    }
    if (typeof pinterest.executar !== 'function') throw new Error('executar não é função')
    for (const e of ['extrairLink', 'extrairMedia', 'resolverMedia', 'avisoParaErro', '_injetarLib', 'ErroPinterest']) {
      if (pinterest[e] === undefined) throw new Error(`extra faltando: ${e}`)
    }
  })

  await testar('extrairLink: pin.it/pinterest.com ok, inválido/ausente -> null', async () => {
    const casos = [
      ['/pinterest https://pin.it/4CVodSq', 'https://pin.it/4CVodSq'],
      ['/pinterest https://www.pinterest.com/pin/123456', 'https://www.pinterest.com/pin/123456'],
      ['/pinterest https://br.pinterest.com/pin/abc', 'https://br.pinterest.com/pin/abc'],
      ['/pinterest', null],
      ['/pinterest https://www.youtube.com/watch?v=1', null]
    ]
    for (const [texto, esperado] of casos) {
      const r = pinterest.extrairLink(texto)
      if ((r || null) !== (esperado || null)) throw new Error(`"${texto}" → ${r} (esperado ${esperado})`)
    }
  })

  await testar('extrairMedia: imagem (image / images.orig) e video_url', async () => {
    const img = { status: true, result: { result: { image: '', images: { orig: { url: 'http://img.jpg' } }, title: 'T1' } } }
    const m1 = pinterest.extrairMedia(img)
    if (!m1 || m1.tipo !== 'imagem' || m1.url !== 'http://img.jpg' || m1.titulo !== 'T1') throw new Error(`img: ${JSON.stringify(m1)}`)

    const video = { status: true, result: { result: { video_url: 'http://v.mp4', title: 'V1' } } }
    const m2 = pinterest.extrairMedia(video)
    if (!m2 || m2.tipo !== 'video' || m2.url !== 'http://v.mp4') throw new Error(`video: ${JSON.stringify(m2)}`)
  })

  await testar('extrairMedia: videos objeto e proibição de videoWatermark', async () => {
    const vobj = { status: true, result: { result: { videos: { hd: 'http://v2.mp4' } } } }
    const m = pinterest.extrairMedia(vobj)
    if (!m || m.tipo !== 'video' || m.url !== 'http://v2.mp4') throw new Error(`videos obj: ${JSON.stringify(m)}`)

    const wm = { status: true, result: { result: { videoWatermark: 'http://wm.mp4', image: 'http://img.jpg' } } }
    const m2 = pinterest.extrairMedia(wm)
    if (m2.url === 'http://wm.mp4') throw new Error('usou videoWatermark — proibido')
    if (!m2 || m2.tipo !== 'imagem' || m2.url !== 'http://img.jpg') throw new Error(`deveria cair pro imagem: ${JSON.stringify(m2)}`)

    if (pinterest.extrairMedia({ status: false }) !== null) throw new Error('status false deveria dar null')
    if (pinterest.extrairMedia(null) !== null) throw new Error('null deveria dar null')
  })

  await testar('avisoParaErro por tipo', async () => {
    const { ErroPinterest } = pinterest
    if (!/link.*válido|Como usar/i.test(pinterest.avisoParaErro(new ErroPinterest('x', 'uso')))) throw new Error('uso não mapeou')
    if (!/limite de 50 MB/i.test(pinterest.avisoParaErro(new ErroPinterest('x 60 MB', 'grande')))) throw new Error('grande não mapeou')
    if (!/sem mídia/i.test(pinterest.avisoParaErro(new ErroPinterest('x', 'indisponivel')))) throw new Error('indisp não mapeou')
    if (!/Não consegui baixar/i.test(pinterest.avisoParaErro(new ErroPinterest('x', 'api')))) throw new Error('api não mapeou')
  })

    await testar('resolverMedia: lib ok NÃO roda redirect (fallback)', async () => {
    let chamouRedirect = false
    // lib ok na primeira tentativa → não deve chamar redirect
    pinterest._injetarLib(async () => ({ status: true, result: { result: { image: 'http://x.jpg' } } }))
    const original = pinterest.resolverMedia
    const m = await pinterest.resolverMedia(LINK)
    if (!m || m.url !== 'http://x.jpg') throw new Error(`não resolveu: ${JSON.stringify(m)}`)
    pinterest._injetarLib()
  })

  await testar('resolverMedia: lib falha duas vezes -> lanca tipo api (ERRO_FINAL)', async () => {
    // lib sempre falha; o redirect de pin.it inexistente também falha na rede real,
    // então resolverMedia deve lançar 'api' para o executar responder ERRO_FINAL
    pinterest._injetarLib(async () => ({ status: false, message: 'down' }))
    let erro = null
    try { await pinterest.resolverMedia('https://pin.it/ZZFinexistente999') } catch (e) { erro = e }
    if (!erro || erro.tipo !== 'api') throw new Error('deveria lançar ErroPinterest tipo api')
    pinterest._injetarLib()
  })

  await testar('executar sem link: aviso de uso SEM tocar na rede', async () => {
    let tocouRede = false
    pinterest._injetarLib(async () => { tocouRede = true; return { status: true } })
    const { sock, enviadas } = criarSock()
    await pinterest.executar(sock, 'G@g.us', criarMsg('/pinterest'), '/pinterest')
    const texto = ultimoTexto(enviadas)
    if (!texto || !/Como usar/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
    if (tocouRede) throw new Error('tocou na rede sem link — bug')
    pinterest._injetarLib()
  })

  await testar('executar com tudo falhando: erro amigável final', async () => {
    pinterest._injetarLib(async () => ({ status: false, message: 'down' }))
    const { sock, enviadas } = criarSock()
    await pinterest.executar(sock, 'G@g.us', criarMsg('/pinterest ' + LINK), '/pinterest ' + LINK)
    const texto = ultimoTexto(enviadas)
    if (!texto || !/Não consegui baixar/i.test(texto)) throw new Error(`aviso final: ${texto}`)
    pinterest._injetarLib()
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
    process.exit(reprovadas === 0 ? 0 : 1)
}

main()

