process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const db = require('../rpg/database')
const { criarMongoFake } = require('./helpers/rpg-mongo-fake')
require('../lid').__definirConsultaSessaoTeste(async () => null)
require('../prefixo').__definirPrefixoTeste('/')
const mongo = criarMongoFake()
db.__definirContextoTeste(mongo)
const registrar = require('../comandos/rpg/registrar')
const ficha = require('../comandos/rpg/ficha')
const A = '5511999991111@s.whatsapp.net', B = '5511999992222@s.whatsapp.net'
const enviados = []
const sock = { sendMessage: async (_, c) => enviados.push(c.text), groupMetadata: async () => ({ participants: [] }) }
const msg = a => ({ key: { participant: a, remoteJid: '12036@g.us' } })
async function main() {
  for (const [nome, genero, esperado] of [['João', 'M', 'M'], ['Maria Silva', 'F', 'F'], ['João Pedro', 'masculino', 'M'], ['Ana', 'feminino', 'F']]) {
    await registrar.executar(sock, '12036@g.us', msg(A), '/registrar ' + nome + ' ' + genero)
    const p = await db.getPlayer(A)
    assert.equal(p.nome, nome); assert.equal(p.genero, esperado)
  }
  assert.ok(enviados.at(-1).includes('ATUALIZADO'))
  for (const texto of ['/registrar J M', '/registrar ' + 'N'.repeat(21) + ' M', '/registrar João X', '/registrar']) {
    const antes = structuredClone(mongo.estado)
    await registrar.executar(sock, '12036@g.us', msg(A), texto)
    assert.deepEqual(mongo.estado, antes)
  }
  await ficha.executar(sock, '12036@g.us', msg(A))
  assert.ok(enviados.at(-1).includes('FICHA ONÍRICA — Ana'))
  assert.ok(enviados.at(-1).includes('18 anos'))
  await ficha.executar(sock, '12036@g.us', msg(B))
  assert.ok(enviados.at(-1).includes('FICHA PROVISÓRIA'))
  assert.ok(enviados.at(-1).includes('/registrar'))
  assert.equal((await db.getPlayer(B)).idade, 18)
  console.log('RPG fase 1: cadastro, validações, atualização e ficha aprovados (offline).')
}
main().catch(err => { console.error(err); process.exitCode = 1 })
