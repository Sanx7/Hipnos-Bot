// Somente instância VM, conteúdo fictício e transporte simulado. Nunca chama o bot real.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
require('node:net').Socket.prototype.connect = function () { throw Error('REDE_PROIBIDA') }
require('mongodb').MongoClient.prototype.connect = async function () { throw Error('MONGO_PROIBIDO') }
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const existe = fs.existsSync
fs.existsSync = p => path.basename(String(p)) === '.env' ? false : existe(p)
const { OWNER_NUMBERS } = require('../config')
const estado = require('../estado-bot')
const lid = require('../lid')
const originalDonos = [...OWNER_NUMBERS]
const dono = '5511999990000', comum = '5511888880000', grupo = '123@g.us'
OWNER_NUMBERS.splice(0, OWNER_NUMBERS.length, dono)
const pn = n => n + '@s.whatsapp.net'
const arquivo = path.resolve(__dirname, '../comandos/menu-dono/surpresa.js')
const fonte = fs.readFileSync(arquivo, 'utf8')
const assinatura = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
let total = 0
async function teste(nome, fn) {
  lid.__definirConsultaSessaoTeste(async () => null)
  await fn()
  total++
  console.log(`OK: verificacao tecnica ${total}`)
}
function instancia({ autorizar, leitura, enviar } = {}) {
  let verificacoes = 0, conteudos = 0, leituras = 0, avisos = 0
  const envios = []
  const sandbox = {
    module: { exports: {} }, __dirname: path.dirname(arquivo), Buffer, Set,
    console: { warn: () => { avisos++ } },
    require(nome) {
      if (nome === '../../estado-bot') return { async remetenteEhDono(...args) {
        verificacoes++
        if (autorizar) return autorizar(...args)
        const log = console.log
        try { console.log = () => {}; return await estado.remetenteEhDono(...args) }
        finally { console.log = log }
      } }
      if (nome === '../../dados/surpresa-conteudo') {
        conteudos++
        return { abertura: 'TESTE_A', carta: 'TESTE_B' }
      }
      if (nome === 'node:path') return path
      if (nome === 'node:fs/promises') return { async readFile(p) {
        leituras++
        assert.equal(p, path.resolve(__dirname, '../assets/surpresa/cartao.png'))
        return leitura ? leitura(p) : Buffer.concat([assinatura, Buffer.alloc(64)])
      } }
      throw Error('DEPENDENCIA_INESPERADA')
    }
  }
  vm.runInNewContext(fonte, sandbox, { filename: arquivo })
  const sock = {
    groupMetadata: async () => ({ participants: [
      { id: '111@lid', phoneNumber: pn(dono) },
      { id: '222@lid', phoneNumber: pn(comum), admin: 'admin' }
    ] }),
    async sendMessage(jid, payload, opcoes) {
      envios.push({ jid, payload, opcoes })
      if (enviar) return enviar(jid, payload, opcoes)
    }
  }
  const mensagem = (sender, jid = grupo) => ({ key: { remoteJid: jid, ...(jid.endsWith('@g.us') ? { participant: sender } : {}) } })
  const chamar = (sender = pn(dono), jid = grupo, msg = mensagem(sender, jid)) => sandbox.module.exports.executar(sock, jid, msg)
  return { cmd: sandbox.module.exports, sock, chamar, mensagem, envios,
    contadores: () => ({ verificacoes, conteudos, leituras, avisos }) }
}
function negado(c) {
  assert.equal(c.envios.length, 0)
  assert.equal(c.contadores().conteudos, 0)
  assert.equal(c.contadores().leituras, 0)
}
async function main() {
  await teste('carregamento isolado sem conteudo ou efeitos', () => {
    const c = instancia()
    assert.equal(c.cmd.nome, 'surpresa')
    assert.equal(c.cmd.oculto, true)
    assert.equal(c.cmd.aliases.length, 0)
    assert.equal(typeof c.cmd.executar, 'function')
    negado(c)
  })
  for (const papel of ['comum', 'admin', 'superadmin', 'vip']) {
    await teste(`nao dono: ${papel}`, async () => {
      const c = instancia()
      c.sock.groupMetadata = async () => ({ participants: [{ id: '222@lid', phoneNumber: pn(comum), admin: papel, vip: true }] })
      await c.chamar('222@lid')
      negado(c)
    })
  }
  await teste('nao dono no privado', async () => {
    const c = instancia(); await c.chamar(pn(comum), pn(comum)); negado(c)
  })
  await teste('mencao reply ou flag de privilegio nao substituem o remetente', async () => {
    const c = instancia(), msg = c.mensagem(pn(comum))
    msg.key.fromMe = true
    msg.isAdmin = true
    msg.isVip = true
    msg.message = { extendedTextMessage: { contextInfo: { mentionedJid: [pn(dono)], participant: pn(dono), quotedMessage: {} } } }
    await c.chamar(pn(comum), grupo, msg)
    negado(c)
  })
  for (const [sender, jid, sessao] of [[pn(dono), grupo], [pn(dono), pn(dono)], ['111@lid', grupo], ['333@lid', '333@lid', true]]) {
    await teste('dono comprovado em transporte simulado', async () => {
      if (sessao) lid.__definirConsultaSessaoTeste(async id => id === '333' ? dono : null)
      const c = instancia(), msg = c.mensagem(sender, jid)
      await c.chamar(sender, jid, msg)
      assert.equal(c.envios.length, 2)
      assert.equal(c.contadores().verificacoes, 1)
      assert.equal(c.contadores().conteudos, 1)
      assert.equal(c.contadores().leituras, 1)
      assert.ok(Buffer.isBuffer(c.envios[0].payload.image))
      assert.equal(c.envios[0].payload.mimetype, 'image/png')
      assert.equal(c.envios[0].payload.caption, 'TESTE_A')
      assert.equal(c.envios[1].payload.text, 'TESTE_B')
      for (const envio of c.envios) { assert.equal(envio.jid, jid); assert.equal(envio.opcoes.quoted, msg) }
    })
  }
  await teste('LID desconhecido nao compara digitos com telefone', async () => {
    const c = instancia(); await c.chamar(dono+'@lid'); negado(c)
  })
  await teste('metadados e sessao indisponiveis bloqueiam', async () => {
    lid.__definirConsultaSessaoTeste(async () => { throw Error('offline') })
    const c = instancia(); c.sock.groupMetadata = async () => { throw Error('offline') }
    // O helper legado pode registrar erros; suprimir para manter saída técnica.
    const log = console.error
    try { console.error = () => {}; await c.chamar('444@lid') } finally { console.error = log }
    negado(c)
  })
  for (const resultado of [false, undefined, null, 'true', 1]) {
    await teste('autorizacao exige booleano confirmado', async () => {
      const c = instancia({ autorizar: async () => resultado }); await c.chamar(); negado(c)
    })
  }
  await teste('erro na autorizacao bloqueia', async () => {
    const c = instancia({ autorizar: async () => { throw Error('offline') } }); await c.chamar(); negado(c)
  })
  await teste('identidade ausente ou contexto divergente bloqueia', async () => {
    const c = instancia()
    for (const msg of [{}, { key: { remoteJid: grupo } }, { key: { remoteJid: grupo, participant: grupo } }, { key: { remoteJid: 'outro@g.us', participant: pn(dono) } }]) {
      await c.chamar(pn(dono), grupo, msg)
    }
    negado(c); assert.equal(c.contadores().verificacoes, 0)
  })
  await teste('arquivo ausente nao envia e libera nova tentativa explicita', async () => {
    const c = instancia({ leitura: async () => { throw Error('offline') } })
    await c.chamar(); await c.chamar()
    assert.equal(c.envios.length, 0); assert.equal(c.contadores().leituras, 2)
  })
  await teste('arquivo invalido nao envia', async () => {
    const c = instancia({ leitura: async () => Buffer.alloc(32) }); await c.chamar(); assert.equal(c.envios.length, 0)
  })
  for (const falhaEm of [1, 2]) {
    await teste('falha de transporte nao repete envio', async () => {
      let n = 0
      const c = instancia({ enviar: async () => { if (++n === falhaEm) throw Error('offline') } })
      await c.chamar(); assert.equal(c.envios.length, falhaEm)
    })
  }
  await teste('execucoes concorrentes nao intercalam envios', async () => {
    let liberar, entrou
    const espera = new Promise(resolve => { liberar = resolve })
    const pronto = new Promise(resolve => { entrou = resolve })
    let n = 0
    const c = instancia({ enviar: async () => { if (++n === 1) { entrou(); await espera } } })
    const primeira = c.chamar(); await pronto
    await c.chamar(); assert.equal(c.envios.length, 1)
    liberar(); await primeira; assert.equal(c.envios.length, 2)
    await c.chamar(); assert.equal(c.envios.length, 4)
  })
  await teste('artefato local existe e possui formato portavel', () => {
    const bytes = fs.readFileSync(path.resolve(__dirname, '../assets/surpresa/cartao.png'))
    assert.ok(bytes.subarray(0, 8).equals(assinatura))
    assert.equal(bytes.readUInt32BE(16), 1200)
    assert.equal(bytes.readUInt32BE(20), 1600)
    assert.ok(bytes.length > 10000 && bytes.length < 2 * 1024 * 1024)
    // O conteúdo real nunca é importado nem executado pelos testes.
    assert.equal(require.cache[require.resolve('../dados/surpresa-conteudo')], undefined)
  })
  console.log(`${total} testes tecnicos passaram; sem servicos reais ou conteudo revelado.`)
}
main().catch(() => { console.error(`FALHOU: verificacao tecnica ${total+1}`); process.exitCode = 1 })
  .finally(() => { OWNER_NUMBERS.splice(0, OWNER_NUMBERS.length, ...originalDonos); lid.__definirConsultaSessaoTeste(null) })
