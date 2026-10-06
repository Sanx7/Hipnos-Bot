// ============================================================
// 🧪 teste-efeitos-visuais.js — Testes OFFLINE da leva 2
// ============================================================
// RODA SEM WhatsApp: sock mockado + foto sintetica (canvas) + ffmpeg
// MOCKADO via _injetar (mesmo padrao do teste-modificador-voz.js).
// Para cada um dos 14: reply valido processa, sem reply recusa,
// midia errada recusa, falha de processamento tratada, limpeza.
// Uso: node scripts/teste-efeitos-visuais.js
// ============================================================

process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''

const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCanvas } = require('canvas')
const efv = require('../comandos/menu-efeitos/efeitos-visuais')

const JID = 'teste-efv@g.us'
const NOMES_VIDEO_FRAMES = ['glitchgif', 'rotacao3d', 'fogogif', 'derreter', 'naoolhe', 'falha']
const NOMES_VIDEO_FILTRO = ['ondasanim', 'vhs', 'entidade']
const NOMES_ESTATICOS = ['conquista', 'impostor', 'cerebro', 'gun']
const TODOS_FOTO = [...NOMES_VIDEO_FRAMES, ...NOMES_VIDEO_FILTRO, ...NOMES_ESTATICOS]

function fotoSintetica() {
  const c = createCanvas(160, 160)
  const x = c.getContext('2d')
  x.fillStyle = '#3366cc'
  x.fillRect(0, 0, 160, 160)
  x.fillStyle = '#ffcc00'
  x.fillRect(30, 30, 100, 100)
  x.fillStyle = '#ffffff'
  x.font = 'bold 30px Sans'
  x.fillText('H', 70, 95)
  return c.toBuffer('image/png')
}
const FOTO = fotoSintetica()

function sockFalso(reg) {
  return {
    sendMessage: async (jid, conteudo) => {
      reg.push({ jid, conteudo })
      return { key: { id: 'fake' } }
    }
  }
}

function msgReplyFoto() {
  return {
    key: { id: 'K1', remoteJid: JID, participant: '5511900000001@s.whatsapp.net' },
    message: {
      extendedTextMessage: {
        text: '/efeito',
        contextInfo: { quotedMessage: { imageMessage: { caption: 'foto', mimetype: 'image/jpeg' } } }
      }
    }
  }
}

function msgSemReply() {
  return { key: { id: 'K2', remoteJid: JID }, message: { conversation: '/glitchgif' } }
}

function msgReplyNaoFoto() {
  return {
    key: { id: 'K3', remoteJid: JID },
    message: {
      extendedTextMessage: {
        text: '/glitchgif',
        contextInfo: { quotedMessage: { audioMessage: { mimetype: 'audio/ogg' } } }
      }
    }
  }
}

const porNome = (n) => efv.find((c) => c.nome === n)
const ultimoTexto = (reg) => {
  const e = [...reg].reverse().find((x) => typeof x.conteudo.text === 'string')
  return e ? e.conteudo.text : null
}

// ffmpeg mockado: grava uma saida falsa no ultimo arg (o .mp4 de saida)
function mockFfmpegOk(regArgs) {
  return async (args) => {
    if (regArgs) regArgs.push(args)
    fs.writeFileSync(args[args.length - 1], Buffer.from('MP4FAKE-' + 'x'.repeat(2000)))
  }
}

let falhas = 0
async function testar(titulo, fn) {
  try {
    await fn()
    console.log('PASSOU: ' + titulo)
  } catch (err) {
    falhas++
    console.log('FALHOU: ' + titulo + ' :: ' + (err && err.message ? err.message : err))
  }
}
function exigir(cond, detalhe) {
  if (!cond) throw new Error(detalhe || 'condicao falsa')
}


