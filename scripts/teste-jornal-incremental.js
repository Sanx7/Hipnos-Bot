// Offline: o MongoClient é proibido; relógio e coleção são simulados.
// Uso: node scripts/teste-jornal-incremental.js
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { BSON } = require('mongodb')
const arquivo = path.join(__dirname, '..', 'dados', 'captura-diaria.js')
const fonte = fs.readFileSync(arquivo, 'utf8')
const grupo = '120363000000000001@g.us'
const inicio = Date.parse('2026-10-14T12:00:00-03:00')
const copiar = x => structuredClone(x)

// Interpretador independente das expressões Mongo utilizadas. Ele avalia o
// comando enviado pelo código real, não chama uma réplica de sua gravação.
function avaliar(x, doc) {
  if (typeof x === 'string' && x === '$$ROOT') return doc
  if (typeof x === 'string' && x.startsWith('$')) return x.slice(1).split('.').reduce((v, k) => v?.[k], doc)
  if (Array.isArray(x)) return x.map(v => avaliar(v, doc))
  if (!x || typeof x !== 'object' || x instanceof Date) return x
  if ('$literal' in x) return copiar(x.$literal)
  if ('$ifNull' in x) { const a = avaliar(x.$ifNull, doc); return a[0] ?? a[1] }
  if ('$gte' in x) { const a = avaliar(x.$gte, doc); return a[0] >= a[1] }
  if ('$ne' in x) { const a = avaliar(x.$ne, doc); return a[0] !== a[1] }
  if ('$or' in x) return avaliar(x.$or, doc).some(Boolean)
  if ('$cond' in x) return avaliar(x.$cond[avaliar(x.$cond[0], doc) ? 1 : 2], doc)
  if ('$mergeObjects' in x) return Object.assign({}, ...avaliar(x.$mergeObjects, doc))
  if ('$concatArrays' in x) return avaliar(x.$concatArrays, doc).flat()
  if ('$slice' in x) { const a = avaliar(x.$slice, doc); return a[0].slice(a[1] < 0 ? a[1] : 0, a[1] < 0 ? undefined : a[1]) }
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, avaliar(v, doc)]))
}

function bytesComando(q, u, opcoes) {
  return BSON.serialize({ update: 'jornal_diario', updates: [{ q, u, upsert: opcoes.upsert, multi: false }],
    ...(opcoes.writeConcern ? { writeConcern: opcoes.writeConcern } : {}), $db: 'offline' }).length
}

class Colecao {
  constructor() { this.docs = new Map(); this.operacoes = []; this.bytes = 0; this.leituras = 0; this.ativas = 0; this.maxAtivas = 0 }
  chave(f) { return JSON.stringify([f.grupo, f.data]) }
  documento(data = '2026-10-14', gid = grupo) { return this.docs.get(this.chave({ grupo: gid, data })) }
  async findOne(f) {
    this.leituras++
    if (this.antesLer) await this.antesLer()
    if (this.falharLeitura) throw new Error('leitura offline indisponível')
    return copiar(this.docs.get(this.chave(f)) || null)
  }
  aplicar(f, u) {
    let doc = copiar(this.docs.get(this.chave(f)) || f)
    if (Array.isArray(u)) for (const etapa of u) doc = avaliar(etapa.$replaceWith, doc)
    else doc = { ...doc, ...copiar(u.$set) }
    this.docs.set(this.chave(f), copiar(doc))
  }
  async updateOne(f, u, opcoes) {
    assert.equal(opcoes.upsert, true)
    this.operacoes.push(copiar({ f, u, opcoes }))
    this.bytes += bytesComando(f, u, opcoes)
    this.ativas++; this.maxAtivas = Math.max(this.maxAtivas, this.ativas)
    try {
      if (this.antesGravar) await this.antesGravar(f, u)
      if (this.falharAntes > 0) { this.falharAntes--; throw new Error('sem conexão') }
      if (this.adiar > 0) {
        this.adiar--; this.atrasada = () => this.aplicar(f, u)
        throw new Error('timeout antes da aplicação')
      }
      const antes = this.docs.get(this.chave(f))
      const serializado = JSON.stringify(antes)
      this.aplicar(f, u)
      if (this.falharDepois > 0) { this.falharDepois--; throw new Error('confirmação perdida') }
      return { acknowledged: true, matchedCount: antes ? 1 : 0,
        upsertedCount: antes ? 0 : 1, modifiedCount: antes && JSON.stringify(this.docs.get(this.chave(f))) !== serializado ? 1 : 0 }
    } finally { this.ativas-- }
  }
}

