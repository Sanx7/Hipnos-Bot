// ============================================================
// 🏛️ PERGAMINHO-RANKING — o quadro de honra do /ranking em imagem
// ============================================================
// Desenha o pergaminho grego do /ranking com Jimp (JS puro — nada de canvas
// ou sharp dentro do processo, a regra de ouro do projeto):
//
//   1. FUNDO de pergaminho envelhecido: manchas de idade + vinheta nas
//      bordas, sempre com a MESMA semente (o comando pedido duas vezes sem
//      nenhuma mensagem nova devolve exatamente a mesma imagem);
//   2. ROLOS de ouro no topo e na base: barra com brilho, sombra e tampas
//      concêntricas nas pontas (como um pergaminho enrolado);
//   3. FRISCO GREGO (meandro) nos quatro lados: dois trilhos fechados e,
//      entre eles, os ganchos que se repetem — os cantos ficam limpos;
//   4. CABEÇALHO: título "RANKING DO OLIMPO", nome do grupo e a data;
//   5. As 10 LINHAS: medalha desenhada (ouro/prata/bronze no pódio),
//      nome pintado com a cor do `corVip` do VIP, pontilhado de ligação e
//      o total de mensagens à direita.
//
// ⚠️ As fontes bitmap do Jimp cobrem ASCII + Latin-1: acentos (á, ç, ã, ú, º)
// funcionam, mas emoji, grego, japonês etc. NÃO têm glifo. Por isso TODO
// texto passa por `limparParaFonte` (troca o que a fonte não desenha por
// espaço) e as medidas saem de `medir` (soma dos avanços dos glifos). Nada de
// caixinha quebrada e nada estourando a coluna.
//
// 🖌️ O texto é pintado glifo a glifo, usando o ALFA da textura como
// cobertura: o `print` do Jimp mistura o glifo branco com o fundo e o texto
// pequeno sai lavado, sem a cor pedida (ver `escrever`).
// ============================================================
const { Jimp, JimpMime, loadFont } = require('jimp')
const { SANS_16_WHITE, SANS_32_WHITE } = require('jimp/fonts')
const { hexParaJimp } = require('./temas-vip')
const { corDoEmoji } = require('./dados/cores-vip')

// ─── 📐 Medidas (tudo em pixel — o teste amarra os números) ───
const LARG = 900
const ALT = 1100

// Moldura do frisco grego: distância da borda, largura da faixa e espessura
// de cada traço. `passo` é a distância entre dois ganchos do meandro.
const FRISCO = {
  margemX: 46, // trilho externo até a borda esquerda/direita
  baseTopo: 78, // idem no topo (e, espelhado, na base)
  larg: 26, // largura da faixa (trilhos + ganchos)
  esp: 4, // espessura dos traços
  passo: 46 // distância entre ganchos
}

// Rolos de ouro (topo e base).
const ROLO_ALT = 44
const ROLO_Y = 16
const ROLO_RAIO = 22
const ROLO_X0 = 76
const ROLO_X1 = LARG - 76

// Grade das 10 linhas.
const ROW_INICIO = 250
const ROW_ALT = 62
const ROW_X0 = 84
const ROW_X1 = 816
const ROW_BADGE_X = ROW_X0 + 30
const ROW_NOME_X = ROW_X0 + 74
// Coluna do total: quanto fica reservado à direita para número + "mensagens".
const ROW_RESERVA_TOTAL = 160

// Faixa do cabeçalho/rodapé.
const TITULO_Y = 140
const SUBTITULO_Y = 180
const DIVISOR_TOPO_Y = 216
const RODAPE_DIVISOR_Y = 884
const RODAPE_NOTA_Y = 896
const RODAPE_FRASE_Y = 926
const RODAPE_DATA_Y = 958

// ─── 🎨 Paleta do pergaminho ───
const PERGAMINHO = '#e7d4a9'
const PERGAMINHO_MANCHA = '#bf9a58'
const PERGAMINHO_ZEBRA = '#d9c390'
const OURO = '#c9a227'
const OURO_CLARO = '#f2dc8c'
const OURO_ESCURO = '#7d5a12'
const OURO_SOMBRA = '#a3801a'
const TINTA = '#3b2a18'
const TINTA_SUAVE = '#8a7050'
const MEDALHA = ['#d9b23a', '#b9bcc4', '#c07840'] // ouro, prata, bronze
const MEDALHA_BORDA = '#5d4514'

