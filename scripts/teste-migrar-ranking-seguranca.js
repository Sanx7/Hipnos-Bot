// Somente dados fictícios; nenhuma conexão de rede ou migração real é permitida.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
require('node:net').Socket.prototype.connect = function () { throw Error('REDE_PROIBIDA') }
const { MongoClient, ObjectId } = require('mongodb')
MongoClient.prototype.connect = async function () { throw Error('MONGO_PROIBIDO') }
const fs = require('node:fs')
const path = require('node:path')
const existe = fs.existsSync
fs.existsSync = p => path.resolve(String(p)) === path.resolve(__dirname, '../.env') ? false : existe(p)

const { test } = require('node:test')
const assert = require('node:assert/strict')
const criarFake = require('./helpers/ranking-migracao-fake')
const { fundir, migrar, __definirColecoesTeste } = require('./migrar-ranking-lid')
const GRUPO = 'grupo-ficticio@g.us', LID = '100000000000001', PN = '5500000000001'
function cenario(renomear = false) {
  const origem = { _id: new ObjectId(), grupo_id: GRUPO, usuario_id: LID, total: 7,
    ultimaMensagem: 200, nome: 'Origem fictícia', lid: LID, exclusivoOrigem: { valor: 1 }, legado: 'origem' }
  const destino = { _id: new ObjectId(), grupo_id: GRUPO, usuario_id: PN, total: 10,
    ultimaMensagem: 100, nome: 'Destino fictício', exclusivoDestino: true, legado: 'destino' }
  const c = criarFake(renomear ? [origem] : [origem, destino])
  return Object.assign(c, { origem, destino, item: { doc: origem, telefone: PN, alvo: destino, acao: renomear ? 'renomear' : 'fundir' } })
}
const lerOrigem = c => c.ranking.findOne({ _id: c.origem._id })
const lerDestino = c => c.ranking.findOne({ grupo_id: GRUPO, usuario_id: PN })
const recibos = c => c.diario.find({}).toArray()
function falharUmaVez(c, etapa, erro = Error('FALHA_FICTICIA')) {
  c.hooks[etapa] = () => { delete c.hooks[etapa]; throw erro }
}
async function concluido(c, total = 17) {
  assert.equal(await lerOrigem(c), null)
  assert.equal((await lerDestino(c)).total, total)
  assert.equal((await recibos(c))[0].estado, 'concluida')
  await fundir(c.ranking, c.item, { offlineConfirmado: c.semTransacoes })
  assert.equal((await lerDestino(c)).total, total)
}

for (const etapa of ['diario.antesLer', 'ranking.antesLer', 'ranking.antesAtualizar',
  'ranking.depoisAtualizar', 'ranking.antesExcluir', 'ranking.depoisExcluir',
  'diario.antesInserir', 'diario.depoisInserir', 'antesCommit']) {
  test(`transação: falha em ${etapa} mantém ambos os documentos e permite repetição`, async () => {
    const c = cenario(); falharUmaVez(c, etapa)
    await assert.rejects(fundir(c.ranking, c.item))
    assert.deepEqual(await lerOrigem(c), c.origem)
    assert.deepEqual(await lerDestino(c), c.destino)
    assert.equal((await recibos(c)).length, 0)
    await fundir(c.ranking, c.item)
    await concluido(c)
  })
}

test('transação: preserva totais, identidades e metadados, inclusive conflitos no diário', async () => {
  const c = cenario()
  await fundir(c.ranking, c.item)
  const d = await lerDestino(c), [r] = await recibos(c)
  assert.equal(d.total, 17); assert.equal(d.usuario_id, PN); assert.equal(d.lid, LID)
  assert.equal(d.grupo_id, GRUPO); assert.deepEqual(d._id, c.destino._id)
  assert.equal(d.nome, c.origem.nome); assert.equal(d.ultimaMensagem, 200)
  assert.deepEqual(d.exclusivoOrigem, c.origem.exclusivoOrigem)
  assert.equal(d.exclusivoDestino, true); assert.equal(d.legado, 'destino')
  assert.deepEqual(r.origem, c.origem); assert.deepEqual(r.destinoAntes, c.destino)
  assert.equal(c.sessoesEncerradas, 1)
  await concluido(c)
})

for (const etapa of ['antesCommit', 'depoisCommit']) {
  test(`commit incerto em ${etapa}: nunca usa fallback e repetir consulta o recibo`, async () => {
    const c = cenario()
    falharUmaVez(c, etapa, Object.assign(Error('COMMIT_INDEFINIDO'), {
      hasErrorLabel: l => l === 'UnknownTransactionCommitResult'
    }))
    await assert.rejects(fundir(c.ranking, c.item, { offlineConfirmado: true }), { codigo: 'MIGRACAO_COMMIT_INCERTO' })
    assert.equal(c.chamadas.includes('diario.antesAtualizar'), false)
    if (etapa === 'antesCommit') assert.deepEqual(await lerOrigem(c), c.origem)
    else assert.equal(await lerOrigem(c), null)
    await fundir(c.ranking, c.item)
    await concluido(c)
  })
}

