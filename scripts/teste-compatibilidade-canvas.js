// Offline: processos isolados, Canvas ausente/quebrado e inicialização real em VM.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const Module = require('node:module')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const raiz = path.resolve(__dirname, '..')
const dependentes = [
  'attp', 'brat', 'bratvid', 'kiss', 'kissme', 'ship', 'shipme', 'clown',
  'slap', 'spank', 'batslap', 'beautiful', 'bobross', 'ad', 'rip', 'apagar',
  'glitchgif', 'rotacao3d', 'fogogif', 'derreter', 'naoolhe', 'falha', 'impostor', 'gun'
]

async function cenario(modo) {
  process.env.MONGODB_URI = ''
  process.env.MONGO_URI_RPG = ''
  process.env.DISABLE_CANVAS = modo.startsWith('normal') ? 'false' : 'true'
  // Nenhum teste deste arquivo pode abrir conexões externas.
  require('node:net').Socket.prototype.connect = function () { throw new Error('Rede proibida no teste offline') }
  let tentativasCanvas = 0
  const carregar = Module._load
  Module._load = function (nome, ...args) {
    if (nome === 'canvas' && modo !== 'normal-instalado') {
      tentativasCanvas++
      const erro = new Error('Canvas indisponível no cenário offline')
      erro.code = modo.endsWith('quebrado') ? 'ERR_DLOPEN_FAILED' : 'MODULE_NOT_FOUND'
      throw erro
    }
    return carregar.call(this, nome, ...args)
  }
  if (modo.startsWith('normal') && modo !== 'normal-instalado') {
    for (const arquivo of ['menu-fig/attp', 'menu-fig/brat', 'menu-efeitos/efeitos-imagem', 'menu-efeitos/efeitos-visuais']) {
      assert.throws(() => require(`../comandos/${arquivo}`), { code: modo.endsWith('quebrado') ? 'ERR_DLOPEN_FAILED' : 'MODULE_NOT_FOUND' })
    }
    assert.equal(tentativasCanvas, 4, 'modo normal não deve ocultar falhas do Canvas')
    return
  }

  const { limitarComandosCanvas } = require('../dados/compatibilidade-canvas')
  const original = async () => 'original'
  const livre = { nome: 'livre', executar: original }
  limitarComandosCanvas([livre], ['outro'])
  assert.equal(livre.executar, original)
  const registro = require('../comandos-registry').comandos
  const eventos = new Map()
  let criouSocket = false, abriuWeb = false, adquiriuLease = false
  const sock = { ev: { on: (nome, fn) => eventos.set(nome, fn) }, user: { id: 'offline@s.whatsapp.net' }, groupMetadata: async () => ({}), groupParticipantsUpdate: async () => [], sendMessage: async () => {}, end: async () => {} }
  const colecao = { findOne: async () => ({ creds: {} }) }
  const erros = []
  const requererBot = Module.createRequire(path.join(raiz, 'bot.js'))
  const contexto = {
    __dirname: raiz,
    console: { log(texto) { if (String(texto).startsWith('❌')) erros.push(texto) }, info() {}, warn() {}, error: (...args) => erros.push(args[0]) },
    process: { env: process.env, on() {}, once() {} },
    setTimeout() { throw new Error('Reconexão inesperada') }, clearTimeout() {},
    require(nome) {
      if (nome === 'express') return () => ({ get() {}, listen() { abriuWeb = true } })
      if (nome === '@whiskeysockets/baileys') return {
        ...requererBot(nome), default() { criouSocket = true; return sock }
      }
      if (nome === 'mongo-baileys') return { useMongoDBAuthState: async () => ({ state: {}, saveCreds: async () => {} }) }
      if (nome === './sessao-mongo') return { obterColecaoAuth: async () => colecao }
      if (nome === './dados/sessao-exclusiva') return { criarLease: () => ({
        adquirir: async () => { adquiriuLease = true }, vestir: c => c, valida: () => true, liberar: async () => {}
      }) }
      return requererBot(nome)
    }
  }
  const fonte = fs.readFileSync(path.join(raiz, 'bot.js'), 'utf8')
  const chamada = 'startBot().catch(tratarFalhaInicializacao);'
  assert.ok(fonte.endsWith(chamada + '\n') || fonte.trimEnd().endsWith(chamada))
  vm.runInNewContext(fonte.slice(0, fonte.lastIndexOf(chamada)) + 'globalThis.pronto = startBot();', contexto, { filename: 'bot.js' })
  await contexto.pronto
  assert.ok(criouSocket && abriuWeb && adquiriuLease, 'startup deve chegar ao socket com fronteiras externas mockadas')
  assert.deepEqual(erros, [], 'nenhum módulo pode falhar no loader')
  console.log('REGISTRO_CANVAS=' + JSON.stringify([...registro].map(([chave, cmd]) => ({
    chave, nome: cmd.nome, aliases: cmd.aliases || [], descricao: cmd.descricao,
    executar: createHash('sha256').update(cmd.executar.toString()).digest('hex')
  }))))
  for (const evento of ['creds.update', 'group-participants.update', 'messages.upsert', 'connection.update']) assert.ok(eventos.has(evento), evento)
  if (modo === 'normal-instalado') {
    for (const nome of dependentes) {
      assert.equal(typeof registro.get(nome)?.executar, 'function', nome)
      assert.doesNotMatch(registro.get(nome).executar.toString(), /DISABLE_CANVAS=true/, nome)
    }
    assert.ok(require('canvas').createCanvas(8, 8).toBuffer('image/png').length > 0)
    console.log(`OK: ${modo}; ${registro.size} entradas, Canvas nativo real; startup offline até socket.`)
    return
  }
  for (const nome of dependentes) {
    const cmd = registro.get(nome)
    assert.equal(typeof cmd?.executar, 'function', nome)
    const envios = []
    await cmd.executar({ sendMessage: async (...args) => envios.push(args) }, 'offline', {})
    assert.equal(envios.length, 1, nome)
    assert.match(envios[0][1].text, /DISABLE_CANVAS=true/, nome)
    for (const alias of cmd.aliases || []) assert.equal(registro.get(alias), cmd, alias)
  }
  // Mesmos módulos: execução efetiva de um filtro Jimp, sem Canvas ou API.
  const efeitos = require('../comandos/menu-efeitos/efeitos-imagem')
  const { Jimp, JimpMime } = require('jimp')
  const foto = await new Jimp({ width: 40, height: 40, color: 0x3366ccff }).getBuffer(JimpMime.png)
  efeitos._injetar({ fotoDePerfil: async () => ({ buffer: foto }) })
  const envios = []
  await registro.get('contraste').executar({ sendMessage: async (jid, conteudo) => envios.push(conteudo) }, 'offline', { key: { remoteJid: 'offline' } })
  assert.ok(envios.some(c => Buffer.isBuffer(c.image)), 'filtro Jimp continua gerando imagem')
  const visuais = require('../comandos/menu-efeitos/efeitos-visuais')
  assert.ok(Buffer.isBuffer(await visuais.compor.cerebro(foto)), 'composição Jimp continua ativa')
  for (const nome of ['textopulsar', 'ondasanim', 'vhs', 'entidade', 'conquista', 'cerebro', 'tiktok', 'play', 'perfil']) {
    assert.equal(typeof registro.get(nome)?.executar, 'function', nome)
    assert.doesNotMatch(registro.get(nome).executar.toString(), /DISABLE_CANVAS=true/, nome)
  }
  // jsdom é o único consumidor indireto: tenta Canvas e trata ausência nativamente.
  const jsdom = require('jsdom')
  assert.equal(new jsdom.JSDOM('<p>ok</p>').window.document.querySelector('p').textContent, 'ok')
  assert.equal(tentativasCanvas, 1, 'somente jsdom tenta carregar Canvas; comandos não tentam')
  console.log(`OK: ${modo}; ${registro.size} entradas, 24 recursos protegidos; startup offline até socket.`)
}

