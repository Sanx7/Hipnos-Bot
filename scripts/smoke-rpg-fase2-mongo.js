// ============================================
// 🧪 smoke-rpg-fase2-mongo.js — Prova REAL (MongoDB) da Fase 2 do RPG
// ============================================
// scripts/teste-rpg-fase2.js roda 100% offline com collection fake — ótimo
// para regressão rápida, mas NÃO prova o comportamento do motor do Mongo.
// Este smoke test roda os 4 comandos contra o MongoDB REAL do CLUSTER
// DEDICADO do RPG (MONGO_URI_RPG — via rpg/conexao-mongo.js), usando uma
// COLLECTION DESCARTÁVEL ("rpgPlayers_fase2_smoke"), então
// valida:
//   - $inc duplo (carteira ↔ banco) e filtro condicional $gte no motor real;
//   - upsert de jogador novo (alvo que nunca usou o RPG);
//   - a TRANSAÇÃO real de executarTransacao (com cliente ativo!) e o
//     ROLLBACK quando o débito não casa — nada é debitado sem creditar.
// A collection de teste é APAGADA no fim (nunca toca os jogadores reais).
//
// Uso (na raiz do projeto):  node scripts/smoke-rpg-fase2-mongo.js
// ============================================

// Carrega o .env (via config.js) ANTES de ler process.env
require('../config')

// 🧪 Collection descartável: definida ANTES de carregar o rpg/database
process.env.MONGODB_COLLECTION_RPG = 'rpgPlayers_fase2_smoke'

const rpg = require('../rpg/database')
const { formatarReais, transferirEntreJogadores } = require('../rpg/economia')
const { executar: carteiraComando } = require('../comandos/rpg/carteira')
const { executar: depositarComando } = require('../comandos/rpg/depositar')
const { executar: sacarComando } = require('../comandos/rpg/sacar')
const { executar: transferirComando } = require('../comandos/rpg/transferir')

const A = '5511900000001@s.whatsapp.net'
const B = '5511900000002@s.whatsapp.net'
const GRUPO = '12036@g.us'

const enviados = []
const sockFake = {
  async sendMessage(jid, conteudo) {
    enviados.push({ jid, texto: conteudo?.text || '' })
    return {}
  },
  async groupMetadata() {
    return { participants: [{ id: A }] }
  }
}
const msgDe = (sender, contextInfo) => ({
  key: { remoteJid: GRUPO, participant: sender },
  message: { extendedTextMessage: { text: 'x', ...(contextInfo ? { contextInfo } : {}) } }
})
const ultimo = () => enviados.at(-1).texto

let ok = 0
let falhou = 0
function checar(rotulo, condicao) {
  if (condicao) { ok += 1; console.log('✅', rotulo) } else { falhou += 1; console.log('❌', rotulo) }
}

async function main() {
  console.log(`🗄️ Destino: db "${rpg.NOME_BANCO}", collection "${rpg.NOME_COLECAO}" (descartável)`)
  if (!process.env.MONGO_URI_RPG) {
    console.error('❌ MONGO_URI_RPG não configurada — o smoke test do RPG roda contra o CLUSTER DEDICADO.')
    console.error('   Defina a connection string do cluster do RPG no .env (MONGO_URI_RPG).')
    process.exit(1)
  }

  // 🧹 Estado limpo antes de começar
  const colecao = await rpg.obterColecaoRpg()
  await colecao.deleteMany({ jid: { $in: [A, B] } })
  await rpg.savePlayer(A, { ...(await rpg.getPlayer(A)), carteira: 1000, banco: 0 })
  await rpg.savePlayer(B, { ...(await rpg.getPlayer(B)), carteira: 0, banco: 0 })

  // ══ 1) /depositar e /sacar (motor real) ═══
  await depositarComando(sockFake, GRUPO, msgDe(A), '/depositar 300.50')
  let docA = await rpg.getPlayer(A)
  checar('Mongo real: depositar 300,50 → carteira 699,50', docA.carteira === 699.5)
  checar('Mongo real: depositar 300,50 → banco 300,50', docA.banco === 300.5)
  checar('Mongo real: confirmação formatada', ultimo().includes(formatarReais(300.5)))

  await sacarComando(sockFake, GRUPO, msgDe(A), '/sacar todos')
  docA = await rpg.getPlayer(A)
  checar('Mongo real: sacar todos → banco 0 e carteira 1000', docA.banco === 0 && docA.carteira === 1000)

  await depositarComando(sockFake, GRUPO, msgDe(A), '/depositar 5000')
  docA = await rpg.getPlayer(A)
  checar('Mongo real: depósito acima do saldo recusado (sem escrita)', docA.carteira === 1000 && ultimo().includes('Saldo insuficiente'))

  // ═══ 2) /transferir (TRANSAÇÃO real + rollback) ═══
  await transferirComando(sockFake, GRUPO, msgDe(A, { mentionedJid: [B] }), '/transferir @b 250')
  docA = await rpg.getPlayer(A)
  const docB = await rpg.getPlayer(B)
  checar('Mongo real: transferir 250 → remetente 750', docA.carteira === 750)
  checar('Mongo real: transferir 250 → destinatário 250', docB.carteira === 250)
  checar('Mongo real: banco do remetente intocado (0)', docA.banco === 0)

  // 💥 Rollback: saldo insuficiente NA TRANSAÇÃO → nenhum efeito
  const rollback = await transferirEntreJogadores(A, B, 999999)
  const depoisA = await rpg.getPlayer(A)
  const depoisB = await rpg.getPlayer(B)
  checar('Mongo real: transferência sem saldo → recusada', rollback.ok === false && rollback.motivo === 'saldo_insuficiente')
  checar('Mongo real: ROLLBACK — saldos intactos (750 / 250)', depoisA.carteira === 750 && depoisB.carteira === 250)

  await carteiraComando(sockFake, GRUPO, msgDe(A))
  checar('Mongo real: /carteira mostra total (750 + 0)', ultimo().includes(formatarReais(750)))

  console.log(`\n📊 Resultado: ${ok} ✅ | ${falhou} ❌`)

  // 🧹 Limpa a collection descartável
  try { await colecao.drop() ; console.log('🧹 Collection de teste apagada.') } catch (e) { /* já não existe */ }
  process.exit(falhou ? 1 : 0)
}

main().catch(async (err) => {
  console.error('❌ FALHA NO SMOKE TEST:', err)
  try { const c = await rpg.obterColecaoRpg(); await c.drop() } catch (e) { /* ignora */ }
  process.exit(1)
})