// ============================================
//  migrar-welcome-json-mongo.js — Migra o /welcome legado (antias.json) p/ MongoDB
// ============================================
// O antigo /bemvindo guardava os grupos com boas-vindas ligadas no arquivo
// comandos/dados/antias.json (chave "welcome"). Agora essa configuração vive
// POR GRUPO no MongoDB (configuracoes-grupo.js, collection "configuracoesGrupo"),
// controlada pelo comando /welcome.
//
// Este script lê a lista legada e cria/atualiza (upsert) um documento por
// grupo com welcome: true — assim nenhum grupo perde o recurso na transição.
// É IDEMPOTENTE: pode ser rodado quantas vezes quiser.
//
// ⚠️ Precisa de MONGODB_URI (a mesma do bot). O config.js carrega o .env da
// raiz automaticamente, então localmente basta ter o .env preenchido.
//
// Uso (na raiz do projeto):
//   node scripts/migrar-welcome-json-mongo.js
// ============================================

// Carrega o .env (via config.js) ANTES de qualquer leitura de process.env
require('../config')

const fs = require('fs')
const path = require('path')
const { definirWelcome, obterConfiguracoes, NOME_BANCO, NOME_COLECAO } = require('../configuracoes-grupo')

const CAMINHO_ANTIAS = path.join(__dirname, '..', 'comandos', 'dados', 'antias.json')

// Lê a chave "welcome" do antias.json (array de grupo_id). [] se não existir.
function lerWelcomeLegado() {
  try {
    if (!fs.existsSync(CAMINHO_ANTIAS)) {
      console.log('ℹ️ antias.json não encontrado — nada a migrar.')
      return []
    }
    const conteudo = JSON.parse(fs.readFileSync(CAMINHO_ANTIAS, 'utf-8'))
    const lista = Array.isArray(conteudo?.welcome) ? conteudo.welcome : []
    return lista.map((g) => String(g || '').trim()).filter(Boolean)
  } catch (err) {
    console.error('❌ Falha ao ler o antias.json:', err?.message || err)
    return []
  }
}

async function main() {
  console.log(`🗄️ Destino: db "${NOME_BANCO}", collection "${NOME_COLECAO}"`)

  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI não configurada — defina no .env (local) ou no painel do Render.')
    process.exit(1)
  }

  const gruposLegados = lerWelcomeLegado()
  if (gruposLegados.length === 0) {
    console.log('ℹ️ Nenhum grupo com welcome ligado no antias.json — nada a migrar.')
    process.exit(0)
  }

  console.log(`📋 Grupos com /welcome ligado no legado: ${gruposLegados.length}`)
  let migrados = 0
  let jaEstavam = 0

  for (const grupoId of gruposLegados) {
    try {
      const antes = await obterConfiguracoes(grupoId)
      await definirWelcome(grupoId, true)
      const depois = await obterConfiguracoes(grupoId)

      if (antes?.welcome === true) {
        jaEstavam += 1
        console.log(`⏭️  ${grupoId} — já estava LIGADO no MongoDB (documento reafirmado).`)
      } else {
        migrados += 1
        console.log(`✅ ${grupoId} — migrate: welcome = ${depois?.welcome} (atualizado_em: ${depois?.atualizado_em})`)
      }
    } catch (err) {
      console.error(`❌ Falha ao migrar ${grupoId}:`, err?.message || err)
    }
  }

  console.log('')
  console.log(` Migração concluída: ${migrados} grupo(s) migrado(s), ${jaEstavam} já estava(m) OK.`)
  console.log('ℹ️ A chave "welcome" do antias.json pode ser removida depois (o bot não a lê mais).')
  process.exit(0)
}

main()