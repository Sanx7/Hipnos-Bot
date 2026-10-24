process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
require('node:net').Socket.prototype.connect = function () { throw Error('REDE_PROIBIDA') }
require('mongodb').MongoClient.prototype.connect = async function () { throw Error('MONGO_PROIBIDO') }
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const existe = fs.existsSync
fs.existsSync = p => path.basename(String(p)) === '.env' ? false : existe(p)
const tempo = require('../dados/aniversarios-tempo')
const mongo = require('../dados/aniversarios-mongo')
const comandos = require('../dados/aniversarios-comandos')
const identidade = require('../dados/aniversarios-identidade')
const conexao = require('../rpg/conexao-mongo')
const seguro = require('../dados/socket-seguro')
const lid = require('../lid')
const prefixo = require('../prefixo')
const { criarAgendador } = require('../aniversarios')
const criarBanco = require('./helpers/aniversarios-mongo-fake')
const A = '5511999990000', B = '5511888880000', C = '5511777770000', BOT = '5511666660000'
const G = '123@g.us', G2 = '456@g.us', pn = n => n+'@s.whatsapp.net'
let total = 0
async function teste(nome, fn) { lid.__definirConsultaSessaoTeste(async () => null); await fn(); total++; console.log('OK:', nome) }
async function ambiente({ quando = '2026-10-27T15:00:00Z', banco = criarBanco(), privacidade = true, envio, data = '27/10' } = {}) {
  let agora = +new Date(quando), ligado = true, lease = true
  const repo = mongo.criarRepositorio(banco.usar)
  const metas = {
    [G]: { id: G, announce: false, participants: [{ id: '111@lid', phoneNumber: pn(A) }, { id: pn(B), admin: 'admin' }, { id: pn(BOT) }] },
    [G2]: { id: G2, announce: false, participants: [{ id: pn(A) }, { id: pn(C), admin: 'superadmin' }, { id: pn(BOT) }] }
  }
  const envios = [], avisos = [], timers = new Set()
  const sock = { user: { id: pn(BOT) }, ws: { isOpen: true },
    groupFetchAllParticipating: async () => Object.fromEntries(Object.keys(metas).map(jid => [jid, {}])),
    groupMetadata: async jid => structuredClone(metas[jid]),
    async sendMessage(jid, payload, opts) { envios.push({ jid, payload, opts }); return envio ? envio(jid, payload, opts) : { key: { id: 'offline-'+envios.length, remoteJid: jid } } }
  }
  seguro.preparar(sock, () => lease); seguro.atualizar(sock, true)
  const opcoes = { repo, relogio: () => agora, ligado: async () => ligado,
    intervalo: (fn, ms) => { const t = { fn, ms, unref() {} }; timers.add(t); return t }, cancelar: t => timers.delete(t) }
  const agenda = criarAgendador(opcoes)
  await repo.salvar(A, tempo.lerData(data), agora)
  if (privacidade) await repo.privacidade(A, true, agora)
  let notificacoes = 0
  const cmds = comandos.criarComandos({ repo, relogio: () => agora, notificar: () => { notificacoes++; return agenda.verificar() } })
  async function chamar(nome, args = '', sender = pn(A), jid = G) {
    const msg = { key: { id: 'offline', remoteJid: jid, ...(jid.endsWith('@g.us') ? { participant: sender } : {}) }, message: { conversation: '!'+nome+' '+args } }
    const sockComando = { groupMetadata: sock.groupMetadata, async sendMessage(jid, payload, opts) { avisos.push({ jid, payload, opts }) } }
    await cmds.find(c => c.nome === nome).executar(sockComando, jid, msg, '!'+nome+' '+args)
    return avisos.at(-1)?.payload
  }
  return { repo, banco, sock, metas, envios, avisos, timers, agenda, opcoes, chamar,
    hoje: () => tempo.calendario(agora), notificacoes: () => notificacoes,
    mudarData: v => { agora = +new Date(v) }, desligar: () => { ligado = false }, perderLease: () => { lease = false } }
}
async function main() {
  prefixo.__definirPrefixoTeste('!')
  for (const valor of ['01/01','29/02','30/04','31/12']) await teste('data valida '+valor, () => assert.ok(tempo.lerData(valor)))
  for (const valor of ['00/01','32/01','31/04','30/02','01/00','01/13','1/1','27/10/2026','abc','27/10 extra']) await teste('data invalida '+valor, () => assert.equal(tempo.lerData(valor), null))
  await teste('bissextos seculares e politica de fevereiro', () => {
    assert.equal(tempo.bissexto(2000), true); assert.equal(tempo.bissexto(2100), false)
    const doc = { dia: 29, mes: 2 }
    assert.ok(tempo.ocorre(doc, { ano: 2027, mes: 2, dia: 28 }))
    assert.ok(!tempo.ocorre(doc, { ano: 2028, mes: 2, dia: 28 }))
    assert.ok(tempo.ocorre(doc, { ano: 2028, mes: 2, dia: 29 }))
    assert.equal(tempo.proxima(doc, { ano: 2027, mes: 3, dia: 1 }).ordem, 20280229)
  })
  await teste('fuso Sao Paulo e virada cronologica', () => {
    assert.equal(tempo.calendario(+new Date('2026-10-27T02:59:59Z')).chave, '2026-10-26')
    assert.equal(tempo.calendario(+new Date('2026-10-27T03:00:00Z')).chave, '2026-10-27')
    assert.equal(tempo.proxima({ dia: 1, mes: 1 }, { ano: 2026, mes: 12, dia: 31 }).ordem, 20270101)
  })
  await teste('cadastro privado, atualizacao reseta consentimento e remocao propria', async () => {
    const c = await ambiente({ privacidade: false })
    let doc = await c.repo.consultar(A); assert.equal(doc.publico, false); assert.equal(doc.ano, undefined)
    const criado = +doc.criadoEm, revisao = doc.revisao
    await c.repo.privacidade(A, true); await c.repo.salvar(A, tempo.lerData('28/10'))
    doc = await c.repo.consultar(A); assert.equal(doc.publico, false); assert.equal(doc.dia, 28)
    assert.equal(+doc.criadoEm, criado); assert.notEqual(doc.revisao, revisao)
    assert.equal(await c.repo.privacidade(B, true), false)
    await c.repo.salvar(B, tempo.lerData('01/01')); await c.repo.remover(A)
    assert.equal(await c.repo.consultar(A), null); assert.ok(await c.repo.consultar(B))
    assert.deepEqual([...c.banco.colecoes.keys()].sort(), ['aniversariosEntregas','aniversariosHipnos'])
  })
  await teste('repositorio novo recupera estado persistido, com escritas confirmadas', async () => {
    const c = await ambiente(), outro = mongo.criarRepositorio(c.banco.usar)
    assert.equal((await outro.consultar(A)).publico, true)
    const perfil = c.banco.colecoes.get('aniversariosHipnos'); perfil.semConfirmacao = true
    await assert.rejects(outro.salvar(A, tempo.lerData('28/10')), /RESULTADO_INCERTO/)
    await assert.rejects(outro.privacidade(A, true), /RESULTADO_INCERTO/)
    await assert.rejects(outro.remover(A), /RESULTADO_INCERTO/)
  })
  await teste('pool RPG reutilizado, indice proprio e concerns majority', async () => {
    const banco = criarBanco(), anterior = conexao.usarContextoRpg
    conexao.usarContextoRpg = fn => fn({ banco: banco.banco })
    try {
      const repo = mongo.criarRepositorio()
      await Promise.all([repo.salvar(A, tempo.lerData('27/10')), repo.consultar(A)])
      assert.equal(banco.colecoes.get('aniversariosHipnos').indices.length, 1)
      assert.ok(banco.opcoes.every(o => o.opts.writeConcern.w === 'majority' && o.opts.readConcern.level === 'majority'))
    } finally { conexao.usarContextoRpg = anterior }
  })
  await teste('comandos usam somente remetente comprovado, prefixo e controle explicito', async () => {
    const c = await ambiente({ privacidade: false })
    await c.chamar('aniversario', '31/04'); assert.equal((await c.repo.consultar(A)).dia, 27)
    await c.chamar('aniversario', '29/02', '111@lid'); assert.equal((await c.repo.consultar(A)).dia, 29)
    const r = await c.chamar('aniversario', 'publico', '111@lid'); assert.match(r.text, /menção ao grupo inteiro/)
    assert.equal((await c.repo.consultar(A)).publico, true)
    await c.chamar('aniversario', 'privado'); assert.equal((await c.repo.consultar(A)).publico, false)
    const erro = await c.chamar('aniversario', '01/01', A+'@lid'); assert.match(erro.text, /identidade/)
    assert.equal((await c.repo.consultar(A)).dia, 29)
    const uso = await c.chamar('aniversario', '27/10 publico'); assert.match(uso.text, /!aniversario/)
    await c.chamar('removeraniversario', '@alguem'); assert.ok(await c.repo.consultar(A))
    await c.chamar('removeraniversario'); assert.equal(await c.repo.consultar(A), null)
  })
  await teste('consulta propria nunca repete data privada no grupo', async () => {
    const c = await ambiente({ privacidade: false })
    const antes = await c.repo.consultar(A)
    const grupo = await c.chamar('meuaniversario')
    assert.doesNotMatch(grupo.text, /27\/10/)
    assert.match(grupo.text, /privado com !meuaniversario/)
    const r = await c.chamar('meuaniversario', '', pn(A), pn(A))
    assert.match(r.text, /27\/10/); assert.match(r.text, /Privado/)
    assert.deepEqual(await c.repo.consultar(A), antes)
  })
  await teste('consulta publica mostra data no grupo e no privado sem alterar cadastro', async () => {
    const c = await ambiente({ privacidade: false })
    await c.chamar('aniversario', 'publico')
    const antes = await c.repo.consultar(A)
    for (const [sender, jid] of [['111@lid', G], [pn(A), pn(A)]]) {
      const r = await c.chamar('meuaniversario', '', sender, jid)
      assert.match(r.text, /27\/10/)
      assert.match(r.text, /Público/)
    }
    assert.deepEqual(await c.repo.consultar(A), antes)
    await c.chamar('aniversario', 'privado')
    assert.doesNotMatch((await c.chamar('meuaniversario')).text, /27\/10/)
    assert.match((await c.chamar('meuaniversario', '', pn(A), pn(A))).text, /27\/10/)
  })
  await teste('consulta respeita prefixo dinamico e exige autorizacao booleana explicita no grupo', async () => {
    const c = await ambiente()
    prefixo.__definirPrefixoTeste('#')
    try {
      assert.match((await c.chamar('meuaniversario')).text, /#aniversario publico/)
      for (const valor of [false, undefined, 'true', 1]) {
        c.banco.colecoes.get('aniversariosHipnos').docs.get(A).publico = valor
        const r = await c.chamar('meuaniversario')
        assert.doesNotMatch(r.text, /27\/10/)
        assert.match(r.text, /privado com #meuaniversario/)
      }
    } finally { prefixo.__definirPrefixoTeste('!') }
  })
  await teste('listagem exclui privados e externos e ordena virada de ano', async () => {
    const c = await ambiente({ quando: '2026-12-30T15:00:00Z' })
    await c.repo.salvar(A, tempo.lerData('31/12')); await c.repo.privacidade(A, true)
    await c.repo.salvar(B, tempo.lerData('01/01')); await c.repo.privacidade(B, true)
    await c.repo.salvar(C, tempo.lerData('30/12')); await c.repo.privacidade(C, true)
    await c.repo.salvar(BOT, tempo.lerData('30/12'))
    const r = await c.chamar('aniversarios')
    assert.deepEqual(r.mentions, ['111@lid', pn(B)])
    assert.ok(r.text.indexOf('31/12') < r.text.indexOf('01/01'))
    assert.doesNotMatch(r.text, new RegExp(C+'|'+BOT))
    assert.match((await c.chamar('aniversarios', '0')).text, /de 1 a/)
  })
  await teste('identidade ambigua e metadados ausentes falham fechados', async () => {
    const c = await ambiente()
    c.metas[G].participants.push({ id: '999@lid', phoneNumber: pn(A) })
    const mapa = await identidade.membros(c.metas[G].participants)
    assert.equal(mapa.has(A), false)
    await assert.rejects(identidade.autor({ groupMetadata: async () => { throw Error('offline') } }, G, { key: { remoteJid: G, participant: pn(A) } }))
  })
  await teste('ficha privada somente no PV; publica permitida no grupo e falha opcional', async () => {
    const c = await ambiente({ privacidade: false }), antigo = conexao.usarContextoRpg
    conexao.usarContextoRpg = fn => fn({ banco: c.banco.banco })
    const msg = jid => ({ key: { remoteJid: jid, ...(jid===G ? { participant: '111@lid' } : {}) } })
    try {
      assert.equal(await comandos.linhaFicha(c.sock, G, msg(G), c.metas[G].participants), '')
      assert.match(await comandos.linhaFicha(c.sock, pn(A), msg(pn(A)), []), /27\/10/)
      await c.repo.privacidade(A, true)
      assert.match(await comandos.linhaFicha(c.sock, G, msg(G), c.metas[G].participants), /27\/10/)
      c.banco.colecoes.get('aniversariosHipnos').falhar = true
      assert.equal(await comandos.linhaFicha(c.sock, G, msg(G), c.metas[G].participants), '')
    } finally { conexao.usarContextoRpg = antigo }
  })
  await teste('automatico em cada grupo, mencoes reais completas inclusive administradores', async () => {
    const c = await ambiente(); await c.agenda.abrir(c.sock)
    assert.equal(c.envios.length, 2)
    for (const e of c.envios) {
      assert.deepEqual(e.payload.mentions, c.metas[e.jid].participants.map(p => p.id))
      assert.deepEqual(e.payload.contextInfo.mentionedJid, e.payload.mentions)
      assert.match(e.payload.text, /📣 @Todos/)
      const alvo = e.jid === G ? '111@lid' : pn(A)
      assert.ok(e.payload.text.includes('@'+alvo.split('@')[0]))
      for (const p of c.metas[e.jid].participants.filter(p => p.id !== alvo)) assert.ok(!e.payload.text.includes('@'+p.id.split('@')[0]))
    }
    assert.ok([...c.banco.colecoes.get('aniversariosEntregas').docs.values()].every(d => d.estado === 'enviada'))
    c.agenda.parar()
  })
  await teste('sem aniversario publico nao consulta grupos nem envia', async () => {
    const c = await ambiente({ privacidade: false }); let consultas = 0
    c.sock.groupFetchAllParticipating = async () => { consultas++; return {} }
    await c.agenda.abrir(c.sock); assert.equal(consultas, 0); assert.equal(c.envios.length, 0); c.agenda.parar()
  })
  await teste('cadastro e autorizacao no proprio dia sao encontrados no proximo ciclo', async () => {
    const c = await ambiente({ privacidade: false }); await c.agenda.abrir(c.sock)
    await c.repo.salvar(B, tempo.lerData('27/10')); await c.repo.privacidade(B, true)
    await c.agenda.verificar(); assert.equal(c.envios.length, 1); assert.equal(c.envios[0].jid, G); c.agenda.parar()
  })
  await teste('timer automatico reconhece aniversario sem comandos naquele dia', async () => {
    const c = await ambiente({ quando: '2026-10-26T15:00:00Z' })
    await c.agenda.abrir(c.sock); assert.equal(c.envios.length, 0)
    c.mudarData('2026-10-27T15:00:00Z'); await [...c.timers][0].fn()
    assert.equal(c.envios.length, 2); c.agenda.parar()
  })
  await teste('consentimento solicita consulta imediata sem tornar cadastro publico sozinho', async () => {
    const c = await ambiente({ privacidade: false })
    await c.chamar('aniversario', '27/10'); assert.equal(c.notificacoes(), 0)
    await c.chamar('aniversario', 'publico'); await new Promise(resolve => setImmediate(resolve))
    assert.equal(c.notificacoes(), 1); assert.equal((await c.repo.consultar(A)).publico, true)
    await c.chamar('aniversario', 'privado'); assert.equal(c.notificacoes(), 1)
  })
  await teste('duplicacao impedida em concorrencia, reconexao, reinicio e recadastro', async () => {
    const c = await ambiente(), outro = criarAgendador({ ...c.opcoes, repo: mongo.criarRepositorio(c.banco.usar) })
    await Promise.all([c.agenda.abrir(c.sock), outro.abrir(c.sock)])
    assert.equal(c.envios.length, 2)
    await Promise.all([c.agenda.verificar(), outro.verificar()]); assert.equal(c.envios.length, 2)
    c.agenda.fechar(c.sock); outro.parar(); await c.agenda.abrir(c.sock)
    await c.repo.remover(A); await c.repo.salvar(A, tempo.lerData('27/10')); await c.repo.privacidade(A, true)
    await c.agenda.verificar(); assert.equal(c.envios.length, 2)
    c.mudarData('2027-10-27T15:00:00Z'); await c.agenda.verificar(); assert.equal(c.envios.length, 4); c.agenda.parar()
  })
  await teste('mudar a data nao reabre a homenagem no mesmo ano', async () => {
    const c = await ambiente(); await c.agenda.abrir(c.sock)
    await c.repo.salvar(A, tempo.lerData('28/10')); await c.repo.privacidade(A, true)
    c.mudarData('2026-10-28T15:00:00Z'); await c.agenda.verificar(); assert.equal(c.envios.length, 2); c.agenda.parar()
  })
  await teste('novo processo e novo socket preservam recibos anuais', async () => {
    const c = await ambiente(); await c.agenda.abrir(c.sock); c.agenda.parar()
    const reinicio = await ambiente({ banco: c.banco })
    await reinicio.agenda.abrir(reinicio.sock)
    assert.equal(reinicio.envios.length, 0)
    reinicio.agenda.parar()
  })
  for (const ano of [2027, 2028]) await teste('agenda 29/02 no ano '+ano, async () => {
    const dia = ano === 2027 ? '28' : '29'
    const c = await ambiente({ quando: `${ano}-02-${dia}T15:00:00Z`, data: '29/02' })
    await c.agenda.abrir(c.sock); assert.equal(c.envios.length, 2); c.agenda.parar()
  })
  await teste('falha de envio nao vira concluida nem causa reenvio', async () => {
    const c = await ambiente({ envio: async () => { throw Error('TRANSPORTE_INCERTO') } })
    await c.agenda.abrir(c.sock); await c.agenda.verificar()
    assert.equal(c.envios.length, 2)
    assert.ok([...c.banco.colecoes.get('aniversariosEntregas').docs.values()].every(d => d.estado === 'incerta'))
    c.agenda.parar()
  })
  await teste('retorno sem comprovante de mensagem permanece incerto', async () => {
    const c = await ambiente({ envio: async () => undefined }); await c.agenda.abrir(c.sock)
    assert.ok([...c.banco.colecoes.get('aniversariosEntregas').docs.values()].every(d => d.estado === 'incerta')); c.agenda.parar()
  })
  await teste('timeout com possivel aceite tardio nao duplica', async () => {
    const c = await ambiente()
    const agenda = criarAgendador({ ...c.opcoes, limitar: async (promise, ms) => {
      if (ms === 60000) { await promise; throw Error('TIMEOUT_APOS_ACEITE') }
      return promise
    } })
    await agenda.abrir(c.sock); await agenda.verificar()
    assert.equal(c.envios.length, 2)
    assert.ok([...c.banco.colecoes.get('aniversariosEntregas').docs.values()].every(d => d.estado === 'incerta'))
    agenda.parar()
  })
  await teste('queda entre reserva e envio nao reabre ocorrencia ao reiniciar', async () => {
    const c = await ambiente(); await c.repo.reservar(A, G, 2026)
    await c.agenda.abrir(c.sock)
    assert.equal(c.envios.length, 1); assert.equal(c.envios[0].jid, G2)
    c.agenda.parar()
  })
  await teste('falha de preparacao libera reserva somente antes de chamar transporte', async () => {
    const c = await ambiente(); let umaFalha = true
    const original = c.sock.groupMetadata
    c.sock.groupMetadata = async jid => {
      if (jid === G && c.banco.colecoes.get('aniversariosEntregas').docs.size && umaFalha) { umaFalha = false; throw Error('OFFLINE') }
      return original(jid)
    }
    await c.agenda.abrir(c.sock); assert.equal(c.envios.length, 1)
    await c.agenda.verificar(); assert.equal(c.envios.length, 2); c.agenda.parar()
  })
  await teste('falha ao confirmar persistencia depois de enviar nao reenvia', async () => {
    const c = await ambiente()
    c.banco.hooks.antesAtualizar = (nome, q, u) => { if (nome === 'aniversariosEntregas' && u.$set.estado === 'enviada') throw Error('OFFLINE') }
    await c.agenda.abrir(c.sock); await c.agenda.verificar(); assert.equal(c.envios.length, 2)
    assert.ok([...c.banco.colecoes.get('aniversariosEntregas').docs.values()].every(d => d.estado === 'incerta')); c.agenda.parar()
  })
  await teste('Mongo indisponivel ou reserva sem confirmacao nao permitem envio', async () => {
    const c = await ambiente(); c.banco.colecoes.get('aniversariosEntregas').semConfirmacao = true
    await c.agenda.abrir(c.sock); assert.equal(c.envios.length, 0)
    c.banco.colecoes.get('aniversariosHipnos').falhar = true
    await c.agenda.verificar(); assert.equal(c.envios.length, 0); c.agenda.parar()
  })
  for (const modo of ['saiu', 'revogou', 'socket', 'meianoite']) await teste('guarda final: '+modo, async () => {
    const c = await ambiente()
    c.banco.hooks.depoisInserir = async nome => {
      if (nome !== 'aniversariosEntregas') return
      if (modo === 'saiu') { c.metas[G].participants = c.metas[G].participants.filter(p => p.phoneNumber !== pn(A)); c.metas[G2].participants = c.metas[G2].participants.filter(p => p.id !== pn(A)) }
      if (modo === 'revogou') await c.repo.privacidade(A, false)
      if (modo === 'socket') c.perderLease()
      if (modo === 'meianoite') c.mudarData('2026-10-28T03:00:00Z')
    }
    await c.agenda.abrir(c.sock); assert.equal(c.envios.length, 0)
    assert.equal(c.banco.colecoes.get('aniversariosEntregas').docs.size, 0); c.agenda.parar()
  })
  await teste('grupos inelegiveis, OFF e socket nao registrado nao enviam', async () => {
    const c = await ambiente(); c.metas[G].announce = true; c.metas[G2].isCommunity = true
    await c.agenda.abrir(c.sock); assert.equal(c.envios.length, 0)
    c.metas[G].announce = false; c.desligar(); await c.agenda.verificar(); assert.equal(c.envios.length, 0)
    c.agenda.parar()
    const outro = criarAgendador(c.opcoes); await outro.abrir({ ...c.sock }); assert.equal(c.envios.length, 0); outro.parar()
  })
  await teste('ciclo nunca sobrepoe, abrir e fechar timers sao idempotentes', async () => {
    const c = await ambiente(); await c.agenda.abrir(c.sock); await c.agenda.abrir(c.sock)
    assert.equal(c.timers.size, 1); assert.equal([...c.timers][0].ms, 60000)
    c.agenda.fechar({}); assert.equal(c.timers.size, 1)
    c.agenda.fechar(c.sock); c.agenda.fechar(c.sock); assert.equal(c.timers.size, 0)
  })
  console.log(`${total} testes de aniversarios passaram (offline).`)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => lid.__definirConsultaSessaoTeste(null))