function carregar(col = new Colecao(), relogio = { agora: inicio }) {
  const m = { exports: {} }
  class Data extends Date {
    constructor(...args) { super(...(args.length ? args : [relogio.agora])) }
    static now() { return relogio.agora }
  }
  const logs = []
  vm.runInNewContext(fonte, {
    require: nome => {
      if (nome === 'mongodb') return { MongoClient: class { constructor() { throw new Error('Rede real proibida no teste') } } }
      if (nome === '@whiskeysockets/baileys') return { normalizeMessageContent: m => m }
      return require(nome)
    },
    module: m, exports: m.exports, process: { env: { MONGODB_URI: '' } }, Date: Data,
    console: { error: (...args) => logs.push(args) }
  }, { filename: arquivo })
  m.exports._injetarColecao(col)
  return { captura: m.exports, col, relogio, logs }
}

function mensagem(i, extra = {}) {
  return { key: { id: String(i), fromMe: false }, pushName: 'Ana', message: { conversation: `mensagem ${i}` }, ...extra }
}
function capturar(c, i, gid = grupo, extra) { c.capturarMensagem(mensagem(i, extra), gid) }
function textos(doc) { return [...doc.mensagens].map(m => m.texto) }
async function drenar(c) { await c._aguardarPersistencia() }
const casos = []
function teste(nome, fn) { casos.push([nome, fn]) }

teste('mensagens simultâneas mantêm conteúdo, ordem e uma gravação em voo por grupo', async () => {
  const { captura: c, col } = carregar()
  col.antesGravar = () => new Promise(resolve => setImmediate(resolve))
  await Promise.all(Array.from({ length: 100 }, (_, i) => Promise.resolve().then(() => capturar(c, i))))
  await drenar(c)
  assert.deepEqual(textos(col.documento()), Array.from({ length: 100 }, (_, i) => `mensagem ${i}`))
  assert.equal(col.maxAtivas, 1)
  assert.deepEqual(copiar((await c.lerAcumulado(grupo)).mensagens), col.documento().mensagens)
})

teste('500 e 501 entradas mantêm exatamente as últimas 500', async () => {
  const { captura: c, col } = carregar()
  for (let i = 0; i < 501; i++) {
    capturar(c, i); await drenar(c)
    if (i === 499) assert.equal(col.documento().mensagens.length, 500)
  }
  assert.deepEqual(textos(col.documento()), Array.from({ length: 500 }, (_, i) => `mensagem ${i + 1}`))
  assert.equal((await c.lerAcumulado(grupo)).mensagens.length, 500)
})

teste('rajada de 1.000 entradas também respeita a janela sem perda dentro dela', async () => {
  const { captura: c, col } = carregar()
  for (let i = 0; i < 1000; i++) capturar(c, i)
  await drenar(c)
  assert.deepEqual(textos(col.documento()), Array.from({ length: 500 }, (_, i) => `mensagem ${i + 500}`))
})

teste('conteúdo literal, autor, horário, legenda e truncamento permanecem iguais', async () => {
  const { captura: c, col } = carregar()
  const texto = '  $campo $$ROOT café 🎉 ' + 'x'.repeat(600)
  capturar(c, 1, grupo, { pushName: 'A'.repeat(70), message: { imageMessage: { caption: texto } } })
  await drenar(c)
  assert.deepEqual(col.documento().mensagens, [{ autor: 'A'.repeat(60), texto: texto.trim().slice(0, 500), hora: inicio }])
})

teste('comandos, vazios, mídia sem legenda, PV e fromMe continuam ignorados', async () => {
  const { captura: c, col } = carregar()
  for (const m of [{ conversation: '/jornal' }, { conversation: '   ' }, { imageMessage: {} }]) capturar(c, 1, grupo, { message: m })
  capturar(c, 1, '123@s.whatsapp.net')
  capturar(c, 1, grupo, { key: { fromMe: true } })
  await drenar(c)
  assert.equal(col.operacoes.length, 0)
})

teste('documento legado é preservado e nova captura após reinício não apaga seu histórico', async () => {
  const col = new Colecao()
  const legado = { grupo, data: '2026-10-14', mensagens: [{ autor: 'Bia', texto: 'legado', hora: 1 }], expiraEm: new Date(inicio + 1000), outro: 'preservar' }
  col.docs.set(col.chave(legado), copiar(legado))
  const { captura: c } = carregar(col)
  capturar(c, 1); await drenar(c)
  assert.deepEqual(textos(col.documento()), ['legado', 'mensagem 1'])
  assert.equal(col.documento().outro, 'preservar')
  const reiniciado = carregar(col).captura
  assert.deepEqual(copiar((await reiniciado.lerAcumulado(grupo)).mensagens), col.documento().mensagens)
  capturar(reiniciado, 2); await drenar(reiniciado)
  assert.deepEqual(textos(col.documento()), ['legado', 'mensagem 1', 'mensagem 2'])
})

