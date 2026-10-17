// Não executar contra produção durante testes. Sem flags, somente auditoria.
const { nomesAfk, prepararColecaoAfk, auditarAfk } = require('../dados/afk-migracao')

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    console.log('Uso: node scripts/migrar-afk-por-grupo.js [--dry-run | --apply]\n--dry-run (padrão): somente contagens/índices.\n--apply: prepara a coleção nova e índice composto, preservando integralmente os legados.\nNenhum registro antigo é atribuído automaticamente a um grupo.')
    return
  }
  if (args.length > 1 || (args.length && !['--dry-run', '--apply'].includes(args[0]))) throw new Error('Argumentos inválidos; use --help')
  require('../config')
  if (!process.env.MONGODB_URI) throw new Error('MongoDB não configurado')
  const { MongoClient } = require('mongodb')
  const cliente = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
  try {
    await cliente.connect()
    const db = cliente.db(process.env.MONGODB_DB || 'whatsapp')
    const base = process.env.MONGODB_COLLECTION_AFK || 'afks'
    const antes = await auditarAfk(db, base)
    if (args[0] === '--apply') await prepararColecaoAfk(db, base)
    console.log(JSON.stringify({ modo: args[0] === '--apply' ? 'apply' : 'dry-run', colecoes: nomesAfk(base), antes,
      depois: args[0] === '--apply' ? await auditarAfk(db, base) : antes }, null, 2))
  } finally { await cliente.close() }
}
if (require.main === module) main().catch(() => { console.error('[afk-migracao] Operação não concluída. Verifique argumentos, conexão e permissões; nenhum legado foi atribuído ou apagado.'); process.exitCode = 1 })
module.exports = { main }
