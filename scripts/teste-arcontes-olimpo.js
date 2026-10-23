// Offline: não carrega o bot nem abre sockets ou conexões MongoDB.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
process.env.OWNER_NUMBERS = '00010000001'
require('node:net').Socket.prototype.connect = function () { throw new Error('REDE_PROIBIDA') }
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm')
const { createRequire } = require('node:module')
const fake = require('./helpers/colecoes-arcontes-fake')
const { criarRepositorio, preparar } = require('../dados/arcontes-olimpo-mongo')
const sistema = require('../dados/arcontes-olimpo')
const seguro = require('../dados/socket-seguro')
const lid = require('../lid')
lid.resolverLidsEmLote = async () => new Map()
const G = '100@g.us', H = '200@g.us'
const D = '00010000001', A = '00010000002', R = '00010000003', T = '00010000004', B = '00010000005', U = '00010000006'
const pn = n => `${n}@s.whatsapp.net`
let seq = 0, total = 0
async function contexto() {
  const cols = fake(); await preparar(cols)
  const repo = criarRepositorio(async () => cols)
  const c = { cols, repo, respostas: [], remocoes: [], tempo: 10000, lease: true }
  c.membros = [{ id: pn(A), admin: 'admin' }, { id: pn(D) }, { id: pn(R) },
    { id: pn(T) }, { id: pn(U) }, { id: pn(B), admin: 'admin' }]
  c.sock = { user: { id: pn(B) }, ws: { isOpen: true },
    async groupMetadata(grupo) {
      if (c.metaHook) await c.metaHook(grupo)
      return structuredClone({ participants: c.membros, owner: pn(A) })
    },
    async groupParticipantsUpdate(grupo, alvos, acao) {
      c.remocoes.push({ grupo, alvos, acao })
      if (c.removerHook) return c.removerHook(grupo, alvos)
      return alvos.map(jid => ({ jid, status: '200' }))
    },
    async sendMessage(grupo, conteudo) { c.respostas.push({ grupo, ...conteudo }); return { key: { id: 'offline' } } }
  }
  seguro.preparar(c.sock, () => c.lease); seguro.atualizar(c.sock, true)
  c.servico = sistema.criarServico(repo, { agora: () => c.tempo })
  c.msg = (autor = R, alvo = T, grupo = G, reply = false) => ({ key: {
    remoteJid: grupo, participant: autor.includes('@') ? autor : pn(autor), fromMe: false, id: `arconte-${++seq}`
  }, message: { extendedTextMessage: { contextInfo: alvo ? (reply
    ? { participant: alvo.includes('@') ? alvo : pn(alvo) }
    : { mentionedJid: [alvo.includes('@') ? alvo : pn(alvo)] }) : {} } } })
  c.run = async (acao, autor = R, alvo = T, grupo = G, msg, texto) => {
    c.tempo += 5000
    return c.servico.executar(acao, c.sock, grupo, msg || c.msg(autor, alvo, grupo), texto || `/${acao} @alvo motivo opcional`)
  }
  c.nomear = (numero = R, grupo = G) => c.run('arconte', A, numero, grupo)
  c.confirmadas = () => cols.eventos.docs.filter(d => d.tipo === 'kick' && d.estado === 'confirmada')
  c.ultima = () => c.respostas.at(-1)?.text || ''
  c.consultar = async (opcoes = '', autor = A, { privado = false, grupo = G, msg } = {}) => {
    const origem = privado ? (autor.includes('@') ? autor : pn(autor)) : grupo
    msg ||= c.msg(autor, null, origem)
    if (privado) delete msg.key.participant
    return c.run('historicoarconte', autor, null, origem, msg,
      `/historicoarconte ${privado ? `grupo ${grupo} ` : ''}${opcoes}`.trim())
  }
  return c
}
async function incerta() {
  const c = await contexto(); await c.nomear()
  c.removerHook = async () => []
  c.mensagemOriginal = c.msg()
  await c.run('kick', R, T, G, c.mensagemOriginal)
  c.op = c.cols.eventos.docs.find(d => d.tipo === 'kick')
  return c
}
const revisar = c => `resolver ${c.op._id} CONFIRMO resultado inconclusivo revisado manualmente`
async function teste(nome, fn) {
  lid.__definirConsultaSessaoTeste(async () => null)
  await fn(); total++; console.log('OK:', nome)
}
async function main() {
  await teste('índices exclusivos por grupo/telefone e histórico sem TTL', async () => {
    const c = await contexto()
    assert.deepEqual(c.cols.patentes.indices[0].chave, { grupo: 1, numero: 1 })
    assert.equal(c.cols.patentes.indices[0].opcoes.unique, true)
    assert.ok(!JSON.stringify(c.cols).includes('expireAfterSeconds'))
  })
  for (const autor of [R, T]) for (const acao of ['arconte', 'removerarconte', 'listaarcontes', 'historicoarconte']) {
    await teste(`${acao}: membro/Arconte sem ADM não administra nem consulta`, async () => {
      const c = await contexto(); await c.nomear()
      const antes = structuredClone(c.cols.patentes.docs)
      await c.run(acao, autor, U)
      assert.match(c.ultima(), /Apenas administradores reais/)
      assert.deepEqual(c.cols.patentes.docs, antes)
    })
  }
  for (const autor of [A, D]) await teste('ADM e dono nomeiam/revogam sem apagar registros', async () => {
    const c = await contexto(); await c.run('arconte', autor, R)
    assert.ok(await c.repo.ativo(G, R))
    await c.run('removerarconte', autor, R)
    assert.equal(await c.repo.ativo(G, R), false)
    assert.equal(c.cols.patentes.docs.length, 1)
    assert.equal(c.cols.eventos.docs.length, 2)
  })
  await teste('Arconte remove membro comum e grava identidade, grupo, data e motivo', async () => {
    const c = await contexto(); await c.nomear(); await c.run('kick')
    assert.equal(c.remocoes.length, 1); assert.match(c.ultima(), /confirmada e registrada/)
    assert.equal(c.confirmadas().length, 1)
    assert.deepEqual({ ...c.confirmadas()[0], _id: undefined, criadoEm: undefined, atualizadoEm: undefined,
      confirmadoEm: undefined, solicitadoEm: undefined }, { _id: undefined, tipo: 'kick', grupo: G,
      responsavel: R, responsavelTipo: 'arconte', alvo: T, motivo: 'motivo opcional', estado: 'confirmada',
      criadoEm: undefined, atualizadoEm: undefined, confirmadoEm: undefined, solicitadoEm: undefined })
    assert.ok(c.confirmadas()[0].confirmadoEm instanceof Date)
  })
  await teste('patente de outro grupo não concede /kick', async () => {
    const c = await contexto(); await c.nomear(R, H); await c.run('kick')
    assert.equal(c.remocoes.length, 0)
  })
  for (const alvo of [A, D, B, R, U]) await teste('Arconte bloqueia ADM, dono, bot, si e outro Arconte', async () => {
    const c = await contexto(); await c.nomear(); await c.nomear(U); await c.run('kick', R, alvo)
    assert.equal(c.remocoes.length, 0)
  })
  await teste('dono sem ADM não ganha /kick mesmo com patente persistida', async () => {
    const c = await contexto(); await c.repo.definir(G, D, true, A, 'fixture')
    await c.run('kick', D); assert.equal(c.remocoes.length, 0)
  })
  for (const dono of [false, true]) await teste('ADM mantém /kick contra Arconte e função correta no histórico', async () => {
    const c = await contexto(); await c.nomear()
    if (dono) c.membros.find(p => p.id === pn(D)).admin = 'admin'
    await c.run('kick', dono ? D : A, R)
    assert.equal(c.remocoes.length, 1)
    assert.equal(c.confirmadas()[0].responsavelTipo, dono ? 'dono' : 'administrador')
  })
  for (const alvo of [A, D, B]) await teste('ADM mantém proteção de administrador, dono e bot', async () => {
    const c = await contexto(); await c.run('kick', A, alvo); assert.equal(c.remocoes.length, 0)
  })
  await teste('alvo ausente ou desconhecido é recusado', async () => {
    const c = await contexto(); await c.nomear()
    await c.run('kick', R, '00010000999'); await c.run('kick', R, '99999@lid')
    assert.equal(c.remocoes.length, 0)
  })
  await teste('autor ausente é recusado mesmo que tenha patente', async () => {
    const c = await contexto(); await c.nomear(); c.membros = c.membros.filter(p => p.id !== pn(R))
    await c.run('kick'); assert.equal(c.remocoes.length, 0)
  })
  await teste('PN/LID comprovados compartilham patente e resposta PN confirma alvo LID', async () => {
    const c = await contexto(); await c.nomear()
    c.membros.find(p => p.id === pn(R)).lid = '90003@lid'
    Object.assign(c.membros.find(p => p.id === pn(T)), { id: '90004@lid', phoneNumber: pn(T) })
    c.removerHook = async () => [{ jid: pn(T), status: 200 }]
    await c.run('kick', '90003@lid', '90004@lid')
    assert.equal(c.confirmadas()[0].responsavel, R); assert.equal(c.confirmadas()[0].alvo, T)
  })
  await teste('dígitos iguais em namespaces diferentes não concedem patente', async () => {
    const c = await contexto(); await c.nomear()
    c.membros.push({ id: `${R}@lid` })
    await c.run('kick', `${R}@lid`); assert.equal(c.remocoes.length, 0)
  })
  await teste('identidade ambígua não autoriza', async () => {
    const c = await contexto(); await c.nomear(); c.membros.push({ id: pn(R), phoneNumber: pn(U) })
    await c.run('kick'); assert.equal(c.remocoes.length, 0)
  })
  await teste('resposta preserva todas as palavras do motivo', async () => {
    const c = await contexto(); await c.nomear()
    await c.run('kick', R, T, G, c.msg(R, T, G, true), '/kick primeira palavra inteira')
    assert.equal(c.confirmadas()[0].motivo, 'primeira palavra inteira')
  })
  await teste('legenda normalizada aceita menção; motivo é opcional e limitado', async () => {
    const c = await contexto(); await c.nomear()
    const msg = c.msg(); msg.message = { imageMessage: { contextInfo: { mentionedJid: [pn(T)] } } }
    await c.run('kick', R, T, G, msg, '/kick @alvo')
    assert.equal(c.confirmadas()[0].motivo, null)
  })
  await teste('bot sem administrador não remove', async () => {
    const c = await contexto(); await c.nomear(); delete c.membros.find(p => p.id === pn(B)).admin
    await c.run('kick'); assert.equal(c.remocoes.length, 0)
  })
  for (const falha of ['socket', 'lease']) await teste('socket/lease indisponível bloqueia remoção', async () => {
    const c = await contexto(); await c.nomear()
    if (falha === 'socket') c.sock.ws.isOpen = false; else c.lease = false
    await c.run('kick'); assert.equal(c.remocoes.length, 0)
  })
  await teste('MongoDB indisponível bloqueia inclusive /kick de ADM', async () => {
    const c = await contexto(); c.cols.eventos.antesAtualizar = async () => { throw Error('SEGREDO_NAO_LOGAR') }
    await c.run('kick', A); assert.equal(c.remocoes.length, 0); assert.doesNotMatch(c.ultima(), /confirmada e registrada|SEGREDO/)
  })
  await teste('escrita sem acknowledged não autoriza remoção', async () => {
    const c = await contexto(); await c.nomear()
    c.cols.eventos.updateOne = async () => ({ acknowledged: false, upsertedCount: 1 })
    await c.run('kick'); assert.equal(c.remocoes.length, 0)
  })
  await teste('patente sem resultado de escrita confirmado não anuncia nomeação', async () => {
    const c = await contexto()
    c.cols.patentes.updateOne = async () => ({ acknowledged: true, matchedCount: 0, upsertedCount: 0 })
    await c.nomear(); assert.doesNotMatch(c.ultima(), /Arconte nomeado/)
    assert.equal(c.cols.controles.docs[0].ocupado, true)
  })
  await teste('logs de falha não expõem detalhes do driver ou identidades', async () => {
    const c = await contexto(), logs = [], warn = console.warn
    c.cols.eventos.antesAtualizar = async () => { throw Error('SEGREDO_DE_TESTE ' + pn(T)) }
    try {
      console.warn = (...args) => logs.push(args)
      await c.run('kick', A)
      assert.doesNotMatch(JSON.stringify(logs), /SEGREDO_DE_TESTE|s\.whatsapp\.net/)
      assert.doesNotMatch(c.ultima(), /SEGREDO_DE_TESTE/)
    } finally { console.warn = warn }
  })
  for (const resposta of [[], [{ jid: pn(T), status: 403 }], [{ jid: pn(T), status: 408 }],
    [{ jid: pn(U), status: 200 }], [{ status: 200 }], [{ jid: pn(T), status: 200 }, { jid: pn(U), status: 200 }]]) {
    await teste('resposta inconclusiva/recusada não confirma nem repete', async () => {
      const c = await contexto(); await c.nomear(); const msg = c.msg()
      c.removerHook = async () => resposta
      await c.run('kick', R, T, G, msg); await c.run('kick', R, T, G, msg)
      assert.equal(c.remocoes.length, 1); assert.equal(c.confirmadas().length, 0)
      assert.doesNotMatch(c.ultima(), /confirmada e registrada/)
    })
  }
  await teste('timeout após envio conserva reserva após reinício e não repete', async () => {
    const c = await contexto(); await c.nomear(); c.removerHook = async () => { throw Error('TIMEOUT') }
    await c.run('kick'); assert.equal(c.cols.controles.docs[0].ocupado, true)
    c.servico = sistema.criarServico(c.repo)
    await c.run('kick', A, U); assert.equal(c.remocoes.length, 1)
    assert.equal(c.cols.eventos.docs.find(p => p.tipo === 'kick').estado, 'incerta')
  })
  await teste('falha de gravação após status 200 não anuncia sucesso nem repete', async () => {
    const c = await contexto(); await c.nomear(); const msg = c.msg()
    c.cols.eventos.antesAtualizar = async (_, a) => { if (a.$set?.estado === 'confirmada') throw Error('TRANSPORTE') }
    await c.run('kick', R, T, G, msg)
    assert.equal(c.remocoes.length, 1); assert.doesNotMatch(c.ultima(), /confirmada e registrada/)
    assert.equal(c.cols.controles.docs[0].ocupado, true)
    c.cols.eventos.antesAtualizar = null
    c.servico = sistema.criarServico(c.repo); await c.run('kick', R, T, G, msg)
    assert.equal(c.remocoes.length, 1)
  })
  await teste('recibo de confirmação gravado mas resposta Mongo perdida preserva histórico', async () => {
    const c = await contexto(); await c.nomear()
    c.cols.eventos.depoisAtualizar = async (_, a) => { if (a.$set?.estado === 'confirmada') throw Error('TRANSPORTE') }
    await c.run('kick'); assert.equal(c.confirmadas().length, 1)
    assert.doesNotMatch(c.ultima(), /confirmada e registrada/); assert.equal(c.cols.controles.docs[0].ocupado, true)
  })
  await teste('duplicatas concorrentes entre serviços geram uma única remoção', async () => {
    const c = await contexto(); await c.nomear(); const msg = c.msg()
    const outro = sistema.criarServico(c.repo)
    await Promise.all([c.run('kick', R, T, G, msg), outro.executar('kick', c.sock, G, msg, '/kick @alvo')])
    assert.equal(c.remocoes.length, 1); assert.equal(c.confirmadas().length, 1)
  })
  await teste('mensagens diferentes concorrentes são serializadas pelo grupo', async () => {
    const c = await contexto(); await c.nomear(); await c.nomear(U)
    let liberar, iniciou
    const inicio = new Promise(r => { iniciou = r }), espera = new Promise(r => { liberar = r })
    c.removerHook = async (_, alvos) => { iniciou(); await espera; return alvos.map(jid => ({ jid, status: 200 })) }
    const primeira = c.run('kick'); await inicio
    await c.run('kick', U, T); assert.equal(c.remocoes.length, 1)
    liberar(); await primeira; assert.equal(c.confirmadas().length, 1)
  })
  await teste('revogação durante remoção em voo é recusada sem apagar histórico', async () => {
    const c = await contexto(); await c.nomear()
    let liberar, iniciou
    const inicio = new Promise(r => { iniciou = r }), espera = new Promise(r => { liberar = r })
    c.removerHook = async (_, alvos) => { iniciou(); await espera; return alvos.map(jid => ({ jid, status: 200 })) }
    const primeira = c.run('kick'); await inicio
    const revogar = c.msg(A, R); await c.run('removerarconte', A, R, G, revogar)
    assert.ok(await c.repo.ativo(G, R)); liberar(); await primeira
    await c.run('removerarconte', A, R, G, revogar); assert.ok(await c.repo.ativo(G, R))
    await c.run('removerarconte', A, R); assert.equal(await c.repo.ativo(G, R), false)
    assert.equal(c.confirmadas().length, 1)
  })
  await teste('revogação confirmada impede próximo kick e replay não renomeia', async () => {
    const c = await contexto(), nomear = c.msg(A, R)
    await c.run('arconte', A, R, G, nomear); await c.run('removerarconte', A, R)
    await c.run('arconte', A, R, G, nomear); await c.run('kick')
    assert.equal(await c.repo.ativo(G, R), false); assert.equal(c.remocoes.length, 0)
  })
  await teste('duas nomeações concorrentes não duplicam patente', async () => {
    const c = await contexto(), msg = c.msg(A, R), outro = sistema.criarServico(c.repo)
    await Promise.all([c.run('arconte', A, R, G, msg), outro.executar('arconte', c.sock, G, msg, '/arconte @alvo')])
    assert.equal(c.cols.patentes.docs.length, 1); assert.ok(await c.repo.ativo(G, R))
  })
  await teste('revogação remove patente de membro que já saiu sem apagar histórico', async () => {
    const c = await contexto(); await c.nomear(); c.membros = c.membros.filter(p => p.id !== pn(R))
    await c.run('removerarconte', A, R); assert.equal(await c.repo.ativo(G, R), false)
  })
  await teste('falha após escrita de patente mantém controle bloqueado e replay não altera', async () => {
    const c = await contexto(), msg = c.msg(A, R)
    c.cols.patentes.depoisAtualizar = async () => { throw Error('TRANSPORTE') }
    await c.run('arconte', A, R, G, msg)
    assert.equal(c.cols.controles.docs[0].ocupado, true); assert.ok(await c.repo.ativo(G, R))
    c.cols.patentes.depoisAtualizar = null
    c.servico = sistema.criarServico(c.repo)
    await c.run('arconte', A, R, G, msg); await c.run('kick')
    assert.equal(c.remocoes.length, 0)
  })
  await teste('perda de lease após admissão Mongo impede chamada WhatsApp', async () => {
    const c = await contexto(); await c.nomear()
    c.cols.eventos.depoisAtualizar = async (_, a) => { if (a.$set?.estado === 'enviando') c.lease = false }
    await c.run('kick'); assert.equal(c.remocoes.length, 0)
  })
  await teste('alvo promovido após admissão Mongo continua protegido', async () => {
    const c = await contexto(); await c.nomear()
    c.cols.eventos.depoisAtualizar = async (_, a) => {
      if (a.$set?.estado === 'enviando') c.membros.find(p => p.id === pn(T)).admin = 'admin'
    }
    await c.run('kick'); assert.equal(c.remocoes.length, 0)
  })
  await teste('confirmação permanente não pode ser sobrescrita nem removida por replay', async () => {
    const c = await contexto(); await c.nomear(); await c.run('kick')
    const doc = structuredClone(c.confirmadas()[0])
    await assert.rejects(c.repo.concluir(doc._id, 'cancelada'))
    await c.run('removerarconte', A, R)
    assert.deepEqual(c.confirmadas()[0], doc)
  })
  await teste('paginação do histórico não vaza outros grupos nem operações sem confirmação', async () => {
    const c = await contexto()
    for (let i = 0; i < 12; i++) c.cols.eventos.docs.push({ _id: `h-${i}`, grupo: G, tipo: 'kick', estado: 'confirmada', confirmadoEm: new Date(i) })
    c.cols.eventos.docs.push({ _id: 'outro', grupo: H, tipo: 'kick', estado: 'confirmada', confirmadoEm: new Date() },
      { _id: 'incerta', grupo: G, tipo: 'kick', estado: 'incerta' })
    assert.equal((await c.repo.historico(G, 1)).length, 10)
    assert.equal((await c.repo.historico(G, 2)).length, 2)
    assert.ok((await c.repo.historico(G, 1)).every(d => d.grupo === G && d.estado === 'confirmada'))
  })
  await teste('falha de envio privado não divulga histórico ao grupo', async () => {
    const c = await contexto(); await c.nomear(); await c.run('kick'); c.respostas.length = 0
    const enviar = c.sock.sendMessage
    c.sock.sendMessage = async (jid, ...args) => {
      if (jid !== G) throw Error('PRIVADO_INDISPONIVEL')
      return enviar(jid, ...args)
    }
    await c.run('historicoarconte', A, null, G, null, '/historicoarconte')
    assert.ok(c.respostas.every(r => !r.text.includes('arconte:')))
  })
  await teste('cooldown impede duas remoções imediatas por mensagens diferentes', async () => {
    const c = await contexto(); await c.nomear(); await c.run('kick')
    const tempo = c.tempo
    await c.servico.executar('kick', c.sock, G, c.msg(R, U), '/kick @alvo')
    assert.equal(c.tempo, tempo); assert.equal(c.remocoes.length, 1)
  })
  for (const mudanca of ['promover', 'sair', 'perderAdmin', 'lease', 'patente']) await teste('revalida mudanças antes do despacho: ' + mudanca, async () => {
    const c = await contexto(); await c.nomear()
    const travar = c.repo.travar
    c.repo.travar = async (...args) => {
      const r = await travar(...args)
      if (mudanca === 'promover') c.membros.find(p => p.id === pn(T)).admin = 'admin'
      if (mudanca === 'sair') c.membros = c.membros.filter(p => p.id !== pn(T))
      if (mudanca === 'perderAdmin') delete c.membros.find(p => p.id === pn(B)).admin
      if (mudanca === 'lease') c.lease = false
      if (mudanca === 'patente') await c.repo.definir(G, R, false, A, 'fixture')
      return r
    }
    await c.run('kick'); assert.equal(c.remocoes.length, 0)
  })
  await teste('histórico persistente é exclusivo de ADM/dono e isolado por grupo', async () => {
    const c = await contexto(); await c.nomear(); await c.run('kick')
    for (const autor of [A, D]) {
      await c.run('historicoarconte', autor, null, G, null, '/historicoarconte')
      const privado = c.respostas.at(-2)
      assert.equal(privado.grupo, pn(autor)); assert.match(privado.text, /arconte:/); assert.match(privado.text, new RegExp(T))
      assert.doesNotMatch(c.ultima(), new RegExp(T))
      await c.run('historicoarconte', autor, null, H, null, '/historicoarconte'); assert.match(c.respostas.at(-2).text, /Nenhuma expulsão/)
    }
    await c.run('historicoarconte', R, null, G, null, '/historicoarconte')
    assert.match(c.ultima(), /Apenas administradores reais/)
    await c.run('removerarconte', A, R)
    assert.equal((await criarRepositorio(async () => c.cols).historico(G, 1)).length, 1)
  })
  await teste('perda de ADM durante leitura impede divulgação do histórico', async () => {
    const c = await contexto(); await c.nomear(); await c.run('kick')
    const ler = c.repo.historico
    c.repo.historico = async (...args) => { const r = await ler(...args); delete c.membros.find(p => p.id === pn(A)).admin; c.membros = c.membros.filter(p => p.id !== pn(A)); return r }
    await c.run('historicoarconte', A, null, G, null, '/historicoarconte')
    assert.doesNotMatch(c.ultima(), /arconte:/)
  })
  await teste('serviço rejeita mensagem sem ID e mensagens próprias', async () => {
    const c = await contexto(); await c.nomear()
    for (const alteracao of [{ id: '' }, { fromMe: true }]) {
      const msg = c.msg(); Object.assign(msg.key, alteracao); await c.run('kick', R, T, G, msg)
    }
    assert.equal(c.remocoes.length, 0)
  })
  await teste('comandos reais são registrados sem aliases administrativos novos', async () => {
    for (const nome of ['kick', 'arconte', 'removerarconte', 'listaarcontes', 'historicoarconte']) {
      const cmd = require(`../comandos/admin/${nome}`)
      assert.equal(cmd.nome, nome); assert.equal(typeof cmd.executar, 'function'); assert.equal(cmd.aliases, undefined)
    }
  })
  await teste('/soadm executa exceção real somente para /kick canônico', async () => {
    const c = await contexto(); await c.nomear(); sistema.__definirServicoTeste(c.servico)
    const fonte = fs.readFileSync(require.resolve('../bot'), 'utf8')
    const inicio = fonte.indexOf("      if (jid.endsWith('@g.us')) {", fonte.indexOf('const comando = comandos.get(nomeComando)'))
    const fim = fonte.indexOf('// 🛡️ ISOLAMENTO DE ERROS', inicio)
    assert.ok(inicio > 0 && fim > inicio)
    const req = createRequire(require.resolve('../bot'))
    async function permitido(nomeComando, comando, sender = pn(R)) {
      const ctx = { sock: c.sock, jid: G, sender, msg: c.msg(), nomeComando, comando,
        require: req, path: require('node:path'), __dirname: require('node:path').dirname(require.resolve('../bot')),
        fs: { existsSync: () => true, readFileSync: () => '{}' }, configAtiva: () => true,
        estadoBot: { remetenteEhDono: async () => false }, ehAdminDoGrupo: () => false,
        AVISAR_BLOQUEIO: false, console }
      return vm.runInNewContext(`(async () => {${fonte.slice(inicio, fim)}; return true})()`, ctx)
    }
    const cmd = require('../comandos/admin/kick')
    assert.equal(await permitido('kick', cmd), true)
    assert.equal(await permitido('alias-kick', cmd), undefined)
    assert.equal(await permitido('kick', { nome: 'kick' }), undefined)
    for (const nome of ['ban', 'promote', 'demote', 'arconte', 'historicoarconte', 'nuke', 'soadm']) {
      assert.equal(await permitido(nome, cmd), undefined)
    }
    assert.equal(await permitido('kick', cmd, pn(U)), undefined)
    c.cols.patentes.findOne = async () => { throw Error('MONGO_OFFLINE') }
    assert.equal(await permitido('kick', cmd), undefined)
    sistema.__definirServicoTeste()
  })
  await teste('pendência vinculada ao controle é consultada no privado sem expor token', async () => {
    const c = await incerta(), token = c.cols.controles.docs[0].token
    await c.consultar('pendentes')
    const privado = c.respostas.at(-2)
    assert.equal(privado.grupo, pn(A)); assert.ok(privado.text.includes(c.op._id))
    assert.match(privado.text, /ausência.*não comprova/)
    assert.ok(!privado.text.includes(token)); assert.ok(!c.ultima().includes(c.op._id))
    assert.equal(c.remocoes.length, 1)
  })
  for (const autor of [A, D]) await teste('ADM/dono revisa explicitamente sem confirmar ou repetir expulsão', async () => {
    const c = await incerta(), antes = structuredClone(c.op)
    await c.consultar(revisar(c), autor)
    assert.equal(c.cols.controles.docs[0].ocupado, false)
    assert.deepEqual(c.op, antes); assert.equal(c.remocoes.length, 1)
    const auditoria = c.cols.eventos.docs.find(d => d.tipo === 'revisao')
    assert.equal(auditoria.estado, 'liberada'); assert.equal(auditoria.responsavel, autor)
    assert.equal(auditoria.responsavelTipo, autor === D ? 'dono' : 'administrador')
    assert.equal(auditoria.estadoOperacao, 'incerta'); assert.ok(auditoria.motivo.length >= 10)
    assert.match(c.respostas.at(-2).text, /Trava liberada/)
  })
  for (const modo of ['pendentes', 'revisoes', 'operacao', 'resolver']) await teste('Arconte não consulta nem resolve pendências: ' + modo, async () => {
    const c = await incerta(), antes = structuredClone({ controles: c.cols.controles.docs, eventos: c.cols.eventos.docs })
    const args = modo === 'resolver' ? revisar(c) : modo === 'operacao' ? `operacao ${c.op._id}` : modo
    await c.consultar(args, R, { privado: true })
    assert.match(c.ultima(), /Apenas administradores reais/)
    assert.deepEqual(c.cols.controles.docs, antes.controles)
    assert.deepEqual(c.cols.eventos.docs, antes.eventos)
  })
  for (const ausente of [true, false]) await teste('presença/ausência do alvo nunca altera o resultado original', async () => {
    const c = await incerta()
    if (ausente) c.membros = c.membros.filter(p => p.id !== pn(T))
    await c.consultar(revisar(c), A, { privado: true })
    assert.equal(c.op.estado, 'incerta'); assert.equal(c.confirmadas().length, 0)
    assert.equal(c.remocoes.length, 1); assert.equal(c.cols.controles.docs[0].ocupado, false)
    if (!ausente) {
      await c.run('kick', R, T, G, c.mensagemOriginal); assert.equal(c.remocoes.length, 1)
      c.removerHook = null; await c.run('kick', R, U); assert.equal(c.remocoes.length, 2)
    }
  })
  await teste('operação ainda em voo não pode ser liberada, inclusive por outro serviço', async () => {
    const c = await contexto(); await c.nomear()
    let iniciar, liberar
    const inicio = new Promise(r => { iniciar = r }), espera = new Promise(r => { liberar = r })
    c.removerHook = async () => { iniciar(); await espera; return [] }
    const removendo = c.run('kick'); await inicio
    c.op = c.cols.eventos.docs.find(d => d.tipo === 'kick')
    const outro = sistema.criarServico(c.repo)
    const msg = c.msg(A, null)
    await outro.executar('historicoarconte', c.sock, G, msg, `/historicoarconte ${revisar(c)}`)
    assert.match(c.ultima(), /ainda em execução/)
    assert.equal(c.cols.controles.docs[0].ocupado, true)
    assert.equal(c.cols.eventos.docs.filter(d => d.tipo === 'revisao').length, 0)
    liberar(); await removendo; await c.consultar(revisar(c))
    assert.equal(c.cols.controles.docs[0].ocupado, false)
  })
  await teste('consulta privada exige grupo explícito e revalida PN/LID do administrador', async () => {
    const c = await incerta()
    c.membros.find(p => p.id === pn(A)).lid = '90002@lid'
    await c.consultar('pendentes', '90002@lid', { privado: true })
    assert.equal(c.respostas.at(-1).grupo, pn(A)); assert.ok(c.ultima().includes(c.op._id))
    const msg = c.msg(A, null, pn(R)); msg.key.participant = pn(A)
    await c.run('historicoarconte', R, null, pn(R), msg, `/historicoarconte grupo ${G} pendentes`)
    assert.match(c.ultima(), /Apenas administradores reais/)
    await c.run('historicoarconte', A, null, pn(A), c.msg(A, null, pn(A)), '/historicoarconte')
    assert.match(c.ultima(), /No privado, use/)
  })
  await teste('dono comprovado consulta/revisa no privado sem estar no grupo, sem ganhar /kick', async () => {
    const c = await incerta(); c.membros = c.membros.filter(p => p.id !== pn(D))
    await c.consultar('pendentes', D, { privado: true }); assert.ok(c.ultima().includes(c.op._id))
    await c.consultar(revisar(c), D, { privado: true }); assert.equal(c.cols.controles.docs[0].ocupado, false)
    await c.run('kick', D, U); assert.equal(c.remocoes.length, 1)
  })
  await teste('paginação privada entrega apenas o grupo autorizado e fornece continuação', async () => {
    const c = await contexto(); await c.run('kick', A)
    await c.consultar('', A)
    assert.ok(c.respostas.at(-2).text.includes(`/historicoarconte grupo ${G} 2`))
    await c.consultar('2', A, { privado: true })
    assert.match(c.ultima(), /Nenhuma expulsão confirmada/); assert.equal(c.respostas.at(-1).grupo, pn(A))
    await c.consultar('', R, { privado: true }); assert.match(c.ultima(), /Apenas administradores reais/)
  })
  await teste('ID de outro grupo não permite liberar nem consultar operação', async () => {
    const c = await incerta(), antes = structuredClone(c.cols.controles.docs)
    await c.consultar(revisar(c), A, { privado: true, grupo: H })
    assert.deepEqual(c.cols.controles.docs, antes)
    await c.consultar(`operacao ${c.op._id}`, A, { privado: true, grupo: H })
    assert.match(c.ultima(), /não encontrada neste grupo/)
  })
  await teste('revisão exige confirmação literal, motivo e ID válidos', async () => {
    const c = await incerta()
    for (const args of [`resolver ${c.op._id} confirmo motivo suficientemente longo`,
      `resolver ${c.op._id} CONFIRMO curto`, 'resolver INVALIDO CONFIRMO motivo suficientemente longo']) {
      await c.consultar(args); assert.equal(c.cols.controles.docs[0].ocupado, true)
    }
    assert.equal(c.cols.eventos.docs.filter(d => d.tipo === 'revisao').length, 0)
  })
  await teste('duas revisões concorrentes liberam uma vez e não apagam recibos', async () => {
    const c = await incerta()
    await Promise.all([c.consultar(revisar(c), A), c.consultar(revisar(c), D)])
    assert.equal(c.cols.controles.docs[0].ocupado, false)
    assert.equal(c.cols.eventos.docs.filter(d => d.tipo === 'revisao' && d.estado === 'liberada').length, 1)
    assert.equal(c.remocoes.length, 1)
  })
  await teste('replay de revisão não libera uma nova trava', async () => {
    const c = await incerta(), msg = c.msg(A, null), id = c.op._id
    await c.consultar(revisar(c), A, { msg })
    const revisao = c.cols.eventos.docs.find(d => d.tipo === 'revisao')
    const novoId = 'f'.repeat(64)
    await c.repo.travar(G, 'novo-token', novoId, 'outra-instancia')
    await c.consultar(revisar(c), A, { msg })
    assert.equal(c.cols.controles.docs[0].token, 'novo-token')
    await assert.rejects(c.repo.liberarRevisada(G, revisao.tokenControle, id, revisao._id))
    assert.equal(c.cols.controles.docs[0].ocupado, true)
  })
  await teste('mudança de token durante revisão impede liberar operação diferente', async () => {
    const c = await incerta(), bloquear = c.repo.bloquearRevisao
    c.repo.bloquearRevisao = async (...args) => {
      c.cols.controles.docs[0].token = 'token-alterado'
      return bloquear(...args)
    }
    await c.consultar(revisar(c)); assert.equal(c.cols.controles.docs[0].ocupado, true)
    assert.equal(c.cols.controles.docs[0].token, 'token-alterado')
  })
  for (const etapa of ['antesAtualizar', 'depoisAtualizar']) await teste('falha na autorização auditada mantém trava e permite nova revisão explícita: ' + etapa, async () => {
    const c = await incerta()
    c.cols.eventos[etapa] = async (_, a) => { if (a.$set?.estado === 'autorizada') throw Error('TRANSPORTE') }
    await c.consultar(revisar(c))
    assert.equal(c.cols.controles.docs[0].ocupado, true)
    const primeira = c.cols.eventos.docs.find(d => d.tipo === 'revisao')
    assert.equal(await c.repo.travaValida(G, c.cols.controles.docs[0].token), false)
    c.cols.eventos[etapa] = null
    await c.consultar(revisar(c), D, { privado: true })
    const segunda = c.cols.eventos.docs.find(d => d.tipo === 'revisao' && d._id !== primeira._id)
    assert.equal(segunda.revisaoAnterior, primeira._id)
    assert.equal(c.cols.controles.docs[0].ocupado, false)
    assert.equal(c.op.estado, 'incerta'); assert.equal(c.remocoes.length, 1)
  })
  for (const etapa of ['antesAtualizar', 'depoisAtualizar']) await teste('falha na liberação não anuncia sucesso nem repete expulsão: ' + etapa, async () => {
    const c = await incerta()
    c.cols.controles[etapa] = async (_, a) => { if (a.$set?.ocupado === false) throw Error('TRANSPORTE') }
    await c.consultar(revisar(c))
    assert.equal(c.cols.controles.docs[0].ocupado, etapa === 'antesAtualizar')
    assert.equal(c.cols.eventos.docs.find(d => d.tipo === 'revisao').estado, 'autorizada')
    assert.ok(!c.ultima().includes('Trava liberada')); assert.equal(c.remocoes.length, 1)
    c.cols.controles[etapa] = null
    await c.consultar('revisoes', A, { privado: true })
    assert.match(c.ultima(), /autorizada/); assert.ok(c.ultima().includes(c.op._id))
  })
  await teste('falha após liberar conserva auditoria prévia, sem inventar confirmação da expulsão', async () => {
    const c = await incerta()
    c.cols.eventos.antesAtualizar = async (_, a) => { if (a.$set?.estado === 'liberada') throw Error('TRANSPORTE') }
    await c.consultar(revisar(c)); assert.equal(c.cols.controles.docs[0].ocupado, false)
    assert.equal(c.op.estado, 'incerta'); assert.equal(c.cols.eventos.docs.find(d => d.tipo === 'revisao').estado, 'autorizada')
    assert.equal(c.remocoes.length, 1)
  })
  await teste('perda de administração antes da liberação conserva trava e auditoria', async () => {
    const c = await incerta(), registrar = c.repo.registrarRevisao
    c.repo.registrarRevisao = async (...args) => {
      await registrar(...args)
      if (args[1] === 'autorizada') c.membros = c.membros.filter(p => p.id !== pn(A))
    }
    await c.consultar(revisar(c))
    assert.equal(c.cols.controles.docs[0].ocupado, true)
    assert.equal(c.cols.eventos.docs.find(d => d.tipo === 'revisao').estado, 'autorizada')
  })
  await teste('lease perdida antes de liberar conserva a trava', async () => {
    const c = await incerta(), registrar = c.repo.registrarRevisao
    c.repo.registrarRevisao = async (...args) => { await registrar(...args); if (args[1] === 'autorizada') c.lease = false }
    await c.consultar(revisar(c)); assert.equal(c.cols.controles.docs[0].ocupado, true)
    assert.equal(c.remocoes.length, 1)
  })
  await teste('controle legado sem vínculo e trava de patente não recebem liberação genérica', async () => {
    const c = await incerta()
    delete c.cols.controles.docs[0].operacao
    await c.consultar(revisar(c)); assert.equal(c.cols.controles.docs[0].ocupado, true)
    assert.match(c.ultima(), /sem vínculo seguro/)
  })
  await teste('expulsão confirmada com falha de soltar trava preserva confirmação após revisão', async () => {
    const c = await contexto(); await c.nomear()
    c.cols.controles.antesAtualizar = async (_, a) => { if (a.$set?.ocupado === false) throw Error('TRANSPORTE') }
    await c.run('kick'); c.op = c.confirmadas()[0]
    const antes = structuredClone(c.op)
    assert.equal(c.cols.controles.docs[0].ocupado, true)
    c.cols.controles.antesAtualizar = null
    await c.consultar(revisar(c)); assert.equal(c.cols.controles.docs[0].ocupado, false)
    assert.deepEqual(c.op, antes); assert.equal(c.remocoes.length, 1)
  })
  await teste('auditoria e estado incerto continuam consultáveis após remover patente e reiniciar serviço', async () => {
    const c = await incerta(); await c.consultar(revisar(c)); await c.run('removerarconte', A, R)
    c.servico = sistema.criarServico(c.repo)
    await c.consultar(`operacao ${c.op._id}`, D, { privado: true })
    assert.match(c.ultima(), /Estado original: incerta/); assert.match(c.ultima(), /liberada/)
    await c.consultar('revisoes', D, { privado: true }); assert.ok(c.ultima().includes(c.op._id))
    assert.equal(c.remocoes.length, 1)
  })
  console.log(`\n${total} cenários de Arcontes passaram (offline).`)
}
const watchdog = setTimeout(() => { throw Error('TESTE_OFFLINE_NAO_CONCLUIDO') }, 20000)
main().catch(erro => { console.error(erro); process.exitCode = 1 }).finally(() => clearTimeout(watchdog))
