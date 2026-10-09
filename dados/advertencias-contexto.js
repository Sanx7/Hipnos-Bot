const { normalizeMessageContent } = require('@whiskeysockets/baileys')
const { identificar } = require('./identidade-participante')

// Mesmo padrão de /totag: o contexto pertence ao nó do comando, inclusive legenda.
function extrairAlvo(msg) {
  const conteudo = normalizeMessageContent(msg?.message) || {}
  for (const valor of Object.values(conteudo)) {
    const contexto = valor?.contextInfo
    const alvo = contexto?.mentionedJid?.[0] || contexto?.participant
    if (alvo) return alvo
  }
  return null
}

async function autorizado(metadados, sender, permitirDono = false) {
  const autor = await identificar(metadados?.participants || [], sender)
  if (!autor.numero) return false
  const proprietario = metadados?.owner
    ? await identificar(metadados.participants || [], metadados.owner) : null
  return Boolean(autor.admin || (autor.participante && proprietario?.numero === autor.numero) ||
    (permitirDono && autor.dono))
}

module.exports = { extrairAlvo, autorizado, identificar }
