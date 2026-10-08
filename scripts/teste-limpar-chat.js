// Offline: usa o wrapper real de envios e chaves simuladas do Baileys.
process.env.OWNER_NUMBERS = '5511999990009'
process.env.MONGODB_URI = ''
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { proto, WAMessageStubType } = require('@whiskeysockets/baileys')
const GRUPO = '123@g.us'
const OUTRO = '456@g.us'
const DONO = '5511999990009@s.whatsapp.net'
const LID = '12345@lid'
const COMUM = '5511888880000@s.whatsapp.net'
const ADMIN = '5511777770000@s.whatsapp.net'
const LID_ADMIN = '54321@lid'
const BOT = '5511666660000@s.whatsapp.net'
const BOT_LID = '66666@lid'
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
    ev: new EventEmitter(), user: { id: BOT, lid: BOT_LID },
    confirmarExclusoes: true,
    falhar: null,
    async groupMetadata() { return { participants: [{ id: LID, phoneNumber: DONO }, { id: BOT_LID, phoneNumber: BOT, admin: 'admin' }] } },
    async sendMessage(jid, conteudo, opcoes) {
      assert.equal(this, sock)
      if (this.falhar?.(conteudo)) throw new Error('envio falhou')
      const key = { remoteJid: jid, id: String(++seq), fromMe: true }
      envios.push({ jid, conteudo, opcoes, key })
      if (conteudo.delete && this.confirmarExclusoes) {
        this.ev.emit('messages.update', [{ key: conteudo.delete, update: { message: null, messageStubType: WAMessageStubType.REVOKE } }])
      }
      return { key }
    }
  }
  historico.acompanharSocket(sock)
  const executar = (texto, sender = DONO, jid = GRUPO, id = 'pedido') => comando.executar(sock, jid, {
    key: { remoteJid: jid, participant: sender, id, fromMe: false }, message: { conversation: texto }
  }, texto)
  const deletadas = () => envios.filter(e => e.conteudo.delete).map(e => e.conteudo.delete)
  const receber = (id, participant = COMUM, message = { conversation: 'recebida' }, remoteJid = GRUPO, extras = {}) => {
    const msg = { key: { remoteJid, participant, id, fromMe: false }, message, ...extras }
    sock.ev.emit('messages.upsert', { type: 'notify', messages: [msg] })
    return msg
  }
  return { sock, historico, envios, executar, deletadas, receber }
}
async function teste(nome, fn) {
  await fn(cenario())
  testes++
  console.log(`✅ ${nome}`)
}
async function main() {
  await teste('exclui últimas X do bot, na ordem recente, sem afetar outro grupo', async c => {
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
    assert.match(c.envios.at(-1).conteudo.text, /Falhas: 1/)
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
  await teste('exclusão de terceiro preserva key, fromMe false e participant LID', async c => {
    const recebida = c.receber('alvo-lid', '98765@lid')
    await c.executar('/limpar-chat 1')
    assert.deepEqual(c.deletadas(), [recebida.key])
    assert.equal(c.deletadas()[0].participant, '98765@lid')
    assert.equal(c.deletadas()[0].fromMe, false)
  })
  await teste('histórico misto segue a ordem mais recente, independente do autor', async c => {
    c.receber('joao'); c.receber('maria', ADMIN)
    const enviada = await c.sock.sendMessage(GRUPO, { text: 'Bem-vindos' })
    c.receber('pedro', LID_ADMIN); c.receber('ana', LID)
    await c.executar('/limpar-chat 3')
    assert.deepEqual(c.deletadas().map(k => k.id), ['ana', 'pedro', enviada.key.id])
    assert.deepEqual(c.deletadas().map(k => k.fromMe), [false, false, true])
    assert.match(c.envios.at(-1).conteudo.text, /Solicitadas: 3\n✅ Exclusões enviadas: 3\n⚠️ Falhas: 0/)
  })
  await teste('limite de 20 vale também para mensagens de participantes', async c => {
    for (let i = 1; i <= 25; i++) c.receber(`recebida-${i}`)
    await c.executar('/limpar-chat 20')
    assert.equal(c.deletadas().length, 20)
    assert.equal(c.deletadas()[0].id, 'recebida-25')
    assert.equal(c.deletadas().at(-1).id, 'recebida-6')
  })
  await teste('histórico misto mantém no máximo 50 por grupo e guarda só metadados', async c => {
    for (let i = 0; i < 60; i++) {
      if (i % 2) await c.sock.sendMessage(GRUPO, { image: Buffer.from('não guardar') })
      else c.receber(`r-${i}`, COMUM, { audioMessage: { url: 'não guardar' } })
    }
    const guardadas = c.historico.recentes(GRUPO, 100)
    assert.equal(guardadas.length, 50)
    for (const key of guardadas) assert.ok(Object.keys(key).every(campo => ['id', 'remoteJid', 'fromMe', 'participant'].includes(campo)))
    assert.equal(guardadas.at(-1).id, 'r-10')
  })
  await teste('mensagens recebidas de outros grupos e privadas são isoladas', async c => {
    c.receber('a'); c.receber('b', COMUM, { conversation: 'grupo diferente' }, OUTRO)
    c.receber('privado', COMUM, { conversation: 'privado' }, COMUM)
    await c.executar('/limpar-chat 20')
    assert.deepEqual(c.deletadas().map(k => k.id), ['a'])
    assert.equal(c.historico.recentes(OUTRO, 20)[0].id, 'b')
    assert.equal(c.historico.recentes(COMUM, 20).length, 0)
  })
  await teste('mensagens duplicadas recebidas e eco dos envios não duplicam keys', async c => {
    c.receber('duplicada'); c.receber('duplicada')
    const enviada = await c.sock.sendMessage(GRUPO, { text: 'bot' })
    c.sock.ev.emit('messages.upsert', { messages: [{ key: enviada.key, message: { conversation: 'eco' } }] })
    assert.equal(c.historico.recentes(GRUPO, 20).length, 2)
    await c.executar('/limpar-chat 20')
    assert.equal(c.deletadas().length, 2)
  })
  await teste('bot sem ADM bloqueia limpeza com mensagens de terceiros', async c => {
    c.receber('alvo')
    c.sock.groupMetadata = async () => ({ participants: [{ id: BOT_LID, phoneNumber: BOT }, { id: ADMIN, admin: 'admin' }] })
    await c.executar('/limpar-chat 1')
    assert.equal(c.deletadas().length, 0)
    assert.equal(c.envios.at(-1).conteudo.text, '⚠️ Preciso ser administrador do grupo para apagar mensagens de outros participantes.')
    assert.ok(c.historico.recentes(GRUPO, 20).some(k => k.id === 'alvo'))
  })
  await teste('bot sem ADM continua podendo excluir seus próprios envios', async c => {
    await c.sock.sendMessage(GRUPO, { text: 'bot' })
    c.sock.groupMetadata = async () => ({ participants: [] })
    await c.executar('/limpar-chat 1')
    assert.equal(c.deletadas().length, 1)
  })
  await teste('prova de ADM do bot funciona só com sock.user.lid e metadata PN', async c => {
    c.sock.user = { id: BOT_LID }
    c.sock.groupMetadata = async () => ({ participants: [{ id: BOT, lid: BOT_LID, admin: 'superadmin' }] })
    c.receber('alvo'); await c.executar('/limpar-chat 1')
    assert.equal(c.deletadas().length, 1)
  })
  await teste('falha de metadata não concede ADM ao bot para terceiros', async c => {
    c.receber('alvo')
    c.sock.groupMetadata = async () => { throw new Error('offline') }
    await c.executar('/limpar-chat 1')
    assert.equal(c.deletadas().length, 0)
    assert.match(c.envios.at(-1).conteudo.text, /Preciso ser administrador/)
  })
  await teste('dígitos de LID de outro ADM não são prova de ADM do bot', async c => {
    c.sock.user = { id: BOT }
    c.sock.groupMetadata = async () => ({ participants: [{ id: `${BOT.split('@')[0]}@lid`, phoneNumber: ADMIN, admin: 'admin' }] })
    c.receber('alvo'); await c.executar('/limpar-chat 1')
    assert.equal(c.deletadas().length, 0)
  })
  await teste('mensagens de sistema, reações e protocolos não viram alvos', async c => {
    c.receber('stub', COMUM, { conversation: 'sistema' }, GRUPO, { messageStubType: 27 })
    c.receber('protocolo', COMUM, { protocolMessage: { type: proto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING } })
    c.receber('reacao', COMUM, { reactionMessage: { text: '👍' } })
    c.receber('chaves', COMUM, { senderKeyDistributionMessage: {} })
    c.receber('sem-participant', '', { conversation: 'não identificável' })
    c.receber('sem-conteudo', COMUM, undefined, GRUPO, { message: null })
    assert.equal(c.historico.recentes(GRUPO, 100).length, 0)
  })
  await teste('mensagem temporária normal é capturada sem guardar conteúdo', async c => {
    c.receber('efemera', COMUM, { ephemeralMessage: { message: { conversation: 'normal' } } })
    assert.equal(c.historico.recentes(GRUPO, 20)[0].id, 'efemera')
  })
  await teste('evento de exclusão remove alvo confirmado e não vira novo registro', async c => {
    c.receber('alvo')
    c.receber('revogacao', ADMIN, { protocolMessage: { type: proto.Message.ProtocolMessage.Type.REVOKE, key: { remoteJid: GRUPO, id: 'alvo' } } })
    assert.equal(c.historico.recentes(GRUPO, 20).length, 0)
  })
  await teste('aceitação do envio não equivale a revogação confirmada', async c => {
    c.sock.confirmarExclusoes = false
    c.receber('alvo'); await c.executar('/limpar-chat 1')
    const key = { remoteJid: GRUPO, id: 'alvo' }
    assert.equal(c.historico.recentes(GRUPO, 20).some(k => k.id === 'alvo'), false, 'solicitação não deve ser repetida')
    c.receber('alvo')
    assert.equal(c.historico.recentes(GRUPO, 20).some(k => k.id === 'alvo'), false, 'eco não confirma exclusão nem libera reenvio')
    c.sock.ev.emit('messages.update', [{ key, update: { messageStubType: WAMessageStubType.REVOKE, message: null } }])
    c.sock.ev.emit('messages.upsert', { messages: [{ key: { ...key, fromMe: false, participant: COMUM }, message: { conversation: 'registro após remoção confirmada' } }] })
    assert.ok(c.historico.recentes(GRUPO, 20).some(k => k.id === 'alvo'), 'registro pode reaparecer somente após remoção da key confirmada')
    assert.match(c.envios.find(e => e.conteudo.text?.includes('LIMPEZA DO CHAT')).conteudo.text, /Exclusões enviadas: 1/)
  })
  await teste('messages.delete remove somente keys do grupo correspondente', async c => {
    c.receber('igual'); c.receber('igual', COMUM, { conversation: 'outro' }, OUTRO)
    c.sock.ev.emit('messages.delete', { keys: [{ remoteJid: GRUPO, id: 'igual' }] })
    assert.equal(c.historico.recentes(GRUPO, 20).length, 0)
    assert.equal(c.historico.recentes(OUTRO, 20).length, 1)
  })
  await teste('solicitação não seleciona a si mesma nem itens posteriores do mesmo lote', async c => {
    const antes = { key: { remoteJid: GRUPO, id: 'antes', fromMe: false, participant: COMUM }, message: { conversation: 'antes' } }
    const pedido = { key: { remoteJid: GRUPO, id: 'pedido', fromMe: false, participant: DONO }, message: { conversation: '/limpar-chat 20' } }
    const depois = { key: { remoteJid: GRUPO, id: 'depois', fromMe: false, participant: ADMIN }, message: { conversation: 'depois' } }
    c.sock.ev.emit('messages.upsert', { messages: [antes, pedido, depois] })
    await c.executar('/limpar-chat 20')
    assert.deepEqual(c.deletadas().map(k => k.id), ['antes'])
  })
  await teste('lote acima de 50 não inclui mensagens posteriores se a key do pedido foi evictada', async c => {
    const pedido = { key: { remoteJid: GRUPO, id: 'pedido-grande', fromMe: false, participant: DONO }, message: { conversation: '/limpar-chat 20' } }
    const posteriores = Array.from({ length: 51 }, (_, i) => ({
      key: { remoteJid: GRUPO, id: `depois-${i}`, fromMe: false, participant: COMUM },
      message: { conversation: 'posterior' }
    }))
    c.receber('anterior')
    c.sock.ev.emit('messages.upsert', { messages: [pedido, ...posteriores] })
    await require('../comandos/menu-dono/limpar-chat').executar(c.sock, GRUPO, pedido, '/limpar-chat 20')
    assert.equal(c.deletadas().length, 0)
    assert.ok(c.historico.recentes(GRUPO, 100).some(k => k.id === 'depois-50'))
  })
  await teste('mensagens recebidas e enviadas durante autorização não entram no snapshot', async c => {
    c.receber('antes')
    let liberar, sinalizar
    const consultando = new Promise(resolve => { sinalizar = resolve })
    c.sock.groupMetadata = async () => { sinalizar(); return new Promise(resolve => { liberar = resolve }) }
    const limpeza = c.executar('/limpar-chat 20')
    await consultando
    c.receber('durante'); await c.sock.sendMessage(GRUPO, { text: 'bot durante' })
    liberar({ participants: [{ id: BOT, admin: 'admin' }] })
    await limpeza
    assert.deepEqual(c.deletadas().map(k => k.id), ['antes'])
  })
  await teste('falhas parciais em terceiros preservam apenas a key que falhou', async c => {
    c.receber('a'); c.receber('b'); c.receber('c')
    c.sock.falhar = conteudo => conteudo.delete?.id === 'b'
    await c.executar('/limpar-chat 3')
    assert.deepEqual(c.deletadas().map(k => k.id), ['c', 'a'])
    assert.ok(c.historico.recentes(GRUPO, 20).some(k => k.id === 'b'))
    assert.match(c.envios.at(-1).conteudo.text, /Exclusões enviadas: 2\n⚠️ Falhas: 1/)
  })
  await teste('histórico em RAM desaparece ao recarregar o módulo', async c => {
    c.receber('antes-reinicio')
    delete require.cache[require.resolve('../dados/mensagens-enviadas')]
    assert.equal(require('../dados/mensagens-enviadas').recentes(GRUPO, 20).length, 0)
  })
  console.log(`\n${testes} testes passaram.`)
}
main().catch(erro => { console.error(erro); process.exitCode = 1 })
