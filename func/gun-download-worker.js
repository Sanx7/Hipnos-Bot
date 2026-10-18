// O Baileys instalado não propaga AbortSignal ao fetch. Encerrar este processo
// fecha também o transporte HTTP, sem monkey-patch global nem alterar a biblioteca.
const { receberStream } = require('./receber-imagem-gun')

async function main() {
  let texto = ''
  for await (const parte of process.stdin) {
    if (texto.length + parte.length > 65536) throw new Error('Entrada inválida.')
    texto += parte.toString('utf8')
  }
  const imagem = JSON.parse(texto)
  const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
  const stream = await downloadContentFromMessage(imagem, 'image')
  const bytes = await receberStream(stream, process.argv[2])
  console.log(JSON.stringify({ bytes, picoRssBytes: process.resourceUsage().maxRSS * 1024 }))
}

main().then(() => process.exit(0), falha => {
  const code = falha?.code === 'GUN_DIMENSOES' ? 'GUN_DIMENSOES' : 'GUN_DOWNLOAD'
  console.log(JSON.stringify({ code, bytesRecebidos: falha?.bytesRecebidos,
    picoRssBytes: process.resourceUsage().maxRSS * 1024 }))
  process.exit(1)
})
