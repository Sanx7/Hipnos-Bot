const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')
const { receberStream } = require('../../func/receber-imagem-gun')

module.exports = async function testar() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'hipnos-gun-stream-'))
  const limite = 20 * 1024 * 1024, bloco = Buffer.alloc(65536, 37)
  try {
    const exato = path.join(pasta, 'exato')
    assert.equal(await receberStream(Readable.from((async function * () {
      for (let i = 0; i < limite / bloco.length; i++) yield bloco
    })()), exato), limite)
    assert.equal(fs.statSync(exato).size, limite)
    if (process.platform !== 'win32') assert.equal(fs.statSync(exato).mode & 0o777, 0o600)
    let fornecidos = 0
    const acima = Readable.from((async function * () {
      for (let i = 0; i < 1024; i++) { fornecidos++; yield bloco }
    })())
    const arquivo = path.join(pasta, 'acima')
    await assert.rejects(receberStream(acima, arquivo), { code: 'GUN_DIMENSOES' })
    assert.ok(acima.destroyed)
    assert.ok(fornecidos < 1024, 'não receber todo o download')
    assert.ok(fs.statSync(arquivo).size <= limite, 'nunca gravar o chunk excedente')
    const vazio = Readable.from([])
    await assert.rejects(receberStream(vazio, path.join(pasta, 'vazio')), { code: 'GUN_IMAGEM' })
    const interrompido = Readable.from((async function * () { yield bloco; throw new Error('interrompido') })())
    await assert.rejects(receberStream(interrompido, path.join(pasta, 'parcial')), /interrompido/)
    assert.ok(interrompido.destroyed)
    const falhaDisco = Readable.from([bloco])
    await assert.rejects(receberStream(falhaDisco, path.join(pasta, 'inexistente', 'saida')))
    assert.ok(falhaDisco.destroyed)
    const renderizador = require('../../func/renderizador-canvas')
    const antes = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('hipnos-render-')).sort()
    await assert.rejects(renderizador.executarExclusivo(reserva => reserva.renderizarDownload('gun', {}, {
      signal: AbortSignal.abort()
    })), { code: 'GUN_RENDERIZACAO' })
    assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('hipnos-render-')).sort(), antes)
    assert.equal(await renderizador.executarExclusivo(async () => 'recuperado'), 'recuperado')
    console.log('OK: streaming/backpressure, 20 MiB exatos, corte antecipado, 0600 no Linux, vazio, interrupção e erro de disco.')
  } finally { fs.rmSync(pasta, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
}
