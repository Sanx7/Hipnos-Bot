process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const db = require('../rpg/database')
const eco = require('../rpg/economia')
const lid = require('../lid')
const prefixo = require('../prefixo')
const { resolverIdentidade } = require('../rpg/identidade')
const { criarMongoFake } = require('./helpers/rpg-mongo-fake')
const A = '5511999991111@s.whatsapp.net'
const B = '5511999992222@s.whatsapp.net'
const GRUPO = '1203600000@g.us'
let numero = 0
let aprovados = 0
function ctx(id = 'MSG-' + ++numero, participantes = []) { return { chat: GRUPO, mensagem: id, participantes } }
async function preparar(a = 100, b = 20) {
  const m = criarMongoFake()
  db.__definirContextoTeste(m)
  lid.__definirConsultaSessaoTeste(async () => null)
  prefixo.__definirPrefixoTeste('/')
  await m.jogadores.insertOne({ ...db.criarJogadorPadrao(A), carteira: a, banco: 10, antigo: { tesouro: ['item'] } })
  await m.jogadores.insertOne({ ...db.criarJogadorPadrao(B), carteira: b })
  return m
}
async function saldo(m, jid) { return (await m.jogadores.findOne({ jid })).carteira }
function total(m) {
  return [...m.estado.jogadores.values()].reduce((s, p) => s + eco.centavos(p.carteira, true) + eco.centavos(p.banco, true), 0)
}
function invariantes(m, esperado) {
  assert.equal(total(m), esperado)
  for (const p of m.estado.jogadores.values()) {
    assert.ok(p.carteira >= 0 && p.banco >= 0)
    eco.centavos(p.carteira, true); eco.centavos(p.banco, true)
  }
}
async function teste(nome, fn) { await fn(); aprovados++; console.log('OK ' + nome) }
async function main() {
  await teste('cadastro concorrente com transferência preserva campos antigos', async () => {
    const m = await preparar()
    let soltar, avisar
    const esperando = new Promise(r => { soltar = r })
    const entrou = new Promise(r => { avisar = r })
    m.hooks.antesUpdate = async ({ update }) => {
      if (update.$set?.nome) { avisar(); await esperando }
    }
    const registro = require('../comandos/rpg/registrar').executar({
      sendMessage: async () => {}, groupMetadata: async () => ({ participants: [] })
    }, GRUPO, { key: { participant: A, remoteJid: GRUPO } }, '/registrar Helena F')
    await entrou
    const r = await eco.transferirEntreJogadores(A, B, 30, ctx())
    assert.equal(r.ok, true)
    soltar(); await registro
    const p = await db.getPlayer(A)
    assert.equal(p.nome, 'Helena'); assert.equal(p.carteira, 70)
    assert.deepEqual(p.antigo, { tesouro: ['item'] })
    invariantes(m, 13000)
  })
  await teste('cadastro concorrente com depósito', async () => {
    const m = await preparar()
    let soltar, avisar
    const esperando = new Promise(r => { soltar = r })
    const entrou = new Promise(r => { avisar = r })
    m.hooks.antesUpdate = async ({ update }) => {
      if (update.$set?.nome) { avisar(); await esperando }
    }
    const gravando = require('../comandos/rpg/registrar').executar({
      sendMessage: async () => {}, groupMetadata: async () => ({ participants: [] })
    }, GRUPO, { key: { participant: A, remoteJid: GRUPO } }, '/registrar Ana F')
    await entrou
    const deposito = await eco.moverSaldo(A, 30, 'depositar', ctx())
    soltar()
    await gravando
    assert.equal(deposito.ok, true)
    const p = await db.getPlayer(A)
    assert.equal(p.nome, 'Ana')
    if (deposito.ok) { assert.equal(p.carteira, 70); assert.equal(p.banco, 40) }
    invariantes(m, 13000)
  })
  await teste('saldo insuficiente não credita e fica auditado', async () => {
    const m = await preparar()
    const r = await eco.transferirEntreJogadores(A, B, 101, ctx())
    assert.equal(r.motivo, 'saldo_insuficiente')
    assert.equal([...m.estado.operacoes.values()][0].estado, 'recusada')
    invariantes(m, 13000)
  })
  await teste('falha depois do crédito faz rollback', async () => {
    const m = await preparar()
    m.hooks.depoisUpdate = ({ nome, update, options }) => {
      if (nome === 'jogadores' && options.session && update.$set?.carteira === 50) throw new Error('rede após crédito')
    }
    const c = ctx()
    assert.equal((await eco.transferirEntreJogadores(A, B, 30, c)).ok, false)
    m.hooks = {}
    assert.equal((await eco.transferirEntreJogadores(A, B, 30, c)).ok, false)
    assert.equal(await saldo(m, A), 100); assert.equal(await saldo(m, B), 20)
    invariantes(m, 13000)
  })
  await teste('destinatário ausente no crédito aborta débito', async () => {
    const m = await preparar()
    const original = m.jogadores.updateOne
    m.jogadores.updateOne = async function(f, u, o) {
      if (o?.session && f.jid === B && u.$set?.carteira) return { matchedCount: 0, modifiedCount: 0 }
      return original.call(this, f, u, o)
    }
    assert.equal((await eco.transferirEntreJogadores(A, B, 30, ctx())).motivo, 'jogador_ausente')
    invariantes(m, 13000)
  })
  await teste('mesma mensagem repetida, concorrente e após reinício', async () => {
    const m = await preparar()
    const c = ctx()
    const rs = await Promise.all(Array.from({ length: 10 }, () => eco.transferirEntreJogadores(A, B, 30, c)))
    assert.equal(rs.filter(r => r.ok && !r.repetida).length, 1)
    db.__definirContextoTeste(null); db.__definirContextoTeste(m)
    const repetida = await eco.transferirEntreJogadores(A, B, 30, c)
    assert.equal(repetida.repetida, true); assert.equal(repetida.ok, true)
    assert.equal((await eco.transferirEntreJogadores(A, B, 31, c)).motivo, 'operacao_conflitante')
    assert.equal(await saldo(m, A), 70); invariantes(m, 13000)
  })
  await teste('mesmo ID em outros contextos não colide', async () => {
    const m = await preparar()
    assert.ok((await eco.transferirEntreJogadores(A, B, 10, ctx('ID'))).ok)
    assert.ok((await eco.transferirEntreJogadores(A, B, 10, { ...ctx('ID'), chat: '1203600001@g.us' })).ok)
    assert.ok((await eco.transferirEntreJogadores(B, A, 5, ctx('ID'))).ok)
    assert.equal(m.estado.operacoes.size, 3); invariantes(m, 13000)
  })
  await teste('falha de confirmação não repete nem anuncia falha financeira', async () => {
    const m = await preparar()
    const cmd = require('../comandos/rpg/transferir')
    let tentativas = 0
    const sock = { groupMetadata: async () => ({ participants: [] }), sendMessage: async () => { tentativas++; throw new Error('WhatsApp offline') } }
    const msg = { key: { participant: A, remoteJid: GRUPO, id: 'CONFIRMACAO' } }
    await cmd.executar(sock, GRUPO, msg, '/transferir ' + B.split('@')[0] + ' 30')
    assert.equal(tentativas, 2)
    await cmd.executar(sock, GRUPO, msg, '/transferir ' + B.split('@')[0] + ' 30')
    assert.equal(tentativas, 3); assert.equal(await saldo(m, A), 70)
    invariantes(m, 13000)
  })
  await teste('PN/LID comprovados, dispositivos e legado único', async () => {
    const m = await preparar()
    const pn = A.split('@')[0], l = '998877@lid'
    lid.__definirConsultaSessaoTeste(async id => id === '998877' ? pn : null)
    assert.equal((await db.getPlayer(l))._id, (await db.getPlayer(pn))._id)
    assert.equal((await db.getPlayer(pn + ':12@s.whatsapp.net'))._id, (await db.getPlayer(A))._id)
    const p = await m.jogadores.findOne({ jid: A })
    await m.jogadores.updateOne({ _id: p._id }, { $set: { jid: pn } })
    assert.equal((await db.getPlayer(A)).jid, pn)
    const r = await eco.transferirEntreJogadores(l, B, 10, ctx())
    assert.equal(r.ok, true); assert.equal(m.estado.jogadores.size, 2)
    await m.jogadores.updateOne({ _id: p._id }, { $set: { jid: '998877:4@lid' } })
    assert.equal((await db.getPlayer(l)).jid, '998877:4@lid')
    invariantes(m, 13000)
  })
  await teste('identidades conflitantes e fichas duplicadas bloqueadas', async () => {
    const m = await preparar()
    const pn = A.split('@')[0]
    const participantes = [{ id: '998877@lid', phoneNumber: B }]
    lid.__definirConsultaSessaoTeste(async () => pn)
    await assert.rejects(resolverIdentidade('998877@lid', participantes), { codigo: 'identidade_ambigua' })
    await m.jogadores.insertOne({ ...db.criarJogadorPadrao(pn), carteira: 12 })
    await assert.rejects(db.getPlayer(A), { codigo: 'cadastros_ambiguos' })
    const r = await eco.transferirEntreJogadores(A, B, 10, ctx())
    assert.equal(r.motivo, 'cadastros_ambiguos'); invariantes(m, 14200)
  })
  await teste('dígitos iguais PN/LID não são prova e órfão não vira conta nova', async () => {
    const m = await preparar()
    const pn = A.split('@')[0]
    await assert.rejects(resolverIdentidade(pn + '@lid', [{ id: A, phoneNumber: A }]), { codigo: 'identidade_nao_comprovada' })
    await m.jogadores.insertOne(db.criarJogadorPadrao('12345@lid'))
    await assert.rejects(db.getPlayer('5511999993333'), { codigo: 'legados_pendentes' })
    assert.equal(m.estado.jogadores.size, 3); invariantes(m, 13000)
  })
  await teste('transferência para si PN/LID recusada', async () => {
    const m = await preparar()
    lid.__definirConsultaSessaoTeste(async () => A.split('@')[0])
    assert.equal((await eco.transferirEntreJogadores('99@lid', A, 10, ctx())).motivo, 'mesmo_jogador')
    assert.equal(m.estado.operacoes.size, 0); invariantes(m, 13000)
  })
  await teste('mesclagem é diagnóstico e savePlayer protege dinheiro/identidade', async () => {
    const m = await preparar()
    await m.jogadores.insertOne({ ...db.criarJogadorPadrao('12345@lid'), carteira: 66 })
    const antes = structuredClone(m.estado)
    const r = await db.corrigirJogadoresComLid()
    assert.equal(r.bloqueado, true); assert.equal(r.mesclados, 0)
    assert.deepEqual(m.estado, antes)
    for (const data of [{ carteira: 0 }, { jid: B }, { inventario: [] }, { xpTrabalho: 0 }])
      await assert.rejects(db.savePlayer(A, data), { codigo: 'campos_protegidos' })
    assert.deepEqual(m.estado, antes)
  })
  await teste('Mongo sem transações recusa todas as movimentações', async () => {
    const m = await preparar()
    m.semTransacoes = true
    assert.equal((await eco.transferirEntreJogadores(A, B, 10, ctx())).motivo, 'transacao_indisponivel')
    assert.equal((await eco.moverSaldo(A, 10, 'depositar', ctx())).motivo, 'transacao_indisponivel')
    invariantes(m, 13000)
  })
  await teste('commit ambíguo sem conclusão fica bloqueado após reinício', async () => {
    const m = await preparar()
    m.falhaCommit = 'antes'
    const c = ctx()
    assert.equal((await eco.transferirEntreJogadores(A, B, 10, c)).motivo, 'resultado_pendente')
    m.falhaCommit = null
    db.__definirContextoTeste(m)
    assert.equal((await eco.transferirEntreJogadores(A, B, 10, c)).motivo, 'resultado_pendente')
    invariantes(m, 13000)
  })
  await teste('commit concluído com resposta perdida recupera auditoria', async () => {
    const m = await preparar()
    m.falhaCommit = 'depois'
    const c = ctx()
    assert.equal((await eco.transferirEntreJogadores(A, B, 10, c)).ok, true)
    m.falhaCommit = null
    assert.equal((await eco.transferirEntreJogadores(A, B, 10, c)).repetida, true)
    assert.equal(await saldo(m, A), 90); invariantes(m, 13000)
  })
  await teste('rótulo de commit desconhecido prevalece sobre conflito transitório', async () => {
    const m = await preparar()
    m.erroCommit = Object.assign(new Error('commit desconhecido'), {
      hasErrorLabel: label => ['UnknownTransactionCommitResult', 'TransientTransactionError'].includes(label)
    })
    const c = ctx()
    assert.equal((await eco.transferirEntreJogadores(A, B, 10, c)).motivo, 'resultado_pendente')
    m.erroCommit = null
    assert.equal((await eco.transferirEntreJogadores(A, B, 10, c)).motivo, 'resultado_pendente')
    invariantes(m, 13000)
  })
  await teste('reserva não confirmada não inicia movimentação', async () => {
    const m = await preparar()
    const original = m.operacoes.insertOne
    m.operacoes.insertOne = async (...args) => {
      await original(...args)
      return { acknowledged: false }
    }
    const c = ctx()
    assert.equal((await eco.transferirEntreJogadores(A, B, 10, c)).motivo, 'resultado_pendente')
    m.operacoes.insertOne = original
    assert.equal((await eco.transferirEntreJogadores(A, B, 10, c)).motivo, 'resultado_pendente')
    invariantes(m, 13000)
  })
  await teste('limite de crédito e contexto incompleto são recusados', async () => {
    const m = await preparar(100, eco.MAX_CENTAVOS / 100)
    const esperado = total(m)
    assert.equal((await eco.transferirEntreJogadores(A, B, 1, ctx())).motivo, 'limite_financeiro')
    assert.equal((await eco.transferirEntreJogadores(A, B, 1)).motivo, 'operacao_invalida')
    assert.equal((await eco.moverSaldo(A, 1, 'depositar', { chat: GRUPO })).motivo, 'operacao_invalida')
    invariantes(m, esperado)
  })
  await teste('limites e formatos monetários sem conversão dos legados', async () => {
    const m = await preparar()
    for (const v of ['NaN', 'Infinity', '-1', '0', '1e3', '0x10', '1.234', '1,234', '1.00,00', '0.001', '1000000001'])
      assert.equal(eco.parseValor(v), null, v)
    assert.equal(eco.parseValor('1.234,56'), 1234.56)
    assert.equal(eco.parseValor('1234.56'), 1234.56)
    assert.equal(eco.parseValor('TUDO'), 'todos')
    for (const v of [NaN, Infinity, -1, 0, Number.MAX_VALUE]) assert.equal((await eco.transferirEntreJogadores(A, B, v, ctx())).ok, false)
    const p = await m.jogadores.findOne({ jid: A })
    await m.jogadores.updateOne({ _id: p._id }, { $set: { carteira: 100.001 } })
    assert.equal((await eco.moverSaldo(A, 10, 'depositar', ctx())).motivo, 'saldo_incompativel')
    assert.equal(await saldo(m, A), 100.001)
  })
  await teste('centavos mantêm conservação sem arredondamento no mock', async () => {
    const m = await preparar(0.3, 0.1)
    const esperado = total(m)
    for (let i = 0; i < 10; i++) {
      assert.equal((await eco.transferirEntreJogadores(A, B, 0.01, ctx())).ok, true)
      invariantes(m, esperado)
    }
    assert.equal(await saldo(m, A), 0.2)
  })
  await teste('várias transferências e depósitos simultâneos conservam recursos', async () => {
    const m = await preparar()
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) =>
      i % 2 ? eco.transferirEntreJogadores(A, B, 10, ctx()) : eco.moverSaldo(A, 5, 'depositar', ctx())))
    assert.ok(rs.some(r => r.ok))
    assert.ok(rs.filter(r => !r.ok).every(r => r.motivo === 'concorrencia_recusada'))
    invariantes(m, 13000)
    assert.equal([...m.estado.operacoes.values()].filter(o => o.estado === 'concluida').length, rs.filter(r => r.ok).length)
    assert.ok([...m.estado.operacoes.values()].every(o => ['concluida', 'recusada'].includes(o.estado)))
  })
  await teste('comandos, aliases, prefixo, privado, todos e diagnóstico', async () => {
    const m = await preparar()
    prefixo.__definirPrefixoTeste('!')
    const enviados = []
    const sock = { sendMessage: async (jid, c) => enviados.push(c.text), groupMetadata: async () => ({ participants: [] }) }
    const msg = { key: { remoteJid: A, id: 'PRIVADO' } }
    const cmds = ['registrar', 'ficha', 'carteira', 'depositar', 'sacar', 'transferir', 'testrpg'].map(n => require('../comandos/rpg/' + n))
    assert.deepEqual(cmds.flatMap(c => c.aliases || []), ['rpgperfil', 'banco', 'saldo', 'dinheiro', 'dep', 'deposito', 'saque', 'retirar', 'transf', 'pix'])
    await cmds[0].executar(sock, A, msg, '!registrar Maria Silva feminino')
    await cmds[1].executar(sock, A, msg); await cmds[2].executar(sock, A, msg)
    await cmds[3].executar(sock, A, msg, '!depositar todos')
    await cmds[4].executar(sock, A, { key: { ...msg.key, id: 'SAQUE' } }, '!sacar tudo')
    await cmds[6].executar(sock, A, msg)
    assert.ok(enviados.some(t => t.includes('!registrar') || t.includes('!ficha')))
    assert.ok(enviados.every(t => !/\/(?:registrar|ficha|carteira|sacar|depositar)/.test(t)))
    assert.ok(enviados.at(-1).includes('Fundação OK'))
    assert.ok(!enviados.at(-1).includes(A))
    assert.equal((await db.getPlayer(A)).nome, 'Maria Silva')
    assert.equal(await saldo(m, A), 110); invariantes(m, 13000)
  })
  console.log('RPG segurança: ' + aprovados + ' cenários aprovados (offline).')
}
const timeout = setTimeout(() => { console.error('FALHA: timeout da suíte RPG offline'); process.exitCode = 1 }, 10000)
main().catch(err => { console.error('FALHA na suíte RPG offline:', err); process.exitCode = 1 })
  .finally(() => clearTimeout(timeout))
