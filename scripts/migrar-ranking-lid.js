// ============================================================
// 🪪 migrar-ranking-lid.js — Funde/renomeia contadores do /ranking gravados sob LID
// ============================================================
// CONTEXTO: até a correção do bot.js (ranking-registro.js), o `usuario_id` do
// documento do ranking era gravado com o `sender` cru do Baileys. Num grupo com
// LID habilitado isso é o LID ("175952680210489"), NÃO o telefone — e como o
// índice único é (grupo_id, usuario_id), a MESMA pessoa podia ter DOIS
// documentos no mesmo grupo: um sob o LID e outro sob o telefone, cada um com
// parte das mensagens.
//
// O que este script faz (para cada documento cujo LID tem PAR COMPROVADO no
// lid-mapping da sessão, no MESMO grupo):
//   • sem documento no telefone → RENOMEIA o `usuario_id` (a contagem fica
//     intacta, nada se perde);
//   • com documento no telefone → FUNDE: apaga o documento do LID capturando o
//     total FINAL (findOneAndDelete) e soma no documento do telefone ($inc),
//     mantendo a data mais nova ($max) e o nome do registro mais recente.
//
// ✳️ É IDEMPOTENTE: rodar de novo não soma nada duas vezes (o documento do LID
//    já não existe). Se o bot estiver rodando no Render e criar o documento do
//    telefone no meio da execução, o índice único devolve E11000 e o script cai
//    sozinho no caminho de fusão.
//
// 🔎 SÓ PARES COMPROVADOS: um LID entra no mapa apenas quando a chave reversa
//    (`lid-mapping-<lid>_reverse` → telefone) E o par direto
//    (`lid-mapping-<telefone>` → o mesmo LID) existem e BATEM. Nada de
//    heurística por tamanho de número. O que não tem prova é mantido como está
//    e contado no relatório (rode de novo depois que a sessão sincronizar).
//
// 🧪 DRY-RUN É O PADRÃO: sem --aplicar o script só imprime o plano
//    (grupo | LID(total) → telefone(total) → renomear/fundir) e o top 10 de
//    cada grupo afetado ANTES/DEPOIS (simulado). Números MASCARADOS (só os 4
//    últimos dígitos). Com --aplicar ele grava um backup JSON dos documentos
//    que serão tocados ANTES de escrever qualquer coisa e só segue se o arquivo
//    foi escrito e reaberto com sucesso.
//
// 🗄️ Usa o MongoDB do bot (MONGODB_URI / db `whatsapp`). Não usa metadados de
//    grupo: lê o lid-mapping OFFLINE da própria sessão.
//
// Uso (na raiz do projeto):
//   node scripts/migrar-ranking-lid.js             # DRY-RUN (não grava nada)
//   node scripts/migrar-ranking-lid.js --aplicar   # grava (com backup antes)
// ============================================================

// Carrega o .env (via config.js) ANTES de qualquer leitura de process.env
require('../config')

const fs = require('fs')
const path = require('path')
const { MongoClient } = require('mongodb')
// limparNumero: MESMA normalização dos dígitos usada no projeto inteiro.
const { limparNumero } = require('../config')

const NOME_BANCO = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO_RANKING = process.env.MONGODB_COLLECTION_RANKING || 'ranking'
const NOME_COLECAO_AUTH = process.env.MONGODB_COLLECTION || 'authState'

// Prefixo/sufixo com que a sessão (sessao-mongo.js) grava o par LID↔telefone.
const PREFIXO_MAPEAMENTO = 'lid-mapping-'
const SUFIXO_REVERSO = '_reverse'
// Campos dedicados em que o envelopamento de leitura da sessão guarda valores
// crus (primitivos e bytes) — ver o cabeçalho do sessao-mongo.js.
const CHAVE_VALOR_CRU = '__rawValue__'
const CHAVE_BUFFER_CRU = '__rawBuffer__'
// Quantos dígitos tem um LID do WhatsApp. Usado SÓ no relatório (para dizer
// quantos documentos ficaram com cara de LID sem prova) — nunca para decidir
// o que migrar.
const TAMANHO_LID = 15

// 🧪 Coleções injetáveis (scripts/teste-migrar-ranking-lid.js): com elas o
// script roda 100% offline, sem tocar em MONGODB_URI.
let rankingInjetada = null
let authInjetada = null

function __definirColecoesTeste ({ ranking, auth } = {}) {
  rankingInjetada = ranking || null
  authInjetada = auth || null
}