async function main() {
  console.log('Teste offline dos efeitos visuais (14 comandos)')

  await testar('modulo exporta os 14 comandos', async () => {
    exigir(efv.length === 14, 'esperava 14, veio ' + efv.length)
    for (const n of [...TODOS_FOTO, 'textopulsar']) {
      const c = porNome(n)
      if (!c || typeof c.executar !== 'function') throw new Error('falta /' + n)
      if (!c.descricao) throw new Error('/' + n + ' sem descricao')
    }
  })

  await testar('/naoolhe tem alias /nao-olhe', async () => {
    const c = porNome('naoolhe')
    exigir(Array.isArray(c.aliases) && c.aliases.includes('nao-olhe'), 'sem alias')
  })

  for (const nome of [...NOMES_VIDEO_FRAMES, ...NOMES_VIDEO_FILTRO]) {
    await testar('/' + nome + ' reply valido envia video gifPlayback', async () => {
      const reg = []
      efv._injetar({ baixarMidia: async () => FOTO, rodarFfmpeg: mockFfmpegOk() })
      await porNome(nome).executar(sockFalso(reg), JID, msgReplyFoto())
      const envio = reg.find((x) => x.conteudo.video)
      exigir(envio, 'nao enviou video')
      exigir(envio.conteudo.gifPlayback === true, 'sem gifPlayback')
      exigir(envio.conteudo.mimetype === 'video/mp4', 'mimetype errado')
    })
  }

  await testar('/textopulsar com texto envia video', async () => {
    const reg = []
    efv._injetar({ rodarFfmpeg: mockFfmpegOk() })
    const msg = { key: { id: 'KT', remoteJid: JID }, message: { conversation: '/textopulsar bom dia' } }
    await porNome('textopulsar').executar(sockFalso(reg), JID, msg, 'bom dia')
    const envio = reg.find((x) => x.conteudo.video)
    exigir(envio, 'nao enviou video')
    exigir(envio.conteudo.gifPlayback === true, 'sem gifPlayback')
  })

  await testar('/textopulsar sem texto recusa', async () => {
    const reg = []
    efv._injetar({ rodarFfmpeg: mockFfmpegOk() })
    const msg = { key: { id: 'KT2', remoteJid: JID }, message: { conversation: '/textopulsar' } }
    await porNome('textopulsar').executar(sockFalso(reg), JID, msg, '   ')
    exigir(!reg.some((x) => x.conteudo.video), 'enviou sem texto')
    exigir(/Falta o texto/i.test(ultimoTexto(reg) || ''), 'aviso: ' + ultimoTexto(reg))
  })

  for (const nome of NOMES_ESTATICOS) {
    await testar('/' + nome + ' reply valido envia imagem+thumb', async () => {
      const reg = []
      efv._injetar({ baixarMidia: async () => FOTO })
      await porNome(nome).executar(sockFalso(reg), JID, msgReplyFoto())
      const envio = reg.find((x) => x.conteudo.image)
      exigir(envio, 'nao enviou imagem')
      exigir(envio.conteudo.jpegThumbnail, 'sem jpegThumbnail')
    })
  }

  for (const nome of TODOS_FOTO) {
    await testar('/' + nome + ' sem reply recusa', async () => {
      const reg = []
      let baixou = false
      efv._injetar({ baixarMidia: async () => { baixou = true; return FOTO } })
      await porNome(nome).executar(sockFalso(reg), JID, msgSemReply())
      exigir(!baixou, 'baixou sem reply')
      exigir(!reg.some((x) => x.conteudo.video || x.conteudo.image), 'enviou sem reply')
      exigir(/Falta a foto/i.test(ultimoTexto(reg) || ''), 'aviso: ' + ultimoTexto(reg))
    })
  }


  for (const nome of TODOS_FOTO) {
    await testar('/' + nome + ' midia errada recusa', async () => {
      const reg = []
      efv._injetar({ baixarMidia: async () => FOTO })
      await porNome(nome).executar(sockFalso(reg), JID, msgReplyNaoFoto())
      exigir(!reg.some((x) => x.conteudo.video || x.conteudo.image), 'enviou errada')
      exigir(/n.o . uma foto/i.test(ultimoTexto(reg) || ''), 'aviso: ' + ultimoTexto(reg))
    })
  }

  for (const nome of [...NOMES_VIDEO_FRAMES, ...NOMES_VIDEO_FILTRO]) {
    await testar('/' + nome + ' falha do ffmpeg vira aviso', async () => {
      const reg = []
      efv._injetar({ baixarMidia: async () => FOTO, rodarFfmpeg: async () => { throw new Error('x') } })
      await porNome(nome).executar(sockFalso(reg), JID, msgReplyFoto())
      exigir(!reg.some((x) => x.conteudo.video), 'enviou apos falha')
      exigir(typeof ultimoTexto(reg) === 'string' && ultimoTexto(reg).length > 0, 'sem aviso')
    })
  }

  await testar('/textopulsar falha vira aviso', async () => {
    const reg = []
    efv._injetar({ rodarFfmpeg: async () => { throw new Error('x') } })
    const msg = { key: { id: 'KT3', remoteJid: JID }, message: { conversation: 'oi' } }
    await porNome('textopulsar').executar(sockFalso(reg), JID, msg, 'oi')
    exigir(!reg.some((x) => x.conteudo.video), 'enviou apos falha')
    exigir(typeof ultimoTexto(reg) === 'string', 'sem aviso')
  })

  for (const nome of NOMES_ESTATICOS) {
    await testar('/' + nome + ' foto corrompida vira aviso', async () => {
      const reg = []
      efv._injetar({ baixarMidia: async () => Buffer.from('lixo') })
      await porNome(nome).executar(sockFalso(reg), JID, msgReplyFoto())
      exigir(!reg.some((x) => x.conteudo.image), 'enviou lixo')
      exigir(typeof ultimoTexto(reg) === 'string', 'sem aviso')
    })
  }

  await testar('foto gigante recusada antes do ffmpeg', async () => {
    const reg = []
    let rodou = false
    efv._injetar({
      baixarMidia: async () => Buffer.alloc(efv.LIMITE_BYTES_IMAGEM + 1),
      rodarFfmpeg: async (a) => { rodou = true; return mockFfmpegOk()(a) }
    })
    await porNome('vhs').executar(sockFalso(reg), JID, msgReplyFoto())
    exigir(!rodou, 'rodou ffmpeg em gigante')
    exigir(/grande demais|20MB/i.test(ultimoTexto(reg) || ''), 'aviso: ' + ultimoTexto(reg))
  })

  await testar('limpeza no sucesso e no erro', async () => {
    for (const [nome, falha] of [['vhs', false], ['glitchgif', true]]) {
      const antes = new Set(fs.readdirSync(os.tmpdir()))
      const reg = []
      efv._injetar({
        baixarMidia: async () => FOTO,
        rodarFfmpeg: falha ? async () => { throw new Error('x') } : mockFfmpegOk()
      })
      await porNome(nome).executar(sockFalso(reg), JID, msgReplyFoto())
      const sobrou = fs.readdirSync(os.tmpdir()).filter((f) => f.indexOf('efv-') === 0 && !antes.has(f))
      exigir(sobrou.length === 0, 'sobrou temp: ' + sobrou.join(','))
    }
  })

  await testar('compositores geram PNG e frames validos', async () => {
    efv._injetar({ baixarMidia: async () => FOTO })
    for (const n of NOMES_ESTATICOS) {
      const buf = await efv.compor[n](FOTO)
      exigir(buf[0] === 0x89 && buf[1] === 0x50, '/' + n + ' sem PNG')
    }
    const mapa = { glitch: 1, rotacao3d: 1, fogo: 1, derreter: 1, naoolhe: 1, falha: 1 }
    for (const gen of Object.keys(mapa)) {
      const frames = await efv.compor[gen](FOTO)
      exigir(frames.length >= 6 && frames.every((b) => b[0] === 0x89), gen + ' invalido')
    }
  })

  await testar('sanitizarTexto e ffmpeg filho + menu + changelog', async () => {
    exigir(efv.compor.sanitizarTexto("oi: 't'") === 'oi  t', 'sanitizacao')
    exigir(efv.compor.sanitizarTexto('   ') === '', 'vazio')
    const src = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'menu-efeitos', 'efeitos-visuais.js'), 'utf8')
    exigir(src.indexOf('execFile') !== -1, 'sem execFile')
    exigir(src.indexOf("require('sharp')") === -1 && src.indexOf('require("sharp")') === -1, 'usa sharp')
    const menu = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'menu-efeitos', 'menu-efeitos.js'), 'utf8')
    exigir(menu.indexOf('EFEITOS ESPECIAIS') !== -1, 'sem secao')
    for (const n of [...TODOS_FOTO, 'textopulsar']) exigir(menu.indexOf('/' + n) !== -1, 'menu sem /' + n)
    const log = fs.readFileSync(path.join(__dirname, '..', 'dados', 'changelog.js'), 'utf8')
    for (const n of ['glitchgif', 'textopulsar', 'conquista', 'naoolhe']) exigir(log.indexOf('/' + n) !== -1, 'log sem /' + n)
  })

  console.log(falhas === 0 ? 'TODOS PASSARAM' : falhas + ' FALHARAM')
  process.exit(falhas === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
