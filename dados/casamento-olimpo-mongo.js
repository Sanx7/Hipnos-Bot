// Pedido e união compartilham a reserva global dos dois telefones comprovados.
const { MongoClient } = require('mongodb')
require('../config')
let conexao
async function obterColecao() {
  if (!conexao) {
    conexao = (async () => {
      if (!process.env.MONGODB_URI) throw new Error('CASAMENTO_INDISPONIVEL')
      // Pool próprio reutilizado: outros sistemas não expõem um cliente comum.
      const cliente = new MongoClient(process.env.MONGODB_URI, {
        maxPoolSize: 4, minPoolSize: 0, maxConnecting: 1, maxIdleTimeMS: 60000,
        waitQueueTimeoutMS: 5000, connectTimeoutMS: 10000,
        serverSelectionTimeoutMS: 10000, socketTimeoutMS: 20000, timeoutMS: 30000
      })
      try {
        await cliente.connect()
        const col = cliente.db(process.env.MONGODB_DB || 'whatsapp').collection('casamentosOlimpo', {
          writeConcern: { w: 'majority', wtimeoutMS: 15000 },
          readConcern: { level: 'majority' }, readPreference: 'primary'
        })
        await preparar(col)
        return col
      } catch (erro) { await cliente.close().catch(() => {}); throw erro }
    })()
    conexao.catch(() => { conexao = null })
  }
  return conexao
}
async function preparar(col) {
  await col.createIndex({ participantes: 1 }, { name: 'idx_casamento_participante_reservado',
    unique: true, partialFilterExpression: { bloqueiaParticipantes: true } })
  await col.createIndex({ destinatario: 1, grupoOrigem: 1, estado: 1 }, { name: 'idx_casamento_pedido' })
}
function confirmado(r) {
  if (!r.acknowledged) throw new Error('CASAMENTO_RESULTADO_INCERTO')
  return r
}
function chaveHistorico(id) {
  const chave = String(id).match(/^[a-z]+:([a-f0-9]{64})$/)?.[1]
  if (!chave) throw new Error('RELACIONAMENTO_OPERACAO_INVALIDA')
  return chave
}
function visaoConversao(doc, pedido) {
  return { ...doc, ...pedido, _id: doc._id, conversao: true, pedidoCasamentoId: pedido._id }
}
function criarRepositorio(obter = obterColecao) {
  return {
    async expirar(numeros) {
      const col = await obter()
      confirmado(await col.updateMany({ participantes: { $in: numeros }, estado: 'pendente', bloqueiaParticipantes: true,
        $expr: { $lte: ['$expiraEm', '$$NOW'] } }, [{ $set: {
        estado: 'expirado', bloqueiaParticipantes: false, encerradoEm: '$expiraEm'
      } }]))
      const namoros = await col.aggregate([{ $match: { participantes: { $in: numeros }, modalidade: 'namoro',
        estado: 'ativo', bloqueiaParticipantes: true, 'pedidoCasamento.estado': 'pendente',
        $expr: { $lte: ['$pedidoCasamento.expiraEm', '$$NOW'] } } }]).toArray()
      for (const namoro of namoros) {
        const pedido = namoro.pedidoCasamento, historico = `pedidosCasamento.${chaveHistorico(pedido._id)}`
        confirmado(await col.updateOne({ _id: namoro._id, estado: 'ativo', modalidade: 'namoro',
          'pedidoCasamento._id': pedido._id, 'pedidoCasamento.estado': 'pendente',
          $expr: { $lte: ['$pedidoCasamento.expiraEm', '$$NOW'] } }, [{ $set: {
          'pedidoCasamento.estado': 'expirado', 'pedidoCasamento.encerradoEm': '$pedidoCasamento.expiraEm',
          [`${historico}.estado`]: 'expirado', [`${historico}.encerradoEm`]: '$pedidoCasamento.expiraEm'
        } }]))
      }
    },
    async pedir(doc) {
      const col = await obter()
      if (doc.modalidade !== 'namoro') {
        const existente = await col.findOne({ _id: doc._id })
        if (existente && existente.conversaoPara !== 'casamento') return existente
        let namoro = await col.findOne(existente ? { _id: existente.pedidoId }
          : { participantes: doc.solicitante, modalidade: 'namoro', estado: 'ativo', bloqueiaParticipantes: true })
        if (existente && !namoro) return null
        if (namoro) {
          if (!namoro.participantes.includes(doc.destinatario) || !namoro.participantes.includes(doc.solicitante)) return null
          const historico = `pedidosCasamento.${chaveHistorico(doc._id)}`
          // Fixa o pedido ao namoro original antes da transição. Uma falha
          // intermediária não permite que o replay atinja um namoro posterior.
          if (!existente) {
            try {
              confirmado(await col.updateOne({ _id: doc._id }, { $setOnInsert: {
                tipo: 'operacao', conversaoPara: 'casamento', pedidoId: namoro._id
              } }, { upsert: true }))
            } catch (erro) { if (erro.code !== 11000) throw erro }
          }
          const recibo = existente || await col.findOne({ _id: doc._id })
          if (recibo?.conversaoPara !== 'casamento') return null
          namoro = await col.findOne({ _id: recibo.pedidoId })
          if (!namoro) return null
          const anterior = namoro.pedidosCasamento?.[chaveHistorico(doc._id)]
          if (anterior) return anterior.estado === 'rejeitado_conflito' ? null : visaoConversao(namoro, anterior)
          const pedido = { _id: { $literal: doc._id }, solicitante: { $literal: doc.solicitante },
            destinatario: { $literal: doc.destinatario }, grupoOrigem: { $literal: doc.grupoOrigem },
            jidsParticipantes: { $literal: doc.jidsParticipantes }, estado: 'pendente',
            criadoEm: '$$NOW', expiraEm: { $add: ['$$NOW', 300000] } }
          // Decide pedido ou conflito na mesma escrita. Um erro de transporte
          // não vira rejeição: somente o resultado persistido pode decidi-la.
          const ocupado = { $eq: ['$pedidoCasamento.estado', 'pendente'] }
          confirmado(await col.updateOne({ _id: namoro._id, modalidade: 'namoro', estado: 'ativo',
            bloqueiaParticipantes: true, [historico]: { $exists: false } }, [{ $set: {
            pedidoCasamento: { $cond: [ocupado, '$pedidoCasamento', pedido] },
            [historico]: { $cond: [ocupado, { ...pedido, estado: 'rejeitado_conflito', encerradoEm: '$$NOW' }, pedido] }
          } }]))
          const atual = await col.findOne({ _id: namoro._id })
          const salvo = atual?.pedidosCasamento?.[chaveHistorico(doc._id)]
          return salvo && salvo.estado !== 'rejeitado_conflito' ? visaoConversao(atual, salvo) : null
        }
      }
      // Pipeline mantém as datas originais mesmo no reprocessamento da mensagem.
      try {
        confirmado(await col.updateOne({ _id: doc._id }, [{ $replaceWith: {
          $cond: [{ $eq: [{ $type: '$tipo' }, 'missing'] },
            { $mergeObjects: [{ $literal: doc }, { criadoEm: '$$NOW',
              expiraEm: { $add: ['$$NOW', 300000] } }] }, '$$ROOT']
        } }], { upsert: true }))
      } catch (erro) {
        if (erro.code !== 11000) throw erro
        const anterior = await col.findOne({ _id: doc._id })
        if (anterior) return anterior
        return null // Outro pedido/união possui um dos participantes.
      }
      return col.findOne({ _id: doc._id })
    },
    async vincular(chave, filtro, permitirConversao = false) {
      const col = await obter()
      // Recibo persistente fixa a mensagem ao documento original. Um replay
      // de /divorciar ou /aceitar jamais atinge uma união/pedido posterior.
      let recibo = await col.findOne({ _id: chave })
      if (!recibo) {
        let candidato = await col.findOne(filtro)
        let pedidoCasamentoId = null
        if (!candidato && permitirConversao) {
          candidato = await col.findOne({ participantes: filtro.destinatario, modalidade: 'namoro', estado: 'ativo', bloqueiaParticipantes: true,
            'pedidoCasamento.destinatario': filtro.destinatario, 'pedidoCasamento.grupoOrigem': filtro.grupoOrigem,
            'pedidoCasamento.estado': 'pendente' })
          pedidoCasamentoId = candidato?.pedidoCasamento?._id || null
        }
        try {
          confirmado(await col.updateOne({ _id: chave }, { $setOnInsert: {
            tipo: 'operacao', pedidoId: candidato?._id || null, pedidoCasamentoId
          } }, { upsert: true }))
        } catch (erro) { if (erro.code !== 11000) throw erro }
        recibo = await col.findOne({ _id: chave })
      }
      if (!recibo) throw new Error('CASAMENTO_RESULTADO_INCERTO')
      if (!recibo.pedidoId) return null // Uma decisão sem pedido também não vale para pedidos futuros.
      const doc = await col.findOne({ _id: recibo.pedidoId })
      if (!doc || !recibo.pedidoCasamentoId) return doc
      const pedido = doc.pedidosCasamento?.[chaveHistorico(recibo.pedidoCasamentoId)]
      return pedido ? visaoConversao(doc, pedido) : null
    },
    async transicionar(id, filtro, valores) {
      const col = await obter()
      const r = confirmado(await col.updateOne({ _id: id, ...filtro }, [{ $set: valores }]))
      return r.matchedCount === 1 ? col.findOne({ _id: id }) : null
    },
    async ajustarInicio(id, numero, operacao, data) {
      const col = await obter(), campo = `ajustesInicio.${chaveHistorico(operacao)}`
      const inicioDia = new Date(+data - 9 * 60 * 60 * 1000)
      const dataPermitida = { $gte: ['$$NOW', inicioDia] }
      confirmado(await col.updateOne({ _id: id, participantes: numero, modalidade: { $ne: 'namoro' },
        estado: 'ativo', bloqueiaParticipantes: true, [campo]: { $exists: false } }, [{ $set: {
        inicioRelacionamentoEm: { $cond: [dataPermitida, { $literal: data }, '$inicioRelacionamentoEm'] },
        [campo]: { data: { $literal: data }, ajustadoEm: '$$NOW', ajustadoPor: { $literal: numero },
          resultado: { $cond: [dataPermitida, 'aplicado', 'rejeitado_data_futura'] } }
      } }]))
      const doc = await col.findOne({ _id: id, participantes: numero })
      const ajuste = doc?.ajustesInicio?.[chaveHistorico(operacao)]
      // Auditorias antigas, que não tinham resultado, eram apenas de sucesso.
      return Boolean(ajuste && (ajuste.resultado === undefined || ajuste.resultado === 'aplicado'))
    },
    async consultar(numero, modalidade = 'casamento') {
      const col = await obter()
      const docs = await col.aggregate([{ $match: { participantes: numero, estado: 'ativo',
        bloqueiaParticipantes: true, modalidade: modalidade === 'namoro' ? 'namoro' : { $ne: 'namoro' }
      } }, { $set: { consultadoEm: '$$NOW' } }]).toArray()
      if (docs.length > 1) throw new Error('CASAMENTO_ESTADO_INVALIDO')
      return docs[0] || null
    }
  }
}
module.exports = { criarRepositorio, preparar }
