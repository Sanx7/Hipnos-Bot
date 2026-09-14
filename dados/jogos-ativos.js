// ============================================
// 🎮 jogos-ativos.js — Registro COMPARTILHADO de jogos por grupo
// ============================================
// Centraliza duas coisas que antes viviam espalhadas (e só dentro de cada
// comando):
//
//   1) 🔒 UM JOGO ATIVO POR GRUPO — um Map jid → { tipo, dados, desde }.
//      O /velha, o /anagrama e o /gartic consultam este registro antes de
//      começar uma rodada, o que garante o BLOQUEIO CRUZADO real: não dá
//      para abrir um gartic enquanto tem velha rolando no mesmo grupo (e
//      vice-versa). Antes cada comando só sabia de si mesmo.
//
//   2) 💬 OUVINTES DE TEXTO LIVRE — o /gartic depende de ler mensagens
//      NORMAIS (sem "/") para validar os palpites. Cada comando pode
//      registrar um ouvinte para o seu tipo de jogo; o bot.js entrega as
//      mensagens de texto livre a este módulo, que despacha para o ouvinte
//      da partida ativa. Ouvinte devolve true  → mensagem consumida
//      (o bot.js para por ali); false → mensagem segue o fluxo normal.
//
// ⚠️ O estado vive na MEMÓRIA do processo (mesmo padrão do /velha e do
// /anagrama): se o bot reiniciar, as partidas em curso se perdem — o
// aceitável para brincadeiras entre sonhos. Não há dependência do MongoDB.
//
// Módulo sem dependências (igual ao comandos-registry.js) justamente para
// poder ser exigido por comandos E pelo bot.js sem risco de ciclo.
// ============================================

// ─── 🏷️ Tipos conhecidos + rótulos legíveis (pt-BR) ───
const TIPOS = {
  VELHA: 'velha',
  ANAGRAMA: 'anagrama',
  GARTIC: 'gartic'
}

const ROTULOS = {
  velha: 'jogo da velha',
  anagrama: 'anagrama',
  gartic: 'gartic'
}

// jid do grupo → { tipo, dados, desde }
const jogos = new Map()

// tipo do jogo → função (sock, jid, msg, texto, dados) => Promise<boolean>
const ouvintes = new Map()

// ─── 🏷️ Rótulo amigável de um tipo (para as mensagens de conflito) ───
function rotuloDoTipo (tipo) {
  return ROTULOS[tipo] || tipo || 'jogo'
}

// ─── 💬 Registra o ouvinte de texto livre de um tipo de jogo ───
// Chamado UMA vez, no carregamento do módulo do comando. Re-registrar o
// mesmo tipo apenas substitui o ouvinte anterior.
function registrarOuvinteTexto (tipo, ouvinte) {
  if (!tipo || typeof ouvinte !== 'function') return false
  ouvintes.set(tipo, ouvinte)
  return true
}

// ─── 🔎 Consultas ───
function obterJogo (jid) {
  return jogos.get(jid) || null
}

function estaAtivo (jid) {
  return jogos.has(jid)
}

function tipoAtivo (jid) {
  const jogo = jogos.get(jid)
  return jogo ? jogo.tipo : null
}

// Devolve o jogo ativo APENAS se ele for de OUTRO tipo (usado para bloquear
// a abertura de um jogo novo enquanto outro estiver rolando no grupo).
function jogoDeOutroTipo (jid, tipo) {
  const jogo = jogos.get(jid)
  if (jogo && jogo.tipo !== tipo) return jogo
  return null
}

// ─── 🔒 Registra o jogo do grupo ───
// Retorno: { ok: true, jogo } | { ok: false, conflito: jogo }
// O MESMO tipo pode ser re-registrado (substitui o estado anterior), mas
// tipos diferentes se bloqueiam.
function registrarJogo (jid, tipo, dados = {}) {
  const atual = jogos.get(jid)
  if (atual && atual.tipo !== tipo) return { ok: false, conflito: atual }

  const jogo = { tipo, dados, desde: Date.now() }
  jogos.set(jid, jogo)
  return { ok: true, jogo }
}

// ─── 🔓 Encerra o jogo do grupo ───
// Com `tipo`, só remove se o jogo ativo for daquele tipo (evita que um
// comando derrube a partida de outro). Retorno: jogo removido | null.
function removerJogo (jid, tipo) {
  const atual = jogos.get(jid)
  if (!atual) return null
  if (tipo && atual.tipo !== tipo) return null
  jogos.delete(jid)
  return atual
}

// ─── 💬 Despacha uma mensagem de texto livre para o ouvinte da partida ───
// Retorno: true  → a mensagem foi consumida por um jogo (o bot.js para);
//          false → nenhum jogo ativo/quem ouvir interessado.
async function processarMensagemLivre (sock, jid, msg, texto) {
  const jogo = jogos.get(jid)
  if (!jogo) return false

  const ouvinte = ouvintes.get(jogo.tipo)
  if (!ouvinte) return false

  try {
    const consumida = await ouvinte(sock, jid, msg, texto, jogo.dados)
    return consumida === true
  } catch (err) {
    // 🛡️ Nada escapa para o listener do bot.js
    console.error(`[jogos-ativos] 💥 erro no ouvinte de texto (${jogo.tipo}):`, err?.stack || err)
    return false
  }
}

// ─── 🧪 Gancho dos testes offline: limpa o registro sem tocar nos ouvintes ───
function limparJogos () {
  jogos.clear()
}

module.exports = {
  TIPOS,
  ROTULOS,
  rotuloDoTipo,
  registrarOuvinteTexto,
  obterJogo,
  estaAtivo,
  tipoAtivo,
  jogoDeOutroTipo,
  registrarJogo,
  removerJogo,
  processarMensagemLivre,
  limparJogos,
  // Exposto para inspeção nos testes (não usar como API pública nos comandos)
  jogos,
  ouvintes
}