// -------------------------------------------------------------------
// 🗄️ obterColecoes(): devolve { ranking, auth, fechar } — as injetadas (teste)
// ou as reais (MongoDB do bot, com ping de saúde). NÃO usa metadados de grupo.
// -------------------------------------------------------------------
async function obterColecoes () {
  if (rankingInjetada && authInjetada) {
    return { ranking: rankingInjetada, auth: authInjetada, fechar: async () => {} }
  }

  const uri = process.env.MONGODB_URI
  if (!uri) {
    throw new Error('MONGODB_URI não configurada — defina no .env (local) ou no painel do Render.')
  }

  const cliente = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
  await cliente.connect()
  await cliente.db('admin').command({ ping: 1 })
  const banco = cliente.db(NOME_BANCO)
  return {
    ranking: banco.collection(NOME_COLECAO_RANKING),
    auth: banco.collection(NOME_COLECAO_AUTH),
    fechar: async () => {
      try { await cliente.close() } catch (err) { /* conexão já morta */ }
    }
  }
}

// -------------------------------------------------------------------
// 🧱 lerValorCru(doc): o valor do lid-mapping na forma em que a sessão o
// guarda (string pura em __rawValue__, bytes em __rawBuffer__ ou o campo
// `valor` de um documento antigo). Devolve string ou null.
// -------------------------------------------------------------------
function lerValorCru (doc) {
  if (doc === null || doc === undefined) return null
  if (typeof doc === 'string') return doc
  if (CHAVE_VALOR_CRU in doc) {
    const valor = doc[CHAVE_VALOR_CRU]
    return valor === null || valor === undefined ? null : String(valor)
  }
  if (CHAVE_BUFFER_CRU in doc) {
    const bytes = doc[CHAVE_BUFFER_CRU]
    if (Buffer.isBuffer(bytes)) return bytes.toString('utf8')
    if (bytes && bytes.buffer) return Buffer.from(bytes.buffer).toString('utf8')
    return null
  }
  if (typeof doc.valor === 'string') return doc.valor
  return null
}

// 🎭 Mascarar um identificador: só os 4 últimos dígitos aparecem.
function mascarar (usuario) {
  const digitos = limparNumero(usuario)
  if (!digitos) {
    return usuario === null || usuario === undefined ? '' : String(usuario)
  }
  return `${'*'.repeat(Math.max(0, digitos.length - 4))}${digitos.slice(-4)}`
}

// -------------------------------------------------------------------
// 🗺️ lerMapeamentoComprovado(auth): mapa LID (dígitos) → telefone (dígitos)
// usando APENAS os pares PROVADOS (reverso e direto batendo).
// -------------------------------------------------------------------
async function lerMapeamentoComprovado (auth) {
  const documentos = await auth.find({ _id: { $regex: /^lid-mapping-/ } }).toArray()

  const diretos = new Map()   // telefone (dígitos) → LID (dígitos)
  const reversos = new Map()  // LID (dígitos) → telefone (dígitos)

  for (const doc of documentos) {
    const chave = String(doc?._id || '').slice(PREFIXO_MAPEAMENTO.length)
    const valor = lerValorCru(doc)
    if (!chave || valor === null) continue

    if (chave.endsWith(SUFIXO_REVERSO)) {
      const lid = limparNumero(chave.slice(0, chave.length - SUFIXO_REVERSO.length))
      const telefone = limparNumero(valor)
      if (lid && telefone) reversos.set(lid, telefone)
    } else {
      const telefone = limparNumero(chave)
      const lid = limparNumero(valor)
      if (telefone && lid) diretos.set(telefone, lid)
    }
  }

  // ✅ Prova dupla: a chave reversa diz o telefone e o par direto desse telefone
  //    aponta de volta para o MESMO LID. Sem isso o LID fica de fora.
  const comprovados = new Map()
  for (const [lid, telefone] of reversos) {
    if (diretos.get(telefone) === lid) comprovados.set(lid, telefone)
  }

  return {
    comprovados,
    paresNaSessao: reversos.size,   // LIDs conhecidos pela sessão
    provados: comprovados.size      // LIDs com prova dupla (só estes são usados)
  }
}

