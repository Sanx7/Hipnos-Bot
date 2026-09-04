// ============================================
// 🗄️ database.js — Banco do /ranking (SQLite)
// ============================================
// Módulo responsável por TODA a lógica de persistência do ranking:
//   1. Conectar no banco SQLite (arquivo mensagens.db na raiz do projeto)
//   2. Criar a tabela `mensagens` caso ainda não exista
//   3. Inserir mensagens conforme chegam no messages.upsert
//   4. Buscar o TOP usuários de UM grupo específico
//
// Usa a lib better-sqlite3 (síncrona e rápida). Se ela não estiver
// instalada, o bot continua funcionando normalmente — apenas o /ranking
// fica desativado até que se rode `npm install better-sqlite3`.
// ============================================

const path = require('path')

// -------------------------------------------------------------------
// better-sqlite3 é dependência opcional (try/catch de segurança)
// -------------------------------------------------------------------
let Database = null
try {
  Database = require('better-sqlite3')
  console.log('🗄️  better-sqlite3 carregado com sucesso.')
} catch (err) {
  console.error('⚠️  better-sqlite3 NÃO está instalado — o /ranking ficará desativado.')
  console.error('   Para instalar, rode:  npm install better-sqlite3')
}

// Arquivo do banco fica na raiz do projeto (ex: Hipnos-Bot/mensagens.db).
// 💡 Pode ser sobrescrito pela variável de ambiente DB_PATH (útil p/ testes
//    automatizados ou p/ apontar o banco p/ outro local sem mexer no código).
const CAMINHO_BANCO = process.env.DB_PATH || path.join(__dirname, 'mensagens.db')
// Conexão única reutilizada pelo processo inteiro
let db = null

// -------------------------------------------------------------------
// Conecta no banco (uma única vez) e garante que a tabela existe
// -------------------------------------------------------------------
function conectar() {
  if (db) return db
  if (!Database) return null

  db = new Database(CAMINHO_BANCO)

  // WAL = melhor desempenho p/ gravações contínuas (típico de um chat)
  db.pragma('journal_mode = WAL')

  // Cria a tabela se ainda não existir.
  // - grupo_id  : remoteJid do grupo (ex: 12036...@g.us) — NUNCA misturamos grupos
  // - usuario_id: número do remetente já normalizado (apenas dígitos)
  // - nome      : pushName do remetente capturado na hora (ajuda a exibir o nome)
  // - timestamp : instante em que a mensagem foi registrada
  db.exec(`
    CREATE TABLE IF NOT EXISTS mensagens (
      grupo_id   TEXT NOT NULL,
      usuario_id TEXT NOT NULL,
      nome       TEXT,
      timestamp  INTEGER NOT NULL
    )
  `)

  // Índice acelera tanto o filtro por grupo quanto a contagem por usuário
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mensagens_grupo_usuario
    ON mensagens (grupo_id, usuario_id)
  `)

  console.log('🗄️  Banco de dados do ranking conectado.')
  return db
}

// -------------------------------------------------------------------
// Normaliza um JID para guardar apenas os dígitos do número
// (remove @, sufixo de dispositivo ":3" e caracteres não numéricos)
// -------------------------------------------------------------------
function normalizarId(jid) {
  return String(jid || '')
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '')
}

// -------------------------------------------------------------------
// RegistrarMensagem: contabiliza UMA mensagem no ranking
// Chamada a partir do messages.upsert para TODA mensagem do grupo.
// -------------------------------------------------------------------
function registrarMensagem(grupoId, usuarioId, nome) {
  const conexao = conectar()
  if (!conexao) return false

  const insere = conexao.prepare(`
    INSERT INTO mensagens (grupo_id, usuario_id, nome, timestamp)
    VALUES (?, ?, ?, ?)
  `)

  insere.run(grupoId, normalizarId(usuarioId), nome || null, Date.now())
  return true
}

// -------------------------------------------------------------------
// BuscarRanking: retorna os `limite` usuários que MAIS enviaram mensagens
// no grupo `grupoId`.
// ⚠️ Filtro obrigatório por grupo_id — cada grupo tem seu próprio ranking.
// Utiliza ROW_NUMBER para pegar o pushName MAIS RECENTE de cada usuário.
// Retorno: [ { usuario_id, nome, total }, ... ] (ordenado do maior p/ menor)
// -------------------------------------------------------------------
function buscarRanking(grupoId, limite = 10) {
  const conexao = conectar()
  if (!conexao) return []

  const consulta = conexao.prepare(`
    SELECT usuario_id, nome, total
    FROM (
      SELECT
        usuario_id,
        nome,
        COUNT(*) OVER (PARTITION BY usuario_id) AS total,
        ROW_NUMBER() OVER (
          PARTITION BY usuario_id
          ORDER BY timestamp DESC
        ) AS rn
      FROM mensagens
      WHERE grupo_id = ?
    )
    WHERE rn = 1
    ORDER BY total DESC
    LIMIT ?
  `)

  return consulta.all(grupoId, limite)
}

// -------------------------------------------------------------------
// Exporta apenas o que o resto do bot precisa
// -------------------------------------------------------------------
module.exports = {
  conectar,
  registrarMensagem,
  buscarRanking,
  normalizarId
}