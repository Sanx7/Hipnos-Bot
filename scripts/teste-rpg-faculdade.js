// Apenas MongoDB/WhatsApp simulados; nenhuma conexão externa ou credencial.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const db = require('../rpg/database')
const eco = require('../rpg/economia')
const fac = require('../rpg/faculdade')
const cat = require('../rpg/faculdades-catalogo')
const emp = require('../rpg/empregos')
const empregos = require('../rpg/empregos-catalogo')
const { criarMongoFake } = require('./helpers/rpg-mongo-fake')
const lid = require('../lid')
const prefixo = require('../prefixo')
const A = '00000000000001@s.whatsapp.net', B = '00000000000002@s.whatsapp.net'
const G = '00000000000000@g.us'
let tempo = 1700000000000, sequencia = 0, aprovados = 0
const ctx = (id = 'FAC-' + ++sequencia, participantes = []) => ({ chat: G, mensagem: id, participantes })
async function preparar(extra = {}) {
  tempo = 1700000000000
  fac.__definirRelogioTeste(() => tempo)
  emp.__definirRelogioTeste(() => tempo)
  lid.__definirConsultaSessaoTeste(async () => null)
  prefixo.__definirPrefixoTeste('/')
  const m = criarMongoFake()
  db.__definirContextoTeste(m)
  await m.jogadores.insertOne({ ...db.criarJogadorPadrao(A), nome: 'Aluno fictício', ...extra })
  return m
}
const jogador = () => db.getPlayer(A)
async function alterar(m, data) { await m.jogadores.updateOne({ jid: A }, { $set: data }) }
async function cursar(id, ate) {
  assert.equal((await fac.matricular(A, id, ctx())).ok, true)
  return continuar(ate ?? cat.cursoPorId(id).sessoes)
}
async function continuar(quantidade) {
  let r
  for (let i = 0; i < quantidade; i++) {
    tempo += cat.COOLDOWN_ESTUDO_MS
    r = await fac.estudar(A, ctx())
    assert.equal(r.ok, true, JSON.stringify(r))
  }
  return r
}
async function teste(nome, fn) { await fn(); aprovados++; console.log('OK ' + nome) }
async function main() {
  await teste('dez cursos oficiais, IDs, durações e busca com acentos/nome composto', async () => {
    assert.equal(cat.CURSOS.length, 10)
    assert.equal(new Set(cat.CURSOS.map(c => c.id)).size, 10)
    assert.deepEqual(cat.CURSOS.map(c => c.sessoes), [35, 25, 25, 20, 20, 20, 20, 20, 20, 20])
    assert.equal(cat.resolverCurso('Ciência da Computação').id, 'ciencia_computacao')
    assert.equal(cat.resolverCurso('MEDICINA VETERINARIA').id, 'medicina_veterinaria')
    assert.equal(cat.resolverCurso('Curso inexistente'), null)
  })
  await teste('matrícula grátis com saldo zero, repetida, curso inválido e registro obrigatório', async () => {
    const m = await preparar()
    const c = ctx()
    assert.equal((await fac.matricular(A, 'medicina', c)).ok, true)
    assert.equal((await fac.matricular(A, 'medicina', c)).repetida, true)
    assert.equal((await fac.matricular(A, 'direito', ctx())).motivo, 'matricula_existente')
    assert.equal((await fac.matricular(A, 'inexistente', ctx())).motivo, 'curso_invalido')
    const p = await jogador()
    assert.equal(p.carteira, 0); assert.equal(p.banco, 0); assert.equal(p.energia, 100)
    assert.equal(p.academico.matricula.sessoesConcluidas, 0)
    await m.jogadores.insertOne({ ...db.criarJogadorPadrao(B) })
    assert.equal((await fac.matricular(B, 'medicina', ctx())).motivo, 'registro_obrigatorio')
  })
  await teste('energia insuficiente, recuperação compartilhada e nenhum consumo em erro', async () => {
    await preparar({ energia: 0 })
    await fac.matricular(A, 'fisica', ctx())
    const antes = await jogador()
    assert.equal((await fac.estudar(A, ctx())).motivo, 'energia_insuficiente')
    assert.deepEqual(await jogador(), antes)
    tempo += cat.COOLDOWN_ESTUDO_MS
    assert.equal((await fac.estudar(A, ctx())).ok, true)
    assert.equal((await jogador()).energia, 0)
    assert.equal((await jogador()).academico.matricula.sessoesConcluidas, 1)
  })
  await teste('cooldown exato, persistência, mensagem reprocessada e categoria conflitante', async () => {
    const m = await preparar()
    await fac.matricular(A, 'economia', ctx())
    const c = ctx()
    assert.equal((await fac.estudar(A, c)).ok, true)
    db.__definirContextoTeste(null); db.__definirContextoTeste(m)
    assert.equal((await fac.estudar(A, c)).repetida, true)
    assert.equal((await eco.moverSaldo(A, 1, 'depositar', c)).motivo, 'operacao_conflitante')
    tempo += cat.COOLDOWN_ESTUDO_MS - 1
    assert.equal((await fac.estudar(A, ctx())).motivo, 'estudo_cooldown')
    tempo++
    assert.equal((await fac.estudar(A, ctx())).ok, true)
    assert.equal((await jogador()).academico.matricula.sessoesConcluidas, 2)
  })
  await teste('conclusão de todos os cursos, múltiplos diplomas e dinheiro sempre intacto', async () => {
    const m = await preparar({ carteira: 12.34, banco: 45.67 })
    for (const c of cat.CURSOS) {
      const r = await cursar(c.id)
      assert.equal(r.diploma.cursoId, c.id)
      assert.equal((await jogador()).academico.matricula, null)
      assert.equal(await fac.diplomaComprovado(await jogador(), c.id, m.operacoes, undefined, A, tempo), true)
      assert.equal((await fac.matricular(A, c.id, ctx())).motivo, 'diploma_existente')
      assert.equal((await fac.estudar(A, ctx())).motivo, 'sem_matricula')
    }
    const p = await jogador()
    assert.equal(p.academico.diplomas.length, 10)
    assert.equal(p.academico.historico.filter(h => h.status === 'concluida').length, 10)
    assert.equal(p.carteira, 12.34); assert.equal(p.banco, 45.67)
    assert.equal(p.xpTierTotal, 0)
    assert.equal(new Set(p.academico.diplomas.map(d => d.id)).size, 10)
    const estudos = [...m.estado.operacoes.values()].filter(o => o.tipo === 'estudar' && o.estado === 'concluida')
    assert.equal(estudos.length, cat.CURSOS.reduce((s, c) => s + c.sessoes, 0))
    for (const o of estudos) {
      assert.equal(o.antes.carteira, o.depois.carteira); assert.equal(o.antes.banco, o.depois.banco)
      assert.ok(o.depois.energia >= 0)
    }
  })
  await teste('trancar/retomar preservam progresso, não permitem outro curso nem zeram cooldown', async () => {
    await preparar()
    await cursar('direito', 2)
    await fac.trancar(A, ctx())
    assert.equal((await fac.estudar(A, ctx())).motivo, 'matricula_trancada')
    assert.equal((await fac.matricular(A, 'medicina', ctx())).motivo, 'matricula_existente')
    assert.equal((await fac.trancar(A, ctx())).motivo, 'estado_matricula')
    assert.equal((await fac.retomar(A, ctx())).ok, true)
    assert.equal((await fac.estudar(A, ctx())).motivo, 'estudo_cooldown')
    const p = await jogador()
    assert.equal(p.academico.matricula.sessoesConcluidas, 2)
    assert.deepEqual(p.academico.historico.map(h => h.tipo), ['trancar', 'retomar'])
  })
  await teste('matrículas e estudos simultâneos não duplicam matrícula ou sessões', async () => {
    await preparar()
    const matriculas = await Promise.all(cat.CURSOS.map(c => fac.matricular(A, c.id, ctx())))
    assert.equal(matriculas.filter(r => r.ok).length, 1)
    const c = ctx()
    await Promise.all(Array.from({ length: 8 }, () => fac.estudar(A, c)))
    assert.equal((await jogador()).academico.matricula.sessoesConcluidas, 1)
    tempo += cat.COOLDOWN_ESTUDO_MS
    const estudos = await Promise.all(Array.from({ length: 8 }, () => fac.estudar(A, ctx())))
    assert.equal(estudos.filter(r => r.ok).length, 1)
    assert.equal((await jogador()).academico.matricula.sessoesConcluidas, 2)
  })
  await teste('última sessão concorrente emite um diploma único', async () => {
    const m = await preparar()
    await cursar('pedagogia', 19)
    tempo += cat.COOLDOWN_ESTUDO_MS
    const contextos = Array.from({ length: 6 }, () => ctx())
    const rs = await Promise.all(contextos.map(c => fac.estudar(A, c)))
    assert.equal(rs.filter(r => r.ok).length, 1)
    assert.equal((await jogador()).academico.diplomas.length, 1)
    assert.equal([...m.estado.operacoes.values()].filter(o => o.estado === 'concluida' && o.resultado?.diploma).length, 1)
    const original = contextos[rs.findIndex(r => r.ok)]
    assert.equal((await fac.estudar(A, original)).repetida, true)
    assert.equal((await jogador()).academico.diplomas.length, 1)
  })
  await teste('matrícula sem prova ou duração adulterada não concede estudo nem diploma', async () => {
    const m = await preparar()
    await fac.matricular(A, 'fisica', ctx())
    let a = (await jogador()).academico
    a.matricula.totalSessoes = 1
    await alterar(m, { academico: a })
    assert.equal((await fac.estudar(A, ctx())).motivo, 'academico_incompativel')
    a.matricula.totalSessoes = 20
    await alterar(m, { academico: a })
    await m.operacoes.updateOne({ _id: a.matricula.id }, { $set: { estado: 'pendente' } })
    assert.equal((await fac.estudar(A, ctx())).motivo, 'academico_incompativel')
    assert.equal((await jogador()).academico.diplomas.length, 0)
    assert.equal((await jogador()).energia, 100)
  })
  await teste('trancamento concorrente com estudo serializa sem perder dados', async () => {
    await preparar()
    await fac.matricular(A, 'enfermagem', ctx())
    const rs = await Promise.all([fac.trancar(A, ctx()), fac.estudar(A, ctx())])
    assert.equal(rs.filter(r => r.ok).length, 1)
    let p = await jogador()
    assert.equal(p.academico.matricula.sessoesConcluidas, rs[1].ok ? 1 : 0)
    if (p.academico.matricula.status === 'ativa') await fac.trancar(A, ctx())
    p = await jogador()
    assert.equal(p.academico.matricula.status, 'trancada')
    assert.equal(p.energia, rs[1].ok ? 90 : 100)
  })
  await teste('estudo/trabalho concorrem sobre a mesma energia sem consumo negativo', async () => {
    await preparar({ emprego: 'faxineiro', energia: 10, energiaAtualizadaEm: tempo })
    await fac.matricular(A, 'fisica', ctx())
    const rs = await Promise.all([fac.estudar(A, ctx()), emp.trabalhar(A, ctx())])
    assert.equal(rs.filter(r => r.ok).length, 1)
    const p = await jogador()
    assert.equal(p.energia, 0)
    assert.equal(p.academico.matricula.sessoesConcluidas, rs[0].ok ? 1 : 0)
    assert.equal(p.carteira, rs[1].ok ? 100 : 0)
  })
  await teste('falha após estudo aborta energia/progresso/diploma e mantém pendente para revisão', async () => {
    const m = await preparar()
    await cursar('fisica', 19)
    tempo += cat.COOLDOWN_ESTUDO_MS
    const antes = await jogador(), c = ctx()
    m.hooks.depoisUpdate = ({ options, update }) => { if (options.session && update.$set?.academico) throw new Error('falha simulada') }
    assert.equal((await fac.estudar(A, c)).motivo, 'resultado_pendente')
    assert.deepEqual(await jogador(), antes)
    m.hooks = {}
    assert.equal((await fac.estudar(A, c)).motivo, 'resultado_pendente')
    assert.equal((await jogador()).academico.diplomas.length, 0)
  })
  await teste('commit desconhecido antes/depois e Mongo sem transações não repetem efeitos', async () => {
    for (const falha of ['antes', 'depois']) {
      const m = await preparar()
      await fac.matricular(A, 'fisica', ctx())
      m.falhaCommit = falha
      const c = ctx(), r = await fac.estudar(A, c)
      assert.equal(r.ok, falha === 'depois')
      m.falhaCommit = null
      const replay = await fac.estudar(A, c)
      assert.equal(replay.ok, falha === 'depois')
      assert.equal((await jogador()).academico.matricula.sessoesConcluidas, falha === 'depois' ? 1 : 0)
    }
    const m = await preparar()
    m.semTransacoes = true
    assert.equal((await fac.matricular(A, 'fisica', ctx())).motivo, 'transacao_indisponivel')
    assert.equal((await jogador()).academico, undefined)
  })
  await teste('diplomas reais do curso certo desbloqueiam cargos, mas não substituem XP', async () => {
    for (const c of cat.CURSOS) {
      const m = await preparar()
      await cursar(c.id)
      for (const id of c.carreiras) {
        const carreira = empregos.carreiraPorId(id)
        await alterar(m, { emprego: null, cargo: 1, xpTrabalho: 0, xpTierTotal: carreira.xpTotalMinimo - 1 })
        assert.equal((await emp.contratar(A, id, false, ctx())).motivo, 'progressao_insuficiente')
        await alterar(m, { xpTierTotal: carreira.xpTotalMinimo })
        assert.equal((await emp.contratar(A, id, false, ctx())).ok, true)
        for (const cargo of carreira.cargos.slice(1)) {
          await alterar(m, { xpTrabalho: cargo.xpMinimo })
          assert.equal((await emp.promover(A, ctx())).ok, true, cargo.nome)
        }
      }
      const outra = c.id === 'medicina' ? 'advogado' : 'medico'
      await alterar(m, { emprego: null, xpTierTotal: 1500 })
      assert.equal((await emp.contratar(A, outra, false, ctx())).motivo, 'faculdade_obrigatoria')
    }
  })
  await teste('registro de diploma sem operação de conclusão comprovada não autoriza carreira', async () => {
    const m = await preparar({ xpTierTotal: 1500 })
    const d = (await cursar('medicina')).diploma
    await m.operacoes.updateOne({ _id: d.id }, { $set: { estado: 'pendente' } })
    assert.equal((await emp.contratar(A, 'medico', false, ctx())).motivo, 'faculdade_obrigatoria')
    await m.operacoes.updateOne({ _id: d.id }, { $set: { estado: 'concluida', remetente: B } })
    assert.equal((await emp.contratar(A, 'medico', false, ctx())).motivo, 'faculdade_obrigatoria')
  })
  await teste('Jogador não exige faculdade por decisão do usuário; XP e promoções preservados', async () => {
    const m = await preparar({ xpTierTotal: 1499 })
    assert.equal((await emp.contratar(A, 'jogador', false, ctx())).motivo, 'progressao_insuficiente')
    await alterar(m, { xpTierTotal: 1500 })
    assert.equal((await emp.contratar(A, 'jogador', false, ctx())).ok, true)
    for (const cargo of empregos.carreiraPorId('jogador').cargos.slice(1)) {
      await alterar(m, { xpTrabalho: cargo.xpMinimo })
      assert.equal((await emp.promover(A, ctx())).ok, true)
    }
    assert.equal((await jogador()).academico, undefined)
  })
  await teste('documentos antigos, saldos de formato legado e campos desconhecidos preservados', async () => {
    const legado = { faculdade: { status: 'concluida', comprovacaoId: 'antigo', concluidaEm: 1 }, outro: ['preservar'] }
    await preparar({ carteira: '12.34', banco: '0', escolaridade: legado, campoDesconhecido: { dados: [1, 2] } })
    await cursar('economia')
    const p = await jogador()
    assert.equal(p.carteira, '12.34'); assert.equal(p.banco, '0')
    assert.deepEqual(p.escolaridade, legado)
    assert.deepEqual(p.campoDesconhecido, { dados: [1, 2] })
    await preparar({ xpTierTotal: 1500, escolaridade: legado })
    assert.equal((await emp.contratar(A, 'medico', false, ctx())).motivo, 'faculdade_obrigatoria')
  })
  await teste('acadêmico incompatível bloqueia sem sobrescrever; desconhecidos válidos sobrevivem', async () => {
    const m = await preparar({ academico: { versao: 'antiga', livre: true } })
    const antes = await jogador()
    assert.equal((await fac.matricular(A, 'fisica', ctx())).motivo, 'academico_incompativel')
    assert.deepEqual(await jogador(), antes)
    await alterar(m, { academico: { versao: 1, matricula: null, diplomas: [], historico: [], desconhecido: ['sim'] } })
    await cursar('fisica', 1)
    assert.deepEqual((await jogador()).academico.desconhecido, ['sim'])
  })
  await teste('LID comprovado, desconhecido e fichas conflitantes não abrem atalhos', async () => {
    const m = await preparar()
    const L = '00000000000099@lid'
    assert.equal((await fac.matricular(L, 'fisica', ctx())).ok, false)
    lid.__definirConsultaSessaoTeste(async n => n === L.split('@')[0] ? A.split('@')[0] : null)
    assert.equal((await fac.matricular(L, 'fisica', ctx())).ok, true)
    const c = ctx()
    assert.equal((await fac.estudar(L, c)).ok, true)
    assert.equal((await fac.estudar(A, c)).repetida, true)
    assert.equal(m.estado.jogadores.size, 1)
    await m.jogadores.insertOne({ ...db.criarJogadorPadrao(L), nome: 'Conflito fictício' })
    assert.equal((await fac.trancar(L, ctx())).motivo, 'cadastros_ambiguos')
    assert.equal(m.estado.jogadores.size, 2)
  })
  await teste('comandos, prefixo dinâmico, nome composto, ficha, diplomas e falha de confirmação', async () => {
    await preparar()
    prefixo.__definirPrefixoTeste('!')
    const enviados = [], sock = { groupMetadata: async () => ({ participants: [] }), sendMessage: async (_, c) => enviados.push(c.text) }
    const mensagem = () => ({ key: { participant: A, remoteJid: G, id: 'CMD-' + ++sequencia } })
    const executar = (nome, texto) => require('../comandos/rpg/' + nome).executar(sock, G, mensagem(), texto || '!' + nome)
    await executar('faculdades')
    assert.ok(enviados.at(-1).includes('!matricular'))
    assert.ok(enviados.at(-1).includes('Medicina Veterinária'))
    await executar('matricular', '!matricular Ciência da Computação')
    assert.equal((await jogador()).academico.matricula.cursoId, 'ciencia_computacao')
    const c = mensagem(), cmd = require('../comandos/rpg/estudar')
    await cmd.executar({ ...sock, sendMessage: async () => { throw new Error('envio simulado') } }, G, c, '!estudar')
    await cmd.executar(sock, G, c, '!estudar')
    assert.equal((await jogador()).academico.matricula.sessoesConcluidas, 1)
    assert.ok(enviados.at(-1).includes('já processada'))
    await executar('ficha')
    assert.ok(enviados.at(-1).includes('Ciência da Computação'))
    assert.ok(enviados.at(-1).includes('Carteira:'))
    await executar('faculdade'); assert.ok(enviados.at(-1).includes('Sessões restantes: 19'))
    await executar('trancar'); await executar('retomar')
    await continuar(19)
    await executar('diplomas'); assert.ok(enviados.at(-1).includes('Ciência da Computação'))
    await executar('ficha'); assert.ok(enviados.at(-1).includes('Diplomas: 1'))
  })
  console.log('RPG faculdade: ' + aprovados + ' cenários aprovados (offline).')
}
main().catch(err => { console.error('FALHA RPG faculdade:', err); process.exitCode = 1 }).finally(() => {
  db.__definirContextoTeste(null)
  lid.__definirConsultaSessaoTeste(null)
  fac.__definirRelogioTeste(null); emp.__definirRelogioTeste(null)
  prefixo.__definirPrefixoTeste('/')
})
