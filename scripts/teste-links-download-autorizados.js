// Integra regras reais e listener em VM; toda persistencia/transporte sao ficticios.
const { carregarComandosReais } = require('./helpers/menu-catalogo-teste')
const assert = require('node:assert/strict')
const politica = require('../dados/links-download-autorizados')
const prefixo = require('../prefixo')
const { fixture, LINK, GRUPO, PN, LID } = require('./teste-tiktok-contexto')
const registro = new Map(carregarComandosReais().comandos)
const VIDEO = 'https://www.tiktok.com/@fixture/video/1234567890123456789'
const aliases = ['tiktok', 'tt', 'ttk', 'tik-tok', 'tiktokdl', 'tiktok-audio', 'tiktok-aud', 'tiktok-mp3', 'tt-audio', 'tk-audio']
let total = 0
async function teste(nome, fn) { await fn(); total++; console.log('OK: ' + nome) }
const mensagem = texto => ({ message: { conversation: texto } })
async function main() {
  for (const url of [LINK, 'https://vt.tiktok.com/ZMfixture/', VIDEO, VIDEO.replace('www.', ''), 'https://www.tiktok.com/t/ZMfixture/', VIDEO + '?is_from_webapp=1&sender_device=pc', LINK + '?_t=ZMfixture&_r=1']) await teste('URL oficial e formato permitido', async () => {
    assert.equal(politica.urlTikTokPermitida(url), true)
    assert.equal(await politica.permite(mensagem('/tiktok ' + url), registro), true)
  })
  for (const p of ['/', '!', '#', '$']) for (const alias of aliases) await teste('prefixo/alias registrado ' + p + alias, async () => {
    prefixo.__definirPrefixoTeste(p)
    assert.equal(await politica.permite(mensagem(`${p}${alias} ${LINK}`), registro), true)
  })
  prefixo.__definirPrefixoTeste('/')
  const invalidas = [
    'http://vm.tiktok.com/ZMfixture/', 'https://vm.tiktok.com:443/ZMfixture/', 'https://vm.tiktok.com:8443/ZMfixture/',
    'https://tiktok.com.evil.invalid/@fixture/video/1234567890123456789', 'https://eviltiktok.com/@fixture/video/1234567890123456789',
    'https://www.tiktok.com@evil.invalid/ZMfixture/', 'https://evil:senha@vm.tiktok.com/ZMfixture/',
    'https://foo.tiktok.com/ZMfixture/', 'https://m.tiktok.com/ZMfixture/', 'https://vm.tiktok.com./ZMfixture/',
    'https://www.tiktok.com%2eevil.invalid/ZMfixture/', 'https://www.tiktok.com\\@evil.invalid/ZMfixture/',
    'https://vm.tiktok.com/ZMfixture/#https://evil.invalid', 'https://vm.tiktok.com/ZMfixture/#',
    'https://vm.tiktok.com/ZMfixture/?redirect=https%3A%2F%2Fevil.invalid', 'https://vm.tiktok.com/ZMfixture/?url=evil.invalid',
    LINK + '?_t=https://evil.invalid', LINK + '?_t=https%3A%2F%2Fevil.invalid', LINK + '?_r=1&_r=2',
    'https://www.tiktok.com/', 'https://www.tiktok.com/login', 'https://www.tiktok.com/redirect',
    'https://www.tiktok.com/a/../@fixture/video/1234567890123456789', 'https://www.tiktok.com/%2e%2e/@fixture/video/1234567890123456789',
    'https://www.tiktok.com/@fixture/video/1234567890123456789%2f', 'https://127.0.0.1/tiktok.com/video/1234567890',
    'https://evil.invalid/tiktok.com/video/1234567890', 'https://vm.tiktok\uFF0Ecom/ZMfixture/',
    'https://v\u043c.tiktok.com/ZMfixture/', 'https://vm.tiktok.com/ZMfi\u200bxture/',
    'javascript:https://vm.tiktok.com/ZMfixture/', 'https://vm.tiktok.com/ZMfixture/?_r=1;url=evil.invalid'
  ]
  for (let i = 0; i < invalidas.length; i++) await teste('URL suspeita recusada ' + i, async () => {
    assert.equal(politica.urlTikTokPermitida(invalidas[i]), false)
    assert.equal(await politica.permite(mensagem('/tiktok ' + invalidas[i]), registro), false)
  })
  for (const texto of [LINK, '/inexistente ' + LINK, '/tiktokfake ' + LINK, '/tt2 ' + LINK, '/tiktok',
    '/tiktok ' + LINK + ' https://evil.invalid', '/tt ' + LINK + ' ' + VIDEO, '/tiktok ' + LINK + '\nhttps://evil.invalid',
    '/tiktok ' + LINK + ' comentario', '/tiktok ' + LINK + '\n', '/tiktok \n' + LINK, '/tiktok\u200b ' + LINK,
    '/t\u0456ktok ' + LINK, '\u202e/tiktok ' + LINK, ' /tiktok ' + LINK, '/tiktok [link](' + LINK + ')',
    '/tiktok https://instagram.com/p/fixture', '/pinterest https://pin.it/fixture', '/facebook https://facebook.com/watch/fixture']) {
    await teste('mensagem inteira fora do contrato nao recebe excecao', async () => assert.equal(await politica.permite(mensagem(texto), registro), false))
  }
  await teste('prefixo desatualizado nao recebe excecao', async () => { prefixo.__definirPrefixoTeste('#'); assert.equal(await politica.permite(mensagem('!tiktok ' + LINK), registro), false); prefixo.__definirPrefixoTeste('/') })
  await teste('alias precisa estar registrado e declarado no mesmo objeto', async () => {
    const r = new Map(registro); r.delete('tt'); assert.equal(await politica.permite(mensagem('/tt ' + LINK), r), false)
    r.set('tt', { nome: 'outro', executar() {} }); assert.equal(await politica.permite(mensagem('/tt ' + LINK), r), false)
    r.set('inventado', r.get('tiktok')); assert.equal(await politica.permite(mensagem('/inventado ' + LINK), r), false)
    r.set('tt', registro.get('tiktok')); r.delete('tiktok'); assert.equal(await politica.permite(mensagem('/tt ' + LINK), r), false)
  })
  await teste('falha no resolvedor de prefixo nao libera excecao', async () => {
    const original = prefixo.obterPrefixo
    try { prefixo.obterPrefixo = async () => { throw Error('prefixo ficticio') }; assert.equal(await politica.permite(mensagem('/tt ' + LINK), registro), false) }
    finally { prefixo.obterPrefixo = original }
  })
  for (const opcoes of [{ hard: true }, { antilink: true }, { hard: true, antilink: true }, {}]) for (const nome of ['tiktok', 'tt', 'tiktok-audio']) await teste('listener permite somente classificacao legitima com protecoes ' + JSON.stringify(opcoes) + ' ' + nome, async () => {
    const c = fixture(opcoes); await c.enviar([c.msg(nome)])
    assert.ok(c.envios.some(e => e.video || e.audio)); assert.equal(c.remocoes.length, 0); assert.ok(!c.envios.some(e => e.delete))
    if (c.mongoHard) { assert.equal(c.mongoHard.eventos.docs.length, 0); assert.equal(c.mongoHard.travas.docs.length, 0); assert.equal(c.mongoHard.config.docs[0].ativo, true) }
  })
  for (const texto of [LINK, '/inexistente ' + LINK, '/tiktok https://evil.example.com/video', '/tiktok ' + LINK + ' https://evil.example.com', '/tt https://tiktok.com.evil.example.com/video']) await teste('hard real conserva classificacao e punicao ficticia de link proibido', async () => {
    const c = fixture({ hard: true, antilink: true }), m = c.msg(); m.message.conversation = texto
    await c.enviar([m]); assert.equal(c.chamadas.length, 0); assert.equal(c.remocoes.length, 1); assert.ok(c.envios.some(e => e.delete)); assert.equal(c.mongoHard.eventos.docs.length, 1)
  })
  for (const sender of [LID, PN]) await teste('membro PN/LID separado recebe excecao sem cargo admin', async () => {
    const c = fixture({ hard: true, antilink: true }); await c.enviar([c.msg('tiktok', sender)]); assert.ok(c.envios.some(e => e.video)); assert.equal(c.remocoes.length, 0)
  })
  await teste('sem metadata ainda pode executar download publico permitido', async () => { const c = fixture({ hard: true, antilink: true, metadataFalha: true }); await c.enviar([c.msg()]); assert.ok(c.envios.some(e => e.video)); assert.equal(c.remocoes.length, 0) })
  await teste('restricao com metadata incompleta continua negando acesso', async () => { const c = fixture({ hard: true, antilink: true, restrito: true, metadataFalha: true }); await c.enviar([c.msg()]); assert.equal(c.chamadas.length, 0) })
  for (const flags of [{ off: true }, { mudo: true }, { tratado: 'flood' }, { tratado: 'golpe' }, { tratado: 'limite' }, { tratado: 'figurinha' }]) await teste('outra barreira continua efetiva ' + JSON.stringify(flags), async () => {
    const c = fixture({ hard: true, antilink: true, ...flags }); await c.enviar([c.msg()]); assert.equal(c.chamadas.length, 0); assert.equal(c.remocoes.length, 0)
  })
  await teste('lote misto preserva controle e download autorizado', async () => { const c = fixture({ hard: true, antilink: true }), controle = c.msg('ping'); controle.message.conversation = '/ping'; await c.enviar([controle, c.msg()]); assert.ok(c.envios.some(e => e.controle === 'ping')); assert.ok(c.envios.some(e => e.video)) })
  await teste('logs distinguem excecao de bloqueio sem dados privados', async () => {
    const ativo = process.env.HIPNOS_DIAG_TIKTOK, info = console.info, logs = []; process.env.HIPNOS_DIAG_TIKTOK = 'true'; console.info = (...a) => logs.push(a)
    try {
      const c = fixture({ hard: true, antilink: true }); await c.enviar([c.msg()])
      for (const etapa of ['excecao_antilinkhard', 'excecao_antilink_basico', 'reconhecido', 'handler', 'download', 'envio_midia']) assert.ok(logs.some(l => l[1]?.evento === etapa && (l[1].resultado === 'ok' || l[1].resultado === 'inicio')), etapa)
      const b = fixture({ hard: true }), m = b.msg(); m.message.conversation += ' https://evil.invalid'; await b.enviar([m]); assert.ok(logs.some(l => l[1]?.evento === 'antilinkhard' && l[1].resultado === 'bloqueado'))
      for (const dado of [LINK, GRUPO, PN, LID, 'evil.invalid']) assert.ok(!JSON.stringify(logs).includes(dado))
    } finally { console.info = info; if (ativo === undefined) delete process.env.HIPNOS_DIAG_TIKTOK; else process.env.HIPNOS_DIAG_TIKTOK = ativo }
  })
  console.log(`${total} testes de excecao de links passaram (offline).`)
}
main().catch(e => { console.error(e.name + ': ' + e.message); process.exitCode = 1 })
