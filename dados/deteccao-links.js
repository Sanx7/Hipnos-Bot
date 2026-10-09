const { parse } = require('tldts')

// Expressão original do handler: manter o comportamento do /antilink simples.
function temLinkBasico(texto) {
  return /(https?:\/\/[^\s]+|www\.[^\s]+|wa\.me\/[^\s]+)/i.test(String(texto || ''))
}

function temLinkHard(texto) {
  const tokens = String(texto || '').match(/[^\s<>"'()[\]{}]+/gu) || []
  for (let token of tokens) {
    token = token.replace(/^[*`~,:;!?]+|[*`~.,;!?]+$/g, '')
    const explicito = /^https?:\/\//i.test(token)
    if (!explicito && token.includes('@')) continue // email não é um link de navegação
    if (!explicito && !temLinkBasico(token) && !/^[\p{L}\p{N}][\p{L}\p{N}.-]*\.[\p{L}][\p{L}\p{N}-]*(?::\d{1,5})?(?:[/?#].*)?$/u.test(token)) continue
    try {
      const url = new URL(explicito ? token : `https://${token}`)
      if (!['http:', 'https:'].includes(url.protocol)) continue
      if (url.hostname.length > 253 || url.hostname.split('.').some(p => !p || p.length > 63 || p.startsWith('-') || p.endsWith('-'))) continue
      const dominio = parse(url.hostname)
      // IP completo com esquema explícito é URL; números soltos/abreviados não.
      if (explicito && dominio.isIp && /^https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::|[/?#]|$)/i.test(token)) return true
      if (dominio.domain && dominio.isIcann) return true
    } catch (_) { /* endereço incompleto ou inválido */ }
  }
  return false
}

module.exports = { temLinkBasico, temLinkHard }
