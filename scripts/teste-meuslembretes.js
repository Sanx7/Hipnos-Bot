// Offline: coleção somente leitura e metadados controlados.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const banco = require('../lembretes')
const comandos = [require('../comandos/meuslembretes'), require('../comandos/menu-utilitario/meuslembretes')]
const { criarConsultaMetadados } = require('../dados/destinos-lembretes')
const NUM = '5511000000001', LID = '90001@lid'
const PRIVADO = `${NUM}@s.whatsapp.net`, GRUPO = '120363412431500468@g.us', OUTRO = '120363412431500469@g.us'
const HORA = Date.UTC(2026, 9, 8, 23, 30)
let passou = 0
function preparar(docs, metadados = {}) {
  const consultas = [], envios = [], leituras = []
  banco.__definirColecaoTeste({
    find(filtro) {
      leituras.push({ filtro })
      let ordenacao, limite
      return {
        sort(ordem) { ordenacao = ordem; leituras.at(-1).ordem = ordem; return this },
        limit(valor) { limite = valor; leituras.at(-1).limite = valor; return this },
        async toArray() {
          assert.deepEqual(ordenacao, { disparar_em: 1 })
          return docs.filter(doc => doc.numero === filtro.numero && doc.enviado === filtro.enviado)
            .sort((a, b) => a.disparar_em - b.disparar_em).slice(0, limite)
        }
      }
    },
    insertOne() { throw new Error('Listagem não pode gravar lembretes') },
    updateOne() { throw new Error('Listagem não pode alterar lembretes') },
    deleteOne() { throw new Error('Listagem não pode apagar lembretes') }
  })
  const sock = {
    async groupMetadata(jid) {
      consultas.push(jid)
      const meta = metadados[jid]
      if (meta instanceof Error) throw meta
      return meta
    },
    async sendMessage(jid, payload) { envios.push({ jid, ...payload }) }
  }
  return { sock, consultas, envios, leituras, texto: () => envios.at(-1)?.text || '' }
}
const doc = (texto, grupo_id = GRUPO, disparar_em = HORA, numero = NUM) => ({ numero, grupo_id, texto, disparar_em, enviado: false })
const msg = (sender = PRIVADO, jid = PRIVADO) => ({ key: { remoteJid: jid, participant: jid.endsWith('@g.us') ? sender : undefined } })
function semJid(texto) { assert.doesNotMatch(texto, /\d+@g\.us/) }
async function teste(nome, fn) {
  await fn(); passou++; console.log(`PASSOU: ${nome}`)
}
async function main() {
  for (const [indice, comando] of comandos.entries()) {
    const impl = indice === 0 ? 'principal' : 'utilitário'
    await teste(`${impl}: grupo com nome real, inclusive no próprio grupo`, async () => {
      const c = preparar([doc('Reunião')], { [GRUPO]: { subject: 'Swag #Nova geração', participants: [] } })
      await comando.executar(c.sock, GRUPO, msg(PRIVADO, GRUPO))
      assert.match(c.texto(), /👥 Grupo: Swag #Nova geração/)
      assert.match(c.texto(), /Reunião/); semJid(c.texto())
      assert.deepEqual(c.consultas, [GRUPO])
    })
    await teste(`${impl}: vários lembretes do mesmo grupo consultam uma vez`, async () => {
      const c = preparar([doc('Primeiro'), doc('Segundo', GRUPO, HORA + 60000), doc('Terceiro', OUTRO)], {
        [GRUPO]: { subject: 'Grupo A' }, [OUTRO]: { subject: 'Grupo B' }
      })
      await comando.executar(c.sock, PRIVADO, msg())
      assert.equal(c.consultas.filter(jid => jid === GRUPO).length, 1)
      assert.equal(c.consultas.filter(jid => jid === OUTRO).length, 1)
      assert.equal((c.texto().match(/👥 Grupo: Grupo A/g) || []).length, 2)
      assert.match(c.texto(), /👥 Grupo: Grupo B/); semJid(c.texto())
    })
    await teste(`${impl}: nome vem do cache já consultado para resolução LID`, async () => {
      const c = preparar([doc('A'), doc('B')], {
        [GRUPO]: { subject: 'Grupo em cache', participants: [{ id: LID, phoneNumber: PRIVADO }] }
      })
      await comando.executar(c.sock, GRUPO, msg(LID, GRUPO))
      assert.deepEqual(c.consultas, [GRUPO])
      assert.equal(c.leituras[0].filtro.numero, NUM)
      assert.match(c.texto(), /👥 Grupo: Grupo em cache/); semJid(c.texto())
    })
    await teste(`${impl}: grupo inacessível não expõe JID nem interrompe outros itens`, async () => {
      const c = preparar([doc('Inacessível'), doc('Disponível', OUTRO)], {
        [GRUPO]: new Error('Sem acesso'), [OUTRO]: { subject: 'Acessível' }
      })
      await comando.executar(c.sock, PRIVADO, msg())
      assert.match(c.texto(), /👥 Grupo indisponível/)
      assert.match(c.texto(), /Disponível/); assert.match(c.texto(), /👥 Grupo: Acessível/)
      semJid(c.texto())
    })
    await teste(`${impl}: falha dos metadados fica em cache durante a listagem`, async () => {
      const c = preparar([doc('A'), doc('B')], { [GRUPO]: new Error('Falha de rede') })
      await comando.executar(c.sock, PRIVADO, msg())
      assert.deepEqual(c.consultas, [GRUPO])
      assert.equal((c.texto().match(/Grupo indisponível/g) || []).length, 2)
      semJid(c.texto())
    })
    await teste(`${impl}: nome ausente também mostra grupo indisponível`, async () => {
      const c = preparar([doc('Sem nome')], { [GRUPO]: { subject: '  ' } })
      await comando.executar(c.sock, PRIVADO, msg())
      assert.match(c.texto(), /Grupo indisponível/); semJid(c.texto())
    })
    await teste(`${impl}: lembrete privado não consulta grupo`, async () => {
      const c = preparar([doc('Beber água', null)])
      await comando.executar(c.sock, PRIVADO, msg())
      assert.match(c.texto(), /💬 Conversa privada/)
      assert.deepEqual(c.consultas, []); semJid(c.texto())
    })
    await teste(`${impl}: preserva limite, índices, horário, texto, usuário e dados`, async () => {
      const docs = Array.from({ length: 12 }, (_, i) => doc(`Item ${i + 1}`, null, HORA + i * 60000)).reverse()
      docs.push(doc('Outro usuário', null, HORA, '5511999999999'))
      docs.push({ ...doc('Já enviado', null), enviado: true })
      const antes = structuredClone(docs)
      const c = preparar(docs)
      await comando.executar(c.sock, PRIVADO, msg())
      assert.deepEqual(c.leituras[0].filtro, { numero: NUM, enviado: false })
      assert.equal(c.leituras[0].limite, banco.MAX_LEMBRETES_ATIVOS)
      assert.match(c.texto(), /1\.\*? 📝 Item 1\n/)
      assert.match(c.texto(), /10\.\*? 📝 Item 10\n/)
      assert.doesNotMatch(c.texto(), /Item 11|Item 12|Outro usuário|Já enviado/)
      assert.ok(c.texto().includes(banco.formatarDataHora(HORA)))
      assert.match(c.texto(), /20:30/)
      assert.deepEqual(docs, antes)
      assert.equal(c.envios.length, 1)
    })
    await teste(`${impl}: lista vazia preserva aviso e não busca metadados`, async () => {
      const c = preparar([])
      await comando.executar(c.sock, PRIVADO, msg())
      assert.match(c.texto(), /(?:Nenhum lembrete|não tem lembretes)/)
      assert.deepEqual(c.consultas, [])
    })
  }
  await teste('Cache compartilha requisições concorrentes e renova por listagem', async () => {
    const c = preparar([], { [GRUPO]: { subject: 'Atual' } })
    const consulta = criarConsultaMetadados(c.sock)
    const [a, b] = await Promise.all([consulta(GRUPO), consulta(GRUPO)])
    assert.equal(a, b); assert.deepEqual(c.consultas, [GRUPO])
    await criarConsultaMetadados(c.sock)(GRUPO)
    assert.deepEqual(c.consultas, [GRUPO, GRUPO])
  })
  console.log(`\n${passou} testes passaram.`)
}
main().catch(erro => { console.error(erro); process.exitCode = 1 })
