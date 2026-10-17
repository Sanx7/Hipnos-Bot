// Offline: bloco AFK extraído do bot.js, comando real e Mongo em memória.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm')
const { spawnSync } = require('node:child_process')
require('node:net').Socket.prototype.connect = function () { throw new Error('Rede proibida no teste offline') }
let afk = require('../afk')
const lid = require('../lid'), prefixoComandos = require('../prefixo')
const { prepararColecaoAfk, auditarAfk, nomesAfk } = require('../dados/afk-migracao')
const banco = require('./helpers/colecao-afk-fake')()
const col = banco.collection('afks_por_grupo'), legado = banco.collection('afks')
const A = '123@g.us', B = '456@g.us', N = '5511999990000', M = '5511888880000', K = '5511777770000'
const pn = n => `${n}@s.whatsapp.net`
const participantes = [{ id: '111@lid', phoneNumber: pn(N) }, { id: pn(M) }]
afk.__definirColecaoTeste(col)
lid.__definirConsultaSessaoTeste(async id => id === '222' ? M : null)
prefixoComandos.__definirPrefixoTeste('!')
const fonte = fs.readFileSync(require.resolve('../bot'), 'utf8')
const inicio = fonte.indexOf('      // 💤━━━━━━━━', fonte.indexOf('const podeInteragir ='))
const fim = fonte.indexOf('      // 💤━━━━━━━━', inicio + 25)
assert.ok(inicio >= 0 && fim > inicio)
const bloco = fonte.slice(inicio, fim)
let total = 0
async function teste(nome, fn) { await fn(); total++; console.log(`OK: ${nome}`) }
function contexto({ jid = A, sender = pn(K), text = 'oi', mencoes = [], reply, podeInteragir = true, falharMeta = false } = {}) {
  const envios = [], avisos = []
  const msg = { key: { remoteJid: jid, participant: jid.endsWith('@g.us') ? sender : undefined }, message: {
    extendedTextMessage: { text, contextInfo: { mentionedJid: mencoes, participant: reply } }
  } }
  const sock = { async groupMetadata() { if (falharMeta) throw new Error('Metadados offline'); return { participants: participantes } },
    async sendMessage(destino, c) { envios.push({ destino, ...c }) } }
  return { jid, sender, text, podeInteragir, msg, sock, envios, avisos, ...afk, prefixoComandos,
    console: { warn: () => avisos.push('falha'), log() {}, error: () => avisos.push('falha') } }
}
async function processar(opcoes) {
  const c = contexto(opcoes)
  await vm.runInNewContext(`(async () => { ${bloco}\n })()`, c)
  return c
}
async function ativar(jid, sender, motivo, opcoes = {}) {
  const c = contexto({ jid, sender, text: `!afk ${motivo}`, ...opcoes })
  delete require.cache[require.resolve('../comandos/afk')]
  await require('../comandos/afk').executar(c.sock, jid, c.msg, c.text)
  return c
}
async function main() {
  await teste('migração prepara índice composto e deixa todos os legados/índices intactos', async () => {
    legado.existe = true
    legado.docs.push({ numero: N, motivo: 'legado sem grupo', desde: 1000 }, { numero: M, grupo_id: A, motivo: 'grupo não comprovado', desde: 2000 })
    legado.indices.push({ name: 'idx_afks_numero', key: { numero: 1 }, unique: true })
    const antes = structuredClone({ docs: legado.docs, indices: legado.indices })
    const auditoria = await auditarAfk(banco, 'afks')
    assert.equal(auditoria.legados_pendentes, 2)
    assert.equal(auditoria.ativo.indices.length, 0, 'auditoria não cria coleção/índice')
    await prepararColecaoAfk(banco, 'afks'); await prepararColecaoAfk(banco, 'afks')
    assert.deepEqual({ docs: legado.docs, indices: legado.indices }, antes)
    assert.equal(col.indices.filter(i => i.name === 'idx_afks_grupo_numero').length, 1)
    assert.deepEqual(col.indices[1].key, { grupo_id: 1, numero: 1 })
    assert.equal(col.indices[1].unique, true)
    assert.equal((await afk.buscarVariosAfk(A, [N, M])).size, 0)
    assert.deepEqual(nomesAfk('afk_custom'), { legado: 'afk_custom', ativo: 'afk_custom_por_grupo' })
  })
  await teste('sem inferir grupo, usuário reativa apenas no grupo escolhido', async () => {
    await ativar(A, pn(N), 'estudando A')
    assert.equal((await afk.buscarAfk(A, N)).motivo, 'estudando A')
    assert.equal(await afk.buscarAfk(B, N), null)
    assert.equal(legado.docs[0].motivo, 'legado sem grupo')
  })
  await teste('mesmo usuário tem motivos e horários independentes em dois grupos', async () => {
    const a = await afk.buscarAfk(A, N)
    col.docs.find(d => d.grupo_id === A && d.numero === N).desde = a.desde - 60000
    await ativar(B, pn(N), 'dormindo B')
    const b = await afk.buscarAfk(B, N)
    assert.equal(b.motivo, 'dormindo B')
    assert.equal((await afk.buscarAfk(A, N)).motivo, 'estudando A')
    assert.notEqual((await afk.buscarAfk(A, N)).desde, b.desde)
  })
  await teste('mensagem no Grupo B só remove B e mantém A', async () => {
    const c = await processar({ jid: B, sender: pn(N), text: 'voltei' })
    assert.equal(await afk.buscarAfk(B, N), null)
    assert.ok(await afk.buscarAfk(A, N))
    assert.equal(c.envios.length, 1); assert.match(c.envios[0].text, /Bem-vindo/)
  })
  await teste('mensagem em outro grupo sem AFK não remove nem anuncia AFK de A', async () => {
    const c = await processar({ jid: B, sender: pn(N) })
    assert.equal(c.envios.length, 0); assert.ok(await afk.buscarAfk(A, N))
  })
  await teste('AFK privado independente e mensagens privadas preservam todos os grupos', async () => {
    await ativar(B, pn(N), 'B novamente')
    await ativar(pn(N), pn(N), 'ausente no privado')
    const c = await processar({ jid: pn(N), sender: pn(N) })
    assert.equal(await afk.buscarAfk(pn(N), N), null)
    assert.ok(await afk.buscarAfk(A, N)); assert.ok(await afk.buscarAfk(B, N))
    assert.equal(c.envios.length, 1)
    const aviso = await processar({ jid: pn(K), sender: pn(K), reply: pn(N) })
    assert.equal(aviso.envios.length, 0)
  })
  await teste('menções e replies consultam somente o motivo do grupo atual', async () => {
    for (const [jid, motivo] of [[A, 'estudando A'], [B, 'B novamente']]) {
      for (const alvo of [{ mencoes: [pn(N)] }, { reply: pn(N) }]) {
        const c = await processar({ jid, ...alvo })
        assert.equal(c.envios.length, 1); assert.ok(c.envios[0].text.includes(motivo))
        assert.ok(c.envios[0].mentions.includes(pn(N)))
      }
    }
  })
  await teste('menção a usuário AFK só em A não anuncia no grupo B', async () => {
    await afk.removerAfk(B, N)
    assert.equal((await processar({ jid: B, mencoes: [pn(N)] })).envios.length, 0)
    assert.equal((await processar({ jid: B, reply: pn(N) })).envios.length, 0)
  })
  await teste('múltiplos AFKs e menção/reply juntos usam uma consulta em lote e sem avisos repetidos', async () => {
    await afk.definirAfk(A, M, 'outro ausente')
    const antes = col.consultas.length
    const c = await processar({ mencoes: [pn(N), '111@lid'], reply: pn(M) })
    assert.equal(c.envios.length, 1)
    assert.equal((c.envios[0].text.match(/está ausente/g) || []).length, 2)
    const consultas = col.consultas.slice(antes).filter(q => q.operacao === 'find')
    assert.equal(consultas.length, 1); assert.equal(consultas[0].filtro.grupo_id, A)
  })
  await teste('comando e avisos por LID resolvem metadados e sessão para PN', async () => {
    await ativar(B, '111@lid', 'LID no B')
    assert.equal((await afk.buscarAfk(B, N)).motivo, 'LID no B')
    assert.equal(await afk.buscarAfk(B, '111'), null)
    assert.equal((await processar({ jid: B, mencoes: ['111@lid'] })).envios.length, 1)
    await ativar(B, '222@lid', 'mapeamento de sessão')
    assert.equal((await afk.buscarAfk(B, M)).motivo, 'mapeamento de sessão')
    assert.equal((await processar({ jid: B, reply: '222@lid' })).envios.length, 1)
  })
  await teste('retorno por LID remove apenas o AFK do grupo atual', async () => {
    await processar({ jid: B, sender: '111@lid' })
    assert.equal(await afk.buscarAfk(B, N), null); assert.ok(await afk.buscarAfk(A, N))
  })
  await teste('atualização !afk não produz retorno e preserva horário/motivo de outro grupo', async () => {
    const antigo = await afk.buscarAfk(A, N), b = await afk.definirAfk(B, N, 'B independente')
    const c = await processar({ sender: pn(N), text: '!afk novo motivo' })
    assert.equal(c.envios.length, 0); assert.deepEqual(await afk.buscarAfk(A, N), antigo)
    await ativar(A, pn(N), 'novo motivo A')
    assert.equal((await afk.buscarAfk(A, N)).motivo, 'novo motivo A')
    assert.ok((await afk.buscarAfk(A, N)).desde > antigo.desde)
    assert.deepEqual(await afk.buscarAfk(B, N), b)
  })
  await teste('LID sem resolução nunca colide com PN de mesmos dígitos', async () => {
    await afk.definirAfk(A, '999', 'PN diferente')
    const c = await ativar(A, '999@lid', 'não pode gravar')
    assert.match(c.envios[0].text, /comprovar/)
    assert.equal((await afk.buscarAfk(A, '999')).motivo, 'PN diferente')
    assert.equal((await processar({ sender: '999@lid', mencoes: ['999@lid'] })).envios.length, 0)
    assert.ok(await afk.buscarAfk(A, '999'))
  })
  await teste('falha de metadados ainda permite mapeamento de sessão sem cruzar grupo', async () => {
    await afk.definirAfk(A, M, 'A via sessão')
    const c = await processar({ sender: '222@lid', falharMeta: true })
    assert.equal(c.envios.length, 1); assert.equal(await afk.buscarAfk(A, M), null)
    assert.ok(await afk.buscarAfk(B, M))
  })
  await teste('AFK privado ativado por LID é removido por PN sem tocar no grupo', async () => {
    await ativar('222@lid', '222@lid', 'privado por LID')
    assert.equal((await afk.buscarAfk(pn(M), M)).motivo, 'privado por LID')
    const c = await processar({ jid: pn(M), sender: pn(M) })
    assert.equal(c.envios.length, 1)
    assert.equal(await afk.buscarAfk(pn(M), M), null)
    assert.ok(await afk.buscarAfk(B, M))
  })
  await teste('reinício recupera vários AFKs persistidos sem consultar a coleção legada', async () => {
    delete require.cache[require.resolve('../afk')]
    afk = require('../afk'); afk.__definirColecaoTeste(col)
    assert.equal((await afk.buscarAfk(A, N)).motivo, 'novo motivo A')
    assert.equal((await afk.buscarAfk(B, N)).motivo, 'B independente')
    assert.equal(legado.docs.length, 2)
    assert.ok(col.consultas.every(q => q.filtro.grupo_id))
  })
  await teste('OFF remove apenas no grupo atual sem enviar avisos', async () => {
    const c = await processar({ sender: pn(N), podeInteragir: false })
    assert.equal(c.envios.length, 0); assert.equal(await afk.buscarAfk(A, N), null)
    assert.ok(await afk.buscarAfk(B, N))
  })
  await teste('remoção concorrente e formatos antigos/novos do driver não anunciam retorno duplicado', async () => {
    for (const embrulhar of [true, false]) {
      col.embrulhar = embrulhar
      await afk.definirAfk(A, N, 'concorrência')
      const retornos = await Promise.all([processar({ sender: pn(N) }), processar({ sender: pn(N) })])
      assert.equal(retornos.reduce((s, c) => s + c.envios.length, 0), 1)
      assert.equal(await afk.removerAfk(A, N), null)
    }
  })
  await teste('motivo padrão e duração permanecem; API sem escopo não executa consultas globais', async () => {
    const d = await afk.definirAfk(A, N, '')
    assert.equal(d.motivo, afk.MOTIVO_PADRAO)
    assert.equal(afk.formatarDuracao(60000), '1 minuto')
    assert.equal(afk.formatarDuracao(0), 'menos de 1 minuto')
    for (const [ms, esperado] of [[5 * 60000, '5 minutos'], [130 * 60000, '2 horas e 10 minutos'], [27 * 3600000, '1 dia e 3 horas'], [3000, 'menos de 1 minuto'], [3600000, '1 hora']]) assert.equal(afk.formatarDuracao(ms), esperado)
    await ativar(A, pn(N), '')
    assert.equal((await afk.buscarAfk(A, N)).motivo, afk.MOTIVO_PADRAO)
    prefixoComandos.__definirPrefixoTeste('/')
    assert.equal((await processar({ sender: pn(N), text: '/afk' })).envios.length, 0)
    assert.ok(await afk.buscarAfk(A, N))
    prefixoComandos.__definirPrefixoTeste('!')
    await assert.rejects(afk.definirAfk(N, 'sem grupo'))
    await assert.rejects(afk.removerAfk(N))
    await assert.rejects(afk.buscarAfk(N))
    await assert.rejects(afk.buscarVariosAfk(null, [N]))
  })
  await teste('falha MongoDB preserva status e não escapa do bloco AFK', async () => {
    col.falhar = true
    const c = await processar({ sender: pn(N) })
    assert.equal(c.envios.length, 0); assert.equal(c.avisos.length, 1)
    col.falhar = false
    assert.ok(await afk.buscarAfk(A, N))
  })
  await teste('migração com duplicatas na coleção nova falha sem remover ou corrigir dados', async () => {
    const db = require('./helpers/colecao-afk-fake')(), atual = db.collection('afks_por_grupo')
    atual.docs.push({ grupo_id: A, numero: N }, { grupo_id: A, numero: N })
    const antes = structuredClone(atual.docs)
    await assert.rejects(prepararColecaoAfk(db, 'afks'), { code: 11000 })
    assert.deepEqual(atual.docs, antes)
  })
  await teste('ajuda do migrador é offline e não carrega credenciais ou conecta', () => {
    const r = spawnSync(process.execPath, [require.resolve('./migrar-afk-por-grupo'), '--help'], { encoding: 'utf8', env: { ...process.env, MONGODB_URI: '', MONGO_URI_RPG: '' } })
    assert.equal(r.status, 0); assert.match(r.stdout, /dry-run/)
  })
  console.log(`\n${total} cenários AFK por grupo passaram, sem serviços reais.`)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => { afk.__definirColecaoTeste(null); lid.__definirConsultaSessaoTeste(null) })
