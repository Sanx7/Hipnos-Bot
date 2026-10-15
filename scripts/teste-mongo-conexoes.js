// Offline: módulos completos em VM, sem config.js/.env ou driver de rede real.
// A comparação usa os arquivos originais de HEAD, sem checkout ou alteração.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const { BSON, ObjectId } = require('mongodb')
const perfis = [
  ['database.js', 'obterColecaoRanking'], ['afk.js', 'obterColecaoAfk'],
  ['avaliacoes.js', 'obterColecaoAvaliacoes'], ['sugestoes.js', 'obterColecaoSugestoes'],
  ['vip.js', 'obterColecaoVips'], ['modoadulto.js', 'obterColecaoModoAdulto'],
  ['lembretes.js', 'obterColecaoLembretes'], ['prefixo.js', 'obterColecao'],
  ['packs-figurinha.js', 'obterColecaoPacks'], ['configuracoes-grupo.js', 'obterColecaoConfiguracoes'],
  ['advertencias.js', 'obterColecaoAdvertencias'], ['dados/historico-apagadas.js', 'obterColecaoApagadas'],
  ['comandos/menu-brincadeiras/aleatorios.js', 'obterColecaoBrincadeiras']
]
const raiz = path.join(__dirname, '..')
const tick = () => new Promise(resolve => setImmediate(resolve))
const clonar = x => JSON.parse(JSON.stringify(x))
const codigos = { connect: 'CONNECT_TESTE', ping: 'PING_TESTE', index: 'INDICE_TESTE', operacao: 'REDE_TESTE' }
function ambiente(perfil, fonte) {
  const estado = { clientes: [], pings: 0, comandos: [], online: true, falhar: null, falhas: 0, bloqueio: null }
  function falha(tipo) {
    if (!estado.online || (estado.falhar === tipo && estado.falhas-- > 0)) {
      const e = new Error(codigos[tipo]); e.code = codigos[tipo]; throw e
    }
  }
  function registrar(comando) { estado.comandos.push(clonar(comando)) }
  class MongoClient {
    constructor(uri, opcoes) {
      assert.equal(uri, 'mongodb://offline.invalid/hipnos_testes')
      this.opcoes = clonar(opcoes); this.fechado = 0; this.colecoes = new Map()
      estado.clientes.push(this)
    }
    async connect() { await (estado.bloqueio || tick()); falha('connect'); return this }
    async close() { this.fechado++ }
    db(banco) {
      return {
        command: async cmd => { registrar({ ...cmd, $db: banco }); estado.pings++; falha('ping'); return { ok: 1 } },
        collection: nome => {
          const chave = banco + ':' + nome
          if (!this.colecoes.has(chave)) {
            const cursor = () => {
              const c = { sort: () => c, limit: () => c, skip: () => c,
                toArray: async () => { falha('operacao'); return [] } }
              return c
            }
            this.colecoes.set(chave, {
              createIndex: async (key, opts = {}) => { registrar({ createIndexes: nome, indexes: [{ key, ...opts }], $db: banco }); await tick(); falha('index') },
              findOne: async (filter, opts) => { registrar({ find: nome, filter, ...(opts ? { options: opts } : {}), $db: banco }); falha('operacao'); return null },
              find: (filter, opts) => { registrar({ find: nome, filter, ...(opts ? { options: opts } : {}), $db: banco }); return cursor() },
              insertOne: async doc => { registrar({ insert: nome, documents: [doc], $db: banco }); falha('operacao'); return { acknowledged: true, insertedId: 'id-offline' } },
              updateOne: async (q, u, opts) => { registrar({ update: nome, updates: [{ q, u, ...(opts || {}) }], $db: banco }); falha('operacao'); return { acknowledged: true, matchedCount: 1, modifiedCount: 1 } },
              countDocuments: async filter => { registrar({ count: nome, query: filter, $db: banco }); falha('operacao'); return 0 }
            })
          }
          return this.colecoes.get(chave)
        }
      }
    }
  }
  const m = { exports: {} }
  class Data extends Date { static now() { return 1791990000000 } }
  const limparNumero = n => String(n || '').split('@')[0].split(':')[0].replace(/\D/g, '')
  vm.runInNewContext(fonte + `\nmodule.exports.__getterTeste = ${perfil[1]};`, {
    module: m, exports: m.exports,
    require: nome => {
      if (nome === 'mongodb') return { MongoClient, ObjectId }
      if (nome.endsWith('/config')) return { limparNumero, ehDonoDoBot: () => false }
      if (nome.endsWith('/lid')) return { resolverLidParaTelefone: async () => null, resolverNumeroAlvo: async () => ({ numero: '', via: null }) }
      if (nome === './temas-vip') return {}
      if (nome === '@whiskeysockets/baileys') return { normalizeMessageContent: m => m }
      if (['node:async_hooks', 'node:crypto', 'crypto'].includes(nome)) return require(nome)
      throw new Error('Importação não permitida no teste: ' + nome)
    },
    process: { env: { MONGODB_URI: 'mongodb://offline.invalid/hipnos_testes', MONGODB_DB: 'hipnos_testes' } },
    Date: Data, console: { log() {}, error() {}, warn() {} }, setInterval, clearInterval, setTimeout, clearTimeout, Buffer
  }, { filename: perfil[0] })
  return { estado, api: m.exports, getter: m.exports.__getterTeste }
}

