// =============================================================
// 🧪 teste-downloads-extra.js — valida a leva nova de downloads
// =============================================================
// Cobre: comandos/menu-download/downloads-extra.js (5 comandos:
// insta, igmp3, twitter, facebook, robloxstalk) e
// comandos/menu-download/video-velocidade.js (videorapido,
// videolento, videocontrario).
// RODA OFFLINE: injeta mocks via _injetar (fontes btch, axios e
// Roblox; baixarMidia e rodarFfmpeg dos vídeos) + sock mockado.
// Verifica:
//   - exports (nome/aliases/executar + extras) dos 8 comandos;
//   - regex: link válido, domínio errado e malformado;
//   - parsers igdl/twitter/fbdown (formatos da sonda real);
//   - executar SEM link -> aviso de uso sem tocar na rede;
//   - executar com domínio errado -> aviso de domínio sem rede;
//   - executar com fonte falhando -> erro amigável final;
//   - executar com timeout -> aviso "demorou demais";
//   - executar com arquivo gigante -> aviso de limite 50MB;
//   - robloxstalk: encontrado (perfil+avatar) e inexistente;
//   - vídeo: sem reply, reply não-vídeo, vídeo longo (60s) e
//     caminho feliz (reply válido -> vídeo processado saído).
// Uso: node scripts/teste-downloads-extra.js
// =============================================================

const path = require('path')
const fs = require('fs')
const os = require('os')
const { Readable } = require('stream')
const assert = require('node:assert/strict')
const { execFileSync } = require('child_process')
const dl = require(path.resolve(__dirname, '..', 'comandos', 'menu-download', 'downloads-extra'))
const vel = require(path.resolve(__dirname, '..', 'comandos', 'menu-download', 'video-velocidade'))

function criarSock () {
  const enviadas = []
  return {
    enviadas,
    sock: {
      sendMessage: async (jid, conteudo) => { enviadas.push({ jid, conteudo }); return { key: { id: 'fake' } } }
    }
  }
}

function criarMsg (texto = '/insta') {
  return { key: { remoteJid: 'G@g.us', fromMe: false, id: 'MSG', participant: 'A@s.whatsapp.net' }, message: { conversation: texto } }
}

function criarMsgReplyVideo (texto, segundos) {
  return {
    key: { remoteJid: 'G@g.us', fromMe: false, id: 'MSG2', participant: 'A@s.whatsapp.net' },
    message: { extendedTextMessage: { text: texto, contextInfo: { quotedMessage: { videoMessage: { seconds: segundos, mimetype: 'video/mp4', fileLength: 1024 } } } } }
  }
}

const ultimoTexto = (enviadas) => {
  const e = [...enviadas].reverse().find((x) => x.conteudo?.text)
  return e ? e.conteudo.text : null
}

const ultimoVideo = (enviadas) => {
  const e = [...enviadas].reverse().find((x) => x.conteudo?.video)
  return e ? e.conteudo : null
}

