// Somente fixtures, listener real em VM e transporte/download simulados.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
process.env.OWNER_NUMBERS = '00010000001'
require('./helpers/menu-catalogo-teste')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { createRequire } = require('node:module')
const { Readable } = require('node:stream')
const prefixo = require('../prefixo'), config = require('../config')
require('../lid').__definirConsultaSessaoTeste(async () => null)
prefixo.__definirPrefixoTeste('/')
const LINK = 'https://vm.tiktok.com/fixture-publica/'
const GRUPO = '100000000000@g.us', PN = '00010000002@s.whatsapp.net', LID = '900002@lid'
let sequencia = 0, passaram = 0, falharam = 0
async function teste(nome, fn) {
  try { await fn(); passaram++; console.log('OK: ' + nome) }
  catch (e) { falharam++; console.error('FALHOU: ' + nome + ' (' + e.name + ')') }
}
function handlers() {
  const arquivos = new Map(), chamadas = [], op = { falhaEnvio: false, falhaDownload: false, falhaFonte: false }
  const req = createRequire(require.resolve('../comandos/menu-download/tiktok'))
  let video
  function carregar(nome) {
    const arquivo = require.resolve('../comandos/menu-download/' + nome), m = { exports: {} }
    vm.runInNewContext(fs.readFileSync(arquivo, 'utf8'), {
      module: m, exports: m.exports, Buffer, setTimeout, clearTimeout, console: { log() {}, error() {}, warn() {} },
      require(n) {
        if (n === './tiktok') return video
        if (n === 'fs') return { writeFileSync: (p, b) => arquivos.set(p, b), existsSync: p => arquivos.has(p), readFileSync: p => arquivos.get(p), statSync: p => ({ size: arquivos.get(p)?.length || 0 }) }
        if (n === 'child_process') return { execFile: (_a, _b, _c, cb) => cb(Error('thumb ficticia')) }
        if (n === '../menu-utilitario/audio-extrator') return { caminhoFfmpeg: () => 'ffmpeg-ficticio', apagarComRetry: async p => arquivos.delete(p), converterParaMp3: async (_a, b) => arquivos.set(b, Buffer.from('audio-ficticio')) }
        if (n === 'axios') return { get: async () => { chamadas.push('download'); if (op.falhaDownload) throw Error('download ficticio'); return { headers: {}, data: Readable.from([Buffer.from('midia-ficticia')]) } } }
        if (n === '@tobyg74/tiktok-api-dl') return {
          Downloader: async link => {
            assert.equal(link, LINK); chamadas.push('fonte')
            if (op.falhaFonte) throw Error('fonte ficticia')
            return { status: 'success', result: { video: { playAddr: ['https://fixture.invalid/video.mp4'] }, music: { playUrl: ['https://fixture.invalid/audio.mp3'] } } }
          }
        }
        return req(n)
      }
    }, { filename: arquivo })
    return m.exports
  }
  video = carregar('tiktok')
  const audio = carregar('tiktok-audio')
  return { video, audio, chamadas, op }
}
function fixture({ publico = false, quantidade = 4, participantes, metadataFalha = false, restrito = false, antilink = false, hard = false, off = false, tratado = null, mudo = false } = {}) {
  const h = handlers(), envios = [], erros = [], membros = participantes || Array.from({ length: quantidade }, (_, i) => ({ id: i === 0 ? PN : `${900000 + i}@lid`, phoneNumber: `0001${String(i).padStart(7, '0')}@s.whatsapp.net`, admin: i === 0 ? 'admin' : null }))
  let listener
  const sock = { user: { id: '00010000003@s.whatsapp.net' }, ev: { on: (_e, fn) => { listener = fn } }, groupMetadata: async () => { if (metadataFalha) throw Error('metadata ficticia'); return { id: GRUPO, participants: membros } },
    sendMessage: async (_jid, payload) => { envios.push(payload); if (h.op.falhaEnvio) throw Error('transporte ficticio'); return { key: { id: 'envio-ficticio' } } } }
  const registro = new Map([['mute', { mutedUsers: new Set(mudo ? [LID] : []) }]])
  for (const c of [h.video, h.audio]) for (const n of [c.nome, ...c.aliases]) registro.set(n, c)
  const compartilhado = require('../comandos-registry').comandos
  for (const c of [h.video, h.audio]) for (const n of [c.nome, ...c.aliases]) compartilhado.set(n, c)
  const remocoes = []
  let mongoHard
  if (hard) {
    const fake = require('./helpers/colecao-figurinhas-fake')
    mongoHard = { config: fake(), eventos: fake(), travas: fake() }
    mongoHard.config.docs.push({ _id: GRUPO, ativo: true })
    require('../dados/antilinkhard-config').__definirColecoesTeste(mongoHard)
    require('../dados/moderacao-antilinkhard').__limparCacheTeste()
    if (!participantes) membros.splice(0, membros.length, { id: sock.user.id, admin: 'admin' }, { id: LID, phoneNumber: PN })
    sock.groupParticipantsUpdate = async (_jid, alvos) => { remocoes.push(...alvos); return alvos.map(jid => ({ jid, status: '200' })) }
    require('../comandos/admin/ban').__definirGravacaoBlacklistTeste(() => { throw Error('blacklist nao pode ser alterada pelo hard') })
  }
  for (const n of ['ping', 'menu']) registro.set(n, { executar: async () => envios.push({ controle: n }) })
  const moderacao = nome => ({ processarLote: async (_s, msgs) => new Set(tratado === nome ? msgs.filter(m => /tiktok|\btt\b/.test(require('../dados/texto-comando').extrairTextoComando(m))).map(m => `${m.key.remoteJid}:${m.key.id}`) : []) })
  const contexto = {
    require: createRequire(require.resolve('../bot')), sock, console: { log() {}, warn() {}, error: () => erros.push('erro') }, path, __dirname: path.dirname(require.resolve('../bot')),
    socketSeguro: require('../dados/socket-seguro'), moderacaoAntilinkHard: hard ? require('../dados/moderacao-antilinkhard') : moderacao('hard'), moderacaoAntiflood: moderacao('flood'), moderacaoLimiteCaractere: moderacao('limite'), moderacaoFigurinhas: moderacao('figurinha'), moderacaoAntigolpe: moderacao('golpe'),
    rodadasVouc: { obter: () => ({ processarMensagem: async () => false, fallback: async () => {} }) },
    antiApagadaHabilitada: async () => false, rankingRegistro: { registrarComNumeroReal: async () => {} },
    fs: { existsSync: () => true, readFileSync: () => JSON.stringify({ antiLink: antilink ? [GRUPO] : [], onlyAdmin: restrito ? [GRUPO] : [] }) },
    configAtiva: (c, a, b, jid) => c[a]?.includes(jid) || c[b]?.includes(jid), temLinkBasico: require('../dados/deteccao-links').temLinkBasico,
    extrairTextoComando: require('../dados/texto-comando').extrairTextoComando, capturaDiaria: { capturarMensagem() {} }, cacheMensagens: {}, comandos: registro,
    estadoBot: { permitirMensagem: async () => !off, remetenteEhDono: async () => false },
    resolverJidAfk: async () => ({ numero: null }), buscarVariosAfk: async () => new Map(), removerAfk: async () => null,
    formatarDuracao: () => '', MOTIVO_PADRAO: '', respostaPrefixo: { processar: async () => false }, prefixoComandos: prefixo,
    reacoesPalavras: { processar() {} }, processarMensagemLivre: async () => false, processarGatilhoIA: async () => {},
    ehAdminDoGrupo: config.ehAdminDoGrupo, AVISAR_BLOQUEIO: false
  }
  const fonte = fs.readFileSync(require.resolve('../bot'), 'utf8')
  const inicio = fonte.indexOf("sock.ev.on('messages.upsert', async ({ messages, type }) => {")
  const fim = fonte.indexOf("sock.ev.on('connection.update'", inicio)
  vm.runInNewContext(fonte.slice(inicio, fim), contexto)
  function msg(nome = 'tiktok', sender = LID) {
    return { key: { id: 'fixture-' + ++sequencia, remoteJid: publico ? PN : GRUPO, ...(publico ? {} : { participant: sender }) },
      messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: `${prefixo.prefixoSincrono()}${nome} ${LINK}` } }
  }
  return { ...h, sock, envios, erros, membros, registro, remocoes, mongoHard, msg, enviar: async (mensagens, type = 'notify') => listener({ type, messages: mensagens }) }
}
async function main() {
  for (const publico of [true, false]) await teste(publico ? 'PV processa video' : 'grupo processa video', async () => { const c = fixture({ publico }); await c.enviar([c.msg()]); assert.ok(c.envios.some(e => e.video)); assert.deepEqual(c.chamadas, ['fonte', 'download']) })
  await teste('comando na segunda posicao do lote nao desaparece', async () => { const c = fixture(); await c.enviar([c.msg('ping'), c.msg()]); assert.ok(c.envios.some(e => e.video)) })
  await teste('retorno precoce da primeira mensagem nao descarta proxima', async () => { const c = fixture(); const m = c.msg(); m.key.fromMe = true; await c.enviar([m, c.msg()]); assert.ok(c.envios.some(e => e.video)) })
  await teste('falha de comando anterior nao descarta proximo', async () => { const c = fixture(); c.registro.set('falhar', { executar: async () => { throw Error('falha ficticia') } }); await c.enviar([c.msg('falhar'), c.msg()]); assert.ok(c.envios.some(e => e.video)) })
  await teste('duas mensagens do lote sao processadas uma vez cada', async () => { const c = fixture(); await c.enviar([c.msg(), c.msg('tiktok-audio')]); assert.equal(c.envios.filter(e => e.video).length, 1); assert.equal(c.envios.filter(e => e.audio).length, 1) })
  await teste('correcao nao amplia replay de comandos em lotes append', async () => { const c = fixture(); await c.enviar([{ ...c.msg('ping'), message: { conversation: '/ping' } }, c.msg()], 'append'); assert.equal(c.chamadas.length, 0); assert.ok(c.envios.some(e => e.controle === 'ping')) })
  await teste('moderacao da primeira mensagem nao ignora o ping seguinte', async () => { const c = fixture({ tratado: 'flood' }); await c.enviar([c.msg(), { ...c.msg('ping'), message: { conversation: '/ping' } }]); assert.equal(c.chamadas.length, 0); assert.ok(c.envios.some(e => e.controle === 'ping')) })
  for (const sender of [PN, LID, '888888@lid']) await teste('Swag ficticio grande com namespace ' + (sender.endsWith('@lid') ? 'LID' : 'PN'), async () => { const c = fixture({ quantidade: 2048 }); await c.enviar([c.msg('tiktok', sender)]); assert.ok(c.envios.some(e => e.video)) })
  for (const opcoes of [{ metadataFalha: true }, { participantes: [{ id: LID }, { id: LID, phoneNumber: PN }] }]) await teste('sem restricao metadata falha/ambigua nao impede download publico', async () => { const c = fixture(opcoes); await c.enviar([c.msg()]); assert.ok(c.envios.some(e => e.video)) })
  for (const opcoes of [{ restrito: true, metadataFalha: true }, { restrito: true }, { off: true }, { mudo: true }]) await teste('barreira existente continua bloqueando sem baixar', async () => { const c = fixture(opcoes); await c.enviar([c.msg()]); assert.equal(c.chamadas.length, 0) })
  await teste('admin PN continua autorizado no modo restrito', async () => { const c = fixture({ restrito: true }); await c.enviar([c.msg('tiktok', PN)]); assert.ok(c.envios.some(e => e.video)) })
  for (const regra of ['hard', 'flood', 'limite', 'figurinha', 'golpe']) await teste('mensagem tratada por ' + regra + ' nao chega ao handler', async () => { const c = fixture({ tratado: regra }); await c.enviar([c.msg()]); assert.equal(c.chamadas.length, 0) })
  await teste('antilink basico bloqueia link adicional, mantendo ping/menu', async () => { const c = fixture({ antilink: true }); const m = c.msg(); m.message.conversation += ' https://extra.invalid'; await c.enviar([m]); await c.enviar([c.msg('ping')].map(m => ({ ...m, message: { conversation: '/ping' } }))); await c.enviar([c.msg('menu')].map(m => ({ ...m, message: { conversation: '/menu' } }))); assert.equal(c.chamadas.length, 0); assert.ok(c.envios.some(e => e.delete)); assert.ok(c.envios.some(e => e.controle === 'ping')); assert.ok(c.envios.some(e => e.controle === 'menu')) })
  for (const publico of [true, false]) await teste('audio direto preservado em ' + (publico ? 'PV' : 'grupo'), async () => { const c = fixture({ publico }); await c.enviar([c.msg('tiktok-audio')]); assert.ok(c.envios.some(e => e.audio)) })
  for (const flag of ['falhaFonte', 'falhaDownload', 'falhaEnvio']) await teste('falha simulada: ' + flag, async () => { const c = fixture(); c.op[flag] = true; await c.enviar([c.msg()]); assert.ok(c.envios.some(e => e.text)); assert.equal(c.erros.length, 0) })
  await teste('diagnostico integrado mostra a barreira real sem dados privados', async () => {
    const anterior = process.env.HIPNOS_DIAG_TIKTOK, info = console.info, logs = []
    process.env.HIPNOS_DIAG_TIKTOK = 'true'; console.info = (...a) => logs.push(a)
    try {
      const c = fixture({ antilink: true }), m = c.msg(); m.message.conversation += ' https://extra.invalid'; await c.enviar([m])
      assert.ok(logs.some(l => l[1]?.evento === 'antilink_basico' && l[1]?.resultado === 'bloqueado'))
      const d = fixture(); await d.enviar([d.msg()])
      for (const etapa of ['recebida', 'reconhecido', 'handler', 'fonte', 'download', 'preparar_midia', 'envio_midia', 'fim']) assert.ok(logs.some(l => l[1]?.evento === etapa), etapa)
      assert.ok(logs.some(l => l[1]?.evento === 'envio_midia' && l[1]?.resultado === 'ok'))
      for (const privado of [LINK, GRUPO, PN, LID, 'fixture-publica', 'midia-ficticia']) assert.ok(!JSON.stringify(logs).includes(privado))
    } finally { console.info = info; if (anterior === undefined) delete process.env.HIPNOS_DIAG_TIKTOK; else process.env.HIPNOS_DIAG_TIKTOK = anterior }
  })
  for (const sinal of ['/', '!', '#']) for (const nome of ['tiktok', 'tt', 'ttk', 'tik-tok', 'tiktokdl', 'tiktok-audio', 'tt-audio']) await teste('prefixo e alias ' + sinal + nome, async () => { prefixo.__definirPrefixoTeste(sinal); const c = fixture(); await c.enviar([c.msg(nome)]); assert.ok(c.envios.some(e => e.video || e.audio)) })
  prefixo.__definirPrefixoTeste('/')
  console.log(`${passaram} passaram; ${falharam} falharam.`)
  process.exitCode = falharam ? 1 : 0
}
module.exports = { fixture, LINK, GRUPO, PN, LID }
if (require.main === module) main().catch(e => { console.error(e.name); process.exitCode = 1 })
