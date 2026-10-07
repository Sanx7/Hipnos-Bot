const {assert,suite,ciclo,random,registro,sock,msg,grupo}=require('./helpers-brincadeiras')
const cmd=require('../comandos/menu-brincadeiras/dino')
suite(async testar=>{
  await ciclo(testar,cmd,estado=>{estado.obstaculo='livre'},'p')
  await testar('pular passa cacto e soma ponto',()=>random(0.99,()=>{
    const estado={pontos:0,obstaculo:'cacto'}; assert.equal(cmd._test.jogar(estado,'pular').fim,false);assert.equal(estado.pontos,1)
  }))
  await testar('seguir passa galho; pular colide',()=>{
    assert.equal(cmd._test.jogar({pontos:3,obstaculo:'galho'},'seguir').fim,false)
    assert.equal(cmd._test.jogar({pontos:3,obstaculo:'galho'},'pular').fim,true)
  })
  await testar('chance de obstáculo cresce e tem teto',()=>{
    assert.ok(cmd._test.chance(10)>cmd._test.chance(0));assert.equal(cmd._test.chance(100),0.85)
  })
  await testar('colisão por texto livre encerra e informa pontos',async()=>{
    const s=sock();await cmd.executar(s,grupo,msg(),'/dino')
    const jogo=registro.obterJogo(grupo).dados; jogo.estado.obstaculo='cacto';jogo.estado.pontos=7
    await registro.processarMensagemLivre(s,grupo,msg(),'seguir')
    assert.equal(registro.obterJogo(grupo),null);assert.match(s.enviadas.at(-1).text,/Pontuação final: 7/)
  })
})