async function testarClassificacaoInsta (testar, link) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'hipnos-insta-tipos-'))
  const mp4 = path.join(pasta, 'video.mp4')
  const jpg = path.join(pasta, 'foto.jpg')
  try {
    const ffmpeg = require('@ffmpeg-installer/ffmpeg').path
    execFileSync(ffmpeg, [
      '-y', '-nostdin', '-f', 'lavfi', '-i', 'color=c=black:s=720x1280:d=0.3',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=0.3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-shortest', mp4
    ], { stdio: 'pipe', windowsHide: true })
    execFileSync(ffmpeg, ['-y', '-nostdin', '-f', 'lavfi', '-i', 'color=c=black:s=32x32', '-frames:v', '1', jpg], { stdio: 'pipe', windowsHide: true })
    const video = fs.readFileSync(mp4)
    const imagem = fs.readFileSync(jpg)
    const rapid = 'https://d.rapidcdn.app/v2?token=teste'
    const casos = [
      { nome: 'URL .mp4 → vídeo', url: 'https://cdn.test/video.mp4', buffer: video, esperado: 'video' },
      { nome: 'sem extensão, Content-Type video/mp4 → vídeo', url: rapid, buffer: video, contentType: 'video/mp4; charset=binary', esperado: 'video' },
      { nome: 'sem extensão, API video/mp4 e octet-stream → vídeo', url: rapid, type: 'video/mp4', buffer: video, contentType: 'application/octet-stream', esperado: 'video' },
      { nome: 'rapidcdn.app/v2, octet-stream, API só url/thumbnail, MP4 real → video NUNCA image', url: rapid, buffer: video, contentType: 'application/octet-stream', esperado: 'video' },
      { nome: 'sem extensão, Content-Type JPEG → imagem', url: rapid, buffer: imagem, contentType: 'image/jpeg', esperado: 'image' },
      { nome: 'sem extensão, octet-stream com assinatura JPEG → imagem', url: rapid, buffer: imagem, contentType: 'application/octet-stream', esperado: 'image' },
      { nome: 'Content-Type JPEG prevalece sobre extensão .mp4', url: 'https://cdn.test/foto.mp4', buffer: imagem, contentType: 'image/jpeg', esperado: 'image' },
      { nome: 'assinatura JPEG prevalece sobre extensão .mp4', url: 'https://cdn.test/foto.mp4', buffer: imagem, contentType: 'application/octet-stream', esperado: 'image' },
      { nome: 'HTML rejeitado mesmo com API vídeo e URL .mp4', url: 'https://cdn.test/video.mp4', type: 'video', buffer: Buffer.from('<!DOCTYPE html><html>Erro</html>'), contentType: 'text/html', esperado: 'erro' },
      { nome: 'JSON de erro rejeitado', url: rapid, type: 'video', buffer: Buffer.from('{"error":"forbidden"}'), contentType: 'application/json', esperado: 'erro' },
      { nome: 'HTML disfarçado de octet-stream rejeitado', url: rapid, type: 'video', buffer: Buffer.from('  <html>Erro</html>'), contentType: 'application/octet-stream', esperado: 'erro' },
      { nome: 'JSON disfarçado de video/mp4 rejeitado', url: rapid, type: 'video', buffer: Buffer.from('{"error":"forbidden"}'), contentType: 'video/mp4', esperado: 'erro' },
      { nome: 'octet-stream desconhecido sem extensão não vira imagem', url: rapid, buffer: Buffer.from('dados desconhecidos'), contentType: 'application/octet-stream', esperado: 'erro' },
      { nome: 'legenda original preservada, vídeo sem recodificação', url: rapid, buffer: video, caption: 'Minha legenda original 🎬', contentType: 'application/octet-stream', esperado: 'video' }
    ]
    for (const caso of casos) {
      await testar(`/insta: ${caso.nome}`, async () => {
        let stream
        dl._injetar({
          igdl: async () => ({ status: true, result: [{ url: caso.url, thumbnail: 'thumb', type: caso.type, caption: caso.caption }] }),
          baixarHttp: async () => {
            stream = Readable.from([caso.buffer])
            return { headers: { 'content-type': caso.contentType, 'content-length': String(caso.buffer.length) }, data: stream }
          }
        })
        const { sock, enviadas } = criarSock()
        await dl.find((c) => c.nome === 'insta').executar(sock, 'G@g.us', criarMsg(`/insta ${link}`), `/insta ${link}`)
        const midias = enviadas.filter((e) => e.conteudo.video || e.conteudo.image)
        assert.ok(stream.destroyed, 'stream deve ser fechado inclusive na recusa')
        if (caso.esperado === 'erro') {
          assert.equal(midias.length, 0, 'não pode enviar HTML/JSON/dados desconhecidos como mídia')
          assert.match(ultimoTexto(enviadas), /Não consegui baixar/)
        } else {
          assert.equal(midias.length, 1)
          const conteudo = midias[0].conteudo
          assert.deepEqual(conteudo[caso.esperado], caso.buffer, 'envia os bytes originais, sem recodificar')
          assert.equal(conteudo[caso.esperado === 'video' ? 'image' : 'video'], undefined)
          if (caso.esperado === 'video') assert.equal(conteudo.mimetype, 'video/mp4')
          if (caso.caption) assert.equal(conteudo.caption, caso.caption)
        }
      })
    }
  } finally {
    for (const arquivo of [mp4, jpg]) if (fs.existsSync(arquivo)) fs.unlinkSync(arquivo)
    fs.rmdirSync(pasta)
  }
}


