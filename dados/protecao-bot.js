// Proteção compartilhada da conta conectada. JID de telefone e LID têm
// namespaces distintos: dígitos iguais, sozinhos, não provam identidade.
const { limparNumero } = require('../config')
const lid = require('../lid')
const RESPOSTAS_AUTOEXPULSAO = Object.freeze([
  '🌙 *Hipnos:* Achou mesmo que eu seria tão idiota a ponto de expulsar a mim mesmo? Hahaha... Volte a dormir, mortal. 💤',
  '🌑 *Hipnos:* Tentando me expulsar com minhas próprias mãos? Nem nos seus sonhos, mortal.',
  '💤 *Hipnos:* Eu sou o senhor dos sonhos, não o deus da burrice. Bela tentativa.',
  '🥀 *Hipnos:* Sua tentativa foi tão patética que até os pesadelos sentiram vergonha.',
  '👁️ *Hipnos:* Acha que pode enganar o próprio senhor do sono? Que ingenuidade deliciosa.'
])
let ultimaResposta = -1

function respostaAutoexpulsao() {
  const candidatos = RESPOSTAS_AUTOEXPULSAO.map((_, i) => i).filter(i => i !== ultimaResposta)
  ultimaResposta = candidatos[Math.floor(Math.random() * candidatos.length)]
  return RESPOSTAS_AUTOEXPULSAO[ultimaResposta]
}
const protegidos = new WeakSet()

function chave(jid) {
  const numero = limparNumero(jid)
  return numero ? `${lid.ehLid(jid) ? 'lid' : 'pn'}:${numero}` : ''
}

async function verificarAlvos(sock, jid, alvos, participantes) {
  const idsBot = [sock.user?.id, sock.user?.lid && `${limparNumero(sock.user.lid)}@lid`].filter(Boolean)
  if (!idsBot.length) throw new Error('Identidade da sessão do bot indisponível; remoção recusada.')
  if (!participantes) {
    try { participantes = (await sock.groupMetadata(jid))?.participants || [] } catch (_) { participantes = [] }
  }
  const pares = new Map()
  for (const p of participantes) {
    const telefone = !lid.ehLid(p.phoneNumber) && limparNumero(p.phoneNumber) ||
      (!lid.ehLid(p.id) ? limparNumero(p.id) : '')
    if (!telefone) continue
    for (const id of [p.id, p.lid && `${limparNumero(p.lid)}@lid`]) {
      if (lid.ehLid(id)) pares.set(limparNumero(id), telefone)
    }
  }
  const pnBot = idsBot.find(id => !lid.ehLid(id))
  if (pnBot) for (const id of idsBot.filter(lid.ehLid)) pares.set(limparNumero(id), limparNumero(pnBot))
  function identidade(id) {
    const resultado = new Set([chave(id)].filter(Boolean))
    const numero = limparNumero(id)
    if (lid.ehLid(id) && pares.has(numero)) resultado.add(`pn:${pares.get(numero)}`)
    if (!lid.ehLid(id)) for (const [lidId, telefone] of pares) {
      if (telefone === numero) resultado.add(`lid:${lidId}`)
    }
    return resultado
  }
  function avaliar(id) {
    const bot = new Set(idsBot.flatMap(idBot => [...identidade(idBot)]))
    const alvo = identidade(id)
    if ([...alvo].some(c => bot.has(c))) return true
    // Sem um namespace em comum, não há prova de que sejam contas diferentes.
    if ([...alvo].some(a => [...bot].some(b => a.split(':')[0] === b.split(':')[0]))) return false
    return null
  }
  const desconhecidos = alvos.filter(id => avaliar(id) === null)
  if (desconhecidos.length) {
    const ids = [...desconhecidos, ...idsBot].filter(lid.ehLid).filter(id => !pares.has(limparNumero(id)))
    const resolvidos = await lid.resolverLidsEmLote(ids)
    for (const [id, telefone] of resolvidos) pares.set(id, telefone)
  }
  return alvos.map(alvo => ({ alvo, proprioBot: avaliar(alvo) }))
}

async function ehProprioBot(sock, jid, alvo, participantes) {
  const [resultado] = await verificarAlvos(sock, jid, [alvo], participantes)
  if (resultado.proprioBot === null) throw new Error('Não foi possível distinguir o alvo da conta do bot por JID/LID.')
  return resultado.proprioBot
}

async function filtrarAlvosRemocao(sock, jid, alvos, participantes) {
  const resultados = await verificarAlvos(sock, jid, alvos, participantes)
  return resultados.filter(r => r.proprioBot === false).map(r => r.alvo)
}

// Instalar a cada socket criado/reconectado. Todas as remoções, inclusive
// automações e lotes, passam por esta barreira; promote/demote ficam intactos.
function protegerRemocoes(sock) {
  if (protegidos.has(sock)) return sock
  const original = sock.groupParticipantsUpdate.bind(sock)
  sock.groupParticipantsUpdate = async (jid, alvos, acao) => {
    if (acao !== 'remove') return original(jid, alvos, acao)
    const seguros = await filtrarAlvosRemocao(sock, jid, alvos)
    if (seguros.length !== alvos.length) console.warn('[protecao-bot] Remoção da própria conta ou de alvo não identificável recusada.')
    return seguros.length ? original(jid, seguros, acao) : []
  }
  protegidos.add(sock)
  return sock
}

module.exports = { ehProprioBot, filtrarAlvosRemocao, protegerRemocoes, respostaAutoexpulsao, RESPOSTAS_AUTOEXPULSAO }
