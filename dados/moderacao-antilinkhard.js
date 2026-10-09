const config = require('./antilinkhard-config')
const { temLinkHard } = require('./deteccao-links')
const { extrairTextoComando } = require('./texto-comando')
const { identificar } = require('./identidade-participante')
const { ehProprioBot } = require('./protecao-bot')
const { removerDoGrupoConfirmado } = require('../comandos/admin/ban')
const processadas = new Map()
const MAX_CACHE = 1000
const TTL_CACHE = 10 * 60 * 1000
const ANUNCIO = '🌙 *HIPNOS — JULGAMENTO DAS SOMBRAS*\n\n🔗 Um mortal ousou espalhar caminhos proibidos neste reino.\n\n⚖️ Infração: Envio de link.\n💀 Punição: Expulsão.\n\n🌑 Que seu descanso seja eterno fora destas terras.'

async function estadoAlvo(sock, jid, sender) {
  const meta = await sock.groupMetadata(jid)
  const participantes = meta?.participants || []
  if (await ehProprioBot(sock, jid, sender, participantes)) return null
  const alvo = await identificar(participantes, sender)
  if (!alvo.numero || !alvo.participante) return null
  const donoGrupo = meta.owner ? await identificar(participantes, meta.owner) : null
  if (meta.owner && !donoGrupo?.numero) throw new Error('Identidade do dono do grupo indisponível')
  if (alvo.admin || alvo.dono || donoGrupo?.numero === alvo.numero) return null
  let botAdmin = false
  for (const p of participantes.filter(p => ['admin', 'superadmin'].includes(p.admin))) {
    if (await ehProprioBot(sock, jid, p.id, participantes)) { botAdmin = true; break }
  }
  return { ...alvo, botAdmin }
}
async function tratar(sock, msg) {
  const { remoteJid: jid, participant: sender, id } = msg.key
  try { if (!await config.obter(jid)) return false }
  catch (_) { console.warn('[antilinkhard] Configuração indisponível; sem expulsão.'); return false }
  let estado = 'reservada', apagada = false, token, numero
  try {
    if (!await config.reservarEvento(jid, id, sender)) return true
  } catch (_) { console.warn('[antilinkhard] Reserva indisponível; sem punição.'); return true }
  try {
    const alvo = await estadoAlvo(sock, jid, sender)
    if (!alvo) { estado = 'protegido_ausente_ou_nao_identificado'; return true }
    if (!alvo.botAdmin) { estado = 'bot_sem_admin'; return true }
    numero = alvo.numero
    token = await config.reservarParticipante(jid, numero)
    // Cada mensagem tem uma reserva própria. Mesmo sob trava do autor, apagar
    // a nova mensagem uma vez, sem iniciar outra expulsão.
    try {
      await sock.sendMessage(jid, { delete: { remoteJid: jid, id, participant: sender, fromMe: false } })
      apagada = true
    } catch (_) { console.warn('[antilinkhard] Exclusão da mensagem não confirmada.'); }
    if (!token) { estado = 'participante_em_cooldown'; return true }
    await removerDoGrupoConfirmado(sock, jid, alvo.participante.id, {
      validar: async () => {
        if (!await config.obter(jid, true)) throw new Error('Regra desativada antes da expulsão')
        const atual = await estadoAlvo(sock, jid, sender)
        if (!atual || !atual.botAdmin || atual.numero !== numero || atual.participante.id !== alvo.participante.id) {
          throw new Error('Participante protegido, ausente ou sem autorização de remoção')
        }
      }
    })
    estado = 'remocao_confirmada'
    // Persistir a confirmação ANTES do anúncio. Falha de armazenamento não
    // permite repetir a remoção nem emitir confirmação sem registro.
    await config.concluirEvento(jid, id, estado, { mensagem_apagada: apagada })
    await sock.sendMessage(jid, { text: ANUNCIO })
    return true
  } catch (erro) {
    if (estado !== 'remocao_confirmada') estado = 'remocao_nao_confirmada'
    console.warn('[antilinkhard] Operação incompleta:', erro.message)
    return true
  } finally {
    await config.concluirEvento(jid, id, estado, { mensagem_apagada: apagada }).catch(() => {
      console.warn('[antilinkhard] Falha ao atualizar a ocorrência; sem repetição automática.')
    })
    if (token) await config.concluirParticipante(jid, numero, token, estado).catch(() => {})
  }
}
async function processar(sock, msg) {
  if (!msg?.key?.remoteJid?.endsWith('@g.us') || msg.key.fromMe || !msg.key.id ||
      !msg.key.participant || msg.messageStubType || !temLinkHard(extrairTextoComando(msg))) return false
  const chave = `${msg.key.remoteJid}:${msg.key.id}`
  const salvo = processadas.get(chave)
  if (salvo && (salvo.ativo || salvo.expira > Date.now())) return salvo.promise
  processadas.delete(chave)
  for (const [key, item] of processadas) {
    if (!item.ativo && (item.expira <= Date.now() || processadas.size >= MAX_CACHE)) processadas.delete(key)
  }
  if (processadas.size >= MAX_CACHE) { console.warn('[antilinkhard] Limite de operações simultâneas; sem nova expulsão.'); return false }
  const item = { ativo: true, expira: Date.now() + TTL_CACHE }
  item.promise = tratar(sock, msg).finally(() => { item.ativo = false })
  processadas.set(chave, item)
  return item.promise
}
async function processarLote(sock, mensagens = []) {
  const tratadas = new Set()
  for (const msg of mensagens) {
    try { if (await processar(sock, msg)) tratadas.add(`${msg.key.remoteJid}:${msg.key.id}`) }
    catch (_) { console.warn('[antilinkhard] Evento inválido ignorado.') }
  }
  return tratadas
}
module.exports = { processar, processarLote, MAX_CACHE,
  __limparCacheTeste() { processadas.clear() }, __tamanhoCacheTeste() { return processadas.size } }
