// Offline: não carregar credenciais nem abrir conexões reais.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const sessao = require('../sessao-mongo')
let pares = {}, consultasAuth = 0, falhaAuth = false
sessao.obterColecaoAuth = async () => ({ find(filtro) {
  consultasAuth++
  return { toArray: async () => {
    if (falhaAuth) throw new Error('sessão indisponível')
    return filtro._id.$in.flatMap(id => {
      const numero = pares[id.replace('lid-mapping-', '').replace('_reverse', '')]
      return numero ? [{ _id: id, __rawValue__: numero }] : []
    })
  } }
} })
const db = require('../database')
const lid = require('../lid')
const config = require('../config')
const cooldowns = require('../dados/cooldowns')
const prefixo = require('../prefixo')
prefixo.__definirPrefixoTeste('/')
const { listarAtividade } = require('../dados/atividade-grupo')
const rank = require('../comandos/menu-utilitario/rankativo')
const inativos = require('../comandos/admin/inativos')
const grupo = '1@g.us', outro = '2@g.us', bot = '5599999999999'
const dono = '5588888888888'
config.OWNER_NUMBERS.splice(0, config.OWNER_NUMBERS.length, dono)
const pn = n => `${n}@s.whatsapp.net`
const participante = (n, admin) => ({ id: pn(n), admin })
const registro = (n, total, grupo_id = grupo, extras = {}) => ({ usuario_id: String(n), total, grupo_id, ...extras })
let membros, registros, falhaDb, consultasDb, envios
const msg = (sender = pn('5511000000001')) => ({ key: { remoteJid: grupo, participant: sender } })
const sock = {
  user: { id: `${bot}:2@s.whatsapp.net`, lid: '999999@lid' },
  groupMetadata: async () => ({ participants: membros }),
  sendMessage: async (jid, payload) => { envios.push({ jid, ...payload }) }
}
db.buscarContagensGrupo = async jid => {
  consultasDb++
  if (falhaDb) throw new Error('banco indisponível')
  return registros.filter(r => r.grupo_id === jid)
}
db.registrarMensagem = async () => { throw new Error('Comandos não podem gravar contadores') }
function reset() {
  membros = [participante('5511000000001', 'admin'), participante(bot)]
  registros = []; envios = []; consultasDb = 0; consultasAuth = 0
  falhaDb = false; falhaAuth = false; pares = {}
  lid.__definirConsultaSessaoTeste(async id => pares[id] || null)
  cooldowns.limpar()
}
let passou = 0
async function teste(nome, fn) {
  reset()
  await fn()
  passou++
  console.log(`PASSOU: ${nome}`)
}
async function main() {
  await teste('Top 10 de mais de 10 participantes, ordenação e menções', async () => {
    membros = Array.from({ length: 15 }, (_, i) => participante(5511000000010 + i))
    registros = membros.map((p, i) => registro(config.limparNumero(p.id), i + 1))
    await rank.executar(sock, grupo, msg())
    assert.equal(envios[0].mentions.length, 10)
    assert.equal(envios[0].mentions[0], membros[14].id)
    assert.equal(envios[0].mentions[9], membros[5].id)
    assert.deepEqual(envios[0].contextInfo.mentionedJid, envios[0].mentions)
    assert.match(envios[0].text, /contagem acumulada/)
  })
  await teste('Menos de 10 e participante sem registro = zero', async () => {
    membros[0].admin = null
    await rank.executar(sock, grupo, msg())
    assert.equal(envios[0].mentions.length, 1)
    assert.match(envios[0].text, /0 mensagens/)
  })
  await teste('Isolamento de grupos, ex-participante e bot excluídos', async () => {
    registros = [registro('5511000000001', 3), registro('5511000000001', 100, outro), registro('5511444444444', 999), registro(bot, 999)]
    const lista = await listarAtividade(sock, grupo, membros)
    assert.equal(lista.length, 1); assert.equal(lista[0].total, 3)
    assert.equal(consultasDb, 1)
  })
  await teste('Faixa inclusiva 0,1,2,3,4,5 e exclusão de 6+', async () => {
    membros = Array.from({ length: 8 }, (_, i) => participante(5511000000001 + i, i === 0 ? 'admin' : null))
    registros = membros.slice(1).map((p, i) => registro(config.limparNumero(p.id), i + 1))
    await inativos.executar(sock, grupo, msg(), '/inativos')
    assert.match(envios[0].text, /Total: 6 membros/)
    for (let i = 0; i <= 5; i++) assert.match(envios[0].text, new RegExp(`— ${i} ${i === 1 ? 'mensagem' : 'mensagens'}`))
    assert.doesNotMatch(envios[0].text, /— [67] mensagens/)
    assert.equal(envios[0].mentions, undefined); assert.equal(envios[0].contextInfo, undefined)
    assert.match(envios[0].text, /não necessariamente desde a entrada/)
  })
  for (const [nome, sender, admin, permitido] of [
    ['comum bloqueado', '5511000000001', null, false],
    ['ADM permitido', '5511000000001', 'admin', true],
    ['superadmin permitido', '5511000000001', 'superadmin', true],
    ['dono permitido', dono, null, true],
    ['VIP sem ADM bloqueado', '5511000000001', null, false]
  ]) await teste(nome, async () => {
    membros = [{ ...participante(sender, admin), vip: nome.startsWith('VIP') }]
    await inativos.executar(sock, grupo, msg(pn(sender)), '/inativos')
    assert.equal(consultasDb, permitido ? 1 : 0)
    assert.match(envios[0].text, permitido ? /MEMBROS INATIVOS/ : /Apenas ADM/)
  })
  await teste('ADM via LID e telefone dos metadados, soma LID + PN', async () => {
    membros = [{ id: '12345@lid', phoneNumber: pn('5511000000001'), admin: 'admin' }]
    registros = [registro('12345', 2), registro('5511000000001', 3)]
    await inativos.executar(sock, grupo, msg('12345@lid'), '/inativos')
    assert.match(envios[0].text, /5511000000001 — 5 mensagens/)
    assert.doesNotMatch(envios[0].text, /👤 12345/)
    cooldowns.limpar(); await rank.executar(sock, grupo, msg('12345@lid'))
    assert.deepEqual(envios[1].mentions, ['12345@lid'])
  })
  await teste('Dono via LID mapeado na sessão', async () => {
    pares = { '12345': dono }
    membros = [{ id: '12345@lid' }]
    await inativos.executar(sock, grupo, msg('12345@lid'), '/inativos')
    assert.match(envios[0].text, /MEMBROS INATIVOS/)
  })
  await teste('LID desconhecido não inventa telefone nem concede dono', async () => {
    membros.push({ id: '77777@lid' }, { id: `${dono}@lid` })
    await inativos.executar(sock, grupo, msg(), '/inativos')
    assert.match(envios[0].text, /LID 77777 \(telefone indisponível\)/)
    assert.doesNotMatch(envios[0].text, /👤 77777 —/)
    await inativos.executar(sock, grupo, msg(`${dono}@lid`), '/inativos')
    assert.match(envios[1].text, /Apenas ADM/)
  })
  await teste('Lote da sessão une registros legados e exclui bot por LID', async () => {
    pares = { '12345': '5511000000001', '999999': bot }
    membros = [participante('5511000000001'), { id: '999999@lid' }]
    registros = [registro('12345', 100), registro('5511000000001', 2), registro('999999', 999)]
    const lista = await listarAtividade(sock, grupo, membros)
    assert.equal(lista.length, 1); assert.equal(lista[0].total, 102)
    assert.equal(consultasAuth, 1)
  })
  await teste('Campo lid preservado associa registro à pessoa atual', async () => {
    membros = [{ id: '12345@lid' }]
    registros = [registro('5511000000001', 3, grupo, { lid: '12345' })]
    const lista = await listarAtividade(sock, grupo, membros)
    assert.equal(lista[0].total, 3)
    assert.equal(lista[0].telefone, '')
  })
  await teste('Sem limite de 40: registro abaixo do antigo corte é incluído', async () => {
    registros = Array.from({ length: 60 }, (_, i) => registro(5522000000000 + i, 1000))
    registros.push(registro('5511000000001', 2))
    assert.equal((await listarAtividade(sock, grupo, membros))[0].total, 2)
  })
  await teste('Paginação de 45 membros em 3 páginas e prefixo dinâmico', async () => {
    membros = Array.from({ length: 45 }, (_, i) => participante(5511000000001 + i, i === 0 ? 'admin' : null))
    prefixo.__definirPrefixoTeste('!')
    for (const pagina of [1, 2, 3]) await inativos.executar(sock, grupo, msg(), `!inativos ${pagina}`)
    assert.equal((envios[0].text.match(/👤 /g) || []).length, 20)
    assert.equal((envios[1].text.match(/👤 /g) || []).length, 20)
    assert.equal((envios[2].text.match(/👤 /g) || []).length, 5)
    assert.match(envios[0].text, /Total: 45/); assert.match(envios[1].text, /Página 2 de 3/)
    assert.match(envios[0].text, /!inativos 2/)
    prefixo.__definirPrefixoTeste('/')
  })
  await teste('Páginas inválidas e fora dos limites', async () => {
    for (const arg of ['0', '-1', '1.5', 'abc', '2', '1 extra']) {
      await inativos.executar(sock, grupo, msg(), `/inativos ${arg}`)
      assert.match(envios.at(-1).text, /⚠️/)
    }
  })
  await teste('Inativos ordenados por total mesmo com metadados fora de ordem', async () => {
    membros = Array.from({ length: 6 }, (_, i) => participante(5511000000001 + i, i === 0 ? 'admin' : null))
    registros = membros.map((p, i) => registro(config.limparNumero(p.id), 5 - i))
    await inativos.executar(sock, grupo, msg(), '/inativos')
    const totais = [...envios[0].text.matchAll(/— (\d+) mensage/g)].map(m => Number(m[1]))
    assert.deepEqual(totais, [0, 1, 2, 3, 4, 5])
  })
  await teste('Comandos fora de grupos não consultam dados', async () => {
    for (const c of [rank, inativos]) await c.executar(sock, pn('5511000000001'), msg())
    assert.equal(consultasDb, 0); assert.ok(envios.every(e => /só funciona em grupos/.test(e.text)))
  })
  await teste('Falha do banco não vira lista de zeros', async () => {
    falhaDb = true
    for (const c of [rank, inativos]) await c.executar(sock, grupo, msg())
    assert.ok(envios.every(e => /Não consegui consultar/.test(e.text)))
  })
  await teste('Falha dos metadados e de envio não escapa', async () => {
    for (const c of [rank, inativos]) {
      await c.executar({ ...sock, groupMetadata: async () => { throw new Error('metadados') } }, grupo, msg())
      await c.executar({ ...sock, sendMessage: async () => { throw new Error('envio') } }, grupo, msg())
    }
  })
  await teste('Cooldown compartilhado: sucesso marca, falha não marca', async () => {
    await rank.executar(sock, grupo, msg()); await rank.executar(sock, grupo, msg())
    assert.equal(consultasDb, 1); assert.match(envios[1].text, /Aguarde/)
    cooldowns.limpar(); falhaDb = true; await rank.executar(sock, grupo, msg())
    falhaDb = false; await rank.executar(sock, grupo, msg())
    assert.match(envios.at(-1).text, /RANKING DE ATIVIDADE/)
  })
  await teste('Leitura real do database é única, isolada, sem limite e falha lança', async () => {
    let filtro, consultas = 0, falhar = false
    const colecao = { createIndex: async () => {}, find(f) {
      consultas++; filtro = f
      return { toArray: async () => { if (falhar) throw new Error('offline'); return [registro('123', 4)] } }
    } }
    class MongoClient {
      async connect() {}
      db() { return { command: async () => {}, collection: () => colecao } }
    }
    const contexto = { module: { exports: {} }, process: { env: { MONGODB_URI: 'offline' } }, console: { log() {}, error() {} }, require: () => ({ MongoClient }) }
    vm.runInNewContext(fs.readFileSync(require.resolve('../database'), 'utf8'), contexto)
    const dados = await contexto.module.exports.buscarContagensGrupo(grupo)
    assert.equal(filtro.grupo_id, grupo); assert.equal(consultas, 1); assert.equal(dados[0].total, 4)
    falhar = true; await assert.rejects(contexto.module.exports.buscarContagensGrupo(grupo), /offline/)
  })
  await teste('Falha de mapeamento em lote preserva identificação clara', async () => {
    membros.push({ id: '12345@lid' }); falhaAuth = true
    await inativos.executar(sock, grupo, msg(), '/inativos')
    assert.match(envios[0].text, /LID 12345 \(telefone indisponível\)/)
    assert.equal(consultasAuth, 1)
  })
  await teste('Cursor de sessão preserva documentos e cache do lote é reutilizado', async () => {
    const doc = { _id: 'lid-mapping-12345_reverse', __rawValue__: '5511000000001' }
    const cursor = { toArray: async () => [doc] }
    const vestido = sessao.vestirColecaoAuth({ find(filtro, opcoes) {
      assert.deepEqual(filtro, { _id: doc._id }); assert.deepEqual(opcoes, { projection: { _id: 1 } })
      return cursor
    } })
    assert.equal(vestido.find({ _id: doc._id }, { projection: { _id: 1 } }), cursor)
    pares = { '12345': '5511000000001' }
    const primeiro = await lid.resolverLidsEmLote(['12345@lid', '12345'])
    const segundo = await lid.resolverLidsEmLote(['12345'])
    assert.equal(primeiro.get('12345'), '5511000000001')
    assert.deepEqual(primeiro, segundo); assert.equal(consultasAuth, 1)
  })
  await teste('Menus sem duplicação, nenhuma gravação ou contador paralelo', async () => {
    for (const [arquivo, nome] of [['../comandos/admin/menu-admin', 'inativos'], ['../comandos/menu-utilitario/menu-utilitario', 'rankativo']]) {
      const fonte = fs.readFileSync(require.resolve(arquivo), 'utf8')
      assert.equal(fonte.split(`/${nome}`).length - 1, 1)
    }
    for (const arquivo of ['../dados/atividade-grupo', '../comandos/admin/inativos', '../comandos/menu-utilitario/rankativo']) {
      assert.doesNotMatch(fs.readFileSync(require.resolve(arquivo), 'utf8'), /registrarMensagem|\$inc|updateOne|process\.exit\(/)
    }
  })
  console.log(`\n${passou} testes passaram.`)
}
main().catch(err => { console.error(err); process.exitCode = 1 })
