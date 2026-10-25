// Diagnostico opcional, sem texto, URL, JID, LID, nome de grupo ou erro bruto.
const { AsyncLocalStorage } = require('node:async_hooks')
const { randomBytes } = require('node:crypto')
const aliases = new Map([
  ...['tiktok', 'tt', 'ttk', 'tik-tok', 'tiktokdl'].map(n => [n, 'tiktok']),
  ...['tiktok-audio', 'tiktok-aud', 'tiktok-mp3', 'tt-audio', 'tk-audio'].map(n => [n, 'tiktok-audio'])
])
const etapas = new Set(['recebida', 'socket', 'antilinkhard', 'antiflood', 'limite', 'figurinhas', 'antigolpe', 'voto', 'from_me',
  'revogacao', 'anti_audio', 'anti_documento', 'anti_evento', 'antilink_basico', 'anti_pagamento', 'anti_status', 'mute',
  'manutencao', 'afk', 'metadados_afk', 'prefixo', 'nao_comando', 'reconhecido', 'registro', 'restrito', 'metadados_restrito',
  'fila', 'handler', 'fonte', 'download', 'preparar_midia', 'envio_midia', 'aviso_erro', 'erro_lote', 'erro_mensagem', 'fim',
  'excecao_antilinkhard', 'excecao_antilink_basico'])
const resultados = new Set(['inicio', 'ok', 'erro', 'bloqueado', 'ausente'])
function categoriaErro(e) {
  if (e?.tipo === 'grande') return 'limite'
  if (e?.tipo === 'uso') return 'uso'
  if (e?.timeout || ['ETIMEDOUT', 'ECONNABORTED'].includes(e?.code)) return 'timeout'
  if (['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(e?.code)) return 'conexao'
  return 'outro'
}
function criarDiagnostico({ habilitado = () => process.env.HIPNOS_DIAG_TIKTOK === 'true',
  registrar = (...a) => console.info(...a), relogio = Date.now, agendar = setTimeout, cancelar = clearTimeout } = {}) {
  const contexto = new AsyncLocalStorage()
  const porMensagem = new WeakMap()
  let janela = 0, quantidade = 0
  function emitir(r, evento, extras = {}) {
    if (!r || r.eventos >= 45) return
    r.eventos++
    try { registrar('[diag-tiktok]', { rastro: r.id, comando: r.comando, conversa: r.conversa,
      identidade: r.identidade, lote: r.lote, posicao: r.posicao, evento, ms: Math.max(0, relogio() - r.inicio), ...extras }) } catch (_) { /* diagnostico nao altera o fluxo */ }
  }
  function marcarRastro(r, etapa, resultado = 'inicio', erro) {
    if (!r || !etapas.has(etapa) || !resultados.has(resultado)) return
    if (r.timer) cancelar(r.timer)
    r.etapa = etapa
    emitir(r, etapa, { resultado, ...(erro ? { categoria: categoriaErro(erro) } : {}) })
    if (resultado === 'inicio') {
      r.timer = agendar(() => emitir(r, 'aguardando', { etapa }), 20000)
      r.timer?.unref?.()
    }
  }
  function receber(messages) {
    const rastros = new Map()
    if (!habilitado() || !Array.isArray(messages)) return rastros
    for (let i = 0; i < messages.length && rastros.size < 4; i++) {
      try {
        const msg = messages[i], texto = require('./texto-comando').extrairTextoComando(msg)
        const prefixo = require('../prefixo').prefixoSincrono()
        const token = (texto.startsWith(prefixo) ? texto.slice(prefixo.length) : texto.replace(/^[/!#]/, '')).trim().split(/\s/)[0].toLowerCase()
        const comando = aliases.get(token)
        if (!comando) continue
        const agora = relogio()
        if (agora - janela >= 600000) { janela = agora; quantidade = 0 }
        if (quantidade >= 20) break
        quantidade++
        const sender = msg?.key?.participant || msg?.key?.remoteJid || ''
        const r = { id: randomBytes(6).toString('hex'), comando, inicio: agora, eventos: 0,
          conversa: String(msg?.key?.remoteJid).endsWith('@g.us') ? 'grupo' : 'pv',
          identidade: sender.endsWith('@lid') ? 'lid' : sender.endsWith('@s.whatsapp.net') ? 'pn' : 'outro',
          lote: messages.length > 1 ? 'multiplo' : 'unico', posicao: i ? 'seguinte' : 'primeira' }
        rastros.set(msg, r); porMensagem.set(msg, r); marcarRastro(r, 'recebida', 'ok')
      } catch (_) { /* conteudo inesperado nao pode quebrar o listener */ }
    }
    return rastros
  }
  const marcar = (etapa, resultado, erro) => marcarRastro(contexto.getStore(), etapa, resultado, erro)
  function lote(rastros, etapa, resultado, erro) { for (const r of rastros.values()) marcarRastro(r, etapa, resultado, erro) }
  async function executar(rastro, fn) {
    if (!rastro) return fn()
    return contexto.run(rastro, async () => {
      try { return await fn() }
      catch (e) { marcar('erro_mensagem', 'erro', e); throw e }
      finally { marcar('fim', 'ok') }
    })
  }
  async function aguardar(etapa, fn) {
    marcar(etapa)
    try { const r = await fn(); marcar(etapa, 'ok'); return r }
    catch (e) { marcar(etapa, 'erro', e); throw e }
  }
  const marcarMensagem = (msg, etapa, resultado) => marcarRastro(porMensagem.get(msg), etapa, resultado)
  return { receber, lote, executar, marcar, marcarMensagem, aguardar }
}
module.exports = { ...criarDiagnostico(), criarDiagnostico, categoriaErro }
