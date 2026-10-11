process.env.MONGODB_URI = ''
const assert = require('assert/strict'), fs = require('fs'), vm = require('vm')
const fonte = fs.readFileSync(require.resolve('../bot'), 'utf8').replace(/\r\n/g, '\n'), inicio = fonte.indexOf("sock.ev.on('connection.update'")
const fim = fonte.indexOf('\n  })\n}', inicio) + '\n  })'.length
assert.ok(inicio >= 0 && fim > inicio)
let listener, aberturas = 0, fechamentos = 0, n = 0
const sock = { ev: { on(evento, fn) { assert.equal(evento,'connection.update'); listener = fn } } }
const contexto = { sock, sockAtual: sock, console: { log() {}, error() {}, info() {}, warn() {} }, qrcode: { generate() {} }, linkDoQrCode: '', tentativas: 0, reconexaoAgendada: false, idProcessoConexao: 'offline', geracao: 1,
  socketSeguro: { atualizar() {} }, inicializadorSocket: { bloqueado: () => false, bloquear() {} }, leaseSessao: { valida: () => true }, clearTimeout() {}, timerReconexao: null,
  agendadorAnuncios: { abrir(s) { assert.equal(s,sock); aberturas++; return Promise.resolve() }, fechar(s) { assert.equal(s,sock); fechamentos++ } },
  iniciarAgendadorLembretes: () => Promise.resolve(), DisconnectReason: { loggedOut: 401, badSession: 500 }, setTimeout() {}, startBot: () => Promise.resolve() }
contexto.tratarFalhaInicializacao = () => {}
vm.runInNewContext(fonte.slice(inicio,fim), contexto)
listener({ connection: 'connecting' }); assert.equal(aberturas,0); n++
listener({ connection: 'open' }); assert.equal(aberturas,1); n++
listener({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 } } } }); assert.equal(fechamentos,1); n++
listener({ connection: 'open' }); assert.equal(aberturas,2); n++
contexto.sockAtual = {}
listener({ connection: 'open' }); listener({ connection: 'close' }); assert.equal(aberturas,2); assert.equal(fechamentos,1); n += 2
contexto.sockAtual = sock
listener({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } }); assert.equal(contexto.sockAtual,null); assert.equal(fechamentos,2); n += 2
assert.ok(fonte.includes('agendadorAnuncios.fechar(antigo)')); n++
console.log(`OK: ${n} verificações do lifecycle Baileys em VM.`)
