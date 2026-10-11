const { MongoClient, GridFSBucket, ObjectId } = require('mongodb')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
let conexao, teste
async function obter() {
  if (teste) return teste
  if (!conexao) {
    conexao = (async () => {
      if (!process.env.MONGODB_URI) throw new Error('Banco indisponível.')
      const cliente = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 30000 })
      try {
        await cliente.connect()
        const db = cliente.db(process.env.MONGODB_DB || 'whatsapp'), ads = db.collection('anunciosAutomaticos'), controles = db.collection('anunciosControles')
        await ads.createIndex({ estado: 1, ativo: 1, proximo: 1 })
        await controles.createIndex({ expira: 1 }, { expireAfterSeconds: 0 })
        const bucket = new GridFSBucket(db, { bucketName: 'anunciosMidias' })
        return { ads, controles,
          async salvar(id, buffer) { await pipeline(Readable.from([buffer]), bucket.openUploadStreamWithId(new ObjectId(id), 'anuncio'), { signal: AbortSignal.timeout(120000) }) },
          async ler(id, limite) {
            const stream = bucket.openDownloadStream(new ObjectId(id)), chunks = []; let tamanho = 0
            const timer = setTimeout(() => stream.destroy(new Error('Leitura expirada')), 30000)
            try { for await (const chunk of stream) { tamanho += chunk.length; if (tamanho > limite) throw new Error('Mídia excede o limite.'); chunks.push(chunk) } }
            finally { clearTimeout(timer); stream.destroy() }
            return Buffer.concat(chunks)
          },
          async apagar(id) {
            // Também remove chunks órfãos de upload interrompido, sem presumir arquivo completo.
            await db.collection('anunciosMidias.files').deleteOne({ _id: new ObjectId(id) })
            await db.collection('anunciosMidias.chunks').deleteMany({ files_id: new ObjectId(id) })
          }
        }
      } catch (e) { await cliente.close().catch(() => {}); throw e }
    })()
    conexao.catch(() => { conexao = null })
  }
  return conexao
}
module.exports = { obter, __definirTeste(v) { teste = v } }
