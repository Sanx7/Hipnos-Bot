const { MongoClient } = require('mongodb')
let conexao
async function obterColecao() {
  if (!conexao) {
    conexao = (async () => {
      if (!process.env.MONGODB_URI) throw new Error('MongoDB indisponível')
      const cliente = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
      try {
        await cliente.connect()
        return cliente.db(process.env.MONGODB_DB || 'whatsapp').collection('nukeOperacoes', {
          writeConcern: { w: 'majority' }, readConcern: { level: 'majority' }, readPreference: 'primary'
        })
      } catch (erro) { await cliente.close().catch(() => {}); throw erro }
    })()
    conexao.catch(() => { conexao = null })
  }
  return conexao
}

function criarRepositorio(obter = obterColecao) {
  return {
    async configurar(grupo, habilitado, agora) {
      const r = await (await obter()).updateOne({ _id: grupo }, {
        $set: { habilitado, travaAtualizadaEm: agora,
          ...(!habilitado ? { cancelar: true, codigoHash: null } : {}) },
        $setOnInsert: { estado: 'inativa', emVoo: false }
      }, { upsert: true })
      if (!r.acknowledged || !(r.matchedCount || r.upsertedCount)) throw new Error('Configuração não confirmada')
    },
    async reservar(doc, agora) {
      const col = await obter()
      // _id fornece exclusão mútua atômica. Execuções em curso NÃO expiram:
      // assumir uma operação abandonada poderia sobrepor uma chamada em voo.
      // Configurar cria o documento. Reservar nunca usa upsert: ele poderia
      // criar uma configuração habilitada ao aplicar o filtro a um grupo novo.
      const r = await col.updateOne({ _id: doc._id, habilitado: true, $or: [
          { estado: { $in: ['inativa', 'concluida', 'cancelada', 'interrompida', 'expirada'] }, emVoo: false },
          { estado: 'pendente', expiraEm: { $lte: agora } }
        ] }, { $set: doc })
      if (!r.acknowledged) throw new Error('Reserva não confirmada')
      return r.matchedCount === 1
    },
    async ler(grupo) { return (await obter()).findOne({ _id: grupo }) },
    async alterar(grupo, filtro, valores) {
      const r = await (await obter()).updateOne({ _id: grupo, ...filtro }, { $set: valores })
      if (!r.acknowledged) throw new Error('Escrita MongoDB não confirmada')
      return r.matchedCount === 1
    },
    async registrar(doc) {
      const r = await (await obter()).updateOne({ _id: `execucao:${doc.operacao}` }, { $set: doc }, { upsert: true })
      if (!r.acknowledged) throw new Error('Auditoria não confirmada')
    }
  }
}
module.exports = { criarRepositorio }
