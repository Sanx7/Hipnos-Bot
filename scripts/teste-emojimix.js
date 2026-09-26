// ============================================================
// 🧪 teste-emojimix.js — Testes OFFLINE do /emojimix (parte 1/2)
// Rede injetada: _injetar(buscarUrl, baixar) — sem Google de verdade.
// Uso: node scripts/teste-emojimix.js
// ============================================================

const mod = require('../comandos/menu-utilitario/emojimix')
const cmd = mod[0]
const T = mod._test

const JID = '120363000000000000@g.us'
function criarMsg (texto) {
  return { key: { remoteJid: JID, fromMe: false, id: 'MSG1', participant: '5555000000002@s.whatsapp.net' }, message: { conversation: texto } }
}
function criarSock () {
  const enviadas = []
  return { enviadas, sock: { sendMessage: async (jid, conteudo, extra) => { enviadas.push({ jid, conteudo, extra }); return { key: { id: 'fake-' + enviadas.length } } } } }
}
const textoDe = (s) => s.enviadas.filter((e) => typeof e.conteudo?.text === 'string').map((e) => e.conteudo.text)
const imagemDe = (s) => s.enviadas.find((e) => Buffer.isBuffer(e.conteudo?.image))
const stickerDe = (s) => s.enviadas.find((e) => Buffer.isBuffer(e.conteudo?.sticker))

// PNG 1x1 válido (base64) p/ simular o download sem rede.
const PNG_FAKE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const URL_FAKE = 'https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u1f602/u1f602_u1f62d.png'

async function main () {
  let reprovadas = 0
  const testar = async (nome, fn) => {
    T._restaurar()
    try { await fn(); console.log(`✅ ${nome}`) } catch (err) { reprovadas += 1; console.log(`❌ ${nome}:`, err?.message || err) }
  }

  await testar('exports: nome/aliases/executar', async () => {
    if (cmd.nome !== 'emojimix') throw new Error('nome errado')
    if (typeof cmd.executar !== 'function') throw new Error('sem executar')
    if (!cmd.aliases.includes('mixemoji') || !cmd.aliases.includes('emoji-mix')) throw new Error('aliases incompletos: ' + cmd.aliases)
    if (!cmd.descricao) throw new Error('sem descricao')
  })

  await testar('interpretarPedido: formatos + modo fig', async () => {
    let p = T.interpretarPedido('/emojimix 😂😭')
    if (p.comoFig) throw new Error('fig indevido')
    p = T.interpretarPedido('/emojimix 😂 + 😭')
    if (p.comoFig) throw new Error('fig indevido no +')
    p = T.interpretarPedido('/emojimix fig 😂😭')
    if (!p.comoFig) throw new Error('fig não detectado')
    p = T.interpretarPedido('/emojimix figurinha 😂😭')
    if (!p.comoFig) throw new Error('figurinha não detectado')
  })

  await testar('extrairEmojis: colado, espaço e +', async () => {
    if ((await T.extrairEmojis('😂😭')).length < 2) throw new Error('colado falhou')
    if ((await T.extrairEmojis('😂 😭')).length < 2) throw new Error('espaço falhou')
    if ((await T.extrairEmojis('😂 + 😭')).length < 2) throw new Error('+ falhou')
    if ((await T.extrairEmojis('😂 - 😭')).length < 2) throw new Error('- falhou')
  })

  await testar('sem emoji → aviso de uso', async () => {
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsg('/emojimix'), '/emojimix')
    if (imagemDe({ enviadas })) throw new Error('gerou imagem sem emoji')
    const t = textoDe({ enviadas }).join('\n')
    if (!/como usar/i.test(t)) throw new Error('aviso inesperado: ' + t)
  })

  await testar('um emoji só → aviso de emoji inválido', async () => {
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsg('/emojimix 😂'), '/emojimix 😂')
    if (imagemDe({ enviadas })) throw new Error('gerou imagem com 1 emoji')
    const t = textoDe({ enviadas }).join('\n')
    if (!/dois emojis/i.test(t)) throw new Error('aviso inesperado: ' + t)
  })

  await testar('par válido 😂😭 → imagem PNG + thumbnail', async () => {
    T._injetar(async () => URL_FAKE, async () => PNG_FAKE)
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsg('/emojimix 😂😭'), '/emojimix 😂😭')
    const img = imagemDe({ enviadas })
    if (!img) throw new Error('imagem ausente; textos: ' + textoDe({ enviadas }).join(' | '))
    if (!Buffer.isBuffer(img.conteudo.jpegThumbnail)) throw new Error('sem jpegThumbnail (regra de ouro!)')
    if (img.conteudo.mimetype !== 'image/png') throw new Error('mimetype errado: ' + img.conteudo.mimetype)
  })

  await testar('/emojimix fig 😂😭 → figurinha webp', async () => {
    T._injetar(async () => URL_FAKE, async () => PNG_FAKE)
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsg('/emojimix fig 😂😭'), '/emojimix fig 😂😭')
    const st = stickerDe({ enviadas })
    if (!st) throw new Error('sticker ausente; textos: ' + textoDe({ enviadas }).join(' | '))
    if (st.conteudo.sticker.subarray(0, 4).toString('ascii') !== 'RIFF') throw new Error('não é webp')
  })

  await testar('sem combinação → aviso amigável', async () => {
    T._injetar(async () => null, async () => { throw new Error('não deveria baixar') })
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsg('/emojimix 🦄🍕'), '/emojimix 🦄🍕')
    if (imagemDe({ enviadas }) || stickerDe({ enviadas })) throw new Error('gerou mídia sem combinação')
    const t = textoDe({ enviadas }).join('\n')
    if (!/ainda não existe/i.test(t)) throw new Error('aviso inesperado: ' + t)
  })

  await testar('download 404 → aviso de sem combinação', async () => {
    T._injetar(async () => URL_FAKE, async () => { const e = new Error('404'); e.response = { status: 404 }; throw e })
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsg('/emojimix 😂😭'), '/emojimix 😂😭')
    const t = textoDe({ enviadas }).join('\n')
    if (!/ainda não existe/i.test(t)) throw new Error('aviso inesperado: ' + t)
  })

  await testar('falha de rede → aviso de cozinha fora do ar', async () => {
    T._injetar(async () => URL_FAKE, async () => { throw new Error('rede fora') })
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsg('/emojimix 😂😭'), '/emojimix 😂😭')
    const t = textoDe({ enviadas }).join('\n')
    if (!/fora do ar/i.test(t)) throw new Error('aviso inesperado: ' + t)
  })

  await testar('sock quebrado nunca lança', async () => {
    T._injetar(async () => URL_FAKE, async () => PNG_FAKE)
    let escapou = false
    try { await cmd.executar({ sendMessage: async () => { throw new Error('rede fora') } }, JID, criarMsg('/emojimix 😂😭'), '/emojimix 😂😭') } catch (e) { escapou = true }
    if (escapou) throw new Error('o erro escapou do executar')
  })

  T._restaurar()
  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
