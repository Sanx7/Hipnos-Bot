process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const db = require('../rpg/database')
const eco = require('../rpg/economia')
const { criarMongoFake } = require('./helpers/rpg-mongo-fake')
require('../lid').__definirConsultaSessaoTeste(async () => null)
require('../prefixo').__definirPrefixoTeste('/')
async function main() {
  const m = criarMongoFake()
  db.__definirContextoTeste(m)
  const A = '5511999991111@s.whatsapp.net', B = '5511999992222@s.whatsapp.net'
  await m.jogadores.insertOne({ ...db.criarJogadorPadrao(A), carteira: 2000 })
  const grupo = '12036@g.us'
  const enviados = []
  const sock = { sendMessage: async (jid, c) => enviados.push({ jid, texto: c.text }), groupMetadata: async () => ({ participants: [] }) }
  let id = 0
  const msg = info => ({ key: { participant: A, remoteJid: grupo, id: 'FASE2-' + ++id },
    message: { extendedTextMessage: { contextInfo: info } } })
  const saldo = async () => db.getPlayer(A)
  const depositar = require('../comandos/rpg/depositar')
  const sacar = require('../comandos/rpg/sacar')
  const transferir = require('../comandos/rpg/transferir')
  const carteira = require('../comandos/rpg/carteira')
  await depositar.executar(sock, grupo, msg(), '/depositar 1.234,56')
  assert.equal((await saldo()).carteira, 765.44); assert.equal((await saldo()).banco, 1234.56)
  await sacar.executar(sock, grupo, msg(), '/sacar 100')
  assert.equal((await saldo()).carteira, 865.44)
  await transferir.executar(sock, grupo, msg({ mentionedJid: [B] }), '/transferir @pessoa 100')
  assert.equal((await db.getPlayer(B)).carteira, 100)
  assert.equal(enviados.at(-1).jid, B)
  assert.ok(enviados.at(-1).texto.includes('De: @' + A.split('@')[0]))
  await transferir.executar(sock, grupo, msg({ participant: B }), '/transferir 10')
  await transferir.executar(sock, grupo, msg(), '/transferir ' + B.split('@')[0] + ' 10')
  assert.equal((await db.getPlayer(B)).carteira, 120)
  await depositar.executar(sock, grupo, msg(), '/depositar todos')
  assert.equal((await saldo()).carteira, 0)
  await sacar.executar(sock, grupo, msg(), '/sacar tudo')
  assert.equal((await saldo()).carteira, 1880)
  await carteira.executar(sock, grupo, msg())
  assert.ok(enviados.at(-1).texto.includes(eco.formatarReais(1880)))
  for (const valor of ['abc', '0', '-50', '1.234']) {
    const antes = structuredClone(m.estado.jogadores)
    await depositar.executar(sock, grupo, msg(), '/depositar ' + valor)
    assert.deepEqual(m.estado.jogadores, antes)
  }
  const r = await eco.transferirEntreJogadores(A, B, 9999, { chat: grupo, mensagem: 'SEM-SALDO' })
  assert.equal(r.motivo, 'saldo_insuficiente')
  assert.equal([...m.estado.jogadores.values()].reduce((n, p) => n + eco.centavos(p.carteira, true) + eco.centavos(p.banco, true), 0), 200000)
  assert.deepEqual(transferir.aliases, ['transf', 'pix'])
  console.log('RPG fase 2: economia, todos, menção, reply, número e conservação aprovados (offline).')
}
main().catch(err => { console.error(err); process.exitCode = 1 })
