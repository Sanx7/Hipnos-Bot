// ============================================================
// 🖼️ gerar-banner-padrao.js — GERA o banner padrão das boas-vindas
// ============================================================
// Cria (se ainda não existir) o arquivo:
//     comandos/dados/banners/padrao-boasvindas.png   (1344 x 768 px)
//     (FALLBACK — a arte OFICIAL do projeto fica em dados/banners/ e tem
//      prioridade no carregamento; este script nunca a sobrescreve)
// com a MOLDURA DOURADA na área reservada para a foto do membro:
//     x: 560 a 775  |  y: 155 a 484   (215 x 329 px)
// ⚠️ Estas coordenadas são as mesmas de AREA_FOTO em boasvindas.js.
//
// 🧠 Tudo é desenhado com a lib **jimp** (JavaScript puro, sem binding
// nativo) — a regra de ouro do projeto: nunca usar sharp/libvips/canvas
// nativo in-process (causa crashes documentados).
//
// Uso:
//     node scripts/gerar-banner-padrao.js            (não sobrescreve)
//     node scripts/gerar-banner-padrao.js --forcar    (sobrescreve)
//
// Se você tem uma arte própria, é só SALVAR o arquivo em
// dados/banners/padrao-boasvindas.png (mantendo a moldura nessas
// coordenadas) — este script nunca é necessário.
// ============================================================

const fs = require('fs')
const path = require('path')
// Fontes bitmap que já vêm EMBUTIDAS no jimp (sem download, sem canvas)
const { Jimp, JimpMime, loadFont, measureText } = require('jimp')
const { SANS_128_WHITE, SANS_128_BLACK, SANS_32_WHITE, SANS_32_BLACK } = require('jimp/fonts')

const LARGURA = 1344
const ALTURA = 768

//  Área reservada p/ a foto do membro (igual a AREA_FOTO de boasvindas.js)
const AREA_FOTO = { x: 550, y: 147, w: 237, h: 346 }

//  Arquivo de FALLBACK gerado por este script. A arte OFICIAL do projeto
// fica em dados/banners/padrao-boasvindas.png e tem PRIORIDADE no
// carregamento (boasvindas.js procura lá primeiro) — NUNCA é sobrescrita aqui.
const CAMINHO_ARTE_OFICIAL = path.join(__dirname, '..', 'dados', 'banners', 'padrao-boasvindas.png')
const PASTA_SAIDA = path.join(__dirname, '..', 'comandos', 'dados', 'banners')
const CAMINHO_SAIDA = path.join(PASTA_SAIDA, 'padrao-boasvindas.png')

// 🎨 Paleta (noite profunda + ouro do limbo)
const COR_TOPO = [9, 8, 26]
const COR_BASE = [30, 18, 58]
const OURO = [212, 175, 55]
const OURO_CLARO = [255, 224, 150]
const COR_MOLDURA_INTERNA = [22, 16, 44]
const COR_LUA = [238, 238, 255]

//  Gerador pseudoaleatório com semente fixa: as estrelas ficam sempre nas
// mesmas posições (banner reprodutível entre execuções/ambientes).
function criarSorteio(semente = 20240914) {
  let estado = semente
  return () => {
    estado = (estado * 1664525 + 1013904223) % 4294967296
    return estado / 4294967296
  }
}

function pintarPixel(data, largura, x, y, cor, alpha = 255) {
  if (x < 0 || y < 0 || x >= largura) return
  const indice = (y * largura + x) * 4
  if (indice < 0 || indice + 3 >= data.length) return
  data[indice] = cor[0]
  data[indice + 1] = cor[1]
  data[indice + 2] = cor[2]
  data[indice + 3] = alpha
}

