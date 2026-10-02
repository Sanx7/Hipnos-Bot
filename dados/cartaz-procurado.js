// ============================================
// 📜 CARTAZ-PROCURADO — a arte do /procurado (Jimp, JS puro)
// ============================================
// Compõe o cartaz de procurado do #1 do ranking sobre a moldura PNG de
// assets/quadros/cartaz-procurado.png. Nada de canvas/sharp/ffmpeg: o Jimp
// desenha tudo em memória (regra de ouro do projeto), e a miniatura do
// preview sai do próprio Jimp para a Baileys não precisar processar nada.
//
// 🖼️ A MOLDURA (1024×1536): frisco grego nas bordas, faixa escura no topo
// para o título, um CÍRCULO no meio para a foto e o miolo de papel em baixo
// para o texto.
//
// 🔍 CÍRCULO — DETECÇÃO AUTOMÁTICA (ver `detectarCirculo`):
//   a moldura é um PNG que o Jimp lê como RGB *sem canal alfa* e o "buraco"
//   do círculo é uma mancha BRANCA chapada. A função varre a imagem
//   procurando a maior região conexa de pixels claros e de baixa saturação
//   (quase-branco) e devolve o bounding box dela. Se um dia a moldura for
//   trocada por uma com furo TRANSPARENTE de verdade, a mesma função cai no
//   canal alfa (alpha < ALFA_CORTADA) — nada de coordenada hardcoded, então
//   trocar o arquivo não quebra o /procurado.
//
// 📐 ÁREAS DE TEXTO (constantes CALIBRADAS à mão):
//   o topo e o miolo não são transparentes, então não dá para autodetectar
//   — foram medidos pixel a pixel no arquivo atual (ver TITULO_CARTAZ,
//   CAIXA_TITULO e CAIXA_TEXTO). Se a moldura mudar, recalibre essas três
//   constantes (é só rodar o teste, que imprime as caixas medidas).
// ============================================
const fs = require('fs')
const path = require('path')
const { Jimp, JimpMime, loadFont } = require('jimp')
const { SANS_16_WHITE, SANS_32_WHITE, SANS_64_WHITE, SANS_128_WHITE } = require('jimp/fonts')

// 📂 Onde vive a moldura (arquivo versionado no repositório).
const CAMINHO_MOLDURA = path.join(__dirname, '..', 'assets', 'quadros', 'cartaz-procurado.png')

// -------------------------------------------------------------------
// 📐 CALIBRADO para assets/quadros/cartaz-procurado.png (1024×1536).
// Medido com a própria imagem (brilho/saturação por linha e por coluna):
//   • faixa escura do topo: y 0..303 (luminância ~20);
//   • círculo: x 267..755, y 352..840 → centro (511, 596), r ≈ 244;
//   • miolo de papel do texto: y 880..1440, x 120..904.
// ⚠️ RECALIBRAR se a moldura for trocada: o teste imprime as medidas.
// -------------------------------------------------------------------
const CAIXA_TITULO = { x: 150, y: 120, largura: 724, altura: 120 }
const CAIXA_TEXTO = { x: 120, y: 880, largura: 784, altura: 560 }

// 🏷️ Título da faixa escura — constante fácil de trocar.
const TITULO_CARTAZ = 'PROCURADO'

// 🎨 Paleta: tinta escura no papel envelhecido + dourado velho de cartaz.
// ⚠️ O TITULO_CARTAZ é dourado ESCURO de propósito: o dourado claro
// (OURO_CLARO) na faixa quase preta vira amarelo-neon.
const TINTA = '#2b1d10'
const TINTA_SUAVE = '#5c452c'
const OURO = '#c9a227'
const OURO_CLARO = '#e8d38a'
const OURO_TITULO = '#d9a520'
const PAPEL = '#e6d7b8'
const PAPEL_ESCURO = '#d4bf98'
// 🔴 Vermelho ESCURO de fita: o #8f2d1e antigo lavava no papel bege e a
// alcunha (a linha mais lida depois do nome) sumia. Com o contorno de tinta
// (ver `escrever`) e este tom, o apelido ganha peso sem virar vinho novo.
const FITA = '#7a2413'
const FITA_CLARA = '#b8472f'

// -------------------------------------------------------------------
// 📐 LAYOUT DO MIOLO — medido em PIXELS sobre a moldura atual.
//   • TOPO_MIOLO  : respiro entre o círculo (acaba em y ≈ 840) e a 1ª linha;
//   • FUNDO_MIOLO : a última linha não passa daqui (a moldura ornamentada
//     começa embaixo em y ≈ 1440 — o texto nunca encosta nela);
//   • ESCALA_*    : as fontes bitmap do Jimp só existem em 16/32/64/128 px,
//     então o tamanho fino sai de ESCALA com amostragem bilinear
//     (`coberturaEm`). É o que permite o nome grande sem virar letra gigante
//     de 64 px em cima de um nome curto.
// -------------------------------------------------------------------
const TOPO_MIOLO = 24
const FUNDO_MIOLO = 1400
const ESCALA_TITULO = 1.5 // TITULO_CARTAZ: 416 px × 1,5 = 624 px (caixa: 724)
const ESCALA_ALCUNHA = 1.2
const ESCALA_RODAPE = 0.85
// 🪜 A escada do NOME, do MAIOR para o menor: o primeiro que couber inteiro
// vence. Nenhum cabe? Ver `escolher` (largura mínima visível).
const ESCADARIA_NOME = [1.5, 1.3, 1.1, 1]
const MIN_VISIVEL_NOME = 16