teste('leitura de recuperação concorrente com captura não sobrescreve a nova entrada', async () => {
  const { captura: c, col } = carregar()
  col.docs.set(col.chave({ grupo, data: '2026-10-14' }), { grupo, data: '2026-10-14', mensagens: [{ autor: 'A', texto: 'antes', hora: 1 }] })
  let liberar
  col.antesLer = () => new Promise(resolve => { liberar = resolve })
  const leitura = c.lerAcumulado(grupo)
  await new Promise(resolve => setImmediate(resolve))
  capturar(c, 1)
  liberar(); col.antesLer = null
  await leitura; await drenar(c)
  assert.deepEqual(textos(await c.lerAcumulado(grupo)), ['antes', 'mensagem 1'])
  assert.equal(col.leituras, 1)
})

teste('falha de leitura bloqueia escrita e depois recupera legado mais pendentes', async () => {
  const { captura: c, col } = carregar()
  col.docs.set(col.chave({ grupo, data: '2026-10-14' }), { grupo, data: '2026-10-14', mensagens: [{ autor: 'A', texto: 'antes', hora: 1 }] })
  col.falharLeitura = true
  capturar(c, 1); await drenar(c)
  assert.equal(col.operacoes.length, 0)
  assert.deepEqual(textos(await c.lerAcumulado(grupo)), ['mensagem 1'])
  await drenar(c)
  col.falharLeitura = false
  await drenar(c)
  assert.deepEqual(textos(col.documento()), ['antes', 'mensagem 1'])
})

teste('falha antes da gravação repete a entrada antes das seguintes', async () => {
  const { captura: c, col } = carregar()
  col.falharAntes = 1
  capturar(c, 1); capturar(c, 2); await drenar(c)
  assert.deepEqual(textos(col.documento()), ['mensagem 1', 'mensagem 2'])
  assert.deepEqual(col.operacoes[0], col.operacoes[1])
})

teste('confirmação perdida não duplica a mensagem', async () => {
  const { captura: c, col } = carregar()
  col.falharDepois = 1
  capturar(c, 1); capturar(c, 2); await drenar(c)
  assert.deepEqual(textos(col.documento()), ['mensagem 1', 'mensagem 2'])
  assert.deepEqual(col.operacoes[0], col.operacoes[1])
})

teste('falha persistente preserva fila; nova atividade recupera na ordem', async () => {
  const { captura: c, col, logs } = carregar()
  col.falharAntes = 2
  capturar(c, 1); await drenar(c)
  assert.equal(col.documento(), undefined)
  capturar(c, 2); await drenar(c)
  assert.deepEqual(textos(col.documento()), ['mensagem 1', 'mensagem 2'])
  assert(logs.length > 0)
  assert(!JSON.stringify(logs).includes('mensagem 1'))
})

teste('indisponibilidade longa conserva as últimas 500 entradas ao recuperar', async () => {
  const { captura: c, col } = carregar()
  col.falharAntes = 10000
  capturar(c, 0); await drenar(c)
  for (let i = 1; i <= 1200; i++) capturar(c, i)
  await drenar(c)
  col.falharAntes = 0
  await drenar(c)
  assert.deepEqual(textos(col.documento()), Array.from({ length: 500 }, (_, i) => `mensagem ${i + 701}`))
})

teste('repetição muito atrasada não retorna após a janela de 500 entradas', async () => {
  const { captura: c, col } = carregar()
  col.adiar = 1
  for (let i = 0; i <= 510; i++) { capturar(c, i); await drenar(c) }
  const antes = copiar(col.documento())
  col.atrasada()
  assert.deepEqual(col.documento(), antes)
})

teste('operação antiga não entra fora de ordem depois de reinício e nova gravação', async () => {
  const { captura: c, col } = carregar()
  col.adiar = 2
  capturar(c, 1); await drenar(c)
  assert.equal(col.documento(), undefined)
  const reiniciado = carregar(col).captura
  capturar(reiniciado, 2); await drenar(reiniciado)
  const antes = copiar(col.documento())
  col.atrasada()
  assert.deepEqual(col.documento(), antes)
  assert.deepEqual(textos(col.documento()), ['mensagem 2'])
})

teste('reinício recupera gravação aplicada mesmo se ambas as confirmações se perderem', async () => {
  const { captura: c, col } = carregar()
  col.falharDepois = 2
  capturar(c, 1); await drenar(c)
  const reiniciado = carregar(col).captura
  assert.deepEqual(textos(await reiniciado.lerAcumulado(grupo)), ['mensagem 1'])
  capturar(reiniciado, 2); await drenar(reiniciado)
  await drenar(c) // tentativa do escritor antigo vira no-op confirmado
  assert.deepEqual(textos(col.documento()), ['mensagem 1', 'mensagem 2'])
})

