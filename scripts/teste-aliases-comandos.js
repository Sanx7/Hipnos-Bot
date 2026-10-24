const { carregarComandosReais, verificarMenu } = require('./helpers/menu-catalogo-teste')
const assert = require('node:assert/strict')
const { comandos, fontes, conflitos } = carregarComandosReais()
let total = 0
async function teste(nome, fn) { await fn(); total++; console.log(`OK: ${nome}`) }
async function main() {
  await teste('auditoria enumera todos os 16 conflitos conhecidos e bloqueia colisões novas', () => {
    assert.deepEqual(conflitos.map(c => c.rota).sort(), ['arrancarcalcinha','beijogostoso','beijolesbico','blow2','encerrar-enquete','flip','gay','meme','menu-adulto','meuslembretes','morder','mordida','pgpeito2','pgpeito3','soco','tapa'].sort())
    assert.equal(conflitos.filter(c => c.mesmoObjeto).length, 7)
    for (const c of conflitos.filter(c => c.mesmoObjeto)) assert.equal(c.vencedor, c.candidatos[0].cmd)
  })
  await teste('todos os registros apontam para módulos reais, sem sobrescritas desconhecidas', () => {
    for (const [, cmd] of comandos) assert.ok(fontes.some(f => f.cmd === cmd))
    for (const { cmd } of fontes) {
      // Encerramento de decisão é delegado pelo encerramento unificado existente.
      if (cmd === require('../comandos/admin/enquete-admin')[1]) continue
      assert.ok([cmd.nome, ...(cmd.aliases || [])].some(r => comandos.get(r) === cmd), `Implementação inacessível: ${cmd.nome}`)
    }
  })
  await teste('porcentagem ganha acesso exclusivo sem substituir /gay de imagem', () => {
    const antigo = require('../comandos/menu-brincadeiras/aleatorios').find(c => c.nome === 'gay')
    assert.equal(comandos.get('gayporcentagem'), antigo)
    assert.equal(comandos.get('gay'), require('../comandos/menu-efeitos/efeitos-imagem').find(c => c.nome === 'gay'))
  })
  await teste('acesso alternativo de brincadeira não recebe o rótulo reservado a adultos', async () => {
    const paginas = await verificarMenu('brincadeiras', ['gayporcentagem'])
    assert.ok(paginas.some(t => t.includes('*!gayporcentagem*')))
    assert.ok(paginas.every(t => !t.includes('(gay adulto)')))
    const entradas = require('../dados/menus-olimpo').entradas('brincadeiras')
    assert.equal(entradas.find(c => c.acesso === 'gayporcentagem').nome, 'gay')
  })
  for (const p of ['/', '!', '#']) {
    await teste(`todos os nomes e aliases do registro são resolvidos com ${p}`, () => {
      const prefixo = require('../prefixo')
      prefixo.__definirPrefixoTeste(p)
      for (const [rota, cmd] of comandos) {
        assert.equal(comandos.get(prefixo.resolverNomeComando(`${p}${rota} argumento`)), cmd)
      }
    })
    await teste(`execução de ${p}gayporcentagem usa a brincadeira e preserva a chave diária gay`, async () => {
      const aleatorios = require('../comandos/menu-brincadeiras/aleatorios'), envios = [], registros = []
      aleatorios.__definirColecaoTeste({
        async findOne() { return null },
        async updateOne(filtro) { registros.push(filtro); return { acknowledged: true, upsertedCount: 1 } }
      })
      try {
        const msg = { key: { remoteJid: '000000000000@g.us', participant: '000000000002@s.whatsapp.net' }, pushName: 'Participante fictício' }
        await comandos.get('gayporcentagem').executar({ sendMessage: async (_jid, corpo) => envios.push(corpo) }, msg.key.remoteJid, msg, `${p}gayporcentagem`)
        assert.equal(envios.length, 1); assert.equal(typeof envios[0].text, 'string')
        assert.equal(registros.length, 1); assert.equal(registros[0].comando, 'gay')
      } finally { aleatorios.__definirColecaoTeste(null) }
    })
  }
  for (const [rota, origem, nome] of [
    ['tapa','../comandos/menu-brincadeiras/acoes','tapa'], ['soco','../comandos/menu-brincadeiras/acoes','soco'],
    ['mordida','../comandos/menu-brincadeiras/acoes','mordida'], ['morder','../comandos/menu-adulto/comandos-adulto','morder'],
    ['bater','../comandos/menu-adulto/comandos-adulto','tapa'], ['murro','../comandos/menu-adulto/comandos-adulto','soco'],
    ['flip','../comandos/menu-brincadeiras/flip','flip'], ['espelhar','../comandos/menu-efeitos/efeitos-imagem','espelhar'],
    ['meme','../comandos/menu-utilitario/meme','meme'], ['explicarmeme','../comandos/menu-utilitario/explicarmeme','explicarmeme']
  ]) await teste(`compatibilidade preservada em /${rota}`, () => {
    const modulo = require(origem), cmd = Array.isArray(modulo) ? modulo.find(c => c.nome === nome) : modulo
    assert.equal(comandos.get(rota), cmd)
  })
  await teste('lembretes e encerramento preservam vencedores e acessos alternativos', () => {
    assert.equal(comandos.get('meuslembretes'), require('../comandos/meuslembretes'))
    assert.equal(comandos.get('meus-lembretes'), require('../comandos/menu-utilitario/meuslembretes'))
    assert.equal(comandos.get('encerrar-enquete'), require('../comandos/menu-brincadeiras/enquete')[1])
  })
  for (const { categoria } of require('../dados/menus-catalogo').portais) await teste(`catálogo, aliases e todas as páginas de ${categoria}`, async () => {
    await verificarMenu(categoria)
  })
  console.log(`${total} testes de aliases passaram (offline).`)
}
main().catch(e => { console.error(e); process.exitCode = 1 })
