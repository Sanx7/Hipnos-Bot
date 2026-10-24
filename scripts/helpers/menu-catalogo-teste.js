// Infraestrutura compartilhada somente pelos testes. Nunca inicia bot.js.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
process.env.OWNER_NUMBERS = '000000000001'
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const { createRequire } = require('node:module')
const existe = fs.existsSync, ler = fs.readFileSync
const envLocal = path.resolve(__dirname, '../../.env')
fs.existsSync = p => path.resolve(String(p)) === envLocal ? false : existe(p)
fs.readFileSync = function (p, ...args) {
  if (typeof p !== 'number' && path.resolve(String(p)) === envLocal) throw Error('ENV_REAL_PROIBIDO')
  return ler.call(this, p, ...args)
}
require('node:net').Socket.prototype.connect = function () { throw Error('REDE_PROIBIDA') }
require('mongodb').MongoClient.prototype.connect = async function () { throw Error('MONGO_REAL_PROIBIDO') }
let carregado
function carregarComandosReais() {
  if (carregado) return carregado
  const { comandos } = require('../../comandos-registry')
  const arquivo = path.resolve(__dirname, '../../bot.js'), fonte = fs.readFileSync(arquivo, 'utf8')
  const inicio = fonte.indexOf('function carregarComandos('), fim = fonte.indexOf('\nconst pastaComandos', inicio)
  assert.ok(inicio >= 0 && fim > inicio, 'Loader real não localizado')
  const req = createRequire(arquivo), fontes = [], avisos = [], erros = []
  const importar = caminho => {
    const modulo = req(caminho)
    for (const cmd of Array.isArray(modulo) ? modulo : [modulo]) {
      if (cmd?.nome && typeof cmd.executar === 'function') fontes.push({ caminho, cmd })
    }
    return modulo
  }
  const log = { log: (...args) => {
    if (String(args[0]).includes('Alias ignorado')) avisos.push(String(args[0]))
    if (String(args[0]).startsWith('❌') || args[0] instanceof Error) erros.push('MODULO_INDISPONIVEL')
  } }
  new Function('require', 'fs', 'path', 'comandos', 'console', fonte.slice(inicio, fim) + '\nreturn carregarComandos')(
    importar, fs, path, comandos, log)(path.resolve(__dirname, '../../comandos'))
  assert.deepEqual(erros, [], 'Comandos devem carregar offline')
  const candidatos = new Map()
  for (const f of fontes) for (const rota of [f.cmd.nome, ...(f.cmd.aliases || [])]) {
    if (typeof rota !== 'string' || !rota) continue
    if (!candidatos.has(rota)) candidatos.set(rota, [])
    candidatos.get(rota).push(f)
  }
  carregado = { comandos, fontes, avisos, candidatos,
    conflitos: [...candidatos].filter(([, lista]) => lista.length > 1).map(([rota, lista]) => ({
      rota, candidatos: lista, vencedor: comandos.get(rota), mesmoObjeto: new Set(lista.map(f => f.cmd)).size === 1
    })) }
  return carregado
}
async function verificarMenu(categoria, nomes = [], aliases = {}) {
  const { comandos } = carregarComandosReais()
  const { catalogo, portais } = require('../../dados/menus-catalogo')
  const { entradas, POR_PAGINA } = require('../../dados/menus-olimpo')
  const prefixo = require('../../prefixo'), anterior = prefixo.prefixoSincrono()
  const portal = portais.find(p => p.categoria === categoria)
  assert.ok(portal); assert.equal(POR_PAGINA, 12)
  for (const nome of nomes) assert.equal(catalogo.filter(c => c.categoria === categoria && (c.acesso || c.nome) === nome).length, 1, `Catálogo: ${categoria}/${nome}`)
  const lista = entradas(categoria), paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA))
  const renderizados = []
  try {
    for (const p of ['/', '!', '#']) {
      prefixo.__definirPrefixoTeste(p)
      const vistos = []
      for (let pagina = 1; pagina <= paginas; pagina++) {
        const envios = [], jid = '000000000000@g.us', msg = { key: { remoteJid: jid, participant: '000000000002@s.whatsapp.net' } }
        await comandos.get(portal.nome).executar({ sendMessage: async (destino, corpo) => envios.push({ destino, corpo }) }, jid, msg, `${p}${portal.nome} ${pagina}`)
        assert.equal(envios.length, 1); assert.equal(envios[0].destino, jid)
        const texto = envios[0].corpo.text
        assert.ok(texto.includes(`*Página:* ${pagina}/${paginas}`))
        const anunciados = texto.split('\n').filter(l => l.startsWith(`*${p}`)).map(l => l.slice(p.length + 1).split('*')[0])
        assert.deepEqual(anunciados, lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA).map(c => c.acesso || c.nome))
        if (pagina > 1) assert.ok(texto.includes(`Anterior: ${p}${portal.nome} ${pagina - 1}`))
        if (pagina < paginas) assert.ok(texto.includes(`Próxima: ${p}${portal.nome} ${pagina + 1}`))
        vistos.push(...anunciados); renderizados.push(texto)
      }
      assert.equal(new Set(vistos).size, vistos.length)
      for (const nome of nomes) assert.equal(vistos.filter(n => n === nome).length, 1, `Menu: ${categoria}/${nome}`)
      for (const [alias, nome] of Object.entries(aliases)) {
        assert.equal(prefixo.resolverNomeComando(`${p}${alias}`), alias)
        assert.ok(comandos.has(nome)); assert.equal(comandos.get(alias), comandos.get(nome))
      }
    }
  } finally { prefixo.__definirPrefixoTeste(anterior) }
  return renderizados
}
module.exports = { carregarComandosReais, verificarMenu }
