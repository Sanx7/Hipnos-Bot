// Offline: socket e Mongo simulados; nenhuma exclusão/expulsão real.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
process.env.OWNER_NUMBERS = '5511999990009'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fake = require('./helpers/colecao-figurinhas-fake')
const config = require('../dados/limitecaractere-config')
const mod = require('../dados/moderacao-limitecaractere')
const cmd = require('../comandos/admin/limitecaractere')
const advertencias = require('../advertencias')
const lid = require('../lid')
const ban = require('../comandos/admin/ban')
const prefixos = require('../prefixo')
const G = '111@g.us', H = '222@g.us', PN = n => `${n}@s.whatsapp.net`
const ADM = PN('5511777770000'), COMUM = PN('5511888880000'), BOT = PN('5511666660000')
const DONO = PN('5511999990009'), GRUPO_DONO = PN('5511555550000')
const TEXTO = 'x'.repeat(1001)
let passou = 0
function cenario() {
  let agora = 1800000000000, seq = 0
  const mongo = { config: fake(), eventos: fake(), cooldowns: fake() }
  config.__definirColecoesTeste(mongo); mod.__limparTeste(() => agora)
  mongo.cooldowns.updateOne = async (f, u) => {
    if (mongo.cooldowns.falhar) throw new Error('Mongo offline')
    const d = mongo.cooldowns.docs.find(d => d._id === f._id && d.ate <= f.ate.$lte)
    if (!d) return { modifiedCount: 0 }
    Object.assign(d, u.$set); return { modifiedCount: 1 }
  }
  advertencias.__definirColecaoTeste(fake())
  lid.__definirConsultaSessaoTeste(async () => null)
  prefixos.__definirPrefixoTeste('/')
  const envios = [], remocoes = [], blacklist = []
  ban.__definirGravacaoBlacklistTeste(n => blacklist.push(n))
  const sock = {
    user: { id: BOT, lid: '666@lid' },
    membros: [{ id: BOT, lid: '666@lid', admin: 'admin' }, { id: ADM, lid: '777@lid', admin: 'admin' },
      { id: COMUM, lid: '888@lid' }, { id: DONO, lid: '999@lid' }, { id: GRUPO_DONO, lid: '555@lid' }],
    owner: GRUPO_DONO,
    async groupMetadata() {
      if (this.erroMeta) throw new Error('metadata offline')
      await this.aoMetadata?.()
      return { participants: this.membros, owner: this.owner }
    },
    async sendMessage(jid, payload) {
      if (payload.delete && this.erroDelete) throw new Error('delete offline')
      if (payload.text && this.erroEnvio) throw new Error('envio offline')
      envios.push({ jid, ...payload })
      if (payload.delete) await this.aoApagar?.()
      return { key: { id: `envio-${++seq}` } }
    },
    async groupParticipantsUpdate(jid, alvos) {
      remocoes.push({ jid, alvos })
      if (this.erroRemocao) throw new Error('remoção offline')
      if (this.semStatus) return []
      return alvos.map(jid => ({ jid, status: this.status ?? '200' }))
    }
  }
  const msg = (texto = TEXTO, sender = COMUM, jid = G) => ({
    key: { remoteJid: jid, participant: sender, id: `msg-${++seq}`, fromMe: false },
    messageTimestamp: Math.floor(agora / 1000), message: { conversation: texto }
  })
  return { mongo, sock, envios, remocoes, blacklist, msg,
    avancar(ms) { agora += ms },
    async executar(arg = 'on', autor = ADM, jid = G, nome = '/limitecaractere') {
      return cmd.executar(sock, jid, msg('', autor, jid), `${nome} ${arg}`)
    },
    async ligar(acao = 'apagar', limite = 1000) { await config.definir(G, { ativo: true, acao, limite }, ADM.split('@')[0]) },
    async processar(texto = TEXTO, sender = COMUM, jid = G) { return mod.processar(sock, msg(texto, sender, jid)) },
    get exclusoes() { return envios.filter(e => e.delete) },
    get avisos() { return envios.filter(e => e.text) },
    async total(jid = G) { return advertencias.contarAdvertencias(COMUM.split('@')[0], jid) }
  }
}
async function teste(nome, fn) { await fn(cenario()); passou++; console.log(`✅ ${nome}`) }
async function main() {
  await teste('contrato e aliases', async () => { assert.equal(cmd.nome, 'limitecaractere'); assert.deepEqual(cmd.aliases, ['limitecaracteres', 'antitextao']) })
  await teste('padrões, isolamento e desligado não pune', async c => {
    assert.deepEqual(await config.obter(G), { ativo: false, limite: 1000, acao: 'apagar' })
    assert.equal(await c.processar(), false)
    await c.ligar(); assert.equal((await config.obter(H)).ativo, false)
    assert.equal(await c.processar(TEXTO, COMUM, H), false)
  })
  await teste('on/off/status e persistência após recarregar módulo', async c => {
    await c.executar(); await c.executar('definir 2500'); await c.executar('acao adv'); await c.executar('status')
    assert.match(c.avisos.at(-1).text, /2500 caracteres Unicode/)
    const path = require.resolve('../dados/limitecaractere-config'), antigo = require.cache[path]; delete require.cache[path]
    try { const novo = require(path); novo.__definirColecoesTeste(c.mongo); assert.deepEqual(await novo.obter(G), { ativo: true, limite: 2500, acao: 'adv' }) }
    finally { require.cache[path] = antigo }
    await c.executar('off'); assert.equal((await config.obter(G)).ativo, false)
  })
  for (const limite of [100, 10000]) await teste(`limite permitido ${limite}`, async c => { await c.executar(`definir ${limite}`); assert.equal((await config.obter(G)).limite, limite) })
  for (const arg of ['definir 99', 'definir 10001', 'definir -100', 'definir 100.5', 'definir abc', 'definir 1e3', 'definir 100 extra', 'on extra', 'acao x', 'acao ban extra', '']) {
    await teste(`entrada inválida: ${arg}`, async c => { await c.executar(arg); assert.equal(c.mongo.config.docs.length, 0) })
  }
  for (const acao of ['apagar', 'adv', 'ban']) await teste(`configura ação ${acao}`, async c => { await c.executar(`acao ${acao}`); assert.equal((await config.obter(G)).acao, acao) })
  for (const autor of [ADM, '777@lid', DONO, '999@lid', GRUPO_DONO, '555@lid']) await teste(`configuração autorizada ${autor}`, async c => { await c.executar('on', autor); assert.equal((await config.obter(G)).ativo, true) })
  for (const autor of [COMUM, '888@lid', `${ADM.split('@')[0]}@lid`]) await teste(`configuração recusada ${autor}`, async c => { await c.executar('on', autor); assert.equal((await config.obter(G)).ativo, false) })
  await teste('somente grupos e metadados obrigatórios', async c => { await c.executar('on', DONO, DONO); c.sock.erroMeta = true; await c.executar('on', DONO); assert.equal(c.mongo.config.docs.length, 0) })
  for (const nome of ['/limitecaracteres', '!antitextao', '?limitecaractere']) await teste(`alias/prefixo ${nome}`, async c => { await c.executar('on', ADM, G, nome); assert.equal((await config.obter(G)).ativo, true) })
  await teste('ajuda usa prefixo dinâmico e menu conserva comandos', async c => {
    prefixos.__definirPrefixoTeste('!'); await c.executar(''); assert.match(c.avisos.at(-1).text, /!limitecaractere/)
    await require('../comandos/admin/menu-admin').executar(c.sock, G, c.msg())
    for (const texto of ['!limitecaractere definir 1000', '!antitextao', '/antiflood', '/adv', '/figadv', '/antilinkhard']) assert.ok(c.avisos.at(-1).text.includes(texto))
  })
  for (const [nome, texto, punir] of [
    ['exatamente 1000', 'x'.repeat(1000), false], ['1001', TEXTO, true],
    ['emoji no limite', '🌙'.repeat(1000), false], ['emoji excedente', '🌙'.repeat(1001), true],
    ['Unicode misto', 'a🌙漢'.repeat(333) + 'ab', true], ['acentos', 'á'.repeat(1000), false]
  ]) await teste(`contagem ${nome}`, async c => {
    await c.ligar(); assert.equal(mod.contarCaracteres(texto), Array.from(texto).length)
    assert.equal(await c.processar(texto), punir); assert.equal(c.exclusoes.length, punir ? 1 : 0)
  })
  await teste('sequências combinadas seguem pontos de código, não grafemas', async () => { assert.equal(mod.contarCaracteres('e\u0301👨‍👩‍👧‍👦'), Array.from('e\u0301👨‍👩‍👧‍👦').length) })
  for (const tipo of ['extendedTextMessage', 'imageMessage', 'videoMessage', 'documentMessage']) await teste(`texto/legenda ${tipo}`, async c => {
    await c.ligar(); const m = c.msg(); m.message = { [tipo]: tipo === 'extendedTextMessage' ? { text: TEXTO } : { caption: TEXTO } }
    assert.equal(await mod.processar(c.sock, m), true); assert.equal(c.exclusoes.length, 1)
  })
  for (const wrapper of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'associatedChildMessage']) await teste(`legenda encapsulada ${wrapper} sem download`, async c => {
    await c.ligar(); const m = c.msg(); m.message = { [wrapper]: { message: { documentMessage: { caption: TEXTO } } } }
    await mod.processar(c.sock, m); assert.equal(c.exclusoes.length, 1)
  })
  for (const message of [{ audioMessage: {} }, { stickerMessage: {} }, { imageMessage: {} }, { protocolMessage: {} }, { conversation: '' }, { eventMessage: {} }]) await teste('evento sem texto ignorado', async c => {
    await c.ligar('adv'); const m = c.msg(); m.message = message; assert.equal(await mod.processar(c.sock, m), false); assert.equal(c.exclusoes.length, 0)
  })
  await teste('não conta conteúdo da mensagem citada', async c => {
    await c.ligar(); const m = c.msg(); m.message = { extendedTextMessage: { text: 'oi', contextInfo: { quotedMessage: { conversation: TEXTO } } } }
    assert.equal(await mod.processar(c.sock, m), false)
  })
  for (const autor of [BOT, '666@lid', ADM, '777@lid', DONO, '999@lid', GRUPO_DONO, '555@lid']) await teste(`participante protegido ${autor}`, async c => {
    await c.ligar('ban'); await c.processar(TEXTO, autor); assert.equal(c.exclusoes.length, 0); assert.equal(c.remocoes.length, 0)
  })
  await teste('LID comprovado usa telefone no contador e cooldown', async c => {
    await c.ligar('adv'); await c.processar(TEXTO, '888@lid'); await c.processar()
    assert.equal(await c.total(), 1); assert.equal(c.exclusoes.length, 2); assert.ok(c.mongo.cooldowns.docs[0]._id.endsWith(COMUM.split('@')[0]))
  })
  await teste('LID resolvido pela sessão', async c => {
    c.sock.membros = c.sock.membros.map(p => ({ id: p.id, admin: p.admin }))
    lid.__definirConsultaSessaoTeste(async n => n === '888' ? COMUM.split('@')[0] : null)
    await c.ligar('adv'); await c.processar(TEXTO, '888@lid'); assert.equal(await c.total(), 1)
  })
  for (const sender of ['desconhecido@lid', `${ADM.split('@')[0]}@lid`, `${BOT.split('@')[0]}@lid`]) await teste(`LID não comprovado não pune ${sender}`, async c => {
    await c.ligar('ban'); await c.processar(TEXTO, sender); assert.equal(c.remocoes.length, 0); assert.equal(c.exclusoes.length, 0)
  })
  await teste('identidade ambígua e dono não identificado não punem', async c => {
    await c.ligar('ban'); c.sock.membros.push({ id: COMUM }); await c.processar(); assert.equal(c.exclusoes.length, 0)
    c.sock.membros.pop(); c.sock.owner = 'desconhecido@lid'; await c.processar(); assert.equal(c.exclusoes.length, 0)
  })
  await teste('VIP segue regra comum', async c => {
    const vip = require('../vip'), antigo = vip.isVip; let consultas = 0
    vip.isVip = async () => { consultas++; return true }
    try { await c.ligar('adv'); await c.processar(); assert.equal(await c.total(), 1); assert.equal(consultas, 0) } finally { vip.isVip = antigo }
  })
  for (const invalidar of [m => { m.key.fromMe = true }, m => { m.messageStubType = 1 }, m => { delete m.key.id }, m => { delete m.key.participant }, m => { delete m.messageTimestamp }, m => { m.messageTimestamp -= 61 }, m => { m.messageTimestamp += 10 }]) await teste('evento histórico/inválido ignorado', async c => {
    await c.ligar(); const m = c.msg(); invalidar(m); assert.equal(await mod.processar(c.sock, m), false); assert.equal(c.exclusoes.length, 0)
  })
  for (const tipo of ['append', undefined]) await teste(`lote ${tipo} ignorado`, async c => { await c.ligar(); assert.equal((await mod.processarLote(c.sock, [c.msg()], tipo)).size, 0) })
  await teste('timestamp Long Baileys', async c => { await c.ligar(); const m = c.msg(), t = m.messageTimestamp; m.messageTimestamp = { toNumber: () => t }; await mod.processar(c.sock, m); assert.equal(c.exclusoes.length, 1) })
  await teste('apagar não cria advertência e aviso informa efeito real', async c => {
    await c.ligar(); await c.processar(); assert.equal(await c.total(), 0); assert.match(c.avisos[0].text, /Mensagem apagada/)
  })
  await teste('exclusão falha sem inventar sucesso', async c => {
    await c.ligar(); c.sock.erroDelete = true; await c.processar(); assert.equal(c.exclusoes.length, 0); assert.match(c.avisos[0].text, /Nenhuma; falha na exclusão/)
  })
  await teste('adv integra contador existente e motivo sem conteúdo privado', async c => {
    await c.ligar('adv'); await c.processar(); assert.equal(await c.total(), 1); assert.match(c.avisos[0].text, /Advertência \(1\/3\)/)
    const docs = await advertencias.listarAdvertencias(COMUM.split('@')[0], G); assert.equal(docs[0].motivo, 'Limite de caracteres: texto acima de 1000')
  })
  await teste('setlimiteadv dispara expulsão central e arquivo só após 200', async c => {
    await c.ligar('adv'); await advertencias.definirLimiteAdvertencias(G, 1, ADM.split('@')[0]); await c.processar()
    assert.equal(c.remocoes.length, 1); assert.equal(await c.total(), 0); assert.deepEqual(c.blacklist, [COMUM.split('@')[0]]); assert.match(c.avisos[0].text, /removido após confirmação/)
  })
  await teste('ban adv recusado mantém contador e blacklist vazia', async c => {
    await c.ligar('adv'); await advertencias.definirLimiteAdvertencias(G, 1, ADM.split('@')[0]); c.sock.status = '403'; await c.processar()
    assert.equal(await c.total(), 1); assert.equal(c.blacklist.length, 0); assert.match(c.avisos[0].text, /expulsão não foi confirmada/)
  })
  await teste('ban direto exige 200, sem contador paralelo nem blacklist', async c => {
    await c.ligar('ban'); await c.processar(); assert.equal(c.remocoes.length, 1); assert.match(c.avisos[0].text, /Expulsão confirmada/); assert.equal(await c.total(), 0); assert.equal(c.blacklist.length, 0)
  })
  for (const status of ['403', '500', 'vazio', 'throw']) await teste(`ban não confirmado ${status}`, async c => {
    await c.ligar('ban'); c.sock.status = status; c.sock.semStatus = status === 'vazio'; c.sock.erroRemocao = status === 'throw'
    await c.processar(); assert.match(c.avisos[0].text, /Expulsão não confirmada/); assert.equal(c.blacklist.length, 0)
    await c.processar(); assert.equal(c.remocoes.length, 1)
  })
  await teste('cooldown 30s apaga sempre, uma adv/aviso até expirar', async c => {
    await c.ligar('adv'); await c.processar(); c.avancar(29999); await c.processar(); assert.equal(await c.total(), 1); assert.equal(c.avisos.length, 1)
    c.avancar(1); await c.processar(); assert.equal(await c.total(), 2); assert.equal(c.exclusoes.length, 3); assert.equal(c.avisos.length, 2)
  })
  await teste('cooldown e grupos/participantes independentes', async c => {
    await c.ligar('adv'); await config.definir(H, { ativo: true, acao: 'adv' }, 'adm')
    const outro = PN('5511222220000'); c.sock.membros.push({ id: outro })
    await c.processar(); await c.processar(TEXTO, COMUM, H); await c.processar(TEXTO, outro)
    assert.equal(await c.total(), 1); assert.equal(await c.total(H), 1); assert.equal(c.exclusoes.length, 3)
  })
  await teste('duplicado concorrente tem um efeito', async c => {
    await c.ligar('adv'); const m = c.msg(); await Promise.all(Array.from({ length: 20 }, () => mod.processar(c.sock, m)))
    assert.equal(c.exclusoes.length, 1); assert.equal(await c.total(), 1)
  })
  await teste('mensagens distintas concorrentes: todas apagadas, uma adv', async c => {
    await c.ligar('adv'); await Promise.all(Array.from({ length: 20 }, () => c.processar()))
    assert.equal(c.exclusoes.length, 20); assert.equal(await c.total(), 1); assert.equal(c.avisos.length, 1)
  })
  await teste('reservas e cooldown persistem após limpar memória', async c => {
    await c.ligar('adv'); const m = c.msg(); await mod.processar(c.sock, m)
    mod.__limparTeste(() => 1800000000000); await mod.processar(c.sock, m); await c.processar()
    assert.equal(await c.total(), 1); assert.equal(c.exclusoes.length, 2)
  })
  await teste('dois módulos concorrentes compartilham reserva Mongo da mensagem', async c => {
    await c.ligar('adv'); const m = c.msg()
    const path = require.resolve('../dados/moderacao-limitecaractere'), antigo = require.cache[path]; delete require.cache[path]
    try {
      const segundo = require(path); segundo.__limparTeste(() => 1800000000000)
      await Promise.all([mod.processar(c.sock, m), segundo.processar(c.sock, m)])
      assert.equal(c.exclusoes.length, 1); assert.equal(await c.total(), 1)
    } finally { require.cache[path] = antigo }
  })
  await teste('dois módulos concorrentes compartilham cooldown Mongo do participante', async c => {
    await c.ligar('adv')
    const path = require.resolve('../dados/moderacao-limitecaractere'), antigo = require.cache[path]; delete require.cache[path]
    try {
      const segundo = require(path); segundo.__limparTeste(() => 1800000000000)
      await Promise.all([mod.processar(c.sock, c.msg()), segundo.processar(c.sock, c.msg())])
      assert.equal(c.exclusoes.length, 2); assert.equal(await c.total(), 1); assert.equal(c.avisos.length, 1)
    } finally { require.cache[path] = antigo }
  })
  for (const campo of ['config', 'eventos', 'cooldowns']) await teste(`Mongo ${campo} indisponível não pune`, async c => {
    await c.ligar('adv'); c.mongo[campo].falhar = true; await c.processar(); assert.equal(c.exclusoes.length, 0); assert.equal(await c.total(), 0)
  })
  await teste('configuração corrompida não pune', async c => {
    c.mongo.config.docs.push({ _id: G, ativo: true, limite: 0, acao: 'ban' }); assert.equal(await c.processar(), false); assert.equal(c.remocoes.length, 0)
  })
  await teste('metadata indisponível preserva fluxo', async c => { await c.ligar(); c.sock.erroMeta = true; assert.equal(await c.processar(), false); assert.equal(c.exclusoes.length, 0) })
  await teste('bot sem ADM não finge efeito nem gera adv', async c => {
    await c.ligar('adv'); c.sock.membros.find(p => p.id === BOT).admin = null; await c.processar(); assert.equal(c.exclusoes.length, 0); assert.equal(c.avisos.length, 0); assert.equal(await c.total(), 0)
  })
  await teste('promoção antes de apagar impede exclusão', async c => {
    await c.ligar('ban'); let chamadas = 0
    c.sock.aoMetadata = () => { if (++chamadas === 2) c.sock.membros.find(p => p.id === COMUM).admin = 'admin' }
    await c.processar(); assert.equal(c.exclusoes.length, 0); assert.equal(c.remocoes.length, 0)
  })
  for (const acao of ['adv', 'ban']) await teste(`promoção após exclusão impede ${acao}`, async c => {
    await c.ligar(acao); c.sock.aoApagar = () => { c.sock.membros.find(p => p.id === COMUM).admin = 'admin' }
    await c.processar(); assert.equal(await c.total(), 0); assert.equal(c.remocoes.length, 0)
  })
  for (const mudanca of [{ ativo: false }, { limite: 5000 }, { acao: 'apagar' }]) await teste('revalida configuração antes da expulsão', async c => {
    await c.ligar('ban'); c.sock.aoApagar = () => config.definir(G, mudanca, 'adm'); await c.processar(); assert.equal(c.remocoes.length, 0)
  })
  await teste('erro de envio contido e não repete adv', async c => {
    await c.ligar('adv'); c.sock.erroEnvio = true; await c.processar(); await c.processar(); assert.equal(await c.total(), 1); assert.equal(c.exclusoes.length, 2)
  })
  await teste('proteções anteriores têm prioridade sem consultar banco', async c => {
    await c.ligar('adv'); const m = c.msg(); c.mongo.config.falhar = true
    assert.equal((await mod.processarLote(c.sock, [m], 'notify', new Set([`${G}:${m.key.id}`]))).size, 0); assert.equal(c.exclusoes.length, 0)
  })
  await teste('lote processa mensagens além da primeira', async c => {
    await c.ligar(); const r = await mod.processarLote(c.sock, [c.msg('oi'), c.msg(), c.msg()], 'notify'); assert.equal(r.size, 2); assert.equal(c.exclusoes.length, 2)
  })
  await teste('memória limitada e limpeza por TTL', async c => {
    for (let i = 0; i <= mod.MAX; i++) await c.processar('oi')
    assert.equal(mod.__tamanhoCacheTeste(), mod.MAX)
    c.avancar(120001); await c.processar('oi'); assert.equal(mod.__tamanhoCacheTeste(), 1)
  })
  await teste('produção Mongo: coleções e TTL, sem índice _id extra', async () => {
    const indices = [], cols = { configLimiteCaractere: fake(), ocorrenciasLimiteCaractere: fake(), cooldownsLimiteCaractere: fake() }
    for (const [nome, col] of Object.entries(cols)) col.createIndex = async (campos, opcoes) => indices.push({ nome, campos, opcoes })
    class MongoClient { async connect() {} db(nome) { assert.equal(nome, 'offline'); return { collection: n => cols[n] } } }
    const m = { exports: {} }
    new Function('require', 'module', 'process', fs.readFileSync(require.resolve('../dados/limitecaractere-config'), 'utf8'))(
      n => n === 'mongodb' ? { MongoClient } : require(n), m, { env: { MONGODB_URI: 'mongodb://offline', MONGODB_DB: 'offline' } })
    assert.deepEqual(await m.exports.obter(G), config.PADRAO); assert.equal(indices.length, 2)
    for (const x of indices) { assert.deepEqual(x.campos, { expira_em: 1 }); assert.equal(x.opcoes.expireAfterSeconds, 0) }
  })
  console.log(`\nLimite de caracteres: ${passou} testes passaram.`)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => {
  lid.__definirConsultaSessaoTeste(null); ban.__definirGravacaoBlacklistTeste(); prefixos.__definirPrefixoTeste('/')
})
