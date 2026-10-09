const prefixoComandos = require('../prefixo')
const cooldowns = require('./cooldowns')

const COOLDOWN_MS = 10000
const emAndamento = new Set()

// Chamado pelo handler após a autorização ON/OFF. true consome o gatilho,
// inclusive em cooldown, para que ele não chegue aos jogos ou à IA.
async function processar(sock, jid, msg, texto) {
  if (typeof texto !== 'string' || texto.trim().toLowerCase() !== 'prefixo') return false
  const chave = `resposta-prefixo:${jid}`
  if (emAndamento.has(jid) || cooldowns.verificar(chave, COOLDOWN_MS).emCooldown) return true
  emAndamento.add(jid)
  try {
    const prefixo = await prefixoComandos.obterPrefixo()
    await sock.sendMessage(jid, {
      text: `🌙 *Hipnos — O Senhor dos Sonhos*\n\n💤 Mortal, deseja invocar meus poderes?\n\n🔱 Meu prefixo atual é: ${prefixo}\n\n🌑 Use ${prefixo}menu para explorar os reinos dos sonhos.`
    }, { quoted: msg })
    cooldowns.marcar(chave)
  } catch (_) {
    console.error('[resposta-prefixo] Não foi possível enviar a resposta.')
  } finally {
    emAndamento.delete(jid)
  }
  return true
}

module.exports = { processar }
