process.env.MONGODB_URI = ''; process.env.MONGO_URI_RPG = ''; process.env.OWNER_NUMBERS = '5511000000001'
require('node:net').Socket.prototype.connect = () => { throw Error('REDE_PROIBIDA') }
const assert = require('node:assert/strict')
const { criarServico } = require('../dados/arcontes-olimpo')
const { criarRepositorio, preparar } = require('../dados/arcontes-olimpo-mongo')
const fake = require('./helpers/colecoes-arcontes-fake')
const lid = require('../lid'), seguro = require('../dados/socket-seguro')
const { normalizar } = require('../dados/arcontes-historico-ui')
const { acompanharSocket } = require('../dados/arcontes-nomes')
lid.__definirConsultaSessaoTeste(async () => null); lid.resolverLidsEmLote = async () => new Map()
const D = '5511000000001', A = '5511000000002', R = '5511000000003', T = '5511000000004', B = '5511000000005', U = '5511000000006'
const pn = n => `${n}@s.whatsapp.net`, G = '120000000000001@g.us', H = '120000000000002@g.us', I = '120000000000003@g.us'
const OP = 'a'.repeat(64), REV = 'b'.repeat(64)
let seq = 0, total = 0
async function fixture() {
  const cols = fake(); await preparar(cols)
  const repo = criarRepositorio(async () => cols)
  const membros = () => [{ id: pn(A), admin: 'admin', name: 'Ágata' }, { id: pn(D), name: 'Dono' },
    { id: pn(R), name: 'Arconte Íris' }, { id: pn(T), notify: 'Participante Lúcio' }, { id: pn(U) }, { id: pn(B), admin: 'admin' }]
  const c = { cols, repo, tempo: 1000, envios: [], chamadas: [], grupos: {
    [G]: { id: G, subject: '#Swag', owner: pn(A), participants: membros() },
    [H]: { id: H, subject: 'Outro grupo', owner: pn(A), participants: membros() }
  } }
  const observadores = new Set(), encerramentos = []
  c.emitir = eventos => { for (const fn of observadores) fn(eventos) }
  c.quantidadeObservadores = () => observadores.size
  c.encerrar = () => { for (const fn of encerramentos) fn() }
  c.sock = { user: { id: pn(B) }, ws: { isOpen: true }, ev: { process(fn) { observadores.add(fn); return () => observadores.delete(fn) } },
    registerSocketEndHandler(fn) { encerramentos.push(fn) },
    async groupFetchAllParticipating() { if (c.listaHook) return c.listaHook(); return structuredClone(c.grupos) },
    async groupMetadata(grupo) { if (c.metaHook) await c.metaHook(grupo); if (!c.grupos[grupo]) throw Error('SEM_GRUPO'); return structuredClone(c.grupos[grupo]) },
    async sendMessage(jid, conteudo, opts) { c.envios.push({ jid, conteudo, opts }); return {} },
    async groupParticipantsUpdate() { assert.fail('HISTORICO_NAO_REMOVE') }
  }
  seguro.preparar(c.sock); seguro.atualizar(c.sock, true)
  acompanharSocket(c.sock, { agora: () => c.tempo })
  c.servico = criarServico(repo, { agora: () => c.tempo })
  c.cols.eventos.docs.push({ _id: OP, grupo: G, tipo: 'kick', estado: 'confirmada', responsavel: R, responsavelTipo: 'arconte', alvo: T,
    motivo: 'motivo de exemplo', criadoEm: new Date(), confirmadoEm: new Date() })
  c.run = async (comando, { autor = A, origem = pn(autor), chave = {}, id } = {}) => {
    const msg = { key: { remoteJid: origem, participant: origem.endsWith('@g.us') ? pn(autor) : undefined,
      id: id || `historico-${++seq}`, fromMe: false, ...chave } }
    await c.servico.executar('historicoarconte', c.sock, origem, msg, comando)
  }
  c.texto = () => c.envios.at(-1)?.conteudo.text || ''
  c.semVazamento = () => {
    for (const envio of c.envios) {
      const resposta = JSON.stringify({ conteudo: envio.conteudo, opts: envio.opts })
      for (const segredo of [G, H, I, D, A, R, T, B, U, OP, REV]) assert(!resposta.includes(segredo), `Identificador na resposta: ${segredo}`)
      assert(!/@(?:g\.us|s\.whatsapp\.net|lid)\b/.test(resposta))
      assert.equal(envio.opts, undefined)
    }
  }
  c.snapshot = () => structuredClone({ eventos: cols.eventos.docs, controles: cols.controles.docs, patentes: cols.patentes.docs })
  return c
}
async function teste(nome, fn) { await fn(); total++; console.log('OK:', nome) }
const refGrupo = c => c.texto().match(/grupo (g-[A-Za-z0-9_-]{16})/)?.[1]
const refOp = c => c.texto().match(/op-[A-Za-z0-9_-]{16}/)?.[0]
async function incerta(c) {
  Object.assign(c.cols.eventos.docs[0], { estado: 'incerta' })
  await c.repo.travar(G, 'TOKEN_CONTROLE_SECRETO', OP, 'instancia-fake')
}
async function main() {
  for (const nome of ['#Swag', 'Equipe dos Sonhos', '#Árvore & Café ✨', 'Equipe 2', 'Amigos pendentes', 'Grupo -- especial', 'Clube "Lua" \\ Noite']) {
    await teste('nome completo, símbolos e espaços: ' + nome, async () => {
      const c = await fixture(); c.grupos[G].subject = nome; const antes = c.snapshot()
      await c.run(`/historicoarconte grupo ${nome}`)
      assert(c.texto().includes('EXPULSÕES CONFIRMADAS')); assert(c.texto().includes(nome))
      assert(c.texto().includes('Arconte Íris')); assert(c.texto().includes('Participante Lúcio'))
      assert.deepEqual(c.snapshot(), antes); c.semVazamento()
    })
  }
  await teste('normaliza acentos, caixa, Unicode e espaços sem modificar o original', async () => {
    const c = await fixture(); c.grupos[G].subject = '#Árvore  & CAFÉ'
    await c.run('/historicoarconte grupo #arvore & cafe')
    assert(c.texto().includes('#Árvore  & CAFÉ')); assert.equal(c.grupos[G].subject, '#Árvore  & CAFÉ')
    assert.equal(normalizar('Ｃａｆｅ́'), normalizar('Café')); c.semVazamento()
  })
  await teste('nome entre aspas e paginação por nome completo', async () => {
    const c = await fixture(); c.grupos[G].subject = 'Clube "Lua" \\ Noite'
    await c.run(`/historicoarconte grupo ${JSON.stringify(c.grupos[G].subject)} 2`)
    assert.match(c.texto(), /Nenhuma expulsão/); c.semVazamento()
  })
  for (const sufixo of ['2', '-- 2', 'revisoes 2', 'pendentes']) {
    await teste('nome sem aspas aceita sufixo: ' + sufixo, async () => {
      const c = await fixture(); c.grupos[G].subject = 'Equipe dos Sonhos'
      await c.run(`/historicoarconte grupo Equipe dos Sonhos ${sufixo}`)
      assert(!c.texto().includes('não encontrado')); assert(!c.texto().includes('não concluída')); c.semVazamento()
    })
  }
  await teste('mantém entrada por ID, mas resposta usa nome e referência temporária', async () => {
    const c = await fixture(); await c.run(`/historicoarconte grupo ${G}`)
    assert.match(c.texto(), /Grupo:\* #Swag/); assert(c.texto().includes('grupo "#Swag"')); assert(!refGrupo(c)); c.semVazamento()
  })
  await teste('paginação pelo comando devolvido pelo bot', async () => {
    const c = await fixture(); await c.run('/historicoarconte grupo #Swag')
    const proxima = c.texto().match(/Próxima página:\* (.+)/)[1]
    await c.run(proxima); assert.match(c.texto(), /Nenhuma expulsão/); c.semVazamento()
  })
  await teste('duplicatas só mostram grupos autorizados, com opções temporárias distintas', async () => {
    const c = await fixture(); c.grupos[H].subject = '#Swag'
    c.grupos[I] = structuredClone(c.grupos[G]); c.grupos[I].id = I; c.grupos[I].participants = c.grupos[I].participants.filter(p => p.id !== pn(A)); c.grupos[I].owner = pn(B)
    await c.run('/historicoarconte grupo #Swag')
    const refs = [...c.texto().matchAll(/grupo (g-[A-Za-z0-9_-]{16})/g)].map(m => m[1])
    assert.equal(refs.length, 2); assert.notEqual(refs[0], refs[1]); c.semVazamento()
    await c.run(`/historicoarconte grupo ${refs[0]}`); assert.match(c.texto(), /EXPULSÕES CONFIRMADAS/)
    await c.run(`/historicoarconte grupo ${refs[1]}`); assert.match(c.texto(), /Nenhuma expulsão/); c.semVazamento()
  })
  await teste('membro comum e Arconte não descobrem grupos nem consultam histórico', async () => {
    const c = await fixture(); await c.repo.definir(G, R, true, A, 'fixture')
    for (const autor of [R, U]) {
      await c.run('/historicoarconte grupo #Swag', { autor })
      assert.match(c.texto(), /não encontrado ou acesso não autorizado/)
      assert(!c.texto().includes('Grupo:')); assert(!c.texto().includes('#Swag'))
    }
    c.semVazamento()
  })
  await teste('grupo inexistente não revela inventário nem repete entrada sensível', async () => {
    const c = await fixture(); await c.run(`/historicoarconte grupo inexistente ${G} ${T}`)
    assert.match(c.texto(), /não encontrado ou acesso não autorizado/); c.semVazamento()
  })
  await teste('token não concede acesso a outro usuário nem ao mesmo usuário sem ADM', async () => {
    const c = await fixture(); c.grupos[H].subject = '#Swag'; await c.run(`/historicoarconte grupo ${G}`); const ref = refGrupo(c)
    await c.run(`/historicoarconte grupo ${ref}`, { autor: D }); assert.match(c.texto(), /inválida ou expirada/)
    c.grupos[G].owner = pn(B); delete c.grupos[G].participants.find(p => p.id === pn(A)).admin
    await c.run(`/historicoarconte grupo ${ref}`); assert.match(c.texto(), /Apenas administradores/); c.semVazamento()
  })
  await teste('tokens expiram e não sobrevivem a outro socket', async () => {
    const c = await fixture(); c.grupos[H].subject = '#Swag'; await c.run(`/historicoarconte grupo ${G}`); const ref = refGrupo(c)
    const sockAntigo = c.sock; c.sock = { ...c.sock }
    await c.run(`/historicoarconte grupo ${ref}`); assert.match(c.texto(), /inválida ou expirada/)
    c.sock = sockAntigo; c.tempo += 15 * 60 * 1000 + 1
    await c.run(`/historicoarconte grupo ${ref}`); assert.match(c.texto(), /inválida ou expirada/); c.semVazamento()
  })
  await teste('sem nomes disponíveis não utiliza telefone como nome substituto', async () => {
    const c = await fixture(); c.grupos[G].participants.find(p => p.id === pn(R)).name = R
    c.grupos[G].participants = c.grupos[G].participants.filter(p => p.id !== pn(T))
    await c.run('/historicoarconte grupo #Swag'); assert.match(c.texto(), /Participante não identificado/); c.semVazamento()
  })
  await teste('nomes são resolvidos com prova PN/LID, sem confundir namespaces', async () => {
    const c = await fixture(); Object.assign(c.grupos[G].participants.find(p => p.id === pn(R)), { id: '90003@lid', phoneNumber: pn(R) })
    await c.run('/historicoarconte grupo #Swag'); assert(c.texto().includes('Arconte Íris')); c.semVazamento()
  })
  await teste('contatos já disponíveis fornecem nome sem buscar ou expor telefone', async () => {
    const c = await fixture(); delete c.grupos[G].participants.find(p => p.id === pn(R)).name
    c.sock.contacts = { [pn(R)]: { name: 'Íris do contato' } }
    await c.run('/historicoarconte grupo #Swag'); assert(c.texto().includes('Íris do contato')); c.semVazamento()
  })
  await teste('nome do contato PN exato permanece disponível após a saída do participante', async () => {
    const c = await fixture(); c.grupos[G].participants = c.grupos[G].participants.filter(p => p.id !== pn(T))
    c.sock.contacts = { [pn(T)]: { name: 'Lúcio do contato' } }
    await c.run('/historicoarconte grupo #Swag'); assert(c.texto().includes('Lúcio do contato')); c.semVazamento()
  })
  await teste('nome numérico não esconde outro nome válido disponível', async () => {
    const c = await fixture(); Object.assign(c.grupos[G].participants.find(p => p.id === pn(R)), { name: R, notify: 'Íris pelo notify' })
    await c.run('/historicoarconte grupo #Swag'); assert(c.texto().includes('Íris pelo notify')); c.semVazamento()
  })
  await teste('referência de grupo aceita identidade PN/LID comprovada do mesmo solicitante', async () => {
    const c = await fixture(); c.grupos[G].participants.find(p => p.id === pn(A)).lid = '90002@lid'
    c.grupos[H].subject = '#Swag'; await c.run(`/historicoarconte grupo ${G}`); const ref = refGrupo(c)
    await c.run(`/historicoarconte grupo ${ref}`, { autor: A, origem: '90002@lid' })
    assert.match(c.texto(), /EXPULSÕES CONFIRMADAS/); c.semVazamento()
  })
  await teste('motivos e nomes contendo JIDs/telefones/IDs são ocultados sem alterar documentos', async () => {
    const c = await fixture(); c.grupos[G].subject = `#Swag ${T}`
    c.cols.eventos.docs[0].motivo = `${G} ${pn(T)} +55 (11) 00000-0004 ${OP}`
    const antes = c.snapshot(); await c.run(`/historicoarconte grupo ${G}`)
    assert.match(c.texto(), /identificador oculto/); assert.deepEqual(c.snapshot(), antes); c.semVazamento()
  })
  await teste('pendentes, operacao, resolver e revisoes usam referências e preservam auditoria', async () => {
    const c = await fixture(); c.grupos[H].subject = '#Swag'; await incerta(c); const antes = structuredClone(c.cols.eventos.docs[0])
    await c.run(`/historicoarconte grupo ${G} pendentes`); const op = refOp(c), grupo = refGrupo(c)
    assert(op && grupo); assert(!c.texto().includes('TOKEN_CONTROLE_SECRETO')); c.semVazamento()
    await c.run(`/historicoarconte grupo ${grupo} operacao ${op}`); assert.match(c.texto(), /Estado original:\* incerta/)
    await c.run(`/historicoarconte grupo ${grupo} resolver ${op} CONFIRMO revisado pelo administrador`)
    assert.match(c.texto(), /Trava liberada/); assert.deepEqual(c.cols.eventos.docs[0], antes)
    const revisao = c.cols.eventos.docs.find(e => e.tipo === 'revisao')
    assert.equal(revisao.operacao, OP); assert.equal(revisao.responsavel, A)
    assert.equal(c.cols.controles.docs[0].ocupado, false)
    await c.run(`/historicoarconte grupo ${grupo} revisoes`); assert.match(c.texto(), /liberada/); c.semVazamento()
  })
  await teste('referência de operação não funciona em outro grupo ou para outro revisor', async () => {
    const c = await fixture(); await incerta(c)
    await c.run('/historicoarconte grupo #Swag pendentes'); const op = refOp(c), antes = c.snapshot()
    await c.run(`/historicoarconte grupo ${H} resolver ${op} CONFIRMO motivo suficientemente longo`)
    assert.match(c.texto(), /inválida ou expirada/)
    await c.run(`/historicoarconte grupo ${G} resolver ${op} CONFIRMO motivo suficientemente longo`, { autor: D })
    assert.match(c.texto(), /inválida ou expirada/); assert.deepEqual(c.snapshot(), antes); c.semVazamento()
  })
  await teste('grupo recebe só confirmação e nenhum comando com ID é citado', async () => {
    const c = await fixture(); await c.run(`/historicoarconte grupo ${G}`, { origem: G })
    assert.equal(c.envios.at(-1).jid, G); assert.equal(c.texto(), 'Consulta do histórico enviada no privado.')
    assert(c.envios[0].conteudo.text.includes('EXPULSÕES CONFIRMADAS')); c.semVazamento()
  })
  await teste('perda de autorização durante consulta impede divulgação', async () => {
    const c = await fixture(); const ler = c.repo.historico
    c.repo.historico = async (...args) => { const r = await ler(...args); c.grupos[G].owner = pn(B); delete c.grupos[G].participants.find(p => p.id === pn(A)).admin; return r }
    await c.run('/historicoarconte grupo #Swag'); assert(!c.texto().includes('EXPULSÕES CONFIRMADAS')); c.semVazamento()
  })
  await teste('falha da lista e metadados ausentes não autorizam busca por nome', async () => {
    const c = await fixture(); c.listaHook = () => { throw Error(`SEGREDO ${G}`) }
    await c.run('/historicoarconte grupo #Swag'); assert(!c.texto().includes('EXPULSÕES CONFIRMADAS')); c.semVazamento()
  })
  await teste('ajuda e erros não contêm IDs ou números da entrada', async () => {
    const c = await fixture()
    for (const comando of ['/historicoarconte', '/historicoarconte grupo', '/historicoarconte grupo "aspas abertas', `/historicoarconte grupo ${G} operacao INVALIDO ${T}`]) await c.run(comando)
    c.semVazamento()
  })
  await teste('resposta de erro inesperado é sanitizada no privado e no grupo', async () => {
    const c = await fixture()
    c.repo.historico = async () => { throw Object.assign(Error('FALHA'), { resposta: `Falha ${G} ${T} ${OP}` }) }
    await c.run(`/historicoarconte grupo ${G}`)
    await c.run('/historicoarconte', { origem: G })
    c.semVazamento(); assert.match(c.texto(), /identificador oculto/)
  })
  const limparNomes = c => { for (const p of c.grupos[G].participants) { delete p.name; delete p.notify; delete p.pushName } }
  const proxima = c => c.texto().match(/Próxima página:\* (.+)/)?.[1]
  await teste('Arquivos do Olimpo usa cartões, horário de Brasília e motivo padrão', async () => {
    const c = await fixture(); c.cols.eventos.docs[0].confirmadoEm = new Date('2026-10-23T18:58:00Z'); c.cols.eventos.docs[0].motivo = null
    await c.run('/historicoarconte grupo #Swag')
    assert(c.texto().includes('🏛️ *ARQUIVOS DO OLIMPO* 🏛️'))
    assert(c.texto().includes('👑 *Arconte:* Arconte Íris')); assert(c.texto().includes('🎯 *Alvo:* Participante Lúcio'))
    assert(c.texto().includes('📅 *Data:* 23/10/2026 às 15:58 (UTC-03:00)'))
    assert(c.texto().includes('America/Sao_Paulo')); assert(c.texto().includes('📝 *Motivo:* Não informado'))
    assert.equal(proxima(c), '/historicoarconte grupo "#Swag" 2'); c.semVazamento()
  })
  await teste('fuso histórico considera horário de verão e data inválida não quebra resposta', async () => {
    const { formatarData } = require('../dados/arcontes-historico-ui')
    assert.equal(formatarData('2018-12-01T02:30:00Z'), '01/12/2018 às 00:30 (UTC-02:00)')
    assert.equal(formatarData('2026-10-23T01:00:00Z'), '22/10/2026 às 22:00 (UTC-03:00)')
    assert.equal(formatarData(null), 'Data não disponível'); assert.equal(formatarData('invalida'), 'Data não disponível')
  })
  await teste('pushName das mensagens recebidas preenche nomes sem consultar a rede', async () => {
    const c = await fixture(); limparNomes(c)
    c.emitir({ 'messages.upsert': { messages: [
      { key: { remoteJid: G, participant: pn(R) }, pushName: 'Íris das mensagens' },
      { key: { remoteJid: G, participant: pn(T) }, pushName: 'Lúcio das mensagens' }
    ] } })
    await c.run('/historicoarconte grupo #Swag')
    assert(c.texto().includes('Íris das mensagens')); assert(c.texto().includes('Lúcio das mensagens')); c.semVazamento()
  })
  await teste('pushName LID só é associado quando os metadados provam PN/LID', async () => {
    const c = await fixture(); limparNomes(c)
    Object.assign(c.grupos[G].participants.find(p => p.id === pn(R)), { id: '90003@lid', phoneNumber: pn(R) })
    c.emitir({ 'messages.upsert': { messages: [{ key: { remoteJid: G, participant: '90003@lid' }, pushName: 'Íris pelo LID' }] } })
    await c.run('/historicoarconte grupo #Swag'); assert(c.texto().includes('Íris pelo LID')); c.semVazamento()
  })
  await teste('dígitos iguais em LID e PN não associam pushName de outra pessoa', async () => {
    const c = await fixture(); limparNomes(c)
    c.emitir({ 'messages.upsert': { messages: [{ key: { remoteJid: G, participant: `${R}@lid` }, pushName: 'NOME_INCORRETO' }] } })
    await c.run('/historicoarconte grupo #Swag'); assert(!c.texto().includes('NOME_INCORRETO')); assert(c.texto().includes('Participante não identificado')); c.semVazamento()
  })
  await teste('contato com par explícito e atualização de nome é usado mesmo após a saída', async () => {
    const c = await fixture(); limparNomes(c); c.grupos[G].participants = c.grupos[G].participants.filter(p => p.id !== pn(T))
    c.emitir({ 'contacts.upsert': [{ id: '90004@lid', phoneNumber: pn(T), name: 'Lúcio antigo' }] })
    c.emitir({ 'contacts.update': [{ id: '90004@lid', name: 'Lúcio atualizado' }] })
    await c.run('/historicoarconte grupo #Swag'); assert(c.texto().includes('Lúcio atualizado')); assert(!c.texto().includes('Lúcio antigo')); c.semVazamento()
  })
  await teste('vínculo explícito lid-mapping.update permite usar contato LID sem nova consulta', async () => {
    const c = await fixture(); limparNomes(c)
    c.emitir({ 'contacts.upsert': [{ id: '90003@lid', notify: 'Íris conhecida' }], 'lid-mapping.update': { lid: '90003@lid', pn: pn(R) } })
    await c.run('/historicoarconte grupo #Swag'); assert(c.texto().includes('Íris conhecida')); c.semVazamento()
  })
  await teste('mapeamentos contraditórios não associam nome LID', async () => {
    const c = await fixture(); limparNomes(c)
    c.emitir({ 'contacts.upsert': [{ id: '90003@lid', notify: 'NOME_INCORRETO' }], 'lid-mapping.update': { lid: '90003@lid', pn: pn(R) } })
    c.emitir({ 'lid-mapping.update': { lid: '90003@lid', pn: pn(T) } })
    await c.run('/historicoarconte grupo #Swag'); assert(!c.texto().includes('NOME_INCORRETO')); c.semVazamento()
  })
  await teste('metadados duplicados para o mesmo PN não escolhem nome arbitrário', async () => {
    const c = await fixture(); c.grupos[G].participants.push({ id: pn(R), name: 'NOME_INCORRETO' })
    await c.run('/historicoarconte grupo #Swag'); assert(!c.texto().includes('NOME_INCORRETO')); assert(!c.texto().includes('Arconte Íris')); c.semVazamento()
  })
  await teste('LID presente em dois participantes não fornece nome por alias ambíguo', async () => {
    const c = await fixture(); limparNomes(c)
    c.grupos[G].participants.find(p => p.id === pn(R)).lid = '90003@lid'
    c.grupos[G].participants.push({ id: '90003@lid', name: 'NOME_INCORRETO' })
    await c.run('/historicoarconte grupo #Swag'); assert(!c.texto().includes('NOME_INCORRETO')); c.semVazamento()
  })
  await teste('nome salvo tem prioridade sobre pushName e metadados incompletos', async () => {
    const c = await fixture(); limparNomes(c)
    c.sock.store = { contacts: new Map([[pn(R), { id: pn(R), name: 'Íris salva', pushName: 'Íris perfil' }]]) }
    c.emitir({ 'messages.upsert': { messages: [{ key: { remoteJid: G, participant: pn(R) }, pushName: 'Íris mensagem' }] } })
    await c.run('/historicoarconte grupo #Swag'); assert(c.texto().includes('Íris salva')); assert(!c.texto().includes('Íris mensagem')); c.semVazamento()
  })
  await teste('catálogo expira e é limpo no encerramento sem persistir dados', async () => {
    const c = await fixture(); limparNomes(c); const antes = c.snapshot()
    c.emitir({ 'contacts.upsert': [{ id: pn(R), name: 'Íris transitória' }] })
    await c.run('/historicoarconte grupo #Swag'); assert(c.texto().includes('Íris transitória'))
    c.tempo += 6 * 60 * 60 * 1000 + 1
    await c.run('/historicoarconte grupo #Swag'); assert(!c.texto().includes('Íris transitória'))
    c.emitir({ 'contacts.upsert': [{ id: pn(R), name: 'Íris transitória' }] }); c.encerrar()
    await c.run('/historicoarconte grupo #Swag'); assert(!c.texto().includes('Íris transitória')); assert.deepEqual(c.snapshot(), antes)
  })
  await teste('histórico sincronizado traz apenas nomes; cache de mensagens respeita o grupo', async () => {
    const c = await fixture(); limparNomes(c)
    c.emitir({ 'messaging-history.set': { contacts: [{ id: pn(R), pushName: 'Íris sincronizada' }],
      messages: [{ key: { remoteJid: H, participant: pn(T) }, pushName: 'NOME_OUTRO_GRUPO' }] } })
    await c.run('/historicoarconte grupo #Swag'); assert(c.texto().includes('Íris sincronizada')); assert(!c.texto().includes('NOME_OUTRO_GRUPO')); c.semVazamento()
  })
  for (const nome of ['Amigos do Olimpo #São Paulo', 'Clube "Lua" \\ Noite', '#Swag ✨ [] {} * _ `']) {
    await teste('continuação por nome escapado pode ser copiada e executada: ' + nome, async () => {
      const c = await fixture(); c.grupos[G].subject = nome
      await c.run(`/historicoarconte grupo ${JSON.stringify(nome)}`)
      const cmd = proxima(c); assert.equal(cmd, `/historicoarconte grupo ${JSON.stringify(nome)} 2`)
      await c.run(cmd); assert.match(c.texto(), /Nenhuma expulsão/); c.semVazamento()
    })
  }
  await teste('prefixo da invocação é preservado nas instruções de continuação', async () => {
    const c = await fixture(); await c.run('!historicoarconte grupo #Swag')
    assert.equal(proxima(c), '!historicoarconte grupo "#Swag" 2')
    await c.run(proxima(c)); assert.match(c.texto(), /Nenhuma expulsão/); c.semVazamento()
  })
  await teste('duplicata não autorizada também impede atalho por nome sem revelar o grupo', async () => {
    const c = await fixture(); c.grupos[H].subject = '#SWÁG'; c.grupos[H].owner = pn(B); c.grupos[H].participants = c.grupos[H].participants.filter(p => p.id !== pn(A))
    await c.run('/historicoarconte grupo #Swag'); assert(refGrupo(c)); assert(!c.texto().includes('grupo "#Swag"')); c.semVazamento()
  })
  await teste('inventário incompleto ou indisponível mantém referência sem consultas em cascata', async () => {
    const c = await fixture(); let metadados = 0
    c.metaHook = async () => { metadados++ }; c.listaHook = () => ({ [G]: c.grupos[G], [H]: {} })
    await c.run(`/historicoarconte grupo ${G}`); assert(refGrupo(c)); assert.equal(metadados, 2)
    c.listaHook = () => { throw Error('SEM_REDE') }; await c.run(`/historicoarconte grupo ${G}`); assert(refGrupo(c)); c.semVazamento()
  })
  await teste('uma busca de nomes usa um único inventário, sem chamadas por participante', async () => {
    const c = await fixture(); let inventarios = 0, metadados = 0
    c.listaHook = () => { inventarios++; return structuredClone(c.grupos) }; c.metaHook = async () => { metadados++ }
    await c.run('/historicoarconte grupo #Swag'); assert.equal(inventarios, 1); assert.equal(metadados, 2); c.semVazamento()
  })
  await teste('mensagens longas preservam cartões e revalidam autorização a cada parte', async () => {
    const c = await fixture(); const modelo = c.cols.eventos.docs[0]
    modelo.motivo = 'Justificativa legível e extensa '.repeat(30)
    for (let i = 1; i < 10; i++) c.cols.eventos.docs.push({ ...structuredClone(modelo), _id: String(i).padStart(64, '0') })
    const antes = c.snapshot(); await c.run('/historicoarconte grupo #Swag')
    assert(c.envios.length > 1); assert(c.envios.every(e => e.conteudo.text.length <= 3800))
    assert.equal(c.envios.map(e => e.conteudo.text.match(/👑 \*Arconte:\*/g)?.length || 0).reduce((a, b) => a + b, 0), 10)
    assert(c.envios.every(e => e.conteudo.text.startsWith('🏛️ *ARQUIVOS DO OLIMPO*'))); assert(proxima(c)); assert.deepEqual(c.snapshot(), antes); c.semVazamento()
    c.envios.length = 0; const enviar = c.sock.sendMessage
    c.sock.sendMessage = async (...args) => { const r = await enviar(...args); c.grupos[G].owner = pn(B); delete c.grupos[G].participants.find(p => p.id === pn(A)).admin; return r }
    await c.run('/historicoarconte grupo #Swag')
    assert.equal(c.envios.filter(e => e.conteudo.text.startsWith('🏛️')).length, 1); c.semVazamento()
  })
  await teste('catálogo limitado não instala observadores duplicados e descarta nomes antigos', async () => {
    const c = await fixture(); limparNomes(c)
    acompanharSocket(c.sock); acompanharSocket(c.sock); assert.equal(c.quantidadeObservadores(), 1)
    c.emitir({ 'contacts.upsert': [{ id: pn(R), name: 'NOME_DESCARTAVEL' }] })
    c.emitir({ 'contacts.upsert': Array.from({ length: 2000 }, (_, i) => ({ id: pn(String(1000000 + i)), name: 'Contato sintético' })) })
    await c.run('/historicoarconte grupo #Swag'); assert(!c.texto().includes('NOME_DESCARTAVEL'))
    c.encerrar(); assert.equal(c.quantidadeObservadores(), 0); c.semVazamento()
  })
  await teste('nomes recebidos com dados sensíveis são ocultados também no catálogo transitório', async () => {
    const c = await fixture(); limparNomes(c)
    c.emitir({ 'contacts.update': [{ id: pn(R), name: `${pn(R)} ${OP}` }],
      'messages.upsert': { messages: [{ key: { remoteJid: G, participant: pn(T) }, pushName: `${T} ${G}` }] } })
    await c.run('/historicoarconte grupo #Swag'); assert(c.texto().includes('Participante não identificado')); c.semVazamento()
  })
  await teste('cartões preservam a função administrativa registrada, sem atribuir patente', async () => {
    const c = await fixture(); c.cols.eventos.docs[0].responsavelTipo = 'administrador'
    await c.run('/historicoarconte grupo #Swag'); assert(c.texto().includes('🛡️ *Administrador:*')); assert(!c.texto().includes('👑 *Arconte:*'))
    c.cols.eventos.docs[0].responsavelTipo = 'dono'
    await c.run('/historicoarconte grupo #Swag'); assert(c.texto().includes('👑 *Dono do bot:*')); c.semVazamento()
  })
  console.log(`${total} cenários de histórico por nome e privacidade passaram (offline).`)
}
main().catch(e => { console.error(e); process.exitCode = 1 })
