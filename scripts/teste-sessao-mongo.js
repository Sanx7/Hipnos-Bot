// ============================================================
// 🧪 Teste offline do WRAPPER de sessão Mongo (sessao-mongo.js)
// Sem rede, sem Atlas: usa uma collection FAKE que só registra as
// chamadas de updateOne/findOne, e confirma que NUNCA enviamos um
// $set inválido ao servidor (Buffer/Binary/Uint8Array/array/primitivo
// puros derrubam o Mongo com "Modifiers operate on fields but we found
// type X instead" — a lib mongo-baileys engole o erro e entra em loop).
//
// Uso (na raiz do projeto):  node scripts/teste-sessao-mongo.js
// ============================================================
const assert = require('node:assert')
const { Binary } = require('mongodb')
const { vestirColecaoAuth } = require('../sessao-mongo')

let chamadasUpdate = []
let docFake = null

function colecaoFake() {
  return {
    async updateOne(filtro, update, opcoes) {
      chamadasUpdate.push({ filtro, update, opcoes })
      return { acknowledged: true }
    },
    async findOne() { return docFake },
    async deleteOne() { return { acknowledged: true } }
  }
}

// O $set que chega ao driver precisa ser SEMPRE um objeto plano com
// campos nomeados — nunca Buffer/Binary/Uint8Array/array/primitivo puro.
function afirmarSetValido(update, rotulo) {
  const set = update.$set
  assert.ok(
    set && typeof set === 'object' && !Buffer.isBuffer(set) &&
    !(set instanceof Binary) && !ArrayBuffer.isView(set) && !Array.isArray(set),
    `${rotulo}: $set inválido (seria rejeitado com "Modifiers operate on fields"): ${Object.prototype.toString.call(set)}`
  )
}

async function main() {
  const colecao = vestirColecaoAuth(colecaoFake())

  // 1) Buffer cru (sender-key) → __rawBuffer__ como Buffer canônico
  const buf = Buffer.from([1, 2, 3, 4])
  await colecao.updateOne({ _id: 'sender-key-x' }, { $set: buf }, { upsert: true })

  // 2) Binary/binData do driver → __rawBuffer__ convertido a Buffer
  const bin = new Binary(Buffer.from([5, 6, 7]))
  await colecao.updateOne({ _id: 'session-y' }, { $set: bin }, { upsert: true })

  // 3) Uint8Array (session.serialize() do libsignal — NÃO é Buffer!) → __rawBuffer__
  const u8 = new Uint8Array([8, 9, 10, 11])
  await colecao.updateOne({ _id: 'session-z' }, { $set: u8 }, { upsert: true })

  // 4) String pura (lid-mapping) → __rawValue__
  await colecao.updateOne({ _id: 'lid-mapping-a' }, { $set: '554184062975' }, { upsert: true })

  // 5) Array puro (device-list) → __rawValue__
  await colecao.updateOne({ _id: 'device-list-b' }, { $set: ['38', '0'] }, { upsert: true })

  // 6) Objeto puro (pre-key, creds etc.) → passa direto, sem envelope
  const objeto = { chave: 'valor', n: 1 }
  await colecao.updateOne({ _id: 'pre-key-c' }, { $set: objeto }, { upsert: true })

  assert.strictEqual(chamadasUpdate.length, 6, 'esperava 6 escritas registradas')

  const [wBuf, wBin, wU8, wStr, wArr, wObj] = chamadasUpdate.map((c) => c.update)
  for (const [i, w] of [wBuf, wBin, wU8, wStr, wArr, wObj].entries()) {
    afirmarSetValido(w, `escrita #${i + 1}`)
  }

  assert.ok(Buffer.isBuffer(wBuf.$set.__rawBuffer__), 'Buffer deve ir em __rawBuffer__ como Buffer')
  assert.deepStrictEqual([...wBuf.$set.__rawBuffer__], [1, 2, 3, 4])
  assert.ok(Buffer.isBuffer(wBin.$set.__rawBuffer__), 'Binary deve ser convertido a Buffer em __rawBuffer__')
  assert.deepStrictEqual([...wBin.$set.__rawBuffer__], [5, 6, 7])
  assert.ok(Buffer.isBuffer(wU8.$set.__rawBuffer__), 'Uint8Array deve ser convertido a Buffer em __rawBuffer__')
  assert.deepStrictEqual([...wU8.$set.__rawBuffer__], [8, 9, 10, 11])
  assert.strictEqual(wStr.$set.__rawValue__, '554184062975', 'string deve ir em __rawValue__')
  assert.deepStrictEqual(wArr.$set.__rawValue__, ['38', '0'], 'array deve ir em __rawValue__')
  assert.deepStrictEqual(wObj.$set, objeto, 'objeto puro deve passar direto no $set')

  // 7) Leitura: __rawBuffer__ volta como binário; __rawValue__ volta puro
  docFake = { _id: 'session-z', __rawBuffer__: new Binary(Buffer.from([8, 9, 10, 11])) }
  const lidoBin = await colecao.findOne({ _id: 'session-z' })
  assert.ok(lidoBin instanceof Binary, 'leitura de __rawBuffer__ deve devolver o binário guardado')

  docFake = { _id: 'lid-mapping-a', __rawValue__: '554184062975' }
  assert.strictEqual(await colecao.findOne({ _id: 'lid-mapping-a' }), '554184062975')

  docFake = { _id: 'device-list-b', __rawValue__: ['38', '0'] }
  const lidoArr = await colecao.findOne({ _id: 'device-list-b' })
  assert.deepStrictEqual(lidoArr, ['38', '0'])

  console.log('✅ teste-sessao-mongo OK — 6 escritas com $set válido + 3 leituras íntegras.')
  console.log('   (Buffer/Binary/Uint8Array → __rawBuffer__; string/array → __rawValue__; objeto → direto)')
}

main().catch((erro) => {
  console.error('❌ teste-sessao-mongo FALHOU:', erro?.message || erro)
  process.exitCode = 1
})