// Semente fixa do gerador de "envelhecimento" (mesmo ranking = mesma imagem).
const SEMENTE = 20260929

// Textos fixos do pergaminho.
const TITULO = 'RANKING DO OLIMPO'
const SUBTITULO_PADRAO = 'Os mais ativos do recinto'
const FRASE_FINAL = 'O sono alcança até os mais falantes.'
const NOTA_SAIU = '* saiu do grupo'

// ─── ✍️ Texto ───
// Mapa id→glifo de cada fonte (as chaves de `font.chars` são índices, não
// codepoints — o `id` de cada glifo é que é o codepoint de verdade).
const CACHE_GLIFOS = new Map()

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

// Troca por espaço o que a fonte NÃO sabe desenhar (emoji, grego, japonês…)
// e junta os espaços que sobram: o texto sempre termina desenhável e medível.
function limparParaFonte (font, texto) {
  const mapa = glifos(font)
  let saida = ''
  for (const ch of String(texto ?? '')) saida += mapa.has(ch.codePointAt(0)) ? ch : ' '
  return saida.replace(/\s+/g, ' ').trim()
}

// Topo/base da TINTA de um texto, medidos no yoffset/height dos próprios
// glifos: é o que permite centralizar de verdade, sem número mágico.
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

// `y` que deixa a tinta do texto centrada em `centro`.
function yParaCentrar (font, texto, centro) {
  const { topo, base } = tintaVertical(font, texto)
  return Math.round(centro - (topo + base) / 2)
}

// Largura do texto = soma dos avanços dos glifos. É a MESMA conta que o
// desenhador abaixo faz, então alinhamento e medida nunca brigam.
function medir (font, texto) {
  const mapa = glifos(font)
  let largura = 0
  for (const ch of String(texto ?? '')) {
    const glifo = mapa.get(ch.codePointAt(0))
    if (glifo) largura += glifo.xadvance
  }
  return largura
}

// Corta com "..." até caber em `larguraMax` — nunca estoura a coluna.
function cortarParaCaber (font, texto, larguraMax) {
  const limpo = String(texto ?? '')
  if (medir(font, limpo) <= larguraMax) return limpo
  let corte = limpo
  while (corte.length > 1 && medir(font, corte + '...') > larguraMax) {
    corte = corte.slice(0, -1)
  }
  if (corte.length <= 1) return '...'
  return corte.replace(/\s+$/, '') + '...'
}

// ✍️ Escreve o texto NA COR pedida, pintando os glifos da textura da fonte e
// usando o ALFA de cada pixel como cobertura (mistura com o que já estava
// atrás). Não usamos `print` do Jimp de propósito: ele mistura o glifo branco
// com o fundo e o texto pequeno sai lavado, sem cor de verdade.
// Devolve a largura usada (igual ao `medir`).
function escrever (imagem, font, x, y, texto, cor) {
  const limpo = String(texto ?? '')
  if (!limpo) return 0
  const mapa = glifos(font)
  const pagina = font.pages && font.pages[0]
  if (!pagina) return 0
  const [r, g, b] = canais(cor)
  const { width, height } = imagem.bitmap
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
        const fundo = imagem.getPixelColor(px, py) >>> 0
        const fr = (fundo >>> 24) & 0xff
        const fg = (fundo >>> 16) & 0xff
        const fb = (fundo >>> 8) & 0xff
        const nr = Math.round(fr + (r - fr) * cobertura)
        const ng = Math.round(fg + (g - fg) * cobertura)
        const nb = Math.round(fb + (b - fb) * cobertura)
        imagem.setPixelColor(((nr << 24) | (ng << 16) | (nb << 8) | 0xff) >>> 0, px, py)
      }
    }
    avanco += glifo.xadvance
  }

  return avanco
}

