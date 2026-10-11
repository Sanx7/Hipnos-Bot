const erro = require('./ads-erro')
const { normalizeMessageContent, downloadMediaMessage, jidNormalizedUser } = require('@whiskeysockets/baileys')
const prazo = require('./ads-prazo')
const LIMITES = { foto: 8 * 1024 * 1024, video: 16 * 1024 * 1024 }
function unica(c, nivel = 0) {
  if (!c || typeof c !== 'object') return false
  if (nivel > 10 || c.viewOnceMessage || c.viewOnceMessageV2 || c.viewOnceMessageV2Extension) return true
  return Object.values(c).some(v => v?.viewOnce === true || (v?.message && unica(v.message, nivel + 1)))
}
function validar(buffer, tipo) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > LIMITES[tipo]) throw erro('Mídia vazia ou acima do limite: foto 8 MB; vídeo 16 MB.')
  if (tipo === 'foto') {
    if (buffer.subarray(0, 3).equals(Buffer.from([255,216,255]))) return 'image/jpeg'
    if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png'
  }
  if (tipo === 'video' && buffer.length >= 16 && buffer.toString('ascii', 4, 8) === 'ftyp' && buffer.readUInt32BE(0) >= 16 && buffer.readUInt32BE(0) <= buffer.length &&
    ['isom','iso2','mp41','mp42','avc1','M4V ','MSNV','3gp4','3gp5'].includes(buffer.toString('ascii', 8, 12))) return 'video/mp4'
  throw erro('Formato não suportado: envie uma foto JPEG/PNG ou vídeo MP4 comum.')
}
async function extrair(sock, jid, msg, legenda, baixar = downloadMediaMessage) {
  const comando = normalizeMessageContent(msg.message) || {}
  const contexto = Object.values(comando).map(v => v?.contextInfo).find(v => v?.quotedMessage)
  if (!contexto) {
    if (!legenda.trim()) throw erro('Escreva o anúncio ou responda a uma foto/vídeo.')
    if (Array.from(legenda).length > 3000) throw erro('Limite de 3000 caracteres.')
    return { tipo: 'texto', texto: legenda }
  }
  if (unica(contexto.quotedMessage)) throw erro('Mídia de visualização única não pode ser reutilizada.')
  const conteudo = normalizeMessageContent(contexto.quotedMessage) || {}
  const tipo = conteudo.imageMessage ? 'foto' : conteudo.videoMessage ? 'video' : null
  if (!tipo) throw erro('Responda a uma foto ou vídeo comum, ou crie texto sem citação.')
  const node = conteudo.imageMessage || conteudo.videoMessage
  const caption = legenda || node.caption || ''
  if (Array.from(caption).length > 3000) throw erro('Limite de 3000 caracteres na legenda.')
  if (Number(node.fileLength || 0) > LIMITES[tipo]) throw erro('Mídia acima do limite: foto 8 MB; vídeo 16 MB.')
  if (contexto.remoteJid && contexto.remoteJid !== jid) throw erro('A mídia precisa pertencer a este grupo.')
  const alvo = { key: { remoteJid: jid, id: contexto.stanzaId, participant: contexto.participant,
    fromMe: [sock.user?.id, sock.user?.lid].filter(Boolean).some(v => jidNormalizedUser(v) === jidNormalizedUser(contexto.participant || '')) }, message: contexto.quotedMessage }
  let stream
  async function baixarStream(alvo) {
    let expirado = false
    // rc14 fetch ignores a timeout option; discard a stream arriving after our deadline.
    try { return await prazo(Promise.resolve(baixar(alvo, 'stream', {})).then(s => { if (expirado) { s?.destroy?.(); throw new Error('Download expirado') }; return s })) }
    finally { expirado = true }
  }
  try { stream = await baixarStream(alvo) }
  catch (e) {
    const status = e?.output?.statusCode || e?.status
    if (![404,410].includes(status) || typeof sock.updateMediaMessage !== 'function') throw erro('Não consegui baixar a mídia. Envie uma cópia recente.')
    const novo = await prazo(sock.updateMediaMessage(alvo))
    if (unica(novo?.message)) throw erro('Mídia de visualização única não pode ser reutilizada.')
    stream = await baixarStream(novo)
  }
  const chunks = []; let tamanho = 0
  const timer = setTimeout(() => stream?.destroy?.(new Error('Download expirado')), 30000)
  try {
    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk)) throw erro('Download inválido.')
      tamanho += chunk.length
      if (tamanho > LIMITES[tipo]) throw erro('Mídia acima do limite: foto 8 MB; vídeo 16 MB.')
      chunks.push(chunk)
    }
  } finally { clearTimeout(timer); stream?.destroy?.() }
  const buffer = Buffer.concat(chunks), mimetype = validar(buffer, tipo)
  return { tipo, texto: caption, mimetype, buffer }
}
async function preparar(doc, storage) {
  if (!['texto','foto','video'].includes(doc.tipo) || typeof doc.texto !== 'string' || Array.from(doc.texto).length > 3000 || (doc.tipo === 'texto' && !doc.texto.trim())) throw erro('Conteúdo inválido.')
  if (doc.tipo === 'texto') return { text: doc.texto }
  const buffer = await storage.ler(doc.midia, LIMITES[doc.tipo])
  const mimetype = validar(buffer, doc.tipo)
  return { [doc.tipo === 'foto' ? 'image' : 'video']: buffer, caption: doc.texto, mimetype, jpegThumbnail: Buffer.alloc(0) }
}
module.exports = { extrair, unica, validar, preparar, LIMITES }
