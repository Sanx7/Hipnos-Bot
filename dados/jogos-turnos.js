// Ciclo compartilhado pelos jogos individuais de texto: reserva síncrona
// por grupo, jogador exclusivo, cancelamento e timeout renovado por jogada.
const registro = require('./jogos-ativos')
const prefixo = require('../prefixo')
const TIMEOUT_MS = 120000
let agendar = setTimeout
let cancelar = clearTimeout
const id = (jid) => String(jid || '').replace(/:\d+(?=@)/, '')
const autores = (msg) => [msg.key?.participant || msg.key?.remoteJid, msg.key?.participantAlt].filter(Boolean).map(id)

module.exports = function criarComando(spec) {
  function encerrar(jid, jogo) {
    cancelar(jogo.timer)
    if (registro.obterJogo(jid)?.dados === jogo) registro.removerJogo(jid, spec.nome)
  }
  function renovar(sock, jid, jogo) {
    cancelar(jogo.timer)
    jogo.timer = agendar(() => {
      if (registro.obterJogo(jid)?.dados !== jogo) return
      encerrar(jid, jogo)
      sock.sendMessage(jid, { text: `⌛ /${spec.nome} encerrado após 2 minutos sem jogada. Pontuação: ${jogo.estado.pontos}.` }).catch(() => {})
    }, TIMEOUT_MS)
    jogo.timer?.unref?.()
  }
  async function jogar(sock, jid, msg, texto, jogo, comando) {
    const acao = String(texto || '').trim().toLowerCase()
    const jogada = spec.normalizar(acao)
    if (!comando && acao !== 'desistir' && !jogada) return false
    if (!autores(msg).some(a => jogo.autores.includes(a))) {
      if (comando) await sock.sendMessage(jid, { text: '🔒 Só quem iniciou pode jogar ou desistir desta partida.' }, { quoted: msg })
      return false
    }
    if (acao === 'desistir') {
      encerrar(jid, jogo)
      await sock.sendMessage(jid, { text: `🏁 Você desistiu do /${spec.nome}. Pontuação: ${jogo.estado.pontos}.` }, { quoted: msg })
      return true
    }
    if (!jogada) {
      await sock.sendMessage(jid, { text: spec.instrucoes }, { quoted: msg })
      return true
    }
    const resultado = spec.jogar(jogo.estado, jogada)
    if (resultado.fim) encerrar(jid, jogo)
    else if (resultado.valida !== false) renovar(sock, jid, jogo)
    await sock.sendMessage(jid, { text: `${resultado.texto}\n\n${spec.render(jogo.estado)}` }, { quoted: msg })
    return true
  }
  registro.registrarOuvinteTexto(spec.nome, async (sock, jid, msg, texto, jogo) => {
    try { return await jogar(sock, jid, msg, texto, jogo, false) }
    catch (err) { encerrar(jid, jogo); console.error(`[${spec.nome}]`, err?.message); return true }
  })
  return {
    nome: spec.nome,
    async executar(sock, jid, msg, texto) {
      let jogo
      try {
        if (!String(jid).endsWith('@g.us')) return await sock.sendMessage(jid, { text: `🎮 Use /${spec.nome} em um grupo.` }, { quoted: msg })
        const args = prefixo.removerPrefixo(texto || '').trim().split(/\s+/).slice(1).join(' ').toLowerCase()
        const ativo = registro.obterJogo(jid)
        if (ativo) {
          if (ativo.tipo !== spec.nome || !args) return await sock.sendMessage(jid, { text: `🔒 Já existe um ${registro.rotuloDoTipo(ativo.tipo)} ativo neste grupo. Termine ou desista antes de abrir outra partida.` }, { quoted: msg })
          jogo = ativo.dados
          await jogar(sock, jid, msg, args, jogo, true)
          return
        }
        if (args) return await sock.sendMessage(jid, { text: `🎮 Inicie com /${spec.nome}.\n${spec.instrucoes}` }, { quoted: msg })
        jogo = { autores: autores(msg), estado: spec.criar(), timer: null }
        registro.registrarJogo(jid, spec.nome, jogo)
        renovar(sock, jid, jogo)
        await sock.sendMessage(jid, { text: `${spec.instrucoes}\n\n${spec.render(jogo.estado)}` }, { quoted: msg })
      } catch (err) {
        if (jogo) encerrar(jid, jogo)
        console.error(`[${spec.nome}]`, err?.message)
        await sock.sendMessage(jid, { text: '⚠️ O jogo foi interrompido. Tente novamente.' }, { quoted: msg }).catch(() => {})
      }
    },
    _test: {
      ...spec, TIMEOUT_MS,
      injetarTimers: (set, clear) => { agendar = set || setTimeout; cancelar = clear || clearTimeout }
    }
  }
}
