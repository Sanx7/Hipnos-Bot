process.env.MONGODB_URI = ''; process.env.MONGO_URI_RPG = ''
const assert = require('assert/strict'), vm = require('vm'), fs = require('fs')
const seguro = require('../dados/socket-seguro'), { criarLease, LEASE_MS } = require('../dados/sessao-exclusiva')
const { criarStorage, match } = require('./helpers/ads-fake')
let n = 0
function eq(a,b) { assert.deepEqual(a,b); n++ }
async function rejeita(p) { await assert.rejects(p); n++ }
function ok(v) { assert.ok(v); n++ }
async function main() {
  const col = criarStorage().ads, update = col.updateOne.bind(col)
  col.updateOne = async (f,u,o) => {
    if (o?.upsert && col.docs.some(d => d._id === f._id) && !col.docs.some(d => match(d,f))) throw Object.assign(new Error('Duplicado'), { code: 11000 })
    return update(f,u,o)
  }
  let agora = 1000, perdida = 0, timers = 0
  const op = { relogio: () => agora, intervalo: () => { timers++; return { unref() {} } }, cancelar() {}, perdida: () => perdida++ }
  const a = criarLease(op), b = criarLease(op)
  const disputa = await Promise.allSettled([a.adquirir(col), b.adquirir(col)])
  eq(disputa.filter(r => r.status === 'fulfilled').length,1); eq(timers,1)
  const titular = a.valida() ? a : b, reserva = a.valida() ? b : a
  await titular.adquirir(col); eq(timers,1); await titular.renovar(); ok(titular.valida())
  let atual = true; const auth = titular.vestir(col, () => atual)
  await auth.updateOne({ _id: 'auth_creds' }, { $set: { creds: { preservada: true } } }, { upsert: true })
  atual = false; await rejeita(auth.updateOne({ _id: 'auth_creds' }, { $set: { creds: 'antigas' } })); atual = true
  agora += LEASE_MS + 1; ok(!titular.valida()); await rejeita(auth.findOne({ _id: 'auth_creds' }))
  await reserva.adquirir(col); ok(reserva.valida()); await titular.renovar(); eq(perdida,1)
  await titular.liberar(); ok(reserva.valida()); await reserva.liberar(); eq(col.docs.find(d => d._id === 'auth_creds').creds.preservada,true)
  const c = criarLease(op); await c.adquirir(col); const updateValido = col.updateOne
  col.updateOne = async () => { throw new Error('Mongo indisponível') }; await c.renovar(); ok(!c.valida()); eq(perdida,2)
  col.updateOne = updateValido
  let leaseAindaValida = true
  const expiravel = { ws: { isOpen: true }, sendMessage: async () => {}, groupMetadata: async () => ({ participants: [] }) }
  seguro.preparar(expiravel, () => leaseAindaValida); seguro.atualizar(expiravel,true); ok(seguro.disponivel(expiravel))
  leaseAindaValida = false; ok(!seguro.disponivel(expiravel)); await rejeita(expiravel.sendMessage('grupo',{}))
  let consultas = 0, envios = 0, resolver
  const sock = { ws: { isOpen: true }, async sendMessage() { envios++ }, groupMetadata: () => { consultas++; return new Promise(r => { resolver = r }) } }
  seguro.preparar(sock); await rejeita(sock.sendMessage('grupo',{})); eq(envios,0)
  seguro.atualizar(sock,true)
  const p1 = sock.groupMetadata('grupo'), p2 = sock.groupMetadata('grupo'); await Promise.resolve(); eq(consultas,1); eq(p1,p2)
  resolver({ participants: [] }); await Promise.all([p1,p2]); await sock.sendMessage('grupo',{}); eq(envios,1)
  const p3 = sock.groupMetadata('grupo'); await Promise.resolve(); eq(consultas,2); seguro.atualizar(sock,false); resolver({ participants: [] }); await rejeita(p3)
  await rejeita(sock.sendMessage('grupo',{})); eq(envios,1)
  seguro.atualizar(sock,true); const p4 = sock.groupMetadata('grupo'); await Promise.resolve(); resolver({ participants: [] }); await p4; eq(consultas,3)
  const init = seguro.criarInicializador(); let montagens = 0, completar
  const inicializar = () => { montagens++; return new Promise(r => { completar = r }) }
  const boot1 = init.iniciar(inicializar), boot2 = init.iniciar(inicializar); eq(boot1,boot2); await Promise.resolve(); eq(montagens,1); completar(); await boot1
  init.bloquear(); await init.iniciar(inicializar); eq(montagens,1)
  // Execute the production builder and reconnect listener, with offline dependencies.
  const fonte = fs.readFileSync(require.resolve('../bot'),'utf8').replace(/\r\n/g,'\n')
  const trecho = fonte.slice(fonte.indexOf('function startBot()'),fonte.indexOf('async function encerrarBot()'))
  let criados = 0, salvos = 0, fimAntigo, agendamentos = [], logs = [], sockets = []
  const ctx = { console: { log() {}, warn: (...v) => logs.push(v), info: (...v) => logs.push(v), error() {} }, sockAtual: null, reconexaoAgendada: false, tentativas: 0, timerReconexao: null, geracaoConexao: 0, idProcessoConexao: 'processo-offline',
    inicializadorSocket: seguro.criarInicializador(), socketSeguro: seguro, leaseSessao: { async adquirir() {}, vestir: c => c, valida: () => true },
    obterColecaoAuth: async () => ({ findOne: async () => ({ creds: { existe: true } }) }), useMongoDBAuthState: async () => ({ state: {}, saveCreds: async () => { salvos++ } }),
    makeWASocket: () => {
      criados++; const listeners = new Map(), s = { ws: { isOpen: true }, groupMetadata: async () => ({ participants: [] }), sendMessage: async () => ({}), ev: { on(e,f) { if (listeners.has(e)) throw new Error('Listener duplicado'); listeners.set(e,f) } }, listeners,
        async end() { if (fimAntigo) await fimAntigo; listeners.clear(); this.ws.isOpen = false } }; sockets.push(s); return s
    }, P: () => ({}), require: nome => nome === './dados/protecao-bot' ? { protegerRemocoes() {} } : require('node:module').createRequire(require.resolve('../bot'))(nome),
    mensagensEnviadas: { acompanharSocket() {} }, registrarSocketBoasVindas() {}, prefixoComandos: { obterPrefixo: async () => '/' }, iniciarAgendadorLembretes: async () => ({}),
    agendadorAnuncios: { fechar() {}, abrir: async () => ({}) },
    agendadorAniversarios: { fechar() {}, abrir: async () => ({}) },
    DisconnectReason: require('@whiskeysockets/baileys').DisconnectReason, linkDoQrCode: '', qrcode: { generate() {} },
    rodadasVouc: { obter() { return {} }, fechar() {} },
    clearTimeout: timer => { if (timer) timer.cancelado = true }, setTimeout: (fn,ms) => { const timer = { fn, ms }; agendamentos.push(timer); return timer }
  }
  vm.runInNewContext(trecho,ctx)
  await Promise.all([ctx.startBot(),ctx.startBot()]); eq(criados,1); eq(sockets[0].listeners.size,4)
  const primeiro = sockets[0], abrir = primeiro.listeners.get('connection.update')
  abrir({ connection: 'open' }); ok(seguro.disponivel(primeiro))
  primeiro.listeners.get('creds.update')(); await Promise.resolve(); eq(salvos,1)
  let liberarFim; fimAntigo = new Promise(r => { liberarFim = r })
  const reiniciar = ctx.startBot(); await Promise.resolve(); await Promise.resolve(); eq(criados,1); ok(!seguro.disponivel(primeiro))
  abrir({ connection: 'open' }); ok(!seguro.disponivel(primeiro)); eq(criados,1)
  liberarFim(); await reiniciar; fimAntigo = null; eq(criados,2); eq(primeiro.listeners.size,0); eq(sockets[1].listeners.size,4)
  const segundo = sockets[1], eventos = segundo.listeners.get('connection.update')
  eventos({ connection: 'open' }); eventos({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 }, message: 'segredo-auth' } } })
  eventos({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 } } } }); eq(agendamentos.length,1)
  eventos({ connection: 'open' }); ok(agendamentos[0].cancelado)
  eventos({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 440 }, message: 'segredo-auth' } } })
  ok(ctx.inicializadorSocket.bloqueado()); await ctx.startBot(); eq(criados,2); eq(agendamentos.length,1); ok(!seguro.disponivel(segundo))
  ok(!JSON.stringify(logs).includes('segredo-auth')); ok(logs.some(l => l[1]?.evento === 'conflito_440'))
  // Failed old-socket shutdown cannot free its reference for a later retry.
  ctx.inicializadorSocket = seguro.criarInicializador(); ctx.reconexaoAgendada = false
  const endOriginal = segundo.end
  segundo.end = async () => { throw new Error('Falha ao fechar') }
  await rejeita(ctx.startBot()); eq(criados,2); eq(ctx.sockAtual,segundo)
  await rejeita(ctx.startBot()); eq(criados,2)
  segundo.end = endOriginal; await ctx.startBot(); eq(criados,3)
  const terceiro = sockets[2]; terceiro.listeners.get('connection.update')({ connection: 'open' })
  const antes = agendamentos.length
  ctx.tratarFalhaInicializacao({ sessaoOcupada: true }); eq(agendamentos.length,antes+1); eq(agendamentos.at(-1).ms,30000)
  ctx.tratarFalhaInicializacao({ sessaoOcupada: true }); eq(agendamentos.length,antes+1)
  // Execute one scheduled recovery: exactly one new socket, old socket ended.
  agendamentos.at(-1).fn(); await ctx.startBot(); eq(criados,4); eq(terceiro.listeners.size,0)
  ctx.leaseSessao.valida = () => false; ctx.reconexaoAgendada = false
  await rejeita(ctx.startBot()); eq(criados,4)
  console.log(`OK: ${n} verificações offline de conexão, sessão e conflito 440.`)
}
main().catch(e => { console.error(e); process.exitCode = 1 })
