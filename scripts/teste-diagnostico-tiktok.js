// Testa a telemetria com relogio/timers/logs ficticios. Nao conecta a servicos.
require('./helpers/menu-catalogo-teste')
const assert = require('node:assert/strict')
const { criarDiagnostico } = require('../dados/diagnostico-tiktok')
let total = 0
async function teste(nome, fn) { await fn(); total++; console.log('OK: ' + nome) }
function fixture() {
  let agora = 1000000, ativo = true, seq = 0
  const logs = [], timers = new Map()
  const d = criarDiagnostico({ habilitado: () => ativo, registrar: (...a) => logs.push(a), relogio: () => agora,
    agendar: fn => { const id = ++seq; timers.set(id, fn); return id }, cancelar: id => timers.delete(id) })
  const msg = texto => ({ key: { id: 'id-privado', remoteJid: '100000000000@g.us', participant: '123456789000@lid' }, message: { conversation: texto } })
  return { d, logs, timers, msg, desligar: () => { ativo = false }, avancar: () => { agora += 600001 } }
}
async function main() {
  await teste('desligado nao emite logs nem timers', () => { const c = fixture(); c.desligar(); assert.equal(c.d.receber([c.msg('/tiktok https://fixture.invalid/privado')]).size, 0); c.d.marcar('handler'); assert.equal(c.logs.length, 0); assert.equal(c.timers.size, 0) })
  await teste('comandos alheios e conteudo vazio nao geram rastros', () => { const c = fixture(); assert.equal(c.d.receber([c.msg('/ping'), c.msg(''), {}]).size, 0) })
  await teste('recebe somente aliases previstos, sem transportar argumentos', () => { const c = fixture(); for (const n of ['tiktok', 'tt', 'ttk', 'tik-tok', 'tiktokdl', 'tiktok-audio', 'tiktok-aud', 'tiktok-mp3', 'tt-audio', 'tk-audio']) assert.equal(c.d.receber([c.msg('/' + n + ' https://fixture.invalid/segredo')]).size, 1); assert.ok(!JSON.stringify(c.logs).includes('segredo')) })
  await teste('limita quatro rastros por lote e vinte por janela', () => { const c = fixture(); for (let i = 0; i < 5; i++) assert.equal(c.d.receber(Array.from({ length: 100 }, () => c.msg('/tt'))).size, 4); assert.equal(c.d.receber([c.msg('/tt')]).size, 0); c.avancar(); assert.equal(c.d.receber([c.msg('/tt')]).size, 1) })
  await teste('identificador aleatorio nao deriva do identificador da mensagem', () => { const c = fixture(), m = c.msg('/tt'); const a = c.d.receber([m]).get(m), b = c.d.receber([m]).get(m); assert.notEqual(a.id, b.id); assert.match(a.id, /^[a-f0-9]{12}$/); assert.ok(!a.id.includes('id-privado')) })
  await teste('etapas e campos arbitrarios nao sao registrados', async () => { const c = fixture(), m = c.msg('/tt'), r = c.d.receber([m]).get(m); await c.d.executar(r, async () => { c.d.marcar('https://segredo.invalid', 'ok'); c.d.marcar('handler', 'telefone-privado') }); assert.ok(!JSON.stringify(c.logs).includes('segredo')); assert.ok(!JSON.stringify(c.logs).includes('telefone-privado')) })
  await teste('erro bruto com URI token e identificadores vira somente categoria', async () => { const c = fixture(), m = c.msg('/tt'), r = c.d.receber([m]).get(m); await assert.rejects(c.d.executar(r, () => c.d.aguardar('download', async () => { throw Object.assign(Error('https://segredo.invalid?token=privado 123456789000@lid'), { code: 'ETIMEDOUT' }) }))); const s = JSON.stringify(c.logs); assert.ok(s.includes('timeout')); for (const dado of ['segredo', 'token', '123456789000', '@lid']) assert.ok(!s.includes(dado)); assert.equal(c.timers.size, 0) })
  await teste('espera longa registra a etapa sem cancelar ou repetir a operacao', async () => { const c = fixture(), m = c.msg('/tt'), r = c.d.receber([m]).get(m); let liberar, chamadas = 0; const p = c.d.executar(r, () => c.d.aguardar('envio_midia', () => { chamadas++; return new Promise(resolve => { liberar = resolve }) })); for (const fn of [...c.timers.values()]) fn(); assert.ok(c.logs.some(l => l[1].evento === 'aguardando' && l[1].etapa === 'envio_midia')); liberar('confirmado'); assert.equal(await p, 'confirmado'); assert.equal(chamadas, 1); assert.equal(c.timers.size, 0) })
  await teste('contextos concorrentes nao misturam rastros', async () => { const c = fixture(), a = c.msg('/tiktok'), b = c.msg('/tiktok-audio'), rastros = c.d.receber([a, b]); await Promise.all([a, b].map(m => c.d.executar(rastros.get(m), async () => { await Promise.resolve(); c.d.marcar('handler', 'ok') }))); for (const m of [a, b]) { const r = rastros.get(m); assert.ok(c.logs.some(l => l[1].rastro === r.id && l[1].comando === r.comando && l[1].evento === 'handler')) } })
  await teste('falha do logger nao altera resultado', async () => { const d = criarDiagnostico({ habilitado: () => true, registrar: () => { throw Error('logger ficticio') } }), m = fixture().msg('/tt'); assert.equal(await d.executar(d.receber([m]).get(m), async () => 42), 42) })
  console.log(`${total} testes de diagnostico passaram (offline).`)
}
main().catch(e => { console.error(e.name); process.exitCode = 1 })
