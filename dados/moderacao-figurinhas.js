const { createHash } = require('node:crypto')
const { downloadMediaMessage, normalizeMessageContent } = require('@whiskeysockets/baileys')
const { identificar } = require('./identidade-participante')
const { ehProprioBot } = require('./protecao-bot')
const regras = require('./figurinhas-regras')
const advertencias = require('../advertencias')
const adv = require('../comandos/admin/adv')
const MAX_BYTES = 2 * 1024 * 1024
const MAX_CACHE = 1000
const hashes = new Map()
const processadas = new Map()
let downloadTeste
let downloadsAtivos = 0

function cachear(mapa, key, promise) {
  mapa.set(key, { promise, expira: Date.now() + 10 * 60000 })
  while (mapa.size > MAX_CACHE) mapa.delete(mapa.keys().next().value)
  return promise
}
function buscar(mapa, key) {
  const item = mapa.get(key)
  if (item?.expira > Date.now()) return item.promise
  mapa.delete(key)
}
function sticker(msg) {
  if (msg?.messageStubType) return null
  return normalizeMessageContent(msg?.message)?.stickerMessage || null
}
async function calcularHash(msg) {
  const midia = sticker(msg)
  if (!midia) throw new Error('Responda a uma figurinha')
  if (Number(midia.fileLength) > MAX_BYTES) throw new Error('Figurinha excede 2 MB')
  const key = `${msg.key?.remoteJid}:${msg.key?.id}`
  if (msg.key?.id && buscar(hashes, key)) return buscar(hashes, key)
  const trabalho = (async () => {
    if (downloadsAtivos >= 4) throw new Error('Limite de downloads simultâneos')
    downloadsAtivos++
    let stream
    const sinal = AbortSignal.timeout(15000)
    const abortar = () => stream?.destroy?.(new Error('Download expirado'))
    try {
      stream = await (downloadTeste || downloadMediaMessage)(msg, 'stream', { options: { signal: sinal } })
      const hash = createHash('sha256')
      let tamanho = 0
      sinal.addEventListener('abort', abortar, { once: true })
      if (sinal.aborted) throw new Error('Download expirado')
      for await (const chunk of stream) {
        tamanho += chunk.length
        if (tamanho > MAX_BYTES) throw new Error('Figurinha excede 2 MB')
        hash.update(chunk)
      }
      if (!tamanho) throw new Error('Figurinha indisponível')
      return hash.digest('hex')
    } finally { downloadsAtivos--; sinal.removeEventListener('abort', abortar); stream?.destroy?.() }
  })()
  // Só hash/promessa em RAM; os bytes são consumidos e descartados no stream.
  return msg.key?.id ? cachear(hashes, key, trabalho) : trabalho
}
async function botAdmin(sock, jid, participantes) {
  for (const p of participantes) {
    if (p.admin !== 'admin' && p.admin !== 'superadmin') continue
    if (await ehProprioBot(sock, jid, p.id, participantes)) return true
  }
  return false
}
async function estadoAlvo(sock, jid, sender) {
  const participantes = (await sock.groupMetadata(jid))?.participants || []
  if (await ehProprioBot(sock, jid, sender, participantes)) return null
  const alvo = await identificar(participantes, sender)
  if (!alvo.participante || !alvo.numero) return null
  return { ...alvo, participantes, botAdmin: await botAdmin(sock, jid, participantes) }
}
async function executarAcao(sock, msg, hash, acao) {
  const { remoteJid: jid, id, participant: sender } = msg.key
  // Reserva persistente ANTES de qualquer efeito. Após uma falha parcial não
  // repetir automaticamente: WhatsApp e MongoDB não têm transação conjunta.
  if (!await regras.reservar(jid, id, hash, acao, sender)) return true
  let estado = 'identidade_indisponivel'
  try {
    const alvo = await estadoAlvo(sock, jid, sender)
    if (!alvo) return true
    let apagada = false
    if (alvo.botAdmin) {
      try { await sock.sendMessage(jid, { delete: { remoteJid: jid, id, participant: sender, fromMe: false } }); apagada = true }
      catch (_) { /* A falha da exclusão não duplica nem impede a outra ação. */ }
    }
    if (alvo.admin || alvo.dono) { estado = 'protegido'; return true }
    if (acao === 'del') { estado = apagada ? 'exclusao_enviada' : 'exclusao_indisponivel'; return true }
    if (acao === 'ban') {
      // Revalidar após o await da exclusão: o membro pode ter saído ou sido promovido.
      const atual = await estadoAlvo(sock, jid, sender)
      if (!atual || atual.admin || atual.dono) { estado = 'protegido_ou_ausente'; return true }
      if (!atual.botAdmin) { estado = 'sem_admin'; return true }
      const resultado = await sock.groupParticipantsUpdate(jid, [atual.participante.id], 'remove')
      if (!resultado?.length || resultado.some(r => String(r.status) !== '200')) throw new Error('Remoção recusada')
      estado = 'remocao_enviada'
      await sock.sendMessage(jid, { text: '🌑 *Hipnos:* A figurinha proibida abriu as portas do limbo. Seu autor foi removido do recinto.' })
      return true
    }
    return await advertencias.comAdvertenciasSerializadas(alvo.numero, jid, async () => {
    const recente = await estadoAlvo(sock, jid, sender)
    if (!recente || recente.numero !== alvo.numero || recente.admin || recente.dono) { estado = 'protegido_ou_ausente'; return true }
    const bot = await identificar(alvo.participantes, sock.user?.id)
    const motivo = 'Figurinha proibida pela moderação do grupo'
    const resultado = await advertencias.criarAdvertencia({ numero: alvo.numero, grupoId: jid, motivo, aplicadoPor: bot.numero })
    if (!resultado) throw new Error('Advertência não registrada')
    estado = 'advertencia_registrada'
    if (resultado.total >= resultado.limite) {
      const atual = await estadoAlvo(sock, jid, sender)
      if (atual?.botAdmin && !atual.admin && !atual.dono) {
        await adv.aplicarBanAutomatico(sock, jid, msg, atual.participante.id, atual.numero, bot.numero || 'desconhecido', {
          verificarStatus: true, limite: resultado.limite,
          validar: async () => {
            const final = await estadoAlvo(sock, jid, sender)
            if (!final || final.admin || final.dono || !final.botAdmin) throw new Error('Remoção não autorizada')
          }
        })
        return true
      }
    }
    await sock.sendMessage(jid, {
      text: adv.montarConfirmacao({ alvoNumero: alvo.numero, motivo, aplicadoPor: bot.numero || 'desconhecido', total: resultado.total, data: resultado.doc.data, limite: resultado.limite }),
      mentions: [sender]
    }, { quoted: msg })
    return true
    })
  } catch (_) {
    estado = `${estado}_falha`
    console.warn('[figurinhas] A ocorrência não pôde ser concluída; sem repetição automática.')
    return true
  } finally { await regras.concluir(jid, id, estado).catch(() => {}) }
}
async function processar(sock, msg) {
  if (!msg?.key?.remoteJid?.endsWith('@g.us') || msg.key.fromMe || !msg.key.id || !msg.key.participant || !sticker(msg)) return false
  const key = `${msg.key.remoteJid}:${msg.key.id}`
  if (buscar(processadas, key)) return buscar(processadas, key)
  const trabalho = (async () => {
    try {
      if (!await regras.temRegras(msg.key.remoteJid)) return false
      const hash = await calcularHash(msg)
      const acao = await regras.consultar(msg.key.remoteJid, hash)
      return acao ? await executarAcao(sock, msg, hash, acao) : false
    } catch (_) {
      console.warn('[figurinhas] Moderação indisponível para esta mensagem; fluxo preservado.')
      return false
    }
  })()
  return cachear(processadas, key, trabalho)
}
async function processarLote(sock, mensagens = []) {
  const tratadas = new Set()
  for (const msg of mensagens) {
    try {
      if (await processar(sock, msg)) tratadas.add(`${msg.key.remoteJid}:${msg.key.id}`)
    } catch (_) { console.warn('[figurinhas] Evento inválido ignorado.') }
  }
  return tratadas
}
module.exports = {
  calcularHash, identificar, processar, processarLote, MAX_BYTES,
  __definirDownloadTeste(fn) { downloadTeste = fn; hashes.clear(); processadas.clear() }
}
