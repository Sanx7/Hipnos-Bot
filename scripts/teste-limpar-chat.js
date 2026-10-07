// Offline: usa o wrapper real de envios e chaves simuladas do Baileys.
process.env.OWNER_NUMBERS = '5511999990009'
process.env.MONGODB_URI = ''
const assert = require('node:assert/strict')
const GRUPO = '123@g.us'
const OUTRO = '456@g.us'
const DONO = '5511999990009@s.whatsapp.net'
const LID = '12345@lid'
const COMUM = '5511888880000@s.whatsapp.net'
const ADMIN = '5511777770000@s.whatsapp.net'
const LID_ADMIN = '54321@lid'
const lid = require('../lid')
lid.__definirConsultaSessaoTeste(async () => null)
let testes = 0

function cenario() {
  for (const arquivo of ['../dados/mensagens-enviadas', '../comandos/menu-dono/limpar-chat']) delete require.cache[require.resolve(arquivo)]
  const historico = require('../dados/mensagens-enviadas')
  const comando = require('../comandos/menu-dono/limpar-chat')
  const envios = []
  let seq = 0
  const sock = {
    falhar: null,
    async groupMetadata() { return { participants: [{ id: LID, phoneNumber: DONO }] } },
    async sendMessage(jid, conteudo, opcoes) {
      assert.equal(this, sock)
      if (this.falhar?.(conteudo)) throw new Error('envio falhou')
      const key = { remoteJid: jid, id: String(++seq), fromMe: true }
      envios.push({ jid, conteudo, opcoes, key })
      return { key }
    }
  }
  historico.acompanharSocket(sock)
  const executar = (texto, sender = DONO, jid = GRUPO) => comando.executar(sock, jid, {
    key: { remoteJid: jid, participant: sender }, message: { conversation: texto }
  }, texto)
  const deletadas = () => envios.filter(e => e.conteudo.delete).map(e => e.conteudo.delete)
  return { sock, historico, envios, executar, deletadas }
}
async function teste(nome, fn) {
  await fn(cenario())
  testes++
  console.log(`✅ ${nome}`)
}
async function main() {
  await teste('apaga somente últimas X do bot, na ordem recente, sem afetar outro grupo', async c => {
    await c.sock.sendMessage(GRUPO, { text: '1' })
    await c.sock.sendMessage(OUTRO, { text: 'outro grupo' })
    await c.sock.sendMessage(GRUPO, { text: '2' })
    await c.sock.sendMessage(GRUPO, { video: Buffer.from('video') })
    await c.executar('/limpar-chat 2')
    assert.deepEqual(c.deletadas().map(k => k.id), ['4', '3'])
    assert.ok(c.deletadas().every(k => k.fromMe === true && k.remoteJid === GRUPO))
    assert.equal(c.historico.recentes(OUTRO, 20).length, 1)
    assert.ok(c.historico.recentes(GRUPO, 20).some(k => k.id === '1'))
  })
  await teste('membro comum bloqueado mesmo respondendo a ADM', async c => {
    await c.sock.sendMessage(GRUPO, { text: 'teste' })
    c.sock.groupMetadata = async () => ({ participants: [{ id: COMUM }, { id: ADMIN, admin: 'admin' }] })
    const comando = require('../comandos/menu-dono/limpar-chat')
    await comando.executar(c.sock, GRUPO, {
      key: { remoteJid: GRUPO, participant: COMUM },
      message: { extendedTextMessage: { text: '/limpar-chat 20', contextInfo: { participant: ADMIN, quotedMessage: { conversation: 'ADM' } } } }
    }, '/limpar-chat 20')
    assert.equal(c.deletadas().length, 0)
    assert.match(c.envios.at(-1).conteudo.text, /Só administradores/)
  })
  await teste('VIP sem ADM é bloqueado sem consultar VIP como autorização', async c => {
    const vip = require('../vip')
    const original = vip.isVip
    let consultas = 0
    vip.isVip = async () => { consultas++; return true }
    c.sock.groupMetadata = async () => ({ participants: [{ id: COMUM, vip: true }] })
    try {
      await c.executar('/limpar-chat 1', COMUM)
      assert.equal(c.deletadas().length, 0)
      assert.match(c.envios.at(-1).conteudo.text, /Só administradores/)
      assert.equal(consultas, 0, 'VIP não participa da autorização')
    } finally { vip.isVip = original }
  })
  for (const sender of [ADMIN, LID_ADMIN]) {
    await teste(`ADM ${sender.endsWith('@lid') ? 'LID' : 'JID'} permitido`, async c => {
      c.sock.groupMetadata = async () => ({ participants: [{ id: LID_ADMIN, phoneNumber: ADMIN, admin: 'admin' }] })
      await c.sock.sendMessage(GRUPO, { text: 'teste' })
      await c.executar('/limpar-chat 1', sender)
      assert.equal(c.deletadas().length, 1)
    })
  }
  await teste('ADM por LID resolvido pelo mapeamento da sessão', async c => {
    lid.__definirConsultaSessaoTeste(async id => id === '54321' ? ADMIN.split('@')[0] : null)
    c.sock.groupMetadata = async () => ({ participants: [{ id: ADMIN, admin: 'admin' }] })
    try {
      await c.sock.sendMessage(GRUPO, { text: 'teste' })
      await c.executar('/limpar-chat 1', LID_ADMIN)
      assert.equal(c.deletadas().length, 1)
    } finally { lid.__definirConsultaSessaoTeste(async () => null) }
  })
  await teste('LID cru igual ao número de ADM não autoriza', async c => {
    c.sock.groupMetadata = async () => ({ participants: [{ id: ADMIN, admin: 'admin' }] })
    await c.executar('/limpar-chat 1', `${ADMIN.split('@')[0]}@lid`)
    assert.equal(c.deletadas().length, 0)
    assert.match(c.envios.at(-1).conteudo.text, /Só administradores/)
  })
  await teste('dono via LID permitido', async c => {
    await c.sock.sendMessage(GRUPO, { text: 'teste' })
    await c.executar('/limpar-chat 1', LID)
    assert.equal(c.deletadas().length, 1)
  })
  await teste('LID não resolvido com metadata falha é recusado', async c => {
    c.sock.groupMetadata = async () => { throw new Error('metadata') }
    await c.executar('/limpar-chat 1', '99999@lid')
    assert.equal(c.deletadas().length, 0)
    assert.match(c.envios.at(-1).conteudo.text, /Só administradores/)
  })
  await teste('fora de grupo recusa', async c => {
    await c.executar('/limpar-chat 1', DONO, DONO)
    assert.match(c.envios.at(-1).conteudo.text, /em um grupo/)
    assert.equal(c.deletadas().length, 0)
  })
  await teste('quantidade ausente, inválida ou acima do limite não apaga', async c => {
    for (const arg of ['', '0', '-1', '1.5', '20 abc', '21', '100', 'abc', 'Infinity']) {
      await c.executar(`/limpar-chat ${arg}`)
      assert.match(c.envios.at(-1).conteudo.text, /entre 1 e 20/)
    }
    assert.equal(c.deletadas().length, 0)
  })
  for (const quantidade of [1, 5, 20]) {
    await teste(`${quantidade} válido e dono por JID permitido`, async c => {
      for (let i = 0; i < quantidade; i++) await c.sock.sendMessage(GRUPO, { text: 'teste' })
      await c.executar(`/limpar-chat ${quantidade}`)
      assert.equal(c.deletadas().length, quantidade)
      for (const key of c.deletadas()) assert.ok(!c.historico.recentes(GRUPO, 100).some(k => k.id === key.id))
    })
  }
  await teste('segunda execução não seleciona keys já apagadas com sucesso', async c => {
    for (let i = 0; i < 10; i++) await c.sock.sendMessage(GRUPO, { text: 'teste' })
    await c.executar('/limpar-chat 5')
    const primeiras = c.deletadas().map(k => k.id)
    assert.deepEqual(primeiras, ['10', '9', '8', '7', '6'])
    await c.executar('/limpar-chat 5')
    const seguintes = c.deletadas().slice(5).map(k => k.id)
    assert.equal(seguintes.length, 5)
    assert.ok(seguintes.every(id => !primeiras.includes(id)))
    // O aviso final também é uma mensagem do bot e participa da próxima limpeza.
    assert.deepEqual(seguintes.slice(1), ['5', '4', '3', '2'])
  })
  await teste('histórico vazio informa limitação', async c => {
    await c.executar('/limpar-chat 20')
    assert.match(c.envios.at(-1).conteudo.text, /histórico começa/)
    assert.equal(c.deletadas().length, 0)
  })
  await teste('menos mensagens que X apaga disponíveis e avisa', async c => {
    await c.sock.sendMessage(GRUPO, { text: 'teste' })
    await c.executar('/limpar-chat 20')
    assert.equal(c.deletadas().length, 1)
    assert.match(c.envios.at(-1).conteudo.text, /apenas 1/)
  })
  await teste('falha parcial mantém chave e continua demais exclusões', async c => {
    await c.sock.sendMessage(GRUPO, { text: '1' })
    await c.sock.sendMessage(GRUPO, { text: '2' })
    c.sock.falhar = conteudo => conteudo.delete?.id === '2'
    await c.executar('/limpar-chat 2')
    assert.deepEqual(c.deletadas().map(k => k.id), ['1'])
    assert.ok(c.historico.recentes(GRUPO, 20).some(k => k.id === '2'))
    assert.match(c.envios.at(-1).conteudo.text, /1 tentativa\(s\) falharam/)
  })
  await teste('wrapper ignora ações, envios falhos e chaves de outros usuários', async c => {
    for (const conteudo of [{ delete: {} }, { react: {} }, { edit: {}, text: 'edit' }, { pin: {} }]) await c.sock.sendMessage(GRUPO, conteudo)
    c.sock.falhar = () => true
    await assert.rejects(c.sock.sendMessage(GRUPO, { text: 'falha' }))
    c.sock.falhar = null
    assert.equal(c.historico.recentes(GRUPO, 100).length, 0)
    const falso = { sendMessage: async () => ({ key: { remoteJid: GRUPO, fromMe: false, id: 'outro' } }) }
    c.historico.acompanharSocket(falso)
    await falso.sendMessage(GRUPO, { text: 'outro' })
    assert.equal(c.historico.recentes(GRUPO, 100).length, 0)
  })
  await teste('wrapper idempotente e histórico limitado a 50 por grupo, isoladamente', async c => {
    c.historico.acompanharSocket(c.sock)
    for (let i = 0; i < 52; i++) await c.sock.sendMessage(GRUPO, { text: 'teste' })
    const recentes = c.historico.recentes(GRUPO, 2000)
    assert.equal(recentes.length, 50)
    assert.equal(recentes.at(-1).id, '3')
    for (let i = 0; i < 60; i++) await c.sock.sendMessage(OUTRO, { text: 'outro' })
    assert.equal(c.historico.recentes(OUTRO, 100).length, 50)
    assert.deepEqual(c.historico.recentes(GRUPO, 100), recentes)
  })
  console.log(`\n${testes} testes passaram.`)
}
main().catch(erro => { console.error(erro); process.exitCode = 1 })
