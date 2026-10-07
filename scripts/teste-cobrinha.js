const {assert,suite,ciclo,registro,sock,msg,grupo}=require('./helpers-brincadeiras')
const cmd=require('../comandos/menu-brincadeiras/cobrinha')
suite(async testar=>{
  await ciclo(testar,cmd,estado=>{estado.comida={x:7,y:7}},'d')
  await testar('grade 8×8 e comida fora do corpo',()=>{
    const e=cmd._test.criar(),linhas=cmd._test.render(e).split('\n').slice(0,8)
    assert.equal(linhas.length,8);assert.ok(linhas.every(l=>Array.from(l).length===8))
    assert.ok(!e.cobra.some(p=>p.x===e.comida.x&&p.y===e.comida.y))
  })
  await testar('comer maçã cresce e soma ponto',()=>{
    const e=cmd._test.criar();e.comida={x:4,y:3}; const r=cmd._test.jogar(e,'direita')
    assert.equal(r.fim,false);assert.equal(e.cobra.length,4);assert.equal(e.pontos,1)
    assert.ok(!e.cobra.some(p=>p.x===e.comida.x&&p.y===e.comida.y))
  })
  await testar('inversão direta recusada sem movimento',()=>{
    const e=cmd._test.criar(),antes=JSON.stringify(e)
    assert.equal(cmd._test.jogar(e,'esquerda').valida,false);assert.equal(JSON.stringify(e),antes)
  })
  await testar('colisão com próprio corpo',()=>{
    const e={cobra:[{x:3,y:3},{x:3,y:2},{x:2,y:2},{x:2,y:3}],comida:{x:7,y:7},direcao:'direita',pontos:1}
    assert.equal(cmd._test.jogar(e,'cima').fim,true)
  })
  await testar('pode ocupar célula liberada pela cauda',()=>{
    const e={cobra:[{x:1,y:1},{x:1,y:2},{x:2,y:2},{x:2,y:1}],comida:{x:7,y:7},direcao:'cima',pontos:1}
    assert.equal(cmd._test.jogar(e,'direita').fim,false)
  })
  await testar('tabuleiro cheio vence sem sortear comida inexistente',()=>{
    const cobra=[{x:1,y:0}]
    for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(!(y===0&&(x===0||x===1)))cobra.push({x,y})
    const e={cobra,comida:{x:0,y:0},direcao:'esquerda',pontos:60}
    assert.match(cmd._test.jogar(e,'esquerda').texto,/Vitória/);assert.equal(e.comida,null);assert.equal(e.cobra.length,64)
  })
  await testar('parede encerra jogo e libera grupo',async()=>{
    const s=sock();await cmd.executar(s,grupo,msg(),'/cobrinha')
    const e=registro.obterJogo(grupo).dados.estado;e.cobra=[{x:7,y:3},{x:6,y:3},{x:5,y:3}];e.comida={x:0,y:0}
    await registro.processarMensagemLivre(s,grupo,msg(),'d')
    assert.equal(registro.obterJogo(grupo),null);assert.match(s.enviadas.at(-1).text,/Colisão/)
  })
})
