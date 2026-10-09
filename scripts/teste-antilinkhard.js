process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
process.env.OWNER_NUMBERS = '5511999990009'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fake = require('./helpers/colecao-figurinhas-fake')
const config = require('../dados/antilinkhard-config')
const mod = require('../dados/moderacao-antilinkhard')
const cmd = require('../comandos/admin/antilinkhard')
const { temLinkBasico, temLinkHard } = require('../dados/deteccao-links')
const lid = require('../lid')
const ban = require('../comandos/admin/ban')
require('../prefixo').__definirPrefixoTeste('/')
const G = '111@g.us', H = '222@g.us', PN = n => `${n}@s.whatsapp.net`
const ADM = PN('5511777770000'), COMUM = PN('5511888880000'), BOT = PN('5511666660000'), DONO = PN('5511999990009'), GRUPO_DONO = PN('5511555550000')
let passou = 0
function cenario() {
  const mongo = { config: fake(), eventos: fake(), travas: fake() }
  config.__definirColecoesTeste(mongo); mod.__limparCacheTeste()
  lid.__definirConsultaSessaoTeste(async () => null)
  ban.__definirGravacaoBlacklistTeste(() => { throw new Error('hard não deve gravar blacklist') })
  const envios = [], remocoes = []
  let seq = 0
  const sock = {
    user: { id: BOT, lid: '666@lid' },
    membros: [{ id: BOT, lid: '666@lid', admin: 'admin' }, { id: ADM, lid: '777@lid', admin: 'admin' }, { id: COMUM, lid: '888@lid' }, { id: DONO, lid: '999@lid' }, { id: GRUPO_DONO, lid: '555@lid' }],
    owner: GRUPO_DONO,
    async groupMetadata() { if (this.erroMeta) throw new Error('metadata offline'); return { participants: this.membros, owner: this.owner } },
    async sendMessage(jid, payload) {
      if (payload.delete && this.erroDelete) throw new Error('delete offline')
      if (payload.text && this.erroEnvio) throw new Error('envio offline')
      envios.push({ jid, ...payload }); if (payload.delete) await this.aoApagar?.()
      return { key: { id: `envio-${++seq}` } }
    },
    async groupParticipantsUpdate(jid, alvos) {
      remocoes.push({ jid, alvos })
      if (this.erroRemocao) throw new Error('remoção offline')
      if (this.semStatus) return []
      if (this.status === undefined || this.status === '200') this.membros = this.membros.filter(p => !alvos.includes(p.id))
      return alvos.map(jid => ({ jid, status: this.status || '200' }))
    }
  }
  const msg = (sender = COMUM, texto = 'https://example.com', jid = G) => ({ key: { remoteJid: jid, participant: sender, id: `msg-${++seq}`, fromMe: false }, message: { conversation: texto } })
  async function executar(acao = 'on', autor = ADM, jid = G, texto) { return cmd.executar(sock, jid, msg(autor, '', jid), texto || `/antilinkhard ${acao}`) }
  return { mongo, sock, msg, executar, envios, remocoes,
    get exclusoes() { return envios.filter(e => e.delete) }, get anuncios() { return envios.filter(e => e.text?.includes('💀 Punição: Expulsão')) } }
}
async function teste(nome, fn) { await fn(cenario()); passou++; console.log(`✅ ${nome}`) }
async function main() {
  await teste('nome e aliases', async () => { assert.equal(cmd.nome, 'antilinkhard'); assert.deepEqual(cmd.aliases, ['antilink-hard', 'antilinkban']) })
  await teste('padrão desativado', async c => { assert.equal(await config.obter(G), false); assert.equal(await mod.processar(c.sock, c.msg()), false); assert.equal(c.remocoes.length, 0) })
  await teste('on/off/status persistem no Mongo e preservam configuração por grupo', async c => {
    await c.executar(); assert.equal(await config.obter(G), true); assert.equal(await config.obter(H), false)
    const doc = c.mongo.config.docs[0]; assert.equal(doc.atualizado_por, ADM.split('@')[0]); assert.ok(doc.atualizado_em)
    await c.executar('status'); assert.match(c.envios.at(-1).text, /ATIVADO/)
    await c.executar('off'); assert.equal(await config.obter(G), false); assert.match(c.envios.at(-1).text, /DESATIVADO/)
  })
  await teste('reinício do módulo recupera Mongo sem JSON', async c => {
    await c.executar(); const caminho = require.resolve('../dados/antilinkhard-config'), anterior = require.cache[caminho]; delete require.cache[caminho]
    try { const reiniciado = require('../dados/antilinkhard-config'); reiniciado.__definirColecoesTeste(c.mongo); assert.equal(await reiniciado.obter(G), true) }
    finally { require.cache[caminho] = anterior }
  })
  await teste('conexão de produção configura retenção TTL nas novas coleções', async () => {
    const indices = [], colecoes = { configAntilinkHard: fake(), ocorrenciasAntilinkHard: fake(), travasAntilinkHard: fake() }
    for (const [nome, col] of Object.entries(colecoes)) col.createIndex = async (campos, opcoes) => indices.push({ nome, campos, opcoes })
    class MongoClient { async connect() {} db(nome) { assert.equal(nome, 'offline'); return { collection: nome => colecoes[nome] } } }
    const modulo = { exports: {} }
    new Function('require', 'module', 'process', fs.readFileSync(require.resolve('../dados/antilinkhard-config'), 'utf8'))(
      nome => nome === 'mongodb' ? { MongoClient } : require(nome), modulo, { env: { MONGODB_URI: 'mongodb://offline', MONGODB_DB: 'offline' } }
    )
    assert.equal(await modulo.exports.obter(G), false)
    assert.equal(indices.length, 2)
    for (const indice of indices) { assert.deepEqual(indice.campos, { expira_em: 1 }); assert.equal(indice.opcoes.expireAfterSeconds, 0) }
  })
  await teste('URLs IPv4 completas detectadas; números e IP abreviado não', async () => {
    assert.equal(temLinkHard('http://192.168.0.1:8080/a'), true)
    assert.equal(temLinkHard('http://127.1'), false)
    assert.equal(temLinkHard('192.168.0.1'), false)
  })
  for (const autor of [ADM, '777@lid', DONO, '999@lid', GRUPO_DONO, '555@lid']) await teste(`configuração autorizada: ${autor}`, async c => { await c.executar('on', autor); assert.equal(await config.obter(G), true) })
  for (const autor of [COMUM, '888@lid', `${ADM.split('@')[0]}@lid`, `${DONO.split('@')[0]}@lid`]) await teste(`configuração recusada: ${autor}`, async c => { await c.executar('on', autor); await c.executar('status', autor); assert.equal(c.mongo.config.docs.length, 0); assert.match(c.envios.at(-1).text, /Apenas administradores/) })
  await teste('dono LID resolvido pela sessão configura', async c => { lid.__definirConsultaSessaoTeste(async id => id === '9999' ? DONO.split('@')[0] : null); await c.executar('on', '9999@lid'); assert.equal(await config.obter(G), true) })
  await teste('privado não altera estado', async c => { await c.executar('on', DONO, DONO); assert.equal(c.mongo.config.docs.length, 0) })
  for (const arg of ['', '1', 'enable', 'on extra']) await teste(`uso inválido: ${arg || 'vazio'}`, async c => { await c.executar(arg); assert.equal(c.mongo.config.docs.length, 0); assert.match(c.envios.at(-1).text, /Use/) })
  await teste('prefixo dinâmico nos exemplos e aliases aceitam argumentos', async c => {
    const prefixo = require('../prefixo'); prefixo.__definirPrefixoTeste('!')
    await c.executar('', ADM, G, '!antilink-hard'); assert.match(c.envios.at(-1).text, /!antilinkhard on/)
    await c.executar('on', ADM, G, '!antilinkban on'); assert.equal(await config.obter(G), true)
    prefixo.__definirPrefixoTeste('/')
  })
  for (const texto of ['http://example.com', 'https://example.com/a?q=1', 'www.example.com', 'example.com', 'example.com.br/caminho', 'https://chat.whatsapp.com/Convite123', 'chat.whatsapp.com/Convite123', 'wa.me/5511999999999', 'Veja (https://example.com).', '*https://example.com*', 'https://EXAMPLE.COM', 'sub.example.org:8080/abc']) await teste(`detecta ${texto}`, async () => assert.equal(temLinkHard(texto), true))
  for (const texto of ['bom dia', 'arquivo.txt', 'objeto.metodo', 'foto.png', 'versao 1.2.3', 'email@example.com', 'http://', 'https://', 'www.', 'https://incompleto', 'example.', '.com', 'abc..com', 'abc-.com', 'example.naoexistente', 'https://example.com:99999', 'www.incompleto']) await teste(`não pune ${texto}`, async () => assert.equal(temLinkHard(texto), false))
  await teste('detector básico mantém exatamente a expressão original', async () => {
    for (const texto of ['http://', 'http://x', 'www.', 'www.x', 'wa.me/123', 'example.com', 'email@example.com', 'texto']) {
      assert.equal(temLinkBasico(texto), /(https?:\/\/[^\s]+|www\.[^\s]+|wa\.me\/[^\s]+)/i.test(texto))
    }
  })
  await teste('expulsão confirmada apaga e anuncia sem blacklist nem advertência', async c => {
    await c.executar(); const m = c.msg(); assert.equal(await mod.processar(c.sock, m), true)
    assert.equal(c.exclusoes.length, 1); assert.deepEqual(c.exclusoes[0].delete, { remoteJid: G, id: m.key.id, participant: COMUM, fromMe: false })
    assert.equal(c.remocoes.length, 1); assert.equal(c.anuncios.length, 1); assert.equal(c.mongo.eventos.docs[0].estado, 'remocao_confirmada')
  })
  for (const tipo of ['imageMessage', 'videoMessage', 'documentMessage', 'ephemeralMessage', 'viewOnceMessageV2']) await teste(`links em ${tipo} sem download`, async c => {
    await c.executar(); const m = c.msg()
    m.message = ['ephemeralMessage', 'viewOnceMessageV2'].includes(tipo) ? { [tipo]: { message: { imageMessage: { caption: 'example.com' } } } } : { [tipo]: { caption: 'example.com' } }
    await mod.processar(c.sock, m); assert.equal(c.remocoes.length, 1); assert.equal(c.exclusoes.length, 1)
  })
  await teste('link somente na mensagem citada não pune quem respondeu', async c => {
    await c.executar(); const m = c.msg(); m.message = { extendedTextMessage: { text: 'resposta normal', contextInfo: { participant: ADM, quotedMessage: { conversation: 'https://example.com' } } } }
    assert.equal(await mod.processar(c.sock, m), false); assert.equal(c.remocoes.length, 0)
  })
  for (const autor of [ADM, '777@lid', DONO, '999@lid', BOT, '666@lid', GRUPO_DONO, '555@lid']) await teste(`participante protegido: ${autor}`, async c => {
    await c.executar(); await mod.processar(c.sock, c.msg(autor)); assert.equal(c.remocoes.length, 0); assert.equal(c.exclusoes.length, 0)
  })
  await teste('LID resolvido pune telefone correto e remove JID canônico', async c => {
    await c.executar(); await mod.processar(c.sock, c.msg('888@lid')); assert.deepEqual(c.remocoes[0].alvos, [COMUM]); assert.equal(c.mongo.travas.docs[0].numero, COMUM.split('@')[0])
  })
  await teste('LID desconhecido não pune', async c => { await c.executar(); await mod.processar(c.sock, c.msg('11111@lid')); assert.equal(c.remocoes.length, 0); assert.equal(c.exclusoes.length, 0) })
  await teste('bot sem ADM não apaga nem tenta expulsar', async c => { await c.executar(); c.sock.membros.find(p => p.id === BOT).admin = null; await mod.processar(c.sock, c.msg()); assert.equal(c.remocoes.length, 0); assert.equal(c.exclusoes.length, 0) })
  await teste('participante que saiu não é removido', async c => { await c.executar(); c.sock.membros = c.sock.membros.filter(p => p.id !== COMUM); await mod.processar(c.sock, c.msg()); assert.equal(c.remocoes.length, 0) })
  await teste('promoção durante exclusão impede expulsão', async c => { await c.executar(); c.sock.aoApagar = () => { c.sock.membros.find(p => p.id === COMUM).admin = 'admin' }; await mod.processar(c.sock, c.msg()); assert.equal(c.remocoes.length, 0); assert.equal(c.anuncios.length, 0) })
  await teste('saída durante exclusão impede expulsão', async c => { await c.executar(); c.sock.aoApagar = () => { c.sock.membros = c.sock.membros.filter(p => p.id !== COMUM) }; await mod.processar(c.sock, c.msg()); assert.equal(c.remocoes.length, 0) })
  await teste('desativação durante exclusão impede expulsão', async c => { await c.executar(); c.sock.aoApagar = () => config.definir(G, false, ADM); await mod.processar(c.sock, c.msg()); assert.equal(c.remocoes.length, 0) })
  for (const status of ['403', '404', '500']) await teste(`status ${status} não anuncia sucesso`, async c => { await c.executar(); c.sock.status = status; await mod.processar(c.sock, c.msg()); assert.equal(c.remocoes.length, 1); assert.equal(c.anuncios.length, 0); assert.equal(c.mongo.eventos.docs[0].estado, 'remocao_nao_confirmada') })
  for (const falha of ['semStatus', 'erroRemocao']) await teste(`${falha} não é confirmação e não repete`, async c => { await c.executar(); c.sock[falha] = true; await mod.processar(c.sock, c.msg()); await mod.processar(c.sock, c.msg()); assert.equal(c.remocoes.length, 1); assert.equal(c.anuncios.length, 0) })
  await teste('falha ao apagar não inventa exclusão e remoção exige status', async c => { await c.executar(); c.sock.erroDelete = true; await mod.processar(c.sock, c.msg()); assert.equal(c.exclusoes.length, 0); assert.equal(c.remocoes.length, 1); assert.equal(c.mongo.eventos.docs[0].mensagem_apagada, false) })
  await teste('falha no anúncio não repete expulsão', async c => { await c.executar(); c.sock.erroEnvio = true; const m = c.msg(); await mod.processar(c.sock, m); await mod.processar(c.sock, m); assert.equal(c.remocoes.length, 1); assert.equal(c.mongo.eventos.docs[0].estado, 'remocao_confirmada') })
  await teste('falha de Mongo após remoção não anuncia e conserva reserva', async c => {
    await c.executar(); const original = c.sock.groupParticipantsUpdate.bind(c.sock)
    c.sock.groupParticipantsUpdate = async (...args) => { const retorno = await original(...args); c.mongo.eventos.falhar = true; return retorno }
    const m = c.msg(); await mod.processar(c.sock, m); assert.equal(c.remocoes.length, 1); assert.equal(c.anuncios.length, 0); assert.equal(c.mongo.travas.docs.length, 1)
    mod.__limparCacheTeste(); await mod.processar(c.sock, m); assert.equal(c.remocoes.length, 1)
  })
  await teste('duplicatas concorrentes apagam, expulsam e anunciam uma vez', async c => { await c.executar(); const m = c.msg(); await Promise.all(Array.from({ length: 10 }, () => mod.processar(c.sock, m))); assert.equal(c.exclusoes.length, 1); assert.equal(c.remocoes.length, 1); assert.equal(c.anuncios.length, 1) })
  await teste('duas mensagens concorrentes PN/LID geram uma expulsão', async c => { await c.executar(); await Promise.all([mod.processar(c.sock, c.msg(COMUM)), mod.processar(c.sock, c.msg('888@lid'))]); assert.equal(c.exclusoes.length, 2); assert.equal(c.remocoes.length, 1); assert.equal(c.anuncios.length, 1); assert.equal(c.mongo.travas.docs.length, 1) })
  await teste('replay após limpar cache continua reservado no Mongo', async c => { await c.executar(); const m = c.msg(); await mod.processar(c.sock, m); mod.__limparCacheTeste(); await mod.processar(c.sock, m); assert.equal(c.remocoes.length, 1); assert.equal(c.exclusoes.length, 1) })
  await teste('segunda instância compartilha reserva persistente de participante', async c => {
    await c.executar(); const token = await config.reservarParticipante(G, COMUM.split('@')[0]); assert.ok(token)
    await mod.processar(c.sock, c.msg()); assert.equal(c.exclusoes.length, 1); assert.equal(c.remocoes.length, 0)
  })
  await teste('grupos diferentes não compartilham trava', async c => { await config.definir(G, true, ADM); await config.definir(H, true, ADM); c.sock.status = '403'; await Promise.all([mod.processar(c.sock, c.msg(COMUM, 'example.com', G)), mod.processar(c.sock, c.msg(COMUM, 'example.com', H))]); assert.equal(c.remocoes.length, 2) })
  await teste('lote inteiro processado', async c => { await c.executar(); const m = c.msg(); const tratadas = await mod.processarLote(c.sock, [c.msg(ADM, 'texto'), m]); assert.ok(tratadas.has(`${G}:${m.key.id}`)); assert.equal(c.remocoes.length, 1) })
  await teste('eventos do próprio socket e stubs não punem', async c => { await c.executar(); const m = c.msg(); m.key.fromMe = true; await mod.processar(c.sock, m); m.key.fromMe = false; m.messageStubType = 1; await mod.processar(c.sock, m); assert.equal(c.remocoes.length, 0) })
  for (const colecao of ['config', 'eventos', 'travas']) await teste(`falha de Mongo em ${colecao} não expulsa`, async c => { await c.executar(); config.__definirColecoesTeste(c.mongo); c.mongo[colecao].falhar = true; await mod.processar(c.sock, c.msg()); assert.equal(c.remocoes.length, 0); assert.equal(c.anuncios.length, 0) })
  await teste('falha de gravação não confirma ativação', async c => { c.mongo.config.falhar = true; await c.executar(); assert.equal(c.mongo.config.docs.length, 0); assert.doesNotMatch(c.envios.at(-1).text, /\*ATIVADO\*/) })
  await teste('falha de metadata não configura nem pune', async c => { await c.executar(); c.sock.erroMeta = true; await mod.processar(c.sock, c.msg()); await c.executar('off'); assert.equal(c.remocoes.length, 0); assert.equal(await config.obter(G), true) })
  await teste('dono do grupo sem identidade comprovada impede punição', async c => { await c.executar(); c.sock.owner = '12345@lid'; await mod.processar(c.sock, c.msg()); assert.equal(c.remocoes.length, 0); assert.equal(c.exclusoes.length, 0) })
  await teste('memória limitada mesmo em muitos eventos', async c => { for (let i = 0; i < mod.MAX_CACHE + 50; i++) await mod.processar(c.sock, c.msg()); assert.ok(mod.__tamanhoCacheTeste() <= mod.MAX_CACHE) })
  console.log(`\n${passou} testes passaram.`)
}
main().catch(erro => { console.error(erro); process.exitCode = 1 })