test('transação: incremento concorrente da origem é relido no retry', async () => {
  const c = cenario()
  c.hooks.antesCommit = async () => {
    delete c.hooks.antesCommit
    await c.ranking.updateOne({ _id: c.origem._id }, { $inc: { total: 3 } })
  }
  const r = await fundir(c.ranking, c.item)
  assert.ok(r.corridas >= 1)
  await concluido(c, 20)
})

test('transação: duas execuções simultâneas da mesma origem creditam uma vez', async () => {
  const c = cenario()
  await Promise.all([fundir(c.ranking, c.item), fundir(c.ranking, c.item)])
  assert.equal((await recibos(c)).length, 1)
  await concluido(c)
})

test('transação: duas origens simultâneas conservam a soma no mesmo destino', async () => {
  const c = cenario()
  const outra = { ...c.origem, _id: new ObjectId(), usuario_id: '100000000000002', total: 9 }
  await c.ranking.insertOne(outra)
  await Promise.all([fundir(c.ranking, c.item), fundir(c.ranking, { ...c.item, doc: outra })])
  assert.equal((await recibos(c)).length, 2)
  assert.equal(await c.ranking.findOne({ _id: outra._id }), null)
  await concluido(c, 26)
})

for (const colecao of ['ranking', 'diario']) {
  test(`transação: escrita não confirmada em ${colecao} provoca rollback`, async () => {
    const c = cenario(); c[colecao].semConfirmacao = true
    await assert.rejects(fundir(c.ranking, c.item), { codigo: 'MIGRACAO_ESCRITA_NAO_CONFIRMADA' })
    assert.deepEqual(await lerOrigem(c), c.origem)
    assert.deepEqual(await lerDestino(c), c.destino)
    assert.equal((await recibos(c)).length, 0)
  })
}

test('transação: destino não encontrado pelo filtro impede exclusão da origem', async () => {
  const c = cenario()
  c.ranking.updateOne = async () => ({ acknowledged: true, matchedCount: 0 })
  await assert.rejects(fundir(c.ranking, c.item), { codigo: 'MIGRACAO_DOCUMENTO_ALTERADO' })
  assert.deepEqual(await lerOrigem(c), c.origem)
  assert.equal(c.chamadas.includes('ranking.antesExcluir'), false)
})

for (const valor of [-1, 1.5, '7', Number.MAX_SAFE_INTEGER]) {
  test(`total inválido ou soma insegura (${typeof valor}/${valor}) é recusado sem escrita`, async () => {
    const c = cenario()
    await c.ranking.updateOne({ _id: c.origem._id }, { $set: { total: valor } })
    c.chamadas.length = 0
    await assert.rejects(fundir(c.ranking, c.item), { codigo: 'MIGRACAO_CONTAGEM_INVALIDA' })
    assert.equal((await lerOrigem(c)).total, valor)
    assert.deepEqual(await lerDestino(c), c.destino)
    assert.equal(c.chamadas.includes('ranking.antesAtualizar'), false)
  })
}

test('sem transações: bloqueia por padrão antes de alterar o ranking', async () => {
  const c = cenario(); c.semTransacoes = true
  await assert.rejects(fundir(c.ranking, c.item), { codigo: 'MIGRACAO_REQUER_TRANSACOES_OU_OFFLINE_CONFIRMADO' })
  assert.deepEqual(await lerOrigem(c), c.origem); assert.deepEqual(await lerDestino(c), c.destino)
  assert.equal((await recibos(c)).length, 0)
})

for (const etapa of ['diario.antesInserir', 'diario.depoisInserir', 'ranking.antesAtualizar',
  'ranking.depoisAtualizar', 'ranking.antesExcluir', 'ranking.depoisExcluir',
  'diario.antesAtualizar', 'diario.depoisAtualizar']) {
  test(`manutenção: falha em ${etapa} é recuperável após reinício e não duplica`, async () => {
    const c = cenario(); c.semTransacoes = true; falharUmaVez(c, etapa)
    await assert.rejects(fundir(c.ranking, c.item, { offlineConfirmado: true }))
    const origem = await lerOrigem(c), destino = await lerDestino(c)
    // A origem só pode desaparecer quando o crédito já estiver persistido.
    assert.ok(origem || destino.total === 17)
    if (destino.total === 10) assert.deepEqual(origem, c.origem)
    // Nova instância, apenas documentos persistidos: nada depende da memória anterior.
    const novo = criarFake(await c.ranking.find({}).toArray(), await recibos(c)); novo.semTransacoes = true
    const reiniciado = Object.assign(novo, { origem: c.origem, destino: c.destino, item: c.item })
    await fundir(novo.ranking, c.item, { offlineConfirmado: true })
    await concluido(reiniciado)
  })
}