// 🔎 Detecção do círculo.
const ALFA_CORTADA = 8 // alpha < 8 conta como "buraco" (PNG com furo real)
const CLARO_MIN = 225 // luminância mínima p/ um pixel contar como "vazio"
const CLARO_MAX_SAT = 12 // e a saturação (máx-min) tem que ser essa pequena
const AREA_MINIMA = 4000 // px² — descarta poeira e o papel de fora do quadro

// ─── 🔍 detectarCirculo(moldura) ───
// MÉTODO (documentado, sem coordenada hardcoded):
//   1) Varre o canal ALFA uma vez (alpha < ALFA_CORTADA): é o caminho do
//      furo TRANSPARENTE de verdade. O arquivo atual é RGB sem alfa, então
//      esse passo não acha nada e o passo 2 assume.
//   2) Sem furo alfa, procura pixels QUASE-BRANCO: luminância alta
//      (>= CLARO_MIN) e saturação baixíssima (<= CLARO_MAX_SAT) — que é
//      exatamente a mancha lisa que a moldura deixa para a foto.
//   3) Acha a MAIOR região conexa (busca em largura, 4-vizinhos) da máscara
//      e devolve o bounding box dela. O disco é a maior mancha lisa do
//      arquivo; as bordas ornamentadas têm milhares de pixels claros
//      pequenos e espalhados, que perdem fácil para ele na contagem de área.
//   4) Devolve { x0, y0, x1, y1, cx, cy, raio, largura, altura } — centro e
//      raio saem do box (raio = a menor metade, para o disco nunca vazar da
//      moldura). null quando nada passa do piso de área.
function detectarCirculo (moldura) {
  const { width, height, data } = moldura.bitmap

  // 1) Existe furo TRANSPARENTE de verdade?
  let temAlfa = false
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < ALFA_CORTADA) { temAlfa = true; break }
  }

  // 2) Máscara binária dos pixels "vazios".
  const mask = new Uint8Array(width * height)
  let total = 0
  for (let i = 0; i < width * height; i += 1) {
    const j = i * 4
    let vazio = false
    if (temAlfa) {
      vazio = data[j + 3] < ALFA_CORTADA
    } else {
      // O bitmap.data do Jimp é [R, G, B, A] (confirmado com round-trip de
      // PNG) — lê-se direto, sem passar pelo getPixelColor.
      const r = data[j]
      const g = data[j + 1]
      const b = data[j + 2]
      const min = r < g ? (r < b ? r : b) : (g < b ? g : b)
      const max = r > g ? (r > b ? r : b) : (g > b ? g : b)
      vazio = min >= CLARO_MIN && max - min <= CLARO_MAX_SAT
    }
    if (vazio) { mask[i] = 1; total += 1 }
  }
  if (!total) return null

  // 3) Maior componente conexa (4-vizinhos) — flood fill com pilha explícita.
  const vistos = new Uint8Array(width * height)
  const pilha = new Int32Array(width * height)
  let melhor = null
  for (let inicio = 0; inicio < mask.length; inicio += 1) {
    if (!mask[inicio] || vistos[inicio]) continue
    let topo = 0
    pilha[topo] = inicio
    topo += 1
    vistos[inicio] = 1
    let area = 0
    let x0 = width
    let x1 = 0
    let y0 = height
    let y1 = 0
    while (topo > 0) {
      topo -= 1
      const p = pilha[topo]
      const y = (p / width) | 0
      const x = p - y * width
      area += 1
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (x > 0 && mask[p - 1] && !vistos[p - 1]) { vistos[p - 1] = 1; pilha[topo] = p - 1; topo += 1 }
      if (x < width - 1 && mask[p + 1] && !vistos[p + 1]) { vistos[p + 1] = 1; pilha[topo] = p + 1; topo += 1 }
      if (y > 0 && mask[p - width] && !vistos[p - width]) { vistos[p - width] = 1; pilha[topo] = p - width; topo += 1 }
      if (y < height - 1 && mask[p + width] && !vistos[p + width]) { vistos[p + width] = 1; pilha[topo] = p + width; topo += 1 }
    }
    if (area >= AREA_MINIMA && (!melhor || area > melhor.area)) {
      melhor = { area, x0, y0, x1, y1 }
    }
  }
  if (!melhor) return null

  // 4) Bounding box → centro e raio. O raio é a MAIOR das duas metades: a
  //    mancha nem sempre é perfeitamente redonda (a deste arquivo é
  //    489×482) e pelo raio menor sobrava um anel branco da mancha original
  //    em volta da foto.
  const largura = melhor.x1 - melhor.x0 + 1
  const altura = melhor.y1 - melhor.y0 + 1
  return {
    x0: melhor.x0,
    y0: melhor.y0,
    x1: melhor.x1,
    y1: melhor.y1,
    largura,
    altura,
    cx: Math.round((melhor.x0 + melhor.x1) / 2),
    cy: Math.round((melhor.y0 + melhor.y1) / 2),
    raio: Math.floor(Math.max(largura, altura) / 2)
  }
}

