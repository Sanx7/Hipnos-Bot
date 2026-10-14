const { MongoClient } = require('mongodb')
let conexao, teste
async function obter() {
  if (teste) return teste
  if (!conexao) {
    conexao = (async () => {
      if (!process.env.MONGODB_URI) throw new Error('MongoDB indisponível')
      const cliente = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 20000 })
      try {
        await cliente.connect()
        const db = cliente.db(process.env.MONGODB_DB || 'whatsapp')
        const opcoes = { writeConcern: { w: 'majority' }, readConcern: { level: 'majority' }, readPreference: 'primary' }
        const imagens = db.collection('garticImagens', opcoes), controles = db.collection('garticControles', opcoes)
        await imagens.createIndex({ palavraChave: 1, ativo: 1, estado: 1 })
        await imagens.createIndex({ ativo: 1, estado: 1, categoria: 1, palavraChave: 1 })
        await imagens.createIndex({ publicId: 1 }, { unique: true })
        return { imagens, controles }
      } catch (e) { await cliente.close().catch(() => {}); throw e }
    })()
    conexao.catch(() => { conexao = null })
  }
  return conexao
}
const conferir = r => { if (!r?.acknowledged) throw new Error('Escrita não confirmada') }
function criarRepositorio(fonte = obter) {
  return {
    async travar(token) {
      try { const r = await (await fonte()).controles.insertOne({ _id: 'mutacao', token, criadaEm: new Date() }); conferir(r); return true }
      catch (e) { if (e.code === 11000) return false; throw e }
    },
    async destravar(token) { conferir(await (await fonte()).controles.deleteOne({ _id: 'mutacao', token })) },
    async reservar(doc) { conferir(await (await fonte()).imagens.insertOne(doc)) },
    async ler(id) { return (await fonte()).imagens.findOne({ _id: id }) },
    async alterar(id, campos) {
      const r = await (await fonte()).imagens.updateOne({ _id: id }, { $set: campos }); conferir(r)
      if (r.matchedCount !== 1) throw new Error('Cadastro não encontrado')
    },
    async apagar(id) { conferir(await (await fonte()).imagens.deleteOne({ _id: id })) },
    async *porPalavra(palavraChave) {
      const cursor = (await fonte()).imagens.find({ palavraChave }, { projection: { _id: 1, cadastroId: 1, publicId: 1, cloudName: 1, palavra: 1, ativo: 1, estado: 1 } }).sort({ _id: 1 }).batchSize(50)
      try { for await (const doc of cursor) yield doc } finally { await cursor.close() }
    },
    async desativarPalavra(palavraChave) {
      conferir(await (await fonte()).imagens.updateMany({ palavraChave }, { $set: { ativo: false } }))
    },
    async sortear(categoria, excluidas = []) {
      const imagens = (await fonte()).imagens
      const filtro = { ativo: true, estado: 'ativo', ...(categoria ? { categoria } : {}), ...(excluidas.length ? { _id: { $nin: excluidas } } : {}) }
      const palavras = await imagens.aggregate([{ $match: filtro }, { $group: { _id: '$palavraChave' } }, { $sample: { size: 1 } }], { maxTimeMS: 5000 }).toArray()
      if (!palavras.length) return null
      const fotos = await imagens.aggregate([{ $match: { ...filtro, palavraChave: palavras[0]._id } }, { $sample: { size: 1 } },
        { $project: { _id: 1, palavra: 1, categoria: 1, publicId: 1, secureUrl: 1, version: 1 } }], { maxTimeMS: 5000 }).toArray()
      return fotos[0] || null
    },
    async listar(pagina) {
      const r = await (await fonte()).imagens.aggregate([
        { $group: { _id: '$palavraChave', palavra: { $first: '$palavra' }, imagens: { $sum: 1 }, ativas: { $sum: { $cond: ['$ativo', 1, 0] } } } },
        { $sort: { _id: 1 } }, { $facet: {
          totais: [{ $group: { _id: null, palavras: { $sum: 1 }, imagens: { $sum: '$imagens' }, ativas: { $sum: '$ativas' } } }],
          itens: [{ $skip: (pagina - 1) * 10 }, { $limit: 10 }]
        } }
      ], { maxTimeMS: 5000, allowDiskUse: true }).toArray()
      return { palavras: 0, imagens: 0, ativas: 0, ...r[0]?.totais?.[0], itens: r[0]?.itens || [] }
    }
  }
}
module.exports = { criarRepositorio, __definirTeste(v) { teste = v } }
