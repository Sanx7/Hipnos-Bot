const { createHash } = require('node:crypto')
const { normalizeMessageContent, decryptPollVote, jidNormalizedUser } = require('@whiskeysockets/baileys')
const { identidade } = require('./identidade-participante')
const { montarEnquete } = require('./enquetes-nativas')
const banco = require('./perguntas-vouc')
// Lista revisada de conteúdo livre. Texto novo sem classificação fica +18.
const livres = require('./vouc-conteudo-livre.json')
const prefixo = require('../prefixo')
const estadoBot = require('../estado-bot')
const adulto = require('../modoadulto')
const conexao = require('./socket-seguro')

const OPCOES = ['🤫 Verdade', '🔥 Consequência', '🎲 Aleatório']
const DURACAO = 120000
const sockets = new WeakMap()
const permitidas = { verdade: new Set(livres.VERDADES), desafio: new Set(livres.DESAFIOS) }
const hash = texto => createHash('sha256').update(texto).digest()
const chave = (grupo, id) => JSON.stringify([grupo, id])

// Só metadados com associação única comprovam equivalência PN/LID.
function idsParticipante(p) {
  return new Set([p?.id, p?.phoneNumber, p?.lid].map(identidade).filter(Boolean))
}
function identificar(participantes, jid) {
  const id = identidade(jid)
  if (!id) return null
  const encontrados = participantes.filter(p => idsParticipante(p).has(id))
  if (encontrados.length !== 1) return null
  const p = encontrados[0], ids = idsParticipante(p)
  if (participantes.some(outro => outro !== p && [...idsParticipante(outro)].some(i => ids.has(i)))) return null
  const mencao = [p.phoneNumber, p.id, p.lid].find(i => identidade(i))
  return { ids, mencao: jidNormalizedUser(mencao), canonico: identidade(mencao) }
}
function listas(modoAdulto) {
  return Object.fromEntries([['verdade', banco.VERDADES], ['desafio', banco.DESAFIOS]].map(([cat, lista]) =>
    [cat, modoAdulto ? lista : lista.filter(p => permitidas[cat].has(p))]))
}

