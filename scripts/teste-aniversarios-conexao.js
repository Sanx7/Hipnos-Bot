// Listener real em VM, sem iniciar bot, abrir banco ou criar socket WhatsApp.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const fonte = fs.readFileSync(require.resolve('../bot'), 'utf8').replace(/\r\n/g, '\n')
const inicio = fonte.indexOf("sock.ev.on('connection.update'"), fim = fonte.indexOf('\n  })\n}', inicio) + '\n  })'.length
assert.ok(inicio >= 0 && fim > inicio)
let listener, abrir = 0, fechar = 0, lease = true, bloqueado = false
const sock = { end: async () => {}, ev: { on(evento, fn) { assert.equal(evento, 'connection.update'); listener = fn } } }
const ctx = { sock, sockAtual: sock, console: { log() {}, warn() {}, error() {}, info() {} },
  qrcode: { generate() {} }, linkDoQrCode: '', tentativas: 0, reconexaoAgendada: false, idProcessoConexao: 'offline', geracao: 1,
  socketSeguro: { atualizar() {} }, inicializadorSocket: { bloqueado: () => bloqueado, bloquear() { bloqueado = true } },
  leaseSessao: { valida: () => lease }, timerReconexao: null, clearTimeout() {}, setTimeout() {},
  agendadorAnuncios: { abrir: async () => {}, fechar() {} }, rodadasVouc: { fechar() {} },
  agendadorAniversarios: { abrir(s) { assert.equal(s, sock); abrir++; return Promise.resolve() }, fechar(s) { assert.equal(s, sock); fechar++ } },
  iniciarAgendadorLembretes: async () => {}, tratarFalhaInicializacao() {}, startBot: async () => {}, DisconnectReason: { loggedOut: 401, badSession: 500 }
}
vm.runInNewContext(fonte.slice(inicio, fim), ctx)
listener({ connection: 'connecting' }); assert.equal(abrir, 0)
listener({ connection: 'open' }); assert.equal(abrir, 1)
ctx.sockAtual = {}
listener({ connection: 'open' }); listener({ connection: 'close' }); assert.equal(abrir, 1); assert.equal(fechar, 0)
ctx.sockAtual = sock
listener({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 } } } }); assert.equal(fechar, 1)
listener({ connection: 'open' }); assert.equal(abrir, 2)
lease = false
listener({ connection: 'open' }); assert.equal(abrir, 2)
lease = true
listener({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 440 } } } }); assert.equal(fechar, 2); assert.equal(bloqueado, true)
listener({ connection: 'open' }); assert.equal(abrir, 2)
for (const trecho of [
  fonte.slice(fonte.indexOf('const leaseSessao ='), fonte.indexOf('function startBot()')),
  fonte.slice(fonte.indexOf('async function montarBot()'), fonte.indexOf('await leaseSessao.adquirir')),
  fonte.slice(fonte.indexOf('async function encerrarBot()'))
]) assert.ok(trecho.includes('agendadorAniversarios.fechar(antigo)'))
console.log('Lifecycle dos aniversarios: abertura, fechamento, reconexao, socket antigo, lease, conflito 440 e encerramento aprovados (offline).')
