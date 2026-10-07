// Guarda somente chaves de envios do bot, sem texto ou mídia. Sobrevive à
// reconexão do socket, mas não ao restart do processo. Histórico limitado.
const chaves = new Map()
const sockets = new WeakSet()
const LIMITE_POR_GRUPO = 50
const LIMITE_TOTAL = 10000

function registrar(key) {
  if (key?.fromMe !== true || !key.id || !String(key.remoteJid || '').endsWith('@g.us')) return
  const identificador = `${key.remoteJid}:${key.id}`
  if (chaves.has(identificador)) return
  chaves.set(identificador, { ...key })
  const grupo = [...chaves.entries()].filter(([, k]) => k.remoteJid === key.remoteJid)
  if (grupo.length > LIMITE_POR_GRUPO) chaves.delete(grupo[0][0])
  while (chaves.size > LIMITE_TOTAL) chaves.delete(chaves.keys().next().value)
}

function recentes(jid, quantidade) {
  return [...chaves.values()].filter(k => k.remoteJid === jid).reverse().slice(0, quantidade).map(k => ({ ...k }))
}

function remover(key) {
  chaves.delete(`${key.remoteJid}:${key.id}`)
}

function acompanharSocket(sock) {
  if (sockets.has(sock)) return
  sockets.add(sock)
  const enviar = sock.sendMessage
  sock.sendMessage = async function (jid, conteudo, ...opcoes) {
    const resultado = await enviar.call(this, jid, conteudo, ...opcoes)
    // Ações de protocolo não viram mensagens a limpar. Edições já têm a
    // chave do envio original; não são um novo item no histórico.
    if (conteudo && !('delete' in conteudo) && !('react' in conteudo) && !('edit' in conteudo) && !('pin' in conteudo)) {
      registrar(resultado?.key)
    }
    return resultado
  }
}

module.exports = { acompanharSocket, recentes, remover }
