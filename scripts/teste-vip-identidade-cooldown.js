process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { OWNER_NUMBERS } = require('../config')
const lid = require('../lid')
const vip = require('../vip')
const cooldown = require('../dados/cooldowns')
const darvip = require('../comandos/menu-vip/darvip')
const estado = require('../estado-bot')
const dono = '5511900000001'
const numero = '5511900000002'
const comum = '5511900000003'
const idLid = '777000002@lid'
const donoLid = '777000001@lid'
const grupo = '123@g.us'
const pn = n => `${n}@s.whatsapp.net`
const docs = new Map()
let falharBanco = false
const copia = d => d ? structuredClone(d) : null
const colecao = {
  async findOne({ numero }) {
    if (falharBanco) throw new Error('indisponivel no teste')
    return copia(docs.get(numero))
  },
  async updateOne({ numero }, u) {
    docs.set(numero, { ...(docs.get(numero) || u.$setOnInsert), ...u.$set })
    return { matchedCount: 1 }
  },
  async deleteOne({ numero }) { docs.delete(numero); return { deletedCount: 1 } }
}
vip.__definirColecaoTeste(colecao)
OWNER_NUMBERS.push(dono)
lid.__definirConsultaSessaoTeste(async () => null)
let participantes = []
let falharMetadata = false
let envios = []
const sock = {
  async groupMetadata() {
    if (falharMetadata) throw new Error('indisponivel no teste')
    return { participants: participantes }
  },
  async sendMessage(jid, conteudo) { envios.push(conteudo); return {} }
}
function mensagem(sender, jid = grupo, contextInfo) {
  return { key: { remoteJid: jid, ...(jid.endsWith('@g.us') ? { participant: sender } : {}) },
    message: { extendedTextMessage: { text: '/darvip', contextInfo } } }
}
async function conceder(sender, texto, contexto, jid = grupo) {
  envios = []
  await darvip.executar(sock, jid, mensagem(sender, jid, contexto), texto)
  return envios.at(-1)?.text || ''
}
// Executa o comando completo; somente transporte e conversores sao simulados.
// Nao valida codecs, rede nem o consumo de memoria dos binarios nativos.
function carregarComando(arquivo) {
  const caminho = require.resolve(arquivo)
  const req = createRequire(caminho)
  const modulo = { exports: {} }
  const exif = class { async add(b) { return b } }
  const stubs = {
    '@whiskeysockets/baileys': {
      normalizeMessageContent: m => m,
      downloadContentFromMessage: async function * () { yield Buffer.from('midia simulada') }
    },
    'wa-sticker-formatter': { Sticker: class { async toBuffer() { return Buffer.from('webp simulado') } }, StickerTypes: { CROPPED: 'cropped' } },
    'wa-sticker-formatter/dist/internal/Exif': { default: exif, Exif: exif },
    './webp-animado': { rodarExecutavel: async (_bin, args) => fs.writeFileSync(args.at(-1), 'webp simulado'), webpEhAnimado: () => false },
    '../menu-utilitario/audio-extrator': { caminhoFfmpeg: () => 'simulado', apagarComRetry: async p => fs.rmSync(p, { force: true }) }
  }
  const executar = vm.runInThisContext('(function(require,module,exports,__filename,__dirname){\n' + fs.readFileSync(caminho, 'utf8') + '\n})', { filename: caminho })
  executar(n => Object.hasOwn(stubs, n) ? stubs[n] : req(n), modulo, modulo.exports, caminho, path.dirname(caminho))
  return modulo.exports
}
const s = carregarComando('../comandos/menu-fig/sticker')
const fig = carregarComando('../comandos/menu-fig/figurinha')
async function criar(comando, sender, jid = grupo, texto = `/${comando.nome}`) {
  envios = []
  const msg = mensagem(sender, jid)
  msg.message = { imageMessage: { caption: texto } }
  await comando.executar(sock, jid, msg, texto)
  return { stickers: envios.filter(e => e.sticker).length, cooldown: envios.some(e => /Cooldown do/.test(e.text || '')) }
}
function ativo(n = numero) { docs.set(n, { numero: n, expira_em: Date.now() + 86400000, assinatura: 'teste', campoLegado: { preservar: true } }) }
let passou = 0
let falhou = 0
async function teste(nome, fn) {
  docs.clear(); cooldown.limpar(); falharBanco = false; falharMetadata = false
  participantes = [{ id: pn(dono), lid: donoLid }, { id: pn(numero), lid: idLid }]
  lid.__definirConsultaSessaoTeste(async () => null)
  try { await fn(); passou++; console.log('PASSOU: ' + nome) }
  catch (err) { falhou++; console.error('FALHOU: ' + nome + ': ' + err.message) }
}
async function main() {
  await teste('dono LID com apenas mapeamento da sessao concede VIP (mesma identidade do diagnostico)', async () => {
    participantes = []
    lid.__definirConsultaSessaoTeste(async id => id === '777000001' ? dono : null)
    assert.equal(await estado.remetenteEhDono(sock, grupo, donoLid), true)
    assert.match(await conceder(donoLid, `/darvip ${numero} 30`), /VIP OUTORGADO/)
    assert.equal(await vip.isVip(numero), true)
  })
  await teste('VIP LID separado do id=PN cria duas figurinhas sem cooldown e preserva registro', async () => {
    ativo(); const antes = copia(docs.get(numero))
    assert.deepEqual(await criar(s, idLid), { stickers: 1, cooldown: false })
    assert.deepEqual(await criar(s, idLid), { stickers: 1, cooldown: false })
    assert.equal(cooldown.cooldowns.size, 0)
    assert.deepEqual(docs.get(numero), antes)
  })
  for (const sender of [pn(dono), donoLid]) for (const privado of [false, true]) {
    await teste(`dono ${sender === donoLid ? 'LID' : 'PN'} concede no ${privado ? 'privado' : 'grupo'}`, async () => {
      lid.__definirConsultaSessaoTeste(async id => id === '777000001' ? dono : null)
      assert.match(await conceder(sender, `/darvip ${numero} 2`, undefined, privado ? sender : grupo), /VIP OUTORGADO/)
      assert.equal(await vip.isVip(numero), true)
    })
  }
  await teste('comum e LID coincidente com telefone do dono continuam bloqueados sem escrita', async () => {
    for (const sender of [pn(comum), `${dono}@lid`]) {
      assert.match(await conceder(sender, `/darvip ${numero} 30`), /só obedece aos donos/)
      assert.match(await conceder(sender, `/darvip ${numero} 30`, undefined, sender), /só obedece aos donos/)
    }
    assert.equal(docs.size, 0)
  })
  for (const tipo of ['mencao', 'reply']) for (const formato of ['idLid', 'lidSeparado']) {
    await teste(`concessao por ${tipo} com ${formato} grava telefone e preserva mencao`, async () => {
      if (formato === 'idLid') participantes = [{ id: idLid, phoneNumber: pn(numero) }]
      const contexto = tipo === 'mencao' ? { mentionedJid: [idLid] } : { participant: idLid }
      assert.match(await conceder(pn(dono), '/darvip 3', contexto), /VIP OUTORGADO/)
      assert.equal(await vip.isVip(numero), true)
      assert.deepEqual(envios.at(-1).mentions, [idLid])
      assert.equal(docs.has('777000002'), false)
    })
  }
  await teste('dias obrigatorios, limites e soma preservam campos existentes', async () => {
    ativo(); const antes = copia(docs.get(numero))
    for (const texto of [`/darvip ${numero}`, `/darvip ${numero} 0`, `/darvip ${numero} 3651`]) {
      await conceder(pn(dono), texto); assert.deepEqual(docs.get(numero), antes)
    }
    assert.match(await conceder(pn(dono), `/darvip ${numero} 2`), /VIP OUTORGADO/)
    assert.equal(docs.get(numero).expira_em, antes.expira_em + 2 * vip.DIA_EM_MS)
    assert.deepEqual(docs.get(numero).campoLegado, antes.campoLegado)
  })
  await teste('destinatario LID desconhecido e falha de identidade nao gravam', async () => {
    participantes = []
    await conceder(pn(dono), '/darvip 30', { mentionedJid: [idLid] })
    falharMetadata = true
    await conceder(donoLid, `/darvip ${numero} 30`)
    assert.equal(docs.size, 0)
  })
  for (const formato of ['PN', 'idLid', 'sessaoGrupo', 'PNprivado', 'LIDprivado']) {
    await teste(`VIP ativo repetido e expirado sem isencao: ${formato}`, async () => {
      ativo()
      if (formato === 'idLid') participantes = [{ id: idLid, phoneNumber: pn(numero) }]
      if (formato.startsWith('sessao') || formato === 'LIDprivado') {
        participantes = []; falharMetadata = true
        lid.__definirConsultaSessaoTeste(async id => id === '777000002' ? numero : null)
      }
      const sender = formato.startsWith('PN') ? pn(numero) : idLid
      const jid = formato.endsWith('privado') ? sender : grupo
      for (let i = 0; i < 3; i++) assert.deepEqual(await criar(s, sender, jid), { stickers: 1, cooldown: false })
      assert.equal(cooldown.cooldowns.size, 0)
      docs.get(numero).expira_em = Date.now() - 1
      assert.equal((await criar(s, sender, jid)).stickers, 1)
      assert.deepEqual(await criar(s, sender, jid), { stickers: 0, cooldown: true })
    })
  }
  await teste('comum mantem cooldown de 3 minutos por usuario no grupo e PV', async () => {
    assert.equal((await criar(s, pn(comum))).stickers, 1)
    assert.equal((await criar(s, pn(comum), pn(comum))).cooldown, true)
    const agora = Date.now
    Date.now = () => agora() + 180001
    try { assert.equal((await criar(s, pn(comum))).stickers, 1) } finally { Date.now = agora }
  })
  await teste('concessao ignora cooldown anterior sem apagar registro ou alterar duracao', async () => {
    assert.equal((await criar(s, idLid)).stickers, 1)
    assert.equal((await criar(s, idLid)).cooldown, true)
    await conceder(pn(dono), `/darvip ${numero} 2`)
    const antes = copia(docs.get(numero))
    for (let i = 0; i < 3; i++) assert.deepEqual(await criar(s, idLid), { stickers: 1, cooldown: false })
    assert.deepEqual(docs.get(numero), antes)
  })
  await teste('mencao e reply privados resolvem LID pela sessao; mencao tem prioridade', async () => {
    lid.__definirConsultaSessaoTeste(async id => id === '777000002' ? numero : null)
    for (const contexto of [{ mentionedJid: [idLid], participant: pn(comum) }, { participant: idLid }]) {
      assert.match(await conceder(pn(dono), `/darvip ${comum} 2`, contexto, pn(dono)), /VIP OUTORGADO/)
      assert.equal(await vip.isVip(numero), true)
      assert.equal(docs.has(comum), false)
    }
  })
  await teste('registro legado em digitos de LID permanece intacto sem migracao automatica', async () => {
    ativo('777000002'); const antes = copia(docs.get('777000002'))
    await criar(s, idLid)
    assert.deepEqual(docs.get('777000002'), antes)
    assert.equal(docs.size, 1)
  })
  await teste('falha Mongo mantem cooldown sem conceder privilegio', async () => {
    ativo(); falharBanco = true
    assert.equal((await criar(s, pn(numero))).stickers, 1)
    assert.equal((await criar(s, pn(numero))).cooldown, true)
  })
  await teste('LID nao resolvido ou ambiguo nao herda VIP de digitos coincidentes', async () => {
    ativo('777000002'); participantes = []
    assert.equal((await criar(s, idLid)).stickers, 1)
    assert.equal((await criar(s, idLid)).cooldown, true)
    cooldown.limpar(); ativo()
    participantes = [{ id: idLid, phoneNumber: pn(numero) }, { id: idLid, phoneNumber: pn(comum) }]
    assert.equal((await criar(s, idLid)).stickers, 1)
    assert.equal((await criar(s, idLid)).cooldown, true)
  })
  await teste('todos os aliases preservados e executados repetidamente por VIP', async () => {
    ativo()
    assert.deepEqual(s.aliases, ['sticker', 'stiker', 'sticker2'])
    assert.deepEqual(fig.aliases, ['fig', 'f', 'figu'])
    for (const cmd of [s, fig]) for (const nome of [cmd.nome, ...cmd.aliases]) {
      for (let i = 0; i < 2; i++) assert.equal((await criar(cmd, idLid, grupo, `/${nome}`)).stickers, 1)
    }
    assert.equal(cooldown.cooldowns.size, 0)
  })
  await teste('figurinha e fig preservam ausencia de cooldown para comuns e expirados', async () => {
    ativo(); docs.get(numero).expira_em = Date.now() - 1
    for (const sender of [pn(comum), idLid]) for (let i = 0; i < 2; i++) assert.equal((await criar(fig, sender)).stickers, 1)
  })
  console.log(`Resultado: ${passou} aprovados; ${falhou} falhas.`)
  process.exitCode = falhou ? 1 : 0
}
main().catch(err => { console.error(err); process.exitCode = 1 }).finally(() => {
  OWNER_NUMBERS.splice(OWNER_NUMBERS.lastIndexOf(dono), 1)
  lid.__definirConsultaSessaoTeste(null)
  vip.__definirColecaoTeste(null)
  cooldown.limpar()
})
