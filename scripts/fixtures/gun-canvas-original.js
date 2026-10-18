// Referência visual congelada antes da migração (node-canvas).
// Uso exclusivo nos testes; não é carregada pelo bot.
const { createCanvas, loadImage } = require('canvas')
async function comporGun(bufferFoto) {
  const img = await loadImage(bufferFoto)
  const LADO = 480
  const escala = Math.max(LADO / img.width, LADO / img.height)
  const canvas = createCanvas(LADO, LADO)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, (LADO - img.width * escala) / 2, (LADO - img.height * escala) / 2, img.width * escala, img.height * escala)
  const cx = LADO / 2 + ((bufferFoto.length % 61) - 30)
  const cy = LADO / 2 + ((bufferFoto.length % 47) - 23)
  ctx.strokeStyle = '#ff0000'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(cx, cy, 70, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, 40, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx - 95, cy)
  ctx.lineTo(cx + 95, cy)
  ctx.moveTo(cx, cy - 95)
  ctx.lineTo(cx, cy + 95)
  ctx.stroke()
  ctx.fillStyle = '#ff0000'
  ctx.beginPath()
  ctx.arc(cx, cy, 6, 0, Math.PI * 2)
  ctx.fill()
  return canvas.toBuffer('image/png')
}
module.exports = comporGun
