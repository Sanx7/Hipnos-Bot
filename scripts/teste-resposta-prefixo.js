// Offline: fonte real de prefixos, /set-prefix real e socket/coleção simulados.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
process.env.OWNER_NUMBERS = '5511999990009'
const assert = require('node:assert/strict')
const resposta = require('../dados/resposta-prefixo')
const cooldowns = require('../dados/cooldowns')
const prefixo = require('../prefixo')
const setPrefix = require('../comandos/menu-dono/set-prefix')
const GRUPO = '100@g.us', PRIVADO = '5511888880000@s.whatsapp.net'
const msg = { key: { remoteJid: GRUPO, participant: PRIVADO }, message: { conversation: 'prefixo' } }
let agora = 100000, passou = 0
const agoraOriginal = Date.now
Date.now = () => agora
function ambiente() {
  cooldowns.limpar()
  prefixo.__definirPrefixoTeste('/')
  const envios = []
  const sock = { async sendMessage(jid, conteudo, opcoes) { envios.push({ jid, ...conteudo, opcoes }); return { key: { id: 'offline' } } } }
  return { sock, envios, consultar: (texto = 'prefixo', jid = GRUPO) => resposta.processar(sock, jid, msg, texto) }
}
async function teste(nome, fn) { const a = ambiente(); await fn(a); passou++; console.log(`✅ ${nome}`) }
async function main() {
  for (const palavra of ['prefixo', 'Prefixo', 'PREFIXO', 'PrEfIxO', ' Prefixo ', '\tPREFIXO\n']) {
    await teste(`gatilho ${JSON.stringify(palavra)}`, async a => {
      assert.equal(await a.consultar(palavra), true)
      assert.equal(a.envios.length, 1)
      assert.equal(a.envios[0].text, '🌙 *Hipnos — O Senhor dos Sonhos*\n\n💤 Mortal, deseja invocar meus poderes?\n\n🔱 Meu prefixo atual é: /\n\n🌑 Use /menu para explorar os reinos dos sonhos.')
      assert.equal(a.envios[0].opcoes.quoted, msg)
    })
  }
  for (const texto of ['qual é o prefixo?', 'me fala o prefixo', 'prefixos', 'prefixo?', 'prefixo menu', '/prefixo', '!prefixo', '"prefixo"', '', null, undefined]) {
    await teste(`ignora ${JSON.stringify(texto)}`, async a => {
      assert.equal(await resposta.processar(a.sock, GRUPO, msg, texto), false)
      assert.equal(a.envios.length, 0); assert.equal(cooldowns.cooldowns.size, 0)
    })
  }
  await teste('prefixo personalizado consultado na fonte real', async a => {
    prefixo.__definirPrefixoTeste('!')
    await a.consultar(); assert.match(a.envios[0].text, /atual é: !/); assert.match(a.envios[0].text, /Use !menu/)
  })
  await teste('funciona em grupo e no privado', async a => {
    await a.consultar('prefixo', GRUPO); await a.consultar('prefixo', PRIVADO)
    assert.deepEqual(a.envios.map(e => e.jid), [GRUPO, PRIVADO])
  })
  await teste('cooldown de 10 segundos por conversa, compartilhado por participantes', async a => {
    await a.consultar()
    assert.equal(await resposta.processar(a.sock, GRUPO, { ...msg, key: { remoteJid: GRUPO, participant: '999@lid' } }, 'PREFIXO'), true)
    agora += 9999; await a.consultar(); assert.equal(a.envios.length, 1)
    agora += 1; await a.consultar(); assert.equal(a.envios.length, 2)
  })
  await teste('conversas diferentes não compartilham cooldown', async a => {
    for (const jid of [GRUPO, '200@g.us', PRIVADO, '777@lid']) await a.consultar('prefixo', jid)
    assert.equal(a.envios.length, 4)
  })
  await teste('cooldown exclusivo não bloqueia jogos nem comandos', async a => {
    cooldowns.marcar(GRUPO); cooldowns.marcar(PRIVADO)
    await a.consultar(); assert.equal(a.envios.length, 1)
    assert.equal(await a.consultar('/menu'), false)
  })
  await teste('mensagens simultâneas produzem uma só resposta', async a => {
    let liberar
    const espera = new Promise(resolve => { liberar = resolve })
    const enviar = a.sock.sendMessage
    a.sock.sendMessage = async (...args) => { await espera; return enviar(...args) }
    const primeira = a.consultar()
    assert.equal(await a.consultar('PREFIXO'), true)
    liberar(); await primeira; assert.equal(a.envios.length, 1)
  })
  await teste('falha de envio é contida e não consome cooldown', async a => {
    const enviar = a.sock.sendMessage
    a.sock.sendMessage = async () => { throw new Error('falha simulada') }
    assert.equal(await a.consultar(), true); assert.equal(cooldowns.cooldowns.size, 0)
    a.sock.sendMessage = enviar
    await a.consultar(); assert.equal(a.envios.length, 1)
  })
  await teste('alteração dinâmica pelo /set-prefix afeta todas as conversas', async a => {
    let documento = null, escritas = 0
    prefixo.__definirColecaoTeste({
      findOne: async () => documento,
      updateOne: async (filtro, atualizacao) => { assert.deepEqual(filtro, { _id: 'global' }); documento = atualizacao.$set; escritas++ }
    })
    const dono = { key: { remoteJid: GRUPO, participant: '5511999990009@s.whatsapp.net' } }
    await setPrefix.executar(a.sock, GRUPO, dono, '/set-prefix !')
    await a.consultar('prefixo', PRIVADO)
    assert.match(a.envios.at(-1).text, /Use !menu/)
    await setPrefix.executar(a.sock, GRUPO, dono, '!set-prefix ?')
    await a.consultar('prefixo', '200@g.us')
    assert.match(a.envios.at(-1).text, /Use \?menu/)
    assert.equal(escritas, 2)
  })
  await teste('falha do banco mantém o mesmo fallback do roteador', async a => {
    prefixo.__definirColecaoTeste({ findOne: async () => { throw new Error('offline') } })
    prefixo.__limparCacheTeste()
    await a.consultar(); assert.match(a.envios.at(-1).text, /Use \/menu/)
  })
  console.log(`\n${passou} testes de resposta automática passaram.`)
}
main().catch(erro => { console.error(erro); process.exitCode = 1 }).finally(() => { Date.now = agoraOriginal; cooldowns.limpar() })
