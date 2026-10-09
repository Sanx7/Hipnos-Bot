const { createHash } = require('node:crypto')
const { normalizeMessageContent, decryptPollVote, getKeyAuthor, jidNormalizedUser } = require('@whiskeysockets/baileys')
const { removerPrefixo } = require('../prefixo')
const { resolverNumeroAlvo, ehLid } = require('../lid')
const { limparNumero } = require('../config')
const { obterJogo } = require('./jogos-ativos')

const MAX_OPCOES = 12
const MIN_OPCOES = 2
function parse(texto) {
  const partes = removerPrefixo(String(texto || '')).replace(/^\S+\s*/, '').split('|').map(p => p.trim())
  return { pergunta: partes[0], opcoes: partes.slice(1) }
}
function validar(pergunta, opcoes) {
  if (!pergunta?.trim()) return '❌ A pergunta não pode ficar vazia.'
  if (opcoes.length < MIN_OPCOES) return '❌ Preciso de pelo menos *2* opções.'
  if (opcoes.length > MAX_OPCOES) return '❌ Limite de *12* opções por enquete.'
  if (opcoes.some(o => !o.trim())) return '❌ As opções não podem ficar vazias.'
  if (pergunta.length > 255 || opcoes.some(o => o.length > 100)) return '❌ Use até 255 caracteres na pergunta e 100 em cada opção.'
  const unicas = opcoes.map(o => o.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim())
  if (new Set(unicas).size !== opcoes.length) return '❌ As opções não podem ser duplicadas.'
  return null
}
// Mesmo payload nativo do /eununca; nunca usa texto como fallback de votação.
const montarEnquete = (pergunta, opcoes) => ({ poll: { name: pergunta, values: [...opcoes], selectableCount: 1 } })
function participantesDoAutor(participantes, autor) {
  const jid = jidNormalizedUser(autor || '')
  return participantes.filter(p => [p?.id, p?.phoneNumber].filter(Boolean).some(id => jidNormalizedUser(id) === jid))
}

async function registrarVotoNativo(sock, jid, msg, dados) {
  const update = normalizeMessageContent(msg.message)?.pollUpdateMessage
  const original = dados.mensagemEnquete
  const chave = update?.pollCreationMessageKey
  if (!original?.key?.id || chave?.id !== original.key.id || (chave.remoteJid && chave.remoteJid !== jid)) return false
  if (msg.key?.remoteJid !== jid || !update.vote) return false
  const secret = original.message?.messageContextInfo?.messageSecret
  if (!secret) return false
  const autor = msg.key.participant || msg.key.remoteJid
  let participantes = []
  try { participantes = (await sock.groupMetadata(jid))?.participants || [] } catch (_) { /* tenta sessão */ }
  if (ehLid(autor)) participantes = participantes.filter(p => ehLid(p?.id) && limparNumero(p.id) === limparNumero(autor))
  const alvo = await resolverNumeroAlvo(participantes, autor)
  if (!alvo.via || !alvo.numero) return false
  const timestamp = Number(update.senderTimestampMs)
  if (!Number.isFinite(timestamp) || timestamp <= (dados.ultimosVotos?.get(alvo.numero) ?? -1)) return false
  let voto
  // A autenticação GCM valida os namespaces PN/LID; não compara dígitos para descriptografar.
  const criadores = [sock.user?.id, sock.user?.lid].filter(Boolean).map(jidNormalizedUser)
  const votantes = [getKeyAuthor(msg.key), msg.key.participant].filter(Boolean).map(jidNormalizedUser)
  for (const criador of new Set(criadores)) {
    for (const votante of new Set(votantes)) {
      try {
        voto = decryptPollVote(update.vote, { pollCreatorJid: criador, pollMsgId: original.key.id, pollEncKey: secret, voterJid: votante })
        break
      } catch (_) { /* outro namespace ou payload inválido */ }
    }
    if (voto) break
  }
  if (!voto || voto.selectedOptions.length > 1 || obterJogo(jid)?.dados !== dados) return false
  const indice = voto.selectedOptions.length ? dados.opcoes.findIndex(o =>
    createHash('sha256').update(o).digest().equals(Buffer.from(voto.selectedOptions[0]))) : -1
  if (voto.selectedOptions.length && indice < 0) return false
  // Troca/remoção de voto só após autenticar e validar todo o payload.
  dados.ultimosVotos ||= new Map()
  if (timestamp <= (dados.ultimosVotos.get(alvo.numero) ?? -1)) return false
  dados.ultimosVotos.set(alvo.numero, timestamp)
  for (const conjunto of dados.votos.values()) conjunto.delete(alvo.numero)
  if (indice >= 0) dados.votos.get(indice).add(alvo.numero)
  return true
}

module.exports = { MAX_OPCOES, MIN_OPCOES, parse, validar, montarEnquete, registrarVotoNativo, participantesDoAutor }
