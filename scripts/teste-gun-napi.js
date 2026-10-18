// Offline: nenhum socket WhatsApp/Mongo, Canvas antigo só na referência visual.
// O modo memória roda sozinho e mede RSS nativo + JS; não mede o bot completo.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const Module = require('node:module')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
process.env.DISABLE_CANVAS = 'true'
require('node:net').Socket.prototype.connect = function () { throw new Error('Rede proibida no teste offline') }

const modo = process.argv[2]
if (!modo) {
  for (const caso of ['visual', 'comando', 'falha-backend', 'stream', 'memoria']) {
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
  if (modo === 'stream') return require('./fixtures/gun-stream-testes')()
  const carregar = Module._load
  let falharBackend = modo === 'falha-backend'
  let falhaProcesso = ''
  let falhaMiniatura = false
  let tentativasCanvas = 0
  Module._load = function (nome, ...args) {
    if (nome === 'canvas' && modo !== 'visual') {
      tentativasCanvas++
      throw new Error('Canvas antigo proibido')
    }
    if (nome === '@napi-rs/canvas') throw new Error('Binding nativo proibido no processo principal')
    return carregar.call(this, nome, ...args)
  }
  const cp = require('node:child_process')
  const execOriginal = cp.execFile
  let filhos = 0, picoWorker = 0, picoFfmpeg = 0, picoConjunto = 0
  let picoPai = 0
  const ativos = new Map()
  function amostrar() {
    const pai = process.memoryUsage().rss
    picoPai = Math.max(picoPai, pai)
    let soma = pai
    if (process.platform === 'linux') for (const [pid, worker] of ativos) {
      try {
        const rss = Number(fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) * 1024
        soma += rss
        if (!worker) picoFfmpeg = Math.max(picoFfmpeg, rss)
      } catch (_) {}
    }
    picoConjunto = Math.max(picoConjunto, soma)
  }
  cp.execFile = (file, args, options, callback) => {
    const worker = args.some(a => a.endsWith('renderizador-canvas-worker.js'))
    if (worker) {
      filhos++
      assert.equal(options.env.MONGODB_URI, undefined)
      assert.equal(options.env.NODE_OPTIONS, undefined)
      if (falharBackend) {
        const script = args[1], argumentos = args.slice(1)
        args = ['-e', `const M=require('module'),load=M._load;M._load=function(n,...a){if(n==='@napi-rs/canvas')throw new Error('Binding ausente');return load.call(this,n,...a)};process.argv=[process.execPath,...${JSON.stringify(argumentos)}];require(${JSON.stringify(script)})`]
      }
      if (falhaProcesso === 'fatal') args = ['-e', 'process.kill(process.pid,"SIGKILL")']
      if (falhaProcesso === 'timeout') { args = ['-e', 'setInterval(()=>{},1000)']; options = { ...options, timeout: 50 } }
    }
    if (!worker && falhaMiniatura) { file = process.execPath; args = ['-e', 'process.exit(7)'] }
    const filho = execOriginal(file, args, options, (erro, stdout, stderr) => {
      if (worker && !erro) picoWorker = Math.max(picoWorker, JSON.parse(stdout).picoRssBytes)
      amostrar()
      callback(erro, stdout, stderr)
    })
    if (filho.pid) ativos.set(filho.pid, worker)
    filho.once('close', () => ativos.delete(filho.pid))
    return filho
  }
  // Importar o comando não deve carregar nem exigir o novo binding.
  const efv = require('../comandos/menu-efeitos/efeitos-visuais')
  require('./fixtures/gun-download-buffer-mock')(efv)
  assert.equal(require.cache[require.resolve('@napi-rs/canvas')], undefined)
  const { Jimp, JimpMime } = require('jimp')
  const { executarExclusivo, LIMITES } = require('../func/renderizador-canvas')
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
      assert.ok(Buffer.isBuffer(await efv.compor.gun(foto)), 'reserva recupera após falha do filho')
    } finally { console.error = erroOriginal }
    console.log('OK: filho com falha não quebra loader/bot; erro amigável e recuperação sem binding no pai.')
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
      const thumb = await Jimp.read(Buffer.from(saida.jpegThumbnail, 'base64'))
      assert.equal(thumb.width, 64, 'FFmpeg real deve gerar a miniatura, sem cair no fallback')
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
    assert.ok(Buffer.isBuffer(await efv.compor.gun(foto)), 'reserva recupera após imagem inválida')

    // Uma ativa, NENHUMA aguardando, sem download adicional.
    let liberar
    const portao = new Promise(resolve => { liberar = resolve })
    efv._injetar({ baixarMidia: async () => { downloads++; await portao; return foto } })
    const pendente = gun.executar(sock, 'offline', entrada)
    await new Promise(resolve => setImmediate(resolve))
    const antes = downloads, antesFilhos = filhos
    for (let i = 0; i < 3; i++) assert.match((await executar(entrada))[0].text, /ocupado/)
    assert.equal(downloads, antes)
    assert.equal(filhos, antesFilhos)
    liberar()
    await pendente
    // A reserva também permanece até terminar o envio (após render + FFmpeg).
    let envioIniciado, terminarEnvio
    const iniciou = new Promise(resolve => { envioIniciado = resolve })
    const esperarEnvio = new Promise(resolve => { terminarEnvio = resolve })
    const ativo = gun.executar({ sendMessage: async () => { envioIniciado(); await esperarEnvio } }, 'offline', entrada)
    await iniciou
    assert.match((await executar(entrada))[0].text, /ocupado/)
    terminarEnvio(); await ativo
    await assert.rejects(executarExclusivo(async () => { throw new Error('desenho') }), /desenho/)
    const rss = process.memoryUsage, disponivel = process.availableMemory
    try {
      process.memoryUsage = () => ({ rss: LIMITES.rssBot + 1 })
      assert.match((await executar(entrada))[0].text, /Memória insuficiente/)
      process.memoryUsage = rss; process.availableMemory = () => LIMITES.livre - 1
      assert.match((await executar(entrada))[0].text, /Memória insuficiente/)
    } finally { process.memoryUsage = rss; process.availableMemory = disponivel }
    const contador = filhos
    for (const [w, h] of [[10000, 480], [4000, 3000]]) {
      const enorme = Buffer.from(foto); enorme.writeUInt32BE(w, 16); enorme.writeUInt32BE(h, 20)
      efv._injetar({ baixarMidia: async () => enorme })
      assert.match((await executar(entrada))[0].text, /8 megapixels/)
    }
    assert.equal(filhos, contador, 'dimensões recusadas antes de iniciar decoder')
    efv._injetar({ baixarMidia: async () => foto })
    falhaMiniatura = true
    const fallback = await executar(entrada)
    falhaMiniatura = false
    assert.ok(Buffer.isBuffer(fallback[0].image), 'falha de FFmpeg não impede envio da imagem')
    assert.equal((await Jimp.read(Buffer.from(fallback[0].jpegThumbnail, 'base64'))).width, 8)
    const antesTmp = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('hipnos-render-'))
    for (const caso of ['fatal', 'timeout']) {
      falhaProcesso = caso
      assert.match((await executar(entrada))[0].text, /Não consegui aplicar/)
      falhaProcesso = ''
      assert.ok(Buffer.isBuffer(await efv.compor.gun(foto)))
    }
    await efv.compor.gun(foto)
    assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('hipnos-render-')), antesTmp)
    await gun.executar({ sendMessage: () => { throw new Error('socket indisponível') } }, 'offline', entrada)
    assert.ok(Buffer.isBuffer(await efv.compor.gun(foto)), 'falha de envio não mantém reserva')
    console.log('OK: visual/fluxo, nenhuma fila/download extra, reserva até envio, limites de memória/pixels, filho fatal/timeout e limpeza.')
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
    const grande = await new Jimp({ width: 4096, height: 2048, color: 0x3366ccff }).getBuffer(JimpMime.jpeg)
    global.gc()
    const inicial = process.memoryUsage().rss
    picoPai = inicial; picoConjunto = inicial
    const timer = setInterval(amostrar, 5)
    try { for (let i = 0; i < 20; i++) {
      efv._injetar({ baixarMidia: async () => i % 4 === 0 ? grande : foto })
      const saidas = await executar(reply({ imageMessage: {} }))
      assert.ok(Buffer.isBuffer(saidas[0]?.image), 'render + FFmpeg devem completar')
    } } finally { clearInterval(timer) }
    global.gc()
    const final = process.memoryUsage().rss
    // Worker termina antes do FFmpeg: não somar picos de fases que não coexistem.
    // 64 MiB para FFmpeg se não medido; 32 MiB adicionais de margem operacional.
    const estimativa = 287 * 1024 * 1024 + Math.max(0, picoPai - inicial) + Math.max(picoWorker, picoFfmpeg, 64 * 1024 * 1024) + 32 * 1024 * 1024
    assert.ok(picoConjunto < 512 * 1024 * 1024, `pico amostrado ${mb(picoConjunto)} MiB`)
    assert.ok(estimativa < 512 * 1024 * 1024, `estimativa com base 287 MiB ${mb(estimativa)} MiB`)
    assert.ok(final - inicial < 96 * 1024 * 1024, `crescimento retido ${mb(final - inicial)} MiB`)
    console.log('OK: memória, 20 fluxos completos (5 JPEG 4096x2048): ' + JSON.stringify({ node: process.version, plataforma: process.platform, rssInicialMiB: mb(inicial), picoPaiMiB: mb(picoPai), picoWorkerMiB: mb(picoWorker), picoFfmpegLinuxMiB: mb(picoFfmpeg), picoConjuntoAmostradoLinuxMiB: process.platform === 'linux' ? mb(picoConjunto) : null, rssFinalMiB: mb(final), estimativaComBase287MiB: mb(estimativa) }))
  }
  if (modo !== 'visual') assert.equal(tentativasCanvas, 0, 'gun não deve tentar node-canvas')
}
