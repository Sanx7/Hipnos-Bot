// Gera protocolo e votos cifrados reais do Baileys, exclusivamente em memória.
const crypto = require('node:crypto')
const { generateWAMessageContent, proto, hmacSign, aesEncryptGCM, jidNormalizedUser } = require('@whiskeysockets/baileys')
const BOT = '5511999999999@s.whatsapp.net'
let sequencia = 0
async function mensagemEnviada(jid, conteudo) {
  return { key: { id: `poll-${++sequencia}`, remoteJid: jid, fromMe: true }, message: conteudo.poll ? await generateWAMessageContent(structuredClone(conteudo), {}) : { conversation: conteudo.text } }
}
function voto(dados, jid, autor, indices, { timestamp = ++sequencia, criador = BOT } = {}) {
  const poll = dados.mensagemEnquete
  const votante = jidNormalizedUser(autor)
  const msgId = poll.key.id
  const secret = poll.message.messageContextInfo.messageSecret
  const key0 = hmacSign(secret, new Uint8Array(32), 'sha256')
  const sign = Buffer.concat([Buffer.from(msgId), Buffer.from(criador), Buffer.from(votante), Buffer.from('Poll Vote'), Buffer.from([1])])
  const chave = hmacSign(sign, key0, 'sha256')
  const selectedOptions = indices.map(i => crypto.createHash('sha256').update(dados.opcoes[i]).digest())
  const bytes = proto.Message.PollVoteMessage.encode({ selectedOptions }).finish()
  const encIv = crypto.randomBytes(12)
  const encPayload = aesEncryptGCM(bytes, chave, encIv, Buffer.from(`${msgId}\u0000${votante}`))
  return { key: { remoteJid: jid, participant: autor, fromMe: false, id: `vote-${++sequencia}` }, message: { pollUpdateMessage: {
    pollCreationMessageKey: poll.key, vote: { encIv, encPayload }, senderTimestampMs: timestamp
  } } }
}
module.exports = { BOT, mensagemEnviada, voto }
