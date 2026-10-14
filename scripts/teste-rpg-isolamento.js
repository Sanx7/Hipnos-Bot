// Offline. Nenhuma URI real, DNS real ou MongoClient.
const assert = require('node:assert/strict')
const { validarIsolamento, nomesExecucao } = require('./helpers/rpg-mongo-isolamento')
const env = { RPG_TEST_MONGO_URI: 'mongodb+srv://fixture:fixture@teste.invalid/hipnos_rpg_testes',
  MONGODB_URI: 'mongodb+srv://fixture:fixture@principal.invalid/bot',
  MONGO_URI_RPG: 'mongodb+srv://fixture:fixture@rpg.invalid/rpg' }
const srv = async host => [{ name: host, port: 27017 }]
async function main() {
  assert.equal((await validarIsolamento(env, srv)).servidoresDistintos, true)
  await assert.rejects(validarIsolamento({}, srv), /AUSENTE/)
  await assert.rejects(validarIsolamento({ ...env, RPG_TEST_MONGO_URI: env.MONGO_URI_RPG }, srv))
  await assert.rejects(validarIsolamento({ ...env, RPG_TEST_MONGO_URI: 'mongodb+srv://fixture:fixture@rpg.invalid/hipnos_rpg_testes' }, srv))
  await assert.rejects(validarIsolamento({ ...env, RPG_TEST_MONGO_URI: 'mongodb+srv://fixture:fixture@teste.invalid/whatsapp' }, srv))
  await assert.rejects(validarIsolamento({ ...env, MONGODB_URI: '' }, srv))
  await assert.rejects(validarIsolamento(env, async () => [{ name: 'mesmo-servidor.invalid' }]))
  await assert.rejects(validarIsolamento(env, async () => []))
  await assert.rejects(validarIsolamento(env, async () => { throw new Error('DNS indisponível') }))
  assert.throws(() => nomesExecucao('whatsapp', 'a'.repeat(32)))
  assert.throws(() => nomesExecucao('hipnos_rpg_testes', '../producao'))
  assert.ok(nomesExecucao('hipnos_rpg_testes', 'a'.repeat(32)).jogadores.startsWith('rpg_test_'))
  console.log('Isolamento RPG: 12 verificações aprovadas (offline).')
}
main().catch(() => { console.error('FALHA no teste offline de isolamento'); process.exitCode = 1 })
