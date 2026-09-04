// ============================================
// 💠 vip.js — Sistema de Membros VIP (com expiração automática)
// ============================================
// Módulo responsável por TODA a lógica de VIPs do bot:
//   1. Garante a tabela `vips` no MESMO banco do /ranking (mensagens.db,
//      mesma conexão aberta pelo database.js)
//   2. Outorga VIP por N dias (adicionarVip) — SOMANDO os dias se o alvo
//      já for VIP ativo; se já expirou, recomeça um novo período
//   3. Lista os VIPs ativos (listarVipsAtivos) — ordenados pela expiração
//      mais próxima, removendo os expirados do banco (limpeza automática)
//   4. isVip(numero) — verificação reutilizável p/ qualquer comando que
//      queira restringir a VIPs:
//        if (!isVip(numero)) return responder('...exclusivo para membros VIP')
//
// NÃO existe VIP vitalício: todo registro tem `expira_em` obrigatório
// (sempre uma data futura calculada a partir dos dias concedidos).
// ============================================

const { limparNumero } = require('./config') // mesma normalização do /soadm e /dono
const { conectar } = require('./database')   // MESMA conexão/banco do /ranking

const DIA_EM_MS = 24 * 60 * 60 * 1000
// Teto de segurança p/ os dias concedidos (10 anos): evita gravar valores absurdos.
const DIAS_MAX = 3650

// -------------------------------------------------------------------
// Garante que a tabela `vips` existe no banco compartilhado.
//   - numero       : apenas dígitos (normalizado) — PRIMARY KEY
//   - adicionado_em: quando o VIP foi outorgado pela 1ª vez (ms)
//   - expira_em    : OBRIGATÓRIO — quando o VIP acaba (ms)
// -------------------------------------------------------------------
function garantirTabela() {
  const conexao = conectar()
  if (!conexao) return null

  conexao.exec(`
    CREATE TABLE IF NOT EXISTS vips (
      numero        TEXT PRIMARY KEY,
      adicionado_em INTEGER NOT NULL,
      expira_em     INTEGER NOT NULL
    )
  `)
  // Índice acelera as consultas/cleanups por expiração
  conexao.exec(`CREATE INDEX IF NOT EXISTS idx_vips_expira_em ON vips (expira_em)`)

  return conexao
}

// -------------------------------------------------------------------
// 🧹 Remove do banco todos os VIPs cuja expiração já passou.
// Retorna quantos registros foram removidos.
// -------------------------------------------------------------------
function limparExpirados() {
  const conexao = garantirTabela()
  if (!conexao) return 0

  const resultado = conexao
    .prepare('DELETE FROM vips WHERE expira_em <= ?')
    .run(Date.now())
  return resultado.changes
}

// -------------------------------------------------------------------
// 👑 Outorga `dias` de VIP ao número informado (JID cru ou só dígitos).
// Regra de soma:
//   - Já é VIP ATIVO  -> expira_em = expiração atual + dias (SOMA)
//   - Nunca foi / EXPIROU -> novo período a partir de AGORA
// Retorno: { numero, expiraEm, somando, dias } | null (dados inválidos)
// -------------------------------------------------------------------
function adicionarVip(numeroBruto, dias) {
  const numero = limparNumero(numeroBruto)
  const diasNum = Math.floor(Number(dias))
  if (!numero || !Number.isFinite(diasNum) || diasNum < 1 || diasNum > DIAS_MAX) {
    return null
  }

  const conexao = garantirTabela()
  if (!conexao) return null

  const agora = Date.now()
  const existente = conexao
    .prepare('SELECT adicionado_em, expira_em FROM vips WHERE numero = ?')
    .get(numero)

  const somando = Boolean(existente && existente.expira_em > agora)
  const expiraEm = (somando ? existente.expira_em : agora) + diasNum * DIA_EM_MS

  if (existente) {
    // Somando: preserva a data da 1ª outorga | Expirado: recomeça (nova data)
    conexao
      .prepare('UPDATE vips SET expira_em = ?, adicionado_em = ? WHERE numero = ?')
      .run(expiraEm, somando ? existente.adicionado_em : agora, numero)
  } else {
    conexao
      .prepare('INSERT INTO vips (numero, adicionado_em, expira_em) VALUES (?, ?, ?)')
      .run(numero, agora, expiraEm)
  }

  return { numero, expiraEm, somando, dias: diasNum }
}

// -------------------------------------------------------------------
// 📜 Lista TODOS os VIPs ATIVOS, ordenados pela expiração MAIS PRÓXIMA.
// Antes de montar a lista, remove automaticamente os já expirados.
// Retorno: [ { numero, adicionado_em, expira_em }, ... ]
// -------------------------------------------------------------------
function listarVipsAtivos() {
  limparExpirados()

  const conexao = garantirTabela()
  if (!conexao) return []

  return conexao
    .prepare('SELECT numero, adicionado_em, expira_em FROM vips ORDER BY expira_em ASC')
    .all()
}

// -------------------------------------------------------------------
// ✅ Verificação reutilizável (aceita JID cru ou só dígitos):
//   true  = existe registro E a expiração ainda não passou
//   false = não é VIP — e, se o registro já venceu, ele é APAGADO
//           do banco na hora (auto-limpeza).
// -------------------------------------------------------------------
function isVip(numeroBruto) {
  const numero = limparNumero(numeroBruto)
  if (!numero) return false

  const conexao = garantirTabela()
  if (!conexao) return false

  const registro = conexao
    .prepare('SELECT expira_em FROM vips WHERE numero = ?')
    .get(numero)
  if (!registro) return false

  if (registro.expira_em <= Date.now()) {
    // 🧹 VIP vencido deixa de ocupar lugar no banco
    conexao.prepare('DELETE FROM vips WHERE numero = ?').run(numero)
    return false
  }

  return true
}

// -------------------------------------------------------------------
// 🗓️ Formata um timestamp como "dd/mm/aaaa às HH:MM" (horário local)
// -------------------------------------------------------------------
function formatarData(timestamp) {
  const d = new Date(timestamp)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const aaaa = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const minuto = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${aaaa} às ${hh}:${minuto}`
}

module.exports = {
  adicionarVip,
  listarVipsAtivos,
  isVip,
  limparExpirados,
  formatarData,
  DIAS_MAX,
  DIA_EM_MS
}