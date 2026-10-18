// Testes adicionais offline. Só esta suíte e suas fixtures; nenhum bot real.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')
const { once } = require('node:events')
const MiB = 1024 * 1024
const helper = path.join(__dirname, 'fixtures/gun-capacidade-helper.js')
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
process.env.DISABLE_CANVAS = 'true'
require('node:net').Socket.prototype.connect = function () { throw new Error('Rede proibida no teste') }
require('node:net').Server.prototype.listen = function () { throw new Error('Servidor proibido no teste') }
const existe = fs.existsSync
fs.existsSync = p => path.basename(String(p)).startsWith('.env') ? false : existe(p)

function grupoObrigatorio() {
  if (process.env.GUN_CI_CGROUP !== '1') return false
  assert.equal(process.platform, 'linux', 'CI precisa executar em Linux')
  for (const [arquivo, valor] of [['memory.max', String(512 * MiB)], ['memory.swap.max', '0'], ['memory.swap.current', '0']]) {
    assert.equal(fs.readFileSync('/sys/fs/cgroup/' + arquivo, 'utf8').trim(), valor, arquivo)
  }
  return true
}

async function encerrar(filho) {
  if (!filho || !filho.pid || filho.exitCode !== null || filho.signalCode !== null) return
  const fechado = once(filho, 'close')
  filho.kill('SIGKILL')
  await fechado
}

