process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
require('node:net').Socket.prototype.connect = function () { throw new Error('Rede proibida no teste offline') }
const r = require('../dados/reacoes-palavras')
const criarColecao = require('./helpers/colecao-reacoes-fake')
const { criarComandos } = require('../comandos/admin/emojis-palavras')
const { OWNER_NUMBERS } = require('../config')
const lid = require('../lid')
lid.__definirConsultaSessaoTeste(async () => null)
const G = '12345@g.us', H = '67890@g.us'
const adminTeste = { identidades: ['pn:5511999990002'], privilegiado: true }
// Fixtures de persistência operam como admin; testes de permissão usam a API
// real sem preencher autor automaticamente.
function repositorioTeste(colecao, agora) {
  const repo = r.criarRepositorio(colecao, agora)
  return { ...repo,
    registrar: (jid, termo, emoji) => repo.registrar(jid, termo, emoji, adminTeste),
    remover: (jid, termo) => repo.remover(jid, termo, adminTeste) }
}
let total = 0
async function teste(nome, fn) { await fn(); total++; console.log(`OK: ${nome}`) }
const registros = Object.freeze([{ termo: 'ana', emoji: '❤️' }, { termo: 'bom dia', emoji: '☀️' }, { termo: 'joão', emoji: '👋' }, { termo: 'ana maria', emoji: '😀' }])
async function main() {
  await teste('case, pontuação, nomes compostos e Unicode normalizado', () => {
    assert.equal(r.corresponder('Oi, ANA!', registros).emoji, '❤️')
    assert.equal(r.corresponder('BOM\nDIA!', registros).emoji, '☀️')
    assert.equal(r.corresponder('JOA\u0303O!', registros).emoji, '👋')
    assert.equal(r.corresponder('Ana Maria chegou', registros).emoji, '😀')
    assert.equal(r.corresponder('bom dia, Ana', registros).emoji, '☀️')
  })
  await teste('palavras inteiras, sem correspondência em nomes maiores/dígitos/underscore', () => {
    for (const t of ['banana', 'anabela', 'xana', 'ana1', '_ana', 'ana_', 'joãozinho', 'joao']) assert.equal(r.corresponder(t, registros), null, t)
    assert.equal(r.corresponder('ana-joão', registros).emoji, '❤️')
  })
  await teste('validação de termos, limites e rejeição de regex/injeção', () => {
    assert.equal(r.normalizarTermo('  BOM   DIA  '), 'bom dia')
    for (const t of ['', 'a.*', '$where', '<ana>', 'a'.repeat(61), 'a b c d e f', '😀', 'a\u0000b']) assert.throws(() => r.normalizarTermo(t))
    assert.equal(r.corresponder('a'.repeat(r.MAX_TEXTO + 1), registros), null)
  })
  await teste('emoji único: compostos, modificadores, bandeiras e keycaps', () => {
    for (const e of ['😀', '❤️', '👍🏽', '👨‍👩‍👧‍👦', '🇧🇷', '1️⃣', '☀️']) assert.equal(r.validarEmoji(e), e)
    for (const e of ['', 'ok', '1', '🇧', '😀😀', '🏽', '😀 oi']) assert.throws(() => r.validarEmoji(e))
  })
  const col = criarColecao(), repo = repositorioTeste(async () => col)
  await teste('persistência por JID, isolamento, atualização e remoção normalizada', async () => {
    col.docs.set(G, { grupo_id: G, welcome: true, ia_interativa: true, banner_customizado: 'preservado' })
    await repo.registrar(G, 'ANA', '😀'); await repo.registrar(H, 'ana', '🌙')
    await repo.registrar(G, 'Ana', '❤️')
    assert.deepEqual(await repo.obter(G), [{ termo: 'ana', emoji: '❤️', criador: adminTeste.identidades[0] }])
    assert.deepEqual(await repo.obter(H), [{ termo: 'ana', emoji: '🌙', criador: adminTeste.identidades[0] }])
    assert.equal(await repo.remover(G, 'ANA'), true)
    assert.equal(await repo.remover(G, 'ana'), false)
    assert.equal((await repo.obter(H)).length, 1)
    assert.equal(col.docs.get(G).welcome, true)
    assert.equal(col.docs.get(G).ia_interativa, true)
    assert.equal(col.docs.get(G).banner_customizado, 'preservado')
    assert.equal((await r.criarRepositorio(async () => col).obter(H))[0].emoji, '🌙')
  })
  await teste('limite atômico e cadastros concorrentes sem perda de registros', async () => {
    for (let i = 0; i < 49; i++) await repo.registrar(G, `termo${i}`, '😀')
    const resultados = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => repo.registrar(G, `novo${i}`, '👋')))
    assert.equal(resultados.filter(x => x.status === 'fulfilled').length, 1)
    assert.equal((await repo.obter(G, true)).length, 50)
    await repo.registrar(G, 'termo0', '🌙')
    assert.equal((await repo.obter(G)).find(x => x.termo === 'termo0').emoji, '🌙')
    const outra = repositorioTeste(async () => col)
    await Promise.all([repo.registrar(H, 'b', '😀'), outra.registrar(H, 'c', '👋')])
    assert.deepEqual((await repo.obter(H, true)).map(x => x.termo).sort(), ['ana', 'b', 'c'])
  })
  await teste('cache, leituras coalescidas, invalidação e indisponibilidade do banco', async () => {
    let agora = 1000
    const cache = repositorioTeste(async () => col, () => agora)
    const inicio = col.leituras
    await Promise.all([cache.obter(H), cache.obter(H), cache.obter(H)])
    assert.equal(col.leituras - inicio, 1)
    await cache.obter(H); assert.equal(col.leituras - inicio, 1)
    await cache.remover(H, 'b'); assert.equal((await cache.obter(H)).length, 2)
    col.falhar = true; agora += 31000
    await assert.rejects(cache.obter(H))
    await assert.rejects(cache.registrar(H, 'erro', '😀'))
    col.falhar = false; agora += 11000
    assert.equal((await cache.obter(H)).length, 2)
    await assert.rejects(cache.obter('privado@s.whatsapp.net'))
  })
  await teste('documento corrompido não gera reação nem permite sobrescrita', async () => {
    const quebrada = criarColecao()
    quebrada.docs.set(G, { grupo_id: G, reacoes_palavras: [{ termo: 'ana', emoji: 'texto inválido' }] })
    const q = repositorioTeste(async () => quebrada)
    await assert.rejects(q.obter(G)); await assert.rejects(q.registrar(G, 'ana', '😀'))
  })

  const dono = '5511999990001', admin = '5511999990002', membro = '5511999990003'
  const originais = [...OWNER_NUMBERS]; OWNER_NUMBERS.push(dono)
  try {
    const permissoesCol = criarColecao()
    const permissoesRepo = r.criarRepositorio(async () => permissoesCol)
    const comandos = criarComandos(permissoesRepo)
    const envios = []
    let falharMeta = false
    const participantes = [{ id: `${admin}@s.whatsapp.net`, lid: '123@lid', admin: 'admin' },
      { id: `${membro}@s.whatsapp.net`, lid: '456@lid' }, { id: '5511999990004@s.whatsapp.net' }, { id: '789@lid' }, { id: '789@s.whatsapp.net' }]
    const sock = { sendMessage: async (jid, c) => envios.push(c), groupMetadata: async () => {
      if (falharMeta) throw new Error('Sem metadados')
      return { participants: participantes }
    } }
    const executar = (nome, autor, texto, jid = G) => comandos.find(c => c.nome === nome).executar(sock, jid, { key: { remoteJid: jid, participant: autor } }, texto)
    await teste('qualquer membro cadastra, criador é persistido e lista é pública', async () => {
      await executar('emojiregistrar', `${membro}@s.whatsapp.net`, '/emojiregistrar ana 😀')
      assert.deepEqual(await permissoesRepo.obter(G), [{ termo: 'ana', emoji: '😀', criador: `pn:${membro}` }])
      await executar('emojilista', `${membro}@s.whatsapp.net`, '/emojilista')
      assert.match(envios.at(-1).text, /ana → 😀/)
      await executar('emojiregistrar', `${dono}@s.whatsapp.net`, '/emojiregistrar ana 😀', `${membro}@s.whatsapp.net`)
      assert.equal(permissoesCol.docs.size, 1)
    })
    await teste('terceiros não atualizam/removem, mesmo após leitura em cache', async () => {
      await permissoesRepo.obter(G)
      for (const [nome, texto] of [['emojiregistrar', '/emojiregistrar ana 👋'], ['emojiremover', '/emojiremover ana']]) {
        await executar(nome, '5511999990004@s.whatsapp.net', texto)
        assert.match(envios.at(-1).text, /Somente quem criou/)
      }
      assert.equal((await permissoesRepo.obter(G))[0].emoji, '😀')
    })
    await teste('criador atualiza por LID comprovado e remove por PN', async () => {
      await executar('emojiregistrar', '456@lid', '!emojiregistrar ana ❤️')
      assert.equal((await permissoesRepo.obter(G))[0].emoji, '❤️')
      assert.equal((await permissoesRepo.obter(G))[0].criador, `pn:${membro}`)
      participantes.push({ id: `${membro}@s.whatsapp.net`, lid: '999@lid' })
      await executar('emojiregistrar', '456@lid', '!emojiregistrar ana 🌙')
      assert.match(envios.at(-1).text, /Somente quem criou/)
      participantes.pop()
      await executar('emojiremover', `${membro}@s.whatsapp.net`, '!emojiremover ana')
      assert.equal((await permissoesRepo.obter(G)).length, 0)
    })
    await teste('admin PN/LID e dono podem cadastrar/remover com prefixo dinâmico', async () => {
      await executar('emojiregistrar', `${membro}@s.whatsapp.net`, '!emojiregistrar Ana Maria 😀')
      await executar('emojiregistrar', '123@lid', '!emojiregistrar Ana Maria 👋')
      assert.equal((await permissoesRepo.obter(G))[0].criador, `pn:${membro}`)
      await executar('emojiremover', `${dono}@s.whatsapp.net`, '!emojiremover Ana Maria')
      await executar('emojiregistrar', `${dono}@s.whatsapp.net`, '!emojiregistrar ana ❤️')
      assert.equal((await permissoesRepo.obter(G))[0].criador, `pn:${dono}`)
      await executar('emojiremover', `${admin}@s.whatsapp.net`, '!emojiremover ana')
      assert.equal((await permissoesRepo.obter(G)).length, 0)
    })
    await teste('legado sem criador só aceita admin/dono e não ganha autoria presumida', async () => {
      permissoesCol.docs.set(H, { grupo_id: H, reacoes_palavras: [{ termo: 'legado', emoji: '😀' }] })
      for (const [nome, texto] of [['emojiregistrar', '/emojiregistrar legado 👋'], ['emojiremover', '/emojiremover legado']]) {
        await executar(nome, `${membro}@s.whatsapp.net`, texto, H)
        assert.match(envios.at(-1).text, /Somente quem criou/)
      }
      await executar('emojiregistrar', '123@lid', '/emojiregistrar legado 🌙', H)
      assert.deepEqual(await permissoesRepo.obter(H), [{ termo: 'legado', emoji: '🌙' }])
      await executar('emojiremover', `${dono}@s.whatsapp.net`, '/emojiremover legado', H)
      assert.equal((await permissoesRepo.obter(H)).length, 0)
    })
    await teste('membro LID sem telefone mantém namespace e não confunde PN de mesmos dígitos', async () => {
      await executar('emojiregistrar', '789@lid', '/emojiregistrar lua 🌙')
      assert.equal((await permissoesRepo.obter(G))[0].criador, 'lid:789')
      await executar('emojiregistrar', '789@s.whatsapp.net', '/emojiregistrar lua 😀')
      assert.match(envios.at(-1).text, /Somente quem criou/)
      participantes[2].lid = '789@lid'
      await executar('emojiregistrar', '5511999990004@s.whatsapp.net', '/emojiregistrar lua 😀')
      assert.match(envios.at(-1).text, /Somente quem criou/)
      delete participantes[2].lid
      await executar('emojiregistrar', '789@lid', '/emojiregistrar lua 👋')
      assert.equal((await permissoesRepo.obter(G))[0].emoji, '👋')
      // Associação PN/LID fornecida pelos metadados permite reconhecer a autoria antiga.
      participantes[3] = { id: '5511999990005@s.whatsapp.net', lid: '789@lid' }
      await executar('emojiremover', '5511999990005@s.whatsapp.net', '/emojiremover lua')
      assert.equal((await permissoesRepo.obter(G)).length, 0)
    })
    await teste('LID sem prova, metadados indisponíveis e entrada inválida não escrevem', async () => {
      const escritas = permissoesCol.escritas
      await executar('emojiregistrar', `${dono}@lid`, '/emojiregistrar ana 😀')
      falharMeta = true
      await executar('emojiremover', `${admin}@s.whatsapp.net`, '/emojiremover ana')
      falharMeta = false
      await executar('emojiregistrar', `${admin}@s.whatsapp.net`, '/emojiregistrar ana texto')
      await executar('emojiregistrar', `${admin}@s.whatsapp.net`, '/emojiregistrar a.* 😀')
      assert.equal(permissoesCol.escritas, escritas)
      await executar('emojiregistrar', '5511000000000@s.whatsapp.net', '/emojiregistrar estranho 😀')
      assert.equal(permissoesCol.escritas, escritas)
    })
  } finally { OWNER_NUMBERS.splice(0, OWNER_NUMBERS.length, ...originais) }

  await teste('autor obrigatório e concorrência não permite tomar cadastro de outro criador', async () => {
    const c = criarColecao(), p = r.criarRepositorio(async () => c)
    const a = { identidades: ['pn:5511999990003'], privilegiado: false }
    const b = { identidades: ['pn:5511999990004'], privilegiado: false }
    await assert.rejects(p.registrar(G, 'ana', '😀'))
    const resultados = await Promise.allSettled([p.registrar(G, 'ana', '😀', a), p.registrar(G, 'ana', '👋', b)])
    assert.equal(resultados.filter(x => x.status === 'fulfilled').length, 1)
    assert.equal(resultados.find(x => x.status === 'rejected').reason.code, 'REACAO_NAO_AUTORIZADA')
    assert.equal((await p.obter(G))[0].criador, a.identidades[0])
    // Simula remoção/recriação por outro autor entre a leitura e a escrita CAS.
    const update = c.updateOne
    let conflito = false
    c.updateOne = async (filtro, mudanca, opcoes) => {
      if (!conflito && filtro.reacoes_versao !== undefined) {
        conflito = true
        const doc = c.docs.get(G)
        doc.reacoes_palavras = [{ termo: 'ana', emoji: '🌙', criador: b.identidades[0] }]
        doc.reacoes_versao++
      }
      return update(filtro, mudanca, opcoes)
    }
    await assert.rejects(p.registrar(G, 'ana', '❤️', a), { code: 'REACAO_NAO_AUTORIZADA' })
    assert.equal((await p.obter(G, true))[0].emoji, '🌙')
    await assert.rejects(p.remover(G, 'ana', a), { code: 'REACAO_NAO_AUTORIZADA' })
  })

  let agora = 1700000000000, aberta = true
  const envios = []
  const sock = { sendMessage: async (jid, conteudo) => envios.push({ jid, conteudo }) }
  const processador = r.criarProcessador({ repositorio: { obter: async jid => jid === G ? registros : [{ termo: 'ana', emoji: '🌙' }] }, agora: () => agora, disponivel: () => aberta })
  const msg = (id, jid = G) => ({ key: { remoteJid: jid, id, participant: '5511999990002@s.whatsapp.net', fromMe: false }, message: { conversation: 'Ana' }, messageTimestamp: agora / 1000 })
  const ctx = { tipo: 'notify', texto: 'Ana', nomeComando: null }
  await teste('reação Baileys aponta para a mensagem original; no máximo uma correspondência', async () => {
    const m = msg('um')
    assert.equal(await processador.processar(sock, m, { ...ctx, texto: 'ana e bom dia' }), true)
    assert.deepEqual(envios[0], { jid: G, conteudo: { react: { text: '❤️', key: m.key } } })
  })
  await teste('duplicata, replay e cooldown não reenviam; isolamento também no envio', async () => {
    assert.equal(await processador.processar(sock, msg('um'), ctx), false)
    assert.equal(await processador.processar(sock, msg('dois'), ctx), false)
    agora += 1100
    assert.equal(await processador.processar(sock, msg('um'), ctx), false)
    assert.equal(await processador.processar(sock, msg('um', H), ctx), true)
    assert.equal(envios.at(-1).conteudo.react.text, '🌙')
  })
  await teste('ignora bot, comandos, histórico, mensagens vazias/sem texto/antigas e privados', async () => {
    agora += 1100
    const antes = envios.length
    for (const [m, c] of [
      [{ ...msg('bot'), key: { ...msg('bot').key, fromMe: true } }, ctx],
      [msg('cmd'), { ...ctx, nomeComando: 'ana' }], [msg('slash'), { ...ctx, nomeComando: '' }],
      [msg('historico'), { ...ctx, tipo: 'append' }], [msg('vazio'), { ...ctx, texto: '' }],
      [{ key: msg('sem-midia').key }, ctx], [msg('privado', '5511999990002@s.whatsapp.net'), ctx],
      [{ ...msg('antigo'), messageTimestamp: agora / 1000 - 121 }, ctx],
      [msg('longo'), { ...ctx, texto: 'a'.repeat(4097) }]
    ]) assert.equal(await processador.processar(sock, m, c), false)
    assert.equal(envios.length, antes)
  })
  await teste('falha Baileys não derruba nem repete resultado incerto', async () => {
    let tentativas = 0
    const falha = { sendMessage: async () => { tentativas++; throw new Error('Falha de transporte') } }
    const m = msg('incerto')
    assert.equal(await processador.processar(falha, m, ctx), false)
    agora += 1100
    assert.equal(await processador.processar(falha, m, ctx), false)
    assert.equal(tentativas, 1)
  })
  await teste('falha MongoDB e perda de socket impedem envio', async () => {
    const p = r.criarProcessador({ repositorio: { obter: async () => { throw new Error('Mongo indisponível') } }, agora: () => agora, disponivel: () => true })
    assert.equal(await p.processar(sock, msg('mongo'), ctx), false)
    aberta = false
    assert.equal(await processador.processar(sock, msg('fechado'), ctx), false)
    aberta = true
  })
  await teste('eventos concorrentes não duplicam; perda de socket após consulta impede reação', async () => {
    let liberar
    const leitura = new Promise(resolve => { liberar = resolve })
    const p = r.criarProcessador({ repositorio: { obter: () => leitura }, agora: () => agora, disponivel: () => aberta })
    const m = msg('concorrente')
    const pendente = p.processar(sock, m, ctx)
    assert.equal(await p.processar(sock, m, ctx), false)
    aberta = false; liberar(registros)
    assert.equal(await pendente, false)
    aberta = true
    const a = p.processar(sock, msg('ok'), ctx), b = p.processar(sock, msg('ok'), ctx)
    assert.deepEqual(await Promise.all([a, b]), [true, false])
  })
  await teste('repositório padrão reutiliza a coleção de configurações sem nova conexão', async () => {
    const config = require('../configuracoes-grupo')
    config.__definirColecaoTeste(col)
    try { assert.equal((await r.repositorio.obter(H, true)).length, 2) }
    finally { config.__definirColecaoTeste(null) }
  })
  console.log(`\n${total} cenários de reações passaram.`)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => lid.__definirConsultaSessaoTeste(null))