// -------------------------------------------------------------------
// 📋 montarPlano(docs, comprovados): decide, documento a documento, o que
// fazer. NÃO escreve nada — é a base do dry-run e da execução.
//   acao: 'renomear' (só existe o doc do LID) | 'fundir' (existe doc no telefone)
// ⚠️ `semParComprovado` conta os documentos que FICARAM como estão por não
//    terem par comprovado — e aí entram duas situações bem diferentes: LID
//    sem prova (vale rodar de novo quando a sessão sincronizar) e documento
//    que JÁ está gravado pelo telefone (não precisa de nada). Por isso o
//    relatório separa os dois com `possiveisLids` (ids com 15 dígitos, o
//    formato do LID) — é só um PALPITE de relatório, jamais usado para
//    decidir o que migrar: quem decide é a prova dupla do lid-mapping.
// -------------------------------------------------------------------
function montarPlano (docs, comprovados) {
  const chave = (grupo, usuario) => `${grupo}|${limparNumero(usuario)}`
  const porChave = new Map()
  for (const doc of docs) porChave.set(chave(doc.grupo_id, doc.usuario_id), doc)

  const plano = []
  let semParComprovado = 0
  let possiveisLids = 0
  let comMarcaLid = 0

  for (const doc of docs) {
    if (doc.lid) comMarcaLid += 1
    const idCru = limparNumero(doc.usuario_id)
    const telefone = comprovados.get(idCru)
    if (!telefone) {
      // Sem par comprovado na sessão (ou já é um telefone): fica como está.
      if (idCru) {
        semParComprovado += 1
        if (idCru.length === TAMANHO_LID) possiveisLids += 1
      }
      continue
    }
    const alvo = porChave.get(chave(doc.grupo_id, telefone))
    if (alvo && String(alvo._id) === String(doc._id)) continue
    plano.push({ doc, telefone, alvo: alvo || null, acao: alvo ? 'fundir' : 'renomear' })
  }

  return { plano, semParComprovado, possiveisLids, comMarcaLid }
}

// 🔮 simularResultado(docs, plano): como o banco fica DEPOIS (mesmas regras da
// execução real) — só para o dry-run mostrar o top 10 antes/depois.
function simularResultado (docs, plano) {
  const apagados = new Set(
    plano.filter((item) => item.acao === 'fundir').map((item) => String(item.doc._id))
  )
  const resultado = docs
    .filter((doc) => !apagados.has(String(doc._id)))
    .map((doc) => ({ ...doc }))
  const porId = new Map(resultado.map((doc) => [String(doc._id), doc]))

  for (const item of plano) {
    if (item.acao === 'renomear') {
      const destino = porId.get(String(item.doc._id))
      if (destino) destino.usuario_id = item.telefone
      continue
    }
    // 🔀 Fusão: o documento do LID some da lista simulada e o total dele entra no
    //    documento do telefone (o $inc real acontece sobre o total já persistido,
    //    por isso a simulação também usa o $inc e não o total do plano).
    const alvo = item.alvo ? porId.get(String(item.alvo._id)) : null
    if (!alvo) continue
    const total = Number(item.doc.total) || 0
    const ultima = Number(item.doc.ultimaMensagem) || 0
    // Mesmas regras do update real: $inc, $max e nome do mais recente.
    if (ultima >= (Number(alvo.ultimaMensagem) || 0) && item.doc.nome) alvo.nome = item.doc.nome
    alvo.ultimaMensagem = Math.max(Number(alvo.ultimaMensagem) || 0, ultima)
    alvo.total = (Number(alvo.total) || 0) + total
  }

  return resultado
}

// 🏅 Top 10 de um grupo (com os identificadores mascarados).
function topDoGrupo (docs, grupo, limite = 10) {
  return docs
    .filter((doc) => String(doc.grupo_id) === String(grupo))
    .sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0))
    .slice(0, limite)
}


// 🖨️ O plano do dry-run: por documento + top 10 antes/depois dos grupos que
// mudam. Todos os números saem MASCARADOS.
function imprimirPlano ({ plano, docs, documentosDepois, semParComprovado, possiveisLids, comMarcaLid, provados, paresNaSessao }, log) {
  log('🔎 Plano da migração (DRY-RUN)')
  log(`   • documentos no ranking: ${docs.length}`)
  log(`   • LIDs com par comprovado na sessão: ${provados} (de ${paresNaSessao} LIDs conhecidos)`)
  log(`   • documentos com o campo auxiliar "lid": ${comMarcaLid}`)
  log(`   • mantidos sem par comprovado: ${semParComprovado} (${possiveisLids} com cara de LID, o resto já está pelo telefone)`)
  const renomeacoes = plano.filter((i) => i.acao === 'renomear').length
  const fusoes = plano.filter((i) => i.acao === 'fundir').length
  log(`   • documentos a tratar: ${plano.length} (${renomeacoes} renomeação(ões), ${fusoes} fusão(ões))`)
  log('')

  if (!plano.length) {
    log('📭 Nada a fazer: nenhum documento sob chave-LID com par comprovado.')
    return
  }

  const grupos = [...new Set(plano.map((item) => String(item.doc.grupo_id)))]
  for (const grupo of grupos) {
    log(`🗂️ Grupo ${grupo}`)
    for (const item of plano.filter((i) => String(i.doc.grupo_id) === grupo)) {
      const de = `${mascarar(item.doc.usuario_id)}(*${Number(item.doc.total) || 0}*)`
      const destino = item.acao === 'fundir'
        ? `${mascarar(item.telefone)}(*${Number(item.alvo.total) || 0}*)`
        : `${mascarar(item.telefone)}(—)`
      log(`   • LID ${de} → telefone ${destino} → ${item.acao === 'fundir' ? 'FUNDIR (soma)' : 'RENOMEAR'}`)
    }

    log('   📊 TOP 10 ANTES:')
    topDoGrupo(docs, grupo).forEach((doc, indice) => {
      log(`      ${indice + 1}. ${mascarar(doc.usuario_id)} (*${Number(doc.total) || 0}*)`)
    })
    log('   📊 TOP 10 DEPOIS (simulado):')
    topDoGrupo(documentosDepois, grupo).forEach((doc, indice) => {
      log(`      ${indice + 1}. ${mascarar(doc.usuario_id)} (*${Number(doc.total) || 0}*)`)
    })
    log('')
  }
}

