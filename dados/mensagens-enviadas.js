// Guarda somente chaves de mensagens do grupo, sem texto ou mídia. Sobrevive à
// reconexão do socket, mas não ao restart do processo. Histórico limitado.
const chaves = new Map()
const solicitadas = new Set()
const sockets = new WeakSet()
// A fronteira do pedido continua válida se um lote grande expulsar sua key
// do limite de 50. WeakMap não mantém mensagens recebidas vivas na memória.
const ordens = new WeakMap()
let sequencia = 0
const LIMITE_POR_GRUPO = 50
const LIMITE_TOTAL = 10000
const { normalizeMessageContent, proto, WAMessageStubType } = require('@whiskeysockets/baileys')
const TIPOS_APAGAVEIS = new Set([
  'conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage',
  'audioMessage', 'documentMessage', 'stickerMessage', 'contactMessage',
  'contactsArrayMessage', 'locationMessage', 'liveLocationMessage',
  'pollCreationMessage', 'pollCreationMessageV2', 'pollCreationMessageV3',
  'pollCreationMessageV5', 'buttonsMessage', 'templateMessage', 'listMessage',
  'interactiveMessage', 'buttonsResponseMessage', 'templateButtonReplyMessage',
  'listResponseMessage', 'interactiveResponseMessage', 'groupInviteMessage',
  'eventMessage', 'productMessage', 'orderMessage'
])

function registrar(key) {
  if (typeof key?.fromMe !== 'boolean' || !key.id || !String(key.remoteJid || '').endsWith('@g.us')) return
  if (!key.fromMe && !/@(?:lid|s\.whatsapp\.net)$/.test(String(key.participant || ''))) return
  const identificador = `${key.remoteJid}:${key.id}`
  if (chaves.has(identificador)) return
  // Lista explícita: nunca copiar conteúdo, mídia ou campos arbitrários.
  const copia = { remoteJid: key.remoteJid, id: key.id, fromMe: key.fromMe }
  if (key.participant) copia.participant = key.participant
  ordens.set(key, ++sequencia)
  ordens.set(copia, sequencia)
  chaves.set(identificador, copia)
  const grupo = [...chaves.entries()].filter(([, k]) => k.remoteJid === key.remoteJid)
  if (grupo.length > LIMITE_POR_GRUPO) remover(grupo[0][1])
  while (chaves.size > LIMITE_TOTAL) remover(chaves.values().next().value)
}

function recentes(jid, quantidade, antesDe) {
  let grupo = [...chaves.values()].filter(k => k.remoteJid === jid)
  // No mesmo lote pode haver mensagens posteriores ao pedido. A própria
  // key do pedido marca a fronteira; nunca selecionar ela ou o que veio depois.
  const indice = antesDe?.remoteJid === jid ? grupo.findIndex(k => k.id === antesDe.id) : -1
  if (indice >= 0) grupo = grupo.slice(0, indice)
  else if (antesDe?.remoteJid === jid && ordens.has(antesDe)) {
    grupo = grupo.filter(k => ordens.get(k) < ordens.get(antesDe))
  }
  return grupo.filter(k => !solicitadas.has(`${jid}:${k.id}`)).reverse().slice(0, quantidade).map(k => ({ ...k }))
}

function remover(key) {
  if (!key?.id || !key.remoteJid) return
  chaves.delete(`${key.remoteJid}:${key.id}`)
  solicitadas.delete(`${key.remoteJid}:${key.id}`)
}

function disponivel(key) {
  const id = `${key.remoteJid}:${key.id}`
  return chaves.has(id) && !solicitadas.has(id)
}

function exclusaoEnviada(key) {
  const id = `${key.remoteJid}:${key.id}`
  // A revogação pode ter chegado antes de sendMessage resolver.
  if (chaves.has(id)) solicitadas.add(id)
}

function capturarMensagens({ messages = [] } = {}) {
  for (const msg of messages) {
    if (!msg?.key) continue
    let conteudo
    try { conteudo = normalizeMessageContent(msg.message) } catch (_) { continue }
    const protocolo = conteudo?.protocolMessage
    if (protocolo?.type === proto.Message.ProtocolMessage.Type.REVOKE) {
      const alvo = protocolo.key
      if (alvo?.id && (!alvo.remoteJid || alvo.remoteJid === msg.key?.remoteJid)) {
        remover({ remoteJid: msg.key?.remoteJid, id: alvo.id })
      }
      continue
    }
    if (!conteudo || msg.messageStubType || !Object.keys(conteudo).some(tipo => TIPOS_APAGAVEIS.has(tipo))) continue
    registrar(msg.key)
  }
}

function confirmarRevogacoes(atualizacoes) {
  for (const { key, update } of atualizacoes) {
    if (update?.messageStubType === WAMessageStubType.REVOKE) remover(key)
  }
}

function acompanharSocket(sock) {
  if (sockets.has(sock)) return
  sockets.add(sock)
  // Listener separado: cobre TODOS os itens do lote antes do roteador,
  // inclusive durante OFF, sem tocar na contagem, mídia ou moderação.
  sock.ev?.on('messages.upsert', capturarMensagens)
  sock.ev?.on('messages.update', confirmarRevogacoes)
  sock.ev?.on('messages.delete', evento => {
    for (const key of evento.keys || []) remover(key)
    if (evento.all && evento.jid) {
      for (const key of chaves.values()) if (key.remoteJid === evento.jid) remover(key)
    }
  })
  const enviar = sock.sendMessage
  sock.sendMessage = async function (jid, conteudo, ...opcoes) {
    const resultado = await enviar.call(this, jid, conteudo, ...opcoes)
    // Ações de protocolo não viram mensagens a limpar. Edições já têm a
    // chave do envio original; não são um novo item no histórico.
    if (conteudo && !('delete' in conteudo) && !('react' in conteudo) && !('edit' in conteudo) && !('pin' in conteudo)) {
      if (resultado?.key?.fromMe === true) registrar(resultado.key)
    }
    return resultado
  }
}

module.exports = { acompanharSocket, recentes, remover, exclusaoEnviada, capturarMensagens, disponivel }
