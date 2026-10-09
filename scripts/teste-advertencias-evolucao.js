process.env.OWNER_NUMBERS = '5511999990009'
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { createHash } = require('node:crypto')
const fake = require('./helpers/colecao-figurinhas-fake')
const dados = require('../advertencias')
const adv = require('../comandos/admin/adv')
const rem = require('../comandos/admin/remadv')
const advs = require('../comandos/admin/advs')
const novos = require('../comandos/admin/advertencias-consultas')
const ban = require('../comandos/admin/ban')
const lid = require('../lid')
const mod = require('../dados/moderacao-figurinhas')
const regras = require('../dados/figurinhas-regras')
const estado = require('../estado-bot')
const G = '111@g.us', H = '222@g.us'
const PN = n => `${n}@s.whatsapp.net`
const ADM = PN('5511777770000'), ALVO = PN('5511888880000'), BOT = PN('5511666660000'), DONO = PN('5511999990009')
const numero = id => id.split('@')[0]
let total = 0
function cenario() {
  const colecao = fake(), auxiliares = { configAdvertencias: fake(), advertenciasOperacoes: fake() }
  dados.__definirColecaoTeste(colecao, auxiliares)
  lid.__definirConsultaSessaoTeste(async () => null)
  const mongoRegras = { regras: fake(), ocorrencias: fake() }
  regras.__definirColecoesTeste(mongoRegras)
  const bytes = Buffer.from('figurinha offline')
  mod.__definirDownloadTeste(async () => Readable.from([bytes]))
  const enviadas = [], removidas = [], blacklist = []
  ban.__definirGravacaoBlacklistTeste(n => blacklist.push(n))
  let serial = 0
  const sock = {
    user: { id: BOT, lid: '666@lid' },
    participantes: [{ id: ADM, lid: '777@lid', admin: 'admin' }, { id: ALVO, lid: '888@lid' }, { id: DONO, lid: '999@lid' }, { id: BOT, lid: '666@lid', admin: 'admin' }],
    async groupMetadata() { if (this.erroMetadata) throw new Error('metadata offline'); return { participants: this.participantes } },
    async sendMessage(jid, payload) { if (this.erroEnvio) throw new Error('envio offline'); enviadas.push({ jid, ...payload }); return { key: { id: `envio-${serial}` } } },
    async groupParticipantsUpdate(jid, alvos) {
      removidas.push({ jid, alvos })
      if (this.erroRemocao) throw new Error('rede interrompida')
      if (this.semResposta) return []
      if (this.status === undefined || String(this.status) === '200') this.participantes = this.participantes.filter(p => !alvos.includes(p.id))
      return alvos.map(jid => ({ jid, status: this.status ?? '200' }))
    }
  }
  function mensagem(autor = ADM, alvo = ALVO, jid = G) {
    return { key: { remoteJid: jid, participant: autor, id: `cmd-${++serial}` }, message: { extendedTextMessage: { text: '', contextInfo: alvo ? { mentionedJid: [alvo] } : {} } } }
  }
  async function executar(nome, autor = ADM, alvo = ALVO, text = `/${nome}`, jid = G, msg) {
    const cmd = [adv, rem, advs, ...novos].find(c => c.nome === nome)
    await cmd.executar(sock, jid, msg || mensagem(autor, alvo, jid), text)
  }
  async function advertir(motivo = 'quebrou regra', autor = ADM, alvo = ALVO) { return executar('adv', autor, alvo, `/adv ${motivo}`) }
  async function criar(id = ALVO, jid = G, motivo = 'motivo') { return dados.criarAdvertencia({ numero: numero(id), grupoId: jid, motivo, aplicadoPor: numero(ADM) }) }
  return { sock, colecao, auxiliares, mongoRegras, bytes, enviadas, removidas, blacklist, mensagem, executar, advertir, criar, texto: () => enviadas.at(-1)?.text || '' }
}
async function teste(nome, fn) { await fn(cenario()); total++; console.log(`✅ ${nome}`) }
async function main() {
  await teste('comandos únicos sem aliases duplicados', async () => assert.deepEqual(novos.map(c => c.nome), ['minhaspunicoes', 'historicoadv', 'zeraradv', 'setlimiteadv']))
  await teste('documentos antigos ativos e arquivados permanecem consultáveis', async c => {
    c.colecao.docs.push({ _id: 40, numero: numero(ALVO), grupo_id: G, motivo: 'legado ativo', data: 1, ativa: true }, { _id: 41, numero: numero(ALVO), grupo_id: G, motivo: 'legado arquivado', data: 2, ativa: false })
    assert.equal(await dados.contarAdvertencias(numero(ALVO), G), 1)
    await c.executar('historicoadv')
    assert.match(c.texto(), /legado ativo/); assert.match(c.texto(), /legado arquivado/); assert.match(c.texto(), /arquivada/)
  })
  await teste('limite padrão 3 e isolamento por grupo', async c => {
    assert.equal(await dados.obterLimiteAdvertencias(G), 3)
    await dados.definirLimiteAdvertencias(G, 5, numero(DONO))
    assert.equal(await dados.obterLimiteAdvertencias(G), 5); assert.equal(await dados.obterLimiteAdvertencias(H), 3)
    const doc = c.auxiliares.configAdvertencias.docs[0]; assert.equal(doc.atualizado_por, numero(DONO)); assert.ok(doc.atualizado_em)
  })
  await teste('limite persiste ao recarregar módulo sem migrar advertências', async c => {
    await dados.definirLimiteAdvertencias(G, 7, numero(DONO)); await c.criar()
    const caminho = require.resolve('../advertencias'), anterior = require.cache[caminho]
    delete require.cache[caminho]
    try { const novo = require('../advertencias'); novo.__definirColecaoTeste(c.colecao, c.auxiliares); assert.equal(await novo.obterLimiteAdvertencias(G), 7); assert.equal(await novo.contarAdvertencias(numero(ALVO), G), 1) }
    finally { require.cache[caminho] = anterior }
  })
  for (const valor of ['0', '11', '-1', '1.5', 'abc', '5 extra', '']) await teste(`limite inválido recusado: ${valor || 'vazio'}`, async c => {
    await c.executar('setlimiteadv', DONO, null, `/setlimiteadv ${valor}`); assert.equal(c.auxiliares.configAdvertencias.docs.length, 0); assert.match(c.texto(), /Use/)
  })
  for (const autor of [ADM, ALVO]) await teste(`somente dono configura; recusa ${autor}`, async c => {
    await c.executar('setlimiteadv', autor, null, '/setlimiteadv 5'); assert.equal(c.auxiliares.configAdvertencias.docs.length, 0)
  })
  await teste('dono por LID configura limite', async c => { await c.executar('setlimiteadv', '999@lid', null, '/setlimiteadv 5'); assert.equal(await dados.obterLimiteAdvertencias(G), 5) })
  await teste('reduzir limite não bane retroativamente, próxima advertência aplica novo limite', async c => {
    await c.criar(); await c.criar()
    await c.executar('setlimiteadv', DONO, null, '/setlimiteadv 1'); assert.equal(c.removidas.length, 0)
    await c.advertir(); assert.equal(c.removidas.length, 1); assert.match(c.texto(), /BANIDO POR 1/)
  })
  await teste('advs e minhaspunicoes mostram limite personalizado', async c => {
    await dados.definirLimiteAdvertencias(G, 5, numero(DONO)); await c.advertir()
    await c.executar('advs'); assert.match(c.texto(), /1\/5/)
    await c.executar('minhaspunicoes', ALVO); assert.match(c.texto(), /1\/5/)
  })
  await teste('minhaspunicoes ignora alvo de menção e de resposta', async c => {
    await c.criar(ALVO, G, 'minha advertência'); await c.criar(ADM, G, 'segredo administrativo')
    for (const reply of [false, true]) {
      const msg = c.mensagem(ALVO, ADM)
      if (reply) msg.message.extendedTextMessage.contextInfo = { participant: ADM, quotedMessage: { conversation: 'texto' } }
      await c.executar('minhaspunicoes', ALVO, ADM, '/minhaspunicoes @outra', G, msg)
      assert.match(c.texto(), /minha advertência/); assert.doesNotMatch(c.texto(), /segredo administrativo/)
    }
  })
  for (const nome of ['adv', 'remadv', 'advs', 'historicoadv', 'zeraradv']) await teste(`membro não executa ${nome}`, async c => {
    await c.criar(); await c.executar(nome, ALVO, ADM, `/${nome} motivo`)
    assert.equal(c.colecao.docs.length, 1); assert.equal(await dados.contarAdvertencias(numero(ALVO), G), 1); assert.equal(c.removidas.length, 0); assert.match(c.texto(), /administradores/)
  })
  await teste('dono não ADM mantém restrição de adv/remadv e pode consultar/zerar', async c => {
    await c.executar('adv', DONO, ALVO, '/adv motivo'); assert.equal(c.colecao.docs.length, 0)
    await c.criar(); await c.executar('remadv', DONO); assert.equal(await dados.contarAdvertencias(numero(ALVO), G), 1)
    await c.executar('historicoadv', DONO); assert.match(c.texto(), /motivo/)
    await c.executar('zeraradv', DONO); assert.equal(await dados.contarAdvertencias(numero(ALVO), G), 0)
  })
  await teste('ADM por LID em campo separado e alvo por LID', async c => {
    await c.advertir('LID correto', '777@lid', '888@lid'); assert.equal(c.colecao.docs[0].numero, numero(ALVO)); assert.equal(c.colecao.docs[0].aplicado_por, numero(ADM))
  })
  await teste('ADM por mapeamento de sessão comprovado', async c => {
    lid.__definirConsultaSessaoTeste(async id => id === '7777' ? numero(ADM) : null)
    await c.advertir('sessão', '7777@lid'); assert.equal(c.colecao.docs.length, 1)
  })
  await teste('LID com dígitos do ADM não autoriza', async c => {
    await c.advertir('tentativa', `${numero(ADM)}@lid`); assert.equal(c.colecao.docs.length, 0)
  })
  await teste('auto-advertência PN/LID recusada', async c => { await c.advertir('auto', ADM, '777@lid'); assert.equal(c.colecao.docs.length, 0); assert.match(c.texto(), /si mesmo/) })
  await teste('dono resolvido só pela sessão não pode ser advertido', async c => {
    lid.__definirConsultaSessaoTeste(async id => id === '9999' ? numero(DONO) : null)
    await c.advertir('tentativa', ADM, '9999@lid'); assert.equal(c.colecao.docs.length, 0); assert.match(c.texto(), /dono/)
  })
  await teste('próprio bot protegido por PN e LID em adv/zerar', async c => {
    for (const id of [BOT, '666@lid']) for (const nome of ['adv', 'zeraradv']) await c.executar(nome, ADM, id, `/${nome} motivo`)
    assert.equal(c.colecao.docs.length, 0); assert.equal(c.removidas.length, 0)
  })
  await teste('zerar não altera registros do dono', async c => {
    await c.criar(DONO); await c.executar('zeraradv', ADM, '999@lid'); assert.equal(await dados.contarAdvertencias(numero(DONO), G), 1)
  })
  for (const tipo of ['texto', 'imagem', 'video', 'ephemeral', 'viewOnce-citado']) await teste(`contexto citado reconhecido: ${tipo}`, async c => {
    const contexto = { participant: '888@lid', quotedMessage: tipo === 'viewOnce-citado' ? { viewOnceMessageV2: { message: { imageMessage: { viewOnce: true } } } } : { imageMessage: { caption: 'original' } } }
    const msg = c.mensagem()
    if (tipo === 'imagem' || tipo === 'video') msg.message = { [tipo === 'imagem' ? 'imageMessage' : 'videoMessage']: { caption: '/adv motivo', contextInfo: contexto } }
    else { msg.message.extendedTextMessage.contextInfo = contexto; if (tipo === 'ephemeral') msg.message = { ephemeralMessage: { message: msg.message } } }
    await c.executar('adv', ADM, ALVO, '/adv motivo', G, msg)
    assert.equal(c.colecao.docs.length, 1); assert.equal(c.colecao.docs[0].numero, numero(ALVO)); assert.ok(c.enviadas.every(e => !e.image && !e.video))
  })
  await teste('perdão preserva motivo, aplicação e responsáveis', async c => {
    await c.criar(); const antes = { ...c.colecao.docs[0] }; await c.executar('remadv')
    const depois = c.colecao.docs[0]; assert.equal(depois.estado, 'perdoada'); assert.equal(depois.ativa, false)
    for (const campo of ['motivo', 'data', 'aplicado_por']) assert.equal(depois[campo], antes[campo])
    assert.equal(depois.removido_por, numero(ADM)); assert.ok(depois.removida_em); assert.equal(await dados.contarAdvertencias(numero(ALVO), G), 0)
  })
  await teste('remadv não informa zero quando saldo falha', async c => {
    await c.criar(); const original = c.colecao.find.bind(c.colecao); let consultas = 0
    c.colecao.find = filtro => { if (++consultas === 2) throw new Error('leitura indisponível'); return original(filtro) }
    await c.executar('remadv'); assert.match(c.texto(), /Não consegui consultar o saldo/); assert.doesNotMatch(c.texto(), /0\/3/); assert.equal(c.colecao.docs[0].estado, 'perdoada')
  })
  await teste('zerar arquiva apenas ativos deste grupo e registra autor', async c => {
    await c.criar(); await c.criar(); await c.criar(ALVO, H)
    await c.executar('zeraradv'); assert.match(c.texto(), /2 advertência/); assert.equal(await dados.contarAdvertencias(numero(ALVO), G), 0); assert.equal(await dados.contarAdvertencias(numero(ALVO), H), 1)
    assert.ok(c.colecao.docs.filter(d => d.grupo_id === G).every(d => d.arquivada_por === numero(ADM) && d.arquivada_em))
  })
  await teste('histórico paginado mostra ativa, perdão e arquivo sem outro grupo', async c => {
    await c.criar(); await c.executar('remadv'); await c.criar(); await c.executar('zeraradv')
    for (let i = 0; i < 5; i++) await c.criar(ALVO, G, `ativa-${i}`)
    await c.criar(ALVO, H, 'OUTRO GRUPO')
    await c.executar('historicoadv'); assert.match(c.texto(), /Próxima/); assert.doesNotMatch(c.texto(), /OUTRO GRUPO/)
    await c.executar('historicoadv', ADM, ALVO, '/historicoadv 2'); assert.match(c.texto(), /perdoada/); assert.match(c.texto(), /arquivada/); assert.doesNotMatch(c.texto(), /Próxima/)
  })
  for (const status of ['403', '500', '404']) await teste(`status ${status} não arquiva nem grava blacklist`, async c => {
    c.sock.status = status; await c.criar(); await c.criar(); await c.advertir()
    assert.equal(await dados.contarAdvertencias(numero(ALVO), G), 3); assert.equal(c.blacklist.length, 0); assert.doesNotMatch(c.texto(), /BANIDO POR/); assert.equal(c.auxiliares.advertenciasOperacoes.docs.length, 0)
  })
  await teste('resposta vazia não confirma e bloqueia repetição incerta', async c => {
    c.sock.semResposta = true; await c.criar(); await c.criar(); await c.advertir(); await c.advertir()
    assert.equal(c.removidas.length, 1); assert.equal(c.blacklist.length, 0); assert.equal(await dados.contarAdvertencias(numero(ALVO), G), 3)
    assert.equal(c.auxiliares.advertenciasOperacoes.docs.length, 1)
  })
  await teste('erro de transporte preserva contagem e não repete remoção', async c => {
    c.sock.erroRemocao = true; await c.criar(); await c.criar(); await c.advertir(); await c.advertir()
    assert.equal(c.removidas.length, 1); assert.equal(c.blacklist.length, 0); assert.equal(await dados.contarAdvertencias(numero(ALVO), G), 3)
  })
  await teste('blacklist é gravada somente depois da remoção aceita', async c => {
    const original = c.sock.groupParticipantsUpdate.bind(c.sock)
    c.sock.groupParticipantsUpdate = async (...args) => { assert.equal(c.blacklist.length, 0); return original(...args) }
    await c.criar(); await c.criar(); await c.advertir(); assert.equal(c.blacklist.length, 1); assert.equal(await dados.contarAdvertencias(numero(ALVO), G), 0)
  })
  await teste('falha de arquivo blacklist anuncia remoção e pendência honestamente', async c => {
    ban.__definirGravacaoBlacklistTeste(() => { throw new Error('disco offline') })
    await c.criar(); await c.criar(); await c.advertir(); assert.match(c.texto(), /Remoção confirmada/); assert.equal(await dados.contarAdvertencias(numero(ALVO), G), 0); assert.equal(c.auxiliares.advertenciasOperacoes.docs.length, 1)
  })
  await teste('falha após remoção mantém reserva e histórico sem repetir expulsão', async c => {
    await c.criar(); await c.criar(); c.colecao.updateMany = async () => { throw new Error('arquivo offline') }
    await c.advertir(); assert.match(c.texto(), /Não consegui arquivar/); assert.equal(await dados.contarAdvertencias(numero(ALVO), G), 3)
    assert.equal(c.auxiliares.advertenciasOperacoes.docs[0].estado, 'remocao_confirmada')
    await assert.rejects(c.criar(), /pendente/); assert.equal(c.removidas.length, 1)
  })
  await teste('criações simultâneas retornam contagens sequenciais', async c => {
    const resultados = await Promise.all(Array.from({ length: 10 }, () => c.criar()))
    assert.deepEqual(resultados.map(r => r.total), [1,2,3,4,5,6,7,8,9,10]); assert.equal(c.auxiliares.advertenciasOperacoes.docs.length, 0)
  })
  await teste('advertências simultâneas não repetem expulsão nem criam registros após saída', async c => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => c.advertir(`concorrente-${i}`)))
    assert.equal(c.removidas.length, 1); assert.equal(c.blacklist.length, 1); assert.equal(c.colecao.docs.length, 3); assert.ok(c.colecao.docs.every(d => d.estado === 'arquivada'))
  })
  await teste('duas remoções simultâneas perdoam registros distintos', async c => {
    await c.criar(); await c.criar(); await Promise.all([c.executar('remadv'), c.executar('remadv')])
    assert.equal(c.colecao.docs.length, 2); assert.ok(c.colecao.docs.every(d => d.estado === 'perdoada'))
  })
  await teste('reserva no Mongo impede outro processo de operar o mesmo alvo', async c => {
    let liberar, pronta
    const espera = new Promise(r => { liberar = r }), entrou = new Promise(r => { pronta = r })
    const primeira = dados.comAdvertenciasSerializadas(numero(ALVO), G, async () => { pronta(); await espera })
    await entrou
    const caminho = require.resolve('../advertencias'), anterior = require.cache[caminho]; delete require.cache[caminho]
    try { const outro = require('../advertencias'); outro.__definirColecaoTeste(c.colecao, c.auxiliares); await assert.rejects(outro.criarAdvertencia({ numero: numero(ALVO), grupoId: G }), /pendente/); assert.equal(c.colecao.docs.length, 0) }
    finally { require.cache[caminho] = anterior; liberar(); await primeira }
  })
  await teste('falha de Mongo antes do registro não produz punição', async c => {
    c.colecao.falhar = true; await c.advertir(); assert.equal(c.removidas.length, 0); assert.equal(c.blacklist.length, 0); assert.equal(c.colecao.docs.length, 0)
  })
  await teste('falha ao consultar limite não usa padrão silenciosamente', async c => {
    c.auxiliares.configAdvertencias.falhar = true; await c.advertir(); assert.equal(c.colecao.docs.length, 0); assert.equal(c.removidas.length, 0)
  })
  await teste('falha de reserva impede gravação de advertências', async c => {
    c.auxiliares.advertenciasOperacoes.falhar = true; await c.advertir(); assert.equal(c.colecao.docs.length, 0)
  })
  await teste('falha de metadata não autoriza comandos', async c => {
    c.sock.erroMetadata = true; await c.advertir(); await c.executar('setlimiteadv', DONO, null, '/setlimiteadv 5'); assert.equal(c.colecao.docs.length, 0); assert.equal(c.auxiliares.configAdvertencias.docs.length, 0)
  })
  await teste('figadv soma com adv e usa limite personalizado', async c => {
    await dados.definirLimiteAdvertencias(G, 2, numero(DONO)); await c.advertir('manual')
    await regras.cadastrar(G, createHash('sha256').update(c.bytes).digest('hex'), 'adv', numero(ADM))
    await mod.processar(c.sock, { key: { remoteJid: G, participant: ALVO, id: 'sticker-1' }, message: { stickerMessage: {} } })
    assert.equal(c.removidas.length, 1); assert.equal(c.colecao.docs.length, 2); assert.ok(c.colecao.docs.every(d => d.estado === 'arquivada')); assert.match(c.texto(), /BANIDO POR 2/)
  })
  await teste('adv e figadv simultâneos compartilham operação até arquivamento', async c => {
    await regras.cadastrar(G, createHash('sha256').update(c.bytes).digest('hex'), 'adv', numero(ADM))
    await Promise.all([c.advertir('manual1'), c.advertir('manual2'), mod.processar(c.sock, { key: { remoteJid: G, participant: ALVO, id: 'sticker-2' }, message: { stickerMessage: {} } })])
    assert.equal(c.removidas.length, 1); assert.equal(c.colecao.docs.length, 3); assert.equal(await dados.contarAdvertencias(numero(ALVO), G), 0)
  })
  await teste('OFF bloqueia ADM/membro e autoriza dono; moderação continua', async c => {
    estado.__definirColecaoTeste(fake()); await estado.definirLigado(false, numero(DONO))
    lid.__definirConsultaSessaoTeste(async id => id === '999' ? numero(DONO) : null)
    for (const autor of [ADM, ALVO]) assert.equal(await estado.permitirMensagem(c.sock, G, autor), false)
    assert.equal(await estado.permitirMensagem(c.sock, G, '999@lid'), true)
    await c.executar('setlimiteadv', '999@lid', null, '/setlimiteadv 5')
    await regras.cadastrar(G, createHash('sha256').update(c.bytes).digest('hex'), 'adv', numero(ADM))
    await mod.processar(c.sock, { key: { remoteJid: G, participant: ALVO, id: 'sticker-off' }, message: { stickerMessage: {} } })
    assert.equal(await dados.contarAdvertencias(numero(ALVO), G), 1)
    await estado.definirLigado(true, numero(DONO)); assert.equal(await estado.permitirMensagem(c.sock, G, ADM), true)
  })
  await teste('novos comandos recusam privado sem mutações', async c => {
    for (const cmd of novos) await c.executar(cmd.nome, DONO, ALVO, `/${cmd.nome} 5`, DONO)
    assert.equal(c.colecao.docs.length, 0); assert.equal(c.auxiliares.configAdvertencias.docs.length, 0)
  })
  console.log(`\n${total} testes passaram.`)
}
main().catch(e => { console.error(e); process.exitCode = 1 })