// ─── ✍️ Texto (mesma técnica do /pergaminho: glifo a glifo, usando o ALFA da
// textura da fonte como cobertura — o `print` do Jimp lava a cor do texto) ───
const CACHE_GLIFOS = new Map()
const CACHE_FONTES = new Map()

function glifos (font) {
  if (!CACHE_GLIFOS.has(font)) {
    const mapa = new Map()
    for (const c of Object.values(font.chars)) {
      if (c && typeof c.id === 'number') mapa.set(c.id, c)
    }
    CACHE_GLIFOS.set(font, mapa)
  }
  return CACHE_GLIFOS.get(font)
}

async function fonte (qual) {
  if (!CACHE_FONTES.has(qual)) CACHE_FONTES.set(qual, await loadFont(qual))
  return CACHE_FONTES.get(qual)
}

// As fontes bitmap do Jimp cobrem ASCII + Latin-1: acentos (ç, ã, ú) e "º"
// funcionam, mas emoji/grego/japonês NÃO têm glifo. Troca o que não dá pra
// desenhar por espaço — nada de caixinha quebrada no meio do cartaz.
function limparParaFonte (font, texto) {
  const mapa = glifos(font)
  let saida = ''
  for (const ch of String(texto ?? '')) saida += mapa.has(ch.codePointAt(0)) ? ch : ' '
  return saida.replace(/\s+/g, ' ').trim()
}

// Largura = soma dos avanços dos glifos (a MESMA conta que o desenhador faz),
// já com a ESCALA aplicada (1 = tamanho natural da fonte bitmap).
function medir (font, texto, escala = 1) {
  const mapa = glifos(font)
  const e = Number(escala) > 0 ? Number(escala) : 1
  let largura = 0
  for (const ch of String(texto ?? '')) {
    const glifo = mapa.get(ch.codePointAt(0))
    if (glifo) largura += glifo.xadvance * e
  }
  return Math.round(largura)
}

function tintaVertical (font, texto) {
  const mapa = glifos(font)
  let topo = Infinity
  let base = -Infinity
  for (const ch of String(texto ?? '')) {
    const c = mapa.get(ch.codePointAt(0))
    if (!c) continue
    if (c.yoffset < topo) topo = c.yoffset
    if (c.yoffset + c.height > base) base = c.yoffset + c.height
  }
  if (topo === Infinity) return { topo: 0, base: 0 }
  return { topo, base }
}

function yParaCentrar (font, texto, centro, escala = 1) {
  const { topo, base } = tintaVertical(font, texto)
  const e = Number(escala) > 0 ? Number(escala) : 1
  return Math.round(centro - (topo + base) * e / 2)
}

// Altura REAL da tinta de um texto (com um piso, para linha vazia não virar
// altura zero e as linhas se colarem). É o que faz o layout andar linha a
// linha em vez de somar a largura.
function alturaDaTinta (font, texto, minimo = 0, escala = 1) {
  const { topo, base } = tintaVertical(font, texto)
  if (topo === Infinity) return minimo
  const e = Number(escala) > 0 ? Number(escala) : 1
  return Math.max(minimo, Math.round((base - topo) * e))
}

// Corta com "..." até caber em `larguraMax` — nunca estoura a caixa.
function cortarParaCaber (font, texto, larguraMax, escala = 1) {
  const limpo = String(texto ?? '')
  if (medir(font, limpo, escala) <= larguraMax) return limpo
  let corte = limpo
  while (corte.length > 1 && medir(font, corte + '...', escala) > larguraMax) corte = corte.slice(0, -1)
  return corte.length <= 1 ? '...' : corte.replace(/\s+$/, '') + '...'
}

// ─── 🪜 escolher(candidatos, texto, larguraMax, minimoVisivel) ───
// `candidatos` vem do MAIOR para o menor: [{ font, escala }, ...].
//   1) 1ª passada: o MAIOR que couber INTEIRO vence — mesmo que desça um
//      degrau, o nome inteiro é mais útil que meia palavra gigante;
//   2) 2ª passada (só se ninguém coube inteiro): vale o MAIOR que ainda
//      MOSTRA `minimoVisivel` letras cortadas — "Ana Beatriz Cavalc..." numa
//      letra grande é melhor do que o nome todo numa letra ilegível;
//   3) nem isso? fica o maior cortado (plano B), sempre dentro da largura.
function escolher (candidatos, texto, larguraMax, minimoVisivel = MIN_VISIVEL_NOME) {
  const limpo = String(texto ?? '')
  if (!limpo) return null

  for (const cand of candidatos) {
    const escala = cand.escala || 1
    if (medir(cand.font, limpo, escala) <= larguraMax) {
      return { font: cand.font, escala, texto: limpo, cortado: false }
    }
  }

  let reserva = null
  for (const cand of candidatos) {
    const escala = cand.escala || 1
    const cortado = cortarParaCaber(cand.font, limpo, larguraMax, escala)
    const visiveis = cortado.replace(/\.{3}$/, '').length
    if (!reserva) reserva = { font: cand.font, escala, texto: cortado, cortado: true }
    if (visiveis >= Math.min(minimoVisivel, limpo.length)) {
      return { font: cand.font, escala, texto: cortado, cortado: true }
    }
  }
  return reserva
}

