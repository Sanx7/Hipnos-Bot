const { obterColecaoConfiguracoes } = require('../configuracoes-grupo')
const socketSeguro = require('./socket-seguro')

const MAX_REGISTROS = 50
const MAX_TEXTO = 4096
const TTL_CACHE = 30000
const MAX_GRUPOS_CACHE = 500
const segmentador = new Intl.Segmenter('pt', { granularity: 'grapheme' })
const padraoEmoji = /^(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)$/u

function grupoValido(jid) {
  if (typeof jid !== 'string' || !/^\d+(?:-\d+)?@g\.us$/.test(jid)) throw new Error('Grupo inválido')
}
function normalizarTermo(valor) {
  if (typeof valor !== 'string' || valor.length > 120) throw new Error('Termo inválido')
  const termo = valor.normalize('NFC').trim().toLocaleLowerCase('pt-BR').replace(/\s+/gu, ' ')
  if (!termo || [...termo].length > 60 || termo.split(' ').length > 5 ||
      !/^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:[ '\-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*$/u.test(termo)) throw new Error('Termo inválido')
  return termo
}
function validarEmoji(emoji) {
  if (typeof emoji !== 'string' || emoji.length > 64 || !padraoEmoji.test(emoji) || [...segmentador.segment(emoji)].length !== 1) throw new Error('Informe um único emoji')
  return emoji
}
function validarRegistros(registros) {
  if (!Array.isArray(registros) || registros.length > MAX_REGISTROS) throw new Error('Registros inválidos')
  const termos = new Set()
  for (const r of registros) {
    if (!r || normalizarTermo(r.termo) !== r.termo || validarEmoji(r.emoji) !== r.emoji || termos.has(r.termo)) throw new Error('Registros inválidos')
    termos.add(r.termo)
  }
  return registros.map(r => Object.freeze({ termo: r.termo, emoji: r.emoji,
    ...(identidadeValida(r.criador) ? { criador: r.criador } : {}) }))
}
function identidadeValida(id) { return typeof id === 'string' && /^(pn|lid):\d+$/.test(id) }
function validarAutor(autor) {
  if (!autor || !Array.isArray(autor.identidades) || !autor.identidades.length || autor.identidades.length > 4 ||
      !autor.identidades.every(identidadeValida) || typeof autor.privilegiado !== 'boolean') throw new Error('Autor não identificado')
}
function limitarMapa(mapa, max) { while (mapa.size > max) mapa.delete(mapa.keys().next().value) }

function criarRepositorio(obterColecao = obterColecaoConfiguracoes, agora = Date.now) {
  const cache = new Map(), leituras = new Map()
  let revisao = 0
  async function obter(jid, fresco = false) {
    grupoValido(jid)
    const salvo = cache.get(jid)
    if (!fresco && salvo?.ate > agora()) {
      if (salvo.erro) throw new Error('Reações indisponíveis')
      return salvo.registros
    }
    if (!fresco && leituras.has(jid)) return leituras.get(jid)
    const versao = revisao
    const consulta = (async () => {
      try {
        const doc = await (await obterColecao()).findOne({ grupo_id: jid }, { projection: { reacoes_palavras: 1 } })
        const registros = Object.freeze(validarRegistros(doc?.reacoes_palavras ?? []))
        if (versao === revisao) cache.set(jid, { registros, ate: agora() + TTL_CACHE })
        return registros
      } catch (_) {
        if (versao === revisao) cache.set(jid, { erro: true, ate: agora() + 10000 })
        throw new Error('Reações indisponíveis')
      } finally { limitarMapa(cache, MAX_GRUPOS_CACHE) }
    })()
    if (!fresco) leituras.set(jid, consulta)
    try { return await consulta } finally { if (leituras.get(jid) === consulta) leituras.delete(jid) }
  }
  // CAS altera só os campos desta função, sem sobrescrever welcome/IA/banner.
  // A versão também faz o limite resistir a cadastros simultâneos.
  async function alterar(jid, termoBruto, emoji, autor) {
    grupoValido(jid)
    validarAutor(autor)
    const termo = normalizarTermo(termoBruto)
    if (emoji !== null) validarEmoji(emoji)
    try {
      const col = await obterColecao()
      if (emoji !== null) {
        try { await col.updateOne({ grupo_id: jid }, { $setOnInsert: { grupo_id: jid } }, { upsert: true }) }
        catch (e) { if (e.code !== 11000) throw e }
      }
      for (let tentativa = 0; tentativa < 5; tentativa++) {
        const doc = await col.findOne({ grupo_id: jid }, { projection: { reacoes_palavras: 1, reacoes_versao: 1 } })
        const registros = validarRegistros(doc?.reacoes_palavras ?? [])
        const indice = registros.findIndex(r => r.termo === termo)
        if (emoji === null && indice < 0) return false
        // Revalidado em cada tentativa CAS: terceiros não assumem um cadastro
        // concorrente e registros legados nunca ganham um criador presumido.
        if (indice >= 0 && !autor.privilegiado && !autor.identidades.includes(registros[indice].criador)) {
          throw Object.assign(new Error('Somente criador, administrador ou dono'), { code: 'REACAO_NAO_AUTORIZADA' })
        }
        if (emoji !== null && indice < 0 && registros.length >= MAX_REGISTROS) throw new Error('Limite de 50 registros atingido')
        const novos = registros.map(r => ({ ...r }))
        if (emoji === null) novos.splice(indice, 1)
        else if (indice >= 0) novos[indice] = { ...novos[indice], emoji }
        else novos.push({ termo, emoji, criador: autor.identidades[0] })
        if (doc?.reacoes_versao !== undefined && (!Number.isSafeInteger(doc.reacoes_versao) || doc.reacoes_versao < 0 || doc.reacoes_versao >= Number.MAX_SAFE_INTEGER)) throw new Error('Versão inválida')
        const resultado = await col.updateOne({ grupo_id: jid,
          reacoes_versao: doc?.reacoes_versao ?? { $exists: false }
        }, { $set: { reacoes_palavras: novos, reacoes_versao: (doc?.reacoes_versao ?? 0) + 1 } })
        if (resultado.matchedCount === 1) return true
      }
      throw new Error('Configuração concorrente; tente novamente')
    } finally { revisao++; cache.delete(jid) }
  }
  return { obter, registrar: (jid, termo, emoji, autor) => alterar(jid, termo, emoji, autor), remover: (jid, termo, autor) => alterar(jid, termo, null, autor) }
}

const padroes = new WeakMap()
function corresponder(texto, registros) {
  if (typeof texto !== 'string' || !texto || texto.length > MAX_TEXTO) return null
  let compilados = padroes.get(registros)
  if (!compilados) {
    compilados = registros.map(r => ({ ...r, regex: new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${r.termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{M}\\p{N}_])`, 'u') }))
    padroes.set(registros, compilados)
  }
  const normalizado = texto.normalize('NFC').toLocaleLowerCase('pt-BR').replace(/\s+/gu, ' ')
  let escolhido = null
  for (const r of compilados) {
    const match = r.regex.exec(normalizado)
    if (match && (!escolhido || match.index < escolhido.indice || (match.index === escolhido.indice && r.termo.length > escolhido.termo.length))) escolhido = { termo: r.termo, emoji: r.emoji, indice: match.index }
  }
  return escolhido
}

function criarProcessador({ repositorio, agora = Date.now, disponivel = socketSeguro.disponivel } = {}) {
  const gruposEmVoo = new Set(), recentes = new Map(), cooldowns = new Map()
  let ultimoAviso = -Infinity
  return {
    async processar(sock, msg, { tipo, texto, nomeComando } = {}) {
      const jid = msg?.key?.remoteJid, id = msg?.key?.id
      try {
        if (tipo !== 'notify' || nomeComando !== null || !/^\d+(?:-\d+)?@g\.us$/.test(String(jid)) || msg?.key?.fromMe || !msg?.key?.participant ||
            typeof id !== 'string' || !id || id.length > 200 || msg?.messageStubType || !msg?.message ||
            typeof texto !== 'string' || !texto.trim() || texto.length > MAX_TEXTO || !disponivel(sock)) return false
        grupoValido(jid)
        const timestamp = Number(msg.messageTimestamp) * 1000
        if (!Number.isFinite(timestamp) || timestamp < agora() - 120000 || timestamp > agora() + 30000) return false
        const chave = `${jid}:${id}`
        if (gruposEmVoo.has(jid) || gruposEmVoo.size >= 16 || (recentes.get(chave) || 0) > agora() || (cooldowns.get(jid) || 0) > agora()) return false
        gruposEmVoo.add(jid)
        try {
          const encontrado = corresponder(texto, await repositorio.obter(jid))
          if (!encontrado || !disponivel(sock)) return false
          // Reserva ANTES do envio: falha/resultado incerto não provoca nova reação.
          recentes.set(chave, agora() + 600000); limitarMapa(recentes, 5000)
          cooldowns.set(jid, agora() + 1000); limitarMapa(cooldowns, MAX_GRUPOS_CACHE)
          await sock.sendMessage(jid, { react: { text: encontrado.emoji, key: { ...msg.key } } })
          return true
        } finally { gruposEmVoo.delete(jid) }
      } catch (_) {
        if (agora() - ultimoAviso >= 30000) {
          ultimoAviso = agora()
          console.warn('[reacoes-palavras] Consulta ou envio indisponível; fluxo preservado.')
        }
        return false
      }
    }
  }
}

const repositorio = criarRepositorio()
const processador = criarProcessador({ repositorio })
module.exports = { MAX_REGISTROS, MAX_TEXTO, normalizarTermo, validarEmoji, corresponder, criarRepositorio, criarProcessador, repositorio, processar: processador.processar }
