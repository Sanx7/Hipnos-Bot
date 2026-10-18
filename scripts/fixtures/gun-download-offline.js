// Preload exclusivo do teste: Baileys e AES reais, HTTP substituído por arquivo.
const fs = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')
const { createCipheriv } = require('node:crypto')
const Module = require('node:module')
const carregar = Module._load
Module._load = function (nome, ...args) {
  if (nome === 'canvas' || nome === '@napi-rs/canvas') throw new Error('Decoder proibido no processo de download')
  return carregar.call(this, nome, ...args)
}
require('node:net').Socket.prototype.connect = function () { throw new Error('Rede proibida no download offline') }
const existe = fs.existsSync
fs.existsSync = p => path.basename(String(p)).startsWith('.env') ? false : existe(p)
let bytesOrigem = 0, medirOrigem = false
process.on('exit', () => {
  if (medirOrigem) fs.writeFileSync(path.join(process.env.GUN_FIXTURE_DIR, `origem-${process.pid}.json`), JSON.stringify({ bytesOrigem }), { mode: 0o600 })
})
for (const [objeto, nome] of [[fs, 'readFileSync'], [fs.promises, 'readFile']]) {
  const ler = objeto[nome]
  objeto[nome] = function (arquivo, ...args) {
    if (path.basename(String(arquivo)).startsWith('.env')) throw new Error('Credenciais proibidas no teste')
    return ler.call(this, arquivo, ...args)
  }
}
global.fetch = async url => {
  const nome = new URL(url).pathname.slice(1)
  medirOrigem = nome === 'acima.png'
  if (!['detalhada.png', 'detalhada.jpg', 'limite.png', 'acima.png', 'media.png', 'interrompido', 'timeout', 'abertura'].includes(nome)) throw new Error('Fixture inválida')
  if (nome === 'abertura') {
    setInterval(() => {}, 1000)
    return new Promise(() => {})
  }
  const { cipherKey, iv } = await require('@whiskeysockets/baileys').getMediaKeys(Buffer.alloc(32), 'image')
  const fonte = Readable.from((async function * () {
    if (nome === 'timeout') {
      yield Buffer.alloc(65536)
      setInterval(() => {}, 1000)
      await new Promise(() => {})
    }
    if (nome === 'interrompido') { yield Buffer.alloc(65536); throw new Error('Download interrompido') }
    for await (const parte of fs.createReadStream(path.join(process.env.GUN_FIXTURE_DIR, nome), { highWaterMark: 65536 })) { bytesOrigem += parte.length; yield parte }
    // Simular arquivo maior: deve cortar antes de receber toda esta cauda.
    if (nome === 'acima.png') for (let i = 0; i < 64; i++) { bytesOrigem += 65536; yield Buffer.alloc(65536) }
  })())
  const cifrado = createCipheriv('aes-256-cbc', cipherKey, iv)
  fonte.on('error', erro => cifrado.destroy(erro))
  return { ok: true, body: fonte.pipe(cifrado) }
}