// 📐 Amostra BILINEAR da cobertura (alfa) da textura da fonte no ponto
// fracionário (fx, fy). É o que permite desenhar a fonte bitmap em ESCALA
// (1,5× no título, 1,2× na alcunha…) com a borda suave de impressão antiga,
// em vez do serrilhado de vizinho-mais-próximo.
function coberturaEm (pagina, fx, fy) {
  const w = pagina.bitmap.width
  const h = pagina.bitmap.height
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const ler = (x, y) => (x < 0 || y < 0 || x >= w || y >= h)
    ? 0
    : (pagina.getPixelColor(x, y) & 0xff) / 255
  const a = ler(x0, y0)
  const b = ler(x0 + 1, y0)
  const c = ler(x0, y0 + 1)
  const d = ler(x0 + 1, y0 + 1)
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty
}

// 📐 GRADE de cobertura de uma linha INTEIRA (escala já aplicada).
// Desenhar em grade (e não glifo a glifo) deixa o CONTORNO sair de uma
// dilatação barata, em vez de repetir a varredura da linha 8 vezes.
// A linha 0 da grade é o TOPO DA TINTA (mesma referência do `yParaCentrar`).
function gradeDaLinha (font, texto, escala = 1) {
  const limpo = String(texto ?? '')
  const e = Number(escala) > 0 ? Number(escala) : 1
  const { topo, base } = tintaVertical(font, limpo)
  const largura = Math.max(1, medir(font, limpo, e))
  const altura = Math.max(1, Math.round((base - topo) * e))
  const grade = new Float32Array(largura * altura)
  const topoEscalado = Math.round(topo * e)
  const pagina = font.pages && font.pages[0]
  if (!pagina) return { grade, largura, altura, topo: topoEscalado }
  const mapa = glifos(font)
  let avanco = 0
  for (const ch of limpo) {
    const glifo = mapa.get(ch.codePointAt(0))
    if (!glifo) continue
    const dl = Math.max(1, Math.round(glifo.width * e))
    const da = Math.max(1, Math.round(glifo.height * e))
    const ox = Math.round(avanco + glifo.xoffset * e)
    const oy = Math.round((glifo.yoffset - topo) * e)
    for (let dy = 0; dy < da; dy += 1) {
      const gy = oy + dy
      if (gy < 0 || gy >= altura) continue
      const fy = glifo.y + (dy + 0.5) / e - 0.5
      for (let dx = 0; dx < dl; dx += 1) {
        const gx = ox + dx
        if (gx < 0 || gx >= largura) continue
        const fx = glifo.x + (dx + 0.5) / e - 0.5
        grade[gy * largura + gx] = coberturaEm(pagina, fx, fy)
      }
    }
    avanco += glifo.xadvance * e
  }
  return { grade, largura, altura, topo: topoEscalado }
}

// 🖌️ Pinta uma grade na imagem (mistura pelo alfa, direto no bitmap.data).
// `corContorno`: quando existe, a letra ganha 1 px dilatado dessa cor em
// volta — é o "peso" da alcunha vermelha, que sozinha ficava lavada no papel.
function pintarGrade (imagem, linha, x, y, cor, corContorno) {
  const { grade, largura, altura, topo } = linha
  const x0 = Math.round(x)
  const y0 = Math.round(y + topo)
  const solido = 0.5
  if (corContorno) {
    const [cr, cg, cb] = canais(corContorno)
    for (let gy = 0; gy < altura; gy += 1) {
      for (let gx = 0; gx < largura; gx += 1) {
        if (grade[gy * largura + gx] < solido) continue
        for (let ny = -1; ny <= 1; ny += 1) {
          for (let nx = -1; nx <= 1; nx += 1) {
            const jx = gx + nx
            const jy = gy + ny
            if (jx < 0 || jy < 0 || jx >= largura || jy >= altura) continue
            if (grade[jy * largura + jx] >= solido) continue
            pintarPixel(imagem, x0 + jx, y0 + jy, cr, cg, cb)
          }
        }
      }
    }
  }
  const [r, g, b] = canais(cor)
  const { width, height, data } = imagem.bitmap
  for (let gy = 0; gy < altura; gy += 1) {
    const py = y0 + gy
    if (py < 0 || py >= height) continue
    for (let gx = 0; gx < largura; gx += 1) {
      const cobertura = grade[gy * largura + gx]
      if (cobertura <= 0.02) continue
      const px = x0 + gx
      if (px < 0 || px >= width) continue
      // ⚠️ Mistura lendo o fundo DIRETO do data ([R,G,B,A]) — ver a nota
      // longa logo abaixo, sobre o deslocamento de canal do setPixelColor.
      const k = (py * width + px) * 4
      pintarPixel(imagem, px, py,
        Math.round(data[k] + (r - data[k]) * cobertura),
        Math.round(data[k + 1] + (g - data[k + 1]) * cobertura),
        Math.round(data[k + 2] + (b - data[k + 2]) * cobertura))
    }
  }
}

