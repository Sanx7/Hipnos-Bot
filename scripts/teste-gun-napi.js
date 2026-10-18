// Offline: nenhum socket WhatsApp/Mongo, Canvas antigo só na referência visual.
// O modo memória roda sozinho e mede RSS nativo + JS; não mede o bot completo.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const Module = require('node:module')
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
process.env.DISABLE_CANVAS = 'true'
require('node:net').Socket.prototype.connect = function () { throw new Error('Rede proibida no teste offline') }

const modo = process.argv[2]
if (!modo) {
  for (const caso of ['visual', 'comando', 'falha-backend', 'memoria']) {
    const r = spawnSync(process.execPath, ['--expose-gc', __filename, caso], {
      encoding: 'utf8', timeout: 90000, env: process.env
    })
    assert.equal(r.status, 0, `${caso}\n${r.stdout}\n${r.stderr}`)
    console.log(r.stdout.trim())
  }
} else {
  main().catch(err => { console.error(err); process.exitCode = 1 })
}

async function main() {
  const carregar = Module._load
  let falharBackend = modo === 'falha-backend'
  let tentativasCanvas = 0
  Module._load = function (nome, ...args) {
    if (nome === 'canvas' && modo !== 'visual') {
      tentativasCanvas++
      throw new Error('Canvas antigo proibido')
    }
    if (nome === '@napi-rs/canvas' && falharBackend) throw new Error('Binding indisponível')
    return carregar.call(this, nome, ...args)
  }
  // Importar o comando não deve carregar nem exigir o novo binding.
  const efv = require('../comandos/menu-efeitos/efeitos-visuais')
  assert.equal(require.cache[require.resolve('@napi-rs/canvas')], undefined)
  const { Jimp, JimpMime } = require('jimp')
  const { renderizarPng } = require('../func/renderizador-canvas')
  const foto = await new Jimp({ width: 480, height: 480, color: 0x3366ccff }).getBuffer(JimpMime.png)
  const gun = efv.find(c => c.nome === 'gun')
  const msg = origem => ({ key: { id: 'offline' }, message: origem })
  const reply = conteudo => msg({ extendedTextMessage: { text: '/gun', contextInfo: { quotedMessage: conteudo } } })
  const chamadas = []
  const sock = { sendMessage: async (...args) => { chamadas.push(args); return {} } }
  let downloads = 0
  efv._injetar({ baixarMidia: async () => { downloads++; return foto } })
  const executar = async entrada => {
    chamadas.length = 0
    await gun.executar(sock, 'offline', entrada)
    return chamadas.map(c => c[1])
  }

  if (modo === 'falha-backend') {
    const erroOriginal = console.error
    console.error = () => {}
    try {
      const saidas = await executar(reply({ imageMessage: {} }))
      assert.equal(saidas.length, 1)
      assert.match(saidas[0].text, /Não consegui aplicar/)
      assert.equal(saidas[0].image, undefined)
      falharBackend = false
      assert.ok(Buffer.isBuffer(await efv.compor.gun(foto)), 'fila recupera após falha do binding')
    } finally { console.error = erroOriginal }
    console.log('OK: binding ausente não quebra loader; erro amigável e recuperação sem fallback ao Canvas antigo.')
  }

  if (modo === 'comando') {
    const entrada = reply({ imageMessage: { mimetype: 'image/png' } })
    for (const caso of [entrada, msg({ imageMessage: { caption: '/gun', mimetype: 'image/png' } })]) {
      const saidas = await executar(caso)
      assert.equal(saidas.length, 1)
      const saida = saidas[0]
      assert.ok(Buffer.isBuffer(saida.image))
      assert.equal(saida.caption, '🎯 Na mira do limbo')
      assert.ok(saida.jpegThumbnail, 'miniatura explícita, sem geração automática da Baileys')
      assert.equal(chamadas[0][2].quoted, caso)
      const imagem = await Jimp.read(saida.image)
      assert.equal(imagem.width, 480)
      assert.equal(imagem.height, 480)
    }
    const erroOriginal = console.error
    console.error = () => {}
    try {
      const antes = downloads
      assert.match((await executar(msg({ conversation: '/gun' })))[0].text, /Falta a foto/)
      assert.match((await executar(reply({ audioMessage: {} })))[0].text, /não é uma foto/)
      assert.equal(downloads, antes)
      efv._injetar({ baixarMidia: async () => Buffer.alloc(efv.LIMITE_BYTES_IMAGEM + 1) })
      assert.match((await executar(entrada))[0].text, /grande demais/)
      efv._injetar({ baixarMidia: async () => Buffer.from('imagem inválida') })
      assert.match((await executar(entrada))[0].text, /Não consegui aplicar/)
    } finally { console.error = erroOriginal }
    assert.ok(Buffer.isBuffer(await efv.compor.gun(foto)), 'fila recupera após imagem inválida')

    // Uma ativa, duas aguardando; excesso recusado sem iniciar outra decodificação.
    let liberar, ativas = 0, pico = 0
    const portao = new Promise(resolve => { liberar = resolve })
    const desenhar = async () => { ativas++; pico = Math.max(pico, ativas); await portao; ativas-- }
    const tarefas = [0, 1, 2].map(() => renderizarPng(8, 8, foto, desenhar))
    await assert.rejects(renderizarPng(8, 8, foto, desenhar), /ocupado/)
    liberar()
    await Promise.all(tarefas)
    assert.equal(pico, 1)
    console.log('OK: reply/legenda, PNG 480x480, caption/quoted/thumbnail, recusas, fila limitada e recuperação.')
  }

  if (modo === 'visual') {
    const original = require('./fixtures/gun-canvas-original')
    const { createCanvas } = require('canvas')
    for (const [w, h] of [[480, 480], [960, 480], [480, 960], [321, 239]]) {
      const c = createCanvas(w, h), ctx = c.getContext('2d')
      ctx.fillStyle = '#3366cc'; ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#00cc66'; ctx.fillRect(0, 0, w / 3, h)
      ctx.fillStyle = '#ffcc00'; ctx.fillRect(w * 2 / 3, 0, w / 3, h)
      const png = c.toBuffer('image/png')
      const jpeg = c.toBuffer('image/jpeg')
      // EXIF Orientation=6: ambos os backends devem tratar a mesma entrada.
      const exif = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000', 'hex')
      const orientado = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)])
      ctx.clearRect(w / 3, 0, w / 3, h / 2)
      const transparente = c.toBuffer('image/png')
      for (const [formato, buffer] of [['PNG', png], ['JPEG', jpeg], ['JPEG-EXIF', orientado], ['PNG-alpha', transparente]]) {
        const a = await Jimp.read(await original(buffer))
        const b = await Jimp.read(await efv.compor.gun(buffer))
        assert.equal(b.width, 480); assert.equal(b.height, 480)
        let soma = 0, relevantes = 0
        for (let p = 0; p < a.bitmap.data.length; p += 4) {
          let max = 0
          for (let k = 0; k < 4; k++) {
            const d = Math.abs(a.bitmap.data[p + k] - b.bitmap.data[p + k])
            soma += d; max = Math.max(max, d)
          }
          if (max > 16) relevantes++
        }
        const mae = soma / a.bitmap.data.length
        const fracao = relevantes / (480 * 480)
        assert.ok(mae < 0.5, `diferença média ${mae}`)
        assert.ok(fracao < 0.015, `pixels divergentes ${fracao}`)
        const cx = 240 + ((buffer.length % 61) - 30), cy = 240 + ((buffer.length % 47) - 23)
        for (const [x, y] of [[cx, cy], [cx + 40, cy], [cx + 70, cy], [cx, cy + 94]]) {
          assert.equal(b.getPixelColor(x, y), 0xff0000ff, 'geometria e posição originais da mira')
        }
        console.log(`OK: visual ${w}x${h} ${formato}; MAE=${mae.toFixed(3)}; divergência>16=${(fracao * 100).toFixed(3)}%.`)
      }
    }
  }

  if (modo === 'memoria') {
    assert.equal(typeof global.gc, 'function', 'execute com --expose-gc')
    const mb = n => +(n / 1024 / 1024).toFixed(2)
    // Entrada de 12 MP: maior que as fotos usuais e muito maior que a saída.
    const grande = await new Jimp({ width: 4000, height: 3000, color: 0x3366ccff }).getBuffer(JimpMime.jpeg)
    global.gc()
    const inicial = process.memoryUsage().rss
    let pico = inicial
    for (let i = 0; i < 30; i++) {
      const out = await efv.compor.gun(i % 5 === 0 ? grande : foto)
      assert.equal(out.toString('ascii', 1, 4), 'PNG')
      pico = Math.max(pico, process.memoryUsage().rss)
      global.gc()
    }
    const final = process.memoryUsage().rss
    pico = Math.max(pico, process.resourceUsage().maxRSS * 1024)
    assert.ok(pico < 512 * 1024 * 1024, `pico isolado ${mb(pico)} MiB`)
    assert.ok(final - inicial < 96 * 1024 * 1024, `crescimento retido ${mb(final - inicial)} MiB`)
    console.log('OK: memória isolada, 30 renders (6 JPEG 4000x3000): ' + JSON.stringify({ node: process.version, plataforma: process.platform, rssInicialMiB: mb(inicial), picoProcessoMiB: mb(pico), rssFinalMiB: mb(final), crescimentoMiB: mb(final - inicial) }))
  }
  if (modo !== 'visual') assert.equal(tentativasCanvas, 0, 'gun não deve tentar node-canvas')
}