// ✍️ Centralizado no eixo X (centro dado).
function escreverCentrado (imagem, font, centro, y, texto, cor) {
  const limpo = String(texto ?? '')
  if (!limpo) return 0
  return escrever(imagem, font, Math.round(centro - medir(font, limpo) / 2), y, limpo, cor)
}

// ✍️ Alinhado à direita (o texto TERMINA em `fim`).
function escreverDireita (imagem, font, fim, y, texto, cor) {
  const limpo = String(texto ?? '')
  if (!limpo) return 0
  return escrever(imagem, font, Math.round(fim - medir(font, limpo)), y, limpo, cor)
}

// ─── 🧰 Ferramentas de desenho ───
// Fontes carregadas uma vez só (o loadFont lê o .fnt do disco).
const CACHE_FONTES = new Map()

async function fontePergaminho (qual) {
  if (!CACHE_FONTES.has(qual)) CACHE_FONTES.set(qual, await loadFont(qual))
  return CACHE_FONTES.get(qual)
}

// Pinta um retângulo (cortado nas bordas da imagem, sem estourar nada).
function pintarReto (imagem, x, y, w, h, cor) {
  const x0 = Math.max(0, x)
  const y0 = Math.max(0, y)
  const x1 = Math.min(imagem.bitmap.width, x + w)
  const y1 = Math.min(imagem.bitmap.height, y + h)
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) imagem.setPixelColor(cor, px, py)
  }
}

// Elipse CHEIA por varredura de linhas (tampas dos rolos e medalhas). Sem
// antialias de propósito: o traço do pergaminho é seco, feito a pena.
function pintarElipse (imagem, cx, cy, rx, ry, cor) {
  if (rx <= 0 || ry <= 0) return
  for (let dy = -ry; dy <= ry; dy += 1) {
    const sobra = 1 - (dy * dy) / (ry * ry)
    if (sobra < 0) continue
    const meia = Math.floor(rx * Math.sqrt(sobra))
    pintarReto(imagem, cx - meia, cy + dy, meia * 2 + 1, 1, cor)
  }
}

