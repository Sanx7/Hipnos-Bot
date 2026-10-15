// Integração real SOMENTE em banco explicitamente identificado como teste.
// Não importa config.js e não lê/reutiliza variáveis de conexão de produção.
// Usa RPG_TEST_MONGO_URI já existente, ou JORNAL_TEST_MONGO_URI explicitamente.
// Coleções novas por execução; sem drop/delete/limpeza de coleções existentes.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { MongoClient, MongoNetworkError } = require('mongodb')
const executarFilho = promisify(execFile)
const arquivo = path.join(__dirname, '..', 'dados', 'captura-diaria.js')
const fonte = fs.readFileSync(arquivo, 'utf8')
const pausa = ms => new Promise(resolve => setTimeout(resolve, ms))
const serializar = x => JSON.parse(JSON.stringify(x))
const mensagens = doc => doc.mensagens.map(m => ({ autor: m.autor, texto: m.texto, hora: m.hora }))
let cliente
const evidencias = { testes: [], cortesSocket: 0, errosTransporte: 0, confirmacoesDescartadas: 0, repeticoes: 0 }

function configuracaoTeste() {
  // Ler somente as duas chaves de testes. Não executar o parser da aplicação,
  // nem copiar o ambiente completo para processos filhos ou para o módulo.
  const nomes = ['JORNAL_TEST_MONGO_URI', 'RPG_TEST_MONGO_URI']
  const texto = nomes.some(n => process.env[n]) ? '' : fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  for (const nome of nomes) {
    const linha = texto.split(/\r?\n/).find(l => new RegExp('^\\s*' + nome + '\\s*=').test(l))
    let uri = process.env[nome] || (linha && linha.slice(linha.indexOf('=') + 1).trim())
    if (!uri) continue
    if ((uri.startsWith('"') && uri.endsWith('"')) || (uri.startsWith("'") && uri.endsWith("'"))) uri = uri.slice(1, -1)
    let destino
    try { destino = new URL(uri) } catch { throw new Error('URI_TESTE_INVALIDA') }
    const banco = destino.pathname.slice(1)
    if (destino.protocol !== 'mongodb+srv:' || !destino.hostname || destino.hash || destino.port ||
        !/^hipnos_(?:rpg|jornal)_test(?:es)?(?:_[a-z0-9]+)?$/i.test(banco)) throw new Error('BANCO_TESTE_NAO_IDENTIFICADO')
    return { uri, banco, variavel: nome }
  }
  throw new Error('CONFIGURACAO_EXPLICITA_DE_TESTE_AUSENTE')
}

function nomesExecucao(run) {
  if (!/^[a-f0-9]{32}$/.test(run)) throw new Error('EXECUCAO_INVALIDA')
  return { jornal: `jornal_test_${run}`, ttl: `jornal_ttl_${run}` }
}

function carregar(colecao, relogio) {
  const m = { exports: {} }, logs = []
  class Data extends Date {
    constructor(...args) { super(...(args.length ? args : [relogio.agora])) }
    static now() { return relogio.agora }
  }
  vm.runInNewContext(fonte, {
    module: m, exports: m.exports, Date: Data, process: { env: {} },
    require(nome) {
      if (nome === 'mongodb') return { MongoClient: class { constructor() { throw new Error('PROVIDER_PRODUCAO_PROIBIDO') } } }
      if (nome === '@whiskeysockets/baileys') return { normalizeMessageContent: m => m }
      if (nome === 'node:crypto') return require(nome)
      throw new Error('DEPENDENCIA_NAO_PERMITIDA')
    },
    console: { error: () => logs.push('persistencia_ou_leitura_adiada') }
  }, { filename: arquivo })
  m.exports._injetarColecao(colecao)
  return { captura: m.exports, logs }
}

function colecaoRestrita(raw, run, controles = {}) {
  const validar = filtro => {
    if (!/^000\d+@g\.us$/.test(filtro.grupo) || !/^\d{4}-\d{2}-\d{2}$/.test(filtro.data)) throw new Error('FILTRO_FORA_DO_TESTE')
    return { ...filtro, jornalTestRun: run }
  }
  return {
    findOne: (f, o) => raw.findOne(validar(f), o),
    async updateOne(f, u, o) {
      assert(Array.isArray(u), 'o pipeline real precisa chegar ao servidor')
      const filtro = validar(f)
      if (controles.antes) await controles.antes({ filtro, u, o })
      if (controles.reter) controles.ultimo = { filtro: structuredClone(filtro), u: structuredClone(u), o: structuredClone(o) }
      let resultado
      try { resultado = await raw.updateOne(filtro, u, o) }
      catch (e) { if (e.name?.includes('Network') || e.name?.includes('PoolCleared')) evidencias.errosTransporte++; throw e }
      if (controles.depois) await controles.depois({ filtro, u, o, resultado })
      return resultado
    }
  }
}