if (process.argv[2]) {
  cenario(process.argv[2]).then(() => process.exit(0), err => { console.error(err); process.exit(1) })
} else {
  // Isola o parser do .env real e verifica ausência, valores falsos e true.
  for (const [valor, esperado] of [[undefined, false], ['', false], ['false', false], ['0', false], ['1', false], ['yes', false], ['true', true], [' TRUE ', true]]) {
    const contexto = { __dirname: raiz, module: { exports: {} }, process: { env: valor === undefined ? {} : { DISABLE_CANVAS: valor } }, console,
      require: nome => nome === 'fs' ? { existsSync: () => false } : require(nome) }
    vm.runInNewContext(fs.readFileSync(path.join(raiz, 'config.js'), 'utf8'), contexto)
    assert.equal(contexto.module.exports.DISABLE_CANVAS, esperado, `config: ${valor}`)
  }
  console.log('OK: 8 verificações de DISABLE_CANVAS; somente true ativa o modo.')
  const registros = new Map()
  for (const modo of ['compativel-ausente', 'compativel-quebrado', 'normal-ausente', 'normal-quebrado', 'normal-instalado']) {
    const r = spawnSync(process.execPath, [__filename, modo], { cwd: raiz, encoding: 'utf8', timeout: 60000 })
    assert.equal(r.status, 0, `${modo}\n${r.stdout}\n${r.stderr}`)
    const linhas = r.stdout.trim().split(/\r?\n/)
    const snapshot = linhas.find(l => l.startsWith('REGISTRO_CANVAS='))
    if (snapshot) registros.set(modo, JSON.parse(snapshot.slice('REGISTRO_CANVAS='.length)))
    console.log(linhas.filter(l => !l.startsWith('REGISTRO_CANVAS=')).join('\n') || `OK: ${modo}; erro preservado.`)
  }
  const normal = registros.get('normal-instalado')
  for (const modo of ['compativel-ausente', 'compativel-quebrado']) {
    const compativel = registros.get(modo)
    assert.equal(compativel.length, normal.length, 'mesmo número de entradas nos dois modos')
    const alterados = new Set()
    for (let i = 0; i < normal.length; i++) {
      const { executar: fnNormal, ...metaNormal } = normal[i]
      const { executar: fnCompativel, ...metaCompativel } = compativel[i]
      assert.deepEqual(metaCompativel, metaNormal, 'nomes, aliases e descrições preservados')
      if (fnNormal !== fnCompativel) alterados.add(metaNormal.nome)
    }
    assert.deepEqual([...alterados].sort(), [...dependentes].sort(), 'exatamente os 24 comandos mudam de executor')
  }
  console.log('OK: comparação integral do registro; exatamente 24 comandos alterados, demais executores e metadados idênticos.')
  process.env.MONGODB_URI = ''
  process.env.MONGO_URI_RPG = ''
  process.env.DISABLE_CANVAS = 'false'
  const cmd = { nome: 'teste', executar: () => {} }, executar = cmd.executar
  require('../dados/compatibilidade-canvas').limitarComandosCanvas([cmd], ['teste'])
  assert.equal(cmd.executar, executar, 'modo normal preserva a função original')
  console.log('OK: modo normal mantém a identidade de executar.')
}
