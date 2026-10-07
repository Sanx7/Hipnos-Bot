// Mesmo compositor do comando; dados fictícios, sem WhatsApp ou MongoDB.
// Uso: node scripts/previa-procurado.js
const fs = require('fs')
const path = require('path')
const { Jimp } = require('jimp')
const cartaz = require('../dados/cartaz-procurado')
const { RODAPE_CARTAZ } = require('../comandos/menu-utilitario/procurado').__internos

async function main() {
  const pasta = path.resolve(__dirname, '../.tmp/previa-procurado')
  fs.mkdirSync(pasta, { recursive: true })
  const buffer = await cartaz.comporCartazProcurado({
    nome: 'João da Silva', alcunha: 'Devorador de Deuses', total: 1287,
    palavra: 'mensagens', ultimaMensagem: '07/10/2026', rodape: RODAPE_CARTAZ
  })
  fs.writeFileSync(path.join(pasta, 'previa.png'), buffer)
  const debug = await Jimp.read(buffer)
  const t = cartaz.CAIXA_TITULO
  const pintar = cartaz.__internos.pintarReto
  pintar(debug, t.x, t.y, t.largura, 3, '#ff0000')
  pintar(debug, t.x, t.y + t.altura - 3, t.largura, 3, '#ff0000')
  pintar(debug, t.x, t.y, 3, t.altura, '#ff0000')
  pintar(debug, t.x + t.largura - 3, t.y, 3, t.altura, '#ff0000')
  await debug.write(path.join(pasta, 'debug-depois.png'))
  console.log('Prévia e depuração em:', pasta)
  console.log('Área útil do título:', t)
}
main().catch(err => { console.error(err); process.exitCode = 1 })
