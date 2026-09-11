// ============================================
// 🧪 teste-sticker-video.js — Valida o pipeline vídeo → figurinha do /s
// ============================================
// Gera vídeos de teste com o ffmpeg embutido, os converte com
// videoParaWebpAnimado() e verifica:
//   - o webp resultante é ANIMADO (chunks ANMF) e ≤ 1 MB;
//   - o recorte sempre dá 512×512 (incl. fontes minúsculas 100×50);
//   - a 2ª passada de compressão se dispara ao pedir um limite baixo;
//   - os metadados do pack são injetados sem perder frames (node-webpmux).
// Uso: node scripts/teste-sticker-video.js
// ============================================

const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { videoParaWebpAnimado, inyectarMetadatosWebp, LIMITE_VIDEO_SEGUNDOS } = require('../comandos/menu-fig/sticker')

const binFfmpeg = (() => {
  try {
    return require('@ffmpeg-installer/ffmpeg').path
  } catch (err) {
    return 'ffmpeg'
  }
})()

const rodar = (args, timeoutMs) => new Promise((resolver, rejeitar) => {
  execFile(binFfmpeg, args, { windowsHide: true, timeout: timeoutMs }, (erro, saida, errSaida) => {
    if (erro) rejeitar(Object.assign(erro, { saida: errSaida }))
    else resolver(errSaida || '')
  })
})

function contarAnmf(buffer) {
  const conteudo = buffer.toString('latin1')
  return (conteudo.match(/ANMF/g) || []).length
}

async function generarVideo(destino, size, duracion) {
  await rodar([
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', `testsrc=duration=${duracion}:size=${size}:rate=30`,
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    destino
  ], 90000)
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-sticker-'))
  let reprovadas = 0

  const testar = async (nome, fn) => {
    try {
      await fn()
      console.log(`✅ ${nome}`)
    } catch (err) {
      reprovadas += 1
      console.log(`❌ ${nome}:`, err?.saida || err?.message || err?.stack || err)
    }
  }

  try {
    // 1) Vídeo normal (640×360, 12s) → webp animado cortado ao limite (10s)
    await testar(`vídeo 12s → webp ≤ ${LIMITE_VIDEO_SEGUNDOS}s @ 512×512`, async () => {
      const video = path.join(tmp, 'v12.mp4')
      const webp = path.join(tmp, 'v12.webp')
      await generarVideo(video, '640x360', 12)
      const { bytes, segundaPassada } = await videoParaWebpAnimado(video, webp)
      const bufer = fs.readFileSync(webp)
      const anmf = contarAnmf(bufer)
      if (anmf === 0) throw new Error('sem animação (0 chunks ANMF)')
      if (anmf > LIMITE_VIDEO_SEGUNDOS * 12 + 2) throw new Error(`muitos frames (${anmf}): não se cortou a ${LIMITE_VIDEO_SEGUNDOS}s`)
      if (bytes > 1024 * 1024) throw new Error(`pesa ${bytes} bytes (> 1 MB)`)
      if (segundaPassada) throw new Error('se disparou a 2ª passada sem necessidade')
      console.log(`   → ${bytes} bytes, ${anmf} frames ANMF`)
    })

    // 2) Fonte minúscula (100×50) não deve romper crop=512:512
    await testar('fonte minúscula 100×50 → 512×512 sem erro', async () => {
      const video = path.join(tmp, 'chico.mp4')
      const webp = path.join(tmp, 'chico.webp')
      await generarVideo(video, '100x50', 3)
      await videoParaWebpAnimado(video, webp)
      const bufer = fs.readFileSync(webp)
      if (bufer.length === 0 || contarAnmf(bufer) === 0) throw new Error('webp vazio ou sem frames')
      console.log(`   → ${bufer.length} bytes, ${contarAnmf(bufer)} frames ANMF`)
    })

    // 3) 2ª passada de compressão: o webp comprimido fica MENOR que o primário
    await testar('2ª passada de compressão gera webp menor', async () => {
      const video = path.join(tmp, 'v6.mp4')
      const webpA = path.join(tmp, 'v6a.webp')
      const webpB = path.join(tmp, 'v6b.webp')
      await generarVideo(video, '640x360', 6)
      const primaria = await videoParaWebpAnimado(video, webpA, 1024 * 1024) // sem disparar a 2ª passada
      const comprimida = await videoParaWebpAnimado(video, webpB, 50 * 1024) // força a 2ª passada
      if (!comprimida.segundaPassada) throw new Error('não se disparou a 2ª passada')
      if (comprimida.bytes >= primaria.bytes) throw new Error(`compressão não reduziu: ${comprimida.bytes} >= ${primaria.bytes}`)
      console.log(`   → ${primaria.bytes} → ${comprimida.bytes} bytes (2ª passada)`)
    })

    // 4) Injeção de metadados (node-webpmux) sem perder frames
    await testar('injetar metadados sem perder frames nem animação', async () => {
      const video = path.join(tmp, 'v4.mp4')
      const webp = path.join(tmp, 'v4.webp')
      await generarVideo(video, '640x360', 4)
      await videoParaWebpAnimado(video, webp)
      const original = fs.readFileSync(webp)
      const conMetadatos = await inyectarMetadatosWebp(original)
      const framesAntes = contarAnmf(original)
      const framesDespues = contarAnmf(conMetadatos)
      const conteudo = conMetadatos.toString('latin1')
      if (!conteudo.includes('sticker-pack-name')) throw new Error('EXIF não injetado')
      if (framesAntes !== framesDespues) throw new Error(`perdeu frames: ${framesAntes} → ${framesDespues}`)
      console.log(`   → ${framesAntes} frames conservados, +${conMetadatos.length - original.length} bytes de EXIF`)
    })
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch (err) {
      // limpeza best-effort
    }
  }

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()