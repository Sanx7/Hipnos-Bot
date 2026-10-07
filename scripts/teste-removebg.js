// Offline: API/download simulados, thumbnail real via FFmpeg em processo filho.
process.env.REMOVEBG_API_KEY = 'chave-ficticia-de-teste'
process.env.MONGODB_URI = ''
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const { Jimp, JimpMime } = require('jimp')
const baileysPath = require.resolve('@whiskeysockets/baileys')
const baileys = require(baileysPath)
let png
let falharDownload = false
let downloads = []
require.cache[baileysPath].exports = { ...baileys, downloadMediaMessage: async (...args) => {
  downloads.push(args)
  if (falharDownload) throw new Error('mídia expirada')
  return png
} }
const comando = require('../comandos/menu-principal/removebg')
const fetchOriginal = global.fetch
const GRUPO = '123@g.us'
const AUTOR = '5511999990000@s.whatsapp.net'
const ALVO = '5511888880000@s.whatsapp.net'
let passou = 0

function msg(quoted, mentionedJid) {
  return { key: { remoteJid: GRUPO, participant: AUTOR }, message: {
    extendedTextMessage: { text: '/removebg', contextInfo: {
      quotedMessage: quoted, mentionedJid, stanzaId: 'ORIGINAL', participant: ALVO
    } }
  } }
}
async function executar(message, opcoes = {}) {
  const envios = []
  const perfis = []
  const chamadas = []
  downloads = []
  falharDownload = opcoes.falharDownload || false
  global.fetch = async (url, argumentos) => {
    chamadas.push({ url, argumentos })
    if (url === 'https://api.remove.bg/v1.0/removebg') {
      assert.equal(argumentos.method, 'POST')
      assert.deepEqual(argumentos.headers, { 'X-Api-Key': 'chave-ficticia-de-teste' })
      assert.ok(argumentos.signal instanceof AbortSignal)
      assert.ok(argumentos.body instanceof FormData)
      assert.ok(argumentos.body.get('image_file') instanceof Blob)
      assert.equal(argumentos.body.get('format'), 'png')
      assert.equal(argumentos.body.get('size'), 'preview')
      if (opcoes.timeout) { const erro = new Error('timeout'); erro.name = 'TimeoutError'; throw erro }
      return new Response(opcoes.corpo || png, { status: opcoes.status || 200, headers: { 'Content-Type': opcoes.tipo || 'image/png' } })
    }
    assert.equal(url, 'https://exemplo.test/perfil.jpg')
    return new Response(png, { headers: { 'Content-Type': opcoes.tipoPerfil || 'image/png' } })
  }
  const sock = {
    async groupMetadata() { return { participants: [{ id: '12345@lid', phoneNumber: ALVO }] } },
    async profilePictureUrl(jid, tamanho) {
      perfis.push(jid)
      assert.equal(tamanho, 'image')
      if (opcoes.semFoto) throw new Error('foto privada')
      return 'https://exemplo.test/perfil.jpg'
    },
    async sendMessage(jid, conteudo) {
      if (opcoes.falharEnvio) throw new Error('envio falhou')
      envios.push(conteudo)
    }
  }
  const temporariosAntes = (await fs.readdir(os.tmpdir())).filter(n => n.startsWith('hipnos-removebg-')).sort()
  await comando.executar(sock, GRUPO, message)
  const temporariosDepois = (await fs.readdir(os.tmpdir())).filter(n => n.startsWith('hipnos-removebg-')).sort()
  assert.deepEqual(temporariosDepois, temporariosAntes, 'limpa arquivos temporários inclusive após falha')
  return { envios, perfis, chamadas }
}
async function sucesso(resultado) {
  assert.equal(resultado.envios.length, 1)
  const conteudo = resultado.envios[0]
  assert.deepEqual(conteudo.image, png)
  assert.equal(conteudo.mimetype, 'image/png')
  assert.ok(Buffer.isBuffer(conteudo.jpegThumbnail))
  assert.equal(conteudo.jpegThumbnail[0], 0xff)
  assert.equal(conteudo.jpegThumbnail[1], 0xd8)
  const jpeg = await Jimp.read(conteudo.jpegThumbnail)
  assert.equal(jpeg.bitmap.width, 64, 'thumbnail gerada pelo FFmpeg')
  const imagem = await Jimp.read(conteudo.image)
  assert.equal(imagem.bitmap.data[3], 0, 'PNG transparente permanece intacto')
}
async function testar(nome, fn) { await fn(); passou++; console.log(`✅ ${nome}`) }
async function main() {
  png = await new Jimp({ width: 16, height: 16, color: 0x00000000 }).getBuffer(JimpMime.png)
  const imagem = { imageMessage: { mimetype: 'image/png' } }
  await testar('imagem citada: multipart, PNG transparente, thumbnail FFmpeg e limpeza', async () => {
    const r = await executar(msg(imagem, [ALVO]))
    await sucesso(r)
    assert.deepEqual(r.perfis, [])
    assert.equal(downloads.length, 1)
    assert.equal(downloads[0][0].key.id, 'ORIGINAL')
    assert.equal(downloads[0][0].message, imagem)
  })
  await testar('imagem citada temporária é normalizada', async () => {
    await sucesso(await executar(msg({ ephemeralMessage: { message: imagem } })))
  })
  await testar('sem reply/menção usa foto do autor', async () => {
    const r = await executar(msg())
    await sucesso(r)
    assert.deepEqual(r.perfis, [AUTOR])
  })
  await testar('menção por LID usa foto do participante resolvido', async () => {
    const r = await executar(msg(undefined, ['12345@lid']))
    await sucesso(r)
    assert.deepEqual(r.perfis, [ALVO])
  })
  await testar('reply sem imagem usa foto do executor, não do autor citado', async () => {
    const r = await executar(msg({ conversation: 'não é imagem' }))
    await sucesso(r)
    assert.deepEqual(r.perfis, [AUTOR])
  })
  await testar('key ausente avisa e não chama API', async () => {
    process.env.REMOVEBG_API_KEY = ''
    try {
      const r = await executar(msg(imagem))
      assert.match(r.envios[0].text, /configurar REMOVEBG_API_KEY/)
      assert.equal(r.chamadas.length, 0)
    } finally { process.env.REMOVEBG_API_KEY = 'chave-ficticia-de-teste' }
  })
  for (const [status, regex] of [[402, /Limite mensal.*próximo mês/], [400, /foto válida/], [401, /chave.*recusada/], [429, /Muitas solicitações/], [500, /indisponível/]]) {
    await testar(`erro HTTP ${status} gera aviso amigável`, async () => {
      const r = await executar(msg(imagem), { status })
      assert.equal(r.envios.length, 1)
      assert.match(r.envios[0].text, regex)
      assert.equal(r.envios[0].image, undefined)
    })
  }
  await testar('timeout tratado', async () => assert.match((await executar(msg(imagem), { timeout: true })).envios[0].text, /demorou demais/))
  await testar('resposta JSON em vez de imagem é recusada', async () => {
    assert.match((await executar(msg(imagem), { tipo: 'application/json', corpo: '{"erro":true}' })).envios[0].text, /PNG válida/)
  })
  await testar('PNG com conteúdo inválido é recusado', async () => {
    assert.match((await executar(msg(imagem), { corpo: 'não é PNG' })).envios[0].text, /PNG válida/)
  })
  await testar('foto privada/ausente avisa sem chamar API', async () => {
    const r = await executar(msg(), { semFoto: true })
    assert.match(r.envios[0].text, /foto de perfil/)
    assert.equal(r.chamadas.length, 0)
  })
  await testar('download de perfil retorna HTML: recusa', async () => {
    assert.match((await executar(msg(), { tipoPerfil: 'text/html' })).envios[0].text, /imagem válida/)
  })
  await testar('falha ao baixar imagem citada é tratada', async () => {
    const r = await executar(msg(imagem), { falharDownload: true })
    assert.match(r.envios[0].text, /Não consegui remover/)
    assert.equal(r.chamadas.length, 0)
  })
  await testar('falha de envio não escapa e limpa temporários', async () => {
    assert.deepEqual((await executar(msg(imagem), { falharEnvio: true })).envios, [])
  })
  console.log(`\n${passou} testes passaram.`)
}
main().catch(erro => { console.error(erro); process.exitCode = 1 }).finally(() => {
  global.fetch = fetchOriginal
  require.cache[baileysPath].exports = baileys
})