// Escreve o texto NA COR pedida misturando cada pixel do glifo com o fundo
// pelo alfa da textura. Devolve a largura usada.
// `escala` (padrão 1) = tamanho natural da fonte bitmap; `contorno` = cor do
// contorno de 1 px (opcional). Em escala 1 e sem contorno o caminho é o
// rápido de sempre (glifo a glifo, sem grade).
function escrever (imagem, font, x, y, texto, cor, escala = 1, contorno = null) {
  const limpo = String(texto ?? '')
  if (!limpo) return 0
  const e = Number(escala) > 0 ? Number(escala) : 1
  if (e !== 1 || contorno) {
    const linha = gradeDaLinha(font, limpo, e)
    pintarGrade(imagem, linha, x, y, cor, contorno)
    return linha.largura
  }
  const mapa = glifos(font)
  const pagina = font.pages && font.pages[0]
  if (!pagina) return 0
  const [r, g, b] = canais(cor)
  const { width, height, data } = imagem.bitmap
  let avanco = 0

  for (const ch of limpo) {
    const glifo = mapa.get(ch.codePointAt(0))
    if (!glifo) continue
    for (let gy = 0; gy < glifo.height; gy += 1) {
      for (let gx = 0; gx < glifo.width; gx += 1) {
        const cobertura = (pagina.getPixelColor(glifo.x + gx, glifo.y + gy) & 0xff) / 255
        if (cobertura <= 0) continue
        const px = x + avanco + glifo.xoffset + gx
        const py = y + glifo.yoffset + gy
        if (px < 0 || py < 0 || px >= width || py >= height) continue
        // ⚠️ Lê o fundo direto do data ([R,G,B,A]): o `getPixelColor` desta
        // versão do Jimp é simétrico com o `setPixelColor` (que grava
        // [A,R,G,B]), então misturar os dois trocaria R e B na mistura e o
        // texto sairia com a cor errada.
        const k = (py * width + px) * 4
        const fr = data[k]
        const fg = data[k + 1]
        const fb = data[k + 2]
        const nr = Math.round(fr + (r - fr) * cobertura)
        const ng = Math.round(fg + (g - fg) * cobertura)
        const nb = Math.round(fb + (b - fb) * cobertura)
        pintarPixel(imagem, px, py, nr, ng, nb)
      }
    }
    avanco += glifo.xadvance
  }
  return avanco
}

function escreverCentrado (imagem, font, centro, y, texto, cor, escala = 1, contorno = null) {
  const limpo = String(texto ?? '')
  if (!limpo) return 0
  return escrever(imagem, font, Math.round(centro - medir(font, limpo, escala) / 2), y, limpo, cor, escala, contorno)
}

// ─── 🧰 Desenho — ESCRITA DIRETA NO bitmap.data ───
// ⚠️⚠️ ESTA VERSÃO DO JIMP TEM `setPixelColor` COM DESLOCAMENTO DE CANAL.
// Medido com `new Jimp({color:0})` e setPixelColor(0xRRGGBBAA):
//     0x2b1d10ff (R=43,G=29,B=16)  => data = 255, 43, 29, 16
//     0x8f2d1eff (R=143,G=45,B=30) => data = 255,143, 45, 30
// ou seja, ele grava [A, R, G, B] em vez de [R, G, B, A]. O `getPixelColor`
// desmente de volta (lê 0xRRGGBBAA), então o par get/set é simétrico e passa
// despercebido — mas qualquer leitura/escrita DIRETA no `bitmap.data` (que é
// [R, G, B, A], confirmado com round-trip de PNG) bate com o setPixelColor
// e TROCA os canais. Foi isso que pintou a foto do cartaz de vermelho.
//
// Por isso NENHUMA cor é passada ao setPixelColor aqui: este módulo escreve
// sempre direto no data, que é [R, G, B, A] e é o que o PNG espera.
function paraCor (cor) {
  if (typeof cor === 'number') return cor >>> 0
  const n = parseInt(String(cor).replace('#', ''), 16) || 0
  return (((n << 8) | 0xff) >>> 0)
}

function canais (cor) {
  const n = paraCor(cor)
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff]
}

// ✍️ Pinta UM pixel direto no data. Retorna false fora dos limites.
function pintarPixel (imagem, x, y, r, g, b) {
  const { width, height, data } = imagem.bitmap
  if (x < 0 || y < 0 || x >= width || y >= height) return false
  const j = (y * width + x) * 4
  data[j] = r
  data[j + 1] = g
  data[j + 2] = b
  data[j + 3] = 255
  return true
}

