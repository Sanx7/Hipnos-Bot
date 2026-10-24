// Offline: somente arquivos temporários e FFmpeg local; sem WhatsApp/MongoDB.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
require('node:net').Socket.prototype.connect = function () { throw Error('REDE_PROIBIDA') }
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { criarEnvioAnimacoes } = require('../func/animacoes-locais')
const relacionamento = require('../dados/animacoes-relacionamentos')
const adultos = require('../dados/comandos-adulto')
const { caminhoFfmpeg } = require('../comandos/menu-utilitario/audio-extrator')
let total = 0
const temporarios = []
async function teste(nome, fn) { await fn(); total++; console.log('OK:', nome) }
async function contexto(opcoes = {}) {
  const raiz = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hipnos-teste-animacoes-')))
  const pasta = path.join(raiz, 'assets/gifs/teste')
  await fs.mkdir(pasta, { recursive: true })
  const mp4 = Buffer.alloc(32); mp4.writeUInt32BE(32); mp4.write('ftypisom', 4)
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)])
  await fs.writeFile(path.join(pasta, 'a.mp4'), mp4)
  await fs.writeFile(path.join(pasta, 'b.mp4'), mp4)
  await fs.writeFile(path.join(pasta, 'c.gif'), gif)
  const chamadas = [], envios = []
  const executar = (binario, args, opts, cb) => {
    chamadas.push({ binario, args, opts })
    const saida = args.at(-1); temporarios.push(saida)
    fs.writeFile(saida, mp4).then(() => cb(null), cb)
  }
  const helper = criarEnvioAnimacoes({ raiz, executar, ...opcoes })
  const sock = { async sendMessage(jid, conteudo, opts) {
    if (conteudo.video) assert.ok((await fs.stat(conteudo.video.url)).size > 0)
    envios.push({ jid, conteudo, opts })
    return 'entregue'
  } }
  return { raiz, pasta, mp4, chamadas, envios, helper, sock }
}
async function main() {
  await teste('inventário real: todos os 63 arquivos têm associação e todos os caminhos existem', async () => {
    const associados = new Set([...Object.values(relacionamento).flat(), ...adultos.flatMap(c => c.gifs)])
    const walk = async pasta => (await Promise.all((await fs.readdir(pasta, { withFileTypes: true })).map(async d =>
      d.isDirectory() ? walk(path.join(pasta, d.name)) : path.join(pasta, d.name).replace(/\\/g, '/')))).flat()
    const arquivos = await walk('assets/gifs')
    assert.deepEqual([...associados].sort(), arquivos.sort())
    for (const f of associados) {
      assert.ok(['.gif', '.mp4'].includes(path.extname(f)))
      assert.ok((await fs.stat(f)).size > 12)
    }
    assert.equal(relacionamento.casar.length, 4)
    assert.equal(relacionamento.aceitar.length, 3)
    assert.deepEqual(relacionamento.recusarnamoro.map(f => path.extname(f)), ['.mp4', '.gif'])
    assert.equal(adultos.length, 50)
    for (const comando of adultos) assert.equal(comando.gifs.length, 1, comando.nome)
  })
  await teste('sorteio oferece todos os candidatos com o mesmo intervalo, sem duplicar caminhos', async () => {
    for (const caminhos of [relacionamento.casar, relacionamento.aceitar, relacionamento.recusarnamoro,
      adultos.find(c => c.nome === 'esfregar').gifs, adultos.find(c => c.nome === 'pgpeito').gifs]) {
      for (let i = 0; i < caminhos.length; i++) {
        let intervalo
        const h = criarEnvioAnimacoes({ sortear: n => { intervalo = n; return i }, executar: (b, a, o, cb) => {
          const saida = a.at(-1); temporarios.push(saida)
          const buffer = Buffer.alloc(32); buffer.write('ftyp', 4)
          fs.writeFile(saida, buffer).then(() => cb(null), cb)
        } })
        const p = await h.preparar([...caminhos, caminhos[0]])
        assert.equal(intervalo, caminhos.length)
        if (caminhos[i].endsWith('.mp4')) assert.equal(p.arquivo, await fs.realpath(caminhos[i]))
        await p.limpar()
      }
    }
  })
  await teste('MP4 é enviado por caminho, com legenda, menções e resposta preservadas', async () => {
    const c = await contexto({ sortear: () => 0 }), resposta = { text: 'Mensagem original', mentions: ['111@lid'] }, opts = { quoted: { original: true } }
    assert.equal(await c.helper.enviarAnimacao(c.sock, 'grupo', ['assets/gifs/teste/a.mp4'], resposta, opts), 'entregue')
    assert.deepEqual(c.envios[0].conteudo, { video: { url: path.join(c.pasta, 'a.mp4') }, caption: resposta.text,
      mentions: resposta.mentions, mimetype: 'video/mp4', gifPlayback: true })
    assert.equal(c.envios[0].opts, opts); assert.equal(c.chamadas.length, 0)
    assert.ok(await fs.stat(path.join(c.pasta, 'a.mp4')))
  })
  await teste('GIF convertido nunca é enviado bruto e temporário existe até o fim do envio', async () => {
    const c = await contexto()
    await c.helper.enviarAnimacao(c.sock, 'grupo', ['assets/gifs/teste/c.gif'], { text: 'Legenda' }, {})
    const out = c.envios[0].conteudo.video.url
    assert.ok(out.endsWith('.mp4')); assert.notEqual(out, path.join(c.pasta, 'c.gif'))
    await assert.rejects(fs.stat(out), e => e.code === 'ENOENT')
    const { args, opts } = c.chamadas[0]
    assert.ok(args.includes('libx264') && args.includes('yuv420p'))
    assert.equal(opts.timeout, 60000); assert.equal(opts.killSignal, 'SIGKILL')
    assert.equal(args[args.indexOf('-threads') + 1], '1')
  })
  await teste('arquivos ausentes são excluídos antes do sorteio', async () => {
    const c = await contexto({ sortear: n => { assert.equal(n, 1); return 0 } })
    const p = await c.helper.preparar(['assets/gifs/teste/ausente.mp4', 'assets/gifs/teste/b.mp4'])
    assert.equal(p.arquivo, path.join(c.pasta, 'b.mp4'))
  })
  await teste('sem mídia, relacionamento preserva exatamente a mensagem de texto', async () => {
    const c = await contexto(), resposta = { text: 'Rito confirmado', mentions: ['111@lid'] }, opts = { quoted: {} }
    await c.helper.enviarAnimacao(c.sock, 'grupo', ['assets/gifs/teste/ausente.mp4'], resposta, opts)
    assert.equal(c.envios.length, 1); assert.equal(c.envios[0].conteudo, resposta); assert.equal(c.envios[0].opts, opts)
  })
  await teste('falha ou timeout da conversão nunca envia bytes GIF como MP4', async () => {
    for (const erro of [Error('DADO_SENSIVEL'), Object.assign(Error('timeout'), { killed: true })]) {
      const c = await contexto({ executar(b, a, o, cb) { temporarios.push(a.at(-1)); cb(erro) } })
      await c.helper.enviarAnimacao(c.sock, 'grupo', ['assets/gifs/teste/c.gif'], { text: 'Confirmado' }, {})
      assert.deepEqual(c.envios.map(e => e.conteudo), [{ text: 'Confirmado' }])
      await assert.rejects(c.helper.enviarAnimacao(c.sock, 'grupo', ['assets/gifs/teste/c.gif'], { text: 'Adulto' }, {}, { fallbackTexto: false }))
      assert.equal(c.envios.length, 1)
    }
  })
  await teste('falha de transporte limpa temporário e não repete envio', async () => {
    const c = await contexto(); let tentativas = 0, out
    c.sock.sendMessage = async (jid, payload) => { tentativas++; out = payload.video.url; throw Error('transporte') }
    await assert.rejects(c.helper.enviarAnimacao(c.sock, 'grupo', ['assets/gifs/teste/c.gif'], { text: 'Confirmado' }, {}))
    assert.equal(tentativas, 1); await assert.rejects(fs.stat(out), e => e.code === 'ENOENT')
  })
  await teste('cabeçalho incompatível com extensão e caminho fora de assets são recusados', async () => {
    const c = await contexto(); await fs.writeFile(path.join(c.pasta, 'falso.mp4'), Buffer.from('GIF89a0000000000000'))
    await assert.rejects(c.helper.preparar(['assets/gifs/teste/falso.mp4']))
    await assert.rejects(c.helper.preparar(['package.json', '../fora.mp4']))
    assert.equal(c.chamadas.length, 0)
  })
  await teste('concorrência não abre múltiplos conversores e a vaga volta após falha', async () => {
    let concluir
    const c = await contexto({ executar(b, a, o, cb) { temporarios.push(a.at(-1)); concluir = cb } })
    const primeiro = c.helper.preparar(['assets/gifs/teste/c.gif'])
    while (!concluir) await new Promise(resolve => setImmediate(resolve))
    await assert.rejects(c.helper.preparar(['assets/gifs/teste/c.gif']))
    concluir(Error('offline')); await assert.rejects(primeiro)
    concluir = null
    const novo = c.helper.preparar(['assets/gifs/teste/c.gif'])
    while (!concluir) await new Promise(resolve => setImmediate(resolve))
    concluir(Error('offline')); await assert.rejects(novo)
  })
  await teste('FFmpeg real converte recusarnamoro2.gif em MP4 reproduzível localmente', async () => {
    const helper = criarEnvioAnimacoes()
    const p = await helper.preparar(['assets/gifs/namoro/recusarnamoro2.gif'])
    temporarios.push(p.arquivo)
    try {
      await new Promise((resolve, reject) => execFile(caminhoFfmpeg(), ['-v', 'error', '-threads', '1', '-i', p.arquivo,
        '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-'], { timeout: 30000, maxBuffer: 65536 }, e => e ? reject(e) : resolve()))
    } finally { await p.limpar() }
  })
  for (const arquivo of temporarios) await assert.rejects(fs.stat(arquivo), e => e.code === 'ENOENT')
  console.log(`${total} testes de mídia local passaram (offline, com conversão FFmpeg local).`)
}
main().catch(e => { console.error(e); process.exitCode = 1 })
