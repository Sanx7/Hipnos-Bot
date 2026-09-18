// ============================================
// 🧪 teste-fake-chat.js — Valida o /fake-chat (geração local com jimp)
// ============================================
// RODA 100% OFFLINE (sem WhatsApp, sem rede): gera a imagem DE VERDADE
// com o jimp instalado e valida o fluxo do comando com sock mockado.
// Verifica:
//   - exports (nome, aliases, descricao, executar + parse p/ os testes);
//   - parse: 1 bolha minha, "Nome | msg", "Nome: msg" e ida-e-volta;
//   - gerarImagem(): PNG 720px de largura, bolha verde + texto branco;
//   - sem texto → aviso de uso, sem gerar mídia;
//   - com texto → exatamente UMA imagem (com jpegThumbnail pronta);
//   - 9+ linhas → corta em 8 mensagens sem quebrar.
// Uso: node scripts/teste-fake-chat.js
// ============================================

const fake = require('../comandos/menu-principal/fake-chat')
const { Jimp } = require('jimp')

const JID_GRUPO = '120363000000000000@g.us'

function criarMsg(texto = '/fake-chat') {
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

const imagemUnica = (enviadas) => {
  const s = enviadas.filter(e => Buffer.isBuffer(e.conteudo?.image))
  return s.length === 1 ? s[0] : null
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

  await testar('exports: nome, aliases, executar e parse', async () => {
    if (fake.nome !== 'fake-chat') throw new Error(`nome: ${fake.nome}`)
    if (typeof fake.executar !== 'function') throw new Error('sem executar')
    if (typeof fake.parsearConversa !== 'function') throw new Error('parse nao exportado')
    if (typeof fake.gerarImagem !== 'function') throw new Error('gerarImagem nao exportada')
    if (!fake.descricao) throw new Error('sem descricao')
    for (const a of ['fakechat', 'fchat', 'printchat']) {
      if (!fake.aliases.includes(a)) throw new Error(`alias ausente: ${a}`)
    }
  })

  await testar('parse: texto simples → 1 bolha minha', async () => {
    const msgs = fake.parsearConversa('oi, sumido!')
    if (msgs.length !== 1) throw new Error(`msgs: ${msgs.length}`)
    if (msgs[0].lado !== 'eu' || msgs[0].texto !== 'oi, sumido!') throw new Error(JSON.stringify(msgs[0]))
  })

  await testar('parse: "Nome | msg" e "Nome: msg" → bolha esquerda', async () => {
    const a = fake.parsearConversa('Ana | oi, sumido!')
    if (a.length !== 1 || a[0].lado !== 'fora' || a[0].nome !== 'Ana') throw new Error(JSON.stringify(a))
    const b = fake.parsearConversa('Ana: oi, sumido!')
    if (b.length !== 1 || b[0].lado !== 'fora' || b[0].nome !== 'Ana') throw new Error(JSON.stringify(b))
  })

  await testar('parse: ida e volta em 3 linhas', async () => {
    const msgs = fake.parsearConversa('Ana: oi, sumido!\neu: oi! quanto tempo\nAna | que bom te ver')
    if (msgs.length !== 3) throw new Error(`msgs: ${msgs.length}`)
    if (msgs[0].lado !== 'fora' || msgs[1].lado !== 'eu' || msgs[2].lado !== 'fora') {
      throw new Error(JSON.stringify(msgs.map((m) => m.lado)))
    }
  })

  await testar('gerarImagem: PNG 720px, bolha verde + texto branco', async () => {
    const png = await fake.gerarImagem([{ lado: 'eu', nome: null, texto: 'o sono alcanca todos' }])
    if (!ehPng(png)) throw new Error(`nao e PNG: ${png.subarray(0, 4).toString('hex')}`)
    const img = await Jimp.read(png)
    if (img.bitmap.width !== 720) throw new Error(`largura: ${img.bitmap.width}`)
    const px = (x, y) => {
      const n = img.getPixelColor(x, y)
      return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255]
    }
    // bolha MINHA = lado direito (x 450-710, faixa das bolhas y 100-260)
    let verdes = 0
    for (let x = 450; x < 710; x += 3) {
      for (let y = 100; y < 260; y += 3) {
        const [r, g, b] = px(x, y)
        if (g > 60 && g >= r && g >= b) verdes++
      }
    }
    if (verdes < 200) throw new Error(`bolha verde ausente (${verdes} pixels)`)
    let brancos = 0
    for (let x = 400; x < 710; x += 2) {
      for (let y = 100; y < 280; y += 2) {
        const [r, g, b] = px(x, y)
        if (r > 150 && g > 150 && b > 150) brancos++
      }
    }
    if (brancos < 100) throw new Error(`texto branco ausente (${brancos} pixels)`)
  })

  await testar('/fake-chat sem texto → aviso de uso, sem gerar midia', async () => {
    const { sock, enviadas } = criarSock()
    await fake.executar(sock, JID_GRUPO, criarMsg('/fake-chat'), '/fake-chat')
    if (imagemUnica(enviadas)) throw new Error('gerou imagem sem texto')
    const texto = textoUnico(enviadas)
    if (!texto || !/dizer a conversa/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  await testar('/fake-chat com texto → UMA imagem com jpegThumbnail', async () => {
    const { sock, enviadas } = criarSock()
    await fake.executar(sock, JID_GRUPO, criarMsg('/fake-chat Ana | oi'), '/fake-chat Ana | oi')
    const envio = imagemUnica(enviadas)
    if (!envio) throw new Error(`imagem ausente; enviadas: ${enviadas.length}`)
    if (!ehPng(envio.conteudo.image)) throw new Error('nao e PNG')
    if (typeof envio.conteudo.jpegThumbnail !== 'string' || !envio.conteudo.jpegThumbnail.length) {
      throw new Error('jpegThumbnail deveria ir pronta (evita processamento nativo)')
    }
    if (textoUnico(enviadas)) throw new Error('aviso indevido junto da imagem')
  })

  await testar('9+ linhas → corta em 8 mensagens sem quebrar', async () => {
    const corpo = Array.from({ length: 12 }, (_, i) => `eu: msg ${i + 1}`).join('\n')
    const msgs = fake.parsearConversa(corpo)
    if (msgs.length !== fake.MAX_MENSAGENS) throw new Error(`msgs: ${msgs.length}`)
    const { sock, enviadas } = criarSock()
    await fake.executar(sock, JID_GRUPO, criarMsg('/fake-chat x'), `/fake-chat\n${corpo}`)
    if (!imagemUnica(enviadas)) throw new Error('imagem nao gerada com 12 linhas')
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