// 📖 Lê um pixel do bitmap.data como [r, g, b] (ordem [R,G,B,A] do Jimp).
function lerPixel (data, indicePixel) {
  const j = indicePixel * 4
  return [data[j], data[j + 1], data[j + 2]]
}

function pintarReto (imagem, x, y, w, h, cor) {
  const [r, g, b] = canais(cor)
  // ⚠️ ARREDONDA as coordenadas: `pintarElipse` calcula meia-largura com raiz
  // quadrada, então ela chega aqui fracionária — e um índice fracionário em
  // TypedArray é IGNORADO EM SILÊNCIO (o pixel simplesmente não aparece).
  const x0 = Math.max(0, Math.round(x))
  const y0 = Math.max(0, Math.round(y))
  const x1 = Math.min(imagem.bitmap.width, Math.round(x + w))
  const y1 = Math.min(imagem.bitmap.height, Math.round(y + h))
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) pintarPixel(imagem, px, py, r, g, b)
  }
}

function pintarElipse (imagem, cx, cy, rx, ry, cor) {
  if (rx <= 0 || ry <= 0) return
  for (let dy = -ry; dy <= ry; dy += 1) {
    const sobra = 1 - (dy * dy) / (ry * ry)
    if (sobra < 0) continue
    const meia = Math.floor(rx * Math.sqrt(sobra))
    pintarReto(imagem, cx - meia, cy + dy, meia * 2 + 1, 1, cor)
  }
}

// Fio divisório com um losango no meio (a "régua" dos cartazes antigos).
function fio (imagem, x0, x1, y, espessura, cor) {
  pintarReto(imagem, x0, y, x1 - x0, espessura, cor)
  const cx = Math.round((x0 + x1) / 2)
  const r = espessura * 2
  pintarElipse(imagem, cx, y + Math.floor(espessura / 2), r, r, cor)
}

// ─── 📷 A foto no círculo ───
// Recorta a foto num DISCO e escreve dentro do bounding box detectado.
// `filtro` é o transformador pixel a pixel (o comando passa um realce suave,
// para a foto não sumir no papel bege).
function aplicarFoto (moldura, circulo, foto, filtro) {
  if (!circulo) return false
  const d = circulo.raio * 2
  if (d <= 2) return false
  // `cover`: preenche o disco inteiro sem distorcer (corta o excedente).
  foto.cover({ w: d, h: d })
  const r2 = circulo.raio * circulo.raio
  for (let dy = -circulo.raio; dy <= circulo.raio; dy += 1) {
    for (let dx = -circulo.raio; dx <= circulo.raio; dx += 1) {
      // Só o disco: o resto do bounding box (a moldura ao redor) fica intacto.
      if (dx * dx + dy * dy > r2) continue
      const px = circulo.cx + dx
      const py = circulo.cy + dy
      if (px < 0 || py < 0 || px >= moldura.bitmap.width || py >= moldura.bitmap.height) continue
      const i = (dy + circulo.raio) * d + (dx + circulo.raio)
      const [r, g, b] = lerPixel(foto.bitmap.data, i)
      const cor = filtro ? filtro(foto.bitmap.data, i, r, g, b) : [r, g, b]
      pintarPixel(moldura, px, py, cor[0], cor[1], cor[2])
    }
  }
  return true
}

// Sem foto (privacidade/404): o disco fica com a cor do papel e anéis
// dourados — o cartaz continua parecendo cartaz.
function discoVazio (moldura, circulo) {
  if (!circulo) return
  pintarElipse(moldura, circulo.cx, circulo.cy, circulo.raio, circulo.raio, PAPEL)
  pintarElipse(moldura, circulo.cx, circulo.cy, circulo.raio, circulo.raio, OURO)
  pintarElipse(moldura, circulo.cx, circulo.cy, circulo.raio - 6, circulo.raio - 6, PAPEL_ESCURO)
  pintarElipse(moldura, circulo.cx, circulo.cy, Math.round(circulo.raio * 0.6), Math.round(circulo.raio * 0.6), OURO_CLARO)
}

// Realce suave pra foto não "afundar" no papel antigo: sobe um pouco o
// contraste e esquenta de leve (o cartaz é sério, não frio).
// Recebe o pixel JÁ LIDO (r, g, b) do bitmap.data e devolve o tripla
// realçada — nada de inteiro 0xRRGGBBAA aqui, que é justamente onde o
// `setPixelColor` desta versão do Jimp troca os canais.
function realce (_data, _i, r0, g0, b0) {
  const limitar = (v) => Math.min(255, Math.max(0, v))
  return [
    limitar(Math.round((r0 - 128) * 1.18 + 140)),
    limitar(Math.round((g0 - 128) * 1.18 + 128)),
    limitar(Math.round((b0 - 128) * 1.18 + 104))
  ]
}

