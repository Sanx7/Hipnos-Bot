// Offline: nenhuma punição, conexão ao WhatsApp ou MongoDB real.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
process.env.OWNER_NUMBERS = '5511999990009'
const assert = require('node:assert/strict'), fs = require('node:fs')
const fake = require('./helpers/colecao-antigolpe-fake')
const detector = require('../dados/deteccao-golpes'), config = require('../dados/antigolpe-config')
const mod = require('../dados/moderacao-antigolpe'), cmd = require('../comandos/admin/antigolpe')
const advs = require('../advertencias'), ban = require('../comandos/admin/ban'), lid = require('../lid'), prefixos = require('../prefixo')
const G = '111@g.us', H = '222@g.us', PN = n => `${n}@s.whatsapp.net`
const BOT = PN('5511666660000'), ADM = PN('5511777770000'), COMUM = PN('5511888880000'), DONO = PN('5511999990009'), DONOG = PN('5511555550000')
const ALTO = 'Sou da equipe de suporte do WhatsApp. Envie seu código de verificação recebido por SMS 123456. Sua conta será bloqueada. https://example.com'
const MEDIO = 'Você ganhou um prêmio. https://example.com'
let passou = 0
function cenario() {
  let agora = 1800000000000, seq = 0
  const mongo = { config: fake(), eventos: fake(), cooldowns: fake() }, registros = fake()
  config.__definirColecoesTeste(mongo); mod.__limparTeste(() => agora); advs.__definirColecaoTeste(registros)
  lid.__definirConsultaSessaoTeste(async () => null); prefixos.__definirPrefixoTeste('/')
  const envios = [], remocoes = [], blacklist = []
  ban.__definirGravacaoBlacklistTeste(n => blacklist.push(n))
  const sock = {
    user: { id: BOT, lid: '666@lid' }, owner: DONOG,
    membros: [{ id: BOT, lid: '666@lid', admin: 'admin' }, { id: ADM, lid: '777@lid', admin: 'admin' },
      { id: COMUM, lid: '888@lid' }, { id: DONO, lid: '999@lid' }, { id: DONOG, lid: '555@lid' }],
    async groupMetadata() { if (this.erroMeta) throw new Error('metadata privada'); await this.aoMeta?.(); return { participants: this.membros, owner: this.owner } },
    async sendMessage(jid, p, extra) {
      if ((p.delete && this.erroDelete) || (p.text && this.erroEnvio)) throw new Error('erro privado')
      envios.push({ jid, ...p, extra }); if (p.delete) await this.aoApagar?.(); return { key: { id: `envio-${++seq}` } }
    },
    async groupParticipantsUpdate(jid, alvos) {
      remocoes.push({ jid, alvos }); if (this.erroRemover) throw new Error('remoção privada')
      if (this.semStatus) return []
      return alvos.map(jid => ({ jid, status: this.status || '200' }))
    }
  }
  const msg = (texto = ALTO, sender = COMUM, jid = G) => ({ key: { remoteJid: jid, participant: sender, id: `msg-${++seq}`, fromMe: false }, messageTimestamp: agora / 1000, message: { conversation: texto } })
  return { mongo, registros, sock, envios, remocoes, blacklist, msg,
    avancar(ms) { agora += ms },
    async ligar(modo = 'alerta', sensibilidade = 'media') { await config.definir(G, { ativo: true, modo, sensibilidade }, 'adm') },
    async processar(texto = ALTO, sender = COMUM, jid = G) { return mod.processar(sock, msg(texto, sender, jid)) },
    async executar(args = 'on', sender = ADM, jid = G, nome = '/antigolpe') { return cmd.executar(sock, jid, msg('', sender, jid), `${nome} ${args}`) },
    async total() { return advs.contarAdvertencias(COMUM.split('@')[0], G) },
    get exclusoes() { return envios.filter(p => p.delete) }, get alertas() { return envios.filter(p => p.text) }
  }
}
async function teste(nome, fn) { await fn(cenario()); passou++; console.log(`✅ ${nome}`) }
async function main() {
  const benignos = ['Qual é sua chave Pix?', 'Vou te mandar 20 reais.', 'Recebi um código por SMS.', 'Ganhei um prêmio na escola.', 'Meu banco está fora do ar.',
    'Alguém tentou me dar um golpe.', 'https://example.com', 'Pix', 'senha', 'prêmio', 'clique agora https://example.com',
    'Não envie seu código de verificação. Nunca compartilhe sua senha.',
    'Exemplo de golpe: "Sou suporte do WhatsApp, envie seu código de verificação, sua conta será bloqueada".',
    'Cuidado com golpes: resgate seu prêmio agora em https://example.com',
    'Não pague taxa para liberar prêmio. Isso é um golpe.', 'Recebi uma mensagem suspeita: "mande seu código SMS agora".']
  for (const sens of ['baixa', 'media', 'alta']) for (const texto of benignos) await teste(`benigno (${sens}): ${texto.slice(0,40)}`, async () => assert.equal(detector.analisar(texto, sens).risco, 'baixo'))
  for (const [texto, baixa] of [[ALTO, 'alto'], ['Resgate seu prêmio agora. Pague uma taxa para liberar o prêmio. Você tem 5 minutos. https://example.com', 'medio'],
    ['Retorno financeiro garantido. Envie seus dados pessoais. Clique agora https://example.com', 'medio'],
    ['Parabéns, você foi selecionado. Envie um Pix para liberar seu saque. Última chance https://example.com', 'medio']]) {
    await teste('combinação forte respeita sensibilidade conservadora', async () => {
      assert.equal(detector.analisar(texto, 'baixa').risco, baixa)
      for (const s of ['media','alta']) assert.equal(detector.analisar(texto, s).risco, 'alto')
    })
  }
  await teste('limiares explícitos calibrados', async () => {
    assert.deepEqual(detector.LIMIARES, { baixa: { medio:8, alto:11 }, media: { medio:5, alto:8 }, alta: { medio:4, alto:7 } })
    assert.equal(detector.analisar(MEDIO, 'baixa').risco,'baixo'); assert.equal(detector.analisar(MEDIO).risco,'medio')
    const t = 'Dinheiro fácil. Clique agora https://example.com'
    assert.equal(detector.analisar(t,'alta').risco,'alto'); assert.equal(detector.analisar(t,'media').risco,'medio')
  })
  await teste('categorias equivalentes não somam repetidamente', async () => {
    const a = detector.analisar(ALTO), b = detector.analisar(`${ALTO} ${ALTO} Mande seu código SMS. Informe sua senha.`)
    assert.deepEqual(b,a); assert.equal(a.pontuacao,11)
  })
  await teste('pontuação mínima não substitui evidências independentes', async () => {
    assert.equal(detector.analisar('Envie seu código de verificação', 'alta').risco, 'baixo')
    assert.equal(detector.analisar('Dinheiro fácil dinheiro fácil dinheiro fácil','alta').risco,'baixo')
  })
  await teste('fronteiras de risco médio 5 e alto 8 na sensibilidade média',async()=>{
    const medio=detector.analisar('Você ganhou um prêmio. Clique agora.')
    const alto=detector.analisar('Você ganhou um prêmio. Envie seus dados pessoais. https://example.com')
    assert.equal(medio.pontuacao,5);assert.equal(medio.risco,'medio');assert.equal(alto.pontuacao,8);assert.equal(alto.risco,'alto')
  })
  await teste('link sem fraude não pontua; não depende de domínio fixo', async () => {
    assert.equal(detector.analisar('https://example.com').pontuacao,0)
    assert.equal(detector.analisar(ALTO.replace('example.com','example.org')).risco,'alto')
  })
  await teste('contexto educativo não libera próxima frase perigosa', async () => assert.equal(detector.analisar(`Cuidado com golpes. ${ALTO}`).risco,'alto'))
  await teste('negar ser golpe não isenta pedido perigoso', async () => assert.equal(detector.analisar(`${ALTO} Não é golpe.`).risco,'alto'))
  await teste('citação educativa com várias frases é ignorada sem ignorar ataque posterior',async()=>{
    const citado=`Exemplo de golpe: "${ALTO}".`
    assert.equal(detector.analisar(citado).risco,'baixo');assert.equal(detector.analisar(`${citado} ${ALTO}`).risco,'alto')
  })
  await teste('verificação de conta com identidade e ameaça gera risco alto',async()=>{
    assert.equal(detector.analisar('Sou da equipe de suporte do WhatsApp. Verifique sua conta. Sua conta será bloqueada. https://example.com').risco,'alto')
    assert.equal(detector.analisar('Como verificar minha conta?').risco,'baixo')
  })
  await teste('pedido de senha interrogativo com falsa identidade é alto',async()=>{
    assert.equal(detector.analisar('Sou suporte do WhatsApp. Qual é sua senha? Sua conta será bloqueada. https://example.com').risco,'alto')
  })
  await teste('acentos e maiúsculas normalizados', async () => assert.deepEqual(detector.analisar(ALTO.toUpperCase()),detector.analisar(ALTO)))
  await teste('exceção literal reduz só premiação não perigosa', async () => {
    assert.equal(detector.analisar(`Sorteio oficial: ${MEDIO}`,'media',['sorteio oficial']).risco,'baixo')
    assert.equal(detector.analisar(`Sorteio oficial: ${MEDIO} Envie seu código SMS.`,'alta',['sorteio oficial']).risco,'alto')
    assert.equal(detector.analisar(ALTO,'media',['sorteio oficial']).risco,'alto')
    assert.equal(detector.analisar(`Sorteio oficialissimo: ${MEDIO}`,'media',['sorteio oficial']).risco,'medio')
  })
  await teste('contrato e padrões isolados por grupo', async c => {
    assert.deepEqual(cmd.aliases,['antiscam','antifraude']); assert.deepEqual(await config.obter(G),{ativo:false,modo:'alerta',sensibilidade:'media',excecoes:[]})
    await c.ligar(); assert.equal((await config.obter(H)).ativo,false)
  })
  await teste('on/off/status/modo/sensibilidade e persistência', async c => {
    await c.executar(); await c.executar('modo adv'); await c.executar('sensibilidade alta'); await c.executar('permitir Sorteio oficial'); await c.executar('status')
    const path = require.resolve('../dados/antigolpe-config'), antigo = require.cache[path]; delete require.cache[path]
    try { const novo = require(path); novo.__definirColecoesTeste(c.mongo); assert.deepEqual(await novo.obter(G),{ativo:true,modo:'adv',sensibilidade:'alta',excecoes:['sorteio oficial']}) }
    finally { require.cache[path]=antigo }
    await c.executar('off'); assert.equal((await config.obter(G)).ativo,false)
  })
  for (const modo of ['alerta','apagar','adv']) await teste(`configura modo ${modo}`, async c => { await c.executar(`modo ${modo}`); assert.equal((await config.obter(G)).modo,modo) })
  for (const sens of ['baixa','media','alta']) await teste(`configura sensibilidade ${sens}`, async c => { await c.executar(`sensibilidade ${sens}`); assert.equal((await config.obter(G)).sensibilidade,sens) })
  for (const autor of [ADM,'777@lid',DONO,'999@lid',DONOG,'555@lid']) await teste('ADM/donos configuram por PN/LID',async c=>{await c.executar('on',autor);assert.equal((await config.obter(G)).ativo,true)})
  for (const autor of [COMUM,'888@lid',`${ADM.split('@')[0]}@lid`]) await teste('comum e LID sem prova não configuram',async c=>{await c.executar('on',autor);assert.equal((await config.obter(G)).ativo,false)})
  for (const arg of ['on extra','modo ban','sensibilidade maxima','permitir','remover','status extra','excecoes extra','desconhecido']) await teste(`entrada inválida ${arg}`,async c=>{await c.executar(arg);assert.equal(c.mongo.config.docs.length,0)})
  for (const termo of ['', 'pix','premio oficial','qualquer mensagem','mensagem segura','.*','codigo sms','senha pessoal','sorteio 123456','a'.repeat(81)]) await teste(`exceção inválida ${termo.slice(0,20)}`, async c=>{
    await assert.rejects(config.permitir(G,termo,'adm'));assert.equal(c.mongo.config.docs.length,0)
  })
  await teste('exceções normalizadas, listadas e removidas literalmente',async c=>{
    await c.executar('permitir SORTEIO OFICIAL');await c.executar('permitir sorteio oficial');await c.executar('excecoes')
    assert.deepEqual((await config.obter(G)).excecoes,['sorteio oficial']);assert.match(c.alertas.at(-1).text,/sorteio oficial/)
    await c.executar('remover sorteio oficial');assert.deepEqual((await config.obter(G)).excecoes,[])
  })
  await teste('exceções concorrentes limitadas atomicamente a 20',async c=>{
    const termos=Array.from({length:30},(_,i)=>`campanha natal ${String.fromCharCode(97+i%26)}${String.fromCharCode(97+Math.floor(i/26))}`)
    await Promise.allSettled(termos.map(t=>config.permitir(G,t,'adm')))
    assert.equal((await config.obter(G)).excecoes.length,20)
  })
  await teste('grupo privado/metadados indisponíveis não configuram',async c=>{await c.executar('on',DONO,DONO);c.sock.erroMeta=true;await c.executar('on');assert.equal(c.mongo.config.docs.length,0)})
  for (const nome of ['!antigolpe','!antiscam','!antifraude']) await teste(`prefixo/alias ${nome}`,async c=>{await c.executar('on',ADM,G,nome);assert.equal((await config.obter(G)).ativo,true)})
  await teste('ajuda e menu com prefixo dinâmico',async c=>{
    prefixos.__definirPrefixoTeste('!');await c.executar('');assert.match(c.alertas.at(-1).text,/!antigolpe/)
    await require('../comandos/admin/menu-admin').executar(c.sock,G,c.msg());assert.match(c.alertas.at(-1).text,/!antifraude/)
  })
  await teste('desligado não gera efeitos',async c=>{assert.equal(await c.processar(),false);assert.equal(c.envios.length,0)})
  await teste('alerta notifica apenas ADM, sem punir nem bloquear',async c=>{
    await c.ligar();assert.equal(await c.processar(),false);assert.equal(c.exclusoes.length,0);assert.equal(await c.total(),0);assert.equal(c.remocoes.length,0)
    assert.deepEqual(c.alertas[0].mentions,[ADM]);assert.deepEqual(c.alertas[0].contextInfo.mentionedJid,[ADM]);assert.equal(c.alertas[0].extra,undefined)
  })
  for (const modo of ['alerta','apagar','adv']) await teste(`risco médio só alerta em ${modo}`,async c=>{
    await c.ligar(modo);assert.equal(await c.processar(MEDIO),false);assert.equal(c.exclusoes.length,0);assert.equal(await c.total(),0);assert.match(c.alertas[0].text,/Risco: Médio/)
  })
  await teste('apagar alto risco sem advertência',async c=>{await c.ligar('apagar');assert.equal(await c.processar(),true);assert.equal(c.exclusoes.length,1);assert.equal(await c.total(),0);assert.match(c.alertas[0].text,/Exclusão aceita/)})
  await teste('adv alto risco no contador central',async c=>{await c.ligar('adv');await c.processar();assert.equal(await c.total(),1);assert.equal(c.exclusoes.length,1);assert.match(c.alertas[0].text,/advertência aplicada \(1\/3\)/)})
  await teste('limite de adv confirma 200 antes de blacklist e arquivo',async c=>{
    await c.ligar('adv');await advs.definirLimiteAdvertencias(G,1,'adm');await c.processar();assert.equal(c.remocoes.length,1);assert.equal(await c.total(),0);assert.equal(c.blacklist.length,1)
    assert.match(c.alertas[0].text,/expulsão confirmada/);assert.equal(c.alertas[0].extra,undefined)
  })
  for (const status of ['403','500','vazio','throw']) await teste(`expulsão não confirmada ${status}`,async c=>{
    await c.ligar('adv');await advs.definirLimiteAdvertencias(G,1,'adm');c.sock.status=status;c.sock.semStatus=status==='vazio';c.sock.erroRemover=status==='throw'
    await c.processar();assert.equal(await c.total(),1);assert.equal(c.blacklist.length,0);assert.match(c.alertas[0].text,/expulsão não confirmada/)
    await c.processar();assert.equal(c.remocoes.length,1)
  })
  for (const sender of [BOT,'666@lid',ADM,'777@lid',DONO,'999@lid',DONOG,'555@lid']) await teste(`participante protegido ${sender}`,async c=>{
    await c.ligar('adv');assert.equal(await c.processar(ALTO,sender),false);assert.equal(c.envios.length,0);assert.equal(c.remocoes.length,0)
  })
  await teste('PN/LID compartilham cooldown e número real',async c=>{await c.ligar('adv');await c.processar(ALTO,'888@lid');await c.processar();assert.equal(await c.total(),1);assert.equal(c.exclusoes.length,2)})
  await teste('cooldowns e configurações independentes por grupo e usuário',async c=>{
    await c.ligar('adv');await config.definir(H,{ativo:true,modo:'adv'},'adm')
    const outro=PN('5511222220000');c.sock.membros.push({id:outro})
    await c.processar();await c.processar(ALTO,COMUM,H);await c.processar(ALTO,outro)
    assert.equal(c.exclusoes.length,3);assert.equal(c.alertas.length,3)
    assert.equal(await advs.contarAdvertencias(COMUM.split('@')[0],H),1);assert.equal(await advs.contarAdvertencias(outro.split('@')[0],G),1)
  })
  await teste('LID via mapeamento de sessão',async c=>{
    c.sock.membros=c.sock.membros.map(p=>({id:p.id,admin:p.admin}));lid.__definirConsultaSessaoTeste(async n=>n==='888'?COMUM.split('@')[0]:null)
    await c.ligar('adv');await c.processar(ALTO,'888@lid');assert.equal(await c.total(),1)
  })
  for (const sender of ['desconhecido@lid',`${BOT.split('@')[0]}@lid`,`${ADM.split('@')[0]}@lid`]) await teste('identidade não comprovada não pune',async c=>{await c.ligar('adv');await c.processar(ALTO,sender);assert.equal(c.envios.length,0)})
  await teste('VIP segue regras comuns',async c=>{
    const vip=require('../vip'),antigo=vip.isVip;let chamadas=0;vip.isVip=async()=>{chamadas++;return true}
    try{await c.ligar('adv');await c.processar();assert.equal(await c.total(),1);assert.equal(chamadas,0)}finally{vip.isVip=antigo}
  })
  for (const tipo of ['extendedTextMessage','imageMessage','videoMessage','documentMessage']) await teste(`texto/legenda ${tipo} sem mídia`,async c=>{
    await c.ligar('apagar');const m=c.msg();m.message={ [tipo]: tipo==='extendedTextMessage'?{text:ALTO}:{caption:ALTO} }
    await mod.processar(c.sock,m);assert.equal(c.exclusoes.length,1)
  })
  for (const envelope of ['ephemeralMessage','viewOnceMessage','viewOnceMessageV2','documentWithCaptionMessage']) await teste(`normaliza ${envelope}`,async c=>{
    await c.ligar('apagar');const m=c.msg();m.message={ [envelope]:{message:{documentMessage:{caption:ALTO}}} };await mod.processar(c.sock,m);assert.equal(c.exclusoes.length,1)
  })
  await teste('quotedMessage não analisada',async c=>{await c.ligar('adv');const m=c.msg();m.message={extendedTextMessage:{text:'olá',contextInfo:{quotedMessage:{conversation:ALTO}}}};await mod.processar(c.sock,m);assert.equal(c.envios.length,0)})
  for (const message of [{audioMessage:{}},{imageMessage:{}},{stickerMessage:{}},{protocolMessage:{}},{eventMessage:{}}]) await teste('sem conteúdo textual ignorado',async c=>{await c.ligar('adv');const m=c.msg();m.message=message;assert.equal(await mod.processar(c.sock,m),false)})
  for (const alterar of [m=>{m.key.fromMe=true},m=>{delete m.key.id},m=>{m.messageStubType=1},m=>{delete m.messageTimestamp},m=>{m.messageTimestamp-=61},m=>{m.messageTimestamp+=10}]) await teste('evento antigo/inválido ignorado',async c=>{await c.ligar('adv');const m=c.msg();alterar(m);await mod.processar(c.sock,m);assert.equal(c.envios.length,0)})
  for (const tipo of ['append',undefined]) await teste(`lote ${tipo} ignorado`,async c=>{await c.ligar('adv');assert.equal((await mod.processarLote(c.sock,[c.msg()],tipo)).size,0)})
  await teste('cooldown exato 60s apaga, sem repetir adv/alerta',async c=>{
    await c.ligar('adv');await c.processar();c.avancar(59999);await c.processar();assert.equal(await c.total(),1);assert.equal(c.alertas.length,1)
    c.avancar(1);await c.processar();assert.equal(await c.total(),2);assert.equal(c.exclusoes.length,3);assert.equal(c.alertas.length,2)
  })
  await teste('concorrência de mensagens distintas',async c=>{await c.ligar('adv');await Promise.all(Array.from({length:20},()=>c.processar()));assert.equal(c.exclusoes.length,20);assert.equal(await c.total(),1)})
  await teste('mesmo evento concorrente punido uma vez',async c=>{await c.ligar('adv');const m=c.msg();await Promise.all(Array.from({length:20},()=>mod.processar(c.sock,m)));assert.equal(c.exclusoes.length,1);assert.equal(await c.total(),1)})
  for(const modo of ['alerta','adv'])await teste(`deduplicação após limpar memória ${modo}`,async c=>{
    await c.ligar(modo);const m=c.msg();const r=await mod.processar(c.sock,m);mod.__limparTeste(()=>1800000000000)
    assert.equal(await mod.processar(c.sock,m),r);await c.processar();assert.equal(c.alertas.length,1);assert.equal(await c.total(),modo==='adv'?1:0)
  })
  await teste('dois módulos compartilham reserva e cooldown Mongo',async c=>{
    await c.ligar('adv');const path=require.resolve('../dados/moderacao-antigolpe'),antigo=require.cache[path];delete require.cache[path]
    try{const segundo=require(path);segundo.__limparTeste(()=>1800000000000);const m=c.msg();await Promise.all([mod.processar(c.sock,m),segundo.processar(c.sock,m)]);await segundo.processar(c.sock,c.msg());assert.equal(c.exclusoes.length,2);assert.equal(await c.total(),1)}finally{require.cache[path]=antigo}
  })
  for(const campo of ['config','eventos','cooldowns'])await teste(`falha Mongo ${campo} não pune`,async c=>{await c.ligar('adv');c.mongo[campo].falhar=true;await c.processar();assert.equal(c.envios.length,0);assert.equal(await c.total(),0)})
  await teste('configuração corrompida não pune',async c=>{c.mongo.config.docs.push({_id:G,ativo:true,modo:'ban',sensibilidade:'media',excecoes:[]});assert.equal(await c.processar(),false);assert.equal(c.envios.length,0)})
  await teste('bot sem ADM só alerta, sem punição',async c=>{await c.ligar('adv');c.sock.membros.find(p=>p.id===BOT).admin=null;assert.equal(await c.processar(),false);assert.equal(c.exclusoes.length,0);assert.equal(await c.total(),0);assert.match(c.alertas[0].text,/não tem administrador/)})
  await teste('metadata indisponível preserva fluxo',async c=>{await c.ligar('adv');c.sock.erroMeta=true;assert.equal(await c.processar(),false);assert.equal(c.envios.length,0)})
  await teste('promoção antes da exclusão impede punição',async c=>{await c.ligar('adv');let n=0;c.sock.aoMeta=()=>{if(++n===2)c.sock.membros.find(p=>p.id===COMUM).admin='admin'};await c.processar();assert.equal(c.exclusoes.length,0)})
  await teste('promoção após exclusão impede advertência',async c=>{await c.ligar('adv');c.sock.aoApagar=()=>{c.sock.membros.find(p=>p.id===COMUM).admin='admin'};await c.processar();assert.equal(await c.total(),0)})
  for (const mudanca of [{ativo:false},{modo:'alerta'},{sensibilidade:'baixa'}])await teste('revalida configuração antes de advertir',async c=>{await c.ligar('adv');c.sock.aoApagar=()=>config.definir(G,mudanca,'adm');await c.processar();assert.equal(await c.total(),0)})
  await teste('falha na exclusão não anuncia sucesso',async c=>{await c.ligar('apagar');c.sock.erroDelete=true;await c.processar();assert.match(c.alertas[0].text,/Exclusão não confirmada/)})
  await teste('falha de alerta não bloqueia comandos',async c=>{await c.ligar();c.sock.erroEnvio=true;assert.equal(await c.processar(),false)})
  await teste('mensagem anterior tratada não consulta banco',async c=>{await c.ligar('adv');c.mongo.config.falhar=true;const m=c.msg();assert.equal((await mod.processarLote(c.sock,[m],'notify',new Set([`${G}:${m.key.id}`]))).size,0);assert.equal(c.envios.length,0)})
  await teste('alerta e persistência não contêm segredos/conteúdo original',async c=>{
    await c.ligar('adv');await advs.definirLimiteAdvertencias(G,1,'adm');await c.processar()
    const dados=JSON.stringify({envios:c.alertas,mongo:c.mongo,registros:c.registros.docs})
    for(const segredo of ['123456','example.com',ALTO])assert.ok(!dados.includes(segredo))
    assert.ok(c.alertas.every(p=>!p.extra));assert.ok(!dados.includes('golpista'))
  })
  await teste('memória limitada e limpeza TTL',async c=>{for(let i=0;i<=10000;i++)await c.processar('olá');assert.equal(mod.__tamanhoCacheTeste(),10000);c.avancar(120001);await c.processar('olá');assert.equal(mod.__tamanhoCacheTeste(),1)})
  await teste('produção Mongo: TTL e coleções, sem guardar conteúdo',async()=>{
    const indices=[],cols={configAntigolpe:fake(),ocorrenciasAntigolpe:fake(),cooldownsAntigolpe:fake()}
    for(const [nome,col]of Object.entries(cols))col.createIndex=async(campos,opcoes)=>indices.push({nome,campos,opcoes})
    class MongoClient{async connect(){} db(){return{collection:n=>cols[n]}}}
    const m={exports:{}}
    new Function('require','module','process',fs.readFileSync(require.resolve('../dados/antigolpe-config'),'utf8'))(n=>n==='mongodb'?{MongoClient}:n==='./deteccao-golpes'?detector:require(n),m,{env:{MONGODB_URI:'mongodb://offline'}})
    assert.deepEqual(await m.exports.obter(G),config.PADRAO);assert.equal(indices.length,2);for(const i of indices){assert.deepEqual(i.campos,{expira_em:1});assert.equal(i.opcoes.expireAfterSeconds,0)}
  })
  console.log(`\nAntigolpe: ${passou} testes passaram.`)
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{ban.__definirGravacaoBlacklistTeste();lid.__definirConsultaSessaoTeste(null);prefixos.__definirPrefixoTeste('/')})
