// Executa todas as suites locais em snapshots descartaveis, sem carregar .env.
// Uso: node scripts/auditoria-offline.js [diretorio-de-resultados-novo]
// Nao executa integracoes reais nem modifica o checkout auditado.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const cp = require('node:child_process')
const crypto = require('node:crypto')
const raiz = path.resolve(__dirname, '..')
const git = args => cp.execFileSync('git', args, { cwd: raiz, encoding: 'utf8' }).trim()
const arquivos = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)
const suites = arquivos.filter(f => /(^|\/)teste-[^/]+\.js$/.test(f)).sort()
const externas = new Set(['acoes', 'play', 'nasa-integracao', 'mongo-conexoes-real', 'jornal-mongo-real', 'rpg-integracao-mongo'].map(n => `scripts/teste-${n}.js`))
const destino = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'hipnos-auditoria-'))
if (destino === raiz || destino.startsWith(raiz + path.sep)) throw Error('RESULTADOS_DEVEM_FICAR_FORA_DO_CHECKOUT')
fs.mkdirSync(destino, { recursive: true })
if (fs.existsSync(path.join(destino, 'resultados.json'))) throw Error('RESULTADOS_JA_EXISTEM')
const ignorado = f => /(^|\/)(?:auth|node_modules)(?:\/|$)/i.test(f) || /(^|\/)\.env(?:$|\.)/i.test(f) || /\.(?:db|sqlite)$/i.test(f)
const snapshot = arquivos.filter(f => !ignorado(f))
const extras = ['scripts/auditoria-offline.js', 'scripts/helpers/auditoria-offline-preload.js'].filter(f => !snapshot.includes(f))
snapshot.push(...extras)
const hashes = new Map(snapshot.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(raiz, f))).digest('hex')]))
const dados = { commit: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']), inicio: new Date().toISOString(), suites: [], inventario: suites, externas: [...externas] }
function contarCasos(texto, suite) {
  const tap = texto.match(/\u2139 pass (\d+)/)
  const donos = [...texto.matchAll(/Resultado \[\d donos\]: (\d+) passaram/g)]
  if (tap) return { casosAprovados: Number(tap[1]), metodoContagem: 'node:test' }
  if (donos.length) return { casosAprovados: donos.reduce((s, m) => s + Number(m[1]), 0), metodoContagem: 'resumos por processo' }
  if (suite.endsWith('teste-compatibilidade-canvas.js')) return { casosAprovados: 15, metodoContagem: '8 valores de configuracao e 7 cenarios' }
  if (suite.endsWith('teste-sessao-mongo.js')) return { casosAprovados: 9, metodoContagem: '6 escritas e 3 leituras' }
  const resumo = texto.match(/\b(\d+)(?:\/\d+)? (?:testes|cen\u00e1rios|cenarios|verifica\u00e7\u00f5es)[^\n]*(?:passaram|aprovad)/i) || texto.match(/\b(\d+) (?:passaram|aprovados)[;,]/) || texto.match(/^OK: (\d+) verifica\u00e7\u00f5es/m)
  if (resumo) return { casosAprovados: Number(resumo[1]), metodoContagem: 'resumo da suite' }
  const casos = texto.split(/\r?\n/).filter(l => /^\s*\u2705 |^OK[: ]|^PASSOU: /.test(l) && !/Todos|Loader OK/.test(l)).length
  return { casosAprovados: casos, metodoContagem: casos ? 'casos individuais registrados' : 'integrado sem contagem individual' }
}
function salvar() { fs.writeFileSync(path.join(destino, 'resultados.json'), JSON.stringify(dados, null, 2)) }
for (const suite of suites.filter(f => externas.has(f))) dados.suites.push({ suite, estado: 'nao-executada', motivo: 'integracao com servico real' })
const fila = suites.filter(f => !externas.has(f))
async function worker(n) {
  const copia = path.join(destino, 'worker-' + n)
  fs.mkdirSync(copia)
  fs.mkdirSync(path.join(copia, 'tmp'))
  for (const f of snapshot) { fs.mkdirSync(path.dirname(path.join(copia, f)), { recursive: true }); fs.copyFileSync(path.join(raiz, f), path.join(copia, f)) }
  fs.symlinkSync(path.join(raiz, 'node_modules'), path.join(copia, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const restaurar = pasta => {
    for (const e of fs.readdirSync(pasta, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue
      const p = path.join(pasta, e.name), rel = path.relative(copia, p).split(path.sep).join('/')
      if (e.isDirectory()) restaurar(p)
      else if (!hashes.has(rel)) fs.unlinkSync(p) // Somente arquivos criados no snapshot deste worker.
    }
    if (pasta === copia) for (const f of snapshot) {
      const p = path.join(copia, f)
      if (!fs.existsSync(p) || crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') !== hashes.get(f)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.copyFileSync(path.join(raiz, f), p) }
    }
  }
  while (fila.length) {
    const suite = fila.shift(), inicio = Date.now()
    const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'NUMBER_OF_PROCESSORS'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
    Object.assign(env, { TEMP: path.join(copia, 'tmp'), TMP: path.join(copia, 'tmp'), HOME: copia, USERPROFILE: copia, MONGODB_URI: '', MONGO_URI_RPG: '', RPG_TEST_MONGO_URI: '', OWNER_NUMBERS: '00010000001', HIPNOS_AUDITORIA_ORIGINAL: raiz, GIT_DIR: path.join(raiz, '.git'), NODE_OPTIONS: `--unhandled-rejections=strict --require="${path.join(copia, 'scripts/helpers/auditoria-offline-preload.js').replace(/\\/g, '/')}"` })
    const resultado = await new Promise(resolve => {
      const child = cp.spawn(process.execPath, [suite], { cwd: copia, env, windowsHide: true })
      let saida = '', timeout = false
      child.stdout.on('data', d => { saida += d }); child.stderr.on('data', d => { saida += d })
      const timer = setTimeout(() => { timeout = true; if (process.platform === 'win32') cp.spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); else child.kill('SIGKILL') }, 90000)
      child.on('error', () => { saida += '\nAUDITORIA_ERRO_SPAWN' })
      child.on('close', code => { clearTimeout(timer); resolve({ suite, estado: timeout ? 'timeout' : code === 0 ? 'aprovada' : 'reprovada', codigo: code, ms: Date.now() - inicio, saida }) })
    })
    fs.writeFileSync(path.join(destino, path.basename(suite) + '.log'), resultado.saida)
    if (resultado.estado === 'aprovada') Object.assign(resultado, contarCasos(resultado.saida, suite))
    delete resultado.saida
    dados.suites.push(resultado); salvar()
    console.log(`${dados.suites.length}/${suites.length} ${resultado.estado} ${suite} (${resultado.ms}ms)`)
    restaurar(copia)
  }
}
async function main() {
  console.log('RESULTADOS: ' + destino)
  await Promise.all(Array.from({ length: 4 }, (_, i) => worker(i)))
  dados.fim = new Date().toISOString(); salvar()
  console.log(JSON.stringify(dados.suites.reduce((s, x) => { s[x.estado] = (s[x.estado] || 0) + 1; return s }, {})))
  process.exitCode = dados.suites.some(s => ['reprovada', 'timeout'].includes(s.estado)) ? 1 : 0
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
