// Backpressure e limite durante o recebimento; nunca reunir a imagem em memória.
const { createWriteStream } = require('node:fs')
const { Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')

async function receberStream(stream, arquivo, limite = 20 * 1024 * 1024) {
  let bytes = 0, recebidos = 0
  const contador = new Transform({
    highWaterMark: 65536,
    transform(parte, _, callback) {
      recebidos += parte.length
      if (parte.length > limite - bytes) {
        return callback(Object.assign(new Error('Imagem grande demais.'), { code: 'GUN_DIMENSOES', bytesRecebidos: recebidos }))
      }
      bytes += parte.length
      callback(null, parte)
    }
  })
  await pipeline(stream, contador, createWriteStream(arquivo, { flags: 'wx', mode: 0o600, highWaterMark: 65536 }))
  if (!bytes) throw Object.assign(new Error('Imagem vazia.'), { code: 'GUN_IMAGEM' })
  return bytes
}

module.exports = { receberStream }