function capturar(c, grupo, i, texto = `mensagem ${i}`) {
  c.capturarMensagem({ key: { id: `teste-${i}`, fromMe: false }, pushName: 'Teste', message: { conversation: texto } }, grupo)
}
async function drenar(c) { await c._aguardarPersistencia() }
async function verificar(nome, fn) {
  console.log('INICIO: ' + nome)
  await fn()
  evidencias.testes.push(nome)
  console.log('PASSOU: ' + nome)
}

async function main() {
  const cfg = configuracaoTeste()
  const filho = process.argv[2] === '--reinicio'
  const run = filho ? process.argv[3] : randomUUID().replace(/-/g, '')
  const nomes = nomesExecucao(run)
  evidencias.banco = cfg.banco; evidencias.variavel = cfg.variavel; evidencias.run = run; evidencias.colecoes = nomes
  cliente = new MongoClient(cfg.uri, {
    appName: 'hipnos-jornal-teste-isolado', serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000, socketTimeoutMS: 15000, maxPoolSize: 5,
    retryWrites: false, monitorCommands: true
  })
  await cliente.connect()
  const banco = cliente.db(cfg.banco)
  const hello = await banco.command({ hello: 1 })
  const versao = await banco.command({ buildInfo: 1 })
  evidencias.servidor = versao.version
  const raw = banco.collection(nomes.jornal)
  const clock = { agora: filho ? Number(process.argv[5]) : new Date(hello.localTime).getTime() + 172800000 }
  if (!Number.isFinite(clock.agora)) throw new Error('RELOGIO_INVALIDO')
  const col = colecaoRestrita(raw, run)
  if (filho) {
    const grupo = process.argv[4]
    const c = carregar(col, clock).captura
    const recuperado = await c.lerAcumulado(grupo)
    assert.deepEqual(recuperado.mensagens.map(m => m.texto).join('|'), 'mensagem 1|mensagem 2')
    capturar(c, grupo, 3); await drenar(c)
    const doc = await col.findOne({ grupo, data: c.chaveDataLocal() })
    assert.deepEqual(doc.mensagens.map(m => m.texto), ['mensagem 1', 'mensagem 2', 'mensagem 3'])
    console.log('REINICIO_REAL_OK')
    return
  }
  // Nunca reutilizar namespace anterior, nem se estiver vazio.
  await banco.createCollection(nomes.jornal)
  await banco.createCollection(nomes.ttl)
  await raw.createIndex({ grupo: 1, data: 1 }, { unique: true, name: 'idx_jornal_grupo_data' })
  await raw.createIndex({ expiraEm: 1 }, { expireAfterSeconds: 0, name: 'idx_jornal_ttl' })
  const ttl = banco.collection(nomes.ttl)
  await ttl.createIndex({ expiraEm: 1 }, { expireAfterSeconds: 0 })
  console.log(JSON.stringify({ banco: cfg.banco, variavel: cfg.variavel, servidor: versao.version, run, colecoes: nomes }))
  // O monitor TTL é assíncrono. Iniciar a prova agora, enquanto os outros
  // cenários executam. Somente este documento sintético pode ser removido.
  const provaTtl = { _id: `ttl-${run}`, jornalTestRun: run, expiraEm: new Date(new Date(hello.localTime).getTime() - 3600000) }
  await ttl.insertOne(provaTtl, { writeConcern: { w: 'majority' } })
  const gid = n => `000${run.slice(0, 8).replace(/[a-f]/g, '1')}${n}@g.us`
  const novo = (n, controles) => {
    const wrapper = colecaoRestrita(raw, run, controles)
    const contexto = carregar(wrapper, clock)
    return { ...contexto, col: wrapper, grupo: gid(n), data: contexto.captura.chaveDataLocal() }
  }
  const ler = t => col.findOne({ grupo: t.grupo, data: t.data })

  await verificar('pipeline real, literais e campos de conteúdo', async () => {
    const t = novo(1)
    capturar(t.captura, t.grupo, 1, '$campo $$ROOT café 🎉')
    await drenar(t.captura)
    const doc = await ler(t)
    assert.deepEqual(mensagens(doc), [{ autor: 'Teste', texto: '$campo $$ROOT café 🎉', hora: clock.agora }])
    assert.equal(doc._jornalRevisao, 1)
  })

  await verificar('100 mensagens simultâneas no mesmo grupo, em ordem', async () => {
    const t = novo(2)
    await Promise.all(Array.from({ length: 100 }, (_, i) => Promise.resolve().then(() => capturar(t.captura, t.grupo, i))))
    await drenar(t.captura)
    assert.deepEqual((await ler(t)).mensagens.map(m => m.texto), Array.from({ length: 100 }, (_, i) => `mensagem ${i}`))
  })

  await verificar('grupos diferentes persistem sem misturar conteúdo', async () => {
    const t = novo(3), outro = gid(4)
    for (let i = 0; i < 50; i++) { capturar(t.captura, t.grupo, i, `A${i}`); capturar(t.captura, outro, i, `B${i}`) }
    await drenar(t.captura)
    assert.deepEqual((await ler(t)).mensagens.map(m => m.texto), Array.from({ length: 50 }, (_, i) => `A${i}`))
    assert.deepEqual((await col.findOne({ grupo: outro, data: t.data })).mensagens.map(m => m.texto), Array.from({ length: 50 }, (_, i) => `B${i}`))
  })

  await verificar('500 e 501 entradas e ordem exata da janela', async () => {
    const t = novo(5)
    for (let i = 0; i < 500; i++) capturar(t.captura, t.grupo, i)
    await drenar(t.captura)
    assert.equal((await ler(t)).mensagens.length, 500)
    capturar(t.captura, t.grupo, 500); await drenar(t.captura)
    assert.deepEqual((await ler(t)).mensagens.map(m => m.texto), Array.from({ length: 500 }, (_, i) => `mensagem ${i + 1}`))
  })

  await verificar('documento legado e recuperação antes da primeira nova captura', async () => {
    const t = novo(6)
    const antigo = { autor: 'Legado', texto: 'antes do reinício', hora: clock.agora - 1 }
    await raw.insertOne({ grupo: t.grupo, data: t.data, jornalTestRun: run, mensagens: [antigo], outroCampo: 'preservar', expiraEm: t.captura.proximaMeiaNoiteLocal() })
    capturar(t.captura, t.grupo, 1); await drenar(t.captura)
    const doc = await ler(t)
    assert.deepEqual(mensagens(doc), [antigo, { autor: 'Teste', texto: 'mensagem 1', hora: clock.agora }])
    assert.equal(doc.outroCampo, 'preservar')
  })

  await verificar('recuperação e nova captura em processo Node reiniciado', async () => {
    const t = novo(7)
    capturar(t.captura, t.grupo, 1); capturar(t.captura, t.grupo, 2); await drenar(t.captura)
    const env = { [cfg.variavel]: cfg.uri }
    for (const nome of ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[nome]) env[nome] = process.env[nome]
    const resultado = await executarFilho(process.execPath, [__filename, '--reinicio', run, t.grupo, String(clock.agora)], { env, timeout: 60000, windowsHide: true })
    assert(resultado.stdout.includes('REINICIO_REAL_OK'))
    assert.deepEqual((await ler(t)).mensagens.map(m => m.texto), ['mensagem 1', 'mensagem 2', 'mensagem 3'])
  })

  await verificar('confirmação perdida após gravação majority não duplica', async () => {
    let falhas = 1
    const t = novo(8, { depois: () => { if (falhas-- > 0) { evidencias.confirmacoesDescartadas++; throw new MongoNetworkError('CONFIRMACAO_TESTE_DESCARTADA') } } })
    capturar(t.captura, t.grupo, 1); capturar(t.captura, t.grupo, 2); await drenar(t.captura)
    assert.deepEqual((await ler(t)).mensagens.map(m => m.texto), ['mensagem 1', 'mensagem 2'])
    assert.equal((await ler(t))._jornalRevisao, 2)
  })

  await verificar('duas confirmações perdidas e retomada em instância nova', async () => {
    let falhas = 2
    const t = novo(9, { depois: () => { if (falhas-- > 0) { evidencias.confirmacoesDescartadas++; throw new MongoNetworkError('CONFIRMACAO_TESTE_DESCARTADA') } } })
    capturar(t.captura, t.grupo, 1); await drenar(t.captura)
    const reiniciado = carregar(col, clock).captura
    assert.equal((await reiniciado.lerAcumulado(t.grupo)).mensagens.length, 1)
    capturar(reiniciado, t.grupo, 2); await drenar(reiniciado)
    await drenar(t.captura)
    assert.deepEqual((await ler(t)).mensagens.map(m => m.texto), ['mensagem 1', 'mensagem 2'])
  })

  await verificar('repetição do mesmo pipeline é no-op no servidor', async () => {
    const controles = { reter: true }, t = novo(10, controles)
    capturar(t.captura, t.grupo, 1); await drenar(t.captura)
    const antes = serializar(await ler(t)), op = controles.ultimo
    for (let i = 0; i < 3; i++) { await raw.updateOne(op.filtro, op.u, op.o); evidencias.repeticoes++ }
    assert.deepEqual(serializar(await ler(t)), antes)
  })

  await verificar('corte real de socket de teste e recuperação sem duplicação', async () => {
    const t = novo(11)
    let armado = true
    const cortar = evento => {
      if (!armado || evento.commandName !== 'update' || evento.command.update !== nomes.jornal) return
      armado = false
      // Somente conexões já em uso DESTE cliente de testes. Sem administração
      // do cluster, failpoints, alteração de firewall ou sockets de outros apps.
      for (const servidor of cliente.topology.s.servers.values()) {
        for (const conexao of servidor.pool.checkedOutConnections) { conexao.destroy(); evidencias.cortesSocket++ }
      }
    }
    cliente.on('commandStarted', cortar)
    try { capturar(t.captura, t.grupo, 1); await drenar(t.captura) }
    finally { cliente.off('commandStarted', cortar) }
    if (!await ler(t)) await drenar(t.captura)
    assert(evidencias.cortesSocket > 0)
    assert(evidencias.errosTransporte > 0)
    capturar(t.captura, t.grupo, 2); await drenar(t.captura)
    assert.deepEqual((await ler(t)).mensagens.map(m => m.texto), ['mensagem 1', 'mensagem 2'])
  })

  await verificar('virada do dia e TTL preservado, inclusive mínimo de 60s', async () => {
    const original = clock.agora
    const t = novo(12)
    const data = t.data
    clock.agora = Date.parse(data + 'T23:59:50-03:00')
    capturar(t.captura, t.grupo, 1); await drenar(t.captura)
    const antes = await ler(t)
    assert.equal(antes.expiraEm.getTime(), clock.agora + 60000)
    clock.agora += 70000
    capturar(t.captura, t.grupo, 2); await drenar(t.captura)
    const novoDia = t.captura.chaveDataLocal()
    assert.notEqual(novoDia, data)
    assert.deepEqual((await col.findOne({ grupo: t.grupo, data: novoDia })).mensagens.map(m => m.texto), ['mensagem 2'])
    assert.deepEqual(serializar(await ler(t)), serializar(antes))
    clock.agora = original
  })

  await verificar('índices reais e remoção automática de prova pelo monitor TTL', async () => {
    const indices = await raw.listIndexes().toArray()
    assert(indices.some(i => i.name === 'idx_jornal_ttl' && i.expireAfterSeconds === 0 && i.key.expiraEm === 1))
    assert(indices.some(i => i.name === 'idx_jornal_grupo_data' && i.unique))
    const limite = Date.now() + 180000
    while (await ttl.findOne({ _id: provaTtl._id, jornalTestRun: run })) {
      if (Date.now() > limite) throw new Error('TTL_NAO_OBSERVADO_NO_PRAZO')
      console.log('AGUARDANDO: monitor TTL do servidor')
      await pausa(5000)
    }
    evidencias.ttlRemovidoPeloServidor = true
  })
  console.log('RESULTADO: ' + JSON.stringify(evidencias))
}

main().catch(e => {
  // Não imprimir stack, URI, mensagem crua do driver ou stdout de filhos.
  console.error(JSON.stringify({ status: 'INTERROMPIDO', tipo: e.name, codigo: Number.isInteger(e.code) ? e.code : null, testesConcluidos: evidencias.testes, run: evidencias.run || null }))
  process.exitCode = 1
}).finally(async () => { await cliente?.close().catch(() => {}) })
