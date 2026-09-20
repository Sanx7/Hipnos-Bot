// ============================================
// 🚚 migrar-rpg-para-cluster-dedicado.js — CÓPIA (não corte!) do RPG
// ============================================
// Copia os documentos da collection do RPG (rpgPlayers) do cluster
// PRINCIPAL (MONGODB_URI) para o cluster DEDICADO (MONGO_URI_RPG).
//
// ⚠️ ESTA ETAPA NÃO APAGA NADA no cluster principal — é cópia pura, para
//    permitir validação no cluster novo ANTES de qualquer limpeza. A
//    exclusão das collections antigas é decisão manual do dono, feita
//    DEPOIS de confirmar (via /registrar, /ficha, /carteira etc.) que
//    tudo está funcionando no cluster dedicado.
//
// Como funciona:
//   1) Lista as collections do RPG (nome começando com "rpg") no cluster
//      principal — informação p/ garantir que nada ficou de fora;
//   2) Lê os documentos da collection de origem em lotes e regrava no
//      cluster dedicado com bulkWrite(replaceOne, upsert) PRESERVANDO o
//      _id — reexecutar o script é seguro (idempotente, sem duplicar);
//   3) Confere contagens antes/depois e compara uma amostra doc a doc.
//
// Uso (na raiz do projeto):
//   node scripts/migrar-rpg-para-cluster-dedicado.js             → copia
//   node scripts/migrar-rpg-para-cluster-dedicado.js --dry-run   → só lê/relata
//   ... --colecao rpgPlayers                                     (opcional)
//
// Requer no .env: MONGODB_URI (origem) e MONGO_URI_RPG (destino).
// O índice idx_rpg_jid é criado no destino pelo rpg/conexao-mongo.js
// (o MESMO módulo que o bot usa — destino idêntico ao runtime).
// ============================================

require('../config')
const { MongoClient } = require('mongodb')
const conexao = require('../rpg/conexao-mongo')

const dryRun = process.argv.includes('--dry-run')
const indiceColecao = process.argv.indexOf('--colecao')
const NOME_COLECAO = indiceColecao !== -1 && process.argv[indiceColecao + 1]
  ? process.argv[indiceColecao + 1]
  : conexao.NOME_COLECAO_PADRAO

const TAMANHO_LOTE = 500

// Serialização estável (chaves ordenadas) p/ comparar documentos
function jsonEstavel(valor) {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor)
  if (Array.isArray(valor)) return '[' + valor.map(jsonEstavel).join(',') + ']'
  return '{' + Object.keys(valor).sort()
    .map((k) => JSON.stringify(k) + ':' + jsonEstavel(valor[k])).join(',') + '}'
}

