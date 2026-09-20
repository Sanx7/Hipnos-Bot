// ============================================
// 🪪 migrar-rpg-lid.js — Corrige registros do RPG gravados com LID
// ============================================
// Os comandos do RPG (/registrar, /ficha, /testrpg) chegaram a gravar o
// jid do jogador como "@lid" (ex.: "175952680210489@lid") no lugar do
// número real — o MESMO bug que o /darvip já teve com os VIPs. O fix nos
// comandos + getPlayer/savePlayer usa o lid.js; este script varre a
// collection "rpgPlayers" e, para cada jogador com jid @lid que a Baileys
// tiver mapeado na sessão (lid-mapping reverse):
//   - SEM duplicata → troca o jid pro número real;
//   - COM duplicata (bug criou o jogador 2x) → MESCLA os dois documentos
//     (critério "o mais completo ganha" — ver mesclarJogadores em
//     rpg/database.js) e apaga o registro-LID.
// É IDEMPOTENTE: pode ser rodado quantas vezes quiser.
// ⚠️ Precisa de MONGO_URI_RPG (o cluster DEDICADO do RPG — os dados dos
// jogadores agora vivem lá, não mais no cluster principal). O config.js
// carrega o .env da raiz automaticamente, então localmente basta ter o
// .env preenchido.
//
// Uso (na raiz do projeto):
//   node scripts/migrar-rpg-lid.js
// ============================================

// Carrega o .env (via config.js) ANTES de qualquer leitura de process.env
require('../config')

const rpg = require('../rpg/database')

async function main() {
  console.log(`🗄️ Destino: db "${rpg.NOME_BANCO}", collection "${rpg.NOME_COLECAO}" (cluster dedicado do RPG)`)

  if (!process.env.MONGO_URI_RPG) {
    console.error('❌ MONGO_URI_RPG não configurada — defina no .env (local) ou no painel do Render.')
    console.error('   Os dados do RPG agora vivem no cluster DEDICADO (MONGO_URI_RPG), não no principal.')
    process.exit(1)
  }

  try {
    console.log('🔎 Varrendo os jogadores do RPG em busca de LIDs...')
    const { corrigidos, mesclados, naoResolviveis, total } = await rpg.corrigirJogadoresComLid()
    console.log('════════════════════════════════════════════════════════')
    console.log(`✅ Migração concluída:`)
    console.log(`   • ${corrigidos} de ${total} registro(s) com @lid tratado(s)`)
    console.log(`   • ${mesclados} duplicata(s) mesclada(s)`)
    console.log(`   • ${naoResolviveis} LID(s) sem mapeamento resolvível (mantidos; rode de novo após a sessão sincronizar)`)
    if (corrigidos === 0) {
      console.log('ℹ️ Nenhum registro com LID resolvível — os jogadores já estavam com números reais (ou não há mapeamento na sessão).')
    }
    console.log('════════════════════════════════════════════════════════')
    process.exit(0)
  } catch (err) {
    console.error('❌ Falha na migração RPG LID→número:', err?.message || err)
    process.exit(1)
  }
}

main()
