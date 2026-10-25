// Regressao do helper legado: somente dados sinteticos, sem rede ou execucao do bot.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const arquivo = require.resolve('../func/administrar')
const fonte = fs.readFileSync(arquivo, 'utf8')
let total = 0
async function teste(nome, fn) { await fn(); total++; console.log('OK: ' + nome) }
async function main() {
  await teste('helper usa sintaxe CommonJS valida', () => { new vm.Script(fonte, { filename: arquivo }) })
  let api
  await teste('importacao nao depende de identificadores ausentes', () => { api = require(arquivo); assert.equal(typeof api._purlBot, 'function') })
  await teste('metadados preservam a mesma funcao exportada', () => { assert.equal(api._name._get()._name, api._purlBot); assert.equal(api._name._get().version, 'pwc') })
  await teste('geracao local preserva o formato sem requisicoes externas', async () => {
    const contexto = { module: { exports: {} }, Math: { random: () => 0.5 } }
    vm.runInNewContext(fonte, contexto)
    const isolado = contexto.module.exports
    const referencia = isolado._name._get()._type.reflect.n
    assert.equal(await isolado._purlBot(), referencia + 'https://purrbot.example/output/')
  })
  console.log(`${total} testes do helper legado passaram (offline).`)
}
main().catch(e => { console.error(e.name + ': ' + e.message); process.exitCode = 1 })