// 🖨️ Relatório final (reimpresso no fim, como pede o roteiro).
function imprimirResumo (relatorio, log) {
  log('════════════════════════════════════════════════════════════')
  log(relatorio.aplicar
    ? '✅ Migração do ranking (LID → número real) CONCLUÍDA:'
    : '🧪 DRY-RUN do ranking (LID → número real) — NADA foi gravado:')
  log(`   • fusões: ${relatorio.fusoes}`)
  log(`   • renomeações: ${relatorio.renomeacoes}`)
  if (relatorio.corridas) log(`   • corridas com o bot (E11000 tratado): ${relatorio.corridas}`)
  if (relatorio.backup) log(`   • backup: ${relatorio.backup}`)
  log(`   • mantidos sem par comprovado: ${relatorio.semParComprovado} (${relatorio.possiveisLids} com cara de LID — rode de novo depois que a sessão sincronizar)`)
  if (!relatorio.aplicar && relatorio.plano) {
    log('   → rode com --aplicar para executar (o backup JSON é gravado antes).')
  }
  log('════════════════════════════════════════════════════════════')
}

// 💾 gravarBackup(plano, pasta): exporta os documentos que serão tocados e SÓ
// segue depois de reabrir o arquivo e conferir que está íntegro.
function gravarBackup (plano, pasta) {
  const quando = new Date()
  const marca = quando.toISOString().replace(/[:.]/g, '-')
  const arquivo = path.join(pasta, `backup-ranking-lid-${marca}.json`)
  const conteudo = JSON.stringify({
    quando: quando.toISOString(),
    origem: 'scripts/migrar-ranking-lid.js',
    total: plano.length,
    docs: plano.map((item) => ({ acao: item.acao, telefone: item.telefone, doc: item.doc }))
  }, null, 2)

  fs.writeFileSync(arquivo, conteudo, 'utf8')

  // ✅ Só segue se o arquivo foi escrito E reaberto com sucesso.
  const relido = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
  if (!Array.isArray(relido?.docs) || relido.docs.length !== plano.length) {
    throw new Error(`backup inválido em ${arquivo} — migração abortada por segurança`)
  }
  return arquivo
}


// -------------------------------------------------------------------
// 🔀 fundir(ranking, item): trata UM documento do plano.
//   • Sem documento no telefone  → RENOMEIA o `usuario_id` (a contagem fica
//     intacta: nada de $inc, nada de perda).
//   • Com documento no telefone  → FUNDE: findOneAndDelete no doc do LID (traz
//     o total FINAL, já com as mensagens que chegaram depois do plano),
//     $inc no doc do telefone, $max na data e nome do registro mais recente.
//   • Doc do LID já apagado (rodada anterior) → 'nada' (idempotência).
// -------------------------------------------------------------------
async function fundir (ranking, item) {
  const filtroAlvo = { grupo_id: item.doc.grupo_id, usuario_id: item.telefone }
  const atual = await ranking.findOne(filtroAlvo)

  if (!atual) {
    await ranking.updateOne({ _id: item.doc._id }, { $set: { usuario_id: item.telefone } })
    return { acao: 'renomear', total: Number(item.doc.total) || 0 }
  }

  const apagado = await ranking.findOneAndDelete({ _id: item.doc._id })
  if (!apagado) return { acao: 'nada', total: 0 }

  const total = Number(apagado.total) || 0
  const ultima = Number(apagado.ultimaMensagem) || 0
  const update = { $inc: { total }, $max: { ultimaMensagem: ultima } }
  // 🏷️ Só o registro MAIS RECENTE manda no nome (empate: fica o do LID).
  if (ultima >= (Number(atual.ultimaMensagem) || 0) && apagado.nome) {
    update.$set = { nome: apagado.nome }
  }
  await ranking.updateOne(filtroAlvo, update)
  return { acao: 'fundir', total }
}

