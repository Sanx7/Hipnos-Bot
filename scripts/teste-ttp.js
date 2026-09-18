// ============================================
// 🧪 teste-ttp.js — Valida o comando /ttp (geração local com jimp)
// ============================================
// RODA 100% OFFLINE (sem WhatsApp, sem rede): gera a imagem DE VERDADE
// com o jimp instalado e valida o fluxo do comando com sock mockado.
// Verifica:
//   - exports (nome, descricao, executar + gerarImagem p/ os testes);
//   - gerarImagem(): PNG 512x512, fundo escuro, texto branco presente;
//   - acentuação (é/ã/ç) renderiza com os glifos da fonte bitmap;
//   - palavra gigante (sem espaços) é cortada e não toca as bordas;
//   - sem texto → aviso de uso, sem gerar mídia;
//   - com texto → exatamente UMA figurinha (webp) é enviada;
//   - texto longo é truncado sem quebrar a geração.
// Uso: node scripts/teste-ttp.js
// ============================================

const ttp = require('../comandos/menu-principal/ttp')
const { Jimp } = require('jimp')

const JID_GRUPO = '120363000000000000@g.us'

function criarMsg(texto = '/ttp') {
  return {
    key: { remoteJid: JID_GRUPO, fromMe: false, id: 'MSG123', participant: '5555000000002@s.whatsapp.net' },
    message: { conversation: texto }
  }
}

function criarSock() {
  const enviadas = []
  return {
    enviadas,
    sock: {
      sendMessage: async (jid, conteudo, extra) => {
        enviadas.push({ jid, conteudo, extra })
        return { key: { id: `fake-${enviadas.length}` } }
      }
    }
  }
}

const textoUnico = (enviadas) => {
  const t = enviadas.filter(e => e.conteudo?.text)
  return t.length === 1 ? t[0].conteudo.text : null
}

const stickerUnico = (enviadas) => {
  const s = enviadas.filter(e => Buffer.isBuffer(e.conteudo?.sticker))
  return s.length === 1 ? s[0].conteudo.sticker : null
}

const ehPng = (buffer) =>
  buffer.length > 8 && buffer.subarray(0, 4).toString('hex') === '89504e47'

async function main() {
  let reprovadas = 0
  const testar = async (nome, fn) => {
    try {
      await fn()
      console.log(`✅ ${nome}`)
    } catch (err) {
      reprovadas += 1
      console.log(`❌ ${nome}:`, err?.message || err)
    }
  }

  await testar('exports: nome, descricao, executar e gerarImagem', async () => {
    if (ttp.nome !== 'ttp') throw new Error(`nome: ${ttp.nome}`)
    if (typeof ttp.executar !== 'function') throw new Error('sem executar')
    if (typeof ttp.gerarImagem !== 'function') throw new Error('gerarImagem não exportada')
    if (!ttp.descricao) throw new Error('sem descricao')
  })

  await testar('gerarImagem: PNG 512x512, fundo escuro + texto branco', async () => {
    const png = await ttp.gerarImagem('o sono alcança todos')
    if (!ehPng(png)) throw new Error(`não é PNG: ${png.subarray(0, 4).toString('hex')}`)
    const img = await Jimp.read(png)
    if (img.bitmap.width !== 512 || img.bitmap.height !== 512) {
      throw new Error(`tamanho: ${img.bitmap.width}x${img.bitmap.height}`)
    }
    const px = (x, y) => {
      const n = img.getPixelColor(x, y)
      return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255]
    }
    const [r, g, b] = px(10, 10)
    if (r > 80 || g > 80 || b > 80) throw new Error(`fundo não está escuro: ${r},${g},${b}`)
    let brancos = 0
    for (let x = 40; x < 480; x += 2) {
      for (let y = 40; y < 480; y += 2) {
        const [rr, gg, bb] = px(x, y)
        if (rr > 235 && gg > 235 && bb > 235) brancos++
      }
    }
    if (brancos < 200) throw new Error(`texto branco ausente (${brancos} pixels)`)
  })

  await testar('acentuação: é/ã/ç renderizam com a fonte bitmap', async () => {
    const png = await ttp.gerarImagem('Ação, coragem e sono — até amanhã!')
    const img = await Jimp.read(png)
    let brancos = 0
    for (let x = 40; x < 480; x += 2) {
      for (let y = 40; y < 480; y += 2) {
        const n = img.getPixelColor(x, y)
        if (((n >>> 24) & 255) > 235 && ((n >>> 16) & 255) > 235 && ((n >>> 8) & 255) > 235) brancos++
      }
    }
    if (brancos < 200) throw new Error(`texto acentuado não apareceu (${brancos} pixels)`)
  })

  await testar('palavra gigante sem espaços: cortada, nunca toca as bordas', async () => {
    const png = await ttp.gerarImagem('a'.repeat(200))
    if (!ehPng(png)) throw new Error('PNG inválido')
    const img = await Jimp.read(png)
    for (let y = 0; y < 512; y += 1) {
      for (const x of [0, 10, 30, 500, 510]) {
        const n = img.getPixelColor(x, y)
        if (((n >>> 24) & 255) > 240 && ((n >>> 16) & 255) > 240) {
          throw new Error(`texto tocou a borda em x=${x}, y=${y}`)
        }
      }
    }
  })



  await testar('/ttp sem texto → aviso de uso, sem gerar mídia', async () => {
    const { sock, enviadas } = criarSock()
    await ttp.executar(sock, JID_GRUPO, criarMsg('/ttp'), '/ttp')
    if (stickerUnico(enviadas)) throw new Error('gerou sticker sem texto')
    const texto = textoUnico(enviadas)
    if (!texto || !/o que escrever na imagem/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  await testar('/ttp com texto → envia exatamente UMA figurinha (webp)', async () => {
    const { sock, enviadas } = criarSock()
    await ttp.executar(sock, JID_GRUPO, criarMsg('/ttp hipnos bot'), '/ttp hipnos bot')
    const sticker = stickerUnico(enviadas)
    if (!sticker) throw new Error(`sticker ausente; enviadas: ${enviadas.length}`)
    if (sticker.subarray(8, 12).toString('ascii') !== 'WEBP') throw new Error('não é webp')
    if (sticker.length < 100) throw new Error(`sticker vazio: ${sticker.length} bytes`)
    if (textoUnico(enviadas)) throw new Error('aviso indevido junto do sticker')
  })

  await testar('texto longo é truncado sem quebrar a geração', async () => {
    const { sock, enviadas } = criarSock()
    const longo = 'palavra '.repeat(20).trim()
    await ttp.executar(sock, JID_GRUPO, criarMsg(`/ttp ${longo}`), `/ttp ${longo}`)
    if (!stickerUnico(enviadas)) throw new Error('sticker não gerado com texto longo')
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
