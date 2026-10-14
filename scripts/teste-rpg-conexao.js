process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const conexao = require('../rpg/conexao-mongo')
const db = require('../rpg/database')
const eco = require('../rpg/economia')
const lid = require('../lid')
const { criarMongoFake } = require('./helpers/rpg-mongo-fake')
async function main() {
  // Fábrica injetada ANTES da URI fictícia: impossível usar MongoClient real.
  let criados = 0, fechados = 0, indices = 0, colecoesCriadas = 0
  let rejeitar = false, liberarConexao
  let espera = new Promise(r => { liberarConexao = r })
  const mongo = criarMongoFake()
  conexao.__definirFabricaTeste(() => {
    criados++
    const cliente = {
      async connect() { await espera; if (rejeitar) throw new Error('credencial fictícia que não deve vazar') },
      async close() { fechados++ },
      startSession() { const s = mongo.cliente.startSession(); s.dono = cliente; return s },
      db() {
        return {
          collection(nome) {
            const original = nome === conexao.NOME_COLECAO_PADRAO ? mongo.jogadores : mongo.operacoes
            const col = {}
            for (const [nomeMetodo, fn] of Object.entries(original)) col[nomeMetodo] = (...args) => {
              const options = args[nomeMetodo === 'updateOne' ? 2 : 1]
              if (options?.session) assert.equal(options.session.dono, cliente, 'coleção e sessão de clientes diferentes')
              return fn.apply(original, args)
            }
            col.createIndex = async () => { indices++ }
            return col
          },
          async createCollection() { colecoesCriadas++ }
        }
      }
    }
    return cliente
  })
  process.env.MONGO_URI_RPG = 'mongodb://offline.invalid/rpg'
  const promises = Array.from({ length: 20 }, () => conexao.obterContextoRpg())
  assert.equal(criados, 1)
  liberarConexao()
  const contexts = await Promise.all(promises)
  assert.ok(contexts.every(c => c === contexts[0]))
  assert.equal(indices, 0); assert.equal(colecoesCriadas, 0)
  await Promise.all(contexts.map(c => conexao.prepararFinanceiro(c)))
  assert.equal(indices, 1); assert.equal(colecoesCriadas, 1)
  console.log('OK inicialização/índices compartilhados e diagnóstico sem escritas')
  await conexao.fecharConexaoRpg()
  assert.equal(fechados, 1)
  rejeitar = true
  await assert.rejects(conexao.obterContextoRpg(), /RPG_BANCO_INDISPONIVEL/)
  assert.equal(fechados, 2)
  rejeitar = false
  assert.ok(await conexao.obterContextoRpg())
  console.log('OK falha fecha cliente local e permite nova inicialização')
  db.__definirContextoTeste(null)
  lid.__definirConsultaSessaoTeste(async () => null)
  const A = '5511999991111@s.whatsapp.net', B = '5511999992222@s.whatsapp.net'
  await mongo.jogadores.insertOne({ ...db.criarJogadorPadrao(A), carteira: 100 })
  await mongo.jogadores.insertOne(db.criarJogadorPadrao(B))
  let fechando, conectando
  mongo.hooks.depoisUpdate = ({ nome, update, options }) => {
    if (nome === 'jogadores' && options.session && update.$set?.carteira === 30) {
      fechando = conexao.fecharConexaoRpg()
      conectando = conexao.obterContextoRpg()
      assert.equal(fechados, 2, 'cliente fechado enquanto sessão estava em uso')
    }
  }
  const r = await eco.transferirEntreJogadores(A, B, 30, { chat: '12036@g.us', mensagem: 'REDE' })
  assert.equal(r.ok, true)
  await fechando
  const novo = await conectando
  assert.notEqual(novo, contexts[0])
  assert.equal(fechados, 3)
  assert.equal((await mongo.jogadores.findOne({ jid: A })).carteira, 70)
  assert.equal((await mongo.jogadores.findOne({ jid: B })).carteira, 30)
  console.log('OK fechamento/reconexão aguarda a operação e preserva sessão/coleções')
  await conexao.fecharConexaoRpg()
  process.env.MONGO_URI_RPG = ''
  console.log('RPG conexão: 3 cenários aprovados (offline).')
}
const timeout = setTimeout(() => { console.error('FALHA: timeout conexão offline'); process.exitCode = 1 }, 10000)
main().catch(err => { console.error('FALHA conexão offline:', err.message); process.exitCode = 1 })
  .finally(() => clearTimeout(timeout))
