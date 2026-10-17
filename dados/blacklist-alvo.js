const { extrairAlvo } = require('./advertencias-contexto')
const { extrairTextoComando } = require('./texto-comando')

// Mesma prioridade dos comandos existentes: menção, reply, número digitado.
function obterAlvoBlacklist(msg, texto) {
  const marcado = extrairAlvo(msg)
  if (marcado) return { jid: marcado, digitado: false }
  const argumento = String(texto ?? extrairTextoComando(msg)).trim().split(/\s+/u).slice(1).join(' ')
  if (argumento.length > 80 || /-$/.test(argumento) || !/^\+?(?:\d|\(\d+\))(?:\d|\(\d+\)|[ -])*$/.test(argumento)) return null
  const numero = argumento.replace(/\D/g, '')
  // Validação sintática internacional, sem consultar WhatsApp/serviços externos.
  if (!/^[1-9]\d{9,14}$/.test(numero)) return null
  return { jid: `${numero}@s.whatsapp.net`, digitado: true }
}

module.exports = { obterAlvoBlacklist }