// -------------------------------------------------------------------
// 🚀 migrar({ aplicar, pastaBackup, log }): o fluxo inteiro.
//   1) lê o ranking e o lid-mapping da sessão;
//   2) monta o plano e IMPRIME (é o dry-run — mascarado);
//   3) sem --aplicar: para aqui (nada é gravado);
//   4) com --aplicar: backup JSON primeiro, depois executa item a item;
//   5) reimprime o relatório (fusões, renomeações, LIDs sem mapeamento).
// Devolve o relatório (o teste usa isso).
// -------------------------------------------------------------------
async function migrar ({ aplicar = false, pastaBackup = process.cwd(), log = console.log } = {}) {
  const { ranking, auth, fechar } = await obterColecoes()
  try {
    const docs = await ranking.find({}).toArray()
    const { comprovados, paresNaSessao, provados } = await lerMapeamentoComprovado(auth)
    const { plano, semParComprovado, possiveisLids, comMarcaLid } = montarPlano(docs, comprovados)
    const documentosDepois = simularResultado(docs, plano)

    const relatorio = {
      aplicar: false,
      plano: plano.length,
      fusoes: 0,
      renomeacoes: 0,
      corridas: 0,
      semParComprovado,
      possiveisLids,
      comMarcaLid,
      provados,
      paresNaSessao,
      backup: null
    }

    imprimirPlano({ plano, docs, documentosDepois, semParComprovado, possiveisLids, comMarcaLid, provados, paresNaSessao }, log)

    if (!aplicar || !plano.length) {
      imprimirResumo(relatorio, log)
      return relatorio
    }

    // 💾 Backup ANTES de qualquer escrita (e só segue se ele reabriu íntegro).
    relatorio.backup = gravarBackup(plano, pastaBackup)
    relatorio.aplicar = true

    for (const item of plano) {
      let resultado = null
      try {
        resultado = await fundir(ranking, item)
      } catch (err) {
        // 🔁 Corrida com o bot em produção: uma mensagem pode ter criado o
        //    documento do telefone entre a leitura e a escrita → o índice único
        //    idx_ranking_grupo_usuario devolve E11000. Repetir cai na fusão.
        if (err?.code !== 11000) throw err
        relatorio.corridas += 1
        resultado = await fundir(ranking, item)
      }
      if (!resultado || resultado.acao === 'nada') continue
      if (resultado.acao === 'renomear') relatorio.renomeacoes += 1
      else relatorio.fusoes += 1
    }

    imprimirResumo(relatorio, log)
    return relatorio
  } finally {
    await fechar()
  }
}


// 🏁 main(): só roda quando o arquivo é executado direto (o teste importa as
// funções com require e NÃO quer disparar nada).
async function main () {
  const aplicar = process.argv.includes('--aplicar')
  console.log(`🗄️ Destino: db "${NOME_BANCO}", collections "${NOME_COLECAO_RANKING}" + "${NOME_COLECAO_AUTH}"`)
  console.log(aplicar
    ? '⚙️ Modo --aplicar: o plano será EXECUTADO (backup JSON gravado antes).'
    : '🧪 Modo DRY-RUN (padrão): nada será gravado — use --aplicar para executar.')

  try {
    const relatorio = await migrar({ aplicar })
    console.log(
      `ℹ️ Resumo: ${relatorio.fusoes} fusão(ões), ${relatorio.renomeacoes} renomeação(ões), ` +
      `${relatorio.semParComprovado} documento(s) sem par comprovado ` +
      `(${relatorio.possiveisLids} com cara de LID).`
    )
    process.exit(0)
  } catch (err) {
    console.error('❌ Falha na migração do ranking LID→número:', err?.message || err)
    process.exit(1)
  }
}

if (require.main === module) main()

module.exports = {
  NOME_BANCO,
  NOME_COLECAO_RANKING,
  NOME_COLECAO_AUTH,
  __definirColecoesTeste,
  lerValorCru,
  lerMapeamentoComprovado,
  montarPlano,
  simularResultado,
  mascarar,
  gravarBackup,
  fundir,
  migrar
}

