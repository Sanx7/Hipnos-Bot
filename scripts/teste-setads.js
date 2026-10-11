process.env.MONGODB_URI = ''; process.env.MONGO_URI_RPG = ''
const assert = require('assert/strict')
const { Readable } = require('stream')
const ads = require('../anuncios'), storage = require('../dados/ads-storage'), midia = require('../dados/ads-midia'), tempo = require('../dados/ads-tempo')
const { criarStorage } = require('./helpers/ads-fake')
const comando = require('../comandos/admin/setads'), config = require('../config')
require('../prefixo').__definirPrefixoTeste('!')
const { __definirConsultaSessaoTeste } = require('../lid')
const grupo = '120363000000001@g.us', outro = '120363000000002@g.us', admin = '5511990000001@s.whatsapp.net', membro = '5511990000002@s.whatsapp.net', lid = '888000001@lid'
let total = 0
function ok(v, m) { assert.ok(v, m); total++ }
function igual(a,b) { assert.deepEqual(a,b); total++ }
async function rejeita(p, padrao) { await assert.rejects(p, padrao); total++ }
const foto = Buffer.from([255,216,255,224,0,4,0,0,255,217]), video = Buffer.concat([Buffer.from([0,0,0,20]), Buffer.from('ftypisom0000isom')])
const txt = { tipo: 'texto', texto: 'Regras do grupo' }
function citado(node) { return { key: { remoteJid: grupo, participant: admin, id: 'comando' }, message: { extendedTextMessage: { text: '/setads criar', contextInfo: { stanzaId: 'foto-citada', participant: membro, quotedMessage: node } } } } }
function socket() {
  return { user: { id: admin }, envios: [], async groupMetadata(jid) { return { id: jid, owner: membro, participants: [{ id: admin, lid, admin: 'admin' }, { id: membro, admin: null }] } }, async sendMessage(jid, conteudo) { this.envios.push({ jid, conteudo }); return {} } }
}
let agora, s, sock, timers, workers
function reset() {
  workers?.forEach(w => w.parar()); agora = Date.parse('2026-10-10T12:00:00Z'); s = criarStorage(); storage.__definirTeste(s); sock = socket(); timers = 0; workers = []
}
function worker() { const w = ads.criarAgendador({ relogio: () => agora, intervalo: () => { timers++; return { unref() {} } }, cancelar: () => {} }); workers.push(w); return w }
async function ativo(jid = grupo, conteudo = txt) { const d = await ads.criar(jid, conteudo, '5511990000001', agora); await ads.alterar(jid, d.id, 'intervalo', '15', 'autor', agora); return ads.alterar(jid, d.id, 'retomar', null, 'autor', agora) }
async function main() {
  reset()
  igual(tempo.proxima({ modo: 'diario', horario: '09:00' }, agora), Date.parse('2026-10-11T12:00:00Z'))
  igual(tempo.proxima({ modo: 'diario', horario: '09:01' }, agora), agora + 60000)
  igual(tempo.proxima({ modo: 'diario', horario: '00:01' }, Date.parse('2026-12-31T23:59:00-03:00')), Date.parse('2027-01-01T00:01:00-03:00'))
  igual(tempo.proxima({ modo: 'intervalo', minutos: 1440 }, agora), agora + 86400000)
  igual(tempo.proxima({ modo: 'diario', horario: '09:00' }, Date.parse('2018-12-01T10:00:00Z')), Date.parse('2018-12-01T11:00:00Z'))
  assert.throws(() => tempo.proxima({ modo: 'diario', horario: '24:00' }, agora)); total++
  for (const modo of ['ephemeralMessage','documentWithCaptionMessage','editedMessage','associatedChildMessage']) {
    const msg = citado({ [modo]: { message: { imageMessage: { caption: 'legenda', mimetype: 'image/jpeg' } } } })
    const d = await midia.extrair(sock, grupo, msg, '', async (alvo, tipo) => { igual(tipo, 'stream'); igual(alvo.key.id, 'foto-citada'); igual(alvo.key.participant, membro); return Readable.from([foto]) })
    igual(d.tipo, 'foto'); igual(d.texto, 'legenda'); igual(d.buffer, foto)
  }
  for (const modo of ['viewOnceMessage','viewOnceMessageV2','viewOnceMessageV2Extension']) {
    await rejeita(midia.extrair(sock, grupo, citado({ ephemeralMessage: { message: { [modo]: { message: { imageMessage: {} } } } } }), '', () => { throw new Error('Não baixar') }), /visualização única/)
  }
  await rejeita(midia.extrair(sock, grupo, citado({ imageMessage: { viewOnce: true } }), '', () => {}), /visualização única/)
  let downloads = 0, renew = 0
  sock.updateMediaMessage = async alvo => { renew++; igual(alvo.key.id, 'foto-citada'); return alvo }
  const d = await midia.extrair(sock, grupo, citado({ imageMessage: {} }), 'nova legenda', async () => { if (!downloads++) throw { output: { statusCode: 410 } }; return Readable.from([foto]) })
  igual(renew,1); igual(d.texto, 'nova legenda')
  await rejeita(midia.extrair(sock, grupo, citado({ imageMessage: {} }), '', async () => { throw { status: 403 } }), /baixar/)
  downloads = 0
  await midia.extrair(sock, grupo, citado({ imageMessage: {} }), '', async () => { if (!downloads++) throw { status: 404 }; return Readable.from([foto]) }); igual(downloads,2)
  sock.updateMediaMessage = async () => ({ message: { viewOnceMessageV2: { message: { imageMessage: {} } } } })
  await rejeita(midia.extrair(sock, grupo, citado({ imageMessage: {} }), '', async () => { throw { status: 410 } }), /visualização única/)
  await rejeita(midia.extrair(sock, grupo, citado({ imageMessage: { fileLength: 9 * 1024 * 1024 } }), '', async () => { throw new Error('Não baixar') }), /limite/)
  await rejeita(midia.extrair(sock, grupo, citado({ videoMessage: {} }), '', async () => Readable.from([Buffer.alloc(16 * 1024 * 1024 + 1)])), /limite/)
  await rejeita(midia.extrair(sock, grupo, citado({ imageMessage: {} }), '', async () => Readable.from([Buffer.alloc(8 * 1024 * 1024 + 1)])), /limite/)
  await rejeita(midia.extrair(sock, grupo, citado({ imageMessage: {} }), '', async () => Readable.from([])), /vazia/)
  await rejeita(midia.extrair(sock, grupo, citado({ imageMessage: {} }), '', async () => Readable.from([Buffer.from('texto') ])), /Formato/)
  const v = await midia.extrair(sock, grupo, citado({ videoMessage: { caption: 'video' } }), '', async () => Readable.from([video])); igual(v.tipo, 'video')
  const texto = await midia.extrair(sock, grupo, { message: { conversation: '/setads criar oi' } }, '😀'.repeat(3000)); igual(Array.from(texto.texto).length,3000)
  await rejeita(midia.extrair(sock, grupo, { message: {} }, '😀'.repeat(3001)), /3000/)
  await rejeita(midia.extrair(sock, grupo, citado({ imageMessage: { caption: 'x'.repeat(3001) } }), '', async () => Readable.from([foto])), /3000/)
  const fotoDoc = await ads.criar(grupo, d, 'autor', agora), videoDoc = await ads.criar(grupo, v, 'autor', agora)
  igual(fotoDoc.ativo,false); igual(fotoDoc.proximo,null); ok(s.arquivos.has(fotoDoc.midia)); ok(!Object.hasOwn(s.ads.docs[0], 'buffer'))
  const payload = await midia.preparar(fotoDoc,s); igual(payload.image,foto); ok(!payload.mentions && !payload.contextInfo)
  igual((await midia.preparar(videoDoc,s)).video, video)
  await rejeita(ads.alterar(grupo, fotoDoc.id, 'retomar', null, 'autor', agora), /Configure/)
  await rejeita(ads.alterar(grupo, fotoDoc.id, 'intervalo', '14', 'autor', agora), /15 a 1440/)
  await rejeita(ads.alterar(grupo, fotoDoc.id, 'intervalo', '1441', 'autor', agora), /15 a 1440/)
  await ads.alterar(grupo, fotoDoc.id, 'horario', '10:00', 'autor', agora)
  let atual = await ads.alterar(grupo, fotoDoc.id, 'intervalo', '15', 'autor', agora); igual(atual.horario,null); igual(atual.ativo,false)
  atual = await ads.alterar(grupo, fotoDoc.id, 'retomar', null, 'autor', agora); igual(atual.proximo,agora + 900000)
  const confirmadoAntes = await ads.excluir(grupo,fotoDoc.id,'autor',null,agora)
  await ads.alterar(grupo, fotoDoc.id, 'pausar', null, 'autor', agora); igual((await ads.obter(grupo,fotoDoc.id)).proximo,null)
  await rejeita(ads.excluir(grupo,fotoDoc.id,'autor',confirmadoAntes,agora), /alterado/)
  await rejeita(ads.obter(outro,fotoDoc.id), /não encontrado/)
  const concorrentes = await Promise.allSettled(Array.from({ length: 8 }, () => ads.criar(grupo,txt,'autor',agora)))
  igual(concorrentes.filter(r => r.status === 'fulfilled').length,3); igual((await ads.listar(grupo)).length,5)
  const token = await ads.excluir(grupo,fotoDoc.id,'autor',null,agora)
  await rejeita(ads.excluir(grupo,fotoDoc.id,'outroautor',token,agora), /Confirmação/)
  await rejeita(ads.excluir(outro,fotoDoc.id,'autor',token,agora), /não encontrado/)
  await rejeita(ads.excluir(grupo,fotoDoc.id,'autor',token,agora+60001), /expirada/)
  const novoToken = await ads.excluir(grupo,fotoDoc.id,'autor',null,agora)
  await ads.excluir(grupo,fotoDoc.id,'autor',novoToken,agora); ok(!s.arquivos.has(fotoDoc.midia)); igual((await ads.listar(grupo)).length,4)
  await rejeita(ads.excluir(grupo,fotoDoc.id,'autor',novoToken,agora), /não encontrado/)
  reset(); s.salvar = async () => { throw new Error('GridFS falhou') }
  await rejeita(ads.criar(grupo,d,'autor',agora), /GridFS/); igual(s.ads.docs.length,0)
  reset(); await ativo(); const w = worker(); await w.abrir(sock); await w.abrir(sock); igual(timers,1)
  agora += 900000; await w.verificar(); igual(sock.envios.length,1); igual(sock.envios[0].jid,grupo); ok(!sock.envios[0].conteudo.mentions)
  await w.verificar(); igual(sock.envios.length,1)
  w.fechar(sock); agora += 1800000; await w.verificar(); igual(sock.envios.length,1)
  await w.abrir(sock); igual(sock.envios.length,1); ok(s.ads.docs[0].proximo > agora)
  const outroSock = socket(); w.fechar(sock); await w.abrir(outroSock); w.fechar(sock); agora += 900000; await w.verificar(); igual(outroSock.envios.length,1)
  reset(); await ativo(); const a = worker(), b = worker(); await a.abrir(sock); await b.abrir(sock); agora += 900000
  await Promise.all([a.verificar(),b.verificar()]); igual(sock.envios.length,1)
  reset(); await ativo(); const velho = worker(), novo = worker(); await velho.abrir(sock); await novo.abrir(sock); agora += 900000
  let liberar, iniciou
  const espera = new Promise(resolve => { iniciou = resolve }), metaVelha = sock.groupMetadata.bind(sock)
  sock.groupMetadata = async jid => { iniciou(); return new Promise(resolve => { liberar = () => resolve({ id: jid, participants: [] }) }) }
  const primeira = velho.verificar(); await espera
  s.ads.docs[0].leaseAte = agora - 1; sock.groupMetadata = metaVelha
  await novo.verificar(); liberar(); await primeira; igual(sock.envios.length,1)
  reset(); await ativo(); const exp = worker(); await exp.abrir(sock); agora += 900000; s.ads.docs[0].leaseAte = agora + ads.LEASE
  await exp.verificar(); igual(sock.envios.length,0); s.ads.docs[0].leaseAte = agora - 1; await exp.verificar(); igual(sock.envios.length,1)
  reset(); await ativo(); const perdido = worker(); await perdido.abrir(sock); agora += 900000 + ads.JANELA + 1; await perdido.verificar(); igual(sock.envios.length,0); ok(s.ads.docs[0].proximo > agora)
  reset(); await ativo(); const fail = worker(); await fail.abrir(sock); sock.sendMessage = async () => { throw new Error('rede') }
  for (let i = 0; i < 3; i++) { agora = s.ads.docs[0].proximo; await fail.verificar() }
  igual(s.ads.docs[0].ativo,false); igual(s.ads.docs[0].falhas,3)
  reset(); await ativo(); const crash = worker(); await crash.abrir(sock)
  const update = s.ads.updateOne.bind(s.ads)
  s.ads.updateOne = async (f,u,o) => { if (u.$set?.entrega === 'enviada') throw new Error('Mongo após envio'); return update(f,u,o) }
  agora += 900000; await crash.verificar(); igual(sock.envios.length,1); await crash.verificar(); igual(sock.envios.length,1); ok(s.ads.docs[0].proximo > agora)
  reset(); await ativo(); const ambiguo = worker(); await ambiguo.abrir(sock)
  const updateOriginal = s.ads.updateOne.bind(s.ads), enviarOriginal = sock.sendMessage.bind(sock)
  sock.sendMessage = async (...args) => { await enviarOriginal(...args); s.ads.updateOne = async () => { throw new Error('Processo caiu após aceitação') }; throw new Error('Conexão perdida') }
  agora += 900000; await ambiguo.verificar(); igual(sock.envios.length,1); igual(s.ads.docs[0].entrega,'incerta')
  s.ads.updateOne = updateOriginal; sock.sendMessage = enviarOriginal
  const reiniciado = worker(); await reiniciado.abrir(sock); agora += ads.LEASE + 1; await reiniciado.verificar(); igual(sock.envios.length,1)
  reset(); await ativo(); const mongoFail = worker(); const encontrar = s.ads.find
  s.ads.find = () => { throw new Error('Mongo desconectado') }; await mongoFail.abrir(sock); agora += 900000; await mongoFail.verificar(); igual(sock.envios.length,0)
  s.ads.find = encontrar; await mongoFail.verificar(); igual(sock.envios.length,0); agora += 10000; await mongoFail.verificar(); igual(sock.envios.length,1)
  reset(); await ativo(); const semConexao = worker(); await semConexao.abrir(sock)
  sock.groupMetadata = async jid => { semConexao.fechar(sock); return { id: jid, participants: [] } }
  agora += 900000; await semConexao.verificar(); igual(sock.envios.length,0)
  reset(); await ativo(grupo,d); const ausente = worker(); await ausente.abrir(sock); s.arquivos.clear(); agora += 900000; await ausente.verificar(); igual(sock.envios.length,0); igual(s.ads.docs[0].falhas,1); ok(s.ads.docs[0].proximo > agora)
  reset(); await ativo(); const naoGrupo = worker(); await naoGrupo.abrir(sock); sock.groupMetadata = async () => ({ id: outro, participants: [] }); agora += 900000; await naoGrupo.verificar(); igual(sock.envios.length,0)
  reset(); await ativo(); const cancel = worker(); await cancel.abrir(sock)
  const metadata = sock.groupMetadata.bind(sock)
  sock.groupMetadata = async jid => { await ads.alterar(grupo,1,'pausar',null,'autor',agora); return metadata(jid) }
  agora += 900000; await cancel.verificar(); igual(sock.envios.length,0)
  reset(); await ativo(grupo); await ativo(grupo); await ativo(outro); const rate = worker(); await rate.abrir(sock); agora += 900000
  await rate.verificar(); igual(sock.envios.length,1); agora += 30000; await rate.verificar(); igual(sock.envios.length,2); agora += 30000; await rate.verificar(); igual(sock.envios.length,3)
  reset(); for (let i = 0; i < 5; i++) await ativo(grupo,{ tipo: 'texto', texto: `Anúncio ${i}` })
  const cinco = worker(); await cinco.abrir(sock); agora += 900000; await cinco.verificar()
  ok(s.ads.docs.filter(d => d.proximo === agora + 30000).length === 4)
  for (let i = 0; i < 4; i++) { agora += 30000; await cinco.verificar() }
  igual(sock.envios.length,5); igual(new Set(sock.envios.map(e => e.conteudo.text)).size,5)
  reset(); await ativo(grupo,d); const image = worker(); await image.abrir(sock); agora += 900000; await image.verificar(); igual(sock.envios[0].conteudo.image,foto)
  reset(); await ativo(grupo,v); const movie = worker(); await movie.abrir(sock); agora += 900000; await movie.verificar(); igual(sock.envios[0].conteudo.video,video)
  reset(); const diario = await ads.criar(grupo,txt,'autor',agora)
  await ads.alterar(grupo,diario.id,'horario','09:01','autor',agora); await ads.alterar(grupo,diario.id,'retomar',null,'autor',agora)
  const dia = worker(); await dia.abrir(sock); agora += 60000; await dia.verificar(); igual(sock.envios.length,1); igual(s.ads.docs[0].proximo,Date.parse('2026-10-11T12:01:00Z'))
  reset(); const remover = await ads.criar(grupo,d,'autor',agora), confirmar = await ads.excluir(grupo,remover.id,'autor',null,agora)
  s.apagar = async () => { throw new Error('GridFS indisponível') }; await ads.excluir(grupo,remover.id,'autor',confirmar,agora); igual(s.ads.docs[0].estado,'excluindo'); ok(s.arquivos.has(remover.midia))
  s.apagar = async id => s.arquivos.delete(id); agora += ads.LEASE + 1; await ads.limpar(agora); igual(s.ads.docs.length,0); ok(!s.arquivos.has(remover.midia))
  s.ads.docs.push({ _id: `${grupo}:1`, id: 1, grupo, geracao: 'abandonada', estado: 'criando', leaseAte: agora - 1, midia: null }); await ads.limpar(agora); igual(s.ads.docs.length,0)
  reset(); __definirConsultaSessaoTeste(async () => null)
  for (const sender of [admin,lid,membro]) {
    await comando.executar(sock,grupo,{ key: { participant: sender }, message: {} }, '!ads criar texto autorizado')
    ok(sock.envios.at(-1).conteudo.text.includes('guardado'))
  }
  const naoAdmin = '5511990000003@s.whatsapp.net'
  await comando.executar(sock,grupo,{ key: { participant: naoAdmin }, message: {} }, '!ads criar negado'); ok(sock.envios.at(-1).conteudo.text.includes('Apenas'))
  await comando.executar(sock,grupo,{ key: { participant: '999999@lid' }, message: {} }, '!ads criar negado'); ok(sock.envios.at(-1).conteudo.text.includes('Apenas'))
  const dono = `${config.OWNER_NUMBERS[0]}@s.whatsapp.net`
  await comando.executar(sock,grupo,{ key: { participant: dono }, message: {} }, '!anuncioauto criar dono'); ok(sock.envios.at(-1).conteudo.text.includes('guardado'))
  await comando.executar(sock,'5511990000001@s.whatsapp.net',{ key: { participant: admin }, message: {} }, '!ads criar privado'); ok(sock.envios.at(-1).conteudo.text.includes('somente'))
  await comando.executar(sock,grupo,{ key: { participant: admin }, message: {} }, '!anuncios intervalo 1 15'); igual((await ads.obter(grupo,1)).minutos,15)
  await comando.executar(sock,grupo,{ key: { participant: admin }, message: {} }, '!ads ver 1'); igual(sock.envios.at(-2).conteudo.text,'texto autorizado')
  const listaAntes = (await ads.listar(grupo)).length
  const metaOriginal = sock.groupMetadata; sock.groupMetadata = async () => { throw new Error('erro com conteúdo privado') }
  await comando.executar(sock,grupo,{ key: { participant: admin }, message: {} }, '!ads criar impedido'); igual((await ads.listar(grupo)).length,listaAntes); ok(!JSON.stringify(sock.envios).includes('conteúdo privado'))
  sock.groupMetadata = metaOriginal
  await comando.executar(sock,grupo,{ key: { participant: admin }, message: {} }, '!ads'); ok(sock.envios.at(-1).conteudo.text.includes('!setads'))
  workers.forEach(w => w.parar()); __definirConsultaSessaoTeste(null)
  console.log(`OK: ${total} verificações offline de /setads.`)
}
main().catch(e => { workers?.forEach(w => w.parar()); console.error(e); process.exitCode = 1 })
