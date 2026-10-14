const conexao = require('./conexao-mongo')
const { resolverIdentidade, erro } = require('./identidade')
const NOME_BANCO = conexao.NOME_BANCO
const NOME_COLECAO = conexao.NOME_COLECAO_PADRAO
let colecaoTeste = null
let contextoTeste = null
function criarJogadorPadrao(jid) {
  return { jid: String(jid || ''), nome: null, genero: null, idade: 18,
    carteira: 0, banco: 0, emprego: null, cargo: 1, xpTrabalho: 0,
    xpTierTotal: 0, empregosAnteriores: [], casado: null, filhos: [],
    casas: [], carros: [], fama: 0, fome: 100, energia: 100,
    preso: false, inventario: [], cooldowns: {}, criadoEm: Date.now() }
}
async function obterColecaoRpg() {
  return colecaoTeste || conexao.obterColecaoRpg()
}
async function usarContextoRpg(fn) {
  if (contextoTeste) return fn(contextoTeste)
  if (colecaoTeste) throw erro('transacao_indisponivel')
  return conexao.usarContextoRpg(async ctx => {
    await conexao.prepararFinanceiro(ctx)
    return fn(ctx)
  })
}
async function localizarJogador(colecao, id, opcoes = {}) {
  const candidatos = await colecao.find(id.filtro, opcoes).limit(2).toArray()
  if (candidatos.length > 1) throw erro('cadastros_ambiguos')
  // Legados associados por prova, mas chave preservada sem renomear.
  return candidatos[0] || null
}
async function obterJogador(colecao, id, opcoes = {}, criar = true) {
  let jogador = await localizarJogador(colecao, id, opcoes)
  if (!jogador && criar) {
    // Sem associação confiável, um legado LID pode ser a mesma pessoa.
    // Bloquear criação é preferível a abrir uma segunda conta.
    const legado = await colecao.findOne({ jid: { $regex: '@lid$' } }, opcoes)
    if (legado) throw erro('legados_pendentes')
    if (!colecaoTeste && !opcoes.session) {
      await conexao.garantirIndiceJogadores(await conexao.obterContextoRpg())
    }
    try {
      const criado = await colecao.updateOne({ jid: id.canonico },
        { $setOnInsert: criarJogadorPadrao(id.canonico) }, { ...opcoes, upsert: true,
          ...(!opcoes.session ? { writeConcern: { w: 'majority', wtimeout: 15000 } } : {}) })
      if (!criado.acknowledged) throw erro('persistencia_indisponivel')
    } catch (err) {
      if (err.code !== 11000 || opcoes.session) throw err
    }
    jogador = await localizarJogador(colecao, id, opcoes)
  }
  return jogador
}
async function getPlayer(jid, participantes = []) {
  const id = await resolverIdentidade(jid, participantes)
  return obterJogador(await obterColecaoRpg(), id)
}
async function resolverJidJogador(jid, participantes = []) {
  return (await resolverIdentidade(jid, participantes)).canonico
}
// Não aceita snapshots: somente identidade pública pode ser alterada.
// Dados desconhecidos já gravados são preservados, nunca regravados.
async function savePlayer(jid, data, participantes = []) {
  if (!data || Object.keys(data).some(k => !['nome', 'genero'].includes(k))) throw erro('campos_protegidos')
  if ('nome' in data && (typeof data.nome !== 'string' || data.nome.trim().length < 2 || data.nome.trim().length > 20)) throw erro('nome_invalido')
  if ('genero' in data && !['M', 'F'].includes(data.genero)) throw erro('genero_invalido')
  const id = await resolverIdentidade(jid, participantes)
  const colecao = await obterColecaoRpg()
  const jogador = await obterJogador(colecao, id)
  const resultado = await colecao.updateOne({ _id: jogador._id, jid: jogador.jid },
    { $set: { ...data } }, { writeConcern: { w: 'majority', wtimeout: 15000 } })
  if (!resultado.acknowledged) throw erro('persistencia_indisponivel')
  if (resultado.matchedCount !== 1) throw erro('jogador_ausente')
  return colecao.findOne({ _id: jogador._id, jid: jogador.jid })
}
async function mergeAtualizacao(jid, data, participantes = []) {
  return savePlayer(jid, data, participantes)
}
// Contrato antigo conservado, mas nenhuma migração/mesclagem é realizada.
async function corrigirJogadoresComLid() {
  const colecao = await obterColecaoRpg()
  const total = await colecao.countDocuments()
  const pendentes = await colecao.countDocuments({ jid: { $regex: '@lid$' } })
  return { somenteDiagnostico: true, bloqueado: true, corrigidos: 0,
    mesclados: 0, naoResolviveis: pendentes, total }
}
function transacaoNaoSuportada(err) {
  return err?.codigo === 'transacao_indisponivel' || err?.code === 40515 || err?.code === 20 ||
    /Transaction numbers are only allowed|transactions are not supported|not supported on standalone|requires a replica set/i.test(String(err?.message || ''))
}
// Executa uma tentativa. Commit ambíguo NUNCA reinicia o callback.
// Cliente e coleções são capturados no mesmo contexto e protegidos por lease.
async function executarTransacaoNoContexto(ctx, fn) {
  let sessao
  try { sessao = ctx.cliente.startSession() } catch (err) {
    if (transacaoNaoSuportada(err)) throw erro('transacao_indisponivel')
    throw erro('resultado_pendente')
  }
  let commitIniciado = false
  try {
    sessao.startTransaction({ readPreference: 'primary', readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority', wtimeout: 15000 }, maxCommitTimeMS: 15000 })
    const retorno = await fn(ctx.jogadores, sessao, ctx.operacoes)
    commitIniciado = true
    await sessao.commitTransaction()
    return { transacional: true, retorno }
  } catch (err) {
    // O driver usa TransientTransactionError para uma transação abortada.
    // UnknownTransactionCommitResult tem precedência: jamais reexecutar.
    const abortada = err.hasErrorLabel?.('TransientTransactionError') &&
      !err.hasErrorLabel?.('UnknownTransactionCommitResult')
    if (commitIniciado && abortada) throw erro('concorrencia_recusada')
    if (commitIniciado && !transacaoNaoSuportada(err)) throw erro('resultado_pendente')
    // Nenhum commit foi enviado: a operação não pode se concluir sozinha.
    // abortTransaction do driver pode suprimir erros de rede; não usamos
    // esse retorno como prova de abort de um commit já iniciado.
    try { await sessao.abortTransaction() } catch { throw erro('resultado_pendente') }
    if (transacaoNaoSuportada(err)) throw erro('transacao_indisponivel')
    if (abortada) throw erro('concorrencia_recusada')
    throw err
  } finally {
    await sessao.endSession().catch(() => {})
  }
}
async function executarTransacao(fn) {
  return usarContextoRpg(ctx => executarTransacaoNoContexto(ctx, fn))
}
function __definirColecaoTeste(colecao) { colecaoTeste = colecao; contextoTeste = null }
function __definirContextoTeste(ctx) { contextoTeste = ctx; colecaoTeste = ctx?.jogadores || null }
module.exports = { getPlayer, savePlayer, mergeAtualizacao, obterColecaoRpg,
  criarJogadorPadrao, resolverJidJogador, localizarJogador, obterJogador,
  corrigirJogadoresComLid, executarTransacao, executarTransacaoNoContexto,
  usarContextoRpg, transacaoNaoSuportada, __definirColecaoTeste,
  __definirContextoTeste, NOME_BANCO, NOME_COLECAO }
