const erro = require('./dados/ads-erro')
const { randomUUID } = require('crypto')
const { ObjectId } = require('mongodb')
const storage = require('./dados/ads-storage')
const { proxima, exibir } = require('./dados/ads-tempo')
const midia = require('./dados/ads-midia')
const prazo = require('./dados/ads-prazo')
const GRUPO = /^\d+(?:-\d+)?@g\.us$/
const LEASE = 120000, JANELA = 60000, ESPACO = 10000, ESPACO_GRUPO = 30000
function chave(jid, id) {
  if (!GRUPO.test(jid) || !/^[1-5]$/.test(String(id))) throw erro('Informe um anúncio de 1 a 5 neste grupo.')
  return `${jid}:${id}`
}
function log(etapa) { console.info('[setads]', etapa) }
async function listar(jid) {
  chave(jid, 1)
  return (await storage.obter()).ads.find({ grupo: jid, estado: 'pronto' }).sort({ id: 1 }).toArray()
}
async function obter(jid, id) {
  const doc = await (await storage.obter()).ads.findOne({ _id: chave(jid, id), estado: 'pronto' })
  if (!doc) throw erro('Anúncio não encontrado neste grupo.')
  return doc
}
async function criar(jid, conteudo, autor, agora = Date.now()) {
  chave(jid, 1)
  if (!autor || !['texto','foto','video'].includes(conteudo.tipo) || typeof conteudo.texto !== 'string' || Array.from(conteudo.texto).length > 3000 || (conteudo.tipo === 'texto' && !conteudo.texto.trim())) throw erro('Conteúdo inválido.')
  if (conteudo.tipo !== 'texto') midia.validar(conteudo.buffer, conteudo.tipo)
  const s = await storage.obter()
  for (let id = 1; id <= 5; id++) {
    const doc = { _id: chave(jid, id), id, grupo: jid, geracao: randomUUID(), revisao: 0, estado: 'criando', ativo: false,
      tipo: conteudo.tipo, texto: conteudo.texto, midia: conteudo.tipo === 'texto' ? null : new ObjectId().toHexString(),
      modo: null, minutos: null, horario: null, proximo: null, ultimo: null, criado: agora, atualizado: agora, autor,
      leaseAte: agora + 900000, falhas: 0 }
    try { await s.ads.insertOne(doc) }
    catch (e) { if (e.code === 11000) continue; throw e }
    try {
      if (doc.midia) await s.salvar(doc.midia, conteudo.buffer)
      const r = await s.ads.updateOne({ _id: doc._id, geracao: doc.geracao, estado: 'criando' }, { $set: { estado: 'pronto', leaseAte: 0 } })
      if (!r.modifiedCount) throw erro('Reserva expirada.')
      return { ...doc, estado: 'pronto', leaseAte: 0 }
    } catch (e) {
      // Tombstone durável: limpeza posterior também recupera falha do próprio GridFS.
      await s.ads.updateOne({ _id: doc._id, geracao: doc.geracao }, { $set: { estado: 'excluindo', ativo: false, leaseAte: 0 } }).catch(() => {})
      await limpar(agora).catch(() => {})
      throw e
    }
  }
  throw erro('Este grupo já tem cinco anúncios ou reservas pendentes. Exclua um antes de criar outro.')
}
async function alterar(jid, id, acao, valor, autor, agora = Date.now()) {
  const doc = await obter(jid, id), mudanca = { atualizado: agora, autor }
  if (acao === 'intervalo') {
    if (!/^\d+$/.test(String(valor)) || Number(valor) < 15 || Number(valor) > 1440) throw erro('Intervalo permitido: 15 a 1440 minutos.')
    Object.assign(mudanca, { modo: 'intervalo', minutos: Number(valor), horario: null, ativo: false, proximo: null })
  } else if (acao === 'horario') {
    proxima({ modo: 'diario', horario: valor }, agora)
    Object.assign(mudanca, { modo: 'diario', horario: valor, minutos: null, ativo: false, proximo: null })
  } else if (acao === 'pausar') Object.assign(mudanca, { ativo: false, proximo: null })
  else if (acao === 'retomar') Object.assign(mudanca, { ativo: true, proximo: proxima(doc, agora), falhas: 0 })
  else throw erro('Opção inválida.')
  const r = await (await storage.obter()).ads.updateOne({ _id: doc._id, geracao: doc.geracao, estado: 'pronto', revisao: doc.revisao }, { $set: mudanca, $inc: { revisao: 1 } })
  if (!r.modifiedCount) throw erro('O anúncio mudou. Consulte novamente.')
  return { ...doc, ...mudanca, revisao: doc.revisao + 1 }
}
async function excluir(jid, id, autor, token, agora = Date.now()) {
  const doc = await obter(jid, id), s = await storage.obter(), _id = `excluir:${doc._id}:${autor}`
  if (!token) {
    const codigo = randomUUID().slice(0, 8)
    await s.controles.updateOne({ _id }, { $set: { token: codigo, geracao: doc.geracao, revisao: doc.revisao, ate: agora + 60000, expira: new Date(agora + 60000) } }, { upsert: true })
    return codigo
  }
  const r = await s.controles.deleteOne({ _id, token, geracao: doc.geracao, revisao: doc.revisao, ate: { $gt: agora } })
  if (!r.deletedCount) throw erro('Confirmação inválida, expirada ou anúncio alterado. Solicite excluir novamente.')
  const removido = await s.ads.updateOne({ _id: doc._id, geracao: doc.geracao, revisao: doc.revisao, estado: 'pronto' }, { $set: { estado: 'excluindo', ativo: false, proximo: null }, $inc: { revisao: 1 } })
  if (!removido.modifiedCount) throw erro('O anúncio mudou. Solicite excluir novamente.')
  await limpar(agora)
  return null
}
async function limpar(agora) {
  const s = await storage.obter()
  const docs = await s.ads.find({ $or: [{ estado: 'excluindo', leaseAte: { $lte: agora } }, { estado: 'criando', leaseAte: { $lte: agora } }] }).limit(50).toArray()
  for (const doc of docs) {
    // Claim a cleanup lease; tombstone prevents reuse while deleting chunks.
    const token = randomUUID()
    const r = await s.ads.updateOne({ _id: doc._id, geracao: doc.geracao, estado: doc.estado, leaseAte: { $lte: agora } }, { $set: { estado: 'excluindo', ativo: false, lease: token, leaseAte: agora + LEASE } })
    if (!r.modifiedCount) continue
    try {
      if (doc.midia) await s.apagar(doc.midia)
      await s.ads.deleteOne({ _id: doc._id, geracao: doc.geracao, estado: 'excluindo', lease: token })
    } catch (_) { log('limpeza_adiada') }
  }
}
function resumo(doc) {
  const agenda = doc.modo === 'intervalo' ? `a cada ${doc.minutos} min` : doc.modo === 'diario' ? `${doc.horario} (São Paulo)` : 'sem horário'
  return `#${doc.id} · ${doc.tipo} · ${doc.ativo ? 'ativo' : 'pausado'} · ${agenda}\nPróximo: ${exibir(doc.proximo)} · Último: ${exibir(doc.ultimo)}${doc.falhas ? ` · Falhas: ${doc.falhas}` : ''}`
}
async function taxa(col, id, agora, intervalo) {
  try { await col.insertOne({ _id: id, ate: agora + intervalo }); return true }
  catch (e) { if (e.code !== 11000) throw e }
  return (await col.updateOne({ _id: id, ate: { $lte: agora } }, { $set: { ate: agora + intervalo } })).modifiedCount === 1
}
// Each worker owns a local socket lifecycle; Mongo claims coordinate workers.
function criarAgendador({ relogio = Date.now, intervalo = setInterval, cancelar = clearInterval } = {}) {
  let socket = null, conectado = false, timer = null, rodando = false, recuperar = null, geracaoSocket = 0, adiarAte = 0, falhasBanco = 0
  const vivo = (s, g) => conectado && socket === s && geracaoSocket === g
  async function verificar() {
    if (!conectado || rodando || relogio() < adiarAte) return
    rodando = true
    const sock = socket, g = geracaoSocket, agora = relogio()
    try {
      const s = await storage.obter()
      await limpar(agora)
      // Recovery persists before enabling sends; failed Mongo reads keep recovery pending.
      if (recuperar !== null) {
        const vencidos = await s.ads.find({ estado: 'pronto', ativo: true, proximo: { $lte: recuperar } }).limit(100).toArray()
        for (const doc of vencidos) await s.ads.updateOne({ _id: doc._id, geracao: doc.geracao, revisao: doc.revisao, proximo: doc.proximo }, { $set: { proximo: proxima(doc, agora), leaseAte: 0 }, $inc: { revisao: 1 } })
        if (vencidos.length === 100 || !vivo(sock, g)) return
        recuperar = null
      }
      const docs = await s.ads.find({ estado: 'pronto', ativo: true, proximo: { $lte: agora }, leaseAte: { $lte: agora } }).sort({ proximo: 1 }).limit(30).toArray()
      for (const doc of docs) {
        if (!vivo(sock, g)) break
        const token = randomUUID(), execucao = `${doc.geracao}:${doc.proximo}`
        const filtro = { _id: doc._id, geracao: doc.geracao, revisao: doc.revisao, estado: 'pronto', ativo: true, proximo: doc.proximo, leaseAte: { $lte: relogio() } }
        if (relogio() - doc.proximo > JANELA || !GRUPO.test(doc.grupo)) {
          await s.ads.updateOne(filtro, { $set: { proximo: proxima(doc, relogio()) }, $inc: { revisao: 1 } }); continue
        }
        const r = await s.ads.updateOne(filtro, { $set: { lease: token, leaseAte: relogio() + LEASE, execucao, entrega: 'preparando' } })
        if (!r.modifiedCount) continue
        let consumido = false
        try {
          const meta = await prazo(sock.groupMetadata(doc.grupo), 15000)
          if (meta?.id !== doc.grupo || !Array.isArray(meta.participants)) throw erro('Grupo indisponível')
          const conteudo = await prazo(midia.preparar(doc, s))
          if (!vivo(sock, g)) continue
          // Guard is renewed after expensive media preparation and before send.
          const atual = await s.ads.findOne({ ...filtro, lease: token, leaseAte: { $gt: relogio() } })
          if (!atual) continue
          if (!await taxa(s.controles, `grupo:${doc.grupo}`, relogio(), ESPACO_GRUPO) || !await taxa(s.controles, 'global', relogio(), ESPACO)) {
            // Spread simultaneous occurrences without retaining an offline backlog.
            await s.ads.updateOne({ ...filtro, lease: token, leaseAte: { $gt: relogio() } }, { $set: { proximo: relogio() + ESPACO_GRUPO }, $inc: { revisao: 1 } })
            continue
          }
          if (!vivo(sock, g)) continue
          // Consume occurrence BEFORE calling WhatsApp. A crash or rejection may lose it,
          // but an ambiguous accepted send is never retried by another lease owner.
          const consume = await s.ads.updateOne({ ...filtro, lease: token, leaseAte: { $gt: relogio() } }, { $set: { proximo: proxima(doc, relogio()), entrega: 'incerta', leaseAte: relogio() + LEASE }, $inc: { revisao: 1 } })
          if (!consume.modifiedCount) continue
          consumido = true
          if (!vivo(sock, g)) continue
          await prazo(sock.sendMessage(doc.grupo, conteudo), 60000)
          await s.ads.updateOne({ _id: doc._id, geracao: doc.geracao, lease: token, execucao }, { $set: { ultimo: relogio(), entrega: 'enviada', falhas: 0 } })
          log('envio_concluido')
        } catch (_) {
          log(consumido ? 'envio_ou_confirmacao_falhou' : 'preparacao_falhou')
          const falhas = (doc.falhas || 0) + 1
          await s.ads.updateOne({ _id: doc._id, geracao: doc.geracao, lease: token, estado: 'pronto', revisao: doc.revisao + (consumido ? 1 : 0) },
            { $set: { falhas, entrega: consumido ? 'incerta' : 'falhou', ativo: falhas < 3, proximo: falhas >= 3 ? null : Math.max(proxima(doc, relogio()), relogio() + Math.min(3600000, 900000 * 2 ** (falhas - 1))) }, $inc: { revisao: 1 } }).catch(() => {})
        } finally {
          await s.ads.updateOne({ _id: doc._id, geracao: doc.geracao, lease: token }, { $set: { leaseAte: 0 }, $unset: { lease: '' } }).catch(() => {})
        }
      }
      falhasBanco = 0; adiarAte = 0
    } catch (_) {
      falhasBanco++
      adiarAte = relogio() + Math.min(300000, 5000 * 2 ** Math.min(falhasBanco - 1, 6))
      log('ciclo_adiado')
    }
    finally { rodando = false }
  }
  function abrir(sock) {
    if (!conectado || socket !== sock) { socket = sock; conectado = true; geracaoSocket++; recuperar = relogio(); adiarAte = 0; falhasBanco = 0 }
    if (!timer) { timer = intervalo(() => { verificar().catch(() => log('ciclo_adiado')) }, 5000); timer?.unref?.() }
    return verificar()
  }
  function fechar(sock) { if (!sock || socket === sock) { conectado = false; socket = null; geracaoSocket++ } }
  function parar() { fechar(); if (timer) cancelar(timer); timer = null }
  return { abrir, fechar, parar, verificar }
}
const agendador = criarAgendador()
module.exports = { criar, listar, obter, alterar, excluir, limpar, resumo, criarAgendador, agendador, GRUPO, LEASE, JANELA }
