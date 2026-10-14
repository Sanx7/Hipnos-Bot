// Cópia bloqueada. --dry-run SOMENTE consulta contagens, não comprova
// integridade/equivalência nem altera índices, jogadores ou coleções.
if (!process.argv.includes('--dry-run')) {
  console.error('RPG: migração bloqueada. Use --dry-run somente para diagnóstico; nenhuma cópia será executada.')
  process.exitCode = 1
} else {
  require('../config')
  const { MongoClient } = require('mongodb')
  const conexao = require('../rpg/conexao-mongo')
  const pos = process.argv.indexOf('--colecao')
  const nome = pos >= 0 ? process.argv[pos + 1] : conexao.NOME_COLECAO_PADRAO
  async function main() {
    let origem, destino
    try {
      if (!nome || !/^[a-zA-Z0-9_-]+$/.test(nome) || !process.env.MONGODB_URI || !process.env.MONGO_URI_RPG) throw new Error('configuração indisponível')
      origem = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
      destino = new MongoClient(process.env.MONGO_URI_RPG, { serverSelectionTimeoutMS: 15000 })
      await origem.connect()
      await destino.connect()
      const a = origem.db(process.env.MONGODB_DB || 'whatsapp').collection(nome)
      const b = destino.db(conexao.NOME_BANCO).collection(nome)
      console.log('RPG: diagnóstico somente leitura, sem cópia.')
      console.log('Documentos na origem:', await a.countDocuments({}))
      console.log('Documentos no destino:', await b.countDocuments({}))
      console.log('LIDs legados no destino:', await b.countDocuments({ jid: { $regex: '@lid$' } }))
      console.log('Contagens não comprovam integridade ou equivalência. Reconciliação permanece bloqueada.')
    } catch {
      console.error('RPG: diagnóstico indisponível; nenhuma cópia executada.')
      process.exitCode = 1
    } finally {
      await origem?.close().catch(() => {})
      await destino?.close().catch(() => {})
    }
  }
  main()
}
