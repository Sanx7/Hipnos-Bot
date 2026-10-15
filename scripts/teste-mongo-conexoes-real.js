// Integração opcional: somente RPG_TEST_MONGO_URI e banco explicitamente de teste.
// Não importa config.js; módulos em VM recebem URI sentinela e factory isolada.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { MongoClient, MongoNetworkError } = require('mongodb')
const raiz = path.join(__dirname, '..')
const clientes = []
const resumo = { cenarios: 0, pings: 0, cortesSocket: 0, errosTransporte: 0 }
const run = randomUUID().replace(/-/g, '')

function configuracao() {
  const linha = process.env.RPG_TEST_MONGO_URI ? null : fs.readFileSync(path.join(raiz, '.env'), 'utf8').split(/\r?\n/).find(l => /^\s*RPG_TEST_MONGO_URI\s*=/.test(l))
  let uri = process.env.RPG_TEST_MONGO_URI || (linha && linha.slice(linha.indexOf('=') + 1).trim())
  if (!uri) throw new Error('RPG_TEST_MONGO_URI_AUSENTE')
  if ((uri.startsWith('"') && uri.endsWith('"')) || (uri.startsWith("'") && uri.endsWith("'"))) uri = uri.slice(1, -1)
  const u = new URL(uri), banco = u.pathname.slice(1)
  if (u.protocol !== 'mongodb+srv:' || u.port || u.hash || !/^hipnos_rpg_test(?:es)?(?:_[a-z0-9]+)?$/i.test(banco)) throw new Error('BANCO_TESTE_NAO_IDENTIFICADO')
  return { uri, banco }
}

async function main() {
  const cfg = configuracao()
  let versao
  for (const [arquivo, getter, logica] of [
    ['database.js', 'obterColecaoRanking', 'ranking'],
    ['configuracoes-grupo.js', 'obterColecaoConfiguracoes', 'configuracoesGrupo']
  ]) {
    const nome = `mongo_fase2_${run}_${logica}`
    const estado = { indisponivel: false, pings: 0, construidos: 0, raw: null }
    class ClienteIsolado {
      constructor(uriSentinela, opcoes) {
        assert.equal(uriSentinela, 'mongodb://offline.invalid/hipnos_testes')
        this.real = new MongoClient(cfg.uri, { ...opcoes, monitorCommands: true, appName: 'hipnos-mongo-fase2-teste' })
        clientes.push(this.real); estado.construidos++
      }
      async connect() {
        await this.real.connect()
        const banco = this.real.db(cfg.banco)
        if (!versao) versao = (await banco.command({ buildInfo: 1 })).version
        // Criação explícita deve falhar se o namespace já existir.
        await banco.createCollection(nome)
        estado.raw = banco.collection(nome)
        return this
      }
      async close() { await this.real.close() }
      db(bancoLogico) {
        assert(['admin', 'hipnos_testes'].includes(bancoLogico))
        return {
          command: async cmd => { assert.equal(cmd.ping, 1); estado.pings++; return this.real.db(cfg.banco).command(cmd) },
          collection: nomeLogico => {
            assert.equal(nomeLogico, logica)
            return {
              createIndex: (...args) => estado.raw.createIndex(...args),
              findOne: (f, o) => {
                if (estado.indisponivel) return Promise.reject(new MongoNetworkError('FALHA_DE_LEITURA_INJETADA'))
                return estado.raw.findOne({ ...f, fase2Run: run }, o)
              },
              updateOne: (f, u, o) => {
                if (estado.indisponivel) return Promise.reject(new MongoNetworkError('FALHA_DE_ESCRITA_INJETADA'))
                return estado.raw.updateOne({ ...f, fase2Run: run }, u, o)
              }
            }
          }
        }
      }
    }
    const m = { exports: {} }
    vm.runInNewContext(fs.readFileSync(path.join(raiz, arquivo), 'utf8') + `\nmodule.exports.getterTeste = ${getter};`, {
      module: m, process: { env: { MONGODB_URI: 'mongodb://offline.invalid/hipnos_testes', MONGODB_DB: 'hipnos_testes' } },
      require: n => { if (n === 'mongodb') return { MongoClient: ClienteIsolado }; if (n === './config') return {}; throw new Error('IMPORT_NAO_PERMITIDO') },
      console: { log() {}, error() {} }
    }, { filename: arquivo })
    const api = m.exports
    const cols = await Promise.all(Array.from({ length: 20 }, () => api.getterTeste()))
    assert(cols.every(c => c === cols[0])); assert.equal(estado.construidos, 1); assert.equal(estado.pings, 1)
    resumo.cenarios++
    console.log('PASSOU: ' + arquivo + ' inicialização concorrente em Mongo real')
    const col = cols[0], filtro = { grupo_id: '000@g.us', usuario_id: '0001' }
    await col.updateOne(filtro, { $set: { teste: true } }, { upsert: true })
    for (let i = 0; i < 100; i++) assert.equal((await (await api.getterTeste()).findOne(filtro)).teste, true)
    assert.equal(estado.pings, 1)
    resumo.cenarios++
    console.log('PASSOU: ' + arquivo + ' 100 leituras sem ping adicional')
    estado.indisponivel = true
    await assert.rejects(col.findOne(filtro)); await assert.rejects(col.updateOne(filtro, { $set: { teste: false } }))
    if (arquivo === 'configuracoes-grupo.js') {
      assert.equal(await api.welcomeHabilitado('000@g.us'), false)
      await assert.rejects(api.definirWelcome('000@g.us', true))
    }
    estado.indisponivel = false
    assert.equal((await col.findOne(filtro)).teste, true)
    resumo.cenarios++
    console.log('PASSOU: ' + arquivo + ' erros injetados propagam sem substituir cliente')
    const real = clientes[clientes.length - 1]
    let armado = true
    const cortar = evento => {
      if (!armado || evento.commandName !== 'find' || evento.command.find !== nome) return
      armado = false
      for (const servidor of real.topology.s.servers.values()) for (const conexao of servidor.pool.checkedOutConnections) {
        conexao.destroy(); resumo.cortesSocket++
      }
    }
    const registrarErro = ev => { if (ev.commandName === 'find') resumo.errosTransporte++ }
    real.on('commandStarted', cortar); real.on('commandFailed', registrarErro)
    try { await col.findOne(filtro) } catch (_) { /* o retry do driver pode ou não concluir nesta chamada */ }
    finally { real.off('commandStarted', cortar); real.off('commandFailed', registrarErro) }
    assert.equal((await (await api.getterTeste()).findOne(filtro)).teste, true)
    await (await api.getterTeste()).updateOne(filtro, { $set: { recuperado: true } })
    assert.equal((await col.findOne(filtro)).recuperado, true)
    assert.equal(estado.construidos, 1); assert.equal(estado.pings, 1)
    resumo.pings += estado.pings
    resumo.cenarios++
    console.log('PASSOU: ' + arquivo + ' driver recupera socket sem cliente ou ping novo')
  }
  assert.equal(resumo.cortesSocket, 2); assert(resumo.errosTransporte >= 2)
  console.log('RESULTADO_REAL: ' + JSON.stringify({ ...resumo, banco: cfg.banco, servidor: versao, run, clientes: clientes.length,
    colecoes: [`mongo_fase2_${run}_ranking`, `mongo_fase2_${run}_configuracoesGrupo`] }))
}
main().catch(e => { console.error(JSON.stringify({ status: 'INTERROMPIDO', tipo: e.name, codigo: Number.isInteger(e.code) ? e.code : null, run })); process.exitCode = 1 })
  .finally(async () => { await Promise.allSettled(clientes.map(c => c.close())) })
