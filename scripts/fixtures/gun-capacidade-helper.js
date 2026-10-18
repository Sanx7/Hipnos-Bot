// Somente testes: geração de imagens válidas / pressão limitada ao cgroup de CI.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const MiB = 1024 * 1024

if (process.argv[2] === 'pressao') {
  pressao().catch(() => { process.exitCode = 1; process.disconnect?.() })
} else if (process.argv[2] === 'gerar') {
  if (process.env.GUN_CI_CGROUP === '1') cgroup()
  gerar(process.argv[3])
} else {
  throw new Error('Modo de fixture inválido.')
}

function cgroup() {
  assert.equal(process.platform, 'linux')
  assert.equal(fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim(), String(512 * MiB))
  assert.equal(fs.readFileSync('/sys/fs/cgroup/memory.swap.max', 'utf8').trim(), '0')
  assert.equal(fs.readFileSync('/sys/fs/cgroup/memory.swap.current', 'utf8').trim(), '0')
  return Number(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8'))
}

async function pressao() {
  cgroup()
  const blocos = []
  let alocado = 0
  const prazo = setTimeout(() => process.exit(2), 12000)
  process.on('disconnect', () => process.exit(1))
  while (process.availableMemory() >= 152 * MiB) {
    // Nunca tentar esgotar RAM: manter pelo menos 112 MiB de folga física
    // no grupo e limitar esta carga a 256 MiB, em incrementos de 4 MiB.
    assert.ok(cgroup() < 400 * MiB, 'Sem margem segura para aumentar pressão')
    assert.ok(alocado < 256 * MiB, 'Pressão não alcançada dentro do teto seguro')
    blocos.push(Buffer.alloc(4 * MiB, 0x5a))
    alocado += 4 * MiB
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.ok(process.availableMemory() >= 96 * MiB, 'Pressão excessiva: abortar')
  process.send({ pronto: true, alocadoBytes: alocado, livreBytes: process.availableMemory(), cgroupAtualBytes: cgroup() })
  // Referência explícita: manter páginas residentes até o pai encerrar o filho.
  const timer = setInterval(() => { assert.ok(blocos.length >= 0) }, 100)
  process.on('message', () => { clearInterval(timer); clearTimeout(prazo); process.exit(0) })
}

function gerar(pasta) {
  const zlib = require('node:zlib')
  const { spawnSync } = require('node:child_process')
  const { caminhoFfmpeg } = require('../../comandos/menu-utilitario/audio-extrator')
  const w = 4096, h = 2048
  const tabela = Uint32Array.from({ length: 256 }, (_, n) => {
    let v = n
    for (let i = 0; i < 8; i++) v = (v >>> 1) ^ ((v & 1) ? 0xedb88320 : 0)
    return v >>> 0
  })
  function crc(tipo, dados) {
    let c = 0xffffffff
    for (const b of tipo) c = tabela[(c ^ b) & 255] ^ (c >>> 8)
    for (const b of dados) c = tabela[(c ^ b) & 255] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  let raw = Buffer.alloc((w * 3 + 1) * h), idat
  // Textura RGB determinística, alta frequência e milhões de cores; sem fotos
  // de usuários. Ajustar entropia, não anexar megabytes de lixo após o IEND.
  let proporcao = 20
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    let s = 0x137b29af
    for (let y = 0, i = 0; y < h; y++) {
      raw[i++] = 0 // filtro PNG None
      for (let x = 0; x < w * 3; x++) {
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5
        raw[i++] = x % 100 < proporcao ? (s & 127) * 2 : (s & 63) * 4
      }
    }
    idat = zlib.deflateSync(raw, { level: 1, strategy: zlib.constants.Z_HUFFMAN_ONLY })
    if (idat.length > 19 * MiB && idat.length < 20 * MiB - 1024) break
    proporcao += idat.length >= 20 * MiB - 1024 ? -5 : 5
    idat = null
    global.gc?.()
  }
  assert.ok(idat && idat.length > 19 * MiB && idat.length < 20 * MiB - 1024, 'Fixture deve conter >19 MiB de pixels comprimidos')
  raw = null
  global.gc?.()
  function png(nome, tamanho, dadosIdat = idat, largura = w, altura = h) {
    const header = Buffer.alloc(13)
    header.writeUInt32BE(largura, 0); header.writeUInt32BE(altura, 4); header[8] = 8; header[9] = 2
    const fd = fs.openSync(path.join(pasta, nome), 'w', 0o600)
    function chunk(nomeChunk, dados) {
      const tipo = Buffer.from(nomeChunk), inicio = Buffer.alloc(8), fim = Buffer.alloc(4)
      inicio.writeUInt32BE(dados.length); tipo.copy(inicio, 4); fim.writeUInt32BE(crc(tipo, dados))
      fs.writeSync(fd, inicio); fs.writeSync(fd, dados); fs.writeSync(fd, fim)
    }
    try {
      fs.writeSync(fd, Buffer.from('89504e470d0a1a0a', 'hex'))
      chunk('IHDR', header); chunk('IDAT', dadosIdat)
      const normal = 8 + 25 + 12 + dadosIdat.length + 12
      if (tamanho) {
        assert.ok(tamanho - normal >= 12)
        // Chunk ancillary privado válido, com CRC; pixels continuam idênticos.
        chunk('npAD', Buffer.alloc(tamanho - normal - 12))
      }
      chunk('IEND', Buffer.alloc(0))
    } finally { fs.closeSync(fd) }
    if (tamanho) assert.equal(fs.statSync(path.join(pasta, nome)).size, tamanho)
  }
  png('detalhada.png')
  png('limite.png', 20 * MiB)
  png('acima.png', 20 * MiB + 1)
  const menor = Buffer.alloc((1024 * 3 + 1) * 768)
  let s = 0x13472afb
  for (let i = 0; i < menor.length; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5
    menor[i] = i % (1024 * 3 + 1) ? s & 255 : 0
  }
  png('media.png', null, zlib.deflateSync(menor), 1024, 768)
  const r = spawnSync(caminhoFfmpeg(), ['-y', '-nostdin', '-threads', '1', '-i', path.join(pasta, 'detalhada.png'), '-frames:v', '1', '-threads', '1', '-q:v', '2', path.join(pasta, 'detalhada.jpg')], { timeout: 45000, encoding: 'utf8', windowsHide: true })
  assert.equal(r.status, 0, 'FFmpeg deve gerar JPEG detalhado válido')
  console.log(JSON.stringify({ width: w, height: h, pixels: w * h, idatBytes: idat.length,
    pngBytes: fs.statSync(path.join(pasta, 'detalhada.png')).size, limiteBytes: 20 * MiB,
    acimaBytes: 20 * MiB + 1, jpegBytes: fs.statSync(path.join(pasta, 'detalhada.jpg')).size,
    midiaBytes: fs.statSync(path.join(pasta, 'media.png')).size }))
}
