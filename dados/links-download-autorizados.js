// Excecao de CLASSIFICACAO, nao de permissao. Sem HTTP, DNS ou redirecionamento.
const { extrairTextoComando } = require('./texto-comando')
const prefixos = require('../prefixo')
const { comandos } = require('../comandos-registry')
const consultas = new Set(['_t', '_r', 'is_from_webapp', 'sender_device', 'web_id', 'is_copy_url',
  'share_app_id', 'share_item_id', 'share_link_id', 'timestamp', 'u_code', 'checksum',
  'utm_source', 'utm_medium', 'utm_campaign'])
function urlTikTokPermitida(texto) {
  if (typeof texto !== 'string' || texto.length > 2048 || !/^[\x21-\x7e]+$/.test(texto)) return false
  // Verifica tambem a autoridade BRUTA: URL normaliza portas 443, escapes e barras.
  if (!/^https:\/\/(?:www\.|vm\.|vt\.)?tiktok\.com\//i.test(texto)) return false
  try {
    const u = new URL(texto)
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash || texto.includes('\\')) return false
    const caminhoBruto = texto.match(/^https:\/\/[^/?#]+(\/[^?#]*)(?:\?[^#]*)?$/i)?.[1]
    if (caminhoBruto !== u.pathname) return false
    if (!['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'].includes(u.hostname)) return false
    const curto = ['vm.tiktok.com', 'vt.tiktok.com'].includes(u.hostname)
    if (curto ? !/^\/[A-Za-z0-9_-]{3,100}\/?$/.test(u.pathname) :
      !/^\/@[A-Za-z0-9._]{1,24}\/video\/\d{10,25}\/?$/.test(u.pathname) && !/^\/t\/[A-Za-z0-9_-]{3,100}\/?$/.test(u.pathname)) return false
    // Evita parametros de redirect, URLs embutidas, escapes e pares ambiguos.
    if (u.search && !/^\?(?:[A-Za-z0-9_]{1,32}=[A-Za-z0-9._~-]{1,256})(?:&[A-Za-z0-9_]{1,32}=[A-Za-z0-9._~-]{1,256})*$/.test(u.search)) return false
    const vistos = new Set()
    for (const [chave] of u.searchParams) {
      if (!consultas.has(chave) || vistos.has(chave)) return false
      vistos.add(chave)
    }
    return true
  } catch (_) { return false }
}
async function permite(msg, registro = comandos) {
  try {
    const texto = extrairTextoComando(msg)
    if (texto.length > 2200 || /[\r\n\u0000-\u0008\u000b-\u001f\u007f]/.test(texto)) return false
    // A mensagem inteira deve ter dois tokens. Sem prose, segundo link ou linha oculta.
    const partes = texto.match(/^(\S+)[ \t]+(https:\/\/[^\s]+)[ \t]*$/i)
    if (!partes || !urlTikTokPermitida(partes[2])) return false
    const atual = await prefixos.obterPrefixo()
    const nome = prefixos.resolverNomeComando(texto, atual)
    const cmd = registro.get(nome)
    if (!cmd || !['tiktok', 'tiktok-audio'].includes(cmd.nome) || typeof cmd.executar !== 'function') return false
    if (registro.get(cmd.nome) !== cmd) return false
    return nome === cmd.nome || (Array.isArray(cmd.aliases) && cmd.aliases.includes(nome))
  } catch (_) { return false }
}
module.exports = { permite, urlTikTokPermitida }
