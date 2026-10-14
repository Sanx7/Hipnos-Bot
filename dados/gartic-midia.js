const { createHash } = require('node:crypto')
const { Jimp, JimpMime } = require('jimp')
const { normalizeMessageContent } = require('@whiskeysockets/baileys')
const midia = require('./ads-midia')
const erro = require('./ads-erro')
const LIMITE_PIXELS = 16 * 1024 * 1024

function dimensoes(buffer) {
  const tipo = midia.validar(buffer, 'foto')
  if (tipo === 'image/png') {
    if (buffer.length < 33 || buffer.toString('ascii', 12, 16) !== 'IHDR') throw erro('PNG inválido.')
    return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)]
  }
  let offset = 2
  while (offset + 4 < buffer.length) {
    if (buffer[offset++] !== 255) break
    while (buffer[offset] === 255) offset++
    const marker = buffer[offset++]
    if (marker === 0xD9 || marker === 0xDA) break
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) continue
    const tamanho = buffer.readUInt16BE(offset)
    if (tamanho < 2 || offset + tamanho > buffer.length) break
    if ([0xC0, 0xC1, 0xC2].includes(marker) && tamanho >= 8) return [buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3)]
    offset += tamanho
  }
  throw erro('JPEG inválido ou não suportado.')
}
async function validar(buffer) {
  const [w, h] = dimensoes(buffer)
  if (!w || !h || w > 8192 || h > 8192 || w * h > LIMITE_PIXELS) throw erro('Imagem excede 8192 pixels por lado ou 16 megapixels.')
  let foto
  try { foto = await Jimp.read(buffer) } catch (_) { throw erro('A imagem não pôde ser decodificada. Envie JPEG ou PNG válido.') }
  if (foto.bitmap.width !== w || foto.bitmap.height !== h) throw erro('Dimensões de imagem inválidas.')
  const hash = createHash('sha256').update(buffer).digest('hex')
  if (w > 1280 || h > 1280) foto.scaleToFit({ w: 1280, h: 1280 })
  const otimizada = await foto.getBuffer(JimpMime.jpeg, { quality: 85 })
  midia.validar(otimizada, 'foto')
  return { hash, buffer: otimizada, formato: 'jpg', width: foto.bitmap.width, height: foto.bitmap.height }
}
async function extrair(sock, jid, msg, baixar) {
  const comando = normalizeMessageContent(msg?.message) || {}
  const contexto = Object.values(comando).map(v => v?.contextInfo).find(v => v?.quotedMessage)
  if (!contexto || midia.unica(contexto.quotedMessage)) throw erro('Responda a uma imagem comum JPEG/PNG. Visualização única não é aceita.')
  const conteudo = normalizeMessageContent(contexto.quotedMessage) || {}
  if (!conteudo.imageMessage || conteudo.videoMessage || conteudo.documentMessage) throw erro('Somente imagens JPEG/PNG são aceitas; vídeos e documentos não são permitidos.')
  // O helper existente faz download em stream, com teto de 8 MB e prazo.
  const resultado = await midia.extrair(sock, jid, msg, '', baixar)
  return validar(resultado.buffer)
}
module.exports = { extrair, validar, dimensoes, LIMITE_PIXELS }