// 🌌 Fundo: gradiente vertical + estrelas + um halo de luar
function pintarFundo(data, largura, altura, estrelas) {
  for (let y = 0; y < altura; y += 1) {
    const progresso = y / altura
    for (let x = 0; x < largura; x += 1) {
      // Halo de luar no canto superior direito
      const distanciaLua = Math.hypot(x - largura * 0.85, y - altura * 0.22)
      const halo = Math.max(0, 1 - distanciaLua / (largura * 0.55))
      const brilho = halo * halo * 46

      pintarPixel(data, largura, x, y, [
        Math.min(255, Math.round(COR_TOPO[0] + (COR_BASE[0] - COR_TOPO[0]) * progresso + brilho)),
        Math.min(255, Math.round(COR_TOPO[1] + (COR_BASE[1] - COR_TOPO[1]) * progresso + brilho)),
        Math.min(255, Math.round(COR_TOPO[2] + (COR_BASE[2] - COR_TOPO[2]) * progresso + brilho * 1.1))
      ])
    }
  }

  // ✨ Estrelas (tamanho/tom variados)
  for (const estrela of estrelas) {
    pintarPixel(data, largura, estrela.x, estrela.y, COR_LUA, estrela.alpha)
    if (estrela.tamanho >= 2) {
      pintarPixel(data, largura, estrela.x + 1, estrela.y, COR_LUA, Math.round(estrela.alpha * 0.6))
      pintarPixel(data, largura, estrela.x, estrela.y + 1, COR_LUA, Math.round(estrela.alpha * 0.6))
    }
  }
}

//  Lua cheia com crateras
function pintarLua(data, largura, altura) {
  const centroX = Math.round(largura * 0.85)
  const centroY = Math.round(altura * 0.22)
  const raio = 78

  for (let y = centroY - raio - 4; y <= centroY + raio + 4; y += 1) {
    for (let x = centroX - raio - 4; x <= centroX + raio + 4; x += 1) {
      const distancia = Math.hypot(x - centroX, y - centroY)
      if (distancia <= raio) {
        const sombra = Math.min(28, Math.round(distancia * 0.28))
        pintarPixel(data, largura, x, y, [
          COR_LUA[0] - sombra,
          COR_LUA[1] - sombra,
          COR_LUA[2] - sombra
        ])
      } else if (distancia <= raio + 4) {
        // halo suave
        const forca = (raio + 4 - distancia) / 4
        pintarPixel(data, largura, x, y, COR_LUA, Math.round(90 * forca))
      }
    }
  }

  // crateras
  const crateras = [
    { dx: -22, dy: -18, r: 14 },
    { dx: 26, dy: 8, r: 10 },
    { dx: -6, dy: 30, r: 7 }
  ]
  for (const cratera of crateras) {
    for (let y = centroY + cratera.dy - cratera.r; y <= centroY + cratera.dy + cratera.r; y += 1) {
      for (let x = centroX + cratera.dx - cratera.r; x <= centroX + cratera.dx + cratera.r; x += 1) {
        if (Math.hypot(x - (centroX + cratera.dx), y - (centroY + cratera.dy)) <= cratera.r) {
          pintarPixel(data, largura, x, y, [214, 214, 236])
        }
      }
    }
  }
}
// 🖼️ MOLDURA DOURADA — a área onde a foto do novo membro será composta.
// Desenha: fundo interno escuro + aro dourado (4px) + linha interna clara
// + cantos ornamentados. ⚠️ Mantém EXATAMENTE AREA_FOTO.
function pintarMoldura(data, largura) {
  const { x, y, w, h } = AREA_FOTO
  const espessura = 4

  // Interior escuro (foto ausente fica discreta)
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      pintarPixel(data, largura, px, py, COR_MOLDURA_INTERNA)
    }
  }

  const naBorda = (px, py) => {
    const dx = px - x
    const dy = py - y
    if (dx < 0 || dy < 0 || dx >= w || dy >= h) return false
    return dx < espessura || dy < espessura || dx >= w - espessura || dy >= h - espessura
  }

  for (let py = y - espessura; py < y + h + espessura; py += 1) {
    for (let px = x - espessura; px < x + w + espessura; px += 1) {
      if (!naBorda(px, py)) continue
      // Linha externa mais clara p/ dar volume ao ouro
      const externa =
        px < x || py < y || px >= x + w || py >= y + h
      pintarPixel(data, largura, px, py, externa ? OURO_CLARO : OURO)
    }
  }

  // 🕯️ Cantos ornamentados (quadradinhos dourados)
  const cantos = [
    { x: x - espessura, y: y - espessura },
    { x: x + w - 1, y: y - espessura },
    { x: x - espessura, y: y + h - 1 },
    { x: x + w - 1, y: y + h - 1 }
  ]
  for (const canto of cantos) {
    for (let py = 0; py < 10; py += 1) {
      for (let px = 0; px < 10; px += 1) {
        pintarPixel(data, largura, canto.x + px, canto.y + py, OURO_CLARO)
      }
    }
  }
}

