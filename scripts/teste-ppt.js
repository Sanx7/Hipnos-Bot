const {assert,sock,msg,grupo,random,suite}=require('./helpers-brincadeiras')
const cmd=require('../comandos/menu-brincadeiras/ppt')
suite(async testar=>{
  await testar('aliases corretos',()=>assert.deepEqual(cmd.aliases,['jokenpo','pedrapapeltesoura']))
  for(const [entrada,bot,resultado] of [['pedra',0,'Empate'],['p',2/3,'Vitória'],['pa',0,'Vitória'],['t',1/3,'Vitória'],['tesoura',0,'Derrota']]) {
    await testar(`${entrada} → ${resultado}`,()=>random(bot,async()=>{
      const s=sock(); await cmd.executar(s,grupo,msg(),`/ppt ${entrada}`); assert.match(s.enviadas[0].text,new RegExp(resultado))
    }))
  }
  for(const entrada of ['', 'lagarto','pedra papel', '__proto__']) await testar(`jogada inválida: ${entrada||'vazia'}`,async()=>{
    const s=sock(); await cmd.executar(s,grupo,msg(),`/ppt ${entrada}`); assert.match(s.enviadas[0].text,/Use \/ppt/)
  })
})
