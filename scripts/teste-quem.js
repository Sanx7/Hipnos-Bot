process.env.MONGODB_URI=''
const {assert,sock,msg,grupo,random,suite}=require('./helpers-brincadeiras')
const cmd=require('../comandos/menu-brincadeiras/quem')
const perguntas=require('../dados/perguntas-quem')
const lid=require('../lid')
lid.__definirConsultaSessaoTeste(async()=>null)
const membros=[{id:'123@lid',phoneNumber:'5511000000001@s.whatsapp.net',notify:'Ana'},{id:'999@lid',phoneNumber:'5511999999999@s.whatsapp.net'}]
function grupoSock(){const s=sock();s.user={id:'5511999999999@s.whatsapp.net'};s.groupMetadata=async()=>({participants:membros});return s}
suite(async testar=>{
  await testar('banco com 40–50 perguntas únicas',()=>{
    assert.ok(perguntas.length>=40&&perguntas.length<=50);assert.equal(new Set(perguntas).size,perguntas.length)
  })
  await testar('LID resolve nome, menciona ID original e exclui bot',async()=>{
    const s=grupoSock(); await cmd.executar(s,grupo,msg());assert.deepEqual(s.enviadas[0].mentions,['123@lid']);assert.match(s.enviadas[0].text,/Ana/)
  })
  await testar('anti-repetição por grupo com RNG constante',()=>random(0,async()=>{
    cmd._limparMemoria();const s=grupoSock()
    await cmd.executar(s,grupo,msg());await cmd.executar(s,grupo,msg());assert.notEqual(s.enviadas[0].text,s.enviadas[1].text)
  }))
  await testar('grupos independentes',()=>random(0,async()=>{
    cmd._limparMemoria();const s=grupoSock(),outro=grupoSock()
    await cmd.executar(s,grupo,msg());await cmd.executar(outro,'outro@g.us',msg());assert.equal(s.enviadas[0].text,outro.enviadas[0].text)
  }))
  await testar('LID sem nome/telefone mantém menção e não inventa telefone',async()=>{
    const s=grupoSock();s.groupMetadata=async()=>({participants:[{id:'444@lid'}]})
    await cmd.executar(s,grupo,msg());assert.deepEqual(s.enviadas[0].mentions,['444@lid']);assert.match(s.enviadas[0].text,/membro do grupo/)
  })
  await testar('fora de grupo avisa',async()=>{const s=grupoSock();await cmd.executar(s,'privado@s.whatsapp.net',msg());assert.match(s.enviadas[0].text,/grupo/);assert.equal(s.enviadas[0].mentions,undefined)})
  await testar('grupo vazio avisa',async()=>{const s=grupoSock();s.groupMetadata=async()=>({participants:[]});await cmd.executar(s,grupo,msg());assert.match(s.enviadas[0].text,/Não encontrei/)})
  await testar('falha de metadata tratada',async()=>{const s=grupoSock();s.groupMetadata=async()=>{throw new Error('metadata simulada')};await cmd.executar(s,grupo,msg());assert.match(s.enviadas[0].text,/Não consegui/)})
  lid.__definirConsultaSessaoTeste(null)
})
