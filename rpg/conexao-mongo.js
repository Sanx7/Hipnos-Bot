// O pool do driver recupera a rede sem trocar o cliente de uma sessão.
const { MongoClient } = require('mongodb')
require('../config')
function nomeBancoDaUri(uri) {
  return String(uri || '').split('://')[1]?.split('@').pop().split('?')[0].split('/')[1] || null
}
const NOME_BANCO = process.env.MONGODB_DB_RPG || nomeBancoDaUri(process.env.MONGO_URI_RPG) || process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO_PADRAO = process.env.MONGODB_COLLECTION_RPG || 'rpgPlayers'
const NOME_OPERACOES = NOME_COLECAO_PADRAO + '_operacoes'
let contexto = null
let inicializando = null
let fechando = null
let emUso = 0
let liberarEspera = null
let criarCliente = (uri, opcoes) => new MongoClient(uri, opcoes)
const indices = new WeakMap()
const financeiro = new WeakMap()

async function obterContextoRpg() {
  if (fechando) await fechando
  if (contexto) return contexto
  if (!inicializando) {
    inicializando = (async () => {
      if (!process.env.MONGO_URI_RPG) throw new Error('RPG_BANCO_INDISPONIVEL')
      const cliente = criarCliente(process.env.MONGO_URI_RPG, {
        serverSelectionTimeoutMS: 15000, socketTimeoutMS: 20000
      })
      try {
        await cliente.connect()
        const banco = cliente.db(NOME_BANCO)
        const jogadores = banco.collection(NOME_COLECAO_PADRAO)
        const operacoes = banco.collection(NOME_OPERACOES)
        contexto = Object.freeze({ cliente, banco, jogadores, operacoes })
        return contexto
      } catch {
        await cliente.close().catch(() => {})
        console.error('[rpg-mongo] conexão indisponível')
        throw new Error('RPG_BANCO_INDISPONIVEL')
      }
    })()
  }
  const promessa = inicializando
  try { return await promessa } finally {
    if (inicializando === promessa) inicializando = null
  }
}
async function garantirIndiceJogadores(ctx) {
  if (!indices.has(ctx)) {
    const promessa = ctx.jogadores.createIndex({ jid: 1 }, { unique: true, name: 'idx_rpg_jid' })
    indices.set(ctx, promessa)
    promessa.catch(() => indices.delete(ctx))
  }
  await indices.get(ctx)
}
async function prepararFinanceiro(ctx) {
  if (!financeiro.has(ctx)) {
    const promessa = (async () => {
      await garantirIndiceJogadores(ctx)
      // Criação explícita fora de transação. Sem TTL: apagar a auditoria
      // reabriria mensagens já processadas. _id tem índice único nativo.
      try { await ctx.banco.createCollection(NOME_OPERACOES) } catch (err) {
        if (err.code !== 48) throw err
      }
    })()
    financeiro.set(ctx, promessa)
    promessa.catch(() => financeiro.delete(ctx))
  }
  await financeiro.get(ctx)
}
async function usarContextoRpg(fn) {
  const ctx = await obterContextoRpg()
  if (fechando) { await fechando; return usarContextoRpg(fn) }
  emUso++
  try { return await fn(ctx) } finally {
    emUso--
    if (!emUso && liberarEspera) { liberarEspera(); liberarEspera = null }
  }
}
async function obterBancoRpg() { return (await obterContextoRpg()).banco }
async function obterColecaoRpg(nome) {
  const ctx = await obterContextoRpg()
  return nome ? ctx.banco.collection(nome) : ctx.jogadores
}
function clienteRpg() { return contexto?.cliente || null }
async function fecharConexaoRpg() {
  if (fechando) return fechando
  fechando = (async () => {
    if (inicializando) await inicializando.catch(() => {})
    if (emUso) await new Promise(resolve => { liberarEspera = resolve })
    const antigo = contexto
    contexto = null
    await antigo?.cliente.close().catch(() => {})
  })()
  try { await fechando } finally { fechando = null }
}
function __definirFabricaTeste(fn) {
  if (contexto || inicializando || fechando || emUso) throw new Error('RPG_CONEXAO_EM_USO')
  criarCliente = fn
}
module.exports = { obterContextoRpg, usarContextoRpg, obterBancoRpg,
  obterColecaoRpg, clienteRpg, fecharConexaoRpg, __definirFabricaTeste,
  garantirIndiceJogadores, prepararFinanceiro,
  NOME_BANCO, NOME_COLECAO_PADRAO, NOME_OPERACOES }
