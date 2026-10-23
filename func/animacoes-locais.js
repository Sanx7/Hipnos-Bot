const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { randomInt } = require('node:crypto')
const { execFile } = require('node:child_process')
const { caminhoFfmpeg } = require('../comandos/menu-utilitario/audio-extrator')

const MAX_BYTES = 20 * 1024 * 1024
function falha() { return new Error('ANIMACAO_INDISPONIVEL') }
function criarEnvioAnimacoes({ raiz = path.resolve(__dirname, '..'), executar = execFile,
  ffmpeg = caminhoFfmpeg, sortear = randomInt, limiteMs = 60000 } = {}) {
  // Um conversor por processo; sob concorrência, os comandos conservam o fallback.
  let convertendo = false
  const base = path.resolve(raiz, 'assets/gifs')
  function dentro(pasta, arquivo) {
    const relativo = path.relative(pasta, arquivo)
    return relativo && relativo !== '..' && !relativo.startsWith('..' + path.sep) && !path.isAbsolute(relativo)
  }
  async function validar(arquivo, ext) {
    const handle = await fs.open(arquivo, 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size < 12 || stat.size > MAX_BYTES) throw falha()
      const cabecalho = Buffer.alloc(12)
      await handle.read(cabecalho, 0, 12, 0)
      const valido = ext === '.gif' ? /^GIF8[79]a/.test(cabecalho.toString('ascii')) :
        cabecalho.toString('ascii', 4, 8) === 'ftyp'
      if (!valido) throw falha()
    } finally { await handle.close() }
  }
  async function limpar(arquivo, pasta) {
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        await fs.unlink(arquivo).catch(e => { if (e.code !== 'ENOENT') throw e })
        await fs.rmdir(pasta)
        return
      } catch (e) {
        if (e.code === 'ENOENT') return
        if (tentativa < 2) await new Promise(resolve => setTimeout(resolve, 150))
      }
    }
    console.warn('[animacoes]', { evento: 'temporario_nao_removido' })
  }
  async function preparar(caminhos) {
    const baseReal = await fs.realpath(base)
    const disponiveis = []
    for (const relativo of new Set(caminhos || [])) {
      if (typeof relativo !== 'string') continue
      const arquivo = path.resolve(raiz, relativo)
      const ext = path.extname(arquivo).toLowerCase()
      if (!dentro(base, arquivo) || !['.mp4', '.gif'].includes(ext)) continue
      try {
        const real = await fs.realpath(arquivo)
        if (!dentro(baseReal, real)) continue
        const stat = await fs.stat(real)
        if (stat.isFile() && stat.size >= 12 && stat.size <= MAX_BYTES) disponiveis.push({ arquivo: real, ext })
      } catch (_) { /* Arquivos não enviados à hospedagem não entram no sorteio. */ }
    }
    if (!disponiveis.length) throw falha()
    const indice = sortear(disponiveis.length)
    if (!Number.isInteger(indice) || indice < 0 || indice >= disponiveis.length) throw falha()
    const { arquivo, ext } = disponiveis[indice]
    await validar(arquivo, ext)
    if (ext === '.mp4') return { arquivo, limpar: async () => {} }
    if (convertendo) throw falha()
    convertendo = true
    let pasta, saida
    try {
      pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'hipnos-animacao-'))
      saida = path.join(pasta, 'animacao.mp4')
      await new Promise((resolve, reject) => executar(ffmpeg(), [
        '-hide_banner', '-loglevel', 'error', '-y', '-nostdin', '-threads', '1',
        '-protocol_whitelist', 'file,pipe', '-i', arquivo, '-map', '0:v:0',
        '-filter_threads', '1', '-vf', 'scale=min(640\\,iw):min(640\\,ih):force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v', 'libx264', '-threads', '1', '-preset', 'veryfast', '-crf', '26',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', saida
      ], { timeout: limiteMs, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 }, erro => erro ? reject(falha()) : resolve()))
      await validar(saida, '.mp4')
      return { arquivo: saida, limpar: () => limpar(saida, pasta) }
    } catch (_) {
      if (pasta) await limpar(saida, pasta)
      throw falha()
    } finally { convertendo = false }
  }
  async function enviarAnimacao(sock, jid, caminhos, resposta, opcoes, { fallbackTexto = true } = {}) {
    let midia
    try { midia = await preparar(caminhos) }
    catch (_) {
      console.warn('[animacoes]', { evento: 'preparacao_indisponivel' })
      if (!fallbackTexto) throw falha()
      return sock.sendMessage(jid, resposta, opcoes)
    }
    try {
      return await sock.sendMessage(jid, {
        video: { url: midia.arquivo }, mimetype: 'video/mp4', gifPlayback: true,
        caption: resposta.text, mentions: resposta.mentions
      }, opcoes)
    } finally { await midia.limpar() }
    // Sem retry após sendMessage: uma rejeição de transporte não prova não entrega.
  }
  return { preparar, enviarAnimacao }
}
module.exports = { criarEnvioAnimacoes, ...criarEnvioAnimacoes() }
