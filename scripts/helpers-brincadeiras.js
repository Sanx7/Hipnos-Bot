const assert = require('node:assert/strict')
const registro = require('../dados/jogos-ativos')
const grupo = 'teste@g.us'
const jogador = '5511000000001@s.whatsapp.net'
const msg = (autor = jogador) => ({ key: { participant: autor, remoteJid: grupo }, pushName: 'Jogador' })
function sock() {
  const enviadas = []
  return { enviadas, async sendMessage(jid, c) { enviadas.push(c); return {key:{id:'teste'}} } }
}
async function random(valor, fn) {
  const original = Math.random
  Math.random = () => valor
  try { return await fn() } finally { Math.random = original }
}
function suite(fn) {
  let ok=0, falhas=0
  const testar = async (nome, tarefa) => {
    try { await tarefa(); ok++; console.log(`✅ ${nome}`) }
    catch (err) { falhas++; console.error(`❌ ${nome}`, err) }
  }
  return fn(testar).then(() => { console.log(`${ok} passaram; ${falhas} falharam.`); process.exitCode = falhas ? 1 : 0 })
    .catch(err => { console.error(err); process.exitCode=1 })
}
async function ciclo(testar, cmd, preparar, acao) {
  let timers = new Map(), proximo=0
  cmd._test.injetarTimers((fn,ms) => { assert.equal(ms,120000); const id=++proximo; timers.set(id,fn); return id }, id=>timers.delete(id))
  const iniciar = async () => {
    registro.limparJogos(); timers.clear()
    const s=sock()
    await cmd.executar(s,grupo,msg(),`/${cmd.nome}`)
    preparar(registro.obterJogo(grupo).dados.estado)
    return s
  }
  try {
    await testar('fora de grupo avisa e não cria estado', async()=>{
      registro.limparJogos(); const s=sock()
      await cmd.executar(s,jogador,msg(),`/${cmd.nome}`)
      assert.match(s.enviadas[0].text,/grupo/); assert.equal(registro.jogos.size,0)
    })
    await testar('inicia estado, registra ouvinte e timeout de 2 minutos', async()=>{
      await iniciar(); assert.equal(registro.tipoAtivo(grupo),cmd.nome); assert.equal(timers.size,1)
    })
    await testar('duplicado do mesmo jogo não substitui estado', async()=>{
      const s=await iniciar(), dados=registro.obterJogo(grupo).dados
      await cmd.executar(s,grupo,msg(),`/${cmd.nome}`)
      assert.equal(registro.obterJogo(grupo).dados,dados); assert.match(s.enviadas.at(-1).text,/Já existe/)
    })
    await testar('bloqueio cruzado com quiz', async()=>{
      registro.limparJogos(); registro.registrarJogo(grupo,'quiz',{preservar:true})
      const s=sock(); await cmd.executar(s,grupo,msg(),`/${cmd.nome}`)
      assert.equal(registro.tipoAtivo(grupo),'quiz'); assert.match(s.enviadas[0].text,/Já existe/)
    })
    await testar('dino e cobrinha se bloqueiam mutuamente', async()=>{
      const s=await iniciar(), dados=registro.obterJogo(grupo).dados
      const outro=require(`../comandos/menu-brincadeiras/${cmd.nome === 'dino' ? 'cobrinha' : 'dino'}`)
      await outro.executar(s,grupo,msg(),`/${outro.nome}`)
      assert.equal(registro.obterJogo(grupo).dados,dados); assert.match(s.enviadas.at(-1).text,/Já existe/)
    })
    await testar('outro jogador não move nem desiste', async()=>{
      const s=await iniciar(), estado=JSON.stringify(registro.obterJogo(grupo).dados.estado)
      assert.equal(await registro.processarMensagemLivre(s,grupo,msg('outro@lid'),acao),false)
      await cmd.executar(s,grupo,msg('outro@lid'),`/${cmd.nome} desistir`)
      assert.equal(JSON.stringify(registro.obterJogo(grupo).dados.estado),estado)
    })
    await testar('jogada inválida não altera estado nem renova timeout', async()=>{
      const s=await iniciar(), estado=JSON.stringify(registro.obterJogo(grupo).dados.estado), timer=registro.obterJogo(grupo).dados.timer
      await cmd.executar(s,grupo,msg(),`/${cmd.nome} absurdo`)
      assert.equal(JSON.stringify(registro.obterJogo(grupo).dados.estado),estado)
      assert.equal(registro.obterJogo(grupo).dados.timer,timer)
      assert.equal(await registro.processarMensagemLivre(s,grupo,msg(),'conversa normal'),false)
      assert.equal(await registro.processarMensagemLivre(s,grupo,msg(),'constructor'),false)
    })
    await testar('jogada por texto livre renova timeout e envia estado', async()=>{
      const s=await iniciar(), anterior=registro.obterJogo(grupo).dados.timer
      assert.equal(await registro.processarMensagemLivre(s,grupo,msg(),acao),true)
      assert.notEqual(registro.obterJogo(grupo).dados.timer,anterior)
      assert.equal(timers.has(anterior),false); assert.equal(timers.size,1)
      assert.match(s.enviadas.at(-1).text,/Pontuação/)
    })
    await testar('comando com prefixo personalizado aceita jogada', async()=>{
      const prefixo=require('../prefixo')
      const s=await iniciar()
      const antes=JSON.stringify(registro.obterJogo(grupo).dados.estado)
      prefixo.__definirPrefixoTeste('!')
      try {
        await cmd.executar(s,grupo,msg(),`!${cmd.nome} ${acao}`)
        assert.notEqual(JSON.stringify(registro.obterJogo(grupo).dados.estado),antes)
        assert.match(s.enviadas.at(-1).text,/Pontuação/)
      } finally { prefixo.__definirPrefixoTeste('/') }
    })
    await testar('desistir por texto livre libera grupo e cancela timer', async()=>{
      const s=await iniciar()
      assert.equal(await registro.processarMensagemLivre(s,grupo,msg(),'desistir'),true)
      assert.equal(registro.obterJogo(grupo),null); assert.equal(timers.size,0)
    })
    await testar('desistir pelo comando libera grupo', async()=>{
      const s=await iniciar(); await cmd.executar(s,grupo,msg(),`/${cmd.nome} desistir`)
      assert.equal(registro.obterJogo(grupo),null)
    })
    await testar('timeout automático informa pontuação e libera grupo', async()=>{
      const s=await iniciar(); const callback=[...timers.values()][0]; await callback()
      assert.equal(registro.obterJogo(grupo),null); assert.equal(timers.size,0)
      assert.match(s.enviadas.at(-1).text,/2 minutos.*Pontuação/)
    })
    await testar('callback antigo não encerra uma nova partida', async()=>{
      const s=await iniciar(), antigo=[...timers.values()][0]
      await cmd.executar(s,grupo,msg(),`/${cmd.nome} desistir`)
      await cmd.executar(s,grupo,msg(),`/${cmd.nome}`)
      const atual=registro.obterJogo(grupo); await antigo()
      assert.equal(registro.obterJogo(grupo),atual)
    })
    await testar('falha no envio inicial não deixa partida presa', async()=>{
      registro.limparJogos(); timers.clear()
      await cmd.executar({sendMessage:async()=>{throw new Error('envio simulado')}},grupo,msg(),`/${cmd.nome}`)
      assert.equal(registro.obterJogo(grupo),null); assert.equal(timers.size,0)
    })
  } finally { registro.limparJogos(); timers.clear(); cmd._test.injetarTimers(null,null) }
}
module.exports = {assert,registro,grupo,jogador,msg,sock,random,suite,ciclo}
