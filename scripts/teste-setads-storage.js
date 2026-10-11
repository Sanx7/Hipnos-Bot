// Contract test of the production Mongo/GridFS adapter, without any server.
process.env.MONGODB_URI = ''
const assert = require('assert/strict'), vm = require('vm'), fs = require('fs')
const { Writable, Readable } = require('stream'), { ObjectId } = require('mongodb')
let n = 0
function check(v) { assert.ok(v); n++ }
async function main() {
  const dados = new Map(), registros = [], indices = [], arquivos = new Map(), chunks = new Map()
  let falharConexao = false, falharUpload = false, conectados = 0, fechados = 0
  const db = { collection(nome) {
    registros.push(nome)
    if (!dados.has(nome)) dados.set(nome, { async createIndex(...args) { indices.push([nome,...args]) }, async deleteOne(f) { arquivos.delete(f._id.toHexString()) }, async deleteMany(f) { chunks.delete(f.files_id.toHexString()) } })
    return dados.get(nome)
  } }
  class MongoClient {
    constructor(uri) { check(uri === 'mongodb://offline') }
    async connect() { conectados++; if (falharConexao) throw new Error('Mongo indisponível') }
    db(nome) { check(nome === 'whatsapp'); return db }
    async close() { fechados++ }
  }
  class GridFSBucket {
    constructor(database, opcoes) { check(database === db); check(opcoes.bucketName === 'anunciosMidias') }
    openUploadStreamWithId(id, nome) {
      check(id instanceof ObjectId); check(nome === 'anuncio')
      const key = id.toHexString(), partes = []
      return new Writable({ write(chunk, _, cb) { if (falharUpload) return cb(new Error('Upload falhou')); partes.push(chunk); chunks.set(key, true); cb() }, final(cb) { arquivos.set(key, Buffer.concat(partes)); cb() } })
    }
    openDownloadStream(id) { check(id instanceof ObjectId); const b = arquivos.get(id.toHexString()); return b ? Readable.from([b]) : Readable.from((async function* () { throw new Error('Mídia ausente') })()) }
  }
  const modulo = { exports: {} }, fonte = fs.readFileSync(require.resolve('../dados/ads-storage'), 'utf8')
  vm.runInNewContext(fonte, { module: modulo, require: nome => nome === 'mongodb' ? { MongoClient, GridFSBucket, ObjectId } : require(nome), process: { env: { MONGODB_URI: 'mongodb://offline' } }, Buffer, setTimeout, clearTimeout, AbortSignal })
  falharConexao = true
  await assert.rejects(modulo.exports.obter()); n++; check(fechados === 1)
  falharConexao = false
  const s = await modulo.exports.obter(); check(conectados === 2); check(await modulo.exports.obter() === s)
  check(indices.some(i => i[0] === 'anunciosAutomaticos' && i[1].proximo === 1)); check(indices.some(i => i[0] === 'anunciosControles' && i[2].expireAfterSeconds === 0))
  const id = new ObjectId().toHexString(), buffer = Buffer.from('buffer offline')
  await s.salvar(id,buffer); check(arquivos.has(id)); assert.deepEqual(await s.ler(id,100),buffer); n++
  await assert.rejects(s.ler(id,1)); n++
  await s.apagar(id); check(!arquivos.has(id)); check(!chunks.has(id))
  await assert.rejects(s.ler(id,100)); n++
  chunks.set(id,true); await s.apagar(id); check(!chunks.has(id))
  falharUpload = true; await assert.rejects(s.salvar(id,buffer)); n++
  check(registros.includes('anunciosMidias.files')); check(registros.includes('anunciosMidias.chunks'))
  console.log(`OK: ${n} verificações offline do contrato Mongo/GridFS.`)
}
main().catch(e => { console.error(e); process.exitCode = 1 })
