const database = require('../database')
const lid = require('../lid')
const { agruparPorNumero } = require('../ranking-registro')
const { limparNumero, ehAdminDoGrupo, ehDonoDoBot } = require('../config')

const PERIODO = 'Período: contagem acumulada dos registros disponíveis do Hipnos (mesmo contador do /ranking).'
const NOTA = 'A coleta pode ter lacunas ou reinicializações; não representa necessariamente todo o histórico do grupo.'

async function autorizado(participantes, msg) {
  const sender = msg.key.participant || msg.key.remoteJid
  if (ehAdminDoGrupo(participantes, sender)) return true
  const resolucao = await lid.resolverNumeroAlvo(participantes, sender)
  // Não deixar um LID sem associação coincidir com os dígitos de um dono.
  return Boolean(resolucao.via && resolucao.numero &&
    ehDonoDoBot(participantes, `${resolucao.numero}@s.whatsapp.net`))
}

async function listarAtividade(sock, jid, participantes) {
  const registros = await database.buscarContagensGrupo(jid)
  const ids = participantes.flatMap(p => [p.id, p.jid, p.lid, p.phoneNumber])
  ids.push(sock.user?.id, sock.user?.lid)
  ids.push(...registros.flatMap(r => [r.usuario_id, r.lid]))
  // Metadados com telefone já bastam; só consultar pares desconhecidos.
  const conhecidos = new Map()
  for (const p of participantes) {
    const telefone = limparNumero(p.phoneNumber) ||
      (String(p.id || p.jid).endsWith('@s.whatsapp.net') ? limparNumero(p.id || p.jid) : '')
    if (telefone) for (const id of [p.id, p.jid, p.lid, p.phoneNumber]) {
      if (limparNumero(id)) conhecidos.set(limparNumero(id), telefone)
    }
  }
  const mapeados = await lid.resolverLidsEmLote(ids.filter(id => id && !conhecidos.has(limparNumero(id))))
  const numeros = new Map([...mapeados, ...conhecidos])
  const canonico = id => numeros.get(limparNumero(id)) || limparNumero(id)
  const bot = new Set([sock.user?.id, sock.user?.lid].filter(Boolean).map(canonico))
  const membros = new Map()
  for (const p of participantes) {
    const jidMembro = p.id || p.jid
    if (!jidMembro) continue
    const aliases = [jidMembro, p.lid, p.phoneNumber].filter(Boolean)
    if (aliases.some(id => bot.has(canonico(id)))) continue
    const chave = canonico(jidMembro)
    const telefone = conhecidos.get(limparNumero(jidMembro)) || mapeados.get(limparNumero(jidMembro)) || ''
    membros.set(chave, { jid: jidMembro, telefone, identificacao: telefone || `LID ${limparNumero(jidMembro)} (telefone indisponível)`, total: 0 })
    for (const id of aliases) numeros.set(limparNumero(id), chave)
  }
  // O campo lid preservado no registro também prova a associação antiga.
  for (const r of registros) {
    if (r.lid && membros.has(canonico(r.lid))) numeros.set(limparNumero(r.usuario_id), canonico(r.lid))
  }
  for (const r of agruparPorNumero(registros, numeros)) {
    const membro = membros.get(r.usuario_id)
    if (membro) membro.total = r.total
  }
  return [...membros.values()]
}

module.exports = { listarAtividade, autorizado, PERIODO, NOTA }