test('manutenção: crédito sem confirmação preserva origem e retoma pelo marcador', async () => {
  const c = cenario(); c.semTransacoes = true; c.ranking.semConfirmacao = true
  await assert.rejects(fundir(c.ranking, c.item, { offlineConfirmado: true }), { codigo: 'MIGRACAO_ESCRITA_NAO_CONFIRMADA' })
  assert.deepEqual(await lerOrigem(c), c.origem)
  assert.equal((await lerDestino(c)).total, 17)
  c.ranking.semConfirmacao = false
  await fundir(c.ranking, c.item, { offlineConfirmado: true })
  await concluido(c)
})

test('manutenção: leitura de confirmação falha e nenhuma exclusão ocorre', async () => {
  const c = cenario(); c.semTransacoes = true
  c.hooks['ranking.depoisAtualizar'] = () => {
    delete c.hooks['ranking.depoisAtualizar']; falharUmaVez(c, 'ranking.antesLer')
  }
  await assert.rejects(fundir(c.ranking, c.item, { offlineConfirmado: true }))
  assert.equal(c.chamadas.includes('ranking.antesExcluir'), false)
  assert.deepEqual(await lerOrigem(c), c.origem)
  await fundir(c.ranking, c.item, { offlineConfirmado: true }); await concluido(c)
})

test('manutenção: origem alterada durante interrupção bloqueia sem apagar dados', async () => {
  const c = cenario(); c.semTransacoes = true; falharUmaVez(c, 'ranking.antesExcluir')
  await assert.rejects(fundir(c.ranking, c.item, { offlineConfirmado: true }))
  await c.ranking.updateOne({ _id: c.origem._id }, { $inc: { total: 1 } })
  await assert.rejects(fundir(c.ranking, c.item, { offlineConfirmado: true }), { codigo: 'MIGRACAO_ORIGEM_ALTERADA_MANTENHA_BOT_PARADO' })
  assert.equal((await lerOrigem(c)).total, 8); assert.equal((await lerDestino(c)).total, 17)
})

test('pendência offline exige confirmação mesmo após ativação de transações', async () => {
  const c = cenario(); c.semTransacoes = true; falharUmaVez(c, 'ranking.antesExcluir')
  await assert.rejects(fundir(c.ranking, c.item, { offlineConfirmado: true }))
  c.semTransacoes = false
  await assert.rejects(fundir(c.ranking, c.item), { codigo: 'MIGRACAO_RETOMADA_OFFLINE_NECESSARIA' })
  await fundir(c.ranking, c.item, { offlineConfirmado: true }); await concluido(c)
})

for (const modo of ['transacao', 'offline']) {
  for (const etapa of ['ranking.antesAtualizar', 'ranking.depoisAtualizar', 'diario.depoisInserir']) {
    test(`renomeação ${modo}: falha em ${etapa}, retomada preserva identidade e total`, async () => {
      const c = cenario(true); c.semTransacoes = modo === 'offline'
      falharUmaVez(c, etapa)
      await assert.rejects(fundir(c.ranking, c.item, { offlineConfirmado: c.semTransacoes }))
      await fundir(c.ranking, c.item, { offlineConfirmado: c.semTransacoes })
      await fundir(c.ranking, c.item, { offlineConfirmado: c.semTransacoes })
      const docs = await c.ranking.find({}).toArray()
      assert.equal(docs.length, 1)
      assert.deepEqual(docs[0], { ...c.origem, usuario_id: PN })
      assert.equal((await recibos(c)).length, 1)
    })
  }
}

for (const etapa of ['ranking.antesExcluir', 'diario.antesAtualizar']) {
test(`fluxo completo retoma pelo diário após ${etapa}`, async () => {
  const c = cenario(); c.semTransacoes = true; falharUmaVez(c, etapa)
  await assert.rejects(fundir(c.ranking, c.item, { offlineConfirmado: true }))
  if (etapa === 'diario.antesAtualizar') assert.equal(await lerOrigem(c), null)
  const auth = { find: () => ({ toArray: async () => [
    { _id: `lid-mapping-${LID}_reverse`, __rawValue__: PN },
    { _id: `lid-mapping-${PN}`, __rawValue__: LID }
  ] }) }
  __definirColecoesTeste({ ranking: c.ranking, diario: c.diario, cliente: c.cliente, auth })
  const pasta = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hipnos-ranking-ficticio-'))
  try {
    const antes = fs.readdirSync(pasta)
    const dry = await migrar({ pastaBackup: pasta, log: () => {} })
    assert.equal(dry.plano, 1); assert.deepEqual(fs.readdirSync(pasta), antes)
    assert.equal((await recibos(c))[0].estado, 'preparada')
    const r = await migrar({ aplicar: true, offlineConfirmado: true, pastaBackup: pasta, log: () => {} })
    assert.equal(r.fusoes, 1); assert.ok(fs.existsSync(r.backup))
    await concluido(c)
    const novamente = await migrar({ aplicar: true, offlineConfirmado: true, pastaBackup: pasta, log: () => {} })
    assert.equal(novamente.plano, 0); assert.equal(novamente.backup, null)
  } finally {
    __definirColecoesTeste()
    // Remove exclusivamente a pasta temporária criada acima, com dados sintéticos.
    for (const arquivo of fs.readdirSync(pasta)) fs.unlinkSync(path.join(pasta, arquivo))
    fs.rmdirSync(pasta)
  }
})
}

