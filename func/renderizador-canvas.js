// Uma operação por vez, sem fila; o binding nativo existe somente no filho.
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { createRequire } = require('node:module')
const LIMITES = Object.freeze({ bytes: 20 * 1024 * 1024, pixels: 8 * 1024 * 1024,
  lado: 8192, rssBot: 320 * 1024 * 1024, livre: 160 * 1024 * 1024, timeout: 15000, downloadTimeout: 30000 })
let ocupado = false

function erro(codigo) { return Object.assign(new Error('Renderização indisponível.'), { code: codigo }) }

function verificarMemoria() {
  if (process.memoryUsage().rss > LIMITES.rssBot || process.availableMemory() < LIMITES.livre) throw erro('GUN_MEMORIA')
}

function validarImagem(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw erro('GUN_IMAGEM')
  if (buffer.length > LIMITES.bytes) throw erro('GUN_DIMENSOES')
  // Dependência já declarada do formatter; não depender do hoisting do npm.
  const requererFormatter = createRequire(require.resolve('wa-sticker-formatter/package.json'))
  let dimensoes
  try { dimensoes = requererFormatter('image-size').imageSize(buffer) } catch (_) { throw erro('GUN_IMAGEM') }
  const { width: w, height: h, type } = dimensoes
  if (type === 'svg' || !Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) throw erro('GUN_IMAGEM')
  if (w > LIMITES.lado || h > LIMITES.lado || w * h > LIMITES.pixels) throw erro('GUN_DIMENSOES')
}

async function executarExclusivo(trabalho) {
  if (ocupado) throw erro('GUN_OCUPADO')
  ocupado = true
  let valida = true, renderizando = false
  const reserva = {
    verificarMemoria() {
      if (!valida) throw erro('GUN_OCUPADO')
      verificarMemoria()
    },
    async renderizarDownload(efeito, imagem, { signal } = {}) {
      if (!valida || renderizando) throw erro('GUN_OCUPADO')
      renderizando = true
      let pasta
      try {
        verificarMemoria()
        if (efeito !== 'gun') throw erro('GUN_IMAGEM')
        pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'hipnos-render-'))
        const entrada = path.join(pasta, 'entrada'), saida = path.join(pasta, 'saida.png')
        // Somente metadados indispensáveis via stdin, nunca argumentos/env/logs.
        const dados = { url: imagem.url, directPath: imagem.directPath,
          mediaKey: typeof imagem.mediaKey === 'string' ? imagem.mediaKey : Buffer.from(imagem.mediaKey || []).toString('base64') }
        await executarFilho('gun-download-worker.js', [entrada], LIMITES.downloadTimeout, JSON.stringify(dados), signal)
        verificarMemoria()
        await executarFilho('renderizador-canvas-worker.js', [efeito, entrada, saida], LIMITES.timeout, undefined, signal)
        return await fs.readFile(saida)
      } finally {
        if (pasta) await limpar(pasta)
        renderizando = false
      }
    },
    async renderizarPng(efeito, bufferImagem) {
      if (!valida || renderizando) throw erro('GUN_OCUPADO')
      renderizando = true
      let pasta
      try {
        verificarMemoria()
        validarImagem(bufferImagem)
        if (efeito !== 'gun') throw erro('GUN_IMAGEM')
        pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'hipnos-render-'))
        const entrada = path.join(pasta, 'entrada'), saida = path.join(pasta, 'saida.png')
        await fs.writeFile(entrada, bufferImagem, { mode: 0o600 })
        bufferImagem = null
        await executarFilho('renderizador-canvas-worker.js', [efeito, entrada, saida], LIMITES.timeout)
        return await fs.readFile(saida)
      } catch (falha) {
        if (String(falha?.code || '').startsWith('GUN_')) throw falha
        throw erro('GUN_RENDERIZACAO')
      } finally {
        bufferImagem = null
        if (pasta) {
          await limpar(pasta)
        }
        renderizando = false
      }
    }
  }
  try {
    verificarMemoria()
    return await trabalho(reserva)
  } finally { valida = false; ocupado = false }
}

async function limpar(pasta) {
  try { await fs.rm(pasta, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
  catch (_) { console.error('[renderizador]', { evento: 'limpeza_falhou' }) }
}

function executarFilho(script, args, timeout, entrada, signal) {
  return new Promise((resolve, reject) => {
    let falhou, resultado
    const filho = execFile(process.execPath, ['--max-old-space-size=64', path.join(__dirname, script), ...args],
      { timeout, signal, killSignal: 'SIGKILL', maxBuffer: 4096, windowsHide: true,
        env: { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '',
          HOME: os.tmpdir(), TMPDIR: os.tmpdir(), TEMP: os.tmpdir(), TMP: os.tmpdir() } },
      (falha, stdout) => {
        falhou = falha
        try { resultado = JSON.parse(stdout) } catch (_) {}
      })
    // AbortSignal emite error antes de close: só liberar a reserva/apagar o
    // temporário quando o SO confirmar o término e todos os pipes fecharem.
    filho.once('close', () => {
      if (!falhou) return resolve(resultado)
      const code = ['GUN_DIMENSOES', 'GUN_IMAGEM'].includes(resultado?.code) ? resultado.code : 'GUN_RENDERIZACAO'
      reject(erro(code))
    })
    filho.stdin.on('error', () => {}) // EPIPE se houver cancelamento antes da leitura.
    filho.stdin.end(entrada)
  })
}

function renderizarPng(efeito, buffer) {
  return executarExclusivo(reserva => reserva.renderizarPng(efeito, buffer))
}

module.exports = { executarExclusivo, renderizarPng, LIMITES, validarImagem }
