process.env.OWNER_NUMBERS = '5511999990009'
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { createHash } = require('node:crypto')
const fake = require('./helpers/colecao-figurinhas-fake')
const regras = require('../dados/figurinhas-regras')
const mod = require('../dados/moderacao-figurinhas')
const comandos = require('../comandos/admin/figurinhas-moderacao')
const advertencias = require('../advertencias')
const ban = require('../comandos/admin/ban')
const lid = require('../lid')
const G = '123@g.us', H = '456@g.us'
const PN = n => `${n}@s.whatsapp.net`
const BOT = PN('5511666660000'), DONO = PN('5511999990009'), ADM = PN('5511777770000'), COMUM = PN('5511888880000')
const bytes = Buffer.from('webp figurinha idêntica')
const hash = createHash('sha256').update(bytes).digest('hex')
let total = 0
function cenario() {
  const mongo = { regras: fake(), ocorrencias: fake() }, advs = fake()
  regras.__definirColecoesTeste(mongo)
  advertencias.__definirColecaoTeste(advs)
  lid.__definirConsultaSessaoTeste(async () => null)
  let baixadas = 0, serial = 0
  mod.__definirDownloadTeste(async (msg, tipo) => {
    baixadas++
    assert.equal(tipo, 'stream')
    if (msg.message?.stickerMessage?.erro) throw new Error('Download falhou')
    return Readable.from([msg.message?.stickerMessage?.bytes || bytes])
  })
  const envios = [], removidos = [], blacklist = []
  ban.__definirGravacaoBlacklistTeste(n => blacklist.push(n))
  const sock = {
    user: { id: BOT, lid: '666@lid' },
    participantes: [{ id: BOT, lid: '666@lid', admin: 'admin' }, { id: ADM, admin: 'admin' }, { id: DONO }, { id: COMUM }],
    async groupMetadata() { if (this.erroMetadata) throw new Error('metadata'); return { participants: this.participantes } },
    async sendMessage(jid, conteudo) { if (this.erroEnvio) throw new Error('envio'); envios.push({ jid, ...conteudo }); if (conteudo.delete) this.aoDeletar?.(); return { key: { id: 'envio' } } },
    async groupParticipantsUpdate(jid, alvos, acao) { removidos.push({ jid, alvos, acao }); if (this.erroRemocao) throw new Error('remoção'); return alvos.map(jid => ({ jid, status: this.statusRemocao || '200' })) }
  }
  function msg(sender = COMUM, jid = G, midia = {}) { return { key: { remoteJid: jid, id: `msg-${++serial}`, participant: sender, fromMe: false }, message: { stickerMessage: midia } } }
  async function executar(nome, sender = ADM, jid = G, quoted = { stickerMessage: {} }, text) {
    return comandos.find(c => c.nome === nome).executar(sock, jid, {
      key: { remoteJid: jid, id: `cmd-${++serial}`, participant: sender },
      message: { extendedTextMessage: { text: `/${nome}`, contextInfo: { quotedMessage: quoted, stanzaId: `orig-${serial}`, participant: COMUM } } }
    }, text)
  }
  return { mongo, advs, sock, envios, removidos, blacklist, msg, executar, get baixadas() { return baixadas } }
}
async function teste(nome, fn) { await fn(cenario()); total++; console.log(`✅ ${nome}`) }
async function main() {
  await teste('sete comandos exportados', async () => assert.deepEqual(comandos.map(c => c.nome), ['figban','figadv','figdel','delfigban','delfigadv','delfigdel','figlistanegra']))
  for (const acao of ['ban', 'adv', 'del']) {
    await teste(`cadastro e remoção de ${acao} por reply`, async c => {
      await c.executar(`fig${acao}`)
      assert.equal(await regras.consultar(G, hash), acao)
      assert.equal(c.mongo.regras.docs.length, 1)
      assert.ok(!Object.keys(c.mongo.regras.docs[0]).includes('bytes'))
      await c.executar(`delfig${acao}`)
      assert.equal(await regras.consultar(G, hash), null)
    })
  }
  await teste('regra nova substitui a anterior explicitamente', async c => {
    await c.executar('figban'); await c.executar('figadv')
    assert.equal(c.mongo.regras.docs.length, 1)
    assert.equal(await regras.consultar(G, hash), 'adv')
    assert.match(c.envios.at(-1).text, /banimento foi substituída/)
    await c.executar('delfigban')
    assert.equal(await regras.consultar(G, hash), 'adv')
  })
  await teste('listagem isolada, sem baixar mídia', async c => {
    await regras.cadastrar(G, hash, 'del', ADM)
    await regras.cadastrar(H, 'a'.repeat(64), 'ban', ADM)
    await c.executar('figlistanegra')
    assert.match(c.envios.at(-1).text, /exclusão/)
    assert.ok(c.envios.at(-1).text.includes(hash))
    assert.ok(!c.envios.at(-1).text.includes('a'.repeat(64)))
    assert.equal(c.baixadas, 0)
  })
  await teste('listagem paginada em 20 regras', async c => {
    for (let i = 0; i < 22; i++) await regras.cadastrar(G, i.toString(16).padStart(64, '0'), 'del', ADM)
    await c.executar('figlistanegra')
    assert.match(c.envios.at(-1).text, /Próxima: \/figlistanegra 2/)
    await c.executar('figlistanegra', ADM, G, null, '/figlistanegra 2')
    assert.match(c.envios.at(-1).text, /21\. exclusão/)
    assert.ok(!c.envios.at(-1).text.includes('Próxima'))
  })
  await teste('persistência após recarregar módulo e isolamento entre grupos', async c => {
    await regras.cadastrar(G, hash, 'del', ADM)
    delete require.cache[require.resolve('../dados/figurinhas-regras')]
    const reiniciado = require('../dados/figurinhas-regras')
    reiniciado.__definirColecoesTeste(c.mongo)
    assert.equal(await reiniciado.consultar(G, hash), 'del')
    assert.equal(await reiniciado.consultar(H, hash), null)
  })
  await teste('hash dos bytes reconhece reenvio e muda em arquivo modificado', async c => {
    const a = await mod.calcularHash(c.msg())
    assert.equal(a, await mod.calcularHash(c.msg(ADM)))
    assert.notEqual(a, await mod.calcularHash(c.msg(COMUM, G, { bytes: Buffer.from('modificado') })))
  })
  await teste('hash em ephemeral e view-once normalizados', async c => {
    const m = c.msg(); m.message = { ephemeralMessage: { message: { viewOnceMessageV2: { message: m.message } } } }
    assert.equal(await mod.calcularHash(m), hash)
  })
  for (const sender of [ADM, DONO]) await teste(`cadastro permitido para ${sender}`, async c => { await c.executar('figdel', sender); assert.equal(c.mongo.regras.docs.length, 1) })
  await teste('membro comum e VIP sem ADM bloqueados antes do download', async c => {
    const vip = require('../vip'), original = vip.isVip
    vip.isVip = async () => { throw new Error('VIP não deve ser consultado') }
    try { await c.executar('figdel', COMUM); assert.equal(c.baixadas, 0); assert.equal(c.mongo.regras.docs.length, 0); assert.match(c.envios.at(-1).text, /Só administradores/) }
    finally { vip.isVip = original }
  })
  await teste('ADM por LID e dono por LID gerenciam regras', async c => {
    c.sock.participantes.push({ id: '777@lid', phoneNumber: ADM, admin: 'admin' }, { id: '999@lid', phoneNumber: DONO })
    await c.executar('figdel', '777@lid'); await c.executar('figban', '999@lid')
    assert.equal(await regras.consultar(G, hash), 'ban')
  })
  await teste('LID com dígitos de ADM/dono não autoriza', async c => {
    for (const pn of [ADM, DONO]) await c.executar('figdel', `${pn.split('@')[0]}@lid`)
    assert.equal(c.mongo.regras.docs.length, 0); assert.equal(c.baixadas, 0)
  })
  await teste('uso privado e reply incorreto recusados', async c => {
    await c.executar('figdel', ADM, COMUM)
    await c.executar('figdel', ADM, G, { imageMessage: {} })
    assert.equal(c.baixadas, 0); assert.equal(c.mongo.regras.docs.length, 0)
  })
  await teste('falha de metadados não autoriza nem baixa', async c => {
    c.sock.erroMetadata = true; await c.executar('figdel', DONO)
    assert.equal(c.baixadas, 0); assert.equal(c.mongo.regras.docs.length, 0)
  })
  await teste('figdel exclui apenas a figurinha e preserva key LID', async c => {
    c.sock.participantes.push({ id: '888@lid', phoneNumber: COMUM })
    await regras.cadastrar(G, hash, 'del', ADM)
    const m = c.msg('888@lid'); await mod.processar(c.sock, m)
    assert.deepEqual(c.envios[0].delete, m.key)
    assert.equal(c.advs.docs.length, 0); assert.equal(c.removidos.length, 0)
  })
  await teste('figban exclui e remove apenas do grupo correspondente', async c => {
    await regras.cadastrar(G, hash, 'ban', ADM)
    await mod.processar(c.sock, c.msg(COMUM, H))
    assert.equal(c.envios.length, 0)
    await mod.processar(c.sock, c.msg())
    assert.equal(c.removidos.length, 1)
    assert.deepEqual(c.removidos[0], { jid: G, alvos: [COMUM], acao: 'remove' })
    assert.equal(c.blacklist.length, 0)
  })
  await teste('figadv usa contador e mensagem existentes', async c => {
    await regras.cadastrar(G, hash, 'adv', ADM)
    await mod.processar(c.sock, c.msg())
    assert.equal(c.advs.docs[0].numero, COMUM.split('@')[0]); assert.equal(c.advs.docs[0].grupo_id, G)
    assert.match(c.envios.at(-1).text, /ADVERTÊNCIA APLICADA.*|Advertências ativas: \*1\/3\*/)
    assert.equal(c.removidos.length, 0)
  })
  await teste('terceira advertência reutiliza ban e arquivamento existentes', async c => {
    await regras.cadastrar(G, hash, 'adv', ADM)
    for (let i = 0; i < 3; i++) await mod.processar(c.sock, c.msg())
    assert.equal(c.removidos.length, 1); assert.equal(c.blacklist.length, 1)
    assert.equal(c.advs.docs.filter(d => d.ativa).length, 0)
  })
  await teste('terceira advertência com status 403 não arquiva nem anuncia ban', async c => {
    await regras.cadastrar(G, hash, 'adv', ADM); c.sock.statusRemocao = '403'
    for (let i = 0; i < 3; i++) await mod.processar(c.sock, c.msg())
    assert.equal(c.advs.docs.filter(d => d.ativa).length, 3)
    assert.ok(c.envios.every(e => !e.text?.includes('BANIDO POR')))
    assert.match(c.envios.at(-1).text, /WhatsApp recusou/)
  })
  await teste('promoção ao ler motivos da terceira advertência impede blacklist e expulsão', async c => {
    await regras.cadastrar(G, hash, 'adv', ADM)
    for (let i = 0; i < 2; i++) await mod.processar(c.sock, c.msg())
    const find = c.advs.find
    c.advs.find = filtro => { c.sock.participantes.find(p => p.id === COMUM).admin = 'admin'; return find(filtro) }
    await mod.processar(c.sock, c.msg())
    assert.equal(c.removidos.length, 0); assert.equal(c.blacklist.length, 0)
  })
  await teste('ADM LID resolvido pela sessão cadastra sem confundir namespaces', async c => {
    lid.__definirConsultaSessaoTeste(async id => id === '77777' ? ADM.split('@')[0] : null)
    await c.executar('figdel', '77777@lid')
    assert.equal(await regras.consultar(G, hash), 'del')
  })
  await teste('dono LID protegido nas regras de advertência e banimento', async c => {
    c.sock.participantes.push({ id: '999@lid', phoneNumber: DONO })
    for (const acao of ['adv', 'ban']) {
      await regras.cadastrar(G, hash, acao, ADM); await mod.processar(c.sock, c.msg('999@lid'))
    }
    assert.equal(c.removidos.length, 0); assert.equal(c.advs.docs.length, 0)
    assert.ok(c.mongo.ocorrencias.docs.every(d => d.estado === 'protegido'))
  })
  await teste('dono e membro LID em campo separado de metadata PN são identificados', async c => {
    c.sock.participantes.find(p => p.id === DONO).lid = '999@lid'
    c.sock.participantes.find(p => p.id === COMUM).lid = '888@lid'
    await c.executar('figban', '999@lid')
    assert.equal(await regras.consultar(G, hash), 'ban')
    await mod.processar(c.sock, c.msg('999@lid'))
    assert.equal(c.removidos.length, 0)
    await mod.processar(c.sock, c.msg('888@lid'))
    assert.equal(c.removidos.length, 1)
    assert.deepEqual(c.removidos[0].alvos, [COMUM])
    assert.equal(c.envios.filter(e => e.delete).at(-1).delete.participant, '888@lid')
  })
  for (const acao of ['ban','del','adv']) await teste(`bot sem ADM: ${acao} não exclui nem remove`, async c => {
    c.sock.participantes[0].admin = null
    await regras.cadastrar(G, hash, acao, ADM)
    await mod.processar(c.sock, c.msg())
    assert.ok(c.envios.every(e => !e.delete)); assert.equal(c.removidos.length, 0)
    assert.equal(c.advs.docs.length, acao === 'adv' ? 1 : 0)
  })
  for (const sender of [ADM, DONO]) await teste(`ADM/dono protegido e ocorrência persistida: ${sender}`, async c => {
    await regras.cadastrar(G, hash, 'ban', ADM)
    await mod.processar(c.sock, c.msg(sender))
    assert.equal(c.removidos.length, 0); assert.equal(c.mongo.ocorrencias.docs[0].estado, 'protegido')
  })
  await teste('bot nunca é punido, inclusive LID com fromMe falso', async c => {
    await regras.cadastrar(G, hash, 'ban', ADM)
    await mod.processar(c.sock, c.msg('666@lid'))
    const m = c.msg(BOT); m.key.fromMe = true; await mod.processar(c.sock, m)
    assert.equal(c.envios.length, 0); assert.equal(c.removidos.length, 0)
  })
  await teste('participante ausente ou LID desconhecido não sofre punição', async c => {
    await regras.cadastrar(G, hash, 'ban', ADM)
    for (const sender of [PN('5511222220000'), '123456@lid']) await mod.processar(c.sock, c.msg(sender))
    assert.equal(c.removidos.length, 0); assert.equal(c.envios.length, 0)
  })
  await teste('promoção entre exclusão e banimento impede remoção', async c => {
    await regras.cadastrar(G, hash, 'ban', ADM)
    c.sock.aoDeletar = () => { c.sock.participantes.find(p => p.id === COMUM).admin = 'admin' }
    await mod.processar(c.sock, c.msg())
    assert.equal(c.removidos.length, 0)
  })
  await teste('falha e vazio no download não punem nem cadastram', async c => {
    await c.executar('figban', ADM, G, { stickerMessage: { erro: true } })
    await c.executar('figban', ADM, G, { stickerMessage: { bytes: Buffer.alloc(0) } })
    assert.equal(c.mongo.regras.docs.length, 0)
    await regras.cadastrar(G, hash, 'ban', ADM)
    await mod.processar(c.sock, c.msg(COMUM, G, { erro: true }))
    assert.equal(c.removidos.length, 0)
  })
  await teste('tamanho declarado e real limitados antes da punição', async c => {
    await assert.rejects(mod.calcularHash(c.msg(COMUM, G, { fileLength: mod.MAX_BYTES + 1 })), /excede/)
    assert.equal(c.baixadas, 0)
    await assert.rejects(mod.calcularHash(c.msg(COMUM, G, { bytes: Buffer.alloc(mod.MAX_BYTES + 1) })), /excede/)
  })
  await teste('falha de MongoDB não confirma cadastro nem pune', async c => {
    c.mongo.regras.falhar = true; await c.executar('figban')
    await mod.processar(c.sock, c.msg())
    assert.equal(c.removidos.length, 0); assert.match(c.envios.at(-1).text, /Não consegui concluir/)
  })
  await teste('falha na reserva da ocorrência impede qualquer efeito', async c => {
    await regras.cadastrar(G, hash, 'ban', ADM); c.mongo.ocorrencias.falhar = true
    await mod.processar(c.sock, c.msg())
    assert.equal(c.envios.length, 0); assert.equal(c.removidos.length, 0)
  })
  await teste('falha do contador não inventa advertência nem bane', async c => {
    await regras.cadastrar(G, hash, 'adv', ADM); c.advs.falhar = true
    await mod.processar(c.sock, c.msg())
    assert.equal(c.removidos.length, 0); assert.equal(c.advs.docs.length, 0)
    assert.ok(c.envios.every(e => !e.text?.includes('ADVERTÊNCIA APLICADA')))
  })
  await teste('duplicatas concorrentes baixam e punem uma única vez', async c => {
    await regras.cadastrar(G, hash, 'adv', ADM); const m = c.msg()
    await Promise.all([mod.processar(c.sock, m), mod.processar(c.sock, { ...m })])
    assert.equal(c.baixadas, 1); assert.equal(c.advs.docs.length, 1); assert.equal(c.envios.filter(e => e.delete).length, 1)
    mod.__definirDownloadTeste(async () => Readable.from([bytes]))
    await mod.processar(c.sock, m)
    assert.equal(c.advs.docs.length, 1, 'reserva Mongo protege após reset de RAM')
  })
  await teste('cache de regras invalidado após alteração e remoção', async c => {
    assert.equal(await regras.temRegras(G), false)
    await regras.cadastrar(G, hash, 'del', ADM); assert.equal(await regras.temRegras(G), true)
    assert.equal(await regras.consultar(G, hash), 'del')
    const antes = c.mongo.regras.leituras; await regras.consultar(G, hash); assert.equal(c.mongo.regras.leituras, antes)
    await regras.remover(G, hash, 'del'); assert.equal(await regras.consultar(G, hash), null)
  })
  await teste('texto, reply a sticker e eventos de sistema não consultam banco nem baixam', async c => {
    const m = c.msg(); m.message = { extendedTextMessage: { text: '/figban', contextInfo: { quotedMessage: { stickerMessage: {} } } } }
    await mod.processarLote(c.sock, [m, { ...c.msg(), messageStubType: 27 }, { ...c.msg(), message: { protocolMessage: {} } }])
    assert.equal(c.mongo.regras.leituras, 0); assert.equal(c.baixadas, 0)
  })
  await teste('lote inteiro moderado mesmo quando primeira mensagem é texto', async c => {
    await regras.cadastrar(G, hash, 'del', ADM)
    const texto = c.msg(); texto.message = { conversation: 'texto' }
    const tratados = await mod.processarLote(c.sock, [texto, c.msg(), c.msg()])
    assert.equal(tratados.size, 2); assert.equal(c.envios.filter(e => e.delete).length, 2)
  })
  await teste('remoção rejeitada pelo WhatsApp não anuncia sucesso nem repete', async c => {
    await regras.cadastrar(G, hash, 'ban', ADM); c.sock.statusRemocao = '403'
    const m = c.msg(); await mod.processar(c.sock, m); await mod.processar(c.sock, m)
    assert.equal(c.removidos.length, 1); assert.ok(c.envios.every(e => !e.text?.includes('foi removido')))
  })
  ban.__definirGravacaoBlacklistTeste(null)
  console.log(`\n${total} testes passaram.`)
}
main().catch(err => { console.error(err); process.exitCode = 1 })
