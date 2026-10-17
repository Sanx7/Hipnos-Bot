// Offline: comandos reais em VM, JSON em memória e socket/sessão simulados.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
process.env.OWNER_NUMBERS = '5511999990000,5511999990001'
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { createRequire } = require('node:module')
require('node:net').Socket.prototype.connect = function () { throw new Error('Rede proibida no teste offline') }
const lid = require('../lid')
const { obterAlvoBlacklist } = require('../dados/blacklist-alvo')
require('../prefixo').__definirPrefixoTeste('!')
const G = '123@g.us', DONO = '5511999990000@s.whatsapp.net', DONO2 = '5511999990001@s.whatsapp.net'
const BOT = '5511999992222@s.whatsapp.net', NUMERO = '55139757976987', ALVO = `${NUMERO}@s.whatsapp.net`
const COMUM = '5511888880000@s.whatsapp.net'
const pares = new Map()
const resolverLoteOriginal = lid.resolverLidsEmLote
lid.resolverLidsEmLote = async ids => new Map(ids.map(id => id.split('@')[0]).filter(id => pares.has(id)).map(id => [id, pares.get(id)]))
let total = 0
async function teste(nome, fn) {
  pares.clear(); lid.__definirConsultaSessaoTeste(async id => pares.get(id) || null)
  await fn(); total++; console.log(`OK: ${nome}`)
}
function mensagem(alvo, reply = false, sender = DONO) {
  return { key: { remoteJid: G, participant: sender, id: 'offline', fromMe: false }, message: {
    extendedTextMessage: { contextInfo: alvo ? reply ? { participant: alvo } : { mentionedJid: [alvo] } : {} }
  } }
}
function fixture(lista = []) {
  const estado = { dados: JSON.stringify(lista), escritas: 0, falharLeitura: false, falharEscrita: false }
  const memoria = {
    existsSync: () => true, mkdirSync() { throw new Error('Não criar diretórios reais') },
    readFileSync(p) { assert.equal(path.basename(p), 'blacklist.json'); if (estado.falharLeitura) throw new Error('Leitura falhou'); return estado.dados },
    writeFileSync(p, dados) { assert.equal(path.basename(p), 'blacklist.json'); if (estado.falharEscrita) throw new Error('Escrita falhou'); estado.escritas++; estado.dados = dados }
  }
  const carregar = nome => {
    const arquivo = require.resolve(`../comandos/admin/${nome}`), mod = { exports: {} }, requerer = createRequire(arquivo)
    vm.runInNewContext(fs.readFileSync(arquivo, 'utf8'), { module: mod, __dirname: path.dirname(arquivo),
      console: { log() {}, warn() {}, error() {} }, require: n => n === 'fs' ? memoria : requerer(n)
    }, { filename: arquivo })
    return mod.exports
  }
  const envios = [], remocoes = []
  const sock = {
    user: { id: BOT, lid: '111@lid' },
    participantes: [{ id: '111@lid', phoneNumber: BOT, admin: 'admin' }, { id: '222@lid', phoneNumber: DONO }, { id: COMUM, admin: 'admin' }],
    async groupMetadata() { return { participants: this.participantes } },
    async sendMessage(jid, c) { envios.push({ jid, ...c }) },
    async groupParticipantsUpdate(jid, alvos, acao) { remocoes.push({ jid, alvos: [...alvos], acao }); return [] }
  }
  return { estado, sock, envios, remocoes, lista: () => JSON.parse(estado.dados),
    executar: (nome, texto, msg = mensagem(), jid = G) => carregar(nome).executar(sock, jid, msg, texto) }
}
const resposta = f => f.envios.at(-1)?.text || ''
async function main() {
  await teste('número puro, internacional e formatado usam JID PN, sem consultas externas', () => {
    for (const valor of [NUMERO, '+55139757976987', '+55 (13) 97579-76987', '(55) (13) 97579-76987', '55 13 97579 76987']) {
      assert.equal(obterAlvoBlacklist(mensagem(), `!addblacklist ${valor}`).jid, ALVO)
    }
  })
  await teste('entradas inválidas, texto misturado, vários números e parênteses incompletos são recusados', () => {
    for (const valor of ['', '123', '0'.repeat(13), '1'.repeat(16), `${NUMERO}abc`, 'abc'+NUMERO, '++'+NUMERO,
      NUMERO+' '+NUMERO, '+55 (13 97579-76987', '55)13(9757976987', NUMERO+'-', '@'+NUMERO, '1'.repeat(79)+'x', '1'.repeat(1000)]) {
      assert.equal(obterAlvoBlacklist(mensagem(), `!addblacklist ${valor}`), null, valor)
    }
  })
  await teste('adiciona pessoa fora do grupo ao JSON existente sem tentativa de remoção', async () => {
    const f = fixture(['5511888880009'])
    await f.executar('addblacklist', `!addblacklist ${NUMERO}`)
    assert.deepEqual(f.lista(), ['5511888880009', NUMERO])
    assert.equal(f.remocoes.length, 0)
    assert.match(resposta(f), new RegExp(NUMERO)); assert.match(resposta(f), /adicionado/)
    assert.doesNotMatch(resposta(f), /@s\.whatsapp|@lid/)
  })
  await teste('formatação e comando obtido do texto original não duplicam registros', async () => {
    const f = fixture()
    const msg = { ...mensagem(), message: { conversation: '!addblacklist +55 (13) 97579-76987' } }
    await f.executar('addblacklist', undefined, msg)
    await f.executar('addblacklist', `!addblacklist ${NUMERO}`)
    assert.deepEqual(f.lista(), [NUMERO]); assert.equal(f.estado.escritas, 1)
    assert.match(resposta(f), /já/)
  })
  await teste('chamadas simultâneas não leem lista obsoleta nem duplicam o mesmo número', async () => {
    const f = fixture()
    await Promise.all([f.executar('addblacklist', `!addblacklist ${NUMERO}`), f.executar('addblacklist', `!addblacklist +55 (13) 97579-76987`)])
    assert.deepEqual(f.lista(), [NUMERO]); assert.equal(f.estado.escritas, 1)
  })
  await teste('número digitado de membro atual usa o JID/LID real para remover', async () => {
    const f = fixture()
    f.sock.participantes.push({ id: '333@lid', phoneNumber: ALVO })
    await f.executar('addblacklist', `!addblacklist ${NUMERO}`)
    assert.deepEqual(f.lista(), [NUMERO]); assert.deepEqual(f.remocoes[0].alvos, ['333@lid'])
  })
  for (const reply of [false, true]) await teste(`preserva ${reply ? 'reply' : 'menção'} PN e LID com prioridade sobre argumento`, async () => {
    for (const alvo of [ALVO, '333@lid']) {
      const f = fixture()
      f.sock.participantes.push({ id: '333@lid', phoneNumber: ALVO })
      await f.executar('addblacklist', '!addblacklist argumento ignorado', mensagem(alvo, reply))
      assert.deepEqual(f.lista(), [NUMERO]); assert.deepEqual(f.remocoes[0].alvos, [alvo])
      await f.executar('remblacklist', '!remblacklist argumento ignorado', mensagem(alvo, reply))
      assert.deepEqual(f.lista(), [])
    }
  })
  await teste('menção em legenda reutiliza a extração normalizada existente', () => {
    const msg = { message: { imageMessage: { caption: '!addblacklist @pessoa', contextInfo: { mentionedJid: [ALVO] } } } }
    assert.equal(obterAlvoBlacklist(msg).jid, ALVO)
  })
  await teste('remblacklist aceita número formatado e remove duplicatas/variantes legadas', async () => {
    const f = fixture([NUMERO, NUMERO, '333', '5511888880009'])
    f.sock.participantes.push({ id: '333@lid', phoneNumber: ALVO })
    await f.executar('remblacklist', '!remblacklist +55 (13) 97579-76987')
    assert.deepEqual(f.lista(), ['333', '5511888880009'])
    assert.match(resposta(f), new RegExp(NUMERO))
    await f.executar('remblacklist', '!remblacklist', mensagem('333@lid'))
    assert.deepEqual(f.lista(), ['5511888880009'])
  })
  await teste('alvo não encontrado e entrada inválida não alteram armazenamento', async () => {
    for (const nome of ['addblacklist', 'remblacklist']) {
      const f = fixture()
      await f.executar(nome, `!${nome} abc${NUMERO}`)
      assert.equal(f.estado.escritas, 0); assert.equal(f.remocoes.length, 0)
      assert.match(resposta(f), new RegExp('!'+nome)); assert.match(resposta(f), /DDI e DDD/)
    }
    const f = fixture()
    await f.executar('remblacklist', `!remblacklist ${NUMERO}`)
    assert.equal(f.estado.escritas, 0); assert.match(resposta(f), /não foi encontrado/)
  })
  await teste('administrador comum não pode cadastrar/remover; dono por LID mantém acesso', async () => {
    const f = fixture()
    for (const nome of ['addblacklist', 'remblacklist']) await f.executar(nome, `!${nome} ${NUMERO}`, mensagem(null, false, COMUM))
    assert.equal(f.estado.escritas, 0); assert.equal(f.remocoes.length, 0)
    await f.executar('addblacklist', `!addblacklist ${NUMERO}`, mensagem(null, false, '222@lid'))
    assert.deepEqual(f.lista(), [NUMERO])
  })
  await teste('LID com mesmos dígitos de dono não autoriza sem prova', async () => {
    const f = fixture()
    await f.executar('addblacklist', `!addblacklist ${NUMERO}`, mensagem(null, false, DONO.replace('s.whatsapp.net', 'lid')))
    assert.equal(f.estado.escritas, 0)
  })
  await teste('bot por número, menção ou reply permanece protegido', async () => {
    for (const [alvo, texto] of [[null, '!addblacklist +55 (11) 99999-2222'], ['111@lid', '!addblacklist'], [BOT, '!addblacklist']]) {
      const f = fixture()
      await f.executar('addblacklist', texto, mensagem(alvo, true))
      assert.equal(f.estado.escritas, 0); assert.equal(f.remocoes.length, 0)
    }
  })
  await teste('donos por número e LID resolvido via sessão continuam protegidos', async () => {
    const f = fixture()
    await f.executar('addblacklist', '!addblacklist +55 (11) 99999-0001')
    assert.equal(f.estado.escritas, 0)
    pares.set('444', DONO2.split('@')[0])
    await f.executar('addblacklist', '!addblacklist', mensagem('444@lid'))
    assert.equal(f.estado.escritas, 0); assert.equal(f.remocoes.length, 0)
    assert.match(resposta(f), /dono do bot/)
  })
  await teste('sessão do bot só com LID desconhecido bloqueia antes de persistir', async () => {
    const f = fixture()
    f.sock.user = { id: '555@lid' }
    await f.executar('addblacklist', `!addblacklist ${NUMERO}`)
    assert.equal(f.estado.escritas, 0); assert.equal(f.remocoes.length, 0)
  })
  await teste('LID desconhecido não é cadastrado como se fosse telefone', async () => {
    const f = fixture()
    await f.executar('addblacklist', '!addblacklist', mensagem('666@lid'))
    assert.equal(f.estado.escritas, 0); assert.equal(f.remocoes.length, 0)
  })
  await teste('privado e falha de metadados: dono PN cadastra número externo sem remoção', async () => {
    for (const jid of [G, DONO]) {
      const f = fixture()
      f.sock.groupMetadata = async () => { throw new Error('Metadados offline') }
      await f.executar('addblacklist', `!addblacklist ${NUMERO}`, { ...mensagem(), key: { participant: DONO, remoteJid: jid } }, jid)
      assert.deepEqual(f.lista(), [NUMERO]); assert.equal(f.remocoes.length, 0)
    }
  })
  await teste('JSON corrompido e falhas de leitura/escrita não confirmam nem removem usuário', async () => {
    for (const nome of ['addblacklist', 'remblacklist']) for (const modo of ['json', 'tipo', 'leitura', 'escrita']) {
      const f = fixture([NUMERO])
      if (modo === 'json') f.estado.dados = '{'
      if (modo === 'tipo') f.estado.dados = '{}'
      if (modo === 'leitura') f.estado.falharLeitura = true
      if (modo === 'escrita') f.estado.falharEscrita = true
      const antes = f.estado.dados
      await f.executar(nome, `!${nome} ${nome === 'addblacklist' ? '5511888880009' : NUMERO}`)
      assert.equal(f.estado.dados, antes); assert.equal(f.remocoes.length, 0)
      assert.match(resposta(f), /Não consegui concluir/)
    }
  })
  await teste('falha de remoção no grupo mantém cadastro e confirmação apenas da blacklist', async () => {
    const f = fixture()
    f.sock.participantes.push({ id: ALVO })
    f.sock.groupParticipantsUpdate = async () => { throw new Error('Sem privilégio') }
    await f.executar('addblacklist', `!addblacklist ${NUMERO}`)
    assert.deepEqual(f.lista(), [NUMERO]); assert.match(resposta(f), /adicionado à lista/)
  })
  console.log(`\n${total} cenários de blacklist passaram; nenhum arquivo de dados ou serviço real foi usado.`)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => { lid.__definirConsultaSessaoTeste(null); lid.resolverLidsEmLote = resolverLoteOriginal })