let aprovados = 0
const resumo = { modulos: perfis.length, cargaPorModulo: 100, antes: { pings: 0, clientes: 0, comandos: 0, bytesBson: 0 }, depois: { pings: 0, clientes: 0, comandos: 0, bytesBson: 0 }, concorrencia: { chamadasPorModulo: 20, clientesAntes: 0, clientesDepois: 0 } }
async function teste(nome, executar) { await executar(); aprovados++; console.log('PASSOU: ' + nome) }
function original(arquivo) { return execFileSync('git', ['show', 'HEAD:' + arquivo], { cwd: raiz, encoding: 'utf8', maxBuffer: 1024 * 1024 }) }
const atuais = new Map(perfis.map(p => [p[0], fs.readFileSync(path.join(raiz, p[0]), 'utf8')]))
const anteriores = new Map(perfis.map(p => [p[0], original(p[0])]))

async function main() {
  for (const perfil of perfis) {
    const arquivo = perfil[0], fonte = atuais.get(arquivo)
    await teste(arquivo + ': 20 inicializações simultâneas, cliente e coleção únicos', async () => {
      const t = ambiente(perfil, fonte)
      const cols = await Promise.all(Array.from({ length: 20 }, () => t.getter()))
      assert.equal(t.estado.clientes.length, 1)
      assert(cols.every(c => c === cols[0]))
      assert.equal(t.estado.clientes[0].fechado, 0)
      const baseline = ambiente(perfil, anteriores.get(arquivo))
      await Promise.all(Array.from({ length: 20 }, () => baseline.getter()))
      resumo.concorrencia.clientesAntes += baseline.estado.clientes.length
      resumo.concorrencia.clientesDepois += t.estado.clientes.length
      assert.deepEqual(t.estado.clientes[0].opcoes, baseline.estado.clientes[0].opcoes)
    })
    const fases = ['connect', ...(arquivo.includes('historico-') ? [] : ['ping']), ...(arquivo === 'prefixo.js' ? [] : ['index'])]
    for (const fase of fases) await teste(arquivo + ': falha de ' + fase + ' fecha cliente e permite recuperação', async () => {
      const t = ambiente(perfil, fonte)
      t.estado.falhar = fase; t.estado.falhas = 1
      const resultados = await Promise.allSettled(Array.from({ length: 20 }, () => t.getter()))
      assert(resultados.every(r => r.status === 'rejected'))
      assert.equal(t.estado.clientes.length, 1)
      assert.equal(t.estado.clientes[0].fechado, 1)
      t.estado.falhar = null
      assert(await t.getter())
      assert.equal(t.estado.clientes.length, 2)
      assert.equal(t.estado.clientes[1].fechado, 0)
    })
    await teste(arquivo + ': falhas de leitura/escrita propagam e o mesmo cliente recupera', async () => {
      const t = ambiente(perfil, fonte)
      const col = await t.getter(), n = t.estado.pings
      t.estado.online = false
      await assert.rejects((await t.getter()).findOne({ teste: true }))
      await assert.rejects((await t.getter()).updateOne({ teste: true }, { $set: { teste: true } }))
      t.estado.online = true
      assert.equal(await (await t.getter()).findOne({ teste: true }), null)
      assert.equal((await (await t.getter()).updateOne({ teste: true }, { $set: { teste: true } })).acknowledged, true)
      assert.strictEqual(await t.getter(), col)
      assert.equal(t.estado.clientes.length, 1)
      assert.equal(t.estado.clientes[0].fechado, 0)
      assert.equal(t.estado.pings, n)
    })
    await teste(arquivo + ': carga equivalente e comandos de negócio idênticos', async () => {
      const contextos = [ambiente(perfil, anteriores.get(arquivo)), ambiente(perfil, fonte)]
      for (let idx = 0; idx < 2; idx++) {
        const t = contextos[idx]
        await t.getter()
        for (let i = 0; i < 100; i++) await (await t.getter()).findOne({ grupo_id: '000@g.us', teste: i })
        const destino = idx === 0 ? resumo.antes : resumo.depois
        destino.pings += t.estado.pings
        destino.clientes += t.estado.clientes.length
        destino.comandos += t.estado.comandos.length
        destino.bytesBson += t.estado.comandos.reduce((s, c) => s + BSON.serialize(c).length, 0)
      }
      const negocio = t => t.estado.comandos.filter(c => !c.ping)
      assert.deepEqual(negocio(contextos[0]), negocio(contextos[1]))
    })
  }

  await teste('API pública de diagnóstico database.conectar continua false durante queda e true na recuperação', async () => {
    const t = ambiente(perfis[0], atuais.get('database.js'))
    assert.equal(await t.api.conectar(), true)
    assert.equal(t.estado.pings, 1)
    t.estado.online = false
    assert.equal(await t.api.conectar(), false)
    t.estado.online = true
    assert.equal(await t.api.conectar(), true)
    assert.equal(t.estado.clientes.length, 1)
  })

  for (const [arquivo, ler, escrever, fallback] of [
    ['database.js', m => m.buscarRanking('000@g.us'), m => m.registrarMensagem('000@g.us', '0001', 'Teste'), []],
    ['configuracoes-grupo.js', m => m.welcomeHabilitado('000@g.us'), m => m.definirWelcome('000@g.us', true), false],
    ['modoadulto.js', m => m.modoAdultoAtivo('000@g.us'), m => m.definirModoAdulto('000@g.us', true), false],
    ['dados/historico-apagadas.js', m => m.listarDoDia('000@g.us'), m => m.registrarApagada({ grupo: '000@g.us', texto: 'teste' }), []]
  ]) await teste(arquivo + ': tratamento funcional público durante queda permanece igual', async () => {
    const p = perfis.find(p => p[0] === arquivo)
    const resultados = []
    for (const fonte of [anteriores.get(arquivo), atuais.get(arquivo)]) {
      const t = ambiente(p, fonte); await t.getter(); t.estado.online = false
      const leitura = await ler(t.api)
      assert.deepEqual(clonar(leitura), fallback)
      let escrita
      try { escrita = { resultado: (await escrever(t.api)) ?? null } } catch { escrita = { rejeitada: true } }
      resultados.push({ leitura: clonar(leitura), escrita })
      t.estado.online = true
      await ler(t.api)
    }
    assert.deepEqual(resultados[0], resultados[1])
  })

  await teste('módulos protegidos e agendadores permanecem intactos', async () => {
    const protegidos = ['dados/captura-diaria.js', 'rpg/conexao-mongo.js', 'rpg/database.js', 'rpg/economia.js',
      'sessao-mongo.js', 'dados/sessao-exclusiva.js', 'comandos/menu-utilitario/tempo-resposta.js', 'bot.js', 'anuncios.js']
    for (const f of protegidos) assert.equal(fs.readFileSync(path.join(raiz, f), 'utf8').replace(/\r\n/g, '\n'), original(f).replace(/\r\n/g, '\n'), f)
    for (const f of ['lembretes.js', 'prefixo.js']) {
      const marco = f === 'lembretes.js' ? 'function unidadeParaMs' : 'async function carregarPrefixo'
      const antigo = anteriores.get(f).replace(/\r\n/g, '\n'), atual = atuais.get(f).replace(/\r\n/g, '\n')
      assert.equal(atual.slice(atual.indexOf(marco)), antigo.slice(antigo.indexOf(marco)))
    }
  })
  console.log('MEDICAO_OFFLINE: ' + JSON.stringify(resumo))
  console.log(aprovados + ' testes passaram, sem conexões reais ou leitura de .env.')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
