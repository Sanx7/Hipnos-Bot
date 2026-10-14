process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const db = require('../rpg/database')
const lid = require('../lid')
const { criarMongoFake } = require('./helpers/rpg-mongo-fake')
async function main() {
  const m = criarMongoFake()
  db.__definirContextoTeste(m)
  const pn = '5511999991111', l = '998877@lid'
  lid.__definirConsultaSessaoTeste(async n => n === '998877' ? pn : null)
  const p = await db.getPlayer(l)
  assert.equal(p.jid, pn + '@s.whatsapp.net')
  assert.equal((await db.getPlayer(pn))._id, p._id)
  await db.savePlayer(l, { nome: 'João', genero: 'M' })
  assert.equal((await db.getPlayer(pn)).nome, 'João')
  await assert.rejects(db.getPlayer('88888@lid'), { codigo: 'identidade_nao_comprovada' })
  await m.jogadores.insertOne({ ...db.criarJogadorPadrao(l), carteira: 50 })
  const antes = structuredClone(m.estado)
  await assert.rejects(db.getPlayer(pn, [{ id: l, phoneNumber: pn + '@s.whatsapp.net' }]), { codigo: 'cadastros_ambiguos' })
  const r = await db.corrigirJogadoresComLid()
  assert.equal(r.somenteDiagnostico, true); assert.equal(r.corrigidos, 0); assert.equal(r.mesclados, 0)
  assert.deepEqual(m.estado, antes)
  console.log('RPG LID: normalização, associação comprovada e reconciliação bloqueada aprovados (offline).')
}
main().catch(err => { console.error(err); process.exitCode = 1 })
