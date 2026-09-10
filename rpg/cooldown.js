// ============================================================
// ⏳ rpg/cooldown.js — Sistema de cooldown dos comandos do RPG
// ============================================================
// Reutilizável por QUALQUER comando futuro: trabalhar, roubar,
// dormir, plantar, etc.
//
// Uso (num comando):
//   const { checkCooldown, setCooldown } = require('../rpg/cooldown')
//   const verif = checkCooldown(player, 'trabalhar', 30 * 1000) // 30s
//   if (verif.emCooldown) {
//     return await sock.sendMessage(jid, {
//       text: `⏳ Espere ${Math.ceil(verif.tempoRestante/1000)}s...`
//     }, { quoted: msg })
//   }
//   // ... executa a ação ...
//   setCooldown(player, 'trabalhar')
//   await savePlayer(player.jid, player)
//
// O cooldown fica em player.cooldowns[acao] = timestamp (ms). Todos os
// comandos leem O MESMO player (objeto do getPlayer), então não há
// persistência dupla nem dessincronização.
// ============================================================

// -------------------------------------------------------------------
// Verifica se o jogador ainda está em cooldown para `acao`.
// Retorna:
//   { emCooldown: false }                    → pode usar
//   { emCooldown: true, tempoRestante: ms }  → quanto falta (ms)
// Nunca lança: sem player/cooldowns retorna "pode usar".
// -------------------------------------------------------------------
function checkCooldown(player, acao, tempoMs) {
  const agora = Date.now()

  // Defensivo: player ou cooldowns ausentes → sem cooldown
  const cooldowns = player?.cooldowns
  const ultimaVez = cooldowns && typeof cooldowns === 'object' ? cooldowns[acao] : undefined

  if (typeof ultimaVez !== 'number') {
    return { emCooldown: false }
  }

  const tempoRestante = ultimaVez + tempoMs - agora
  if (tempoRestante <= 0) {
    return { emCooldown: false }
  }

  return { emCooldown: true, tempoRestante }
}

// -------------------------------------------------------------------
// Registra o timestamp atual como o início do cooldown de `acao`.
// Grava direto no objeto do player (o comando depois chama savePlayer).
// -------------------------------------------------------------------
function setCooldown(player, acao) {
  if (!player || typeof player !== 'object') {
    console.error('⚠️ [cooldown] setCooldown chamado sem player válido')
    return
  }
  if (!player.cooldowns || typeof player.cooldowns !== 'object') {
    player.cooldowns = {}
  }
  player.cooldowns[acao] = Date.now()
}

module.exports = { checkCooldown, setCooldown }