// ─── 📜 composição ───
// 📐 desenharTitulo: a faixa escura do topo (CAIXA_TITULO) recebe o
// TITULO_CARTAZ em dourado, com sombra e um filete embaixo.
// O título é CENTRADO na ALTURA DA TINTA (yParaCentrar) e cresce por ESCALA:
// a fonte bitmap só existe em 64 px e o TITULO_CARTAZ a 1,5× ocupa 624 dos
// 724 px da caixa — bem mais presença de cartaz sem estourar a faixa.
function desenharTitulo (imagem, font) {
  const cx = Math.round(imagem.bitmap.width / 2)
  const centro = CAIXA_TITULO.y + Math.round(CAIXA_TITULO.altura / 2)
  const titulo = limparParaFonte(font, TITULO_CARTAZ)
  const y = yParaCentrar(font, titulo, centro, ESCALA_TITULO)
  // Sombra preta embaixo do dourado: dá o relevo de cartaz pintado à mão.
  escreverCentrado(imagem, font, cx, y + 6, titulo, TINTA, ESCALA_TITULO)
  escreverCentrado(imagem, font, cx, y, titulo, OURO_TITULO, ESCALA_TITULO)
  fio(imagem, CAIXA_TITULO.x, CAIXA_TITULO.x + CAIXA_TITULO.largura, CAIXA_TITULO.y + CAIXA_TITULO.altura, 4, OURO)
}

// 📐 desenharTexto: o miolo de papel (CAIXA_TEXTO) com o NOME grande, a
// alcunha, a contagem, a data da última mensagem e o rodapé do bot.
//
// ⚠️ O layout NÃO usa espaçamento chutado linha a linha: mede a ALTURA DE
// TINTA de cada linha (nunca a largura que o `escrever` devolve — somar a
// largura faria cada linha pular centenas de pixels) e divide a sobra em
// GAPS IGUAIS entre TOPO_MIOLO e FUNDO_MIOLO. É o mesmo respiro entre o
// círculo e a moldura de baixo, e o texto nunca encosta no ornamento.
function desenharTexto (imagem, fontes, dados) {
  const x = CAIXA_TEXTO.x
  const largura = CAIXA_TEXTO.largura
  const centro = Math.round(imagem.bitmap.width / 2)

  // 1) 🪜 NOME — a maior linha do cartaz. A escada tenta 1,5× → 1× na fonte
  //    de 64 px e só desce para a de 32 px (nunca abaixo do tamanho das
  //    outras linhas, senão o nome vira a menor coisa do cartaz).
  const nome = escolher(
    ESCADARIA_NOME.map((escala) => ({ font: fontes.titulo, escala })).concat([
      { font: fontes.media, escala: 1.4 },
      { font: fontes.media, escala: 1.2 }
    ]),
    limparParaFonte(fontes.titulo, dados.nome),
    largura
  ) || { font: fontes.media, escala: 1, texto: '' }

  // 📝 As LINHAS do miolo, na ordem de leitura.
  const linhas = [
    { texto: nome.texto, font: nome.font, escala: nome.escala, cor: TINTA },
    {
      // 2) ALCUNHA — entre aspas, em vermelho escuro e com CONTORNO de tinta
      //    (sem o contorno o vermelho lavava no papel bege).
      texto: limparParaFonte(fontes.media, '"' + dados.alcunha + '"'),
      font: fontes.media,
      escala: ESCALA_ALCUNHA,
      cor: FITA,
      contorno: TINTA
    },
    { fio: 3 },
    {
      // 3) CONTAGEM de mensagens.
      texto: limparParaFonte(fontes.media, dados.total + ' ' + dados.palavra + ' no ranking do grupo'),
      font: fontes.media,
      escala: 1,
      cor: TINTA
    }
  ]

  // 4) ÚLTIMA MENSAGEM — a linha que substituiu o "NO TOPO DESDE" do cartaz
  //    antigo. Só sai quando o banco tem o carimbo de tempo (linha de banco
  //    antigo, sem o campo, simplesmente não ganha a linha).
  if (dados.ultimaMensagem) {
    linhas.push({
      texto: limparParaFonte(fontes.media, 'última mensagem: ' + dados.ultimaMensagem),
      font: fontes.media,
      escala: 1,
      cor: TINTA
    })
  }

  // 5) FILete final + a frase de rodapé do bot: fecha a folha e dá o peso de
  //    "cartaz antigo" que o miolo de papel pede.
  linhas.push({ fio: 3 })
  linhas.push({
    texto: limparParaFonte(fontes.media, dados.rodape || ''),
    font: fontes.media,
    escala: ESCALA_RODAPE,
    cor: TINTA
  })

  // ✂️ Corta cada linha (nunca estoura a caixa) e mede a altura da tinta.
  for (const linha of linhas) {
    if (linha.fio) {
      linha.altura = linha.fio
      continue
    }
    linha.texto = cortarParaCaber(linha.font, linha.texto, largura, linha.escala)
    linha.altura = alturaDaTinta(linha.font, linha.texto, 0, linha.escala)
  }

  const tinta = linhas.reduce((soma, linha) => soma + linha.altura, 0)
  const disponivel = FUNDO_MIOLO - CAIXA_TEXTO.y - TOPO_MIOLO
  // 🛡️ Piso de 8 px: se o miolo ficar apertado, as linhas se encostam — mas
  // nunca se SOBREPÕEM (o gap jamais fica negativo).
  const gap = Math.max(8, (disponivel - tinta) / linhas.length)

  // ✍️ Desenha na ordem. O cursor é INTEIRO de propósito: o gap vem de uma
  // divisão, e `fio`/escrever receber coordenada fracionária perderia pixel
  // em silêncio (índice fracionário em TypedArray é ignorado).
  let y = Math.round(CAIXA_TEXTO.y + TOPO_MIOLO)
  for (const linha of linhas) {
    if (linha.fio) {
      fio(imagem, x + 150, x + largura - 150, y, linha.altura, TINTA_SUAVE)
    } else if (linha.texto) {
      escreverCentrado(
        imagem, linha.font, centro,
        yParaCentrar(linha.font, linha.texto, y + linha.altura / 2, linha.escala),
        linha.texto, linha.cor, linha.escala, linha.contorno || null
      )
    }
    y += Math.round(linha.altura + gap)
  }

  return y
}

