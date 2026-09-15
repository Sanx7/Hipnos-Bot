// ============================================
// 🪪 migrar-vip-lid.js — Corrige registros VIP gravados com LID
// ============================================
// O /darvip chegou a gravar o LID (ex.: "175952680210489") no lugar do
// número real (fix: comandos/menu-vip/darvip.js agora resolve o @lid p/ o
// número ANTES de gravar). Este script varre a collection "vips" e, para
// cada registro que a Baileys tiver mapeado na sessão (lid-mapping
// reverse), troca o LID pelo número real — a MESMA correção que o
// /listavip aplica automaticamente (vip.corrigirVipsComLid()).
//
// É IDEMPOTENTE: pode ser rodado quantas vezes quiser.
// ⚠️ Precisa de MONGODB_URI (a mesma do bot). O config.js carrega o .env
// da raiz automaticamente, então localmente basta ter o .env preenchido.
//
// Uso (na raiz do projeto):
//   node scripts/migrar-vip-lid.js
// ============================================

// Carrega o .env (via config.js) ANTES de qualquer leitura de process.env
require('../config')

const vip = require('../vip')

async function main() {
  console.log(`🗄️ Destino: db "${vip.NOME_BANCO}", collection "${vip.NOME_COLECAO}"`)

  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI não configurada — defina no .env (local) ou no painel do Render.')
    process.exit(1)
  }

  try {
    console.log('🔎 Varrendo os registros VIP em busca de LIDs...')
    const { corrigidos, total } = await vip.corrigirVipsComLid()
    console.log('════════════════════════════════════════════════════════')
    console.log(`✅ Migração concluída: ${corrigidos} de ${total} registro(s) corrigido(s) de LID p/ o número real.`)
    if (corrigidos === 0) {
      console.log('ℹ️ Nenhum registro com LID resolvível — os VIPs já estavam com números reais (ou o LID não tem mapeamento na sessão).')
    }
    console.log('════════════════════════════════════════════════════════')
    process.exit(0)
  } catch (err) {
    console.error('❌ Falha na migração VIP LID→número:', err?.message || err)
    process.exit(1)
  }
}

main()
