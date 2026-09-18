// ============================================
// 🧪 teste-brat.js — Valida /brat e /bratvid (100% offline)
// ============================================
// Uso: node scripts/teste-brat.js
// ============================================

const comandos = require('../comandos/menu-principal/brat')
const brat = comandos.find(c => c.nome === 'brat')
const bratvid = comandos.find(c => c.nome === 'bratvid')

const JID = '120363000000000000@g.us'

function criarMsg(texto) {
  return {
    key: { remoteJid: JID, fromMe: false, id: 'MSG123', participant: '5555000000002@s.whatsapp.net' },
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

const ehWebp = (buffer) =>
  buffer.length > 12 &&
  buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
  buffer.subarray(8, 12).toString('ascii') === 'WEBP'

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

  await testar('exports: array com brat e bratvid + executar', async () => {
    if (comandos.length !== 2) throw new Error(`esperava 2 comandos, há ${comandos.length}`)
    for (const [cmd, nome] of [[brat, 'brat'], [bratvid, 'bratvid']]) {
      if (!cmd || cmd.nome !== nome) throw new Error(`comando ausente: ${nome}`)
      if (typeof cmd.executar !== 'function') throw new Error(`/${nome}: sem executar`)
      if (!cmd.descricao) throw new Error(`/${nome}: sem descricao`)
    }
  })

  await testar('/brat sem texto → aviso de uso, sem gerar mídia', async () => {
    const { sock, enviadas } = criarSock()
    await brat.executar(sock, JID, criarMsg('/brat'), '/brat')
    if (stickerUnico(enviadas)) throw new Error('gerou sticker sem texto')
    const texto = textoUnico(enviadas)
    if (!texto || !/o que escrever na capa/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  await testar('/brat → figurinha estática (webp válido)', async () => {
    const { sock, enviadas } = criarSock()
    await brat.executar(sock, JID, criarMsg('/brat Oi Mundo Verde'), '/brat Oi Mundo Verde')
    const sticker = stickerUnico(enviadas)
    if (!sticker) throw new Error(`sticker ausente; enviadas: ${enviadas.length}`)
    if (!ehWebp(sticker)) throw new Error(`não é webp: ${sticker.subarray(0, 12).toString('hex')}`)
    if (sticker.length < 1000) throw new Error(`webp pequeno demais: ${sticker.length} bytes`)
    if (textoUnico(enviadas)) throw new Error('aviso indevido junto do sticker')
  })

  await testar('/bratvid → figurinha ANIMADA (webp múltiplos quadros)', async () => {
    const { sock, enviadas } = criarSock()
    await bratvid.executar(sock, JID, criarMsg('/bratvid hipnos bot'), '/bratvid hipnos bot')
    const sticker = stickerUnico(enviadas)
    if (!sticker) throw new Error('sticker ausente')
    if (!ehWebp(sticker)) throw new Error('não é webp')
    // Animação: o chunk ANMF (frame animado) precisa existir no arquivo
    if (!sticker.includes(Buffer.from('ANMF'))) throw new Error('webp sem frames animados')
    if (sticker.length > 1024 * 1024) throw new Error(`webp grande demais: ${sticker.length} bytes`)
  })

  await testar('texto longo é truncado sem quebrar a geração', async () => {
    const { sock, enviadas } = criarSock()
    const longo = 'palavra '.repeat(15).trim()
    await brat.executar(sock, JID, criarMsg(`/brat ${longo}`), `/brat ${longo}`)
    if (!stickerUnico(enviadas)) throw new Error('sticker não gerado com texto longo')
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
