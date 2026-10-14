// Offline gameplay regression. Real ffmpeg thumbnail helper; no external APIs.
process.env.MONGODB_URI=''
process.env.MONGO_URI_RPG=''
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const {Jimp,JimpMime}=require('jimp')
const gartic=require('../comandos/menu-brincadeiras/gartic')
const jogos=require('../dados/jogos-ativos')
const estado=require('../estado-bot')
const prefixo=require('../prefixo')
const {OWNER_NUMBERS}=require('../config')
const G='120363000000000000@g.us',A='5511888888888@s.whatsapp.net'
let passou=0,buffer
function ambiente(){
  const f={enviadas:[],selecoes:0,downloads:0,doc:{_id:'foto1',palavra:'Caf\u00e9',categoria:'comida'},ligado:true}
  f.sock={user:{id:'5511666666666@s.whatsapp.net'},groupMetadata:async()=>({participants:[]}),sendMessage:async(jid,conteudo)=>{if(f.falharImagem&&conteudo.image)throw new Error('rede');f.enviadas.push(conteudo);return {}}}
  f.msg={key:{remoteJid:G,participant:A,fromMe:false},message:{conversation:'/gartic'}}
  gartic._injetarCatalogo(async(cat,excluidas)=>{f.selecoes++;f.categoria=cat;f.excluidas=excluidas;return f.doc})
  gartic._injetarDownload(async()=>{f.downloads++;if(f.falharDownload)throw new Error('rede');return buffer})
  estado.__definirColecaoTeste({findOne:async()=>({ligado:f.ligado})})
  f.jogar=t=>gartic.executar(f.sock,G,f.msg,t||'/gartic')
  return f
}
function limpar(){const d=jogos.obterJogo(G)?.dados;if(d?.timer)clearTimeout(d.timer);jogos.limparJogos();prefixo.__definirPrefixoTeste('/')}
async function teste(nome,fn){try{await fn();passou++;console.log('OK '+nome)}finally{limpar()}}
async function main(){
  buffer=await new Jimp({width:32,height:20,color:0x669933ff}).getBuffer(JimpMime.jpeg)
  prefixo.__definirPrefixoTeste('/')
  await teste('nome e contrato do loader preservados',async()=>{assert.equal(gartic.nome,'gartic');assert.equal(typeof gartic.executar,'function');assert.equal(gartic.TIPO_JOGO,jogos.TIPOS.GARTIC)})
  await teste('legenda revela categoria e prazo, nunca resposta',async()=>{const s=gartic.montarLegenda({palavra:'SAPATO',categoria:'objetos'},3);assert(s.includes('objetos'));assert(s.includes('3 minutos'));assert(!s.includes('SAPATO'))})
  await teste('rodada envia imagem e thumbnail sem revelar palavra',async()=>{
    const f=ambiente(),antes=new Set(fs.readdirSync(os.tmpdir()).filter(n=>n.startsWith('gartic_')));await f.jogar()
    const foto=f.enviadas.find(c=>c.image);assert(foto);assert(Buffer.isBuffer(foto.jpegThumbnail));assert(foto.jpegThumbnail.length);assert(!foto.caption.includes('Caf\u00e9'))
    const d=jogos.obterJogo(G).dados;assert.equal(d.palavra,'Caf\u00e9');assert.equal(d.duracaoMs,180000);assert.equal(f.downloads,1)
    const depois=fs.readdirSync(os.tmpdir()).filter(n=>n.startsWith('gartic_'));assert(depois.every(n=>antes.has(n)))
  })
  await teste('catalogo vazio informa sem registrar jogo',async()=>{const f=ambiente();f.doc=null;await f.jogar();assert(f.enviadas.at(-1).text.includes('vazio'));assert.equal(f.downloads,0);assert.equal(jogos.obterJogo(G),null)})
  await teste('imagem indisponivel respeita tres tentativas sem Pixabay',async()=>{const f=ambiente();f.falharDownload=true;await f.jogar();assert.equal(f.downloads,3);assert.equal(jogos.obterJogo(G),null);assert(f.enviadas.at(-1).text.includes('cat\u00e1logo'))})
  await teste('falha Mongo na selecao nao presume catalogo vazio',async()=>{const f=ambiente();gartic._injetarCatalogo(async()=>{throw new Error('offline')});await f.jogar();assert.equal(f.downloads,0);assert(!f.enviadas.at(-1).text.includes('vazio'))})
  await teste('rodada em andamento preservada e sem consulta ao catalogo',async()=>{const f=ambiente(),d={palavra:'PALAVRA ANTIGA',categoria:'objetos',inicio:Date.now(),duracaoMs:180000,sock:f.sock};jogos.registrarJogo(G,jogos.TIPOS.GARTIC,d);await f.jogar();assert.equal(jogos.obterJogo(G).dados,d);assert.equal(f.selecoes,0);assert(f.enviadas.at(-1).text.includes('J\u00c1 TEM UM GARTIC'))})
  await teste('bloqueio cruzado com outro jogo preservado',async()=>{const f=ambiente();jogos.registrarJogo(G,jogos.TIPOS.VELHA,{partida:{}});await f.jogar();assert.equal(f.selecoes,0);assert.equal(jogos.obterJogo(G).tipo,jogos.TIPOS.VELHA)})
  await teste('palpite errado silencioso; acerto ignora acento e menciona vencedor',async()=>{const f=ambiente();await f.jogar();const n=f.enviadas.length;assert.equal(await jogos.processarMensagemLivre(f.sock,G,f.msg,'abacaxi'),false);assert.equal(f.enviadas.length,n);assert.equal(await jogos.processarMensagemLivre(f.sock,G,f.msg,' CAFE '),true);assert.equal(jogos.obterJogo(G),null);assert.deepEqual(f.enviadas.at(-1).mentions,[A]);assert(f.enviadas.at(-1).text.includes('Caf\u00e9'))})
  await teste('desistir/cancelar com prefixo dinamico preservam revelacao',async()=>{const f=ambiente();prefixo.__definirPrefixoTeste('!');await f.jogar('!gartic');assert(f.enviadas.find(c=>c.image).caption.includes('!gartic desistir'));await f.jogar('!gartic cancelar');assert.equal(jogos.obterJogo(G),null);assert(f.enviadas.at(-1).text.includes('Caf\u00e9'));assert(f.enviadas.at(-1).text.includes('!gartic'))})
  await teste('categoria opcional filtrada e categoria catalogo aceita',async()=>{const f=ambiente();prefixo.__definirPrefixoTeste('!');await f.jogar('!gartic animais');assert.equal(f.categoria,'animais');await f.jogar('!gartic desistir');await f.jogar('!gartic catalogo');assert.equal(f.categoria,'cat\u00e1logo')})
  await teste('expiracao mantem resposta e encerra registro/timer',async()=>{const f=ambiente();await f.jogar();gartic.aoExpirar(G);assert.equal(jogos.obterJogo(G),null);assert(f.enviadas.at(-1).text.includes('TEMPO ESGOTADO'));assert(f.enviadas.at(-1).text.includes('Caf\u00e9'))})
  await teste('OFF bloqueia membro antes de sortear ou baixar',async()=>{const f=ambiente();f.ligado=false;await f.jogar();assert.equal(f.selecoes,0);assert.equal(f.downloads,0);assert.equal(f.enviadas.length,0)})
  await teste('OFF permite dono conforme regra existente',async()=>{const f=ambiente();f.ligado=false;f.msg.key.participant=OWNER_NUMBERS[0]+'@s.whatsapp.net';await f.jogar();assert.equal(f.downloads,1)})
  await teste('conexao fechada bloqueia imagem',async()=>{const f=ambiente();f.sock.ws={isOpen:false};await f.jogar();assert.equal(f.selecoes,0);assert.equal(f.downloads,0)})
  await teste('OFF durante download impede publicacao',async()=>{const f=ambiente();gartic._injetarDownload(async()=>{f.ligado=false;estado.__definirColecaoTeste({findOne:async()=>({ligado:false})});return buffer});await f.jogar();assert.equal(jogos.obterJogo(G),null);assert.equal(f.enviadas.length,0)})
  await teste('erro no envio da foto limpa somente a propria rodada',async()=>{const f=ambiente();f.falharImagem=true;await f.jogar();assert.equal(jogos.obterJogo(G),null)})
  await teste('inicios simultaneos no grupo nao baixam duas imagens',async()=>{
    const f=ambiente();let liberar,entrou=false;gartic._injetarCatalogo(async()=>{entrou=true;await new Promise(r=>{liberar=r});return f.doc})
    const p=f.jogar();while(!entrou)await new Promise(r=>setImmediate(r));await f.jogar();liberar();await p;assert.equal(f.downloads,1);assert.equal(f.enviadas.filter(c=>c.image).length,1)
  })
  await teste('outro jogo iniciado durante busca nao e substituido',async()=>{const f=ambiente();gartic._injetarCatalogo(async()=>{jogos.registrarJogo(G,jogos.TIPOS.VELHA,{partida:{}});return f.doc});await f.jogar();assert.equal(jogos.obterJogo(G).tipo,jogos.TIPOS.VELHA);assert.equal(f.enviadas.filter(c=>c.image).length,0)})
  await teste('privado avisa antes de acessar catalogo',async()=>{const f=ambiente();await gartic.executar(f.sock,A,f.msg,'/gartic');assert.equal(f.selecoes,0);assert(f.enviadas.at(-1).text.includes('grupo'))})
  console.log(passou+' testes offline do jogo passaram.')
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{limpar();gartic._injetarCatalogo();gartic._injetarDownload()})