function criarGerenciador(sock, injetadas = {}) {
  const deps = {
    agora: Date.now, agendar: setTimeout, limpar: clearTimeout, random: Math.random,
    ligado: () => estadoBot.obterLigado(), adulto: grupo => adulto.modoAdultoAtivo(grupo),
    disponivel: () => conexao.disponivel(sock), ...injetadas
  }
  const porJogador = new Map(), porEnquete = new Map()
  let fechado = false
  function encerrar(r, estado = 'encerrada') {
    r.estado = estado
    deps.limpar(r.timer)
    if (porJogador.get(r.chaveJogador) === r) porJogador.delete(r.chaveJogador)
    if (r.original) porEnquete.delete(chave(r.grupo, r.original.key.id))
    r.original = null
  }
  function valida(r) {
    if (fechado || !deps.disponivel()) { encerrar(r); return false }
    if (deps.agora() >= r.expiraEm) { encerrar(r, 'expirada'); return false }
    return porJogador.get(r.chaveJogador) === r && ['aguardando', 'finalizando'].includes(r.estado)
  }
  async function habilitado() {
    if (fechado || !deps.disponivel()) return false
    const ligado = await deps.ligado()
    // A conexão pode fechar enquanto a leitura do estado está em voo.
    return !fechado && deps.disponivel() && ligado === true
  }
  async function membro(grupo, jid) {
    const meta = await sock.groupMetadata(grupo)
    return identificar(meta?.participants || [], jid)
  }
  async function avisar(grupo, texto, msg) {
    if (await habilitado()) await sock.sendMessage(grupo, { text: texto }, { quoted: msg })
  }
  const avisoFallback = () => `🌙 Não consegui interpretar a enquete. Somente o participante da rodada pode escolher com ${prefixo.prefixoSincrono()}verdade ou ${prefixo.prefixoSincrono()}consequencia, em até 2 minutos.`
  async function oferecerFallback(r) {
    if (!valida(r) || r.avisouFallback) return
    r.avisouFallback = true
    try { await avisar(r.grupo, avisoFallback(), r.msg) } catch (_) { /* sem cascata */ }
  }
  async function abrir(grupo, msg) {
    let r
    try {
      if (!String(grupo).endsWith('@g.us') || !await habilitado()) return
      const conteudo = normalizeMessageContent(msg?.message) || {}
      const contexto = Object.values(conteudo).find(v => v?.contextInfo)?.contextInfo
      const jid = contexto?.mentionedJid?.[0] || (msg?.key?.fromMe ? sock.user?.id : msg?.key?.participant)
      const alvo = await membro(grupo, jid)
      if (!alvo) return await avisar(grupo, '🌙 Não consegui confirmar o participante da rodada no grupo. Marque alguém com @ e tente novamente.', msg)
      if (!await habilitado()) return
      const chaveJogador = chave(grupo, alvo.canonico)
      const anterior = porJogador.get(chaveJogador)
      if (anterior && deps.agora() >= anterior.expiraEm) encerrar(anterior, 'expirada')
      if (porJogador.has(chaveJogador)) return await avisar(grupo, '🌙 Você já tem uma rodada aguardando sua escolha neste grupo.', msg)
      if (porJogador.size >= 1000) return
      const criadaEm = deps.agora()
      r = { grupo, alvo, chaveJogador, criadaEm, expiraEm: criadaEm + DURACAO, estado: 'criando', msg, original: null, ultimoVoto: -1, fila: Promise.resolve(), pendentes: 0 }
      porJogador.set(chaveJogador, r)
      r.timer = deps.agendar(() => encerrar(r, 'expirada'), DURACAO)
      r.timer?.unref?.()
      try {
        const original = await sock.sendMessage(grupo, montarEnquete('🌙 HIPNOS — VERDADE OU CONSEQUÊNCIA\n\nQual destino você escolhe?', OPCOES))
        if (porJogador.get(chaveJogador) !== r || fechado || deps.agora() >= r.expiraEm) { encerrar(r); return }
        if (!original?.key?.id || original.key.remoteJid !== grupo || original.key.fromMe !== true) throw new Error('Sem chave da enquete')
        r.original = original
        porEnquete.set(chave(grupo, original.key.id), r)
        r.estado = 'aguardando'
        if (!normalizeMessageContent(original.message)?.messageContextInfo?.messageSecret) await oferecerFallback(r)
        else await avisar(grupo, `🌙 @${alvo.mencao.split('@')[0]}, só seu voto decide esta rodada. Vote em até 2 minutos. Se a enquete não funcionar, use ${prefixo.prefixoSincrono()}verdade ou ${prefixo.prefixoSincrono()}consequencia.`, msg)
      } catch (_) {
        if (porJogador.get(chaveJogador) === r && deps.disponivel() && !fechado) {
          r.estado = 'aguardando'
          await oferecerFallback(r)
        } else encerrar(r)
      }
    } catch (_) {
      if (r) encerrar(r)
      console.warn('[vouc]', { evento: 'criacao_falhou' })
    }
  }
  // Serializa apenas esta rodada; duplicatas/remoções não competem com a conclusão.
  function enfileirar(r, fn) {
    if (!r || r.estado !== 'aguardando' || r.pendentes >= 32) return Promise.resolve()
    r.pendentes++
    r.fila = r.fila.then(async () => { if (r.estado === 'aguardando' && valida(r)) await fn() })
      .catch(() => {
        if (r.estado === 'finalizando') encerrar(r)
        console.warn('[vouc]', { evento: 'voto_ignorado' })
      })
      .finally(() => { r.pendentes-- })
    return r.fila
  }
  async function autorizar(r, eleitor) {
    if (!valida(r) || !await habilitado()) return null
    // Alvo e eleitor precisam pertencer ao mesmo retrato dos metadados.
    const participantes = (await sock.groupMetadata(r.grupo))?.participants || []
    const atual = identificar(participantes, r.alvo.mencao)
    if (!atual) { encerrar(r, 'participante_ausente'); return null }
    const votante = identificar(participantes, eleitor)
    if (!votante || ![...votante.ids].some(id => atual.ids.has(id)) || ![...atual.ids].some(id => r.alvo.ids.has(id))) return null
    return atual
  }
  async function finalizar(r, indice, eleitor) {
    if (!valida(r) || !await habilitado()) return
    r.estado = 'finalizando'
    const modoAdulto = await deps.adulto(r.grupo) === true
    const disponiveis = listas(modoAdulto)
    const categoria = indice === 0 ? 'verdade' : indice === 1 ? 'desafio' : deps.random() < 0.5 ? 'verdade' : 'desafio'
    const lista = disponiveis[categoria]
    if (!lista.length) { encerrar(r); return }
    const pergunta = lista[Math.floor(deps.random() * lista.length)]
    // Reconfirma a identidade do próprio eleitor antes de revelar o conteúdo.
    const alvo = await autorizar(r, eleitor)
    if (!alvo || !valida(r) || !await habilitado()) { encerrar(r); return }
    if (!permitidas[categoria].has(pergunta) && await deps.adulto(r.grupo) !== true) { encerrar(r); return }
    if (!valida(r) || !await habilitado()) { encerrar(r); return }
    const titulo = categoria === 'verdade' ? 'VERDADE' : 'CONSEQUÊNCIA'
    const emoji = categoria === 'verdade' ? '🤫' : '🔥'
    const instrucao = categoria === 'verdade' ? 'Sua pergunta' : 'Seu desafio'
    const texto = `🌙 *HIPNOS — ${titulo}*\n\n${emoji} @${alvo.mencao.split('@')[0]}, os sonhos decidiram seu destino...\n\n🎭 ${instrucao}:\n${pergunta}\n\n💀 Hipnos está observando...`
    // Consome antes do envio: falha/resultado ambíguo nunca dispara nova entrega.
    encerrar(r, 'concluida')
    try { await sock.sendMessage(r.grupo, { text: texto, mentions: [alvo.mencao] }, { quoted: r.msg }) }
    catch (_) { console.warn('[vouc]', { evento: 'resultado_envio_falhou' }) }
  }
  async function aplicar(r, eleitor, voto, timestamp) {
    if (!Number.isSafeInteger(timestamp) || timestamp < r.criadaEm || timestamp >= r.expiraEm || timestamp <= r.ultimoVoto) return
    const alvo = await autorizar(r, eleitor)
    if (!alvo || !Array.isArray(voto?.selectedOptions) || voto.selectedOptions.length > 1) return
    const selecionadas = voto.selectedOptions
    const indice = selecionadas.length ? OPCOES.findIndex(o => hash(o).equals(Buffer.from(selecionadas[0]))) : -1
    if (selecionadas.length && indice < 0) return
    if (!valida(r)) return
    r.ultimoVoto = timestamp
    if (indice >= 0) await finalizar(r, indice, eleitor)
  }
  async function processarMensagem(msg) {
    const update = normalizeMessageContent(msg?.message)?.pollUpdateMessage
    if (!update) return false
    const grupo = msg?.key?.remoteJid, key = update.pollCreationMessageKey
    const r = porEnquete.get(chave(grupo, key?.id))
    if (!r || (key.remoteJid && key.remoteJid !== grupo) || key.fromMe === false) return false
    await enfileirar(r, async () => {
      const eleitor = msg.key.fromMe ? sock.user?.id : msg.key.participant
      const autorizado = await autorizar(r, eleitor)
      if (!autorizado) return
      const secret = normalizeMessageContent(r.original?.message)?.messageContextInfo?.messageSecret
      let voto
      // Cada tentativa GCM autentica o JID e o namespace, nunca os dígitos.
      if (secret && update.vote) {
        const votantes = new Set([jidNormalizedUser(eleitor), ...[...autorizado.ids].map(id => {
          const [tipo, numero] = id.split(':')
          return `${numero}@${tipo === 'pn' ? 's.whatsapp.net' : 'lid'}`
        })])
        for (const criador of [sock.user?.id, sock.user?.lid].filter(Boolean).map(jidNormalizedUser)) {
          for (const votante of votantes) {
            try { voto = decryptPollVote(update.vote, { pollCreatorJid: criador, pollMsgId: r.original.key.id, pollEncKey: secret, voterJid: votante }); break } catch (_) { /* namespace inválido */ }
          }
          if (voto) break
        }
      }
      if (!voto) return oferecerFallback(r)
      await aplicar(r, eleitor, voto, Number(update.senderTimestampMs))
    })
    return true
  }
  async function processarAtualizacoes(atualizacoes = []) {
    for (const { key, update } of atualizacoes) {
      const r = porEnquete.get(chave(key?.remoteJid, key?.id))
      if (!r || key.fromMe === false) continue
      for (const voto of update?.pollUpdates || []) {
        const k = voto.pollUpdateMessageKey
        if (k?.remoteJid !== r.grupo) continue
        await enfileirar(r, () => aplicar(r, k.fromMe ? sock.user?.id : k.participant, voto.vote, Number(voto.senderTimestampMs)))
      }
    }
  }
  async function fallback(grupo, msg, texto) {
    const nome = prefixo.resolverNomeComando(texto)
    const indice = nome === 'verdade' ? 0 : ['consequencia', 'consequência'].includes(nome) ? 1 : -1
    if (indice < 0 || prefixo.removerPrefixo(texto).trim().split(/\s+/).length !== 1) return false
    if (!await habilitado()) return false
    const eleitor = msg.key?.fromMe ? sock.user?.id : msg.key?.participant
    const alvo = await membro(grupo, eleitor)
    if (!alvo) return false
    const r = porJogador.get(chave(grupo, alvo.canonico))
    if (!r) return false
    await enfileirar(r, async () => {
      const autorizado = await autorizar(r, eleitor)
      if (autorizado) await finalizar(r, indice, eleitor)
    })
    return true
  }
  function saida({ id, action, participants = [] }) {
    if (action !== 'remove') return
    const removidos = new Set(participants.flatMap(p => typeof p === 'string' ? [identidade(p)] : [...idsParticipante(p)]))
    for (const r of porJogador.values()) {
      if (r.grupo === id && [...r.alvo.ids].some(i => removidos.has(i))) encerrar(r, 'participante_saiu')
    }
  }
  const onUpdate = dados => { processarAtualizacoes(dados).catch(() => console.warn('[vouc]', { evento: 'atualizacao_falhou' })) }
  const onClose = dados => { if (dados.connection === 'close') fechar() }
  sock.ev?.on('messages.update', onUpdate)
  sock.ev?.on('group-participants.update', saida)
  sock.ev?.on('connection.update', onClose)
  function fechar() {
    fechado = true
    for (const r of porJogador.values()) encerrar(r)
    for (const [evento, fn] of [['messages.update', onUpdate], ['group-participants.update', saida], ['connection.update', onClose]]) sock.ev?.off?.(evento, fn)
  }
  return {
    abrir, processarMensagem, processarAtualizacoes,
    async fallback(...args) {
      try { return await fallback(...args) } catch (_) {
        console.warn('[vouc]', { evento: 'fallback_ignorado' })
        return false
      }
    },
    saida, fechar, __teste: { porJogador, porEnquete }
  }
}
function obter(sock) {
  if (!sockets.has(sock)) sockets.set(sock, criarGerenciador(sock))
  return sockets.get(sock)
}
function fechar(sock) { sockets.get(sock)?.fechar() }
module.exports = { obter, fechar, criarGerenciador, identificar, listas, OPCOES, DURACAO }
