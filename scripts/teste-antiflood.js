process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
process.env.OWNER_NUMBERS = '5511999990009'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fake = require('./helpers/colecao-figurinhas-fake')
const config = require('../dados/antiflood-config')
const mod = require('../dados/moderacao-antiflood')
const cmd = require('../comandos/admin/antiflood')
const advertencias = require('../advertencias')
const lid = require('../lid')
const ban = require('../comandos/admin/ban')
require('../prefixo').__definirPrefixoTeste('/')
const G = '111@g.us', H = '222@g.us', PN = n => `${n}@s.whatsapp.net`
const ADM = PN('5511777770000'), COMUM = PN('5511888880000'), BOT = PN('5511666660000'), DONO = PN('5511999990009'), GRUPO_DONO = PN('5511555550000')
let passou = 0
function cenario() {
  let agora = 1800000000000
  const mongo = { config: fake(), eventos: fake(), cooldowns: fake() }
  config.__definirColecoesTeste(mongo); mod.__limparTeste(() => agora)
  mongo.cooldowns.updateOne = async (filtro, mudanca) => {
    if (mongo.cooldowns.falhar) throw new Error('Mongo offline')
    const d = mongo.cooldowns.docs.find(d => d._id === filtro._id && d.ate <= filtro.ate.$lte)
    if (!d) return { modifiedCount: 0 }; Object.assign(d, mudanca.$set); return { modifiedCount: 1 }
  }
  advertencias.__definirColecaoTeste(fake())
  lid.__definirConsultaSessaoTeste(async () => null)
  ban.__definirGravacaoBlacklistTeste(() => { return undefined })
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
  const msg = (sender = COMUM, texto = 'https://example.com', jid = G) => ({ key: { remoteJid: jid, participant: sender, id: `msg-${++seq}`, fromMe: false }, messageTimestamp: Math.floor(agora / 1000), message: { conversation: texto } })
  async function executar(acao = 'on', autor = ADM, jid = G, texto) { return cmd.executar(sock, jid, msg(autor, '', jid), texto || `/antiflood ${acao}`) }
  return { mongo, sock, msg, executar, envios, remocoes,
    avancar(ms) { agora += ms },
    async ligar(acao = 'apagar') { await config.definir(G, { ativo: true, acao }, ADM.split('@')[0]) },
    async rajada(n = 7, sender = COMUM, jid = G) { let r; for (let i=0;i<n;i++) r = await mod.processar(sock, msg(sender, 'texto', jid)); return r },
    get exclusoes() { return envios.filter(e => e.delete) }, get anuncios() { return envios.filter(e => e.text?.includes('💀 Punição: Expulsão')) } }
}
async function teste(nome, fn) { await fn(cenario()); passou++; console.log(`✅ ${nome}`) }
async function main() {
  await teste('padrões e grupos isolados', async c => { assert.deepEqual(await config.obter(G), config.PADRAO); await c.ligar(); assert.equal((await config.obter(H)).ativo, false) })
  await teste('on/off/status/config e persistência após reload', async c => {
    await c.executar(); await c.executar('limite 8 20'); await c.executar('acao ban'); await c.executar('config'); assert.match(c.envios.at(-1).text, /8 mensagens em 20s/)
    const path = require.resolve('../dados/antiflood-config'), antigo = require.cache[path]; delete require.cache[path]
    try { const novo = require(path); novo.__definirColecoesTeste(c.mongo); assert.deepEqual(await novo.obter(G), { ativo:true, limite:8, janela:20, acao:'ban' }) } finally { require.cache[path] = antigo }
    await c.executar('off'); assert.equal((await config.obter(G)).ativo, false)
  })
  for (const autor of [ADM, '777@lid', DONO, '999@lid', GRUPO_DONO, '555@lid']) await teste(`autor autorizado ${autor}`, async c => { await c.executar('on', autor); assert.equal((await config.obter(G)).ativo, true) })
  for (const autor of [COMUM, '888@lid', `${ADM.split('@')[0]}@lid`]) await teste(`autor recusado ${autor}`, async c => { await c.executar('on', autor); assert.equal((await config.obter(G)).ativo, false) })
  for (const arg of ['limite 2 10','limite 31 10','limite 6 2','limite 6 61','limite 6.5 10','limite 6 10 extra','acao x','on extra','']) await teste(`config inválida ${arg}`, async c => { await c.executar(arg); assert.equal(c.mongo.config.docs.length, 0) })
  await teste('prefixo personalizado no uso', async c => { require('../prefixo').__definirPrefixoTeste('!'); await c.executar(''); assert.match(c.envios.at(-1).text, /!antiflood/); require('../prefixo').__definirPrefixoTeste('/') })
  await teste('privado não configura', async c => { await c.executar('on', DONO, DONO); assert.equal(c.mongo.config.docs.length, 0) })
  await teste('seis permitidas, sétima apagada, nenhuma advertência', async c => { await c.ligar(); assert.equal(await c.rajada(6), false); assert.equal(c.exclusoes.length, 0); assert.equal(await c.rajada(1), true); assert.equal(c.exclusoes.length, 1); assert.equal(await advertencias.contarAdvertencias(COMUM.split('@')[0],G),0) })
  await teste('janela expira exatamente no limite', async c => { await c.ligar(); await c.rajada(6); c.avancar(10000); assert.equal(await c.rajada(1), false) })
  await teste('grupos têm contadores separados', async c => { await c.ligar(); await config.definir(H,{ativo:true,acao:'apagar'},'adm'); await c.rajada(6); assert.equal(await c.rajada(1,COMUM,H),false); assert.equal(c.exclusoes.length,0) })
  await teste('PN e LID compartilham contador e cooldown', async c => { await c.ligar('adv'); await c.rajada(6); await c.rajada(1,'888@lid'); await c.rajada(3); assert.equal(await advertencias.contarAdvertencias(COMUM.split('@')[0],G),1); assert.equal(c.exclusoes.length,4) })
  for (const tipo of ['conversation','extendedTextMessage','imageMessage','videoMessage','audioMessage','stickerMessage','documentMessage']) await teste(`conta ${tipo} sem download`, async c => { await c.ligar(); await c.rajada(6); const m=c.msg(); m.message={ [tipo]: tipo==='conversation'?'x':{text:'x',caption:'x'} }; assert.equal(await mod.processar(c.sock,m),true); assert.equal(c.exclusoes.length,1) })
  for (const wrapper of ['ephemeralMessage','viewOnceMessage','viewOnceMessageV2','documentWithCaptionMessage']) await teste(`normaliza ${wrapper}`, async c => { await c.ligar(); await c.rajada(6); const m=c.msg(); m.message={ [wrapper]:{message:{imageMessage:{caption:'x'}}} }; assert.equal(await mod.processar(c.sock,m),true) })
  for (const autor of [BOT,'666@lid',ADM,'777@lid',DONO,'999@lid',GRUPO_DONO,'555@lid']) await teste(`protegido ${autor}`, async c => { await c.ligar('ban'); await c.rajada(10,autor); assert.equal(c.exclusoes.length,0); assert.equal(c.remocoes.length,0) })
  for (const invalidar of [m=>{m.key.fromMe=true},m=>{m.messageStubType=1},m=>{m.message={protocolMessage:{}}},m=>{delete m.messageTimestamp},m=>{m.messageTimestamp-=61},m=>{m.messageTimestamp+=10},m=>{m.key.participant='desconhecido@lid'}]) await teste('ignora evento não confiável', async c => { await c.ligar(); await c.rajada(6); const m=c.msg(); invalidar(m); await mod.processar(c.sock,m); assert.equal(c.exclusoes.length,0) })
  await teste('append histórico ignorado', async c => { await c.ligar(); for(let i=0;i<10;i++) await mod.processar(c.sock,c.msg(),'append'); assert.equal(c.exclusoes.length,0) })
  await teste('Long timestamp Baileys', async c => { await c.ligar(); await c.rajada(6); const m=c.msg(),n=m.messageTimestamp; m.messageTimestamp={toNumber:()=>n}; await mod.processar(c.sock,m); assert.equal(c.exclusoes.length,1) })
  await teste('duplicados simultâneos contam e apagam uma vez', async c => { await c.ligar(); const m=c.msg(); await Promise.all(Array.from({length:10},()=>mod.processar(c.sock,m))); await c.rajada(5); assert.equal(c.exclusoes.length,0); const excesso=c.msg(); await Promise.all(Array.from({length:10},()=>mod.processar(c.sock,excesso))); assert.equal(c.exclusoes.length,1) })
  await teste('rajada concorrente gera uma advertência', async c => { await c.ligar('adv'); await Promise.all(Array.from({length:20},()=>mod.processar(c.sock,c.msg()))); assert.equal(c.exclusoes.length,14); assert.equal(await advertencias.contarAdvertencias(COMUM.split('@')[0],G),1) })
  await teste('cooldown 30s, janela limpa e nova advertência', async c => { await c.ligar('adv'); await c.rajada(7); c.avancar(29000); await c.rajada(7); assert.equal(await advertencias.contarAdvertencias(COMUM.split('@')[0],G),1); c.avancar(1000); await c.rajada(1); assert.equal(await advertencias.contarAdvertencias(COMUM.split('@')[0],G),2) })
  await teste('limite setlimiteadv compartilhado e arquivo após status200', async c => { await c.ligar('adv'); await advertencias.definirLimiteAdvertencias(G,1,ADM.split('@')[0]); await c.rajada(7); assert.equal(c.remocoes.length,1); assert.equal(await advertencias.contarAdvertencias(COMUM.split('@')[0],G),0); assert.match(c.envios.at(-1).text,/removido após confirmação/) })
  await teste('ban direto confirmado sem advertências', async c => { await c.ligar('ban'); await c.rajada(7); assert.equal(c.remocoes.length,1); assert.equal(c.anuncios.length,1); assert.equal(await advertencias.contarAdvertencias(COMUM.split('@')[0],G),0) })
  for(const status of ['403','500','vazio','throw']) await teste(`ban não confirmado ${status}`, async c => { await c.ligar('ban'); c.sock.status=status; if(status==='vazio')c.sock.semStatus=true; if(status==='throw')c.sock.erroRemocao=true; await c.rajada(9); assert.equal(c.remocoes.length,1); assert.equal(c.anuncios.length,0) })
  await teste('promoção durante exclusão impede advertência', async c => { await c.ligar('adv'); c.sock.aoApagar=()=>{c.sock.membros.find(p=>p.id===COMUM).admin='admin'}; await c.rajada(7); assert.equal(await advertencias.contarAdvertencias(COMUM.split('@')[0],G),0) })
  await teste('desativação durante exclusão impede ban', async c => { await c.ligar('ban'); c.sock.aoApagar=()=>config.definir(G,{ativo:false},'adm'); await c.rajada(7); assert.equal(c.remocoes.length,0) })
  await teste('bot sem ADM não pune', async c => { await c.ligar('adv'); c.sock.membros.find(p=>p.id===BOT).admin=null; await c.rajada(7); assert.equal(c.exclusoes.length,0); assert.equal(await advertencias.contarAdvertencias(COMUM.split('@')[0],G),0) })
  await teste('Mongo desconhecido preserva fluxo e não pune', async c => { c.mongo.config.falhar=true; assert.equal(await c.rajada(7),false); assert.equal(c.exclusoes.length,0) })
  await teste('falha reserva não gera efeitos', async c => { await c.ligar('adv'); c.mongo.eventos.falhar=true; await c.rajada(7); assert.equal(c.exclusoes.length,0) })
  await teste('falha de download inexistente; exclusão recusada não duplica adv', async c => { await c.ligar('adv'); c.sock.erroDelete=true; await c.rajada(9); assert.equal(await advertencias.contarAdvertencias(COMUM.split('@')[0],G),1) })
  await teste('hard tem prioridade na sétima, bloqueia nova adv no cooldown', async c => { await c.ligar('adv'); await c.rajada(6); const m=c.msg(); const set=new Set([`${G}:${m.key.id}`]); assert.equal((await mod.processarLote(c.sock,[m],'notify',set)).size,1); await c.rajada(1); assert.equal(c.exclusoes.length,1); assert.equal(await advertencias.contarAdvertencias(COMUM.split('@')[0],G),0) })
  await teste('coleções Mongo de produção e TTL sem índice _id extra', async () => {
    const indices=[], cols={configAntiflood:fake(),ocorrenciasAntiflood:fake(),cooldownsAntiflood:fake()}
    for (const [nome,col] of Object.entries(cols)) col.createIndex=async (campos,opcoes)=>indices.push({nome,campos,opcoes})
    class MongoClient { async connect() {} db(nome) { assert.equal(nome,'offline'); return {collection:n=>cols[n]} } }
    const m={exports:{}}
    new Function('require','module','process',fs.readFileSync(require.resolve('../dados/antiflood-config'),'utf8'))(n=>n==='mongodb'?{MongoClient}:require(n),m,{env:{MONGODB_URI:'mongodb://offline',MONGODB_DB:'offline'}})
    assert.deepEqual(await m.exports.obter(G),config.PADRAO); assert.equal(indices.length,2)
    for(const x of indices) { assert.deepEqual(x.campos,{expira_em:1}); assert.equal(x.opcoes.expireAfterSeconds,0) }
  })
  await teste('cooldown Mongo sobrevive à limpeza dos contadores', async c => { await c.ligar('adv'); await c.rajada(7); mod.__limparTeste(()=>1800000000000); await c.rajada(7); assert.equal(await advertencias.contarAdvertencias(COMUM.split('@')[0],G),1) })
  await teste('participantes distintos têm cooldown independente', async c => { await c.ligar('adv'); const outro=PN('5511222220000'); c.sock.membros.push({id:outro}); await c.rajada(7); await c.rajada(7,outro); assert.equal(await advertencias.contarAdvertencias(outro.split('@')[0],G),1); assert.equal(c.exclusoes.length,2) })
  await teste('mensagem atrasada fora da janela não provoca flood', async c => { await c.ligar(); await c.rajada(6); const m=c.msg(); m.messageTimestamp-=15; assert.equal(await mod.processar(c.sock,m),false); assert.equal(c.exclusoes.length,0) })
  await teste('configuração corrompida não pune', async c => { c.mongo.config.docs.push({_id:G,ativo:true,limite:0,janela:10,acao:'ban'}); assert.equal(await c.rajada(7),false); assert.equal(c.remocoes.length,0) })
  await teste('cooldown indisponível impede todos os efeitos', async c => { await c.ligar('adv'); c.mongo.cooldowns.falhar=true; await c.rajada(7); assert.equal(c.exclusoes.length,0); assert.equal(await advertencias.contarAdvertencias(COMUM.split('@')[0],G),0) })
  await teste('ban adv recusado mantém contador e não anuncia sucesso', async c => { await c.ligar('adv'); await advertencias.definirLimiteAdvertencias(G,1,'adm'); c.sock.status='403'; await c.rajada(7); assert.equal(await advertencias.contarAdvertencias(COMUM.split('@')[0],G),1); assert.match(c.envios.at(-1).text,/expulsão não foi confirmada/); assert.equal(c.remocoes.length,1) })
  await teste('lote sem tipo não conta mensagens', async c => { await c.ligar(); const lote=Array.from({length:8},()=>c.msg()); assert.equal((await mod.processarLote(c.sock,lote)).size,0); assert.equal(c.exclusoes.length,0) })
  console.log(`Antiflood: ${passou} testes passaram.`)
}
main().catch(e=>{console.error(e); process.exitCode=1})
