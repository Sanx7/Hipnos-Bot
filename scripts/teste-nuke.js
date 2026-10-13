process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { criarNuke } = require('../nuke')
const { criarRepositorio } = require('../dados/nuke-mongo')
const criarColecao = require('./helpers/colecao-nuke-fake')
const seguro = require('../dados/socket-seguro')
const estado = require('../estado-bot')
const prefixo = require('../prefixo')
const lid = require('../lid')
const { OWNER_NUMBERS } = require('../config')
const dono = '5511999990000', bot = '5511666660000', grupo = '123@g.us'
const originais = [...OWNER_NUMBERS]
OWNER_NUMBERS.push(dono)
lid.__definirConsultaSessaoTeste(async () => null)
prefixo.__definirPrefixoTeste('/')
const pn = n => `${n}@s.whatsapp.net`
const membro = (numero, admin, id = pn(numero)) => ({ id, phoneNumber: pn(numero), admin })
const msg = sender => ({ key: { remoteJid: grupo, participant: sender } })
function fixture(opcoes = {}) {
  const col = opcoes.col || criarColecao(), repo = criarRepositorio(async () => col)
  // As regressões do fluxo destrutivo partem de um grupo já habilitado.
  // Casos da trava usam habilitado:false e o comando real de configuração.
  if (opcoes.habilitado !== false && !col.docs.has(grupo)) {
    col.docs.set(grupo, { _id: grupo, habilitado: true, estado: 'inativa', emVoo: false })
  }
  const f = { col, repo, tempo: 1000, lease: true, chamadas: [], envios: [], consultas: 0,
    participantes: [membro(bot, 'admin', '666@lid'), membro(dono, 'admin', '12345@lid'),
      membro('5511777770000', 'admin', '777@lid'), membro('5511888880000'), membro('5511555550000', 'superadmin')] }
  const sock = {
    user: { id: pn(bot), lid: '666@lid' }, ev: new EventEmitter(), ws: { isOpen: true },
    async groupMetadata() {
      f.consultas++
      if (f.erroMetadata) throw new Error('Grupo inacessível')
      if (f.aoConsultar) await f.aoConsultar(f)
      return structuredClone({ subject: 'Grupo teste', owner: pn('5511555550000'), participants: f.participantes })
    },
    async sendMessage(jid, conteudo) { f.envios.push(conteudo.text) },
    async groupParticipantsUpdate(jid, alvos, acao) {
      assert.equal(jid, grupo); assert.equal(alvos.length, 1)
      const p = f.participantes.find(p => p.id === alvos[0])
      assert.ok(p); assert.ok(![bot, dono].includes(p.phoneNumber.split('@')[0]))
      assert.notEqual(p.admin, 'superadmin')
      f.chamadas.push({ alvo: alvos[0], acao })
      const resposta = f.resposta ? await f.resposta(acao, p, f) : [{ jid: p.id, status: '200' }]
      if (resposta?.[0]?.status === '200' && resposta[0].jid === p.id) {
        if (acao === 'demote') p.admin = null
        else f.participantes = f.participantes.filter(x => x !== p)
      }
      return resposta
    }
  }
  f.sock = sock
  seguro.preparar(sock, () => f.lease)
  seguro.atualizar(sock, true)
  f.cmd = criarNuke({ repositorio: repo, agora: () => f.tempo, codigo: () => 'abcdef123456',
    esperar: async ms => { assert.equal(ms, 1500); if (f.aoEsperar) await f.aoEsperar(f) } })
  f.enviar = (texto = '/nuke', sender = '12345@lid') => f.cmd.executar(sock, grupo, msg(sender), texto)
  f.confirmar = () => f.enviar('/nuke confirmar abcdef123456')
  f.doc = () => col.docs.get(grupo)?.estado === 'inativa' ? undefined : col.docs.get(grupo)
  f.ultimo = () => f.envios.at(-1)
  return f
}
let passou = 0
async function teste(nome, fn) { await fn(); passou++; console.log(`OK ${nome}`) }
async function main() {
  await teste('prévia sem efeitos, contagens e código de 60s', async () => {
    const f = fixture(); await f.enviar(); assert.equal(f.chamadas.length, 0)
    assert.match(f.ultimo(), /Membros: 5\nAdministradores: 4\nParticipantes afetados: 2/)
    assert.equal(f.doc().expiraEm, 61000); assert.notEqual(f.doc().codigoHash, 'abcdef123456')
    const audit = [...f.col.docs.values()].find(d => d._id.startsWith('execucao:'))
    assert.deepEqual(Object.keys(audit).sort(), ['_id', 'operacao', 'grupo', 'data', 'atualizadoEm', 'responsavel', 'estado', 'rebaixamentos', 'remocoes', 'falhas', 'desconhecidos', 'concluidas'].sort())
  })
  for (const [nome, alterar] of [
    ['bot sem admin', f => { f.participantes[0].admin = null }],
    ['dono sem admin', f => { f.participantes[1].admin = null }],
    ['bot ausente', f => { f.participantes.shift() }],
    ['LID não resolvido', f => { f.participantes[3] = { id: '99999@lid' } }],
    ['identidade duplicada', f => { f.participantes.push({ ...f.participantes[3] }) }],
    ['phoneNumber em namespace LID', f => { f.participantes[1].phoneNumber = `${dono}@lid` }],
    ['par PN contraditório', f => { f.participantes[3].phoneNumber = pn('5511333330000') }],
    ['JID malformado', f => { f.participantes[1].id = `abc${dono}@s.whatsapp.net` }],
    ['metadata inacessível', f => { f.erroMetadata = true }],
    ['lease perdida', f => { f.lease = false }],
    ['socket fechado', f => { f.sock.ws.isOpen = false }]
  ]) await teste(`bloqueia ${nome}`, async () => {
    const f = fixture(); alterar(f); await f.enviar(); assert.equal(f.chamadas.length, 0); assert.equal(f.doc(), undefined)
  })
  await teste('não dono e colisão de dígitos PN/LID não autorizam', async () => {
    const f = fixture(); await f.enviar('/nuke', pn('5511888880000')); await f.enviar('/nuke', `${dono}@lid`)
    assert.equal(f.doc(), undefined)
  })
  await teste('somente grupo', async () => {
    const f = fixture(); await f.cmd.executar(f.sock, pn(dono), msg(pn(dono)), '/nuke'); assert.equal(f.doc(), undefined)
  })
  await teste('socket sem guarda exclusiva falha fechado', async () => {
    const f = fixture(); const semGuarda = { ...f.sock }
    await f.cmd.executar(semGuarda, grupo, msg('12345@lid'), '/nuke'); assert.equal(f.doc(), undefined)
  })
  await teste('confirmação obrigatória, código inválido e uso único', async () => {
    const f = fixture(); await f.confirmar(); assert.equal(f.chamadas.length, 0)
    await f.enviar(); await f.enviar('/nuke confirmar errado'); assert.equal(f.chamadas.length, 0)
    await f.confirmar(); assert.equal(f.chamadas.length, 3); await f.confirmar(); assert.equal(f.chamadas.length, 3)
    assert.match(f.envios.at(-2), /Rebaixamentos confirmados: 1\nRemoções confirmadas: 2\nFalhas confirmadas: 0\nResultados desconhecidos: 0/)
  })
  await teste('expira exatamente em 60s e permite nova simulação', async () => {
    const f = fixture(); await f.enviar(); f.tempo = 61000; await f.confirmar()
    assert.equal(f.doc().estado, 'expirada'); assert.equal(f.chamadas.length, 0)
    await f.enviar(); assert.equal(f.doc().estado, 'pendente')
  })
  await teste('mudança de lista invalida a confirmação', async () => {
    const f = fixture(); await f.enviar(); f.participantes.push(membro('5511444440000'))
    await f.confirmar(); assert.equal(f.chamadas.length, 0); assert.equal(f.doc().estado, 'cancelada')
  })
  await teste('dono perde admin antes da confirmação', async () => {
    const f = fixture(); await f.enviar(); f.participantes[1].admin = null
    await f.confirmar(); assert.equal(f.chamadas.length, 0)
  })
  await teste('criador indicado somente por owner também é preservado', async () => {
    const f = fixture(); f.participantes[4].admin = 'admin'; await f.enviar(); await f.confirmar()
    assert.equal(f.chamadas.length, 3); assert.ok(f.chamadas.every(c => c.alvo !== pn('5511555550000')))
  })
  await teste('criador não resolvido bloqueia toda a prévia', async () => {
    const f = fixture(); const original = f.sock.groupMetadata
    f.sock.groupMetadata = async () => ({ ...await original(), owner: '99999@lid' })
    await f.enviar(); assert.equal(f.doc(), undefined)
  })
  await teste('prévia por LID pode ser confirmada pelo PN comprovado', async () => {
    const f = fixture(); await f.enviar(); await f.enviar('/nuke confirmar abcdef123456', pn(dono))
    assert.equal(f.chamadas.length, 3)
  })
  await teste('segundo dono não consome confirmação do primeiro', async () => {
    const extra = '5511222220000'; OWNER_NUMBERS.push(extra)
    try {
      const f = fixture(); f.participantes.push(membro(extra, 'admin')); await f.enviar()
      await f.enviar('/nuke confirmar abcdef123456', pn(extra)); assert.equal(f.chamadas.length, 0); assert.equal(f.doc().estado, 'pendente')
    } finally { OWNER_NUMBERS.splice(OWNER_NUMBERS.indexOf(extra), 1) }
  })
  await teste('outro grupo não aceita o código', async () => {
    const f = fixture(); await f.enviar()
    await f.cmd.executar(f.sock, '456@g.us', msg('12345@lid'), '/nuke confirmar abcdef123456')
    assert.equal(f.chamadas.length, 0); assert.equal(f.doc().estado, 'pendente')
  })
  await teste('cancelamento pendente consome código', async () => {
    const f = fixture(); await f.enviar(); await f.enviar('/nuke cancelar'); await f.confirmar()
    assert.equal(f.doc().estado, 'cancelada'); assert.equal(f.chamadas.length, 0)
  })
  await teste('dono pode cancelar após perder admin', async () => {
    const f = fixture(); await f.enviar(); f.participantes[1].admin = null; await f.enviar('/nuke cancelar')
    assert.equal(f.doc().estado, 'cancelada')
  })
  await teste('não dono não cancela', async () => {
    const f = fixture(); await f.enviar(); await f.enviar('/nuke cancelar', pn('5511888880000'))
    assert.equal(f.doc().estado, 'pendente')
  })
  await teste('cancelamento em execução impede próxima chamada', async () => {
    const f = fixture(); await f.enviar(); f.aoEsperar = () => f.enviar('/nuke cancelar')
    await f.confirmar(); assert.equal(f.chamadas.length, 1); assert.equal(f.doc().estado, 'cancelada')
  })
  await teste('cancelamento durante chamada conta apenas resultado confirmado', async () => {
    const f = fixture(); await f.enviar()
    f.resposta = async (acao, p) => { await f.enviar('/nuke cancelar'); return [{ jid: p.id, status: '200' }] }
    await f.confirmar(); assert.equal(f.chamadas.length, 1); assert.equal(f.doc().rebaixamentos, 1); assert.equal(f.doc().estado, 'cancelada')
  })
  for (const [nome, interromper] of [
    ['desconexão', f => { f.sock.ws.isOpen = false; f.sock.ev.emit('connection.update', { connection: 'close' }) }],
    ['queda e reabertura', f => { f.sock.ev.emit('connection.update', { connection: 'close' }) }],
    ['perda de sessão exclusiva', f => { f.lease = false }],
    ['bot perde admin', f => { f.participantes[0].admin = null }],
    ['dono perde admin', f => { f.participantes[1].admin = null }],
    ['grupo inacessível', f => { f.erroMetadata = true }],
    ['reserva perdida', f => { f.doc().operacao = 'outra' }]
  ]) await teste(`interrompe durante ${nome}`, async () => {
    const f = fixture(); await f.enviar(); f.aoEsperar = () => interromper(f)
    await f.confirmar(); assert.equal(f.chamadas.length, 1)
    assert.equal(f.sock.ev.listenerCount('connection.update'), 0)
    const audit = [...f.col.docs.values()].find(d => d._id.startsWith('execucao:'))
    assert.equal(audit.estado, 'interrompida')
  })
  await teste('falhas parciais não anunciam sucesso e criador não é tocado', async () => {
    const f = fixture(); await f.enviar()
    f.resposta = async (acao, p) => [{ jid: p.id, status: acao === 'demote' || p.id === pn('5511888880000') ? '403' : '200' }]
    await f.confirmar(); assert.equal(f.doc().rebaixamentos, 0); assert.equal(f.doc().remocoes, 1); assert.equal(f.doc().falhas, 2)
  })
  await teste('exceção em rebaixamento conta desconhecido e interrompe, sem sucesso', async () => {
    const f = fixture(); await f.enviar()
    f.resposta = async (acao, p) => {
      if (acao === 'demote') throw new Error('WhatsApp recusou')
      return [{ jid: p.id, status: 200 }]
    }
    await f.confirmar(); assert.equal(f.doc().rebaixamentos, 0); assert.equal(f.doc().remocoes, 0); assert.equal(f.doc().falhas, 0)
    assert.equal(f.doc().desconhecidos, 1); assert.equal(f.doc().emVoo, true); assert.equal(f.doc().estado, 'interrompida')
  })
  await teste('participante que saiu não é contado e novo membro não é atingido', async () => {
    const f = fixture(); await f.enviar()
    f.aoEsperar = () => {
      f.participantes = f.participantes.filter(p => p.id !== pn('5511888880000'))
      if (!f.participantes.some(p => p.id === pn('5511444440000'))) f.participantes.push(membro('5511444440000'))
    }
    await f.confirmar(); assert.equal(f.chamadas.length, 2); assert.equal(f.doc().remocoes, 1)
  })
  await teste('dono perde cadastro de autorização durante execução', async () => {
    const f = fixture(); await f.enviar()
    f.aoEsperar = () => { const i = OWNER_NUMBERS.indexOf(dono); if (i >= 0) OWNER_NUMBERS.splice(i, 1) }
    try { await f.confirmar(); assert.equal(f.chamadas.length, 1); assert.equal(f.doc().estado, 'interrompida') }
    finally { OWNER_NUMBERS.push(dono) }
  })
  await teste('status 200 sem JID, JID errado e resultado vazio não contam', async () => {
    for (const resposta of [[{ status: '200' }], [{ jid: pn(bot), status: '200' }], []]) {
      const f = fixture(); await f.enviar(); f.resposta = async () => resposta
      await f.confirmar(); assert.equal(f.doc().rebaixamentos + f.doc().remocoes, 0); assert.equal(f.doc().falhas, 0)
      assert.equal(f.doc().desconhecidos, 1); assert.equal(f.chamadas.length, 1)
    }
  })
  await teste('resposta PN para alvo LID é comprovada por metadata', async () => {
    const f = fixture(); await f.enviar(); f.resposta = async (acao, p) => [{ jid: p.phoneNumber, status: '200' }]
    await f.confirmar(); assert.equal(f.doc().rebaixamentos, 1); assert.equal(f.doc().remocoes, 2)
  })
  await teste('concorrência de prévias entre instâncias reserva uma só', async () => {
    const col = criarColecao(), a = fixture({ col }), b = fixture({ col })
    await Promise.all([a.enviar(), b.enviar()]); assert.equal([...a.envios, ...b.envios].filter(t => t.startsWith('SIMULAÇÃO')).length, 1)
  })
  await teste('confirmações concorrentes entre instâncias executam uma só', async () => {
    const col = criarColecao(), a = fixture({ col }), b = fixture({ col }); await a.enviar()
    await Promise.all([a.confirmar(), b.confirmar()]); assert.equal(a.chamadas.length + b.chamadas.length, 3)
  })
  await teste('reserva em execução não expira mesmo após reinício', async () => {
    const col = criarColecao(), a = fixture({ col }); await a.enviar(); a.doc().estado = 'executando'
    const b = fixture({ col }); b.tempo = 99999999; await b.enviar(); assert.equal(b.chamadas.length, 0); assert.match(b.ultimo(), /Já existe/)
  })
  await teste('nova prévia após expiração mantém auditoria anterior expirada', async () => {
    const f = fixture(); await f.enviar(); const operacao = f.doc().operacao
    f.tempo = 61000; await f.enviar()
    assert.notEqual(f.doc().operacao, operacao); assert.equal(f.col.docs.get(`execucao:${operacao}`).estado, 'expirada')
  })
  await teste('cancelamento persistente de outra instância para execução', async () => {
    const col = criarColecao(), a = fixture({ col }), b = fixture({ col }); await a.enviar()
    a.aoEsperar = () => b.enviar('/nuke cancelar'); await a.confirmar(); assert.equal(a.chamadas.length, 1)
    assert.equal(a.doc().estado, 'cancelada')
  })
  await teste('MongoDB indisponível impede efeitos', async () => {
    const f = fixture(); f.col.falhar = true; await f.enviar(); assert.equal(f.chamadas.length, 0)
  })
  await teste('falha de auditoria antes de executar não faz alterações', async () => {
    const f = fixture(); await f.enviar(); f.repo.registrar = async () => { throw new Error('offline') }
    await f.confirmar(); assert.equal(f.chamadas.length, 0); assert.equal(f.doc().estado, 'executando')
  })
  await teste('falha MongoDB durante execução para efeitos e mantém reserva', async () => {
    const f = fixture(); await f.enviar(); f.aoEsperar = () => { f.col.falhar = true }
    await f.confirmar(); assert.equal(f.chamadas.length, 1); assert.equal(f.doc().estado, 'executando'); assert.match(f.ultimo(), /Registro final indisponível/)
  })
  await teste('protege todos os donos, além do bot, com JID/LID', async () => {
    const extra = '5511222220000'; OWNER_NUMBERS.push(extra)
    try {
      const f = fixture(); f.participantes.push(membro(extra, 'admin', '222@lid')); await f.enviar(); await f.confirmar()
      assert.ok(f.chamadas.every(c => c.alvo !== '222@lid')); assert.equal(f.chamadas.length, 3)
    } finally { OWNER_NUMBERS.splice(OWNER_NUMBERS.indexOf(extra), 1) }
  })
  await teste('prefixo dinâmico e modo OFF preservam dono', async () => {
    estado.__definirColecaoTeste({ findOne: async () => ({ ligado: false }) })
    prefixo.__definirPrefixoTeste('!')
    const f = fixture()
    assert.equal(await estado.permitirMensagem(f.sock, grupo, '12345@lid'), true)
    assert.equal(await estado.permitirMensagem(f.sock, grupo, '777@lid'), false)
    assert.equal(prefixo.resolverNomeComando('!nuke'), 'nuke')
    await f.enviar('!nuke'); assert.match(f.ultimo(), /!nuke confirmar/)
    await f.enviar('!nuke confirmar abcdef123456'); assert.equal(f.chamadas.length, 3)
  })
  prefixo.__definirPrefixoTeste('/')
  await teste('criador ausente em owner e superadmin bloqueia a operação', async () => {
    const f = fixture(); f.participantes[4].admin = 'admin'
    const meta = f.sock.groupMetadata
    f.sock.groupMetadata = async () => ({ ...await meta(), owner: undefined })
    await f.enviar(); assert.equal(f.doc(), undefined); assert.equal(f.chamadas.length, 0)
  })
  await teste('criador original permanece protegido após mudança de owner e superadmin', async () => {
    const f = fixture(); let owner = pn('5511555550000')
    const meta = f.sock.groupMetadata
    f.sock.groupMetadata = async () => ({ ...await meta(), owner })
    await f.enviar()
    f.aoEsperar = () => { f.participantes.find(p => p.id === pn('5511555550000')).admin = null; owner = pn('5511888880000') }
    await f.confirmar()
    assert.equal(f.doc().estado, 'concluida')
    assert.ok(f.chamadas.every(c => ![pn('5511555550000'), pn('5511888880000')].includes(c.alvo)))
    assert.equal(f.doc().remocoes, 1)
  })
  for (const [nome, alterar] of [
    ['aliases LID compartilhados entre dois PN', f => { f.participantes[3].lid = '888@lid'; f.participantes[4].lid = '888@lid' }],
    ['lid secundário contradiz o id LID', f => { f.participantes[2].lid = '888@lid' }],
    ['lid secundário malformado', f => { f.participantes[3].lid = 'abc888@lid' }]
  ]) await teste(`ambiguidade bloqueia: ${nome}`, async () => {
    const f = fixture(); alterar(f); await f.enviar(); assert.equal(f.doc(), undefined); assert.equal(f.chamadas.length, 0)
  })
  await teste('ambiguidade surgida durante execução impede atingir o participante', async () => {
    const f = fixture(); await f.enviar()
    f.aoEsperar = () => { f.participantes.push({ ...f.participantes.find(p => p.id === pn('5511888880000')) }) }
    await f.confirmar(); assert.equal(f.chamadas.length, 1); assert.equal(f.doc().estado, 'interrompida')
    assert.equal(f.doc().remocoes, 0)
  })
  await teste('cancelamento remoto durante metadata é observado na admissão atômica', async () => {
    const f = fixture(); await f.enviar()
    f.aoConsultar = async () => {
      if (f.consultas === 4) await f.repo.alterar(grupo, { operacao: f.doc().operacao }, { cancelar: true })
    }
    await f.confirmar(); assert.equal(f.chamadas.length, 0); assert.equal(f.doc().estado, 'cancelada')
    assert.equal(f.doc().desconhecidos, 0)
  })
  await teste('cancelamento concorrente após leitura pendente vence confirmação já consumida', async () => {
    const col = criarColecao(), a = fixture({ col }), b = fixture({ col }); await a.enviar()
    const pendente = structuredClone(a.doc())
    b.repo.ler = async () => pendente
    const registrar = a.repo.registrar
    a.repo.registrar = async doc => {
      if (doc.estado === 'executando') await b.enviar('/nuke cancelar')
      return registrar(doc)
    }
    await a.confirmar(); assert.equal(a.chamadas.length, 0); assert.equal(a.doc().estado, 'cancelada')
  })
  await teste('cancelamento vence enquanto atualização de confirmação aguarda MongoDB', async () => {
    const col = criarColecao(), a = fixture({ col }), b = fixture({ col }); await a.enviar()
    const alterar = a.repo.alterar
    a.repo.alterar = async (g, filtro, valores) => {
      if (valores.estado === 'executando') await b.enviar('/nuke cancelar')
      return alterar(g, filtro, valores)
    }
    await a.confirmar(); assert.equal(a.chamadas.length, 0); assert.equal(a.doc().estado, 'cancelada')
  })
  await teste('cancelamento após admissão mas antes de envio impede chamada local', async () => {
    const col = criarColecao(), a = fixture({ col }), b = fixture({ col }); await a.enviar()
    const alterar = a.repo.alterar
    a.repo.alterar = async (g, filtro, valores) => {
      const r = await alterar(g, filtro, valores)
      if (valores.emVoo === true) await b.enviar('/nuke cancelar')
      return r
    }
    await a.confirmar(); assert.equal(a.chamadas.length, 0); assert.equal(a.doc().estado, 'cancelada')
    assert.equal(a.doc().emVoo, false); assert.equal(a.doc().desconhecidos, 0)
  })
  await teste('expiração durante atualização MongoDB nunca inicia alterações', async () => {
    const f = fixture(); await f.enviar()
    const alterar = f.repo.alterar
    f.repo.alterar = async (g, filtro, valores) => {
      const r = await alterar(g, filtro, valores)
      if (valores.estado === 'executando') f.tempo = 61000
      return r
    }
    await f.confirmar(); assert.equal(f.chamadas.length, 0); assert.equal(f.doc().estado, 'expirada')
    await f.confirmar(); assert.equal(f.chamadas.length, 0)
  })
  await teste('mudança da lista após consumo do código exige nova simulação', async () => {
    const f = fixture(); await f.enviar()
    const alterar = f.repo.alterar
    f.repo.alterar = async (g, filtro, valores) => {
      const r = await alterar(g, filtro, valores)
      if (valores.estado === 'executando') f.participantes.push(membro('5511444440000'))
      return r
    }
    await f.confirmar(); assert.equal(f.chamadas.length, 0); assert.equal(f.doc().estado, 'interrompida')
  })
  await teste('perda de conexão ou privilégio na última revalidação impede envio', async () => {
    for (const perda of ['conexao', 'bot', 'dono']) {
      const f = fixture(); await f.enviar()
      f.aoConsultar = () => {
        if (f.consultas === 4) {
          if (perda === 'conexao') f.sock.ws.isOpen = false
          else f.participantes[perda === 'bot' ? 0 : 1].admin = null
        }
      }
      await f.confirmar(); assert.equal(f.chamadas.length, 0); assert.equal(f.doc().estado, 'interrompida')
    }
  })
  await teste('recusa identificada de remoção é falha confirmada e não desconhecido', async () => {
    const f = fixture(); await f.enviar()
    f.resposta = async (acao, p) => [{ jid: p.id, status: acao === 'remove' ? '403' : '200' }]
    await f.confirmar(); assert.equal(f.doc().rebaixamentos, 1); assert.equal(f.doc().remocoes, 0)
    assert.equal(f.doc().falhas, 2); assert.equal(f.doc().desconhecidos, 0); assert.equal(f.doc().emVoo, false)
  })
  await teste('remoção sem resposta separa desconhecido e bloqueia a reserva', async () => {
    const f = fixture(); await f.enviar()
    f.resposta = async (acao, p) => acao === 'demote' ? [{ jid: p.id, status: '200' }] : []
    await f.confirmar(); assert.equal(f.doc().rebaixamentos, 1); assert.equal(f.doc().remocoes, 0)
    assert.equal(f.doc().falhas, 0); assert.equal(f.doc().desconhecidos, 1); assert.equal(f.doc().emVoo, true)
    assert.match(f.ultimo(), /Falhas confirmadas: 0\nResultados desconhecidos: 1/)
    await f.enviar(); assert.match(f.ultimo(), /Já existe/)
  })
  await teste('timeout de remoção após envio não é anunciado como falha confirmada', async () => {
    const f = fixture(); await f.enviar()
    f.resposta = async (acao, p) => {
      if (acao === 'remove') throw Object.assign(new Error('timeout'), { statusCode: 408 })
      return [{ jid: p.id, status: '200' }]
    }
    await f.confirmar(); assert.equal(f.doc().desconhecidos, 1); assert.equal(f.doc().falhas, 0)
    assert.equal(f.chamadas.length, 2); assert.equal(f.doc().estado, 'interrompida')
  })
  await teste('crash após admissão nunca libera reserva pelo tempo', async () => {
    const f = fixture(); await f.enviar(); f.doc().estado = 'executando'; f.doc().emVoo = true
    f.tempo = 999999999; await f.enviar(); assert.match(f.ultimo(), /Já existe/)
    f.doc().estado = 'interrompida'; await f.enviar(); assert.match(f.ultimo(), /Já existe/)
  })
  await teste('reserva terminal antiga sem emVoo exige revisão, sem substituição automática', async () => {
    const f = fixture(); await f.enviar(); f.doc().estado = 'interrompida'; delete f.doc().emVoo
    await f.enviar(); assert.match(f.ultimo(), /Já existe/); assert.equal(f.chamadas.length, 0)
  })
  await teste('nova execução depois de conclusão não aceita código antigo diferente', async () => {
    const f = fixture(); await f.enviar(); await f.confirmar()
    const outro = criarNuke({ repositorio: f.repo, agora: () => f.tempo, codigo: () => 'codigo-novo', esperar: async () => {} })
    await outro.executar(f.sock, grupo, msg('12345@lid'), '/nuke')
    await outro.executar(f.sock, grupo, msg('12345@lid'), '/nuke confirmar abcdef123456')
    assert.equal(f.doc().estado, 'pendente'); assert.equal(f.chamadas.length, 3)
  })
  await teste('prévia cancelada não modifica credenciais ou registros de outro grupo', async () => {
    const f = fixture()
    f.col.docs.set('auth_creds', { _id: 'auth_creds', exemplo: 'preservado' })
    f.col.docs.set('456@g.us', { _id: '456@g.us', estado: 'executando', emVoo: true })
    const antes = [structuredClone(f.col.docs.get('auth_creds')), structuredClone(f.col.docs.get('456@g.us'))]
    await f.enviar(); await f.enviar('/nuke cancelar')
    assert.deepEqual(f.col.docs.get('auth_creds'), antes[0]); assert.deepEqual(f.col.docs.get('456@g.us'), antes[1])
  })
  await teste('recuperação manual por CAS não modifica outra operação e só uma prévia vence', async () => {
    const col = criarColecao(), a = fixture({ col }), b = fixture({ col }); await a.enviar()
    const id = a.doc().operacao; a.doc().estado = 'executando'
    // Cenário offline: processo antigo encerrado, ausência de chamadas em voo comprovada.
    assert.equal(await a.repo.alterar(grupo, { operacao: 'id-antigo', estado: 'executando', emVoo: false }, { estado: 'interrompida' }), false)
    assert.equal(await a.repo.alterar(grupo, { operacao: id, estado: 'executando', emVoo: false }, { estado: 'interrompida', codigoHash: null }), true)
    await Promise.all([a.enviar(), b.enviar()])
    assert.notEqual(a.doc().operacao, id); assert.equal(a.doc().estado, 'pendente')
    assert.equal([...a.envios.slice(1), ...b.envios].filter(t => t.startsWith('SIMULAÇÃO')).length, 1)
  })
  await teste('trava fechada por padrão bloqueia simulação e confirmação sem criar reserva', async () => {
    const f = fixture({ habilitado: false })
    await f.enviar(); assert.match(f.ultimo(), /desativado neste grupo/)
    await f.confirmar(); assert.match(f.ultimo(), /desativado neste grupo/)
    assert.equal(f.col.docs.size, 0); assert.equal(f.chamadas.length, 0)
  })
  await teste('dono habilita por LID sem gerar prévia, código ou operações', async () => {
    const f = fixture({ habilitado: false }); await f.enviar('/nuke habilitar')
    assert.equal(f.col.docs.get(grupo).habilitado, true)
    assert.equal(f.col.docs.get(grupo).estado, 'inativa')
    assert.equal(f.doc(), undefined); assert.equal(f.chamadas.length, 0)
    assert.equal(f.col.docs.get(grupo).codigoHash, undefined)
    assert.equal([...f.col.docs.keys()].some(k => k.startsWith('execucao:')), false)
    await f.confirmar(); assert.equal(f.chamadas.length, 0)
    await f.enviar(); assert.equal(f.doc().estado, 'pendente')
  })
  await teste('habilitação é específica por grupo', async () => {
    const f = fixture({ habilitado: false }); await f.enviar('/nuke habilitar')
    await f.cmd.executar(f.sock, '456@g.us', msg('12345@lid'), '/nuke')
    assert.match(f.ultimo(), /desativado neste grupo/)
    assert.equal(f.col.docs.has('456@g.us'), false); assert.equal(f.chamadas.length, 0)
  })
  await teste('configuração sobrevive a nova instância e usa prefixo dinâmico', async () => {
    const col = criarColecao(), a = fixture({ col, habilitado: false })
    prefixo.__definirPrefixoTeste('!')
    try {
      await a.enviar('!nuke habilitar'); assert.match(a.ultimo(), /!nuke/)
      const b = fixture({ col, habilitado: false }); await b.enviar('!nuke')
      assert.equal(b.doc().estado, 'pendente'); assert.match(b.ultimo(), /!nuke confirmar/)
      assert.equal(a.chamadas.length + b.chamadas.length, 0)
    } finally { prefixo.__definirPrefixoTeste('/') }
  })
  await teste('admin comum e LID com dígitos do dono não habilitam nem desabilitam', async () => {
    const f = fixture({ habilitado: false })
    for (const sender of ['777@lid', `${dono}@lid`]) await f.enviar('/nuke habilitar', sender)
    assert.equal(f.col.docs.size, 0)
    await f.enviar('/nuke habilitar')
    for (const sender of ['777@lid', `${dono}@lid`]) await f.enviar('/nuke desabilitar', sender)
    assert.equal(f.col.docs.get(grupo).habilitado, true); assert.equal(f.chamadas.length, 0)
  })
  await teste('dono pode configurar sem admin, mas continua impedido de executar', async () => {
    const f = fixture({ habilitado: false }); f.participantes[1].admin = null
    await f.enviar('/nuke habilitar'); assert.equal(f.col.docs.get(grupo).habilitado, true)
    await f.enviar(); assert.match(f.ultimo(), /administrador deste grupo/)
    assert.equal(f.doc(), undefined); assert.equal(f.chamadas.length, 0)
  })
  await teste('habilitar fora do grupo e identidade ambígua não criam configuração', async () => {
    const f = fixture({ habilitado: false })
    await f.cmd.executar(f.sock, pn(dono), msg(pn(dono)), '/nuke habilitar')
    assert.equal(f.col.docs.size, 0)
    f.participantes.push({ ...f.participantes[1] }); await f.enviar('/nuke habilitar')
    assert.equal(f.col.docs.size, 0); assert.equal(f.chamadas.length, 0)
  })
  await teste('MongoDB indisponível ou configuração inválida mantêm comando bloqueado', async () => {
    const f = fixture({ habilitado: false }); f.col.falhar = true
    await f.enviar('/nuke habilitar'); assert.doesNotMatch(f.ultimo(), /^Nuke habilitado/)
    await f.enviar(); assert.equal(f.chamadas.length, 0)
    f.col.falhar = false
    for (const habilitado of [undefined, null, 'true', 1, false]) {
      f.col.docs.set(grupo, { _id: grupo, habilitado, estado: 'inativa', emVoo: false })
      await f.enviar(); assert.match(f.ultimo(), /desativado neste grupo/)
      assert.equal(f.col.docs.get(grupo).estado, 'inativa')
    }
  })
  await teste('reserva nunca cria habilitação implicitamente', async () => {
    const f = fixture({ habilitado: false })
    assert.equal(await f.repo.reservar({ _id: grupo, estado: 'pendente' }, 1000), false)
    assert.equal(f.col.docs.size, 0)
  })
  await teste('desabilitar invalida prévia; reabilitar não restaura o código', async () => {
    const f = fixture(); await f.enviar(); const operacao = f.doc().operacao
    await f.enviar('/nuke desabilitar')
    assert.equal(f.doc().habilitado, false); assert.equal(f.doc().estado, 'cancelada'); assert.equal(f.doc().codigoHash, null)
    await f.confirmar(); assert.equal(f.chamadas.length, 0)
    await f.enviar('/nuke habilitar'); await f.confirmar(); assert.equal(f.chamadas.length, 0)
    assert.equal(f.doc().operacao, operacao); assert.equal(f.doc().cancelar, true)
    await f.enviar(); assert.notEqual(f.doc().operacao, operacao); assert.equal(f.doc().estado, 'pendente')
  })
  await teste('cancelar continua acessível com trava fechada', async () => {
    const f = fixture(); await f.enviar()
    // Emular legado/alteração administrativa: reserva pendente com trava fechada.
    f.doc().habilitado = false
    await f.enviar('/nuke cancelar'); assert.equal(f.doc().estado, 'cancelada')
    assert.equal(f.chamadas.length, 0)
  })
  await teste('desabilitar durante execução para após chamada já admitida', async () => {
    const f = fixture(); await f.enviar()
    f.aoEsperar = () => f.enviar('/nuke desabilitar')
    await f.confirmar(); assert.equal(f.chamadas.length, 1); assert.equal(f.doc().estado, 'cancelada')
    assert.equal(f.doc().habilitado, false); assert.equal(f.doc().rebaixamentos, 1)
  })
  await teste('desabilitar em outra instância durante metadata vence admissão', async () => {
    const col = criarColecao(), a = fixture({ col }), b = fixture({ col }); await a.enviar()
    a.aoConsultar = async () => { if (a.consultas === 4) await b.enviar('/nuke desabilitar') }
    await a.confirmar(); assert.equal(a.chamadas.length, 0); assert.equal(a.doc().habilitado, false)
    assert.equal(a.doc().estado, 'cancelada')
  })
  await teste('trava fecha durante confirmação e impede consumo do código', async () => {
    const col = criarColecao(), a = fixture({ col }), b = fixture({ col }); await a.enviar()
    const alterar = a.repo.alterar
    a.repo.alterar = async (g, filtro, valores) => {
      if (valores.estado === 'executando') await b.enviar('/nuke desabilitar')
      return alterar(g, filtro, valores)
    }
    await a.confirmar(); assert.equal(a.chamadas.length, 0); assert.equal(a.doc().estado, 'cancelada')
    assert.equal(a.doc().habilitado, false)
  })
  await teste('habilitar durante execução incerta não libera reserva nem inicia nova execução', async () => {
    const f = fixture(); await f.enviar(); f.resposta = async () => []
    await f.confirmar(); assert.equal(f.doc().emVoo, true)
    await f.enviar('/nuke desabilitar'); await f.enviar('/nuke habilitar')
    assert.equal(f.doc().emVoo, true); assert.equal(f.doc().estado, 'interrompida')
    await f.enviar(); assert.match(f.ultimo(), /Já existe/); assert.equal(f.chamadas.length, 1)
  })
  await teste('desabilitação também persiste após reinício', async () => {
    const col = criarColecao(), a = fixture({ col, habilitado: false })
    await a.enviar('/nuke habilitar'); await a.enviar('/nuke desabilitar')
    const b = fixture({ col, habilitado: false }); await b.enviar()
    assert.match(b.ultimo(), /desativado neste grupo/); assert.equal(b.chamadas.length, 0)
  })
  console.log(`${passou} testes nuke offline passaram.`)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => {
  OWNER_NUMBERS.splice(0, OWNER_NUMBERS.length, ...originais)
  lid.__definirConsultaSessaoTeste(null); estado.__definirColecaoTeste(null); prefixo.__definirPrefixoTeste('/')
})