async function executarProcesso(args) {
  const filho = cp.spawn(process.execPath, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  if (process.env.GUN_CI_CGROUP === '1') {
    assert.equal(fs.readFileSync(`/proc/${filho.pid}/cgroup`, 'utf8'), fs.readFileSync('/proc/self/cgroup', 'utf8'), 'cenário/gerador fora do cgroup')
  }
  let stdout = '', stderr = ''
  filho.stdout.on('data', b => { stdout += b })
  filho.stderr.on('data', b => { stderr += b })
  const prazo = setTimeout(() => filho.kill('SIGKILL'), 120000)
  try {
    const [codigo, sinal] = await once(filho, 'close')
    assert.equal(codigo, 0, `${args[1]}: código=${codigo} sinal=${sinal}\n${stdout}\n${stderr}`)
    return stdout.trim()
  } finally { clearTimeout(prazo); await encerrar(filho) }
}

async function principal() {
  grupoObrigatorio()
  if (process.argv[2]) return cenario(process.argv[2], process.argv[3])
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'hipnos-gun-capacidade-'))
  try {
    const geracao = await executarProcesso(['--expose-gc', helper, 'gerar', pasta])
    console.log('FIXTURES=' + geracao)
    for (const caso of ['png', 'jpeg', 'limite', 'acima', 'interrompido', 'abertura', 'timeout', 'cancelado', 'base287', 'midias', 'concorrencia']) {
      console.log(await executarProcesso(['--expose-gc', __filename, caso, pasta]))
    }
  } finally { fs.rmSync(pasta, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
}

async function cenario(caso, pasta) {
  const limitado = grupoObrigatorio()
  const grupo = limitado ? fs.readFileSync('/proc/self/cgroup', 'utf8') : null
  const originalExec = cp.execFile
  const ativos = new Map()
  let picoFilho = 0, picoDownload = 0, picoPai = 0, picoConjunto = 0, picoFfmpeg = 0, picoMidias = 0, renders = 0, ffmpegs = 0, downloads = 0, recebidos = 0
  let modoDownload = caso, cancelador
  let bytesOrigem = 0
  const arquivosDownload = new Set()
  let parcialObservado = false
  function acompanhar(filho, papel) {
    if (!filho.pid) return filho
    ativos.set(filho.pid, papel)
    if (limitado) assert.equal(fs.readFileSync(`/proc/${filho.pid}/cgroup`, 'utf8'), grupo, 'filho fora do cgroup dos testes')
    filho.once('close', () => ativos.delete(filho.pid))
    return filho
  }
  const memoriaOriginal = process.memoryUsage
  function amostrar() {
    for (const arquivo of arquivosDownload) try {
      const tamanho = fs.statSync(arquivo).size
      assert.ok(tamanho <= 20 * MiB, 'temporário excedeu 20 MiB')
      if (tamanho > 0 && tamanho < 20 * MiB) parcialObservado = true
    } catch (erro) { if (erro.code !== 'ENOENT') throw erro }
    const pai = memoriaOriginal().rss
    picoPai = Math.max(picoPai, pai)
    let conjunto = pai
    let midias = 0
    if (process.platform === 'linux') for (const [pid, papel] of ativos) {
      try {
        const rss = Number(fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) * 1024
        conjunto += rss
        if (papel === 'ffmpeg') picoFfmpeg = Math.max(picoFfmpeg, rss)
        if (papel === 'midia') midias += rss
      } catch (_) {}
    }
    picoMidias = Math.max(picoMidias, midias)
    picoConjunto = Math.max(picoConjunto, conjunto)
  }
  cp.execFile = (file, args, options, callback) => {
    const render = args.some(a => a.endsWith('renderizador-canvas-worker.js'))
    const download = args.some(a => a.endsWith('gun-download-worker.js'))
    if (render) assert.ok(![...ativos.values()].includes('download'), 'download e render não podem coexistir')
    if (!download && !render) assert.ok(![...ativos.values()].some(p => p === 'download' || p === 'render'), 'FFmpeg do comando precisa aguardar os workers')
    if (download) {
      downloads++
      arquivosDownload.add(args.at(-1))
      assert.equal(options.env.MONGODB_URI, undefined)
      assert.equal(options.env.NODE_OPTIONS, undefined)
      assert.equal(options.timeout, 30000)
      args = [args[0], '--require', path.join(__dirname, 'fixtures/gun-download-offline.js'), ...args.slice(1)]
      options = { ...options, env: { ...options.env, GUN_FIXTURE_DIR: pasta } }
      if (['timeout', 'abertura'].includes(modoDownload)) options.timeout = 1500
      if (modoDownload === 'cancelado') {
        cancelador = new AbortController()
        options.signal = cancelador.signal
      }
    } else if (render) renders++; else ffmpegs++
    const filho = acompanhar(originalExec(file, args, options, (erro, stdout, stderr) => {
      if (download && modoDownload === 'acima') {
        bytesOrigem = JSON.parse(fs.readFileSync(path.join(pasta, `origem-${filho.pid}.json`), 'utf8')).bytesOrigem
      }
      if (render && !erro) picoFilho = Math.max(picoFilho, JSON.parse(stdout).picoRssBytes)
      if (download && stdout.trim()) {
        const dados = JSON.parse(stdout)
        picoDownload = Math.max(picoDownload, dados.picoRssBytes)
        recebidos = dados.bytesRecebidos || dados.bytes || 0
      }
      amostrar(); callback(erro, stdout, stderr)
    }), download ? 'download' : render ? 'render' : 'ffmpeg')
    if (download && modoDownload === 'cancelado') {
      // Cancelar após confirmar que o filho está ativo, enquanto fetch aguarda.
      const prazo = setTimeout(() => cancelador.abort(), 1000)
      filho.once('close', () => clearTimeout(prazo))
    }
    return filho
  }
  const efeitos = require('../comandos/menu-efeitos/efeitos-visuais')
  const { LIMITES } = require('../func/renderizador-canvas')
  const { Jimp } = require('jimp')
  const gun = efeitos.find(c => c.nome === 'gun')
  const nomeEntrada = () => ['timeout', 'cancelado'].includes(modoDownload) ? 'timeout' : ['interrompido', 'abertura'].includes(modoDownload) ? modoDownload : path.basename(entrada)
  const mensagem = () => ({ key: { id: 'offline' }, message: { imageMessage: {
    caption: '/gun', url: 'https://offline.invalid/' + nomeEntrada(), mediaKey: Buffer.alloc(32)
  } } })
  const conteudos = []
  const sock = { sendMessage: async (_, conteudo) => { conteudos.push(conteudo) } }
  const entrada = path.join(pasta, caso === 'midias' ? 'media.png' : caso === 'jpeg' ? 'detalhada.jpg' : caso === 'limite' ? 'limite.png' : caso === 'acima' ? 'acima.png' : 'detalhada.png')
  const inicial = process.memoryUsage().rss
  picoPai = inicial
  if (caso === 'base287') {
    const ajuste = Math.max(0, 287 * MiB - inicial)
    // Modelo de admissão, não reservar 287 MiB reais nem fingir executar o bot.
    process.memoryUsage = () => ({ ...memoriaOriginal(), rss: memoriaOriginal().rss + ajuste })
  }
  const timer = setInterval(amostrar, 5)
  const temporarios = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('hipnos-render-')).sort()
  let tarefaPressao
  const midias = []
  let protecao = 'nao_aplicavel'
  try {
    if (caso === 'concorrencia' || caso === 'midias') {
      const { caminhoFfmpeg } = require('../comandos/menu-utilitario/audio-extrator')
      for (let i = 0; i < 2; i++) {
        const filho = acompanhar(cp.spawn(caminhoFfmpeg(), ['-nostdin', '-threads', '1', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=10', '-t', '30', '-threads', '1', '-filter_threads', '1', '-f', 'null', '-'], { stdio: 'ignore', windowsHide: true }), 'midia')
        midias.push(filho)
        await once(filho, 'spawn')
      }
      // Dar tempo para iniciar os filtros, sem permitir tarefas órfãs.
      await new Promise(resolve => setTimeout(resolve, 300))
      assert.ok(midias.every(f => f.exitCode === null && f.signalCode === null), 'tarefas FFmpeg devem estar ativas')
    }
    if (caso === 'concorrencia') {
      if (limitado) {
        tarefaPressao = acompanhar(cp.fork(helper, ['pressao'], { execArgv: ['--max-old-space-size=32'], env: process.env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true }), 'pressao')
        const pronto = await Promise.race([
          once(tarefaPressao, 'message').then(([m]) => m),
          once(tarefaPressao, 'close').then(() => { throw new Error('Pressão controlada não alcançada com segurança') })
        ])
        assert.ok(pronto.pronto)
        assert.ok(process.availableMemory() < LIMITES.livre, 'pressão precisa ser real, não mockada')
        protecao = 'cgroup_real'
        console.log('PRESSAO=' + JSON.stringify(pronto))
      } else {
        protecao = 'simulada_sem_cgroup_local'
        console.log('LIMITAÇÃO: pressão real de RAM não executada fora do cgroup Linux 512 MiB sem swap.')
      }
      const livre = process.availableMemory
      try {
        if (!limitado) process.availableMemory = () => LIMITES.livre - 1
        for (let i = 0; i < 3; i++) {
          conteudos.length = 0
          await gun.executar(sock, 'offline', mensagem())
          assert.match(conteudos[0]?.text || '', /Memória insuficiente/)
        }
        assert.equal(downloads, 0, 'pressão deve bloquear antes do download')
        assert.equal(renders, 0); assert.equal(ffmpegs, 0)
      } finally { process.availableMemory = livre; await encerrar(tarefaPressao); tarefaPressao = null }
      // Remover pressão artificial e tarefas de mídia, antes de testar retomada.
      for (const filho of midias) await encerrar(filho)
    }
    conteudos.length = 0
    const tarefa = gun.executar(sock, 'offline', mensagem())
    if (caso === 'cancelado') {
      while (!downloads) await new Promise(resolve => setImmediate(resolve))
      const extras = []
      for (let i = 0; i < 3; i++) await gun.executar({ sendMessage: async (_, c) => extras.push(c) }, 'offline', mensagem())
      assert.ok(extras.every(c => /ocupado/.test(c.text)))
      assert.equal(downloads, 1, 'nenhum download adicional enquanto aguarda o transporte')
    }
    await tarefa
    if (caso === 'acima') {
      assert.match(conteudos[0]?.text || '', /grande demais/)
      assert.equal(renders, 0); assert.equal(ffmpegs, 0)
      assert.ok(recebidos > LIMITES.bytes && recebidos <= LIMITES.bytes + 65536, 'corte no primeiro chunk acima de 20 MiB')
      assert.ok(recebidos < fs.statSync(entrada).size + 64 * 65536, 'não receber toda a cauda')
      assert.ok(bytesOrigem < fs.statSync(entrada).size + 64 * 65536, 'a origem também precisa parar antes de fornecer o arquivo inteiro')
    } else if (['interrompido', 'abertura', 'timeout', 'cancelado'].includes(caso)) {
      assert.match(conteudos[0]?.text || '', /Não consegui aplicar/)
      assert.equal(renders, 0); assert.equal(ffmpegs, 0)
      assert.equal(ativos.size, 0, 'download precisa terminar antes de liberar a reserva')
      if (['timeout', 'cancelado'].includes(caso)) assert.ok(parcialObservado, 'timeout/cancelamento precisa ocorrer após gravar parte do arquivo')
      assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('hipnos-render-')).sort(), temporarios)
      // Recuperação com stream real e imagem grande depois de cada falha.
      modoDownload = 'png'; conteudos.length = 0
      await gun.executar(sock, 'offline', mensagem())
      assert.ok(Buffer.isBuffer(conteudos[0]?.image), 'recuperação após download interrompido')
    } else {
      if (caso === 'base287') protecao = 'rss_modelado_base287_sem_recusa'
      if (!Buffer.isBuffer(conteudos[0]?.image)) {
        console.log('RECUSA_INESPERADA=' + JSON.stringify({ caso, downloads, renders,
          memoria: /Memória insuficiente/.test(conteudos[0]?.text || ''),
          rssPaiBytes: memoriaOriginal().rss, livreBytes: process.availableMemory(), picoPaiBytes: picoPai }))
      }
      assert.ok(Buffer.isBuffer(conteudos[0]?.image), 'entrada válida deve completar após liberação da pressão')
      const imagem = await Jimp.read(conteudos[0].image)
      assert.equal(imagem.width, 480); assert.equal(imagem.height, 480)
      const tamanho = fs.statSync(entrada).size
      const cx = 240 + tamanho % 61 - 30, cy = 240 + tamanho % 47 - 23
      assert.equal(imagem.getPixelColor(cx, cy), 0xff0000ff)
      assert.equal((await Jimp.read(Buffer.from(conteudos[0].jpegThumbnail, 'base64'))).width, 64)
      assert.equal(renders, 1); assert.equal(ffmpegs, 1)
      if (caso === 'midias') assert.ok(midias.every(f => f.exitCode === null && f.signalCode === null), 'mídias devem coexistir com o /gun até completar')
    }
    assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('hipnos-render-')).sort(), temporarios)
  } finally {
    clearInterval(timer)
    await encerrar(tarefaPressao)
    for (const filho of midias) await encerrar(filho)
    cp.execFile = originalExec
    process.memoryUsage = memoriaOriginal
  }
  const mb = n => +(n / MiB).toFixed(2)
  const estimativa = 287 * MiB + Math.max(0, picoPai - inicial) + Math.max(picoDownload, picoFilho, picoFfmpeg, 64 * MiB) + 32 * MiB
  if (['png', 'jpeg', 'limite', 'base287'].includes(caso)) {
    assert.ok(estimativa < 512 * MiB, 'projeção com o bot de 287 MiB excede o teto')
  }
  // Estimativa não substitui cgroup e não inclui tarefas externas arbitrárias.
  console.log('CAPACIDADE=' + JSON.stringify({ caso, plataforma: process.platform, bytes: fs.statSync(entrada).size,
    rssInicialMiB: mb(inicial), picoPaiMiB: mb(picoPai), picoDownloadMiB: mb(picoDownload), picoWorkerMiB: mb(picoFilho),
    picoSubarvoreLinuxMiB: process.platform === 'linux' ? mb(picoConjunto) : null,
    picoFfmpegLinuxMiB: process.platform === 'linux' ? mb(picoFfmpeg) : null,
    picoMidiasLinuxMiB: process.platform === 'linux' ? mb(picoMidias) : null,
    estimativaComBase287MiB: ['png', 'jpeg', 'limite', 'base287'].includes(caso) ? mb(estimativa) : null,
    picoPaiProjetadoBase287MiB: caso === 'base287' ? mb(287 * MiB + Math.max(0, picoPai - inicial)) : null,
    margem448MiB: ['png', 'jpeg', 'limite', 'base287'].includes(caso) ? estimativa <= 448 * MiB : null,
    downloads, renders, bytesRecebidos: recebidos, bytesOrigem: bytesOrigem || null, parcialObservado,
    protecao, cgroupVerificado: limitado }))
}

principal().catch(err => { console.error(err); process.exitCode = 1 })