// 🔠 Texto com sombra: imprime primeiro o preto deslocado e depois o branco
function imprimirComSombra(imagem, fonteBranca, fontePreta, x, y, texto) {
  imagem.print({ font: fontePreta, x: x + 3, y: y + 3, text: texto })
  imagem.print({ font: fonteBranca, x, y, text: texto })
}

// ============================================================
// 🚀 FLUXO PRINCIPAL
// ============================================================
async function main() {
  const forcar = process.argv.includes('--forcar') || process.argv.includes('-f')

  if (fs.existsSync(CAMINHO_SAIDA) && !forcar) {
    console.log('ℹ️ O banner padrão já existe — nada foi alterado:')
    console.log('   ', CAMINHO_SAIDA)
    console.log('   (use --forcar para regenerar/sobrescrever)')
    return
  }

  console.log('🎨 Desenhando o banner padrão (jimp — JavaScript puro, sem lib nativa)...')

  const imagem = new Jimp({ width: LARGURA, height: ALTURA, color: 0x09081aff })
  const { data, width, height } = imagem.bitmap

  //  Estrelas determinísticas
  const sortear = criarSorteio()
  const estrelas = []
  for (let i = 0; i < 220; i += 1) {
    estrelas.push({
      x: Math.floor(sortear() * width),
      y: Math.floor(sortear() * height),
      alpha: Math.round(70 + sortear() * 185),
      tamanho: sortear() > 0.82 ? 2 : 1
    })
  }

  pintarFundo(data, width, height, estrelas)
  pintarLua(data, width, height)
  pintarMoldura(data, width)

  // 🔠 Título e assinatura (fontes bitmap embutidas no jimp)
  const fonteTitulo = await loadFont(SANS_128_WHITE)
  const fonteTituloPreto = await loadFont(SANS_128_BLACK)
  const fonteTexto = await loadFont(SANS_32_WHITE)
  const fonteTextoPreto = await loadFont(SANS_32_BLACK)

  const titulo = 'BEM-VINDO'
  const larguraTitulo = measureText(fonteTitulo, titulo)
  imprimirComSombra(
    imagem,
    fonteTitulo,
    fonteTituloPreto,
    Math.round((width - larguraTitulo) / 2),
    24,
    titulo
  )

  const subtitulo = 'AOS CAMPOS ELÍSIOS'
  const larguraSubtitulo = measureText(fonteTexto, subtitulo)
  imprimirComSombra(
    imagem,
    fonteTexto,
    fonteTextoPreto,
    Math.round((width - larguraSubtitulo) / 2),
    height - 96,
    subtitulo
  )

  // 💾 Salva como PNG (formato esperado pelo handler)
  if (!fs.existsSync(PASTA_SAIDA)) {
    fs.mkdirSync(PASTA_SAIDA, { recursive: true })
  }
  const buffer = await imagem.getBuffer(JimpMime.png)
  fs.writeFileSync(CAMINHO_SAIDA, buffer)

  console.log('✅ Banner padrão criado com sucesso!')
  console.log('   Arquivo :', CAMINHO_SAIDA)
  console.log(`   Tamanho : ${width}x${height} px (${(buffer.length / 1024).toFixed(0)} KB)`)
  console.log(`   Moldura : x ${AREA_FOTO.x}-${AREA_FOTO.x + AREA_FOTO.w} | y ${AREA_FOTO.y}-${AREA_FOTO.y + AREA_FOTO.h} (${AREA_FOTO.w}x${AREA_FOTO.h})`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('💥 Falha ao gerar o banner padrão:', err?.message || err)
    process.exit(1)
  })