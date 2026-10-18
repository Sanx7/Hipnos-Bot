// Processo descartável: sem config, banco, WhatsApp, rede ou imports do bot.
const fs = require('node:fs')
require('node:net').Socket.prototype.connect = function () { throw new Error('Rede proibida.') }

async function main() {
  const [efeito, entrada, saida] = process.argv.slice(2)
  if (efeito !== 'gun') throw new Error('Efeito inválido.')
  let buffer = fs.readFileSync(entrada)
  // Inspeção completa somente no filho, antes de importar/usar o decoder nativo.
  // Não limitar o header a 512 KiB: JPEG com metadados longos continua aceito.
  require('./renderizador-canvas').validarImagem(buffer)
  const { createCanvas, loadImage } = require('@napi-rs/canvas')
  const tamanhoOriginal = buffer.length
  let img = await loadImage(buffer)
  buffer = null
  const LADO = 480
  const canvas = createCanvas(LADO, LADO)
  try {
    const ctx = canvas.getContext('2d')
    const escala = Math.max(LADO / img.width, LADO / img.height)
    ctx.drawImage(img, (LADO - img.width * escala) / 2, (LADO - img.height * escala) / 2, img.width * escala, img.height * escala)
    const cx = LADO / 2 + ((tamanhoOriginal % 61) - 30)
    const cy = LADO / 2 + ((tamanhoOriginal % 47) - 23)
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
    fs.writeFileSync(saida, canvas.toBuffer('image/png'), { mode: 0o600 })
  } finally { canvas.width = 1; canvas.height = 1; img = null }
  console.log(JSON.stringify({ picoRssBytes: process.resourceUsage().maxRSS * 1024 }))
}

main().catch(falha => {
  const code = ['GUN_DIMENSOES', 'GUN_IMAGEM'].includes(falha?.code) ? falha.code : 'GUN_RENDERIZACAO'
  console.log(JSON.stringify({ code }))
  process.exitCode = 1
})
