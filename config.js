// ============================================
// ⚙️ config.js — Configurações globais do Hipnos Bot
// ============================================
// Centraliza configurações compartilhadas entre o bot.js e os comandos:
//   - A LISTA de donos do bot (usada p/ liberar sempre quem é dono)
//   - Comportamento do modo restrito (silencioso ou aviso)
//   - Helpers de comparação de JID e verificação de admin de grupo
// ============================================

const fs = require('fs')
const path = require('path')

// ------------------------------------------------------------
// 📂 Carrega o arquivo .env da raiz (se existir) para o process.env.
// - NÃO sobrescreve variáveis que já existem no ambiente real
//   (no Render, por exemplo, a variável do painel tem prioridade).
// - Sem dependência externa: parser minimalista KEY=VALUE.
// ------------------------------------------------------------
function carregarDotEnv() {
  try {
    const caminhoEnv = path.join(__dirname, '.env')
    if (!fs.existsSync(caminhoEnv)) return
    for (const linhaBruta of fs.readFileSync(caminhoEnv, 'utf8').split(/\r?\n/)) {
      const linha = linhaBruta.trim()
      if (!linha || linha.startsWith('#')) continue
      const separador = linha.indexOf('=')
      if (separador === -1) continue
      const chave = linha.slice(0, separador).trim()
      let valor = linha.slice(separador + 1).trim()
      // Remove aspas envolventes, se houver
      if (
        (valor.startsWith('"') && valor.endsWith('"')) ||
        (valor.startsWith("'") && valor.endsWith("'"))
      ) {
        valor = valor.slice(1, -1)
      }
      if (chave && !(chave in process.env)) process.env[chave] = valor
    }
  } catch (err) {
    console.error('⚠️ Erro ao ler o arquivo .env (seguindo sem ele):', err.message)
  }
}
carregarDotEnv()

// 👑 DONOS DO BOT (lista de números, somente dígitos, com DDI).
// ⚠️ Os donos do bot SEMPRE podem usar os comandos, independente do modo
// somente admin estar ativo ou não.
//
// ➕ ONDE ADICIONAR OUTROS DONOS — escolha UMA das duas opções:
//
//   OPÇÃO 1 (recomendada): crie um arquivo ".env" na raiz do projeto
//   (use o .env.example como modelo) com os números separados por vírgula:
//       OWNER_NUMBERS=177060848861240,5511999999999,5511888888888
//
//   OPÇÃO 2: edite o array DONOS_PADRAO logo abaixo.
//
// Prioridade: variável de ambiente (Render/Docker) > .env > DONOS_PADRAO.

// Fallback hardcoded usado quando não há OWNER_NUMBERS no ambiente/.env.
// O 1º item é o número que JÁ vinha no bot antes — mantido p/ não quebrar.
const DONOS_PADRAO = [
  '177060848861240'
  // , '5511999999999'  ← exemplo: adicione outros donos aqui se preferir
]

// Lê a lista de donos do ambiente (OWNER_NUMBERS="num1,num2,..." separados
// por vírgula). Retorna null se a variável não existir ou ficar vazia.
function lerDonosDoAmbiente() {
  const bruto = process.env.OWNER_NUMBERS
  if (!bruto) return null
  const lista = bruto.split(',').map(limparNumero).filter(Boolean)
  return lista.length ? lista : null
}

// Lista FINAL de donos usada em todo o bot (/soadm, gate do messages.upsert, /dono)
const OWNER_NUMBERS = lerDonosDoAmbiente() || DONOS_PADRAO

// 🛡️ O que acontece quando um NÃO-admin chama um comando com o modo
// somente admin ATIVO:
//   false = ignora silenciosamente (padrão)
//   true  = responde avisando que o bot está em modo restrito
const AVISAR_BLOQUEIO = false

// Extrai apenas os dígitos de um JID (remove @, sufixo :device e não-numéricos)
function limparNumero(jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

// Encontra o participante de um grupo cujo JID bate com o sender.
// Compara tanto o `id` (que pode ser LID @lid) quanto o `phoneNumber`
// (número real @s.whatsapp.net) contra o sender — assim funciona mesmo
// quando o Baileys entrega cada lado em domínios diferentes.
function acharParticipante(participants, jid) {
  const alvo = limparNumero(jid)
  if (!alvo) return null
  return (participants || []).find((p) => {
    if (!p) return false
    const idLimpo = limparNumero(p.id)
    const pnLimpo = limparNumero(p.phoneNumber)
    return idLimpo === alvo || pnLimpo === alvo
  })
}

// Diz se o autor (`jid`) é admin de um grupo, dado o array de participants.
// Observação: o DONO DO GRUPO normalmente aparece como "superadmin" no array,
// então também cai aqui; se quiser contemplar o dono separadamente, compare
// com metadados.owner no comando.
function ehAdminDoGrupo(participants, jid) {
  const participante = acharParticipante(participants, jid)
  return Boolean(
    participante &&
      (participante.admin === 'admin' || participante.admin === 'superadmin')
  )
}

// 👑 Lista de DONOS do bot — fonte única de verdade (usada pelo /dono e por
// qualquer checagem de "quem é dono" espalhada no bot).
// Retorna TODOS os donos (não só o primeiro), já normalizados (apenas dígitos),
// sem vazios e sem duplicados.
function getDonos() {
  return [...new Set(OWNER_NUMBERS.map(limparNumero).filter(Boolean))]
}

// Formata apenas dígitos como telefone legível (com suporte a BR).
// movida para cá para ser a ÚNICA versão — o /ranking também usa esta.
function formatarNumero(digitos) {
  if (!digitos) return 'Desconhecido'
  // Ex: 5521999999999 -> +55 (21) 99999-9999
  if (digitos.length === 13 && digitos.startsWith('55')) {
    return `+${digitos.slice(0, 2)} (${digitos.slice(2, 4)}) ${digitos.slice(4, 9)}-${digitos.slice(9)}`
  }
  return `+${digitos}`
}

module.exports = {
  OWNER_NUMBERS,
  AVISAR_BLOQUEIO,
  limparNumero,
  acharParticipante,
  ehAdminDoGrupo,
  getDonos,
  formatarNumero
}