async function main() {
  console.log('🚚 MIGRAÇÃO DO RPG → CLUSTER DEDICADO (cópia; o cluster principal NÃO é tocado)')
  console.log(`   Collection: "${NOME_COLECAO}"${dryRun ? '  (MODO DRY-RUN: nada será gravado)' : ''}`)

  const uriOrigem = process.env.MONGODB_URI
  if (!uriOrigem) {
    console.error('❌ MONGODB_URI não configurada — sem ela não dá para LER a origem (cluster principal).')
    process.exit(1)
  }
  if (!process.env.MONGO_URI_RPG) {
    console.error('❌ MONGO_URI_RPG não configurada — defina a connection string do CLUSTER DEDICADO no .env.')
    console.error('   (A MONGODB_URI do cluster principal NÃO deve ser usada como destino do RPG.)')
    if (!dryRun) process.exit(1)
    console.error('   → No modo dry-run seguimos apenas com a leitura da origem.')
  }

  // ── Origem: cluster principal (LEITURA) ──
  // ⚠️ O banco da ORIGEM é o banco PRINCIPAL do bot (MONGODB_DB || "whatsapp")
  // — NÃO o banco do cluster do RPG (conexao.NOME_BANCO pode apontar p/
  // "hipnos-rpg" no cluster NOVO; na origem, o RPG vivia no banco principal).
  const BANCO_ORIGEM = process.env.MONGODB_DB || 'whatsapp'
  const clienteOrigem = new MongoClient(uriOrigem, { serverSelectionTimeoutMS: 15000 })
  await clienteOrigem.connect()
  const bancoOrigem = clienteOrigem.db(BANCO_ORIGEM)
  const colecaoOrigem = bancoOrigem.collection(NOME_COLECAO)
  console.log(`   Origem: cluster principal, banco "${BANCO_ORIGEM}"`)

  // 1) 👀 Collections com cara de RPG no cluster principal (relatório)
  const nomesRpgOrigem = (await bancoOrigem.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => /^rpg/i.test(n))
  console.log(`\n👀 Collections de RPG encontradas no cluster principal: ${nomesRpgOrigem.length ? nomesRpgOrigem.join(', ') : '(nenhuma)'}`)
  const outras = nomesRpgOrigem.filter((n) => n !== NOME_COLECAO)
  if (outras.length) {
    console.log(`   ⚠️ Existem outras collections "rpg*" (${outras.join(', ')}) — este script migra SÓ "${NOME_COLECAO}".`)
    console.log('     ("rpgPlayers_fase2_smoke" é collection descartável do smoke test — não precisa migrar.)')
  }

  const totalOrigem = await colecaoOrigem.countDocuments()
  console.log(`\n📊 Origem (cluster principal): ${totalOrigem} documento(s) em "${NOME_COLECAO}"`)

  if (dryRun) {
    const amostra = await colecaoOrigem.find().limit(5).toArray()
    console.log('\n🔍 Amostra (até 5 documentos, só leitura):')
    for (const doc of amostra) {
      console.log(`   • ${doc.jid || '(sem jid)'} — nome: ${doc.nome || '—'} | carteira: ${doc.carteira ?? 0} | banco: ${doc.banco ?? 0} | criadoEm: ${doc.criadoEm ? new Date(doc.criadoEm).toISOString() : '—'}`)
    }
    console.log('\n✅ Dry-run concluído — nada foi gravado. Rode sem --dry-run p/ copiar.')
    await clienteOrigem.close()
    process.exit(0)
  }

  // ── Destino: cluster DEDICADO (mesma porta de entrada do runtime) ──
  const colecaoDestino = await conexao.obterColecaoRpg(NOME_COLECAO === conexao.NOME_COLECAO_PADRAO ? null : NOME_COLECAO)
  const totalDestinoAntes = await colecaoDestino.countDocuments()
  console.log(`📊 Destino (cluster dedicado): ${totalDestinoAntes} documento(s) ANTES da cópia`)

  // 2) 📋 Cópia em lotes com replaceOne(upsert) — preserva _id e é idempotente
  const cursor = colecaoOrigem.find({}, { batchSize: TAMANHO_LOTE })
  let processados = 0
  let gravados = 0
  let lote = []
  const gravarLote = async () => {
    if (!lote.length) return
    const operacoes = lote.map((doc) => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true }
    }))
    const resultado = await colecaoDestino.bulkWrite(operacoes, { ordered: false })
    gravados += (resultado.upsertedCount || 0) + (resultado.modifiedCount || 0)
    processados += lote.length
    console.log(`   📦 ${processados}/${totalOrigem} documentos copiados...`)
    lote = []
  }

  for await (const doc of cursor) {
    lote.push(doc)
    if (lote.length >= TAMANHO_LOTE) await gravarLote()
  }
  await gravarLote()

  // 3) ✅ Verificação: contagens + amostra doc a doc
  const totalDestinoDepois = await colecaoDestino.countDocuments()
  console.log(`\n📊 Destino DEPOIS da cópia: ${totalDestinoDepois} documento(s)`)

  let divergentes = 0
  const amostra = await colecaoOrigem.find().limit(5).toArray()
  for (const doc of amostra) {
    const noDestino = await colecaoDestino.findOne({ _id: doc._id })
    if (!noDestino || jsonEstavel(noDestino) !== jsonEstavel(doc)) {
      divergentes += 1
      console.error(`   ❌ divergência no doc _id=${doc._id} (jid=${doc.jid})`)
    }
  }

  console.log('\n══════════════════ RESUMO DA MIGRAÇÃO ════════════════')
  console.log(`   Origem (principal) : ${totalOrigem} doc(s)`)
  console.log(`   Destino (dedicado) : ${totalDestinoDepois} doc(s) (antes: ${totalDestinoAntes})`)
  console.log(`   Escritos nesta rodada: ${gravados} | Amostra divergente: ${divergentes}/5`)
  console.log('   🛡️ O cluster principal NÃO foi alterado — cópia, não corte.')
  if (totalDestinoDepois >= totalOrigem && divergentes === 0) {
    console.log('   ✅ Migração consistente. Valide no bot (/ficha, /carteira...) e SÓ DEPOIS')
    console.log('      apague as collections antigas manualmente, se desejar.')
  } else {
    console.log('   ❌ Contagem/divergência indicam cópia incompleta — rode o script de novo (é idempotente).')
  }
  console.log('═══════════════════════════════════════════════════════')

  await clienteOrigem.close()
  await conexao.fecharConexaoRpg()
  process.exit(totalDestinoDepois >= totalOrigem && divergentes === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('❌ FALHA NA MIGRAÇÃO:', err?.message || err)
  process.exit(1)
})