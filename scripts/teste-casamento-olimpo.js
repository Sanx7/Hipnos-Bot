// Sem credenciais, WhatsApp, MongoDB real ou rede.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
require('node:net').Socket.prototype.connect = function () { throw new Error('Rede proibida') }
const assert = require('node:assert/strict')
const criarColecao = require('./helpers/colecao-casamento-fake')
const { criarRepositorio, preparar } = require('../dados/casamento-olimpo-mongo')
const sistema = require('../dados/casamento-olimpo')
const lid = require('../lid')
const prefixo = require('../prefixo')
const { criarResolvedor } = require('../dados/casamento-identidade')
const fs = require('node:fs'), vm = require('node:vm')
const A = '5511999990000', B = '5511888880000', C = '5511777770000'
const G = '123@g.us', H = '456@g.us', pn = n => n + '@s.whatsapp.net'
let sequencia = 0, total = 0
async function contexto() {
  const col = criarColecao()
  await preparar(col)
  const repo = criarRepositorio(async () => col)
  const servico = sistema.criarServico(repo)
  const c = { col, repo, servico, participantes: [A, B, C].map(n => ({ id: pn(n) })), envios: [] }
  c.sock = {
    groupMetadata: async () => {
      if (c.falharMeta) throw new Error('offline')
      return { participants: c.participantes }
    },
    sendMessage: async (jid, resposta) => { if (c.falharEnvio) throw new Error('offline'); c.envios.push({ jid, ...resposta }) }
  }
  c.msg = (autor, alvo, grupo = G, id = 'msg-' + ++sequencia) => ({
    key: { id, remoteJid: grupo, participant: grupo.endsWith('@g.us') ? autor : undefined },
    message: { extendedTextMessage: { contextInfo: { mentionedJid: alvo ? [alvo] : [] } } }
  })
  c.executar = (acao, autor = A, alvo, grupo = G, msg) => servico.executar(acao, c.sock, grupo, msg || c.msg(pn(autor), alvo && pn(alvo), grupo))
  c.unioes = () => col.docs.filter(d => d.tipo === 'uniao')
  c.ativo = () => c.unioes().find(d => d.estado === 'ativo')
  c.casar = async () => { await c.executar('casar', A, B); await c.executar('aceitar', B) }
  return c
}
async function teste(nome, fn) { await fn(); console.log('OK:', nome); total++ }
const recusa = (promessa, codigo) => assert.rejects(promessa, e => e.codigo === codigo)
function conexaoIsolada({ semUri = false, falharIndice = false } = {}) {
  const col = criarColecao(), clientes = []
  col.falharIndice = falharIndice
  class MongoClient {
    constructor(uri, opcoes) {
      assert.equal(uri, 'mongodb://offline.invalid/test')
      this.opcoes = opcoes; clientes.push(this); this.fechado = false
    }
    async connect() { await new Promise(resolve => setImmediate(resolve)) }
    async close() { this.fechado = true }
    db(nome) { assert.equal(nome, 'casamento_teste'); return { collection(nome, opts) {
      assert.equal(nome, 'casamentosOlimpo'); assert.equal(opts.writeConcern.w, 'majority')
      assert.equal(opts.readPreference, 'primary'); return col
    } } }
  }
  const modulo = { exports: {} }
  vm.runInNewContext(fs.readFileSync(require.resolve('../dados/casamento-olimpo-mongo'), 'utf8'), {
    module: modulo, exports: modulo.exports, process: { env: {
      MONGODB_URI: semUri ? '' : 'mongodb://offline.invalid/test', MONGODB_DB: 'casamento_teste'
    } }, require(nome) {
      if (nome === 'mongodb') return { MongoClient }
      if (nome === '../config') return {}
      throw new Error('Importação inesperada')
    }
  })
  return { repo: modulo.exports.criarRepositorio(), col, clientes }
}
async function main() {
  lid.__definirConsultaSessaoTeste(async id => ({ '111': A, '222': B })[id] || null)
  prefixo.__definirPrefixoTeste('!')
  await teste('índice único global parcial sem grupo na chave', async () => {
    const c = await contexto(), idx = c.col.indices[0]
    assert.deepEqual(idx.key, { participantes: 1 }); assert.equal(idx.unique, true)
    assert.deepEqual(idx.partialFilterExpression, { bloqueiaParticipantes: true })
  })
  await teste('pedido de cinco minutos e prefixo dinâmico', async () => {
    const c = await contexto(), r = await c.executar('casar', A, B), d = c.unioes()[0]
    assert.equal(+d.expiraEm - d.criadoEm, 300000); assert.match(r.text, /!aceitar/)
    assert.deepEqual(r.mentions, [pn(A), pn(B)]); assert.equal(d.casadoEm, null)
  })
  await teste('aceitação registra hora do banco e casamento global', async () => {
    const c = await contexto(); await c.executar('casar', A, B)
    c.col.agora = new Date(+c.col.agora + 1000); await c.executar('aceitar', B)
    assert.equal(+c.ativo().casadoEm, +c.col.agora)
    assert.match((await c.executar('casamento', A, null, H)).text, /0 dias completos/)
  })
  await teste('somente destinatário pode aceitar ou recusar', async () => {
    const c = await contexto(); await c.executar('casar', A, B)
    for (const acao of ['aceitar', 'recusar']) for (const autor of [A, C]) await recusa(c.executar(acao, autor), 'semPedido')
    assert.equal(c.unioes()[0].estado, 'pendente')
  })
  await teste('aceitar e recusar exigem grupo de origem', async () => {
    const c = await contexto(); await c.executar('casar', A, B)
    for (const acao of ['aceitar', 'recusar']) await recusa(c.executar(acao, B, null, H), 'semPedido')
  })
  await teste('casar, aceitar e recusar bloqueados no privado', async () => {
    const c = await contexto()
    for (const acao of ['casar', 'aceitar', 'recusar']) await recusa(c.executar(acao, A, B, pn(A)), 'grupo')
  })
  await teste('auto casamento bloqueado também com LID', async () => {
    const c = await contexto(); c.participantes[0] = { id: '111@lid', phoneNumber: pn(A) }
    await recusa(c.executar('casar', A, null, G, c.msg(pn(A), '111@lid')), 'proprio')
  })
  await teste('menção obrigatória e única', async () => {
    const c = await contexto(); await recusa(c.executar('casar'), 'mencao')
    const m = c.msg(pn(A), pn(B)); m.message.extendedTextMessage.contextInfo.mentionedJid.push(pn(C))
    await recusa(c.executar('casar', A, null, G, m), 'mencao')
  })
  await teste('alvo fora do grupo e falha de metadados recusados', async () => {
    const c = await contexto(); await recusa(c.executar('casar', A, '5511666660000'), 'membro')
    c.falharMeta = true; await recusa(c.executar('casar', A, B), 'metadados')
    assert.equal(c.unioes().length, 0)
  })
  await teste('LID desconhecido e metadados ambíguos não autorizam', async () => {
    const c = await contexto(); await recusa(c.executar('casar', A, null, G, c.msg('999@lid', pn(B))), 'identidade')
    c.participantes.push({ id: pn(A) }); await recusa(c.executar('casar', A, B), 'identidade')
  })
  await teste('metadados LID + PN e PN + LID separado', async () => {
    const c = await contexto(); c.participantes = [{ id: '111@lid', phoneNumber: pn(A) }, { id: pn(B), lid: '222@lid' }]
    const r = await c.executar('casar', A, null, G, c.msg('111@lid', '222@lid'))
    assert.deepEqual(r.mentions, ['111@lid', pn(B)])
    await c.executar('aceitar', B, null, G, c.msg('222@lid'))
    assert.deepEqual(c.ativo().participantes, [A, B])
  })
  await teste('mapeamento de sessão comprova presença em metadados só LID', async () => {
    const c = await contexto(); c.participantes = [{ id: '111@lid' }, { id: '222@lid' }]
    await c.executar('casar', A, null, G, c.msg(pn(A), '222@lid'))
    await c.executar('aceitar', B)
    assert.deepEqual((await c.executar('casamento')).mentions, ['222@lid'])
  })
  await teste('mesmos dígitos PN/LID não provam a mesma pessoa', async () => {
    const c = await contexto(); c.participantes.push({ id: A + '@lid' })
    await recusa(c.executar('casar', A, null, G, c.msg(A + '@lid', pn(B))), 'identidade')
  })
  await teste('remetente ou solicitante que saiu do grupo não conclui rito', async () => {
    const c = await contexto(); await c.executar('casar', A, B)
    c.participantes = c.participantes.filter(p => p.id !== pn(A))
    await recusa(c.executar('aceitar', B), 'membro')
    c.participantes = []; await recusa(c.executar('aceitar', B), 'membro')
  })
  await teste('duplicatas e pedidos inversos/entre grupos concorrentes têm um vencedor', async () => {
    const c = await contexto()
    const r = await Promise.allSettled([c.executar('casar', A, B), c.executar('casar', B, A, H), c.executar('casar', C, B, H)])
    assert.equal(r.filter(x => x.status === 'fulfilled').length, 1)
    assert.equal(c.unioes().filter(d => d.bloqueiaParticipantes).length, 1)
  })
  await teste('pedido repetido não renova prazo', async () => {
    const c = await contexto(), m = c.msg(pn(A), pn(B))
    await c.executar('casar', A, null, G, m); const inicio = +c.unioes()[0].expiraEm
    c.col.agora = new Date(+c.col.agora + 1000); await c.executar('casar', A, null, G, m)
    assert.equal(c.unioes().length, 1); assert.equal(+c.unioes()[0].expiraEm, inicio)
  })
  await teste('limite exato de cinco minutos expira sem timer', async () => {
    const c = await contexto(); await c.executar('casar', A, B)
    c.col.agora = new Date(c.unioes()[0].expiraEm)
    await recusa(c.executar('aceitar', B), 'semPedido')
    assert.equal(c.unioes()[0].estado, 'expirado'); assert.equal(c.unioes()[0].bloqueiaParticipantes, false)
    await c.executar('casar', C, B, H); assert.equal(c.unioes().length, 2)
  })
  await teste('aceite imediatamente antes do limite é válido', async () => {
    const c = await contexto(); await c.executar('casar', A, B)
    c.col.agora = new Date(+c.unioes()[0].expiraEm - 1); await c.executar('aceitar', B)
    assert.ok(c.ativo())
  })
  await teste('aceite contra recusa simultâneos têm uma única transição', async () => {
    const c = await contexto(); await c.executar('casar', A, B)
    const r = await Promise.allSettled([c.executar('aceitar', B), c.executar('recusar', B)])
    assert.equal(r.filter(x => x.status === 'fulfilled').length, 1)
    assert.ok(['ativo', 'recusado'].includes(c.unioes()[0].estado))
  })
  await teste('recusa preserva histórico e libera novo pedido', async () => {
    const c = await contexto(); await c.executar('casar', A, B); await c.executar('recusar', B)
    assert.equal(c.unioes()[0].estado, 'recusado'); await c.executar('casar', C, B)
    assert.equal(c.unioes().length, 2)
  })
  await teste('casamento ativo impede qualquer novo pedido global', async () => {
    const c = await contexto(); await c.casar()
    await recusa(c.executar('casar', C, B, H), 'ocupado'); await recusa(c.executar('casar', A, C, H), 'ocupado')
  })
  await teste('contador calcula períodos de 24 horas e formato brasileiro', async () => {
    const c = await contexto(); await c.casar(); const inicio = +c.ativo().casadoEm
    c.col.agora = new Date(inicio + 86400000 - 1)
    assert.match((await c.executar('casamento')).text, /0 dias completos/)
    c.col.agora = new Date(inicio + 86400000)
    assert.match((await c.executar('casamento')).text, /1 dia completo/)
    c.col.agora = new Date(inicio + 12 * 86400000)
    assert.match((await c.executar('casamento')).text, /12 dias completos/)
    assert.equal(sistema.formatarData(new Date('2026-10-22T01:00:00Z')), '21/10/2026')
  })
  await teste('novo serviço após reinicialização conserva contador', async () => {
    const c = await contexto(); await c.casar(); c.col.agora = new Date(+c.col.agora + 3 * 86400000)
    const reiniciado = sistema.criarServico(criarRepositorio(async () => c.col))
    const r = await reiniciado.executar('casamento', c.sock, H, c.msg(pn(B), null, H))
    assert.match(r.text, /3 dias completos/)
  })
  await teste('divórcio unilateral no privado preserva data e encerra contador', async () => {
    const c = await contexto(); await c.casar(); const inicio = +c.ativo().casadoEm
    c.col.agora = new Date(inicio + 4 * 86400000); await c.executar('divorciar', B, null, pn(B))
    const d = c.unioes()[0]; assert.equal(d.estado, 'divorciado'); assert.equal(d.encerradoPor, B)
    assert.equal(+d.casadoEm, inicio); assert.equal(sistema.diasCompletos(d.casadoEm, d.encerradoEm), 4)
    assert.match((await c.executar('casamento')).text, /Nenhum laço/)
  })
  await teste('terceiro não divorcia; dois cônjuges simultâneos encerram uma vez', async () => {
    const c = await contexto(); await c.casar(); await recusa(c.executar('divorciar', C), 'semUniao')
    const r = await Promise.allSettled([c.executar('divorciar', A), c.executar('divorciar', B)])
    assert.equal(r.filter(x => x.status === 'fulfilled').length, 1); assert.equal(c.unioes()[0].estado, 'divorciado')
  })
  await teste('replay de aceite não modifica casadoEm', async () => {
    const c = await contexto(); await c.executar('casar', A, B); const m = c.msg(pn(B))
    await c.executar('aceitar', B, null, G, m); const inicio = +c.ativo().casadoEm
    c.col.agora = new Date(+c.col.agora + 10000); await c.executar('aceitar', B, null, G, m)
    assert.equal(+c.ativo().casadoEm, inicio)
  })
  await teste('replay de divórcio não atinge casamento posterior', async () => {
    const c = await contexto(); await c.casar(); const m = c.msg(pn(A))
    await c.executar('divorciar', A, null, G, m)
    await c.executar('casar', A, C); await c.executar('aceitar', C)
    await c.executar('divorciar', A, null, G, m)
    assert.deepEqual(c.ativo().participantes, [A, C]); assert.equal(c.unioes().length, 2)
  })
  await teste('replay de recusa/aceite não decide pedido posterior', async () => {
    const c = await contexto(); await c.executar('casar', A, B); const m = c.msg(pn(B))
    await c.executar('recusar', B, null, G, m); await c.executar('casar', C, B)
    await c.executar('recusar', B, null, G, m); assert.equal(c.unioes()[1].estado, 'pendente')
  })
  await teste('decisão sem pedido não pode aceitar ou recusar um pedido futuro', async () => {
    for (const acao of ['aceitar', 'recusar']) {
      const c = await contexto(), m = c.msg(pn(B))
      await recusa(c.executar(acao, B, null, G, m), 'semPedido')
      await c.executar('casar', A, B)
      await recusa(c.executar(acao, B, null, G, m), 'semPedido')
      assert.equal(c.unioes()[0].estado, 'pendente')
    }
  })
  await teste('mensagem de divórcio anterior à união não encerra casamento futuro', async () => {
    const c = await contexto(), m = c.msg(pn(A))
    await recusa(c.executar('divorciar', A, null, G, m), 'semUniao')
    await c.casar(); await recusa(c.executar('divorciar', A, null, G, m), 'semUniao')
    assert.ok(c.ativo())
  })
  await teste('expiração é revalidada atomicamente após a leitura do pedido', async () => {
    const c = await contexto(); await c.executar('casar', A, B)
    const original = c.repo.transicionar
    c.repo.transicionar = async (...args) => {
      c.col.agora = new Date(c.unioes()[0].expiraEm)
      return original(...args)
    }
    await recusa(c.executar('aceitar', B), 'mudou'); assert.equal(c.ativo(), undefined)
  })
  await teste('replay após aceite e divórcio não aceita novo pedido', async () => {
    const c = await contexto(); await c.executar('casar', A, B); const m = c.msg(pn(B))
    await c.executar('aceitar', B, null, G, m); await c.executar('divorciar', A)
    await c.executar('casar', C, B)
    await recusa(c.executar('aceitar', B, null, G, m), 'mudou')
    assert.equal(c.unioes()[1].estado, 'pendente')
  })
  await teste('pedido antigo reprocessado após divórcio não recria reserva', async () => {
    const c = await contexto(), m = c.msg(pn(A), pn(B))
    await c.executar('casar', A, null, G, m); await c.executar('aceitar', B); await c.executar('divorciar', B)
    await c.executar('casar', A, null, G, m)
    assert.equal(c.unioes().length, 1); assert.equal(c.unioes()[0].bloqueiaParticipantes, false)
  })
  await teste('múltiplos aceites simultâneos não substituem casadoEm', async () => {
    const c = await contexto(); await c.executar('casar', A, B)
    const r = await Promise.allSettled(Array.from({ length: 20 }, () => c.executar('aceitar', B)))
    assert.equal(r.filter(x => x.status === 'fulfilled').length, 1)
    assert.equal(+c.ativo().casadoEm, +c.col.agora)
  })
  await teste('casais independentes podem reservar participantes simultaneamente', async () => {
    const c = await contexto(), D = '5511666660000'; c.participantes.push({ id: pn(D) })
    await Promise.all([c.executar('casar', A, B), c.executar('casar', C, D, H)])
    assert.equal(c.unioes().filter(d => d.bloqueiaParticipantes).length, 2)
  })
  await teste('mensagem sem id e autor não comprovado não alteram banco', async () => {
    const c = await contexto(), m = c.msg(pn(A), pn(B)); delete m.key.id
    await recusa(c.executar('casar', A, null, G, m), 'mensagem')
    await recusa(c.executar('divorciar', A, null, '999@lid'), 'identidade')
    assert.equal(c.col.docs.length, 0)
  })
  await teste('falha na sessão não vaza identidades ou erro em logs', async () => {
    const c = await contexto(), logs = [], logOriginal = console.log, errorOriginal = console.error
    lid.__definirConsultaSessaoTeste(async () => { throw new Error('segredo-de-teste') })
    console.log = (...args) => logs.push(args.join(' ')); console.error = console.log
    try { await recusa(c.executar('casar', A, null, G, c.msg('999@lid', pn(B))), 'identidade') }
    finally {
      console.log = logOriginal; console.error = errorOriginal
      lid.__definirConsultaSessaoTeste(async id => ({ '111': A, '222': B })[id] || null)
    }
    assert.deepEqual(logs, [])
  })
  await teste('falha de banco e escrita não confirmada não anunciam sucesso', async () => {
    const c = await contexto(); sistema.__definirRepositorioTeste(c.repo)
    const cmd = require('../comandos/menu-brincadeiras/casar')
    c.col.falhar = true; await cmd.executar(c.sock, G, c.msg(pn(A), pn(B)))
    assert.match(c.envios[0].text, /indisponíveis/); assert.equal(c.unioes().length, 0)
    c.col.falhar = false; c.col.semConfirmacao = true
    await cmd.executar(c.sock, G, c.msg(pn(A), pn(B))); assert.match(c.envios[1].text, /não pôde ser confirmado/)
  })
  await teste('escrita com resposta perdida é reconciliada pelo mesmo pedido', async () => {
    const c = await contexto(), m = c.msg(pn(A), pn(B)); c.col.falharAposEscrever = true
    await assert.rejects(c.executar('casar', A, null, G, m)); c.col.falharAposEscrever = false
    await c.executar('casar', A, null, G, m); assert.equal(c.unioes().length, 1)
  })
  await teste('falha ao enviar confirmação não desfaz casamento', async () => {
    const c = await contexto(); await c.executar('casar', A, B); sistema.__definirRepositorioTeste(c.repo)
    c.falharEnvio = true
    const m = c.msg(pn(B)), logs = [], original = console.error
    console.error = (...args) => logs.push(args.join(' '))
    try {
      await assert.doesNotReject(require('../comandos/menu-brincadeiras/aceitar').executar(c.sock, G, m))
    } finally { console.error = original }
    assert.ok(c.ativo())
    assert.deepEqual(logs, ['[casamento-olimpo] confirmacao_nao_entregue'])
    const casadoEm = +c.ativo().casadoEm
    c.falharEnvio = false
    await require('../comandos/menu-brincadeiras/aceitar').executar(c.sock, G, m)
    assert.equal(+c.ativo().casadoEm, casadoEm)
    assert.match(c.envios[0].text, /já registrou/)
  })
  await teste('índice indisponível recusa preparação', async () => {
    const col = criarColecao(); col.falharIndice = true; await assert.rejects(preparar(col))
  })
  await teste('inicialização Mongo concorrente usa um cliente e prepara índices uma vez', async () => {
    const c = conexaoIsolada()
    await Promise.all(Array.from({ length: 10 }, () => c.repo.consultar(A)))
    assert.equal(c.clientes.length, 1); assert.equal(c.col.indices.length, 2)
  })
  await teste('falha de índice fecha cliente, bloqueia escrita e permite recuperação', async () => {
    const c = conexaoIsolada({ falharIndice: true })
    await assert.rejects(c.repo.pedir({ _id: 'x' })); assert.equal(c.col.docs.length, 0)
    assert.equal(c.clientes[0].fechado, true)
    c.col.falharIndice = false; await c.repo.consultar(A)
    assert.equal(c.clientes.length, 2); assert.equal(c.col.indices.length, 2)
  })
  await teste('importação sem URI não conecta e primeira operação recusa', async () => {
    const c = conexaoIsolada({ semUri: true }); assert.equal(c.clientes.length, 0)
    await assert.rejects(c.repo.consultar(A)); assert.equal(c.clientes.length, 0)
  })
  await teste('pool pequeno e prazos explícitos apenas no provider de casamento', async () => {
    const c = conexaoIsolada(); await c.repo.consultar(A)
    const o = c.clientes[0].opcoes
    assert.equal(o.maxPoolSize, 4); assert.equal(o.minPoolSize, 0); assert.equal(o.maxConnecting, 1)
    assert.equal(o.waitQueueTimeoutMS, 5000); assert.equal(o.socketTimeoutMS, 20000)
    assert.equal(o.timeoutMS, 30000); assert.equal(o.connectTimeoutMS, 10000)
    assert.equal(o.serverSelectionTimeoutMS, 10000); assert.equal(o.maxIdleTimeMS, 60000)
    // Construtor real valida opções sem conectar ou utilizar credenciais.
    const { MongoClient } = require('mongodb')
    const cliente = new MongoClient('mongodb://offline.invalid/test', o)
    const col = cliente.db('test').collection('test', { writeConcern: { w: 'majority', wtimeoutMS: 15000 } })
    assert.equal(col.collectionName, 'test'); await cliente.close()
  })
  await teste('menções normalizadas em texto, temporárias e legendas de mídia', async () => {
    const conteudos = [
      { extendedTextMessage: { contextInfo: { mentionedJid: [pn(B)] } } },
      { imageMessage: { caption: '!casar', contextInfo: { mentionedJid: [pn(B)] } } },
      { videoMessage: { caption: '!casar', contextInfo: { mentionedJid: [pn(B)] } } },
      { documentMessage: { caption: '!casar', contextInfo: { mentionedJid: [pn(B)] } } }
    ]
    for (const conteudo of conteudos) for (const temporaria of [false, true]) {
      const c = await contexto(), m = c.msg(pn(A))
      m.message = temporaria ? { ephemeralMessage: { message: conteudo } } : conteudo
      const r = await c.executar('casar', A, null, G, m)
      assert.deepEqual(r.mentions, [pn(A), pn(B)])
      assert.equal(c.unioes().length, 1)
    }
  })
  await teste('legenda temporária continua exigindo exatamente uma menção', async () => {
    for (const mencoes of [[], [pn(B), pn(C)]]) {
      const c = await contexto(), m = c.msg(pn(A))
      m.message = { ephemeralMessage: { message: { imageMessage: {
        caption: '!casar', contextInfo: { mentionedJid: mencoes }
      } } } }
      await recusa(c.executar('casar', A, null, G, m), 'mencao')
      assert.equal(c.unioes().length, 0)
    }
  })
  await teste('consulta PN/LID: 102 membros, antes 200 consultas, agora zero', async () => {
    let consultas = 0, metadados = 0
    lid.__definirConsultaSessaoTeste(async () => { consultas++; return null })
    const c = await contexto()
    c.participantes = [{ id: pn(A) }, { id: pn(B) }, ...Array.from({ length: 100 }, (_,i) => ({ id: `000${1000+i}@lid` }))]
    c.sock.groupMetadata = async () => { metadados++; return { participants: c.participantes } }
    await c.executar('casar', A, B)
    assert.equal(consultas, 0); assert.equal(metadados, 1)
    console.log('MEDICAO_PN_LID: 102 membros; consultas de sessão antes=200 depois=0; metadados=1 (sintético offline)')
  })
  await teste('apenas LIDs necessários são consultados e resultados reutilizados no aceite', async () => {
    const contagem = new Map()
    lid.__definirConsultaSessaoTeste(async id => {
      contagem.set(id, (contagem.get(id) || 0) + 1)
      return ({ '111': A, '222': B })[id] || null
    })
    const c = await contexto()
    c.participantes = [{ id: '111@lid' }, { id: '222@lid' }, ...Array.from({ length: 100 }, (_, i) => ({ id: `000${i}@lid` }))]
    await c.executar('casar', A, null, G, c.msg('111@lid', '222@lid'))
    assert.deepEqual([...contagem.keys()].sort(), ['111','222'])
    assert.equal([...contagem.values()].reduce((a,b)=>a+b,0), 2)
    // Helper global pode ter cache; a instância do resolvedor também evita consultar
    // novamente os mesmos participantes quando o aceite verifica os cônjuges.
    await c.executar('aceitar', B, null, G, c.msg('222@lid'))
    assert.equal([...contagem.values()].reduce((a,b)=>a+b,0), 2)
    assert.ok(c.ativo())
  })
  await teste('fallback PN em grupo só LID consulta cada desconhecido uma vez, com concorrência dois', async () => {
    let consultas = 0, simultaneas = 0, pico = 0
    lid.__definirConsultaSessaoTeste(async id => {
      consultas++; simultaneas++; pico = Math.max(pico, simultaneas)
      await new Promise(resolve => setImmediate(resolve))
      simultaneas--
      return id === '901' ? A : null
    })
    const ps = Array.from({ length: 12 }, (_, i) => ({ id: `${900+i}@lid` }))
    const r = criarResolvedor(ps)
    const [a,b] = await Promise.all([r.buscar(pn(A)), r.buscar(pn(B))])
    assert.equal(a.numero, A); assert.equal(a.participante.id, '901@lid')
    assert.equal(b.participante, null); assert.equal(consultas, 12); assert.ok(pico <= 2)
    await r.buscar(pn(B)); await r.buscar('900@lid'); assert.equal(consultas, 12)
  })
  await teste('limite de consultas vale também entre execuções simultâneas', async () => {
    let simultaneas = 0, pico = 0
    lid.__definirConsultaSessaoTeste(async () => {
      simultaneas++; pico=Math.max(pico,simultaneas)
      await new Promise(resolve => setImmediate(resolve)); simultaneas--; return null
    })
    await Promise.all(Array.from({ length: 10 }, (_,i) => criarResolvedor([]).buscar(`${5000+i}@lid`)))
    assert.ok(pico <= 2); assert.equal(simultaneas, 0)
  })
  await teste('falha de resolução não persiste entre comandos', async () => {
    let chamadas = 0
    lid.__definirConsultaSessaoTeste(async () => { chamadas++; return null })
    const r = criarResolvedor([])
    await r.buscar('12345@lid'); await r.buscar('12345@lid'); assert.equal(chamadas,1)
    await criarResolvedor([]).buscar('12345@lid'); assert.equal(chamadas,2)
  })
  await teste('fallback detecta dois LIDs associados ao mesmo PN e recusa', async () => {
    lid.__definirConsultaSessaoTeste(async () => A)
    const r = criarResolvedor([{id:'123@lid'}, {id:'456@lid'}])
    assert.equal((await r.buscar(pn(A))).numero, null)
  })
  await teste('alvo LID associado a outro membro PN não ignora ambiguidade', async () => {
    lid.__definirConsultaSessaoTeste(async () => A)
    const c = await contexto(); c.participantes.push({id:'999@lid'})
    await recusa(c.executar('casar', A, null, G, c.msg(pn(A),'999@lid')), 'identidade')
    assert.equal(c.unioes().length,0)
  })
  await teste('JIDs salvos são pistas, nunca autorização para trocar cônjuge', async () => {
    lid.__definirConsultaSessaoTeste(async () => null)
    const c = await contexto(); await c.executar('casar',A,B)
    c.unioes()[0].jidsParticipantes = [pn(C),pn(B)]
    await c.executar('aceitar',B)
    assert.deepEqual(c.ativo().participantes,[A,B])
    assert.deepEqual(c.ativo().mencoesAceite,[pn(A),pn(B)])
  })
  await teste('pista antiga não dispensa presença atual nem quebra pedidos sem pistas', async () => {
    const c = await contexto(); await c.executar('casar',A,B)
    delete c.unioes()[0].jidsParticipantes
    await c.executar('aceitar',B); assert.ok(c.ativo())
    const d = await contexto(); await d.executar('casar',A,B)
    d.participantes = d.participantes.filter(p=>p.id!==pn(A))
    await recusa(d.executar('aceitar',B),'membro')
  })
  await teste('ambiguidade descoberta no fallback invalida resultados já calculados', async () => {
    lid.__definirConsultaSessaoTeste(async id => id==='888' ? A : id==='999' ? B : null)
    const c = await contexto(); await c.executar('casar',A,B)
    delete c.unioes()[0].jidsParticipantes
    c.participantes = [{id:pn(A)},{id:'888@lid'},{id:'999@lid'}]
    // A tem prova PN direta. Um fallback posterior detecta outra associação
    // ao mesmo número e invalida também o resultado calculado anteriormente.
    const r = criarResolvedor(c.participantes)
    const a = await r.buscar(pn(A)); assert.equal(a.numero,A)
    await r.buscar(pn(C)) // força varredura dos LIDs sem associação direta
    assert.equal(r.conferir(a).numero,null)
    assert.equal((await r.buscar(pn(A))).numero,null)
  })
  await teste('falha de confirmação de recusa ou divórcio preserva decisão sem rejeitar comando', async () => {
    for(const acao of ['recusar','divorciar']) {
      const c=await contexto(); await c.executar('casar',A,B)
      if(acao==='divorciar') await c.executar('aceitar',B)
      sistema.__definirRepositorioTeste(c.repo); c.falharEnvio=true
      await assert.doesNotReject(require('../comandos/menu-brincadeiras/'+acao).executar(c.sock,G,c.msg(pn(B))))
      assert.equal(c.unioes()[0].estado,acao==='recusar'?'recusado':'divorciado')
    }
  })
  await teste('erro no envio não causa segunda mensagem genérica nem retry automático', async () => {
    const c = await contexto(); sistema.__definirRepositorioTeste(c.repo)
    let tentativas = 0
    c.sock.sendMessage = async () => { tentativas++; throw new Error('segredo de transporte') }
    await assert.doesNotReject(require('../comandos/menu-brincadeiras/casar').executar(c.sock,G,c.msg(pn(A),pn(B))))
    assert.equal(tentativas,1); assert.equal(c.unioes().length,1)
  })
  await teste('cinco comandos reais possuem registro correto', async () => {
    for (const nome of ['casar', 'aceitar', 'recusar', 'casamento', 'divorciar']) {
      const cmd = require('../comandos/menu-brincadeiras/' + nome)
      assert.equal(cmd.nome, nome); assert.equal(typeof cmd.executar, 'function')
    }
  })
  await teste('contador rejeita data inválida ou futura', async () => {
    assert.throws(() => sistema.diasCompletos(new Date('invalid'), new Date()))
    assert.throws(() => sistema.diasCompletos(new Date(100), new Date(0)))
  })
  console.log(`\n${total} cenários de casamento passaram (offline).`)
}
main().catch(err => { console.error(err); process.exitCode = 1 })