test('snapshot antigo do plano não perde incrementos anteriores à transação', async () => {
  const c = cenario()
  await c.ranking.updateOne({ _id: c.origem._id }, { $inc: { total: 5 } })
  await fundir(c.ranking, c.item); await concluido(c, 22)
})

test('origem que mudou de identidade é preservada e a migração é bloqueada', async () => {
  const c = cenario()
  await c.ranking.updateOne({ _id: c.origem._id }, { $set: { usuario_id: '100000000000009' } })
  await assert.rejects(fundir(c.ranking, c.item), { codigo: 'MIGRACAO_IDENTIDADE_ALTERADA' })
  assert.equal((await lerOrigem(c)).total, 7); assert.deepEqual(await lerDestino(c), c.destino)
})

test('exclusão não confirmada provoca rollback da transação inteira', async () => {
  const c = cenario(), excluir = c.ranking.deleteOne
  c.ranking.deleteOne = async (...args) => { await excluir(...args); return { acknowledged: false, deletedCount: 1 } }
  await assert.rejects(fundir(c.ranking, c.item), { codigo: 'MIGRACAO_ESCRITA_NAO_CONFIRMADA' })
  assert.deepEqual(await lerOrigem(c), c.origem); assert.deepEqual(await lerDestino(c), c.destino)
  assert.equal((await recibos(c)).length, 0)
})

test('manutenção: resposta perdida da exclusão é retomada sem novo crédito', async () => {
  const c = cenario(); c.semTransacoes = true
  const excluir = c.ranking.deleteOne
  c.ranking.deleteOne = async (...args) => { await excluir(...args); return { acknowledged: false, deletedCount: 1 } }
  await assert.rejects(fundir(c.ranking, c.item, { offlineConfirmado: true }), { codigo: 'MIGRACAO_ESCRITA_NAO_CONFIRMADA' })
  assert.equal(await lerOrigem(c), null)
  c.ranking.deleteOne = excluir
  await fundir(c.ranking, c.item, { offlineConfirmado: true }); await concluido(c)
})

for (const campo of ['marcador', 'destino']) {
  test(`manutenção: divergência no ${campo} bloqueia remoção da origem`, async () => {
    const c = cenario(); c.semTransacoes = true; falharUmaVez(c, 'ranking.antesExcluir')
    await assert.rejects(fundir(c.ranking, c.item, { offlineConfirmado: true }))
    const [r] = await recibos(c)
    const mudanca = campo === 'marcador' ? { [`_migracoesRankingLid.${r._id}`]: 999 } : { usuario_id: '5500000000099' }
    await c.ranking.updateOne({ _id: c.destino._id }, { $set: mudanca })
    await assert.rejects(fundir(c.ranking, c.item, { offlineConfirmado: true }))
    assert.deepEqual(await lerOrigem(c), c.origem)
    assert.equal((await recibos(c))[0].estado, 'preparada')
  })
}

test('contagem zero funciona nos marcadores de retomada', async () => {
  const c = cenario(); c.semTransacoes = true
  await c.ranking.updateOne({ _id: c.origem._id }, { $set: { total: 0 } })
  falharUmaVez(c, 'ranking.antesExcluir')
  await assert.rejects(fundir(c.ranking, c.item, { offlineConfirmado: true }))
  await fundir(c.ranking, c.item, { offlineConfirmado: true }); await concluido(c, 10)
})

test('data inválida aborta sem alterar origem ou destino', async () => {
  const c = cenario()
  await c.ranking.updateOne({ _id: c.origem._id }, { $set: { ultimaMensagem: 'invalida' } })
  await assert.rejects(fundir(c.ranking, c.item), { codigo: 'MIGRACAO_DATA_INVALIDA' })
  assert.equal((await lerOrigem(c)).total, 7); assert.deepEqual(await lerDestino(c), c.destino)
})
