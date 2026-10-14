// Offline: Mongo/Cloudinary/WhatsApp mocks; JPEG/PNG decoding is real.
process.env.MONGODB_URI=''
process.env.MONGO_URI_RPG=''
const assert=require('node:assert/strict')
const {Readable}=require('node:stream')
const {randomUUID}=require('node:crypto')
const {Jimp,JimpMime}=require('jimp')
const {criarCatalogo,palavraValida}=require('../gartic-catalogo')
const {criarRepositorio}=require('../dados/gartic-mongo')
const {criarCloudinary}=require('../dados/gartic-cloudinary')
const media=require('../dados/gartic-midia')
const helper=require('./helpers/gartic-fake')
const prefixo=require('../prefixo')
const {OWNER_NUMBERS}=require('../config')
const lid=require('../lid')
const O='5511999900001@s.whatsapp.net',O2='5511999900002@s.whatsapp.net',N='5511888800001@s.whatsapp.net',L='700001@lid',G='100@g.us'
const donosAntes=[...OWNER_NUMBERS]
OWNER_NUMBERS.push(O.split('@')[0],O2.split('@')[0])
lid.__definirConsultaSessaoTeste(async()=>null)
let png,jpg,foto,passou=0,fixtures=[]
function fixture(opts={}) {
  const mongo=opts.mongo||helper.criarMongo(),sdk=helper.criarSdk(jpg),repo=criarRepositorio(async()=>mongo)
  const f={mongo,sdk,repo,enviadas:[],agora:10000,timers:new Map(),downloads:0,participantes:[{id:L,phoneNumber:O},{id:N},{id:O2}],...opts}
  f.sock={user:{id:'5511666600001@s.whatsapp.net'},
    groupMetadata:async()=>{if(f.semMeta)throw new Error('offline');return {participants:f.participantes}},
    sendMessage:async(jid,c)=>{f.enviadas.push({jid,...c})}}
  f.cloud=criarCloudinary(sdk.sdk,sdk.http,sdk.ambiente)
  f.msg=(autor=O,quoted={imageMessage:{mimetype:'image/png'}})=>({key:{remoteJid:G,participant:autor,fromMe:false},message:{extendedTextMessage:{text:'/gartic-add',contextInfo:{stanzaId:'foto',participant:N,quotedMessage:quoted}}}})
  f.service=criarCatalogo({repo,cloud:f.cloud,agora:()=>f.agora,
    agendar:(fn)=>{const id=randomUUID();f.timers.set(id,fn);return id},limpar:id=>f.timers.delete(id),codigo:()=> 'codigo-teste',
    extrair:async(sock,jid,msg)=>{f.downloads++;return media.extrair(sock,jid,msg,async()=>Readable.from([f.bytes||png]))},...f.deps})
  f.exec=(a,t,autor=O,jid=G,msg=f.msg(autor))=>f.service.executar(a,f.sock,jid,msg,t)
  f.add=(palavra='cachorro',autor=O)=>f.exec('add','/gartic-add '+palavra,autor)
  f.preview=palavra=>f.exec('remover','/gartic-remover '+palavra)
  f.confirm=(autor=O,jid=G)=>f.exec('remover','/gartic-remover confirmar codigo-teste',autor,jid)
  fixtures.push(f);return f
}
async function testar(nome,fn){try{await fn();passou++;console.log('OK '+nome)}finally{for(const f of fixtures.splice(0))f.service.fechar();prefixo.__definirPrefixoTeste('/')}}
async function main(){
  png=await new Jimp({width:20,height:10,color:0x336699ff}).getBuffer(JimpMime.png)
  foto=await media.validar(png);jpg=foto.buffer
  prefixo.__definirPrefixoTeste('/')
  await testar('palavra NFC preserva acentos e normaliza chave/categoria',async()=>{
    assert.equal(palavraValida('  Ma\u00e7\u00e3  ').palavra,'Ma\u00e7\u00e3');assert.equal(palavraValida('Mac\u0327a\u0303').palavraChave,'maca')
    assert.equal(palavraValida('cachorro').categoria,'animais');assert.equal(palavraValida('objeto inventado').categoria,'cat\u00e1logo')
    for(const p of ['../x','a/b','a\\b','abc.js','<img>','123','a','x'.repeat(61)])assert.throws(()=>palavraValida(p))
  })
  await testar('cadastro: valida foto, upload SDK e grava metadados ativos no Mongo',async()=>{
    const f=fixture();await f.add('Ma\u00e7\u00e3');const doc=[...f.mongo.imagens.docs.values()][0]
    assert.equal(doc.palavra,'Ma\u00e7\u00e3');assert.equal(doc.palavraChave,'maca');assert.equal(doc.ativo,true);assert.equal(doc.estado,'ativo');assert(doc.dataCadastro instanceof Date)
    assert.equal(doc._id,foto.hash);assert.equal(doc.hash,foto.hash);assert(doc.cadastroId);assert.match(doc.publicId,/^hipnos\/gartic\/[a-f0-9-]{36}$/);assert(doc.secureUrl.startsWith('https:'))
    assert.equal(f.downloads,1);assert.equal(f.sdk.uploads.length,1);assert.equal(f.mongo.controles.docs.size,0)
  })
  await testar('upload SDK: folder, resource image, nomes opacos, overwrite OFF e timeout',async()=>{
    const f=fixture();await f.add();const o=f.sdk.uploads[0]
    assert.equal(o.asset_folder,'hipnos/gartic');assert.equal(o.resource_type,'image');assert.equal(o.overwrite,false);assert.equal(o.use_filename,false);assert.equal(o.timeout,20000)
    assert(!o.public_id.includes('cachorro'));assert.deepEqual(o.allowed_formats,['jpg','png'])
    assert(!JSON.stringify(f.enviadas).includes('secret-fake'))
  })
  await testar('duplicata global da mesma imagem nao faz outro upload',async()=>{
    const f=fixture();await f.add();await f.add('gato');assert.equal(f.sdk.uploads.length,1);assert.equal(f.mongo.imagens.docs.size,1);assert(f.enviadas.at(-1).text.includes('mesma imagem'))
  })
  await testar('palavra com varias imagens e sorteio em duas etapas',async()=>{
    const f=fixture();await f.add();f.bytes=await new Jimp({width:30,height:10,color:0x993366ff}).getBuffer(JimpMime.png);await f.add()
    assert.equal(f.mongo.imagens.docs.size,2);f.mongo.random=()=>0.9
    const doc=await f.repo.sortear('animais');assert.equal(doc.palavra,'cachorro')
    const etapas=f.mongo.pipelines.at(-2).etapas;assert(etapas.some(e=>e.$group));assert(etapas.some(e=>e.$sample))
    assert(f.mongo.pipelines.at(-1).etapas.some(e=>e.$sample));assert.equal(f.sdk.requests.length,0)
  })
  await testar('catalogo vazio/inativo nao e sorteado',async()=>{
    const f=fixture();assert.equal(await f.repo.sortear(),null);await f.add();await f.repo.desativarPalavra('cachorro');assert.equal(await f.repo.sortear(),null)
  })
  await testar('download so da selecionada, otimizacao JPEG e teto de bytes',async()=>{
    const f=fixture();await f.add();const doc=await f.repo.sortear();const b=await f.cloud.baixar(doc)
    assert(Buffer.isBuffer(b));assert.equal(f.sdk.requests.length,1);assert.equal(f.sdk.requests[0].o.timeout,20000);assert.equal(f.sdk.requests[0].o.maxRedirects,0)
    assert.equal(f.sdk.urlOptions.transformation[0].width,1280);assert.equal(f.sdk.urlOptions.format,'jpg')
    f.sdk.buffer=Buffer.from('<html>');await assert.rejects(f.cloud.baixar(doc))
    f.sdk.falharDownload=true;await assert.rejects(f.cloud.baixar(doc))
  })
  await testar('URLs/IDs inseguros nunca chegam a download nem destroy',async()=>{
    const f=fixture();await assert.rejects(f.cloud.destruir('../outra-pasta'));assert.equal(f.sdk.destroy.length,0)
    await assert.rejects(f.cloud.baixar({publicId:'hipnos/gartic/'+randomUUID(),version:1,secureUrl:'http://localhost:1234/x'}));assert.equal(f.sdk.requests.length,0)
  })
  await testar('credenciais ausentes geram aviso sem download',async()=>{
    const f=fixture();delete f.sdk.ambiente.CLOUDINARY_API_SECRET;await f.add();assert.equal(f.downloads,0);assert.equal(f.sdk.uploads.length,0);assert(f.enviadas.at(-1).text.includes('CLOUDINARY_API_SECRET'))
  })
  await testar('usuario comum nao baixa, nao grava e nao faz upload',async()=>{
    const f=fixture();await f.add('cachorro',N);assert.equal(f.downloads,0);assert.equal(f.sdk.uploads.length,0);assert.equal(f.mongo.imagens.docs.size,0)
    await f.exec('lista','/gartic-lista',N);await f.exec('remover','/gartic-remover cachorro',N);assert.equal(f.service.__teste.previas.size,0)
  })
  await testar('dono LID comprovado pode cadastrar',async()=>{
    const f=fixture();await f.add('cachorro',L);assert.equal(f.sdk.uploads.length,1)
  })
  await testar('metadados ambiguos e remetente ausente nao autorizam',async()=>{
    const f=fixture({participantes:[{id:L,phoneNumber:O},{id:N,phoneNumber:O}]});await f.add('cachorro',L);assert.equal(f.downloads,0)
    const semAutor=f.msg();delete semAutor.key.participant;await f.exec('add','/gartic-add cachorro',O,G,semAutor);assert.equal(f.downloads,0)
  })
  await testar('LID com digitos do dono e metadados indisponiveis nao autorizam',async()=>{
    const f=fixture();await f.add('cachorro',O.replace('@s.whatsapp.net','@lid'));assert.equal(f.downloads,0)
    f.semMeta=true;await f.add('cachorro',L);assert.equal(f.downloads,0)
  })
  await testar('view-once, video e documento rejeitados antes do download',async()=>{
    const f=fixture();for(const quoted of [{videoMessage:{}},{documentMessage:{mimetype:'image/png'}},{viewOnceMessage:{message:{imageMessage:{}}}},{imageMessage:{viewOnce:true}}])await f.exec('add','/gartic-add cachorro',O,G,f.msg(O,quoted))
    assert.equal(f.sdk.uploads.length,0);assert.equal(f.mongo.imagens.docs.size,0)
  })
  await testar('limite anunciado, magic bytes, corrupcao e dimensoes invalidas',async()=>{
    const f=fixture();await f.exec('add','/gartic-add cachorro',O,G,f.msg(O,{imageMessage:{fileLength:9*1024*1024}}));assert.equal(f.sdk.uploads.length,0)
    await assert.rejects(media.validar(Buffer.from('<svg></svg>')));await assert.rejects(media.validar(Buffer.from([255,216,255,217])))
    await assert.rejects(media.validar(Buffer.alloc(8*1024*1024+1)))
    const gigante=Buffer.from(png);gigante.writeUInt32BE(10000,16);await assert.rejects(media.validar(gigante))
    const corrupta=Buffer.from(png);corrupta[corrupta.length-5]^=255;await assert.rejects(media.validar(corrupta))
  })
  await testar('renovacao Baileys 404 e stream com tamanho real controlado',async()=>{
    const f=fixture();let tentativas=0;f.sock.updateMediaMessage=async m=>m
    const r=await media.extrair(f.sock,G,f.msg(),async()=>{if(!tentativas++)throw {output:{statusCode:404}};return Readable.from([png])});assert.equal(r.hash,foto.hash);assert.equal(tentativas,2)
    await assert.rejects(media.extrair(f.sock,G,f.msg(),async()=>Readable.from([Buffer.alloc(8*1024*1024+1)])))
  })
  await testar('falha Mongo antes do upload nao cria asset',async()=>{
    const f=fixture();f.mongo.falhar=(a,d)=>{if(a==='insert'&&d.palavra)throw new Error('banco offline')};await f.add();assert.equal(f.sdk.uploads.length,0);assert.equal(f.mongo.imagens.docs.size,0)
  })
  await testar('upload nao confirmado deixa reserva inativa para revisao',async()=>{
    const f=fixture();f.sdk.falharUpload=true;await f.add();const doc=[...f.mongo.imagens.docs.values()][0];assert.equal(doc.ativo,false);assert.equal(doc.estado,'upload_incerto');assert.equal(await f.repo.sortear(),null)
    assert(!JSON.stringify(f.enviadas).includes('segredo ficticio'));assert.equal(f.mongo.controles.docs.size,0)
  })
  await testar('upload OK + Mongo falha: desativa, destroy confirmado e limpa',async()=>{
    const f=fixture();f.mongo.falhar=(a,d)=>{if(a==='update'&&d.estado==='ativo')throw new Error('falha gravacao')};await f.add()
    assert.equal(f.sdk.uploads.length,1);assert.equal(f.sdk.destroy.length,1);assert.equal(f.mongo.imagens.docs.size,0);assert(f.enviadas.at(-1).text.includes('seguran'))
  })
  await testar('upload incerto + destroy not found nao esquece reserva de sucesso tardio',async()=>{
    const f=fixture();f.sdk.falharUpload=true;await f.add();f.sdk.sdk.uploader.destroy=async()=>({result:'not found'})
    await f.preview('cachorro');await f.confirm();assert.equal(f.mongo.imagens.docs.size,1);assert.equal([...f.mongo.imagens.docs.values()][0].ativo,false)
    assert.equal([...f.mongo.imagens.docs.values()][0].estado,'upload_incerto')
  })
  await testar('Mongo indisponivel apos upload nao apaga asset possivelmente ativo',async()=>{
    const f=fixture();f.mongo.falhar=(a)=>{if(a==='update')throw new Error('offline')};await f.add();assert.equal(f.sdk.destroy.length,0);assert.equal(f.mongo.imagens.docs.size,1)
    assert.equal([...f.mongo.imagens.docs.values()][0].ativo,false);assert(f.enviadas.at(-1).text.includes('pend'))
  })
  await testar('limpeza com Cloudinary falhando fica inativa e recuperavel',async()=>{
    const f=fixture();f.sdk.falharDelete=true;f.mongo.falhar=(a,d)=>{if(a==='update'&&d.estado==='ativo')throw new Error('offline')};await f.add();const d=[...f.mongo.imagens.docs.values()][0];assert.equal(d.ativo,false);assert.equal(d.estado,'limpeza_pendente')
    f.sdk.falharDelete=false;f.mongo.falhar=null;await f.preview('cachorro');await f.confirm();assert.equal(f.mongo.imagens.docs.size,0)
  })
  await testar('previa nao altera dados; confirmacao exclui arquivos e registros',async()=>{
    const f=fixture();await f.add();await f.preview('cachorro');assert.equal(f.sdk.destroy.length,0);assert.equal([...f.mongo.imagens.docs.values()][0].ativo,true)
    await f.confirm();assert.equal(f.sdk.destroy.length,1);assert.equal(f.mongo.imagens.docs.size,0);assert.equal(f.timers.size,0)
    await f.confirm();assert.equal(f.sdk.destroy.length,1)
  })
  await testar('confirmacao vinculada a dono, conversa, token e prazo',async()=>{
    const f=fixture();await f.add();await f.preview('cachorro');await f.confirm(O2);await f.confirm(O,'101@g.us');await f.exec('remover','/gartic-remover confirmar errado');assert.equal(f.sdk.destroy.length,0)
    f.agora+=120001;await f.confirm();assert.equal(f.sdk.destroy.length,0)
  })
  await testar('cancelar previa nao exclui nada',async()=>{
    const f=fixture();await f.add();await f.preview('cachorro');await f.exec('remover','/gartic-remover cancelar');await f.confirm();assert.equal(f.sdk.destroy.length,0);assert.equal(f.timers.size,0)
  })
  await testar('alteracao depois da previa exige nova confirmacao',async()=>{
    const f=fixture();await f.add();await f.preview('cachorro');f.bytes=jpg;await f.add();await f.confirm();assert.equal(f.sdk.destroy.length,0);assert(f.enviadas.at(-1).text.includes('mudou'))
  })
  await testar('exclusao parcial deixa pendentes inativas e retry idempotente',async()=>{
    const f=fixture();await f.add();f.bytes=jpg;await f.add();let primeira=true
    const destruir=f.cloud.destruir;f.cloud.destruir=async(...args)=>{if(primeira){primeira=false;throw new Error('rede')}return destruir(...args)}
    await f.preview('cachorro');await f.confirm();assert.equal(f.mongo.imagens.docs.size,1);assert.equal([...f.mongo.imagens.docs.values()][0].ativo,false);assert.equal(await f.repo.sortear(),null)
    await f.preview('cachorro');await f.confirm();assert.equal(f.mongo.imagens.docs.size,0)
  })
  await testar('Mongo falha ao desativar: nao inicia nenhuma exclusao Cloudinary',async()=>{
    const f=fixture();await f.add();await f.preview('cachorro');f.mongo.falhar=a=>{if(a==='updateMany')throw new Error('offline')};await f.confirm();assert.equal(f.sdk.destroy.length,0);assert.equal([...f.mongo.imagens.docs.values()][0].ativo,true)
  })
  await testar('troca da conta Cloudinary nao apaga em conta errada',async()=>{
    const f=fixture();await f.add();await f.preview('cachorro');f.sdk.ambiente.CLOUDINARY_CLOUD_NAME='outra-conta';await f.confirm()
    assert.equal(f.sdk.destroy.length,0);assert.equal(f.mongo.imagens.docs.size,1);assert.equal([...f.mongo.imagens.docs.values()][0].ativo,false)
  })
  await testar('Cloudinary removido + Mongo delete falha permanece inativo',async()=>{
    const f=fixture();await f.add();await f.preview('cachorro');f.mongo.falhar=(a,d)=>{if(a==='delete'&&d._id===foto.hash)throw new Error('offline')};await f.confirm();assert.equal(f.sdk.destroy.length,1);assert.equal([...f.mongo.imagens.docs.values()][0].ativo,false)
    f.mongo.falhar=null;await f.preview('cachorro');await f.confirm();assert.equal(f.mongo.imagens.docs.size,0)
  })
  await testar('listagem paginada conta palavras, imagens e pendencias',async()=>{
    const f=fixture();for(let i=0;i<12;i++)f.mongo.imagens.docs.set('id'+i,{_id:'id'+i,palavraChave:'palavra'+i,palavra:'palavra'+i,ativo:i!==0,estado:i?'ativo':'upload_incerto'})
    const r=await f.repo.listar(2);assert.equal(r.palavras,12);assert.equal(r.imagens,12);assert.equal(r.ativas,11);assert.equal(r.itens.length,2)
    await f.exec('lista','/gartic-lista 2');assert(f.enviadas.at(-1).text.includes('2/2'))
    await f.exec('lista','/gartic-lista 999');assert(f.enviadas.at(-1).text.includes('inv'))
  })
  await testar('prefixo dinamico no cadastro/listagem/confirmacao',async()=>{
    const f=fixture();prefixo.__definirPrefixoTeste('!');await f.exec('add','!gartic-add cachorro');assert.equal(f.mongo.imagens.docs.size,1)
    await f.exec('remover','!gartic-remover cachorro');assert(f.enviadas.at(-1).text.includes('!gartic-remover confirmar'))
    await f.exec('remover','!gartic-remover confirmar codigo-teste');assert.equal(f.mongo.imagens.docs.size,0)
  })
  await testar('concorrencia local e entre instancias protegida por Mongo',async()=>{
    const mongo=helper.criarMongo(),f=fixture({mongo}),g=fixture({mongo});let liberar,entrou=false
    const upload=f.cloud.upload;f.cloud.upload=async(...a)=>{entrou=true;await new Promise(r=>{liberar=r});return upload(...a)}
    const operacao=f.add();while(!entrou)await new Promise(r=>setImmediate(r))
    await f.add('gato');await g.add('gato');assert.equal(g.downloads,0);assert.equal(g.sdk.uploads.length,0)
    liberar();await operacao;assert.equal(f.sdk.uploads.length,1);assert.equal(mongo.controles.docs.size,0)
  })
  await testar('trava de processo interrompido nao e roubada automaticamente',async()=>{
    const f=fixture();f.mongo.controles.docs.set('mutacao',{_id:'mutacao',token:'outra-operacao'});await f.add();assert.equal(f.sdk.uploads.length,0);assert.equal(f.downloads,0)
  })
  await testar('conexao ausente bloqueia download e upload',async()=>{
    const f=fixture({deps:{disponivel:()=>false}});await f.add();assert.equal(f.downloads,0);assert.equal(f.sdk.uploads.length,0)
  })
  await testar('reautorizacao antes do upload impede efeito apos perda de permissao',async()=>{
    let vezes=0;const f=fixture({deps:{dono:async()=>++vezes===1?'dono':null}});await f.add();assert.equal(f.downloads,1);assert.equal(f.sdk.uploads.length,0)
  })
  console.log(passou+' testes offline do catalogo passaram.')
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{OWNER_NUMBERS.splice(0,OWNER_NUMBERS.length,...donosAntes);for(const f of fixtures)f.service.fechar()})