// Cor → [r, g, b]. Aceita as DUAS formas usadas no projeto: hex "#rrggbb"
// (paletas) e o número do jimp 0xRRGGBBAA (constantes do pergaminho).
function canais (cor) {
  if (typeof cor === 'number') {
    return [(cor >>> 24) & 0xff, (cor >>> 16) & 0xff, (cor >>> 8) & 0xff]
  }
  const limpo = String(cor || '').replace(/^#/, '')
  return [
    parseInt(limpo.slice(0, 2), 16),
    parseInt(limpo.slice(2, 4), 16),
    parseInt(limpo.slice(4, 6), 16)
  ]
}

// Mistura dois hex (0 = só o primeiro, 1 = só o segundo) — "transparência"
// falsa, já que o pergaminho é pintado pixel a pixel.
function misturar (hexA, hexB, fator) {
  const [r1, g1, b1] = canais(hexA)
  const [r2, g2, b2] = canais(hexB)
  const f = Math.max(0, Math.min(1, fator))
  const junto = (a, b) => Math.round(a + (b - a) * f).toString(16).padStart(2, '0')
  return '#' + junto(r1, r2) + junto(g1, g2) + junto(b1, b2)
}

// Gerador pseudoaleatório determinístico (mulberry32): o pergaminho precisa
// nascer igual todas as vezes, então nada de Math.random aqui.
function geradorSemente (semente) {
  let a = semente >>> 0
  return function proximo () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── 📜 Fundo: pergaminho envelhecido ───
// Manchas de idade + fibras + vinheta, tudo do MESMO gerador com semente
// fixa: pedir o /ranking duas vezes sem mensagem nova devolve a mesma arte.
function envelhecer (imagem) {
  const rnd = geradorSemente(SEMENTE)

  // Manchas de idade (ovais suaves, nunca mais escuros que a tinta).
  for (let i = 0; i < 130; i += 1) {
    const cx = Math.round(rnd() * LARG)
    const cy = Math.round(rnd() * ALT)
    const rx = 24 + Math.round(rnd() * 120)
    const ry = 16 + Math.round(rnd() * 80)
    pintarElipse(imagem, cx, cy, rx, ry, hexParaJimp(misturar(PERGAMINHO, PERGAMINHO_MANCHA, 0.06 + rnd() * 0.16)))
  }

  // Fibras soltas do papel (risquinhos de 1px espalhados).
  for (let i = 0; i < 420; i += 1) {
    const x = Math.round(rnd() * LARG)
    const y = Math.round(rnd() * ALT)
    const comprimento = 2 + Math.round(rnd() * 10)
    pintarReto(imagem, x, y, comprimento, 1, hexParaJimp(misturar(PERGAMINHO, PERGAMINHO_MANCHA, 0.12 + rnd() * 0.2)))
  }

  // Vinheta: o papel queima de leve perto das bordas (pixel a pixel, direto
  // no bitmap — mais rápido que setPixelColor em 1 milhão de pixels).
  const { width, height, data } = imagem.bitmap
  const beira = 90
  for (let y = 0; y < height; y += 1) {
    const dy = Math.min(y, height - 1 - y)
    for (let x = 0; x < width; x += 1) {
      const perto = Math.min(x, width - 1 - x, dy)
      if (perto >= beira) continue
      const fator = (1 - perto / beira) * 0.22
      const i = (y * width + x) * 4
      data[i] = Math.round(data[i] * (1 - fator))
      data[i + 1] = Math.round(data[i + 1] * (1 - fator))
      data[i + 2] = Math.round(data[i + 2] * (1 - fator))
    }
  }
}

// ─── 🏺 Frisco grego (meandro) ───
// Traço com `de`→`ate` ao longo da borda e espessura `alt` atravessando a
// faixa: em 'h' o comprimento anda no X; em 'v', no Y. Um só código desenha
// os quatro lados do pergaminho.
function traco (imagem, orientacao, de, ate, travessa, alt, cor) {
  if (orientacao === 'h') pintarReto(imagem, de, travessa, ate - de, alt, cor)
  else pintarReto(imagem, travessa, de, alt, ate - de, cor)
}

// Ganchos do meandro repetidos dentro da faixa. `sentido` é para onde a
// faixa cresce a partir do trilho EXTERNO (+1 topo/esquerda, -1 base/direita),
// então os quatro lados apontam sempre para dentro do pergaminho.
function ganchosDoMeandro (imagem, opcoes) {
  const { orientacao, inicio, fim, base, sentido, cor } = opcoes
  const { larg, esp, passo } = FRISCO
  const meio = Math.floor(larg / 2)
  const posicao = (local, alt) => (sentido > 0 ? base + local : base - local - alt)

  for (let x = inicio + esp; x + passo <= fim; x += passo) {
    // perna: do meio da faixa até o trilho interno
    traco(imagem, orientacao, x, x + esp, posicao(meio, larg - meio), larg - meio, cor)
    // travessão: corre paralelo ao trilho, é o que dá o desenho da grega
    traco(imagem, orientacao, x, x + passo - esp, posicao(meio, esp), esp, cor)
  }
}

// Moldura completa: dois trilhos FECHADOS (retângulos inteiros — por isso os
// cantos ficam limpos) e o meandro entre eles, longe das esquinas.
function desenharFriscoGrego (imagem, cor) {
  const { margemX, baseTopo, larg, esp } = FRISCO
  const xEsq = margemX
  const xDir = LARG - margemX
  const yTopo = baseTopo
  const yBase = ALT - baseTopo
  const dentro = larg - esp

  // Trilho externo
  pintarReto(imagem, xEsq, yTopo, xDir - xEsq, esp, cor)
  pintarReto(imagem, xEsq, yBase - esp, xDir - xEsq, esp, cor)
  pintarReto(imagem, xEsq, yTopo, esp, yBase - yTopo, cor)
  pintarReto(imagem, xDir - esp, yTopo, esp, yBase - yTopo, cor)

  // Trilho interno
  pintarReto(imagem, xEsq + dentro, yTopo + dentro, xDir - xEsq - dentro * 2, esp, cor)
  pintarReto(imagem, xEsq + dentro, yBase - larg, xDir - xEsq - dentro * 2, esp, cor)
  pintarReto(imagem, xEsq + dentro, yTopo + dentro, esp, yBase - yTopo - dentro * 2, cor)
  pintarReto(imagem, xDir - larg, yTopo + dentro, esp, yBase - yTopo - dentro * 2, cor)

  // Meandro nos quatro lados (fora das esquinas)
  ganchosDoMeandro(imagem, { orientacao: 'h', inicio: xEsq + larg, fim: xDir - larg, base: yTopo, sentido: 1, cor })
  ganchosDoMeandro(imagem, { orientacao: 'h', inicio: xEsq + larg, fim: xDir - larg, base: yBase, sentido: -1, cor })
  ganchosDoMeandro(imagem, { orientacao: 'v', inicio: yTopo + larg, fim: yBase - larg, base: xEsq, sentido: 1, cor })
  ganchosDoMeandro(imagem, { orientacao: 'v', inicio: yTopo + larg, fim: yBase - larg, base: xDir, sentido: -1, cor })
}

// ─── 🥇 Rolos de ouro (topo e base) ───
// Barra com brilho e sombra + tampas concêntricas nas pontas: é o que dá a
// leitura de "pergaminho enrolado" nas duas extremidades.
function desenharRolo (imagem, y) {
  const largura = ROLO_X1 - ROLO_X0
  const corContorno = hexParaJimp(OURO_ESCURO)
  const corOuro = hexParaJimp(OURO)
  const corBrilho = hexParaJimp(OURO_CLARO)
  const corSombra = hexParaJimp(OURO_SOMBRA)

  // sombra projetada no papel (embaixo da barra, passando das pontas)
  pintarReto(
    imagem,
    ROLO_X0 - ROLO_RAIO + 4,
    y + ROLO_ALT,
    largura + ROLO_RAIO * 2 - 8,
    7,
    hexParaJimp(misturar(PERGAMINHO, '#6b4f1c', 0.45))
  )

  // barra
  pintarReto(imagem, ROLO_X0, y, largura, ROLO_ALT, corContorno)
  pintarReto(imagem, ROLO_X0 + 2, y + 2, largura - 4, ROLO_ALT - 4, corOuro)
  pintarReto(imagem, ROLO_X0 + 6, y + 4, largura - 12, 6, corBrilho)
  pintarReto(imagem, ROLO_X0 + 6, y + ROLO_ALT - 11, largura - 12, 5, corSombra)

  // tampas (anéis concêntricos)
  const cy = y + Math.round(ROLO_ALT / 2)
  for (const cx of [ROLO_X0, ROLO_X1]) {
    pintarElipse(imagem, cx, cy, ROLO_RAIO, ROLO_RAIO, corContorno)
    pintarElipse(imagem, cx, cy, ROLO_RAIO - 2, ROLO_RAIO - 2, corOuro)
    pintarElipse(imagem, cx, cy, ROLO_RAIO - 8, ROLO_RAIO - 8, corContorno)
    pintarElipse(imagem, cx, cy, ROLO_RAIO - 11, ROLO_RAIO - 11, corBrilho)
    pintarElipse(imagem, cx, cy, 4, 4, corContorno)
    pintarElipse(imagem, cx, cy, 1, 1, corBrilho)
  }
}

// Losango cheio (miolo do fio de ouro do cabeçalho).
function pintarLosango (imagem, cx, cy, raio, cor) {
  for (let i = 0; i <= raio; i += 1) {
    pintarReto(imagem, cx - i, cy - raio + i, i * 2 + 1, 1, cor)
    pintarReto(imagem, cx - i, cy + raio - i, i * 2 + 1, 1, cor)
  }
}

// ─── 🏛️ Cabeçalho ───
function desenharCabecalho (imagem, fontMedia, fontPequena, subtituloBruto) {
  const centro = LARG / 2
  escreverCentrado(imagem, fontMedia, centro, TITULO_Y, limparParaFonte(fontMedia, TITULO), hexParaJimp(TINTA))

  const bruto = String(subtituloBruto ?? '').trim()
  const sub = cortarParaCaber(fontPequena, limparParaFonte(fontPequena, bruto || SUBTITULO_PADRAO), 620)
  escreverCentrado(imagem, fontPequena, centro, SUBTITULO_Y, sub || SUBTITULO_PADRAO, hexParaJimp(TINTA_SUAVE))

  // fio de ouro partido, com um losango no meio
  const corFio = hexParaJimp(OURO)
  pintarReto(imagem, 130, DIVISOR_TOPO_Y, centro - 144, 2, corFio)
  pintarReto(imagem, centro + 14, DIVISOR_TOPO_Y, LARG - 130 - centro - 14, 2, corFio)
  pintarLosango(imagem, centro, DIVISOR_TOPO_Y + 1, 7, corFio)
}

// ─── 🏅 Linha da lista (posição, nome colorido, pontilhado e total) ───
function desenharLinha (imagem, fontMedia, fontPequena, indice, item) {
  const y = ROW_INICIO + indice * ROW_ALT
  const centro = y + ROW_ALT / 2
  const posicao = indice + 1
  const saiu = item?.saiu === true
  const corTinta = hexParaJimp(TINTA)

  // listra alternada (uma linha sim, uma não — ajuda a ler a tabela)
  if (indice % 2 === 0) {
    pintarReto(
      imagem, ROW_X0 - 6, y + 2, ROW_X1 - ROW_X0 + 12, ROW_ALT - 4,
      hexParaJimp(misturar(PERGAMINHO, PERGAMINHO_ZEBRA, 0.5))
    )
  }

  // Medalha só no pódio: do 4º em diante o número vai direto na tinta.
  if (posicao <= MEDALHA.length) {
    pintarElipse(imagem, ROW_BADGE_X, centro, 20, 20, hexParaJimp(MEDALHA_BORDA))
    pintarElipse(imagem, ROW_BADGE_X, centro, 17, 17, hexParaJimp(MEDALHA[posicao - 1]))
    pintarElipse(imagem, ROW_BADGE_X - 5, centro - 6, 7, 6, hexParaJimp(misturar(MEDALHA[posicao - 1], OURO_CLARO, 0.5)))
  }
  const rotulo = posicao + 'º'
  escrever(
    imagem,
    fontMedia,
    ROW_BADGE_X - Math.round(medir(fontMedia, rotulo) / 2),
    yParaCentrar(fontMedia, rotulo, centro),
    rotulo,
    corTinta
  )

  // Nome do jogador na cor do corVip (ou na tinta padrão, quando não tem cor).
  const nome = cortarParaCaber(
    fontMedia,
    limparParaFonte(fontMedia, item?.nome),
    ROW_X1 - ROW_NOME_X - ROW_RESERVA_TOTAL
  )
  const larguraNome = escrever(
    imagem,
    fontMedia,
    ROW_NOME_X,
    yParaCentrar(fontMedia, nome, centro),
    nome,
    hexParaJimp(corDoEmoji(item?.cor))
  )

  // Asterisco de quem saiu do grupo (explicado no rodapé).
  let fimNome = ROW_NOME_X + larguraNome + 6
  if (saiu) {
    escrever(imagem, fontPequena, fimNome, yParaCentrar(fontPequena, '*', centro - 2), '*', hexParaJimp(TINTA_SUAVE))
    fimNome += 14
  }

  // Total à direita, com o plural certo embaixo.
  const total = String(item?.total ?? 0)
  const palavra = String(item?.palavra || 'mensagens')
  const larguraTotal = Math.max(medir(fontMedia, total), medir(fontPequena, palavra))
  escreverDireita(imagem, fontMedia, ROW_X1, yParaCentrar(fontMedia, total, centro - 10), total, corTinta)
  escreverDireita(imagem, fontPequena, ROW_X1, yParaCentrar(fontPequena, palavra, centro + 12), palavra, hexParaJimp(TINTA_SUAVE))

  // Pontilhado de ligação entre o nome e o total.
  const corPonto = hexParaJimp(misturar(PERGAMINHO, TINTA_SUAVE, 0.6))
  for (let x = fimNome + 6; x + 5 <= ROW_X1 - larguraTotal - 14; x += 12) {
    pintarReto(imagem, x, centro + 13, 5, 2, corPonto)
  }
}

// ─── 📜 Rodapé ───
function desenharRodape (imagem, fontPequena, teveSaida, dataTexto) {
  const centro = LARG / 2
  pintarReto(imagem, ROW_X0, RODAPE_DIVISOR_Y, ROW_X1 - ROW_X0, 2, hexParaJimp(misturar(PERGAMINHO, OURO, 0.6)))
  if (teveSaida) {
    escreverCentrado(imagem, fontPequena, centro, RODAPE_NOTA_Y, limparParaFonte(fontPequena, NOTA_SAIU), hexParaJimp(TINTA_SUAVE))
  }
  escreverCentrado(imagem, fontPequena, centro, RODAPE_FRASE_Y, limparParaFonte(fontPequena, FRASE_FINAL), hexParaJimp(TINTA_SUAVE))
  escreverCentrado(imagem, fontPequena, centro, RODAPE_DATA_Y, limparParaFonte(fontPequena, dataTexto), hexParaJimp(OURO_ESCURO))
}

// Data/hora do rodapé, sempre no fuso do recinto (America/Sao_Paulo).
function dataDoPergaminho () {
  try {
    const agora = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date())
    return 'ATUALIZADO EM ' + agora.replace(', ', ' ÀS ').toUpperCase()
  } catch (e) {
    return 'ATUALIZADO AGORA'
  }
}

// ─── 🖼️ O pergaminho ───
// args = { itens: [{ nome, cor, total, palavra, saiu }], subtitulo }
// Devolve o PNG em Buffer. Problema aqui é ERRO: o comando trata e cai no
// texto, então nada de try/catch silencioso neste arquivo.
async function comporPergaminhoRanking (args) {
  const itens = (Array.isArray(args?.itens) ? args.itens : []).slice(0, 10)
  const fontMedia = await fontePergaminho(SANS_32_WHITE)
  const fontPequena = await fontePergaminho(SANS_16_WHITE)

  const imagem = new Jimp({ width: LARG, height: ALT, color: hexParaJimp(PERGAMINHO) })
  envelhecer(imagem)
  desenharRolo(imagem, ROLO_Y)
  desenharRolo(imagem, ALT - ROLO_Y - ROLO_ALT)
  desenharFriscoGrego(imagem, hexParaJimp(OURO))
  desenharCabecalho(imagem, fontMedia, fontPequena, args?.subtitulo)
  for (let i = 0; i < itens.length; i += 1) desenharLinha(imagem, fontMedia, fontPequena, i, itens[i])
  desenharRodape(imagem, fontPequena, itens.some((i) => i?.saiu === true), dataDoPergaminho())

  return imagem.getBuffer(JimpMime.png)
}

// 🖼️ Miniatura 64×64 em JPEG (preview do WhatsApp). Feita AQUI, no Jimp, para
// o Baileys não precisar chamar sharp/ffmpeg dentro do processo do bot.
async function miniaturaDoPergaminho (bufferPng) {
  const imagem = await Jimp.read(bufferPng)
  imagem.cover({ w: 64, h: 64 })
  const mini = await imagem.getBuffer(JimpMime.jpeg, { quality: 80 })
  return mini.toString('base64')
}

module.exports = {
  comporPergaminhoRanking,
  miniaturaDoPergaminho,
  __internos: {
    LARG, ALT, FRISCO, ROLO_ALT, ROLO_Y, ROLO_RAIO, ROLO_X0, ROLO_X1,
    ROW_INICIO, ROW_ALT, ROW_X0, ROW_X1, ROW_NOME_X, ROW_RESERVA_TOTAL,
    TITULO, SUBTITULO_PADRAO, FRASE_FINAL, NOTA_SAIU, SEMENTE,
    PERGAMINHO, PERGAMINHO_ZEBRA, OURO, OURO_CLARO, OURO_ESCURO, TINTA,
    TINTA_SUAVE, MEDALHA, MEDALHA_BORDA,
    limparParaFonte, tintaVertical, yParaCentrar, cortarParaCaber, glifos,
    medir, misturar, envelhecer, desenharFriscoGrego, desenharRolo,
    dataDoPergaminho
  }
}




