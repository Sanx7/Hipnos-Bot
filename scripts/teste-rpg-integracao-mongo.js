// Integração REAL, somente com RPG_TEST_MONGO_URI validada. Sem bot/Baileys,
// sem migrações, sem drop/delete/limpeza, sem dados WhatsApp reais.
require('../config')
const assert = require('node:assert/strict')
const { randomUUID, randomBytes, createHash } = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { MongoClient, ObjectId } = require('mongodb')
const { validarIsolamento, nomesExecucao } = require('./helpers/rpg-mongo-isolamento')
let cliente
let sessionHook = null
let updateHook = null
let retornarCreditoAusente = false
let aprovado = 0, reprovado = 0
const resultados = []
const controles = {}
const uriTeste = process.env.RPG_TEST_MONGO_URI
// Apenas para comparação DNS e filho de replay. Nunca fornecidas a MongoClient.
const producao = { MONGODB_URI: process.env.MONGODB_URI, MONGO_URI_RPG: process.env.MONGO_URI_RPG }
const replay = process.argv[2] === '--replay'
let run, nomes, banco, jogadores, operacoes, prova, db, eco, lid

function escopo(f = {}) { return { $and: [f, { rpgTestRun: run }] } }
function colecaoRestrita(raw, jogador) {
  return {
    find: (f, o) => raw.find(escopo(f), o),
    findOne: (f, o) => raw.findOne(escopo(f), o),
    countDocuments: (f = {}) => raw.countDocuments(escopo(f)),
    insertOne: (doc, o) => raw.insertOne({ ...doc, rpgTestRun: run }, o),
    async updateOne(f, u, o) {
      const update = u.$setOnInsert ? { ...u, $setOnInsert: { ...u.$setOnInsert, rpgTestRun: run } } : u
      // Ausência simulada por filtro real que não encontra documento, dentro
      // da transação real. Não apaga nem oculta registros reais.
      const filtro = jogador && retornarCreditoAusente && o?.session &&
        u.$set?.carteira !== undefined && u.$set?.banco === undefined
        ? { ...f, _id: new ObjectId() } : f
      const r = await raw.updateOne(escopo(filtro), update, o)
      if (jogador) await updateHook?.({ f, u: update, o, r })
      return r
    }
  }
}
function contextoReal() {
  return { jogadores: colecaoRestrita(jogadores, true),
    operacoes: colecaoRestrita(operacoes, false),
    cliente: {
      startSession() {
        const s = cliente.startSession()
        sessionHook?.(s)
        return s
      }
    } }
}
async function conectar() {
  cliente = new MongoClient(uriTeste, { serverSelectionTimeoutMS: 10000, socketTimeoutMS: 20000 })
  await cliente.connect()
  banco = cliente.db(nomes.banco)
  const h = await banco.command({ hello: 1 })
  if (!h.setName || !h.isWritablePrimary || !Number.isFinite(h.logicalSessionTimeoutMinutes)) throw new Error('RPG_TEST_SERVIDOR_INCOMPATIVEL')
  jogadores = banco.collection(nomes.jogadores)
  operacoes = banco.collection(nomes.operacoes)
  prova = banco.collection(nomes.prova)
  if (db) db.__definirContextoTeste(contextoReal())
}
function carregarModulos() {
  // Qualquer acesso inadvertido a providers reais falha sem URI. Overrides
  // são exclusivos deste processo, nunca alteram .env ou configuração Render.
  process.env.MONGODB_URI = ''
  process.env.MONGO_URI_RPG = ''
  db = require('../rpg/database')
  eco = require('../rpg/economia')
  lid = require('../lid')
  lid.__definirConsultaSessaoTeste(async () => null)
  require('../prefixo').__definirPrefixoTeste('/')
  db.__definirContextoTeste(contextoReal())
}
const A = '00000000000001@s.whatsapp.net'
const B = '00000000000002@s.whatsapp.net'
const C = '00000000000003@s.whatsapp.net'
function contexto(id = randomUUID(), participantes = []) {
  return { chat: '00000000000000@g.us', mensagem: run + ':' + id, participantes }
}
async function seed(jid, carteira = 100, bancoSaldo = 0) {
  await jogadores.insertOne({ ...db.criarJogadorPadrao(jid), carteira, banco: bancoSaldo,
    legado: { preservado: ['conteudo-ficticio'] }, rpgTestRun: run })
}
async function total() {
  const docs = await jogadores.find({ rpgTestRun: run }).toArray()
  return docs.reduce((s, p) => {
    assert.ok(p.carteira >= 0 && p.banco >= 0)
    return s + eco.centavos(p.carteira, true) + eco.centavos(p.banco, true)
  }, 0)
}
async function saldos() {
  return jogadores.find({ rpgTestRun: run }, { projection: { jid: 1, carteira: 1, banco: 1 } }).sort({ jid: 1 }).toArray()
}
async function mesmoDinheiro(antes) { assert.equal(await total(), antes) }
async function teste(nome, fn) {
  try {
    await fn()
    aprovado++
    resultados.push({ teste: nome, resultado: 'aprovado' })
    console.log('OK ' + nome)
  } catch (err) {
    reprovado++
    resultados.push({ teste: nome, resultado: 'reprovado', tipo: err.name === 'AssertionError' ? 'invariante' : 'execucao' })
    console.error('FALHOU ' + nome)
    throw new Error('RPG_TEST_CENARIO_REPROVADO')
  } finally { updateHook = null; sessionHook = null; retornarCreditoAusente = false }
}
async function executarReplay(payload) {
  const child = await promisify(execFile)(process.execPath,
    [__filename, '--replay', JSON.stringify(payload)], {
      env: { ...process.env, ...producao, RPG_TEST_MONGO_URI: uriTeste },
      timeout: 30000, maxBuffer: 10000
    })
  const resposta = JSON.parse(child.stdout.trim())
  assert.equal(resposta.ok, true); assert.equal(resposta.repetida, true)
}
async function main() {
  const isolamento = await validarIsolamento(process.env)
  if (replay) {
    const payload = JSON.parse(process.argv[3])
    run = payload.run
    nomes = nomesExecucao(isolamento.banco, run)
    // Replay só de atores sintéticos e namespaces derivados do run.
    assert.equal(payload.a, A); assert.equal(payload.b, B)
    assert.equal(payload.valor, 10)
    assert.equal(payload.ctx.mensagem, run + ':REPLAY')
    assert.equal(payload.ctx.chat, '00000000000000@g.us')
    assert.deepEqual(payload.ctx.participantes, [])
    await conectar()
    const id = createHash('sha256').update(JSON.stringify([payload.ctx.chat, A, payload.ctx.mensagem])).digest('hex')
    const registro = await operacoes.findOne({ _id: id, rpgTestRun: run })
    // Filho de replay só consulta uma operação que já foi concluída.
    // Nunca pode abrir uma movimentação nova por payload de linha de comando.
    assert.equal(registro?.estado, 'concluida')
    carregarModulos()
    const r = await eco.transferirEntreJogadores(A, B, payload.valor, payload.ctx)
    console.log(JSON.stringify({ ok: r.ok, repetida: r.repetida === true }))
    return
  }
  run = randomBytes(16).toString('hex')
  nomes = nomesExecucao(isolamento.banco, run)
  controles.isolamentoConfiguradoEDns = true
  await conectar()
  controles.conexaoESessoes = true
  // Só coleções novas. NamespaceExists ABORTA, nunca reutiliza uma coleção.
  for (const nome of [nomes.jogadores, nomes.operacoes, nomes.prova]) await banco.createCollection(nome)
  await jogadores.createIndex({ jid: 1 }, { unique: true, name: 'idx_rpg_jid' })
  carregarModulos()
  await teste('commit real com snapshot e majority', async () => {
    await db.executarTransacaoNoContexto(contextoReal(), async (_, session) => {
      await prova.insertOne({ _id: run, rpgTestRun: run, valor: 1 }, { session })
    })
    assert.equal((await prova.findOne({ _id: run, rpgTestRun: run }, { readConcern: { level: 'majority' } })).valor, 1)
    controles.transacaoReal = true
  })
  await teste('interrupção antes do commit aborta escrita real', async () => {
    await assert.rejects(db.executarTransacaoNoContexto(contextoReal(), async (_, session) => {
      await prova.updateOne({ _id: run, rpgTestRun: run }, { $set: { valor: 2 } }, { session })
      throw Object.assign(new Error('interrupcao_controlada'), { codigo: 'interrupcao_controlada' })
    }))
    assert.equal((await prova.findOne({ _id: run, rpgTestRun: run })).valor, 1)
  })
  await teste('personagem fictício e documentos antigos preservados', async () => {
    const p = await db.getPlayer(C)
    assert.equal(p.carteira, 0); assert.equal(p.banco, 0)
    await seed(A, 100, 10)
    await seed(B, 20)
    const antigo = await db.getPlayer(A)
    await db.savePlayer(A, { nome: 'Ficticio Alfa', genero: 'M' })
    const atual = await db.getPlayer(A)
    assert.equal(atual.carteira, antigo.carteira)
    assert.equal(atual.banco, antigo.banco)
    assert.deepEqual(atual.legado, antigo.legado)
    assert.deepEqual(atual.inventario, antigo.inventario)
    assert.equal(atual.nome, 'Ficticio Alfa')
  })
  await teste('depósito, saque e saldos reais conservados', async () => {
    const antes = await total()
    assert.equal((await eco.moverSaldo(A, 30, 'depositar', contexto())).ok, true)
    assert.equal((await db.getPlayer(A)).banco, 40)
    assert.equal((await eco.moverSaldo(A, 10, 'sacar', contexto())).ok, true)
    assert.equal((await db.getPlayer(A)).carteira, 80)
    await mesmoDinheiro(antes)
  })
  let repeticao
  await teste('transferência real e auditoria atômica', async () => {
    const antes = await total()
    repeticao = contexto('REPLAY')
    const r = await eco.transferirEntreJogadores(A, B, 10, repeticao)
    assert.equal(r.ok, true)
    const logs = await operacoes.find({ rpgTestRun: run, tipo: 'transferir', estado: 'concluida' }).toArray()
    assert.equal(logs.length, 1)
    assert.equal(logs[0].resultado.valor, 10)
    assert.equal(logs[0].antes.carteira - logs[0].depois.carteira, 10)
    assert.equal(logs[0].depois.destinatario - logs[0].antes.destinatario, 10)
    await mesmoDinheiro(antes)
  })
  await teste('mensagem repetida e pedido conflitante', async () => {
    const antes = await saldos()
    const r = await eco.transferirEntreJogadores(A, B, 10, repeticao)
    assert.equal(r.repetida, true); assert.equal(r.ok, true)
    assert.equal((await eco.transferirEntreJogadores(A, B, 11, repeticao)).motivo, 'operacao_conflitante')
    assert.deepEqual(await saldos(), antes)
  })
  await teste('reprocessamento em novo processo Node', async () => {
    const antes = await saldos()
    await executarReplay({ run, a: A, b: B, valor: 10, ctx: repeticao })
    assert.deepEqual(await saldos(), antes)
  })
  await teste('saldo insuficiente e transferência para si', async () => {
    const antes = await saldos()
    assert.equal((await eco.transferirEntreJogadores(A, B, 99999, contexto())).motivo, 'saldo_insuficiente')
    assert.equal((await eco.transferirEntreJogadores(A, A, 1, contexto())).motivo, 'mesmo_jogador')
    assert.deepEqual(await saldos(), antes)
  })
  await teste('destinatário novo e ausência na escrita do crédito', async () => {
    const antes = await total()
    const novo = '00000000000004@s.whatsapp.net'
    assert.equal((await eco.transferirEntreJogadores(A, novo, 1, contexto())).ok, true)
    assert.equal((await db.getPlayer(novo)).carteira, 1)
    const saldosAntes = await saldos()
    retornarCreditoAusente = true
    assert.equal((await eco.transferirEntreJogadores(A, B, 1, contexto())).motivo, 'jogador_ausente')
    assert.deepEqual(await saldos(), saldosAntes)
    await mesmoDinheiro(antes)
  })
  await teste('falha após crédito real não aplica transferência parcial', async () => {
    const antes = await saldos()
    updateHook = ({ o, u }) => {
      if (o?.session && u.$set?.carteira !== undefined && u.$set?.banco === undefined) throw new Error('falha_controlada_apos_credito')
    }
    const ctx = contexto('FALHA-CREDITO')
    assert.equal((await eco.transferirEntreJogadores(A, B, 1, ctx)).ok, false)
    updateHook = null
    assert.equal((await eco.transferirEntreJogadores(A, B, 1, ctx)).motivo, 'resultado_pendente')
    assert.deepEqual(await saldos(), antes)
  })
  await teste('commit concluído com resposta perdida recupera resultado', async () => {
    const antes = await total()
    sessionHook = s => {
      const commit = s.commitTransaction.bind(s)
      s.commitTransaction = async () => {
        await commit()
        throw Object.assign(new Error('resposta_controlada_perdida'), {
          hasErrorLabel: label => label === 'UnknownTransactionCommitResult'
        })
      }
    }
    const ctx = contexto('COMMIT-RESPOSTA')
    assert.equal((await eco.transferirEntreJogadores(A, B, 1, ctx)).ok, true)
    sessionHook = null
    const atual = await saldos()
    assert.equal((await eco.transferirEntreJogadores(A, B, 1, ctx)).repetida, true)
    assert.deepEqual(await saldos(), atual)
    await mesmoDinheiro(antes)
  })
  await teste('commit sem comprovação conserva reserva pendente', async () => {
    const antes = await saldos()
    sessionHook = s => {
      s.commitTransaction = async () => {
        throw Object.assign(new Error('commit_controlado_indeterminado'), {
          hasErrorLabel: label => label === 'UnknownTransactionCommitResult'
        })
      }
    }
    const ctx = contexto('COMMIT-PENDENTE')
    assert.equal((await eco.transferirEntreJogadores(A, B, 1, ctx)).motivo, 'resultado_pendente')
    sessionHook = null
    assert.equal((await eco.transferirEntreJogadores(A, B, 1, ctx)).motivo, 'resultado_pendente')
    assert.deepEqual(await saldos(), antes)
  })
  await teste('operações simultâneas conservam total e evitam negativos', async () => {
    const antes = await total()
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      i % 2 ? eco.transferirEntreJogadores(A, B, 0.01, contexto())
        : eco.moverSaldo(A, 0.01, 'depositar', contexto())))
    assert.ok(rs.some(r => r.ok))
    assert.ok(rs.every(r => r.ok || ['concorrencia_recusada', 'resultado_pendente'].includes(r.motivo)))
    await mesmoDinheiro(antes)
  })
  await teste('reconexão do cliente e replay de operação concluída', async () => {
    const antes = await saldos()
    db.__definirContextoTeste(null)
    await cliente.close()
    await conectar()
    assert.equal((await eco.transferirEntreJogadores(A, B, 10, repeticao)).repetida, true)
    assert.deepEqual(await saldos(), antes)
  })
  await teste('falha de confirmação WhatsApp só no stub, sem novo débito', async () => {
    const antes = await total()
    let mensagens = 0
    const sock = { groupMetadata: async () => ({ participants: [] }),
      sendMessage: async () => { mensagens++; throw new Error('envio_ficticio_bloqueado') } }
    const msg = { key: { participant: A, remoteJid: '00000000000000@g.us', id: run + ':CONFIRMACAO' } }
    const cmd = require('../comandos/rpg/transferir')
    await cmd.executar(sock, msg.key.remoteJid, msg, '/transferir ' + B.split('@')[0] + ' 0.01')
    assert.equal(mensagens, 2)
    const depois = await saldos()
    await cmd.executar(sock, msg.key.remoteJid, msg, '/transferir ' + B.split('@')[0] + ' 0.01')
    assert.equal(mensagens, 3)
    assert.deepEqual(await saldos(), depois)
    await mesmoDinheiro(antes)
  })
  await teste('legados PN/JID/LID, conflitos e nenhuma mesclagem', async () => {
    const jid = '00000000000005'
    await seed(jid, 1.23)
    const p = await db.getPlayer(jid + '@s.whatsapp.net')
    assert.equal(p.jid, jid); assert.equal(p.carteira, 1.23)
    lid.__definirConsultaSessaoTeste(async n => n === '00000000000099' ? jid : null)
    assert.equal((await db.getPlayer('00000000000099@lid')).jid, jid)
    await seed('00000000000099@lid', 2.34)
    const antes = await jogadores.find({ rpgTestRun: run }).sort({ jid: 1 }).toArray()
    await assert.rejects(db.getPlayer('00000000000099@lid'), { codigo: 'cadastros_ambiguos' })
    const diag = await db.corrigirJogadoresComLid()
    assert.equal(diag.somenteDiagnostico, true); assert.equal(diag.mesclados, 0)
    assert.deepEqual(await jogadores.find({ rpgTestRun: run }).sort({ jid: 1 }).toArray(), antes)
  })
  await teste('auditoria persistente, IDs únicos e reservas preservadas', async () => {
    const logs = await operacoes.find({ rpgTestRun: run }).toArray()
    assert.equal(new Set(logs.map(l => l._id)).size, logs.length)
    assert.ok(logs.some(l => l.estado === 'pendente'))
    assert.ok(logs.some(l => l.estado === 'recusada'))
    assert.ok(logs.some(l => l.estado === 'concluida'))
    for (const l of logs.filter(l => l.estado === 'concluida')) {
      assert.equal(l.resultado.ok, true)
      assert.ok(l.depois.carteira >= 0 && l.depois.banco >= 0 && l.depois.destinatario >= 0)
      const antes = eco.centavos(l.antes.carteira, true) + eco.centavos(l.antes.banco, true)
      const depois = eco.centavos(l.depois.carteira, true) + eco.centavos(l.depois.banco, true)
      if (l.tipo === 'transferir') assert.equal(antes + eco.centavos(l.antes.destinatario, true), depois + eco.centavos(l.depois.destinatario, true))
      else assert.equal(antes, depois)
    }
    const indice = await jogadores.indexes()
    assert.ok(indice.some(i => i.name === 'idx_rpg_jid' && i.unique))
    controles.estados = {
      concluidas: logs.filter(l => l.estado === 'concluida').length,
      recusadas: logs.filter(l => l.estado === 'recusada').length,
      pendentes: logs.filter(l => l.estado === 'pendente').length
    }
  })
}
main().catch(err => {
  const codigos = ['RPG_TEST_MONGO_URI_AUSENTE', 'RPG_TEST_ISOLAMENTO_NAO_COMPROVADO',
    'RPG_TEST_SERVIDOR_INCOMPATIVEL', 'RPG_TEST_CENARIO_REPROVADO']
  if (!replay) console.error('RPG_TEST: execução interrompida; ' +
    (codigos.includes(err.message) ? err.message : 'FALHA_SANITIZADA') + '; dados da execução preservados.')
  process.exitCode = 1
}).finally(async () => {
  db?.__definirContextoTeste(null)
  await cliente?.close().catch(() => {})
  if (!replay) console.log(JSON.stringify({ execucao: run || null, bancoTeste: nomes?.banco,
    colecoesTeste: nomes ? [nomes.jogadores, nomes.operacoes, nomes.prova] : [],
    controles, aprovados: aprovado, reprovados: reprovado, resultados,
    limpezaExecutada: false, whatsappReal: false,
    limitacoes: ['Falhas injetadas no cliente, sem failover/partição de infraestrutura', 'Coleções e reservas pendentes preservadas'] }))
})
