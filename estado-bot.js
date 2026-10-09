// Estado GLOBAL de uso do bot. Mesmo MongoDB principal, documento único.
// Ausência do documento = ligado; falha de leitura = bloqueado, com retentativa.
const { MongoClient } = require('mongodb')
const { OWNER_NUMBERS, limparNumero } = require('./config')
const { ehLid, resolverNumeroAlvo } = require('./lid')

let cliente = null
let conexao = null
let colecaoTeste = null
let cache = null
let leitura = null
let retentarEm = 0
let revisao = 0

async function obterColecao() {
  if (colecaoTeste) return colecaoTeste
  if (!conexao) {
    conexao = (async () => {
      if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI ausente')
      const novoCliente = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
      try {
        await novoCliente.connect()
        cliente = novoCliente
        return cliente.db(process.env.MONGODB_DB || 'whatsapp').collection('estadoBot')
      } catch (erro) {
        await novoCliente.close().catch(() => {})
        throw erro
      }
    })()
    conexao.catch(() => { conexao = null })
  }
  return conexao
}

async function obterLigado() {
  if (cache !== null) return cache
  if (Date.now() < retentarEm) return false
  if (leitura) return leitura
  const versao = revisao
  leitura = (async () => {
    try {
      const colecao = await obterColecao()
      const doc = await colecao.findOne({ _id: 'global' })
      if (doc && typeof doc.ligado !== 'boolean') throw new Error('Estado do bot inválido')
      if (revisao === versao) cache = doc ? doc.ligado : true
      retentarEm = 0
      return cache === true
    } catch (_) {
      // Não imprimir erro do driver: pode conter detalhes da conexão.
      console.error('[estado-bot] Falha ao consultar MongoDB; uso geral bloqueado até recuperar o estado.')
      retentarEm = Date.now() + 60000
      return cache === true
    } finally {
      leitura = null
    }
  })()
  return leitura
}

async function definirLigado(ligado) {
  if (typeof ligado !== 'boolean') throw new TypeError('ligado deve ser boolean')
  const colecao = await obterColecao()
  await colecao.updateOne(
    { _id: 'global' },
    { $set: { ligado, atualizado_em: Date.now() } },
    { upsert: true }
  )
  // Só confirma em memória DEPOIS de persistir. Invalida leituras anteriores.
  revisao++
  cache = ligado
  retentarEm = 0
}

// Compartilhado pelo handler e /on /off. Nunca compara LID cru com telefone.
async function obterNumeroDono(sock, jid, sender) {
  try {
    let participantes = []
    if (ehLid(sender) && String(jid || '').endsWith('@g.us')) {
      try { participantes = (await sock.groupMetadata(jid))?.participants || [] } catch (_) { /* tenta sessão */ }
      // Não casar os dígitos de um LID com o phoneNumber de outra pessoa.
      participantes = participantes.filter(p => ehLid(p?.id) && limparNumero(p.id) === limparNumero(sender))
    }
    const alvo = await resolverNumeroAlvo(participantes, sender)
    return alvo.via && OWNER_NUMBERS.includes(alvo.numero) ? alvo.numero : null
  } catch (_) {
    return null
  }
}

async function remetenteEhDono(sock, jid, sender) {
  return Boolean(await obterNumeroDono(sock, jid, sender))
}

async function permitirMensagem(sock, jid, sender) {
  if (await obterLigado()) return true
  return remetenteEhDono(sock, jid, sender)
}

module.exports = {
  obterLigado,
  definirLigado,
  remetenteEhDono,
  obterNumeroDono,
  permitirMensagem,
  // Coleção offline e reinício do cache para testar persistência sem rede.
  __definirColecaoTeste(colecao) {
    colecaoTeste = colecao
    cache = null
    leitura = null
    retentarEm = 0
    revisao++
  }
}
