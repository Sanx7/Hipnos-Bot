const {assert,sock,msg,grupo,random,suite}=require('./helpers-brincadeiras')
const cmd=require('../comandos/menu-brincadeiras/pergunta')
const perguntas=require('../dados/perguntas-reflexivas')
suite(async testar=>{
  await testar('banco com 80–100 perguntas únicas e curtas',()=>{
    assert.ok(perguntas.length>=80&&perguntas.length<=100)
    assert.equal(new Set(perguntas).size,perguntas.length)
    assert.ok(perguntas.every(p=>p.endsWith('?')&&p.length<150))
  })
  await testar('sorteia pergunta sem estado de jogo',async()=>{
    const s=sock(); await cmd.executar(s,grupo,msg()); assert.ok(perguntas.some(p=>s.enviadas[0].text.includes(p)))
  })
  await testar('não repete consecutivamente mesmo com RNG constante',()=>random(0,async()=>{
    cmd._limparMemoria(); const s=sock()
    for(let i=0;i<8;i++) await cmd.executar(s,grupo,msg())
    for(let i=1;i<8;i++) assert.notEqual(s.enviadas[i].text,s.enviadas[i-1].text)
  }))
  await testar('memória independente por grupo',()=>random(0,async()=>{
    cmd._limparMemoria(); const a=sock(),b=sock()
    await cmd.executar(a,grupo,msg()); await cmd.executar(b,'outro@g.us',msg())
    assert.equal(a.enviadas[0].text,b.enviadas[0].text)
  }))
})