// ─── 🎬 FUNÇÃO PRINCIPAL ───
// comporCartazProcurado({ nome, alcunha, total, palavra, desde, ultimaMensagem,
// rodape, foto }): devolve o Buffer PNG pronto p/ enviar. LÊ a moldura do
// disco, detecta o círculo, compõe a foto e escreve o texto. Lança em qualquer
// problema (moldura ausente, PNG inválido) — quem chama é o comando, que tem o
// fallback em texto.
// ⚠️ `ultimaMensagem` é a data JÁ FORMATADA ("30/09/2026") ou null/ausente:
// sem ela o cartaz sai sem a linha da última mensagem.
async function comporCartazProcurado (dados) {
  // 🖼️ A moldura tem que estar no disco (é versionada no repositório).
  if (!fs.existsSync(CAMINHO_MOLDURA)) {
    throw new Error('moldura do cartaz não encontrada: ' + CAMINHO_MOLDURA)
  }
  const moldura = await Jimp.read(CAMINHO_MOLDURA)

  // 🔍 Círculo: detectado, nunca hardcoded.
  const circulo = detectarCirculo(moldura)

  const fontTitulo = await fonte(SANS_64_WHITE)
  const fontMedia = await fonte(SANS_32_WHITE)
  const fontPequena = await fonte(SANS_16_WHITE)

  // 📷 Foto no disco (ou disco vazio, se a pessoa não tem foto pública).
  if (dados.foto) {
    try {
      const foto = await Jimp.read(dados.foto)
      if (!aplicarFoto(moldura, circulo, foto, realce)) discoVazio(moldura, circulo)
    } catch (err) {
      console.error('[cartaz] ⚠️ falha ao aplicar a foto (segue com o disco vazio):', err?.message || err)
      discoVazio(moldura, circulo)
    }
  } else {
    discoVazio(moldura, circulo)
  }

  // ✍️ Título na faixa escura + texto no miolo de papel.
  // A fonte de 16 px fica de RESERVA em `fontes.pequena`: o piso da escada do
  // nome é 32 px × 1,2, para o nome nunca sair menor do que as outras linhas.
  desenharTitulo(moldura, fontTitulo)
  desenharTexto(moldura, { titulo: fontTitulo, media: fontMedia, pequena: fontPequena }, dados)

  return moldura.getBuffer(JimpMime.png)
}

// 🖼️ Miniatura 64×64 em JPEG (preview do WhatsApp) — feita no Jimp para a
// Baileys não precisar chamar sharp/ffmpeg dentro do processo do bot.
async function miniaturaDoCartaz (bufferPng) {
  const imagem = await Jimp.read(bufferPng)
  imagem.cover({ w: 64, h: 64 })
  const mini = await imagem.getBuffer(JimpMime.jpeg, { quality: 80 })
  return mini.toString('base64')
}

module.exports = {
  CAMINHO_MOLDURA,
  CAIXA_TITULO,
  CAIXA_TEXTO,
  TITULO_CARTAZ,
  detectarCirculo,
  comporCartazProcurado,
  miniaturaDoCartaz,
  __internos: {
    ALFA_CORTADA, CLARO_MIN, CLARO_MAX_SAT, AREA_MINIMA,
    TINTA, TINTA_SUAVE, OURO, OURO_CLARO, PAPEL, PAPEL_ESCURO, FITA, FITA_CLARA,
    TOPO_MIOLO, FUNDO_MIOLO, ESCALA_TITULO, ESCALA_ALCUNHA, ESCALA_RODAPE,
    ESCADARIA_NOME, MIN_VISIVEL_NOME,
    limparParaFonte, medir, tintaVertical, yParaCentrar, cortarParaCaber,
    escolher, escrever, escreverCentrado, pintarReto, pintarElipse, fio,
    alturaDaTinta, coberturaEm, gradeDaLinha, pintarGrade,
    aplicarFoto, discoVazio, realce, desenharTitulo, desenharTexto, glifos
  }
}




