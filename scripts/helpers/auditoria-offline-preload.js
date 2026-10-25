// Guarda adicional para a auditoria. Os testes rodam em copias sem dados privados.
const fs = require('node:fs')
const path = require('node:path')
const { createRequire, syncBuiltinESMExports } = require('node:module')
const bloquear = () => { throw new Error('AUDITORIA_REDE_REAL_BLOQUEADA') }
require('node:net').Socket.prototype.connect = bloquear
require('node:tls').connect = bloquear
require('node:dgram').createSocket = bloquear
const dns = require('node:dns')
for (const key of Object.keys(dns)) if (/^(lookup|resolve|reverse)/.test(key) && typeof dns[key] === 'function') dns[key] = bloquear
for (const key of Object.keys(dns.promises)) if (/^(lookup|resolve|reverse)/.test(key)) dns.promises[key] = bloquear
const mongo = createRequire(path.join(process.cwd(), 'package.json'))('mongodb')
mongo.MongoClient.prototype.connect = async () => { throw new Error('AUDITORIA_MONGO_REAL_BLOQUEADO') }
const existe = fs.existsSync
fs.existsSync = p => path.basename(String(p)) === '.env' ? false : existe(p)
// Impede leituras acidentais de credenciais e escritas no checkout original/dependencias.
const original = process.env.HIPNOS_AUDITORIA_ORIGINAL
const raizOriginal = original && fs.realpathSync(original).toLowerCase()
const protegido = p => {
  if (typeof p !== 'string' && !Buffer.isBuffer(p) && !(p instanceof URL)) return false
  const f = path.resolve(String(p)).toLowerCase()
  return /(^|[\\/])\.env(?:$|\.)/.test(f) || /[\\/]auth[\\/]/.test(f)
}
for (const nome of ['readFileSync', 'readFile']) {
  const fn = fs[nome]
  fs[nome] = function (p, ...args) { if (protegido(p)) throw Error('AUDITORIA_ARQUIVO_PRIVADO_BLOQUEADO'); return fn.call(this, p, ...args) }
}
function escrita(p) {
  if (typeof p !== 'string' && !Buffer.isBuffer(p)) return
  const f = path.resolve(String(p)).toLowerCase()
  let ancestral = path.resolve(String(p))
  while (!existe(ancestral) && path.dirname(ancestral) !== ancestral) ancestral = path.dirname(ancestral)
  const real = fs.realpathSync(ancestral).toLowerCase()
  if (protegido(p) || (raizOriginal && (real === raizOriginal || real.startsWith(raizOriginal + path.sep))) ||
      (original && (f === original.toLowerCase() || f.startsWith(original.toLowerCase() + path.sep)))) throw Error('AUDITORIA_ESCRITA_ORIGINAL_BLOQUEADA')
}
for (const nome of ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'unlinkSync', 'unlink', 'rmSync', 'rm', 'mkdirSync', 'mkdir']) {
  const fn = fs[nome]
  fs[nome] = function (p, ...args) { escrita(p); return fn.call(this, p, ...args) }
}
for (const nome of ['renameSync', 'rename', 'copyFileSync', 'copyFile']) {
  const fn = fs[nome]
  fs[nome] = function (a, b, ...args) { escrita(b); if (nome.startsWith('rename')) escrita(a); return fn.call(this, a, b, ...args) }
}
for (const nome of ['writeFile', 'appendFile', 'unlink', 'rm', 'mkdir']) {
  const fn = fs.promises[nome].bind(fs.promises)
  fs.promises[nome] = async function (p, ...args) { escrita(p); return fn(p, ...args) }
}
const lerPromessa = fs.promises.readFile.bind(fs.promises)
fs.promises.readFile = async function (p, ...args) { if (protegido(p)) throw Error('AUDITORIA_ARQUIVO_PRIVADO_BLOQUEADO'); return lerPromessa(p, ...args) }
syncBuiltinESMExports()
