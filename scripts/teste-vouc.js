// Offline: fake sockets/collections, real Baileys payloads and AES-GCM votes.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const crypto = require('node:crypto')
const fs = require('node:fs')
const { decryptPollVote, cleanMessage, proto, jidNormalizedUser } = require('@whiskeysockets/baileys')
const mod = require('../dados/vouc-rodadas')
const banco = require('../dados/perguntas-vouc')
const fake = require('./helpers/enquete-nativa-fake')
const prefixo = require('../prefixo')
const estado = require('../estado-bot')
const adulto = require('../modoadulto')
const comando = require('../comandos/menu-brincadeiras/verdadeouconsequencia')
const A = '5511900000001@s.whatsapp.net', B = '5511900000002@s.whatsapp.net'
const L = '900001@lid', G = '120363000000000000@g.us', G2 = '120363000000000001@g.us'
let passou = 0
const fixtures = []
function fixture(opcoes = {}) {
  const f = { agora: 1000000, ligado: true, adulto: false, conectado: true, timers: new Map(), envios: [], originais: [], participantes: [{id:L,phoneNumber:A}, {id:B}], ...opcoes }
  let timerId = 0
  f.sock = { user:{id:fake.BOT,lid:'900099@lid'}, ev:new EventEmitter(),
    groupMetadata: async () => { if(f.falharMeta) throw new Error('metadata indisponivel'); return {participants:f.participantes} },
    sendMessage: async (jid, conteudo) => {
      if(f.falharEnvio || (conteudo.poll && f.falharPoll) || (conteudo.mentions && f.falharResultado)) throw new Error('envio indisponivel')
      f.envios.push({jid,conteudo})
      const enviada = await fake.mensagemEnviada(jid,conteudo)
      if(conteudo.poll) { if(f.semSecret) delete enviada.message.messageContextInfo.messageSecret; f.originais.push(enviada) }
      return enviada
    }
  }
  const deps = { agora:()=>f.agora, ligado:async()=>f.ligado, adulto:async()=>f.adulto,
    disponivel:()=>f.conectado, random:()=>f.aleatorio ?? 0,
    agendar:(fn,ms)=> { const id=++timerId; f.timers.set(id,{fn,em:f.agora+ms}); return id }, limpar:id=>f.timers.delete(id), ...f.deps }
  f.r = mod.criarGerenciador(f.sock,deps)
  f.msg = (autor=A, alvo=null) => ({key:{remoteJid:G,participant:autor,fromMe:false,id:'pedido'},message:alvo ? {extendedTextMessage:{text:'/vouc',contextInfo:{mentionedJid:[alvo]}}} : {conversation:'/vouc'}})
  f.abrir = (autor=A,alvo=null,grupo=G)=>f.r.abrir(grupo,f.msg(autor,alvo))
  f.voto = (i,autor=A,indices=[i],timestamp=f.agora+1,poll=f.originais.at(-1)) => fake.voto({mensagemEnquete:poll,opcoes:mod.OPCOES},poll.key.remoteJid,autor,indices,{timestamp})
  f.votar = (i,autor=A) => f.r.processarMensagem(f.voto(i,autor))
  f.atualizacao = mensagem => {
    const poll = f.originais.find(p => p.key.id === mensagem.message.pollUpdateMessage.pollCreationMessageKey.id)
    const voto = decryptPollVote(mensagem.message.pollUpdateMessage.vote, { pollCreatorJid: f.sock.user.id,
      pollMsgId: poll.key.id, pollEncKey: poll.message.messageContextInfo.messageSecret,
      voterJid: jidNormalizedUser(mensagem.key.participant) })
    return [{ key: poll.key, update: { pollUpdates: [{ pollUpdateMessageKey: mensagem.key, vote: voto,
      senderTimestampMs: mensagem.message.pollUpdateMessage.senderTimestampMs }] } }]
  }
  f.resultados = ()=>f.envios.filter(e=>e.conteudo.mentions)
  f.avancar = ms=>{f.agora+=ms; for(const {fn,em} of [...f.timers.values()]) if(em<=f.agora) fn()}
  fixtures.push(f)
  return f
}
async function testar(nome,fn) {
  try { await fn(); passou++; console.log('OK '+nome) }
  finally { for(const f of fixtures.splice(0)) f.r.fechar(); prefixo.__definirPrefixoTeste('/') }
}
async function main() {
  prefixo.__definirPrefixoTeste('/')
  await testar('aliases preservados e sem comandos globais de fallback',async()=>{
    assert.deepEqual(comando.aliases,['vouc','verdadeconsequencia','verdadeouconseq'])
    assert.equal(comando.nome,'verdadeouconsequencia')
  })
  await testar('banco intacto: 369 verdades, 206 desafios, sem duplicatas',async()=>{
    assert.equal(banco.VERDADES.length,369); assert.equal(banco.DESAFIOS.length,206)
    for(const lista of [banco.VERDADES,banco.DESAFIOS]) assert.equal(new Set(lista.map(p=>p.toLowerCase().trim())).size,lista.length)
    for(const p of banco.VERDADES) assert(p.endsWith('?'))
    for(const p of banco.DESAFIOS) assert(p.endsWith('.'))
  })
  await testar('criacao: poll real, tres opcoes e um voto; estado vinculado',async()=>{
    const f=fixture();await f.abrir();const poll=f.envios[0].conteudo.poll
    assert.equal(poll.selectableCount,1);assert.deepEqual(poll.values,mod.OPCOES)
    assert.match(poll.name,/HIPNOS/);assert(f.originais[0].message.messageContextInfo.messageSecret)
    const r=[...f.r.__teste.porJogador.values()][0]
    assert.equal(r.grupo,G);assert.equal(r.criadaEm,f.agora);assert.equal(r.expiraEm,f.agora+120000)
    assert.equal(r.original.key.id,f.originais[0].key.id);assert.equal(r.estado,'aguardando')
  })
  await testar('desconexao durante leitura ON/OFF nao abre enquete nem timer',async()=>{
    let chamadas=0,resolver
    const f=fixture({deps:{ligado:()=>++chamadas===2?new Promise(r=>{resolver=r}):Promise.resolve(true)}})
    const abertura=f.abrir();while(!resolver)await new Promise(r=>setImmediate(r))
    f.sock.ev.emit('connection.update',{connection:'close'});resolver(true);await abertura
    assert.equal(f.originais.length,0);assert.equal(f.timers.size,0);assert.equal(f.r.__teste.porJogador.size,0)
  })
  await testar('mudanca de associacao JID/LID entre consultas nao autoriza outro eleitor',async()=>{
    const f=fixture();await f.abrir();let consultas=0
    f.sock.groupMetadata=async()=>({participants:++consultas===1?[{id:L,phoneNumber:A},{id:B}]:[{id:'900002@lid',phoneNumber:A},{id:L,phoneNumber:B}]})
    const original=f.originais[0]
    await f.r.processarAtualizacoes([{key:original.key,update:{pollUpdates:[{pollUpdateMessageKey:{remoteJid:G,participant:L},vote:{selectedOptions:[crypto.createHash('sha256').update(mod.OPCOES[0]).digest()]},senderTimestampMs:f.agora+1}]}}])
    assert.equal(f.resultados().length,0)
  })
  for(const [i,titulo] of [[0,'VERDADE'],[1,'CONSEQU\u00caNCIA'],[2,'VERDADE']]) await testar('voto cifrado: '+titulo+' / opcao '+i,async()=>{
    const f=fixture();await f.abrir();await f.votar(i)
    assert.equal(f.resultados().length,1);assert(f.resultados()[0].conteudo.text.includes(titulo))
    assert.deepEqual(f.resultados()[0].conteudo.mentions,[A]);assert.equal(f.timers.size,0);assert.equal(f.r.__teste.porEnquete.size,0)
  })
  await testar('aleatorio pode escolher consequencia',async()=>{
    const f=fixture({aleatorio:0.9});await f.abrir();await f.votar(2);assert.match(f.resultados()[0].conteudo.text,/CONSEQU\u00caNCIA/)
  })
  await testar('voto nao autorizado nao determina resultado',async()=>{
    const f=fixture();await f.abrir();await f.votar(0,B);assert.equal(f.resultados().length,0);await f.votar(1,A);assert.equal(f.resultados().length,1)
  })
  await testar('mencao: so mencionado vota, nao iniciador',async()=>{
    const f=fixture();await f.abrir(A,B);await f.votar(0,A);assert.equal(f.resultados().length,0);await f.votar(0,B);assert.deepEqual(f.resultados()[0].conteudo.mentions,[B])
  })
  await testar('JID/LID: voto LID autentica par dos metadados',async()=>{
    const f=fixture();await f.abrir(A,L);await f.votar(0,L);assert.deepEqual(f.resultados()[0].conteudo.mentions,[A])
  })
  await testar('sufixo de dispositivo normalizado',async()=>{
    const f=fixture();await f.abrir(A.replace('@',':7@'));await f.votar(0,L.replace('@',':3@'));assert.equal(f.resultados().length,1)
  })
  await testar('packet LID com cifra PN usa apenas o par comprovado',async()=>{
    const f=fixture();await f.abrir();const v=f.voto(0,A);v.key.participant=L;await f.r.processarMensagem(v);assert.equal(f.resultados().length,1)
  })
  await testar('criador LID autentica cifra da enquete',async()=>{
    const f=fixture();await f.abrir();const v=fake.voto({mensagemEnquete:f.originais[0],opcoes:mod.OPCOES},G,L,[0],{timestamp:f.agora+1,criador:f.sock.user.lid});await f.r.processarMensagem(v);assert.equal(f.resultados().length,1)
  })
  await testar('LID exato sem PN funciona; nao inventa telefone',async()=>{
    const f=fixture({participantes:[{id:L},{id:B}]});await f.abrir(L);await f.votar(0,L);assert.deepEqual(f.resultados()[0].conteudo.mentions,[L])
  })
  await testar('mesmos digitos em PN e LID nao autorizam',async()=>{
    const impostor='5511900000001@lid';const f=fixture({participantes:[{id:A},{id:impostor}]});await f.abrir(A);await f.votar(0,impostor);assert.equal(f.resultados().length,0)
  })
  await testar('identidade ambigua ou desconhecida nao abre rodada',async()=>{
    const f=fixture({participantes:[{id:L,phoneNumber:A},{id:B,phoneNumber:A}]});await f.abrir();assert.equal(f.originais.length,0)
    assert.equal(mod.identificar([{id:B}],L),null)
  })
  await testar('falha de metadados nao autoriza voto',async()=>{
    const f=fixture();await f.abrir();f.falharMeta=true;await f.votar(0);assert.equal(f.resultados().length,0)
  })
  await testar('duplicatas concorrentes enviam um unico resultado',async()=>{
    const f=fixture();await f.abrir();const v=f.voto(0);await Promise.all([f.r.processarMensagem(v),f.r.processarMensagem(v),f.r.processarMensagem(v)]);assert.equal(f.resultados().length,1)
  })
  await testar('primeira escolha valida vence alteracoes posteriores',async()=>{
    const f=fixture();await f.abrir();const v=f.voto(0),alterado=f.voto(1);await f.r.processarMensagem(v);await f.r.processarMensagem(alterado);assert.equal(f.resultados().length,1);assert.match(f.resultados()[0].conteudo.text,/VERDADE/)
  })
  await testar('remocao de voto nao sorteia; voto posterior valido decide',async()=>{
    const f=fixture();await f.abrir();await f.r.processarMensagem(f.voto(0,A,[],f.agora+2));assert.equal(f.resultados().length,0)
    await f.r.processarMensagem(f.voto(0,A,[0],f.agora+1));assert.equal(f.resultados().length,0)
    await f.r.processarMensagem(f.voto(1,A,[1],f.agora+3));assert.equal(f.resultados().length,1)
  })
  await testar('multivoto e opcao desconhecida nao sorteiam',async()=>{
    const f=fixture();await f.abrir();await f.r.processarMensagem(f.voto(0,A,[0,1]));assert.equal(f.resultados().length,0)
    const original=f.originais[0];await f.r.processarAtualizacoes([{key:original.key,update:{pollUpdates:[{pollUpdateMessageKey:{remoteJid:G,participant:A},vote:{selectedOptions:[Buffer.alloc(32)]},senderTimestampMs:f.agora+2}]}}]);assert.equal(f.resultados().length,0)
  })
  await testar('expiracao limpa timers e ignora voto/fallback tardios',async()=>{
    const f=fixture();await f.abrir();const v=f.voto(0);f.avancar(120000);await f.r.processarMensagem(v)
    assert.equal(await f.r.fallback(G,f.msg(),'/verdade'),false);assert.equal(f.resultados().length,0);assert.equal(f.r.__teste.porJogador.size,0);assert.equal(f.timers.size,0)
  })
  await testar('deadline vale mesmo antes do callback do timer',async()=>{
    const f=fixture();await f.abrir();const v=f.voto(0);f.agora+=120001;await f.r.processarMensagem(v);assert.equal(f.resultados().length,0);assert.equal(f.r.__teste.porJogador.size,0)
  })
  await testar('rodadas simultaneas independentes; duplicata do jogador bloqueada',async()=>{
    const f=fixture();await Promise.all([f.abrir(),f.abrir()]);assert.equal(f.originais.length,1)
    await f.abrir(B);const segundo=f.originais.at(-1);await f.abrir(A,null,G2);assert.equal(f.r.__teste.porJogador.size,3)
    await f.r.processarMensagem(f.voto(0,A,[0],f.agora+1,f.originais[0]));await f.r.processarMensagem(f.voto(1,B,[1],f.agora+2,segundo));assert.equal(f.resultados().length,2);assert.equal(f.r.__teste.porJogador.size,1)
  })
  await testar('ID real e grupo vinculados; enquete desconhecida ignorada',async()=>{
    const f=fixture();await f.abrir();const v=f.voto(0);v.message.pollUpdateMessage.pollCreationMessageKey={...v.message.pollUpdateMessage.pollCreationMessageKey,id:'outra'};assert.equal(await f.r.processarMensagem(v),false)
    const outro=f.voto(0);outro.key.remoteJid=G2;assert.equal(await f.r.processarMensagem(outro),false);assert.equal(f.resultados().length,0)
  })
  await testar('messages.update usa ID e autor real do voto',async()=>{
    const f=fixture();await f.abrir();const original=f.originais[0]
    const upd=autor=>[{key:original.key,update:{pollUpdates:[{pollUpdateMessageKey:{remoteJid:G,participant:autor},vote:{selectedOptions:[crypto.createHash('sha256').update(mod.OPCOES[1]).digest()]},senderTimestampMs:f.agora+1}]}}]
    await f.r.processarAtualizacoes(upd(B));assert.equal(f.resultados().length,0);await f.r.processarAtualizacoes(upd(L));await f.r.processarAtualizacoes(upd(L));assert.equal(f.resultados().length,1)
  })
  await testar('voto adulterado nao autentica e oferece fallback uma vez',async()=>{
    const f=fixture();await f.abrir();const v=f.voto(0);v.message.pollUpdateMessage.vote.encPayload[0]^=255
    await f.r.processarMensagem(v);await f.r.processarMensagem(v);assert.equal(f.resultados().length,0);assert.equal(f.envios.filter(e=>e.conteudo.text?.includes('interpretar')).length,1)
  })
  await testar('segredo ausente oferece fallback e nao presume voto',async()=>{
    const f=fixture({semSecret:true});await f.abrir();assert(f.envios.some(e=>e.conteudo.text?.includes('interpretar')));assert.equal(f.resultados().length,0);await f.r.fallback(G,f.msg(),'/verdade');assert.equal(f.resultados().length,1)
  })
  await testar('falha no envio da enquete permite fallback durante a rodada',async()=>{
    const f=fixture({falharPoll:true});await f.abrir();assert.equal(f.originais.length,0);assert.equal(f.r.__teste.porJogador.size,1);await f.r.fallback(G,f.msg(),'/consequencia');assert.equal(f.resultados().length,1)
  })
  await testar('fallback so participante, prefixo dinamico e somente durante rodada',async()=>{
    const f=fixture();prefixo.__definirPrefixoTeste('!');assert.equal(await f.r.fallback(G,f.msg(),'!verdade'),false);await f.abrir(A,B)
    assert.equal(await f.r.fallback(G,f.msg(A),'!verdade'),false);assert.equal(await f.r.fallback(G,f.msg(B),'!verdade extra'),false)
    assert.equal(await f.r.fallback(G,f.msg(B),'!consequencia'),true);assert.equal(f.resultados().length,1);assert.equal(await f.r.fallback(G,f.msg(B),'!consequencia'),false)
  })
  await testar('OFF bloqueia abertura, voto e fallback inclusive de dono',async()=>{
    const f=fixture({ligado:false});await f.abrir();assert.equal(f.envios.length,0);f.ligado=true;await f.abrir();f.ligado=false;await f.votar(0);assert.equal(await f.r.fallback(G,f.msg(),'/verdade'),false);assert.equal(f.resultados().length,0)
  })
  await testar('desconexao cancela rodada, remove listeners e nao envia',async()=>{
    const f=fixture();await f.abrir();const v=f.voto(0);f.conectado=false;f.sock.ev.emit('connection.update',{connection:'close'});await f.r.processarMensagem(v);assert.equal(f.resultados().length,0);assert.equal(f.timers.size,0)
    for(const ev of ['messages.update','group-participants.update','connection.update'])assert.equal(f.sock.ev.listenerCount(ev),0)
  })
  await testar('erro de envio do resultado nao causa retry nem duplicata',async()=>{
    const f=fixture();await f.abrir();const v=f.voto(0);f.falharResultado=true;await f.r.processarMensagem(v);f.falharResultado=false;await f.r.processarMensagem(v);assert.equal(f.resultados().length,0);assert.equal(f.r.__teste.porJogador.size,0)
  })
  await testar('saida do jogador por LID cancela apenas sua rodada',async()=>{
    const f=fixture();await f.abrir(A);await f.abrir(B);f.sock.ev.emit('group-participants.update',{id:G,action:'remove',participants:[{id:L,phoneNumber:A}]});assert.equal(f.r.__teste.porJogador.size,1);await f.votar(0,B);assert.equal(f.resultados().length,1)
  })
  await testar('participante ausente nos metadados nao recebe resultado',async()=>{
    const f=fixture();await f.abrir();f.participantes=[{id:B}];await f.votar(0);assert.equal(f.resultados().length,0);assert.equal(f.r.__teste.porJogador.size,0)
  })
  await testar('modo adulto filtra todas as frases novas nao classificadas',async()=>{
    const livres=mod.listas(false),todos=mod.listas(true)
    assert.deepEqual(todos.verdade,banco.VERDADES);assert.deepEqual(todos.desafio,banco.DESAFIOS)
    assert(!livres.verdade.includes(banco.VERDADES[124]));assert(!livres.desafio.includes(banco.DESAFIOS[112]))
    for(const cat of ['verdade','desafio'])assert(livres[cat].length>100)
    const f=fixture({aleatorio:0.999});await f.abrir();await f.votar(0);assert(f.resultados()[0].conteudo.text.includes(livres.verdade.at(-1)))
    const g=fixture({adulto:true,aleatorio:0.999});await g.abrir();await g.votar(0);assert(g.resultados()[0].conteudo.text.includes(banco.VERDADES.at(-1)))
  })
  await testar('modo adulto real e OFF real com colecoes fake',async()=>{
    estado.__definirColecaoTeste({findOne:async()=>({ligado:true})});adulto.__definirColecaoTeste({findOne:async()=>({ativo:true})})
    const f=fixture({deps:{ligado:()=>estado.obterLigado(),adulto:g=>adulto.modoAdultoAtivo(g)}});await f.abrir();assert.equal(f.originais.length,1);await f.votar(0);assert.equal(f.resultados().length,1)
    estado.__definirColecaoTeste({findOne:async()=>({ligado:false})});const g=fixture({deps:{ligado:()=>estado.obterLigado()}});await g.abrir();assert.equal(g.originais.length,0)
  })
  await testar('banco adulto indisponivel falha fechado',async()=>{
    adulto.__definirColecaoTeste({findOne:async()=>{throw new Error('offline')}})
    const f=fixture({aleatorio:0.999,deps:{adulto:g=>adulto.modoAdultoAtivo(g)}});await f.abrir();await f.votar(0);assert(f.resultados()[0].conteudo.text.includes(mod.listas(false).verdade.at(-1)))
  })
  await testar('modo adulto desligado durante consulta impede entrega +18',async()=>{
    let consultas=0;const f=fixture({aleatorio:124.5/369,deps:{adulto:async()=>++consultas===1}});await f.abrir();await f.votar(0);assert.equal(f.resultados().length,0);assert.equal(f.r.__teste.porJogador.size,0)
  })
  await testar('conclusao durante saida/expiracao nao continua apos await',async()=>{
    let resolver;const f=fixture({deps:{adulto:()=>new Promise(r=>{resolver=r})}});await f.abrir();const voto=f.votar(0)
    while(!resolver)await new Promise(r=>setImmediate(r));f.avancar(120000);resolver(true);await voto;assert.equal(f.resultados().length,0)
  })
  await testar('listeners constantes com multiplas rodadas',async()=>{
    const f=fixture();for(let i=0;i<10;i++){await f.abrir();await f.votar(0)}assert.equal(f.sock.ev.listenerCount('messages.update'),1);assert.equal(f.timers.size,0)
  })
  await testar('votos sem timestamp, anteriores ou fora do prazo nao decidem',async()=>{
    const f=fixture();await f.abrir()
    for(const timestamp of [NaN,f.agora-1,f.agora+120000])await f.r.processarMensagem(f.voto(0,A,[0],timestamp))
    assert.equal(f.resultados().length,0);await f.votar(0);assert.equal(f.resultados().length,1)
  })
  await testar('fallback LID resolve apenas a rodada do participante',async()=>{
    const f=fixture();await f.abrir(A);assert.equal(await f.r.fallback(G,f.msg(L),'/verdade'),true);assert.deepEqual(f.resultados()[0].conteudo.mentions,[A])
  })
  await testar('limpeza tardia de rodada expirada nao remove nova rodada',async()=>{
    let resolver;const f=fixture({deps:{adulto:()=>new Promise(r=>{resolver=r})}});await f.abrir();const voto=f.votar(0)
    while(!resolver)await new Promise(r=>setImmediate(r));f.avancar(120000);await f.abrir();resolver(true);await voto
    assert.equal(f.r.__teste.porJogador.size,1);assert.equal(f.r.__teste.porEnquete.size,1);assert.equal(f.resultados().length,0)
  })
  await testar('VOUC nao ocupa nem altera enquete existente no registro',async()=>{
    const jogos=require('../dados/jogos-ativos'),f=fixture(),dados={enquete:'independente'}
    jogos.registrarJogo(G,jogos.TIPOS.ENQUETE,dados)
    try { const original=jogos.obterJogo(G);await f.abrir();await f.votar(0);assert.equal(f.resultados().length,1);assert.equal(jogos.obterJogo(G),original) }
    finally { jogos.removerJogo(G,jogos.TIPOS.ENQUETE) }
  })
  await testar('pipeline rc14: cleanMessage, protobuf Long e voto GCM real',async()=>{
    const f=fixture();await f.abrir();const v=f.voto(0,L)
    v.message.pollUpdateMessage.pollCreationMessageKey.fromMe=false
    v.message.pollUpdateMessage.pollCreationMessageKey.participant=f.sock.user.lid
    v.message.pollUpdateMessage=proto.Message.PollUpdateMessage.decode(proto.Message.PollUpdateMessage.encode(v.message.pollUpdateMessage).finish())
    cleanMessage(v,f.sock.user.id,f.sock.user.lid)
    assert.equal(v.message.pollUpdateMessage.pollCreationMessageKey.fromMe,true)
    await f.r.processarMensagem(v);assert.equal(f.resultados().length,1)
  })
  await testar('mesmo voto em upsert/update: duas ordens e concorrencia enviam apenas uma resposta',async()=>{
    for(const ordem of ['upsert','update','juntos']) {
      const f=fixture();await f.abrir();const v=f.voto(0),updates=f.atualizacao(v)
      if(ordem==='juntos')await Promise.all([f.r.processarMensagem(v),f.r.processarAtualizacoes(updates)])
      else if(ordem==='upsert'){await f.r.processarMensagem(v);await f.r.processarAtualizacoes(updates)}
      else {await f.r.processarAtualizacoes(updates);await f.r.processarMensagem(v)}
      assert.equal(f.resultados().length,1);assert.equal(f.r.__teste.porJogador.size,0);assert.equal(f.timers.size,0)
    }
  })
  await testar('remocao nova em update bloqueia upsert antigo; replays apos conclusao ignorados',async()=>{
    const f=fixture();await f.abrir();const antiga=f.voto(0,A,[0],f.agora+1),removida=f.voto(0,A,[],f.agora+3),alterada=f.voto(1,A,[1],f.agora+4)
    const uAntiga=f.atualizacao(antiga),uRemovida=f.atualizacao(removida),uAlterada=f.atualizacao(alterada)
    await f.r.processarAtualizacoes(uRemovida);await f.r.processarMensagem(antiga);await f.r.processarAtualizacoes(uAntiga);await f.r.processarMensagem(removida)
    assert.equal(f.resultados().length,0)
    await f.r.processarMensagem(alterada);await f.r.processarAtualizacoes(uAlterada);await f.r.processarAtualizacoes(uRemovida)
    assert.equal(f.resultados().length,1);assert.match(f.resultados()[0].conteudo.text,/CONSEQU\u00caNCIA/)
  })
  await testar('update com grupo/ID/autor incorretos nao altera a rodada',async()=>{
    const f=fixture();await f.abrir();const updates=f.atualizacao(f.voto(0))
    await f.r.processarAtualizacoes([{...updates[0],key:{...updates[0].key,remoteJid:G2}}])
    await f.r.processarAtualizacoes([{...updates[0],key:{...updates[0].key,id:'outra-enquete'}}])
    const outraPessoa=f.atualizacao(f.voto(0,B,[0],f.agora+100))
    await f.r.processarAtualizacoes(outraPessoa);assert.equal(f.resultados().length,0)
    await f.r.processarAtualizacoes(updates);assert.equal(f.resultados().length,1)
  })
  await testar('expiracao permite nova rodada; votos antigos nao atingem a nova',async()=>{
    const f=fixture();await f.abrir();const v=f.voto(0),updates=f.atualizacao(v),id=f.originais[0].key.id
    f.avancar(120000);await f.abrir();assert.notEqual(f.originais.at(-1).key.id,id)
    await f.r.processarMensagem(v);await f.r.processarAtualizacoes(updates);assert.equal(f.resultados().length,0);assert.equal(f.r.__teste.porJogador.size,1)
    await f.votar(1);assert.equal(f.resultados().length,1);assert.equal(f.timers.size,0)
  })
  await testar('todos os 575 conteudos sao alcancaveis; modo comum so entrega os 415 livres',async()=>{
    for(const modoAdulto of [true,false]) {
      const f=fixture({adulto:modoAdulto}),listas=mod.listas(modoAdulto)
      let total=0
      for(const [indice,cat] of [[0,'verdade'],[1,'desafio']]) {
        for(let i=0;i<listas[cat].length;i++) {
          f.aleatorio=(i+0.5)/listas[cat].length
          await f.abrir();await f.votar(indice)
          assert(f.resultados().at(-1).conteudo.text.includes('\n'+listas[cat][i]+'\n'))
          total++
        }
      }
      assert.equal(total,modoAdulto?575:415);assert.equal(f.resultados().length,total);assert.equal(f.timers.size,0)
    }
  })
  await testar('desconexao durante consulta adulta cancela resultado e todos os timers',async()=>{
    let resolver;const f=fixture({deps:{adulto:()=>new Promise(r=>{resolver=r})}})
    await f.abrir(A);const v=f.voto(0),updates=f.atualizacao(v);await f.abrir(B)
    const voto=f.r.processarMensagem(v);while(!resolver)await new Promise(r=>setImmediate(r))
    f.sock.ev.emit('connection.update',{connection:'close'});assert.equal(f.timers.size,0);assert.equal(f.r.__teste.porJogador.size,0);assert.equal(f.r.__teste.porEnquete.size,0)
    resolver(true);await voto;await f.r.processarAtualizacoes(updates);assert.equal(f.resultados().length,0)
    await f.abrir();assert.equal(f.timers.size,0)
  })
  await testar('eleitor precisa continuar autorizado depois da consulta adulta',async()=>{
    let resolver;const f=fixture({deps:{adulto:()=>new Promise(r=>{resolver=r})}})
    await f.abrir();const voto=f.votar(0,L);while(!resolver)await new Promise(r=>setImmediate(r))
    f.participantes=[{id:'900002@lid',phoneNumber:A},{id:L,phoneNumber:B}];resolver(true);await voto
    assert.equal(f.resultados().length,0);assert.equal(f.r.__teste.porJogador.size,0);assert.equal(f.timers.size,0)
  })
  await testar('metadados id PN com campo lid separado autorizam a mesma identidade',async()=>{
    const f=fixture({participantes:[{id:A,lid:L},{id:B}]});await f.abrir(A,L);await f.votar(0,L)
    assert.deepEqual(f.resultados()[0].conteudo.mentions,[A])
  })
  console.log(passou+' testes offline passaram.')
}
main().catch(e=>{console.error(e);process.exitCode=1})
