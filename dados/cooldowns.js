// ============================================
// ⏳ cooldowns.js — Cooldowns POR USUÁRIO em memória (sem Mongo)
// ============================================
// MESMO padrão de dados/jogos-ativos.js: estado na MEMÓRIA do processo (um
// Map), perde-se a cada redeploy/restart — aceitável para cooldowns, que são
// só um timestamp por usuário. Módulo SEM dependências (igual ao
// comandos-registry.js) para poder ser exigido por qualquer comando sem
// risco de ciclo de require.
//
// API:
//   verificar(chave, duracaoMs) → { emCooldown, restanteMs, restanteS,
//                                   restanteFormatado }
//       emCooldown = true se a última marcação da chave é mais recente que
//       duracaoMs atrás; restanteFormatado já vem legível ("2min30s"/"45s").
//   marcar(chave) → grava Date.now() como o último uso bem-sucedido da chave.
//       ⚠️ Chamar APENAS depois do sucesso — falha não deve consumir cooldown.
//   limpar() → gancho dos testes offline (mesmo padrão do limparJogos()).
// ============================================

// chave (ex.: número do usuário, só dígitos) → Date.now() do último uso
const cooldowns = new Map()

// ─── ⏱️ Formata um restante (ms) de forma legível: "2min30s" / "1min" / "45s" ───
function formatarRestante (ms) {
  const segundos = Math.ceil(ms / 1000)
  if (segundos <= 0) return '0s'
  if (segundos < 60) return `${segundos}s`
  const minutos = Math.floor(segundos / 60)
  const sobra = segundos % 60
  return sobra ? `${minutos}min${sobra}s` : `${minutos}min`
}

// ─── 🔎 Consulta: a chave ainda está dentro da janela de cooldown? ───
// NUNCA altera o estado (consultar não consome nem estende cooldown).
function verificar (chave, duracaoMs) {
  const vazio = { emCooldown: false, restanteMs: 0, restanteS: 0, restanteFormatado: '' }
  const ultimo = cooldowns.get(chave)
  if (!ultimo) return vazio

  const decorrido = Date.now() - ultimo
  if (decorrido >= duracaoMs) return vazio

  const restanteMs = duracaoMs - decorrido
  return {
    emCooldown: true,
    restanteMs,
    restanteS: Math.ceil(restanteMs / 1000),
    restanteFormatado: formatarRestante(restanteMs)
  }
}

// ─── ✍️ Marca o uso AGORA (chamar só em uso BEM-SUCEDIDO) ───
function marcar (chave) {
  cooldowns.set(chave, Date.now())
}

// ─── 🧪 Gancho dos testes offline: limpa o registro inteiro ───
function limpar () {
  cooldowns.clear()
}

module.exports = {
  verificar,
  marcar,
  limpar,
  formatarRestante,
  // Exposto para inspeção nos testes (não usar como API pública nos comandos)
  cooldowns
}