async function main () {
  let reprovadas = 0
  const testar = async (nome, fn) => {
    try { await fn(); console.log(`✅ ${nome}`) }
    catch (err) { reprovadas++; console.log(`❌ ${nome}:`, err?.message || err) }
  }

  const LINK_INSTA = 'https://www.instagram.com/reel/ABC123/'
  const LINK_X = 'https://x.com/user/status/123456?s=20'
  const LINK_FB = 'https://www.facebook.com/watch/?v=99'

  await testar('exports dos 5 comandos de link', async () => {
    if (dl.length !== 5) throw new Error(`esperava 5, veio ${dl.length}`)
    const nomes = dl.map((c) => c.nome).join(',')
    for (const n of ['insta', 'igmp3', 'twitter', 'facebook', 'robloxstalk']) {
      if (!nomes.includes(n)) throw new Error(`comando faltando: ${n}`)
    }
    for (const c of dl) if (typeof c.executar !== 'function') throw new Error(`${c.nome} sem executar`)
    for (const e of ['extrairLink', 'parseIgdl', 'parseTwitter', 'parseFbdown', 'resolverInsta', 'resolverTwitter', 'resolverFacebook', 'resolverRoblox', 'baixarComLimite', 'enviarMidia', 'ErroDownloadExtra', 'LIMITE_MB', 'REGEX_INSTA', 'REGEX_TWITTER', 'REGEX_FACEBOOK', 'AVISO', '_injetar']) {
      if (dl[e] === undefined) throw new Error(`extra faltando: ${e}`)
    }
  })

  await testar('exports dos 3 comandos de velocidade', async () => {
    if (vel.length !== 3) throw new Error(`esperava 3, veio ${vel.length}`)
    const nomes = vel.map((c) => c.nome).join(',')
    for (const n of ['videorapido', 'videolento', 'videocontrario']) {
      if (!nomes.includes(n)) throw new Error(`comando faltando: ${n}`)
    }
    for (const c of vel) if (typeof c.executar !== 'function') throw new Error(`${c.nome} sem executar`)
    if (vel.LIMITE_SEGUNDOS !== 60) throw new Error(`limite de duração: ${vel.LIMITE_SEGUNDOS}`)
    if (typeof vel._injetar !== 'function') throw new Error('_injetar faltando')
  })

  await testar('submenu menu-download exporta executar', async () => {
    const menu = require(path.resolve(__dirname, '..', 'comandos', 'menu-download', 'menu-download'))
    if (menu.nome !== 'menu-download') throw new Error(`nome: ${menu.nome}`)
    for (const a of ['menudownload', 'menu-downloads', 'downloads']) {
      if (!menu.aliases.includes(a)) throw new Error(`alias faltando: ${a}`)
    }
    if (typeof menu.executar !== 'function') throw new Error('executar não é função')
    const { sock, enviadas } = criarSock()
    await menu.executar(sock, 'G@g.us', criarMsg('/menu-download'))
    const texto = ultimoTexto(enviadas)
    if (!texto || !texto.includes("𝐌𝐄𝐍𝐔 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃")) throw new Error('menu sem título')
    for (const esperado of ['/insta', '/igmp3', '/twitter', '/facebook', '/robloxstalk', '/videorapido', '/videolento', '/videocontrario', '/tiktok', '/pinterest', '/play']) {
      if (!texto.includes(esperado)) throw new Error(`menu sem ${esperado}`)
    }
  })

  await testar('regex: link válido, domínio errado e malformado', async () => {
    const casos = [
      [dl.REGEX_INSTA, LINK_INSTA, true],
      [dl.REGEX_INSTA, 'https://www.instagram.com/p/XYZ/', true],
      [dl.REGEX_INSTA, 'https://x.com/user/status/1', false],
      [dl.REGEX_INSTA, 'https://www.instagram.com/', false],
      [dl.REGEX_TWITTER, 'https://twitter.com/u/status/123', true],
      [dl.REGEX_TWITTER, LINK_X, true],
      [dl.REGEX_TWITTER, 'https://www.instagram.com/reel/ABC/', false],
      [dl.REGEX_FACEBOOK, LINK_FB, true],
      [dl.REGEX_FACEBOOK, 'https://fb.watch/abc/', true],
      [dl.REGEX_FACEBOOK, 'https://x.com/u/status/1', false]
    ]
    for (const [re, texto, esperado] of casos) {
      const bate = re.test(texto)
      if (bate !== esperado) throw new Error(`${re} × ${texto} -> ${bate} (esperado ${esperado})`)
    }
  })

// http mock: devolve stream com `tamanho` bytes (ou header gigante)
function httpMock (tamanho, opts) {
  return async (url) => ({
    headers: { 'content-length': String(opts?.headerGigante || tamanho) },
    data: Readable.from([Buffer.alloc(tamanho, 65)])
  })
}

  await testar('parsers: igdl (foto/video), twitter (hd/sd), fbdown (HD/Normal)', async () => {
    const ig = dl.parseIgdl({ status: true, result: [{ thumbnail: 't', url: 'https://cdn.x/f.mp4' }] })
    if (!ig || ig.length !== 1 || ig[0].url !== 'https://cdn.x/f.mp4') throw new Error(`igdl: ${JSON.stringify(ig)}`)
    if (dl.parseIgdl({ status: false }) !== null) throw new Error('igdl status false deveria dar null')
    if (dl.parseIgdl({ status: true, result: [] }) !== null) throw new Error('igdl vazio deveria dar null')

    const tw = dl.parseTwitter({ status: true, title: 'Titulo', url: [{ hd: 'https://v/hd.mp4' }, { sd: 'https://v/sd.mp4' }] })
    if (!tw || tw.url !== 'https://v/hd.mp4' || tw.titulo !== 'Titulo') throw new Error(`twitter arr: ${JSON.stringify(tw)}`)
    const twStr = dl.parseTwitter({ status: true, url: 'https://v/unico.mp4' })
    if (!twStr || twStr.url !== 'https://v/unico.mp4') throw new Error(`twitter str: ${JSON.stringify(twStr)}`)
    if (dl.parseTwitter({ status: false }) !== null) throw new Error('twitter status false deveria dar null')

    const fb1 = dl.parseFbdown({ status: true, HD: 'https://v/hd.mp4', Normal_video: 'https://v/sd.mp4' })
    if (!fb1 || fb1.url !== 'https://v/hd.mp4') throw new Error(`fbdown HD: ${JSON.stringify(fb1)}`)
    const fb2 = dl.parseFbdown({ status: true, Normal_video: 'https://v/sd.mp4' })
    if (!fb2 || fb2.url !== 'https://v/sd.mp4') throw new Error(`fbdown normal: ${JSON.stringify(fb2)}`)
    if (dl.parseFbdown({ status: false }) !== null) throw new Error('fbdown status false deveria dar null')
  })

  await testar('resolverInsta: fonte ok -> itens; fonte caindo -> erro apos 2 tentativas', async () => {
    dl._injetar({ igdl: async () => ({ status: true, result: [{ url: 'https://cdn.x/a.mp4' }] }) })
    const itens = await dl.resolverInsta(LINK_INSTA)
    if (!itens || itens[0].url !== 'https://cdn.x/a.mp4') throw new Error(`ok: ${JSON.stringify(itens)}`)

    let chamadas = 0
    dl._injetar({ igdl: async () => { chamadas++; throw new Error('fonte fora do ar') } })
    let erro = null
    try { await dl.resolverInsta(LINK_INSTA) } catch (e) { erro = e }
    if (!erro) throw new Error('deveria lançar erro')
    if (chamadas !== 2) throw new Error(`retry esperava 2 tentativas, houve ${chamadas}`)
    dl._injetar({ igdl: async () => ({ status: true, result: [{ url: 'https://cdn.x/a.mp4' }] }) })
  })

  await testar('resolverInsta: resposta sem mídia -> ErroDownloadExtra sem_midia', async () => {
    dl._injetar({ igdl: async () => ({ status: true, result: [] }) })
    let erro = null
    try { await dl.resolverInsta(LINK_INSTA) } catch (e) { erro = e }
    if (!erro || erro.tipo !== 'sem_midia') throw new Error(`esperava sem_midia, veio ${erro?.tipo}`)
  })

  await testar('extrairLink com os 3 regex exportados', async () => {
    // regex de insta não captura a barra final (termina em [^\s/?#]+)
    if (dl.extrairLink(`/insta ${LINK_INSTA}`, dl.REGEX_INSTA) !== LINK_INSTA.replace(/\/$/, '')) throw new Error('insta não extraiu')
    if (dl.extrairLink(`/twitter ${LINK_X}`, dl.REGEX_TWITTER) !== LINK_X) throw new Error('twitter não extraiu')
    if (dl.extrairLink('/insta sem link', dl.REGEX_INSTA) !== null) throw new Error('sem link deveria dar null')
  })


  await testar('executar sem link: aviso de uso SEM tocar na rede (4 comandos)', async () => {
    let tocouRede = false
    const sinal = async () => { tocouRede = true; return { status: true, result: [] } }
    dl._injetar({ igdl: sinal, twitter: sinal, fbdown: sinal })
    dl._injetar({ baixarHttp: async () => { tocouRede = true; throw new Error('rede') } })
    for (const nome of ['insta', 'igmp3', 'twitter', 'facebook']) {
      const cmd = dl.find((c) => c.nome === nome)
      const { sock, enviadas } = criarSock()
      await cmd.executar(sock, 'G@g.us', criarMsg(`/${nome}`), `/${nome}`)
      const texto = ultimoTexto(enviadas)
      if (!texto || !/Como usar/i.test(texto)) throw new Error(`${nome}: aviso inesperado -> ${texto}`)
    }
    if (tocouRede) throw new Error('tocou na rede sem link — bug')
  })

  await testar('executar com domínio errado: aviso de domínio SEM rede', async () => {
    let tocouRede = false
    dl._injetar({ igdl: async () => { tocouRede = true; return { status: true } } })
    const cmd = dl.find((c) => c.nome === 'insta')
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, 'G@g.us', criarMsg('/insta https://x.com/u/status/1'), '/insta https://x.com/u/status/1')
    const texto = ultimoTexto(enviadas)
    if (!texto || !/não é do Instagram/i.test(texto)) throw new Error(`aviso inesperado -> ${texto}`)
    if (tocouRede) throw new Error('chamou a fonte com domínio errado — bug')
  })

  await testar('executar /insta com link ok: baixa e envia vídeo (mock de rede)', async () => {
    dl._injetar({ igdl: async () => ({ status: true, result: [{ thumbnail: 't', url: 'https://cdn.x/v.mp4?x=1' }] }) })
    dl._injetar({ baixarHttp: httpMock(2048) })
    const cmd = dl.find((c) => c.nome === 'insta')
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, 'G@g.us', criarMsg(`/insta ${LINK_INSTA}`), `/insta ${LINK_INSTA}`)
    const video = ultimoVideo(enviadas)
    if (!video) throw new Error(`nenhum vídeo enviado: ${JSON.stringify(enviadas.map((e) => e.conteudo && Object.keys(e.conteudo)))}`)
    if (!video.caption || !/Instagram/i.test(video.caption)) throw new Error(`legenda: ${video.caption}`)
    if (!video.jpegThumbnail) throw new Error('jpegThumbnail ausente')
  })

  await testarClassificacaoInsta(testar, LINK_INSTA)

  await testar('executar /twitter com fonte caindo: aviso amigável (sem erro cruso)', async () => {
    dl._injetar({ twitter: async () => { throw new Error('ECONNRESET socket hang up') } })
    const cmd = dl.find((c) => c.nome === 'twitter')
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, 'G@g.us', criarMsg(`/twitter ${LINK_X}`), `/twitter ${LINK_X}`)
    const texto = ultimoTexto(enviadas)
    if (!texto || !/Não consegui baixar|demorou/i.test(texto)) throw new Error(`aviso inesperado -> ${texto}`)
    if (/ECONNRESET/.test(texto)) throw new Error('vazou erro técnico pro usuário')
  })

  await testar('executar /facebook com timeout: aviso "demorou demais"', async () => {
    dl._injetar({ fbdown: async () => { const e = new Error('timeout of 25000ms exceeded'); e.code = 'ECONNABORTED'; throw e } })
    const cmd = dl.find((c) => c.nome === 'facebook')
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, 'G@g.us', criarMsg(`/facebook ${LINK_FB}`), `/facebook ${LINK_FB}`)
    const texto = ultimoTexto(enviadas)
    if (!texto || !/demorou demais/i.test(texto)) throw new Error(`aviso inesperado -> ${texto}`)
  })

  await testar('executar com arquivo acima de 50MB: aviso de limite', async () => {
    dl._injetar({ igdl: async () => ({ status: true, result: [{ url: 'https://cdn.x/g.mp4' }] }) })
    dl._injetar({ baixarHttp: async () => ({ headers: { 'content-length': String(60 * 1024 * 1024) }, data: Readable.from([Buffer.alloc(1)]) }) })
    const cmd = dl.find((c) => c.nome === 'insta')
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, 'G@g.us', criarMsg(`/insta ${LINK_INSTA}`), `/insta ${LINK_INSTA}`)
    const texto = ultimoTexto(enviadas)
    if (!texto || !/50 MB/i.test(texto)) throw new Error(`aviso inesperado -> ${texto}`)
  })


  // ---------- /robloxstalk (API oficial, mockada) ----------
  const RESP_ROBLOX = (nome, id, comAvatar) => async (metodo, url) => {
    if (url.includes('/usernames/users')) return { data: [{ id, name: nome, displayName: nome }] }
    if (/\/users\/\d+$/.test(url)) return { name: nome, displayName: nome, created: '2009-05-01T00:00:00Z', description: 'Conta de teste', isBanned: false }
    if (url.includes('avatar-headshot')) return { data: comAvatar ? [{ imageUrl: 'https://cdn.rbx/avatar.png' }] : [] }
    throw new Error('url inesperada: ' + url)
  }

  await testar('/robloxstalk com perfil encontrado: envia avatar + legenda com ID', async () => {
    dl._injetar({ roblox: RESP_ROBLOX('Builderman', 156, true), baixarHttp: httpMock(1024) })
    const cmd = dl.find((c) => c.nome === 'robloxstalk')
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, 'G@g.us', criarMsg('/robloxstalk Builderman'), '/robloxstalk Builderman')
    const img = [...enviadas].reverse().find((x) => x.conteudo?.image)
    if (!img) throw new Error(`sem imagem: ${JSON.stringify(enviadas.map((e) => e.conteudo && Object.keys(e.conteudo)))}`)
    const legenda = img.conteudo.caption || ''
    for (const esperado of ['Builderman', '156', 'Conta de teste']) {
      if (!legenda.includes(esperado)) throw new Error(`legenda sem "${esperado}": ${legenda}`)
    }
    // data vira 30/04 ou 01/05 dependendo do fuso — só exige o formato e o ano
    if (!/\d{2}\/\d{2}\/2009/.test(legenda)) throw new Error(`data ausente/errada: ${legenda}`)
  })

  await testar('/robloxstalk sem avatar: cai para texto puro (não quebra)', async () => {
    dl._injetar({ roblox: RESP_ROBLOX('NoAvatar', 42, false), baixarHttp: httpMock(64) })
    const cmd = dl.find((c) => c.nome === 'robloxstalk')
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, 'G@g.us', criarMsg('/robloxstalk NoAvatar'), '/robloxstalk NoAvatar')
    const texto = ultimoTexto(enviadas)
    if (!texto || !/NoAvatar/.test(texto) || !/42/.test(texto)) throw new Error(`texto: ${texto}`)
  })

  await testar('/robloxstalk usuário inexistente: aviso "Não achei"', async () => {
    dl._injetar({ roblox: async (metodo, url) => (url.includes('/usernames/users') ? { data: [] } : {}) })
    const cmd = dl.find((c) => c.nome === 'robloxstalk')
    const { sock, enviadas } = criarSock()
    // nome de 20 chars (limite do Roblox) para não cair no aviso de uso
    await cmd.executar(sock, 'G@g.us', criarMsg('/robloxstalk fulanonaoexiste123'), '/robloxstalk fulanonaoexiste123')
    const texto = ultimoTexto(enviadas)
    if (!texto || !/Não achei/.test(texto) || !/fulanonaoexiste123/.test(texto)) throw new Error(`texto: ${texto}`)
  })

  await testar('/robloxstalk sem nome: aviso de uso', async () => {
    dl._injetar({ roblox: async () => { throw new Error('não deveria ser chamado') } })
    const cmd = dl.find((c) => c.nome === 'robloxstalk')
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, 'G@g.us', criarMsg('/robloxstalk'), '/robloxstalk')
    const texto = ultimoTexto(enviadas)
    if (!texto || !/Como usar/i.test(texto)) throw new Error(`texto: ${texto}`)
  })


  // ---------- velocidade de vídeo (baixarMidia + rodarFfmpeg mockados) ----------
  const fakeMidia = () => (async function * () { yield Buffer.alloc(512, 77) })()
  const fakeFfmpeg = async (args) => {
    const saida = args[args.length - 1]
    fs.writeFileSync(saida, Buffer.alloc(1024, 66))
  }

  await testar('/videorapido sem reply: aviso de uso, sem tocar na rede', async () => {
    let tocouRede = false
    vel._injetar({ baixarMidia: async () => { tocouRede = true; return fakeMidia() } })
    const cmd = vel.find((c) => c.nome === 'videorapido')
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, 'G@g.us', criarMsg('/videorapido'))
    const texto = ultimoTexto(enviadas)
    if (!texto || !/Falta o video/i.test(texto) || !/videorapido/.test(texto)) throw new Error(`texto: ${texto}`)
    if (tocouRede) throw new Error('baixou mídia sem reply — bug')
  })

  await testar('/videolento com reply de imagem: aviso "não é um vídeo"', async () => {
    const msg = {
      key: { remoteJid: 'G@g.us', fromMe: false, id: 'M3', participant: 'A@s.whatsapp.net' },
      message: { extendedTextMessage: { text: '/videolento', contextInfo: { quotedMessage: { imageMessage: { mimetype: 'image/jpeg' } } } } }
    }
    const cmd = vel.find((c) => c.nome === 'videolento')
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, 'G@g.us', msg)
    const texto = ultimoTexto(enviadas)
    if (!texto || !/não é um video/i.test(texto)) throw new Error(`texto: ${texto}`)
  })

  await testar('/videocontrario com reply de 120s: aviso do limite de 60s', async () => {
    const cmd = vel.find((c) => c.nome === 'videocontrario')
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, 'G@g.us', criarMsgReplyVideo('/videocontrario', 120))
    const texto = ultimoTexto(enviadas)
    if (!texto || !/longo demais/.test(texto) || !/60s/.test(texto)) throw new Error(`texto: ${texto}`)
  })

  await testar('/videorapido caminho feliz: processa e envia vídeo com legenda', async () => {
    vel._injetar({ baixarMidia: fakeMidia, rodarFfmpeg: fakeFfmpeg })
    const cmd = vel.find((c) => c.nome === 'videorapido')
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, 'G@g.us', criarMsgReplyVideo('/videorapido', 15))
    const video = ultimoVideo(enviadas)
    if (!video) throw new Error(`nenhum vídeo: ${JSON.stringify(enviadas.map((e) => e.conteudo && Object.keys(e.conteudo)))}`)
    if (!/acelerado/.test(video.caption || '')) throw new Error(`legenda: ${video.caption}`)
    if (!video.jpegThumbnail) throw new Error('jpegThumbnail ausente')
    const reacoes = enviadas.filter((e) => e.conteudo?.react)
    if (!reacoes.some((e) => e.conteudo.react.text === '⏳')) throw new Error('sem react ⏳')
    if (!reacoes.some((e) => e.conteudo.react.text === '✅')) throw new Error('sem react ✅')
    const sobrou = fs.readdirSync(os.tmpdir()).filter((f) => /^vvel-\d/.test(f) && !f.includes('-sonda'))
    if (sobrou.length) throw new Error(`temporários sobraram: ${sobrou.join(', ')}`)
  })

  await testar('/videolento caminho feliz: legenda "desacelerado"', async () => {
    vel._injetar({ baixarMidia: fakeMidia, rodarFfmpeg: fakeFfmpeg })
    const cmd = vel.find((c) => c.nome === 'videolento')
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, 'G@g.us', criarMsgReplyVideo('/videolento', 10))
    const video = ultimoVideo(enviadas)
    if (!video || !/desacelerado/.test(video.caption || '')) throw new Error(`legenda: ${video?.caption}`)
  })

  await testar('/videocontrario caminho feliz: legenda "ao contrario"', async () => {
    vel._injetar({ baixarMidia: fakeMidia, rodarFfmpeg: fakeFfmpeg })
    const cmd = vel.find((c) => c.nome === 'videocontrario')
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, 'G@g.us', criarMsgReplyVideo('/videocontrario', 8))
    const video = ultimoVideo(enviadas)
    if (!video || !/ao contrario/.test(video.caption || '')) throw new Error(`legenda: ${video?.caption}`)
  })

  await testar('/videorapido com ffmpeg falhando: aviso amigável + react ❌', async () => {
    vel._injetar({ baixarMidia: fakeMidia, rodarFfmpeg: async () => { throw new Error('ffmpeg explodiu') } })
    const cmd = vel.find((c) => c.nome === 'videorapido')
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, 'G@g.us', criarMsgReplyVideo('/videorapido', 5))
    const texto = ultimoTexto(enviadas)
    if (!texto || !/Não consegui alterar/.test(texto)) throw new Error(`texto: ${texto}`)
    if (!enviadas.some((e) => e.conteudo?.react?.text === '❌')) throw new Error('sem react ❌')
    if (/ffmpeg explodiu/.test(texto)) throw new Error('vazou erro técnico pro usuário')
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
