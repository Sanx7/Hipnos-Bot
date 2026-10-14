process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const config = require('../config')
const estado = require('../estado-bot')
const lid = require('../lid')
const setPrefix = require('../comandos/menu-dono/set-prefix')
const novos = ['639483923601', '639972612894']
async function main() {
  assert.ok(!config.OWNER_NUMBERS.includes('5521993615578'))
  assert.ok(novos.every(n => config.OWNER_NUMBERS.includes(n)))
  assert.equal(config.OWNER_NUMBERS.length, 3)
  for (const n of config.OWNER_NUMBERS) {
    assert.equal(config.ehDonoDoBot([], n + '@s.whatsapp.net'), true)
    assert.equal(await estado.remetenteEhDono({}, n + '@s.whatsapp.net', n + '@s.whatsapp.net'), true)
  }
  const comum = '00000000000001@s.whatsapp.net'
  for (const n of novos) {
    lid.__definirConsultaSessaoTeste(async () => null)
    const meta = [{ id: '00000000000100@lid', phoneNumber: n + '@s.whatsapp.net' }]
    const sock = { groupMetadata: async () => ({ participants: meta }) }
    assert.equal(await setPrefix._test.remetenteEhDono(sock, '00000000000000@g.us', n + '@s.whatsapp.net'), true)
    assert.equal(config.ehDonoDoBot(meta, '00000000000100@lid'), true)
    assert.equal(await estado.remetenteEhDono(sock, '00000000000000@g.us', '00000000000100@lid'), true)
    assert.equal(await setPrefix._test.remetenteEhDono(sock, '00000000000000@g.us', '00000000000100@lid'), true)
    assert.equal(config.ehDonoDoBot([], n + '@lid'), false)
    assert.equal(await setPrefix._test.remetenteEhDono({}, n + '@lid', n + '@lid'), false)
    assert.equal(await estado.remetenteEhDono(sock, '00000000000000@g.us', n + '@lid'), false)
    const ambiguo = { groupMetadata: async () => ({ participants: [...meta, { id: meta[0].id, phoneNumber: comum }] }) }
    assert.equal(await estado.remetenteEhDono(ambiguo, '00000000000000@g.us', meta[0].id), false)
    assert.equal(config.ehDonoDoBot((await ambiguo.groupMetadata()).participants, meta[0].id), false)
    lid.__definirConsultaSessaoTeste(async id => id === '00000000000100' ? n : null)
    assert.equal(await setPrefix._test.remetenteEhDono({}, meta[0].id, meta[0].id), true)
  }
  lid.__definirConsultaSessaoTeste(async () => null)
  assert.equal(await estado.remetenteEhDono({}, '5521993615578@s.whatsapp.net', '5521993615578@s.whatsapp.net'), false)
  assert.equal(config.ehDonoDoBot([], '5521993615578@s.whatsapp.net'), false)
  assert.equal(config.ehAdminDoGrupo([{ id: comum, admin: 'admin' }], comum), true)
  assert.equal(config.ehDonoDoBot([{ id: comum, admin: 'admin' }], comum), false)
  console.log('Troca de dono: lista, PN/LID comprovados, ambiguidade e administradores aprovados (offline).')
}
main().catch(() => { console.error('FALHA no teste offline de troca de dono'); process.exitCode = 1 })
