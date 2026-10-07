// 🧪 SMOKE TEST OFFLINE do sistema de packs (sem Mongo/WhatsApp).
// Uso: node scripts/smoke-packs.js

function criarColecaoFake() {
  const docs = []
  const casa = (d, filtro) => Object.entries(filtro || {}).every(([k, v]) => d[k] === v)
  const ordenar = (lista, sort) => {
    const chaves = Object.entries(sort || {})
    if (!chaves.length) return lista
    return [...lista].sort((a, b) => {
      for (const [chave, direcao] of chaves) {
        const va = a[chave] ?? 0
        const vb = b[chave] ?? 0
        if (va < vb) return direcao === 1 ? -1 : 1
        if (va > vb) return direcao === 1 ? 1 : -1
      }
      return 0
    })
  }
  const cursorDe = (lista) => ({
    sort(spec) { return cursorDe(ordenar(lista, spec)) },
    skip(n) { return cursorDe(lista.slice(n)) },
    limit(n) { return cursorDe(lista.slice(0, n)) },
    async toArray() { return lista.map((d) => ({ ...d })) }
  })
  return {
    async createIndex() {},
    async insertOne(doc) { docs.push({ ...doc }) },
    async findOne(f) { return docs.find((d) => casa(d, f)) || null },
    find(f) { return cursorDe(docs.filter((d) => casa(d, f))) },
    async countDocuments(f) { return docs.filter((d) => casa(d, f)).length },
    async updateOne(f, update) {
      const doc = docs.find((d) => casa(d, f))
      if (!doc) return
      if (update.$set) Object.assign(doc, update.$set)
      if (update.$push) {
        const entradas = Object.entries(update.$push)
        for (let i = 0; i < entradas.length; i += 1) {
          const k = entradas[i][0]
          const v = entradas[i][1]
          if (!Array.isArray(doc[k])) doc[k] = []
          doc[k].push(v)
        }
      }
    },
    async deleteOne(f) {
      const i = docs.findIndex((d) => casa(d, f))
      if (i >= 0) docs.splice(i, 1)
    }
  }
}

async function main() {
  const packs = require('../packs-figurinha')
  packs.__definirColecaoTeste(criarColecaoFake())

  let passou = 0
  let falhou = 0
  const checar = (rotulo, cond) => {
    if (cond) { passou += 1; console.log(`✅ ${rotulo}`) }
    else { falhou += 1; console.error(`❌ ${rotulo}`) }
  }

  checar('nucleo carrega', typeof packs.criarPack === 'function')
  checar('validarNome rejeita vazio', packs.validarNome('').ok === false)
  checar('validarNome rejeita longo', packs.validarNome('x'.repeat(31)).ok === false)
  checar('nome_key ignora acento/caixa', packs.normalizarNomeKey('Memês DO Limbo') === 'memes do limbo')

  const donoA = '5511999999999'
  const c1 = await packs.criarPack({ nome: 'Pack 1', descricao: 'só os clássicos', dono: donoA, dono_nome: 'Sanx', grupo_origem: 'g@g.us' })
  checar('criarPack ok', c1.ok === true && c1.pack.nome === 'Pack 1')
  checar('criarPack rejeita duplicata', (await packs.criarPack({ nome: 'PACK 1', descricao: '', dono: '5511888888888', dono_nome: '', grupo_origem: '' })).ok === false)
  for (let i = 2; i <= 5; i += 1) {
    await packs.criarPack({ nome: `Pack ${i}`, descricao: '', dono: donoA, dono_nome: '', grupo_origem: '' })
  }
  checar('criarPack respeita teto de 5 por dono', (await packs.criarPack({ nome: 'Pack 6', descricao: '', dono: donoA, dono_nome: '', grupo_origem: '' })).ok === false)

  const webp = Buffer.from('RIFFxxxxWEBP', 'utf8')
  checar('addfig ok', (await packs.adicionarFigurinha('Pack 1', webp)).ok === true)
  checar('addfig rejeita >1MB', (await packs.adicionarFigurinha('Pack 1', Buffer.alloc(1024 * 1024 + 1))).ok === false)

  const d1 = await packs.denunciarPack('Pack 1', '5511000000001', 'spam')
  checar('denuncia conta 1', d1.ok === true && d1.denuncias === 1 && d1.suspenso === false)
  checar('denuncia ignora voto duplo', (await packs.denunciarPack('Pack 1', '5511000000001', 'x')).ok === false)
  await packs.denunciarPack('Pack 1', '5511000000002', 'ofensivo')
  const d3 = await packs.denunciarPack('Pack 1', '5511000000003', 'ruim')
  checar('3 denuncias suspendem', d3.ok === true && d3.suspenso === true)
  const suspenso = await packs.buscarPackPorNome('Pack 1')
  checar('suspenso some p/ comum', packs.podeVerPack(suspenso, { ehRevisor: false }) === false)
  checar('suspenso abre p/ revisor', packs.podeVerPack(suspenso, { ehRevisor: true }) === true)
  checar('reativar zera denuncias', (await packs.reativarPack('Pack 1')).ok === true)
  checar('apagar recusa estranho', (await packs.apagarPack('Pack 2', '5511000000009')).ok === false)
  checar('apagar do dono remove', (await packs.apagarPack('Pack 2', donoA)).ok === true)

  const museu = await packs.listarPacksMuseu(1)
  checar('museu lista só ativos', museu.total >= 4 && museu.packs.every((p) => p.status === 'ativo'))

  console.log(`\n🧪 packs: ${passou} ok, ${falhou} falhas`)
  process.exit(falhou ? 1 : 0)
}

main().catch((err) => {
  console.error('💥 smoke-packs falhou:', err)
  process.exit(1)
})
