// Somente o migrador manual utiliza este módulo. Não muda leitores ou escritores do bot.
const { createHash } = require('node:crypto')
const { BSON } = require('mongodb')
const contextos = new WeakMap()
const opcoesTransacao = {
  readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority', wtimeoutMS: 15000 },
  readPreference: 'primary', maxCommitTimeMS: 15000, timeoutMS: 60000
}
function falha(codigo) { return Object.assign(new Error(codigo), { codigo }) }
function confirmado(r, campo) {
  if (r?.acknowledged !== true) throw falha('MIGRACAO_ESCRITA_NAO_CONFIRMADA')
  if (campo && r[campo] !== 1) throw falha('MIGRACAO_DOCUMENTO_ALTERADO')
}
function igual(a, b) { return BSON.serialize({ valor: a }).equals(BSON.serialize({ valor: b })) }
function exato(doc) { return { _id: doc._id, $expr: { $eq: ['$$ROOT', { $literal: doc }] } } }
function contador(doc) {
  const n = doc.total === undefined ? 0 : doc.total
  if (!Number.isSafeInteger(n) || n < 0) throw falha('MIGRACAO_CONTAGEM_INVALIDA')
  return n
}
function momento(doc) {
  const n = doc.ultimaMensagem === undefined ? 0 : doc.ultimaMensagem
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw falha('MIGRACAO_DATA_INVALIDA')
  return n
}
function chave(item) {
  if (!item?.doc?._id || typeof item.doc.grupo_id !== 'string' ||
      !/^\d+$/.test(item.doc.usuario_id) || !/^\d+$/.test(item.telefone) || item.doc.usuario_id === item.telefone) throw falha('MIGRACAO_ITEM_INVALIDO')
  return createHash('sha256').update(BSON.serialize({ origem: item.doc._id, grupo: item.doc.grupo_id,
    usuario: item.doc.usuario_id, destino: item.telefone })).digest('hex')
}
function registrarContexto(ranking, contexto) { contextos.set(ranking, contexto) }
function validarOrigem(origem, item) {
  if (!origem) return false
  if (origem.grupo_id !== item.doc.grupo_id) throw falha('MIGRACAO_IDENTIDADE_ALTERADA')
  if (origem.usuario_id === item.telefone) return false // Renomeação anterior já concluída.
  if (origem.usuario_id !== item.doc.usuario_id) throw falha('MIGRACAO_IDENTIDADE_ALTERADA')
  contador(origem); momento(origem)
  return true
}
function atualizacao(origem, destino) {
  const total = contador(origem), anterior = contador(destino)
  if (!Number.isSafeInteger(total + anterior)) throw falha('MIGRACAO_CONTAGEM_INVALIDA')
  const data = momento(origem), dataDestino = momento(destino), set = Object.create(null)
  // Campos conflitantes continuam no destino; as duas versões completas ficam no diário.
  for (const [campo, valor] of Object.entries(origem)) {
    if (['_id', 'grupo_id', 'usuario_id', 'total', 'ultimaMensagem', 'nome', '_migracoesRankingLid'].includes(campo)) continue
    if (!campo.includes('.') && !campo.startsWith('$') && destino[campo] === undefined) set[campo] = valor
  }
  if (data >= dataDestino && origem.nome) set.nome = origem.nome
  return { $inc: { total }, $max: { ultimaMensagem: data }, ...(Object.keys(set).length ? { $set: set } : {}) }
}
function recibo(id, origem, destino, telefone, acao, modo) {
  return { _id: id, estado: 'concluida', modo, acao, total: contador(origem), telefone,
    origem, destinoAntes: destino, concluidaEm: new Date() }
}
function conferirRecibo(doc, item) {
  if (!doc?.origem || !igual(doc.origem._id, item.doc._id) || doc.origem.grupo_id !== item.doc.grupo_id ||
      doc.origem.usuario_id !== item.doc.usuario_id || doc.telefone !== item.telefone) throw falha('MIGRACAO_DIARIO_DIVERGENTE')
}
async function transacional(ranking, item, ctx, id) {
  let tentativas = 0
  for (let corrida = 0; corrida < 3; corrida++) {
    const session = ctx.cliente.startSession()
    try {
      const resultado = await session.withTransaction(async () => {
        tentativas++
        const opts = { session }
        const anterior = await ctx.diario.findOne({ _id: id }, opts)
        if (anterior) {
          conferirRecibo(anterior, item)
          if (anterior.estado !== 'concluida') throw falha('MIGRACAO_RETOMADA_OFFLINE_NECESSARIA')
          return { acao: 'nada', total: 0 }
        }
        const origem = await ranking.findOne({ _id: item.doc._id }, opts)
        if (!validarOrigem(origem, item)) return { acao: 'nada', total: 0 }
        const destino = await ranking.findOne({ grupo_id: origem.grupo_id, usuario_id: item.telefone }, opts)
        const acao = destino ? 'fundir' : 'renomear'
        if (!destino) {
          confirmado(await ranking.updateOne(exato(origem), { $set: { usuario_id: item.telefone } }, opts), 'matchedCount')
        } else {
          confirmado(await ranking.updateOne(exato(destino), atualizacao(origem, destino), opts), 'matchedCount')
          confirmado(await ranking.deleteOne(exato(origem), opts), 'deletedCount')
        }
        confirmado(await ctx.diario.insertOne(recibo(id, origem, destino, item.telefone, acao, 'transacao'), opts))
        return { acao, total: contador(origem) }
      }, opcoesTransacao)
      if (!resultado) throw falha('MIGRACAO_RESULTADO_INCERTO')
      return { ...resultado, corridas: tentativas - 1 }
    } catch (e) {
      // Um commit ambíguo nunca vira uma execução não transacional.
      if (e.hasErrorLabel?.('UnknownTransactionCommitResult')) throw falha('MIGRACAO_COMMIT_INCERTO')
      if (e.code !== 11000 || corrida === 2) throw e
    } finally { await session.endSession() }
  }
}
async function concluirOffline(diario, doc) {
  confirmado(await diario.updateOne({ _id: doc._id, estado: 'preparada' },
    { $set: { estado: 'concluida', concluidaEm: new Date() } }), 'matchedCount')
  return { acao: doc.acao, total: contador(doc.origem), corridas: 0 }
}
async function offline(ranking, item, ctx, id) {
  let doc = await ctx.diario.findOne({ _id: id })
  if (!doc) {
    const origem = await ranking.findOne({ _id: item.doc._id })
    if (!validarOrigem(origem, item)) return { acao: 'nada', total: 0 }
    const destino = await ranking.findOne({ grupo_id: origem.grupo_id, usuario_id: item.telefone })
    if (destino) atualizacao(origem, destino) // Validar antes de reservar ou alterar contadores.
    doc = { ...recibo(id, origem, destino, item.telefone, destino ? 'fundir' : 'renomear', 'offline'),
      estado: 'preparada', concluidaEm: null }
    // Snapshot durável antes de qualquer alteração. Não usar o snapshot antigo do plano.
    confirmado(await ctx.diario.insertOne(doc))
  }
  conferirRecibo(doc, item)
  if (doc.estado === 'concluida') return { acao: 'nada', total: 0 }
  if (doc.estado !== 'preparada' || doc.modo !== 'offline') throw falha('MIGRACAO_DIARIO_DIVERGENTE')
  let origem = await ranking.findOne({ _id: doc.origem._id })
  if (doc.acao === 'renomear') {
    if (origem && origem.usuario_id === doc.telefone && origem.grupo_id === doc.origem.grupo_id) return concluirOffline(ctx.diario, doc)
    if (!igual(origem, doc.origem)) throw falha('MIGRACAO_ORIGEM_ALTERADA_MANTENHA_BOT_PARADO')
    confirmado(await ranking.updateOne(exato(origem), { $set: { usuario_id: doc.telefone } }), 'matchedCount')
    return concluirOffline(ctx.diario, doc)
  }
  let destino = await ranking.findOne({ _id: doc.destinoAntes._id })
  if (!destino || destino.grupo_id !== doc.origem.grupo_id || destino.usuario_id !== doc.telefone) throw falha('MIGRACAO_DESTINO_ALTERADO')
  const campo = `_migracoesRankingLid.${id}`
  const marcador = destino._migracoesRankingLid?.[id]
  if (marcador !== undefined && marcador !== contador(doc.origem)) throw falha('MIGRACAO_MARCADOR_DIVERGENTE')
  if (marcador === undefined) {
    if (!igual(origem, doc.origem)) throw falha('MIGRACAO_ORIGEM_ALTERADA_MANTENHA_BOT_PARADO')
    if (!igual(destino, doc.destinoAntes)) throw falha('MIGRACAO_DESTINO_ALTERADO')
    const update = atualizacao(doc.origem, destino)
    update.$set = { ...update.$set, [campo]: contador(doc.origem) }
    // Crédito e comprovante na MESMA escrita atômica. Repetir não credita novamente.
    confirmado(await ranking.updateOne({ ...exato(destino), [campo]: { $exists: false } }, update), 'matchedCount')
  }
  // Confirmação por leitura primária/majority antes de remover a origem.
  destino = await ranking.findOne({ _id: doc.destinoAntes._id })
  if (!destino || destino.grupo_id !== doc.origem.grupo_id || destino.usuario_id !== doc.telefone) throw falha('MIGRACAO_DESTINO_ALTERADO')
  if (destino?._migracoesRankingLid?.[id] !== contador(doc.origem)) throw falha('MIGRACAO_CREDITO_NAO_CONFIRMADO')
  origem = await ranking.findOne({ _id: doc.origem._id })
  if (origem) {
    if (!igual(origem, doc.origem)) throw falha('MIGRACAO_ORIGEM_ALTERADA_MANTENHA_BOT_PARADO')
    confirmado(await ranking.deleteOne(exato(doc.origem)), 'deletedCount')
  }
  return concluirOffline(ctx.diario, doc)
}
async function fundirSeguro(ranking, item, { offlineConfirmado = false } = {}) {
  const ctx = contextos.get(ranking), id = chave(item)
  if (!ctx?.cliente?.startSession || !ctx.diario) throw falha('MIGRACAO_CONTEXTO_TRANSACIONAL_AUSENTE')
  // Diário de fallback pendente deve ser retomado mesmo se a topologia mudou.
  const pendente = await ctx.diario.findOne({ _id: id })
  if (pendente?.estado === 'preparada') {
    if (!offlineConfirmado) throw falha('MIGRACAO_RETOMADA_OFFLINE_NECESSARIA')
    return offline(ranking, item, ctx, id)
  }
  try { return await transacional(ranking, item, ctx, id) }
  catch (e) {
    if (![20, 303].includes(e.code)) throw e
    if (!offlineConfirmado) throw falha('MIGRACAO_REQUER_TRANSACOES_OU_OFFLINE_CONFIRMADO')
    return offline(ranking, item, ctx, id)
  }
}
module.exports = { fundirSeguro, registrarContexto, igual }
