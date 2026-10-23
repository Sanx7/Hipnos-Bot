process.env.MONGODB_URI = ''; process.env.MONGO_URI_RPG = ''; process.env.OWNER_NUMBERS = '5511000000001'
require('node:net').Socket.prototype.connect = () => { throw Error('REDE_PROIBIDA') }
const assert = require('node:assert/strict')
const { criarServico } = require('../dados/arcontes-olimpo')
const { criarRepositorio, preparar } = require('../dados/arcontes-olimpo-mongo')
const fake = require('./helpers/colecoes-arcontes-fake')
const lid = require('../lid'), seguro = require('../dados/socket-seguro')
const { normalizar } = require('../dados/arcontes-historico-ui')
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
  c.sock = { user: { id: pn(B) }, ws: { isOpen: true },
    async groupFetchAllParticipating() { if (c.listaHook) return c.listaHook(); return structuredClone(c.grupos) },
    async groupMetadata(grupo) { if (c.metaHook) await c.metaHook(grupo); if (!c.grupos[grupo]) throw Error('SEM_GRUPO'); return structuredClone(c.grupos[grupo]) },
    async sendMessage(jid, conteudo, opts) { c.envios.push({ jid, conteudo, opts }); return {} },
    async groupParticipantsUpdate() { assert.fail('HISTORICO_NAO_REMOVE') }
  }
  seguro.preparar(c.sock); seguro.atualizar(c.sock, true)
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
      assert(c.texto().includes('Expulsões confirmadas')); assert(c.texto().includes(nome))
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
    assert.match(c.texto(), /Grupo: #Swag/); assert(refGrupo(c)); c.semVazamento()
  })
  await teste('paginação pelo comando devolvido pelo bot', async () => {
    const c = await fixture(); await c.run('/historicoarconte grupo #Swag')
    const proxima = c.texto().match(/Próxima página: (.+)/)[1]
    await c.run(proxima); assert.match(c.texto(), /Nenhuma expulsão/); c.semVazamento()
  })
  await teste('duplicatas só mostram grupos autorizados, com opções temporárias distintas', async () => {
    const c = await fixture(); c.grupos[H].subject = '#Swag'
    c.grupos[I] = structuredClone(c.grupos[G]); c.grupos[I].id = I; c.grupos[I].participants = c.grupos[I].participants.filter(p => p.id !== pn(A)); c.grupos[I].owner = pn(B)
    await c.run('/historicoarconte grupo #Swag')
    const refs = [...c.texto().matchAll(/grupo (g-[A-Za-z0-9_-]{16})/g)].map(m => m[1])
    assert.equal(refs.length, 2); assert.notEqual(refs[0], refs[1]); c.semVazamento()
    await c.run(`/historicoarconte grupo ${refs[0]}`); assert.match(c.texto(), /Expulsões confirmadas/)
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
    const c = await fixture(); await c.run('/historicoarconte grupo #Swag'); const ref = refGrupo(c)
    await c.run(`/historicoarconte grupo ${ref}`, { autor: D }); assert.match(c.texto(), /inválida ou expirada/)
    c.grupos[G].owner = pn(B); delete c.grupos[G].participants.find(p => p.id === pn(A)).admin
    await c.run(`/historicoarconte grupo ${ref}`); assert.match(c.texto(), /Apenas administradores/); c.semVazamento()
  })
  await teste('tokens expiram e não sobrevivem a outro socket', async () => {
    const c = await fixture(); await c.run('/historicoarconte grupo #Swag'); const ref = refGrupo(c)
    const sockAntigo = c.sock; c.sock = { ...c.sock }
    await c.run(`/historicoarconte grupo ${ref}`); assert.match(c.texto(), /inválida ou expirada/)
    c.sock = sockAntigo; c.tempo += 15 * 60 * 1000 + 1
    await c.run(`/historicoarconte grupo ${ref}`); assert.match(c.texto(), /inválida ou expirada/); c.semVazamento()
  })
  await teste('sem nomes disponíveis não utiliza telefone como nome substituto', async () => {
    const c = await fixture(); c.grupos[G].participants.find(p => p.id === pn(R)).name = R
    c.grupos[G].participants = c.grupos[G].participants.filter(p => p.id !== pn(T))
    await c.run('/historicoarconte grupo #Swag'); assert.match(c.texto(), /Participante sem nome disponível/); c.semVazamento()
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
    await c.run('/historicoarconte grupo #Swag'); const ref = refGrupo(c)
    await c.run(`/historicoarconte grupo ${ref}`, { autor: A, origem: '90002@lid' })
    assert.match(c.texto(), /Expulsões confirmadas/); c.semVazamento()
  })
  await teste('motivos e nomes contendo JIDs/telefones/IDs são ocultados sem alterar documentos', async () => {
    const c = await fixture(); c.grupos[G].subject = `#Swag ${T}`
    c.cols.eventos.docs[0].motivo = `${G} ${pn(T)} +55 (11) 00000-0004 ${OP}`
    const antes = c.snapshot(); await c.run(`/historicoarconte grupo ${G}`)
    assert.match(c.texto(), /identificador oculto/); assert.deepEqual(c.snapshot(), antes); c.semVazamento()
  })
  await teste('pendentes, operacao, resolver e revisoes usam referências e preservam auditoria', async () => {
    const c = await fixture(); await incerta(c); const antes = structuredClone(c.cols.eventos.docs[0])
    await c.run('/historicoarconte grupo #Swag pendentes'); const op = refOp(c), grupo = refGrupo(c)
    assert(op && grupo); assert(!c.texto().includes('TOKEN_CONTROLE_SECRETO')); c.semVazamento()
    await c.run(`/historicoarconte grupo ${grupo} operacao ${op}`); assert.match(c.texto(), /Estado original: incerta/)
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
    assert(c.envios[0].conteudo.text.includes('Expulsões confirmadas')); c.semVazamento()
  })
  await teste('perda de autorização durante consulta impede divulgação', async () => {
    const c = await fixture(); const ler = c.repo.historico
    c.repo.historico = async (...args) => { const r = await ler(...args); c.grupos[G].owner = pn(B); delete c.grupos[G].participants.find(p => p.id === pn(A)).admin; return r }
    await c.run('/historicoarconte grupo #Swag'); assert(!c.texto().includes('Expulsões confirmadas')); c.semVazamento()
  })
  await teste('falha da lista e metadados ausentes não autorizam busca por nome', async () => {
    const c = await fixture(); c.listaHook = () => { throw Error(`SEGREDO ${G}`) }
    await c.run('/historicoarconte grupo #Swag'); assert(!c.texto().includes('Expulsões confirmadas')); c.semVazamento()
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
  console.log(`${total} cenários de histórico por nome e privacidade passaram (offline).`)
}
main().catch(e => { console.error(e); process.exitCode = 1 })
