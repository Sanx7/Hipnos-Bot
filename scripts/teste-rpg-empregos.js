process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const db = require('../rpg/database')
const eco = require('../rpg/economia')
const emp = require('../rpg/empregos')
const cat = require('../rpg/empregos-catalogo')
const { criarMongoFake } = require('./helpers/rpg-mongo-fake')
const lid = require('../lid')
const prefixo = require('../prefixo')
const A = '00000000000001@s.whatsapp.net'
const B = '00000000000002@s.whatsapp.net'
let tempo = 1700000000000, sequencia = 0, aprovados = 0
const ctx = (id = 'EMP-' + ++sequencia, participantes = []) => ({ chat: '00000000000000@g.us', mensagem: id, participantes })
const diploma = { fixtureDiplomas: true }
async function concederFixtures(m) {
  const diplomas = require('../rpg/faculdades-catalogo').CURSOS.map(c => ({ id: eco.hash('fixture-' + c.id), comprovacaoId: eco.hash('fixture-' + c.id), cursoId: c.id, concluidaEm: tempo - 1000 }))
  await alterar(m, { academico: { versao: 1, matricula: null, diplomas, historico: [] } })
  for (const d of diplomas) await m.operacoes.insertOne({ _id: d.id, estado: 'concluida', tipo: 'estudar', remetente: A, resultado: { ok: true, diploma: d } })
}
async function preparar(extra = {}) {
  tempo = 1700000000000
  emp.__definirRelogioTeste(() => tempo)
  lid.__definirConsultaSessaoTeste(async () => null)
  prefixo.__definirPrefixoTeste('/')
  const m = criarMongoFake()
  db.__definirContextoTeste(m)
  await m.jogadores.insertOne({ ...db.criarJogadorPadrao(A), nome: 'Ficticio', carteira: 100,
    campoAntigo: { intacto: ['sim'] }, ...extra })
  if (extra.escolaridade?.fixtureDiplomas) await concederFixtures(m)
  return m
}
const jogador = () => db.getPlayer(A)
async function alterar(m, data) { await m.jogadores.updateOne({ jid: A }, { $set: data }) }
async function teste(nome, fn) { await fn(); aprovados++; console.log('OK ' + nome) }
async function main() {
  await teste('34 carreiras, todos os nomes e sequências oficiais, IDs estáveis', async () => {
    const nomes = [
      'Entregador', 'Revendedor da Jaboticário', 'Revendedor da Je-Kiti-Ke', 'Uber|Motorista de Fuga',
      'Repositor do Açaí|Gerente de Reposição', 'Telemarketing|Gerente de Telemarketing',
      'Gari|Lixeiro Chefe|Piloto de Caminhão do Lixo', 'Ajudante de Pedreiro|Pedreiro|Mestre de Obra',
      'Jardineiro|Jardineiro Chefe|Escultor de Jardins', 'Aprendiz de Cozinha|Cozinheiro|Chefe de Cozinha',
      'Confeiteiro Aprendiz|Confeiteiro|Mestre Confeiteiro', 'Faxineiro', 'Passeador de Cães',
      'Eletricista Júnior|Eletricista Chefe|Mestre Eletricista', 'Recepcionista|Secretária|Secretária Chefe',
      'Encanador|Mestre dos Canos', 'Mecânico|Mecânico Chefe', 'Vidraceiro|Mestre dos Vidros',
      'Porteiro|Zelador|Síndico', 'Técnico de Enfermagem|Enfermeiro|Chefe de Enfermagem',
      'Dev Júnior|Dev|Dev Pro', 'Aprendiz de Cabeleireiro|Cabeleireiro|Mestre Cabeleireiro',
      'Engenheiro Júnior|Engenheiro|Engenheiro Chefe', 'Desenvolvedor de Apps',
      'Médico|Cirurgião|Chefe de Cirurgia', 'Advogado|Juiz|Mestre', 'Físico|Astrofísico',
      'Marketing|Chefe de Marketing', 'Bancário', 'Corretor da Bolsa de Valores',
      'Pediatra|Chefe da Pediatria', 'Veterinária|Veterinária Chefe',
      'Professor|Subdiretor|Diretor', 'Jogador de Base|Jogador Profissional|Ídolo do Clube'
    ]
    assert.deepEqual(cat.CARREIRAS.map(c => c.cargos.map(g => g.nome).join('|')), nomes)
    assert.equal(new Set(cat.CARREIRAS.map(c => c.id)).size, 34)
    cat.CARREIRAS.forEach((c, i) => {
      assert.match(c.id, /^[a-z][a-z_]+$/)
      assert.equal(c.ordem, i + 1)
      assert.equal(c.nivelCarreira, i < 13 ? 1 : i < 22 ? 2 : 3)
      c.cargos.forEach((g, j) => {
        assert.equal(g.numero, j + 1)
        assert.ok(g.salario > 0)
        if (j) assert.ok(g.salario > c.cargos[j - 1].salario)
      })
    })
    assert.equal(cat.carreiraPorId('faxineiro').cargos[0].salario, 100)
    assert.equal(cat.carreiraPorId('passeador_caes').cargos[0].salario, 50)
  })
  await teste('contratação de todas as carreiras e todos os cargos promocionais', async () => {
    for (const carreira of cat.CARREIRAS) {
      const m = await preparar({ xpTierTotal: 1500, escolaridade: diploma })
      assert.equal((await emp.contratar(A, carreira.id, false, ctx())).ok, true)
      for (const cargo of carreira.cargos.slice(1)) {
        await alterar(m, { xpTrabalho: cargo.xpMinimo })
        const r = await emp.promover(A, ctx())
        assert.equal(r.ok, true, cargo.nome)
        assert.equal(r.cargo, cargo.nome)
        assert.equal((await jogador()).cargo, cargo.numero)
      }
      assert.equal((await emp.promover(A, ctx())).motivo, 'sem_promocao')
      assert.equal((await jogador()).carteira, 100)
    }
  })
  await teste('níveis da carreira e do jogador são separados e bloqueados nos limites', async () => {
    const m = await preparar({ xpTierTotal: 499, escolaridade: diploma })
    assert.equal((await emp.contratar(A, 'eletricista', false, ctx())).motivo, 'progressao_insuficiente')
    await alterar(m, { xpTierTotal: 500 })
    assert.equal((await emp.contratar(A, 'eletricista', false, ctx())).ok, true)
    await alterar(m, { xpTierTotal: 1499 })
    assert.equal((await emp.contratar(A, 'engenheiro', true, ctx())).motivo, 'progressao_insuficiente')
    await alterar(m, { xpTierTotal: 1500 })
    assert.equal((await emp.contratar(A, 'engenheiro', true, ctx())).ok, true)
    assert.equal(cat.nivelProfissional(1500), 16)
    assert.equal(cat.carreiraPorId('engenheiro').nivelCarreira, 3)
  })
  await teste('cargos acadêmicos avançados exigem diploma persistido; futebol é exceção autorizada', async () => {
    const m = await preparar({ xpTierTotal: 2000 })
    for (const c of cat.CARREIRAS.filter(c => c.nivelCarreira === 3 && c.id !== 'jogador')) {
      assert.equal((await emp.contratar(A, c.id, false, ctx())).motivo, 'faculdade_obrigatoria')
      assert.ok(c.cargos.every(g => g.exigeFaculdade))
    }
    for (const faculdade of [{ status: 'concluida' }, { status: 'em_andamento', comprovacaoId: 'fixture', concluidaEm: 1 },
      { status: 'concluida', comprovacaoId: 'fixture', concluidaEm: tempo + 1 }]) {
      await alterar(m, { escolaridade: { faculdade } })
      assert.equal((await emp.contratar(A, 'medico', false, ctx())).motivo, 'faculdade_obrigatoria')
    }
    assert.equal((await jogador()).emprego, null)
  })
  await teste('Enfermagem: técnico sem diploma, enfermeiro e chefia com diploma e XP', async () => {
    const m = await preparar({ xpTierTotal: 500 })
    assert.equal((await emp.contratar(A, 'enfermagem', false, ctx())).ok, true)
    await alterar(m, { xpTrabalho: 100 })
    assert.equal((await emp.promover(A, ctx())).motivo, 'faculdade_obrigatoria')
    assert.equal((await jogador()).cargo, 1)
    await concederFixtures(m)
    assert.equal((await emp.promover(A, ctx())).ok, true)
    assert.equal((await emp.promover(A, ctx())).motivo, 'xp_promocao_insuficiente')
    await alterar(m, { xpTrabalho: 300 })
    assert.equal((await emp.promover(A, ctx())).ok, true)
    assert.equal((await jogador()).cargo, 3)
    await alterar(m, { academico: { versao: 1, matricula: null, diplomas: [], historico: [] } })
    assert.equal((await emp.trabalhar(A, ctx())).motivo, 'faculdade_obrigatoria')
  })
  await teste('jornada: salário, XP, energia e cooldown atômicos; replay e reinício sem duplicação', async () => {
    const m = await preparar()
    assert.equal((await emp.contratar(A, 'faxineiro', false, ctx())).ok, true)
    const c = ctx()
    assert.equal((await emp.trabalhar(A, c)).ok, true)
    let p = await jogador()
    assert.equal(p.carteira, 200); assert.equal(p.xpTrabalho, 25); assert.equal(p.xpTierTotal, 25)
    assert.equal(p.energia, 90); assert.equal(p.cooldowns.trabalhar, tempo)
    assert.deepEqual(p.campoAntigo, { intacto: ['sim'] })
    db.__definirContextoTeste(null); db.__definirContextoTeste(m)
    tempo += cat.COOLDOWN_JORNADA_MS
    assert.equal((await emp.trabalhar(A, c)).repetida, true)
    assert.equal((await jogador()).carteira, 200)
    assert.equal((await emp.trabalhar(A, ctx())).ok, true)
    p = await jogador()
    assert.equal(p.carteira, 300); assert.equal(p.energia, 90); assert.equal(p.xpTierTotal, 50)
    assert.equal([...m.estado.operacoes.values()].filter(o => o.tipo === 'trabalhar' && o.estado === 'concluida').length, 2)
  })
  await teste('jornadas repetidas e mensagens diferentes concorrentes não multiplicam salário', async () => {
    const m = await preparar()
    await emp.contratar(A, 'passeador_caes', false, ctx())
    const c = ctx()
    const rs = await Promise.all(Array.from({ length: 8 }, () => emp.trabalhar(A, c)))
    assert.equal(rs.filter(r => r.ok && !r.repetida).length, 1)
    assert.equal((await jogador()).carteira, 150)
    tempo += cat.COOLDOWN_JORNADA_MS
    const concorrentes = await Promise.all(Array.from({ length: 8 }, () => emp.trabalhar(A, ctx())))
    assert.equal(concorrentes.filter(r => r.ok).length, 1)
    assert.equal((await jogador()).carteira, 200)
    assert.equal((await jogador()).xpTierTotal, 50)
    assert.ok([...m.estado.jogadores.values()].every(p => p.carteira >= 0 && p.energia >= 0))
  })
  await teste('troca explícita mantém histórico, XP total e cooldown; emprego desconhecido preservado', async () => {
    const m = await preparar({ empregosAnteriores: ['legado'], cooldowns: { outraAcao: 1 } })
    await emp.contratar(A, 'faxineiro', false, ctx())
    await emp.trabalhar(A, ctx())
    assert.equal((await emp.contratar(A, 'passeador_caes', false, ctx())).motivo, 'confirmacao_troca')
    assert.equal((await emp.contratar(A, 'passeador_caes', true, ctx())).ok, true)
    let p = await jogador()
    assert.equal(p.xpTierTotal, 25); assert.equal(p.xpTrabalho, 0)
    assert.equal(p.empregosAnteriores[0], 'legado')
    assert.equal(p.empregosAnteriores[1].emprego, 'faxineiro')
    assert.equal(p.cooldowns.outraAcao, 1)
    assert.equal((await emp.trabalhar(A, ctx())).motivo, 'jornada_cooldown')
    await alterar(m, { emprego: 'Profissão Antiga Desconhecida' })
    const antes = await jogador()
    assert.equal((await emp.trabalhar(A, ctx())).motivo, 'emprego_legado_pendente')
    assert.equal((await jogador()).emprego, antes.emprego)
    assert.equal((await emp.contratar(A, 'entregador', false, ctx())).motivo, 'confirmacao_troca')
  })
  await teste('cargo antigo por nome permanece sem migração; limites, energia e XP inválidos recusados', async () => {
    const m = await preparar({ emprego: 'Ajudante de Pedreiro', cargo: 2, energia: 9 })
    assert.equal((await emp.trabalhar(A, ctx())).motivo, 'energia_sem_referencia')
    assert.equal((await jogador()).emprego, 'Ajudante de Pedreiro')
    await alterar(m, { energia: 100, xpTrabalho: 99 })
    assert.equal((await emp.promover(A, ctx())).motivo, 'xp_promocao_insuficiente')
    await alterar(m, { carteira: eco.MAX_CENTAVOS / 100 })
    assert.equal((await emp.trabalhar(A, ctx())).motivo, 'limite_financeiro')
    await alterar(m, { carteira: 100, xpTierTotal: 'antigo' })
    assert.equal((await emp.trabalhar(A, ctx())).motivo, 'progresso_incompativel')
  })
  await teste('falha após atualização salarial aborta tudo e conserva pendente', async () => {
    const m = await preparar({ emprego: 'faxineiro' })
    const antes = await jogador()
    m.hooks.depoisUpdate = ({ update, options }) => {
      if (options.session && update.$set?.cooldowns?.trabalhar) throw new Error('falha simulada')
    }
    const c = ctx()
    assert.equal((await emp.trabalhar(A, c)).ok, false)
    assert.deepEqual(await jogador(), antes)
    m.hooks = {}
    assert.equal((await emp.trabalhar(A, c)).motivo, 'resultado_pendente')
    assert.deepEqual(await jogador(), antes)
  })
  await teste('energia baixa recupera a partir da contratação, sem salário antes do custo mínimo', async () => {
    await preparar({ energia: 5 })
    await emp.contratar(A, 'faxineiro', false, ctx())
    assert.equal((await emp.trabalhar(A, ctx())).motivo, 'energia_insuficiente')
    assert.equal((await jogador()).carteira, 100)
    tempo += 5 * cat.RECUPERACAO_ENERGIA_MS
    assert.equal((await emp.trabalhar(A, ctx())).ok, true)
    assert.equal((await jogador()).energia, 0)
    assert.equal((await jogador()).carteira, 200)
  })
  await teste('commit ambíguo, suporte transacional e reserva de outra categoria', async () => {
    const m = await preparar({ emprego: 'faxineiro' })
    m.falhaCommit = 'depois'
    const c = ctx()
    assert.equal((await emp.trabalhar(A, c)).ok, true)
    m.falhaCommit = null
    assert.equal((await emp.trabalhar(A, c)).repetida, true)
    assert.equal((await eco.moverSaldo(A, 1, 'depositar', c)).motivo, 'operacao_conflitante')
    const carteira = (await jogador()).carteira
    m.semTransacoes = true
    tempo += cat.COOLDOWN_JORNADA_MS
    assert.equal((await emp.trabalhar(A, ctx())).motivo, 'transacao_indisponivel')
    assert.equal((await jogador()).carteira, carteira)
  })
  await teste('salário concorrente com depósito: apenas renda auditada altera total', async () => {
    const m = await preparar({ emprego: 'faxineiro' })
    await Promise.all([emp.trabalhar(A, ctx()), eco.moverSaldo(A, 20, 'depositar', ctx())])
    const concluidas = [...m.estado.operacoes.values()].filter(o => o.tipo === 'trabalhar' && o.estado === 'concluida')
    const p = await jogador()
    assert.equal(eco.centavos(p.carteira, true) + eco.centavos(p.banco, true), 10000 + concluidas.length * 10000)
    assert.equal(p.xpTierTotal, concluidas.length * 25)
  })
  await teste('JID/LID, mensagens, prefixo, ficha e falha de envio sem repetir salário', async () => {
    const m = await preparar({ emprego: 'faxineiro' })
    lid.__definirConsultaSessaoTeste(async n => n === '00000000000099' ? A.split('@')[0] : null)
    assert.equal((await emp.trabalhar('00000000000099@lid', ctx())).ok, true)
    assert.equal((await jogador()).carteira, 200)
    tempo += cat.COOLDOWN_JORNADA_MS
    prefixo.__definirPrefixoTeste('!')
    const enviados = []
    const sock = { groupMetadata: async () => ({ participants: [] }), sendMessage: async (_, c) => enviados.push(c.text) }
    const msg = { key: { participant: A, remoteJid: '00000000000000@g.us', id: 'COMANDO-TRAB' } }
    await require('../comandos/rpg/empregos').executar(sock, msg.key.remoteJid, msg, '!empregos 3')
    assert.ok(enviados.at(-1).includes('Jogador de Base'))
    assert.ok(enviados.at(-1).includes('!carreira'))
    await require('../comandos/rpg/ficha').executar(sock, msg.key.remoteJid, msg)
    assert.ok(enviados.at(-1).includes('Faxineiro'))
    const cmd = require('../comandos/rpg/trabalhar')
    await cmd.executar({ ...sock, sendMessage: async () => { throw new Error('envio offline') } }, msg.key.remoteJid, msg, '!trabalhar')
    await cmd.executar(sock, msg.key.remoteJid, msg, '!trabalhar')
    assert.equal((await jogador()).carteira, 300)
    assert.ok(enviados.at(-1).includes('já processada'))
    assert.equal(m.estado.jogadores.size, 1)
  })
  console.log('RPG empregos: ' + aprovados + ' cenários aprovados (offline).')
}
const timeout = setTimeout(() => { console.error('Timeout RPG empregos'); process.exitCode = 1 }, 10000)
main().catch(err => { console.error('FALHA RPG empregos:', err); process.exitCode = 1 }).finally(() => clearTimeout(timeout))