teste('rajada durante escrita em voo não remove a próxima entrada por engano', async () => {
  const { captura: c, col } = carregar()
  let liberar
  col.antesGravar = () => new Promise(resolve => { liberar = resolve })
  capturar(c, 0)
  await new Promise(resolve => setImmediate(resolve))
  for (let i = 1; i <= 1000; i++) capturar(c, i)
  col.antesGravar = null; liberar()
  await drenar(c)
  assert.deepEqual(textos(col.documento()), Array.from({ length: 500 }, (_, i) => `mensagem ${i + 501}`))
})

teste('repetição após remoção TTL não deixa documento sem expiração', async () => {
  const { captura: c, col } = carregar()
  capturar(c, 0); await drenar(c)
  col.adiar = 1
  capturar(c, 1); await drenar(c)
  col.docs.clear()
  col.atrasada()
  assert.equal(col.documento().mensagens.length, 0)
  assert(col.documento().expiraEm instanceof Date)
})

teste('mudança de dia separa histórico e mantém a expiração de São Paulo', async () => {
  const { captura: c, col, relogio } = carregar()
  relogio.agora = Date.parse('2026-10-14T23:00:00-03:00')
  capturar(c, 1); await drenar(c)
  const antigo = copiar(col.documento())
  assert.equal(antigo.expiraEm.toISOString(), '2026-10-15T03:00:00.000Z')
  relogio.agora = Date.parse('2026-10-15T00:01:00-03:00')
  capturar(c, 2); await drenar(c)
  assert.deepEqual(col.documento('2026-10-14'), antigo)
  assert.deepEqual(textos(col.documento('2026-10-15')), ['mensagem 2'])
  assert.equal(col.documento('2026-10-15').expiraEm.toISOString(), '2026-10-16T03:00:00.000Z')
})

teste('tentativa pendente além do TTL não recria o documento expirado', async () => {
  const { captura: c, col, relogio } = carregar()
  col.falharAntes = 2
  capturar(c, 1); await drenar(c)
  relogio.agora = Date.parse('2026-10-15T04:00:00Z')
  col.falharAntes = 0
  await drenar(c)
  assert.equal(col.documento(), undefined)
})

teste('grupos diferentes não compartilham mensagens nem filas bloqueadas', async () => {
  const { captura: c, col } = carregar()
  const outro = '120363000000000002@g.us'
  let liberar
  col.antesGravar = async f => { if (f.grupo === grupo) await new Promise(resolve => { liberar = resolve }) }
  capturar(c, 1)
  await new Promise(resolve => setImmediate(resolve))
  capturar(c, 2, outro)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(textos(col.documento('2026-10-14', outro)), ['mensagem 2'])
  liberar(); col.antesGravar = null; await drenar(c)
  assert.deepEqual(textos(col.documento()), ['mensagem 1'])
})

teste('comparação BSON de 1.000 capturas idênticas, incluindo sobrecarga do pipeline', async () => {
  const { captura: c, col } = carregar()
  const memoria = []; let bytesAntes = 0
  for (let i = 0; i < 1000; i++) {
    const texto = `Mensagem ${String(i).padStart(4, '0')}: ` + 'conversa do grupo com café e novidades. '.repeat(5)
    capturar(c, i, grupo, { message: { conversation: texto } })
    memoria.push({ autor: 'Ana', texto: texto.trim().slice(0, 500), hora: inicio })
    if (memoria.length > 500) memoria.shift()
    bytesAntes += bytesComando({ grupo, data: '2026-10-14' }, { $set: { mensagens: copiar(memoria), expiraEm: c.proximaMeiaNoiteLocal() } }, { upsert: true })
    await drenar(c)
  }
  assert.deepEqual(col.documento().mensagens, memoria)
  assert.equal(col.operacoes.length, 1000)
  assert(col.bytes < bytesAntes / 10)
  console.log(JSON.stringify({ capturas: 1000, comandosAntes: 1000, comandosDepois: col.operacoes.length,
    bytesBsonAntes: bytesAntes, bytesBsonDepois: col.bytes, reducaoPercentual: Number((100 * (1 - col.bytes / bytesAntes)).toFixed(2)) }))
})

let atual
const vigia = setTimeout(() => { console.error('Teste não concluiu: ' + atual); process.exit(1) }, 30000)
;(async () => {
  for (const [nome, fn] of casos) { atual = nome; await fn(); console.log('PASSOU: ' + nome) }
  console.log(`${casos.length} testes passaram; nenhuma conexão real permitida.`)
})().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => clearTimeout(vigia))
