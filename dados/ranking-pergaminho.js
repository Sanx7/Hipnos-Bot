// ============================================================
// 🏛️ RANKING-PERGAMINHO — o quadro de honra do /ranking em imagem
// ============================================================
// Princípio o mesmo do /procurado (dados/cartaz-procurado.js): a ARTE É O
// ARQUIVO. Nada de moldura, rolo, frisco, guirlanda ou emblema desenhado por
// código — o quadro inteiro vem de UM asset versionado no repositório:
//
//     assets/quadros/ranking-pergaminho.png  (1024×1536)
//
// O que a imagem já traz: moldura grega, rolos dourados no topo e na base,
// o símbolo do templo no cabeçalho e as SETE posições do pódio (coroa +
// grinalda de louros + número de 1 a 7), cada uma com uma linha pontilhada
// pronta para receber o nome. Este módulo só escreve o TEXTO em cima:
//
//     nome na cor do `corVip` ....... alinhado à ESQUERDA do pontilhado
//     contagem de mensagens ......... alinhada à DIREITA, antes da estrelinha
//
// 🛟 Se o asset não estiver no disco (ou a arte falhar), `comporPergaminhoRanking`
// LANÇA: quem chama é o comando /ranking, que tem o fallback em texto. Nunca
// devolver uma imagem pela metade — ou o quadro inteiro, ou nenhum.
//
// ⚠️ As fontes bitmap do Jimp cobrem ASCII + Latin-1: acentos (á, ç, ã, ú, º)
// funcionam, mas emoji, grego, japonês etc. NÃO têm glifo. Por isso TODO texto
// passa por `limparParaFonte` e as medidas saem de `medir` (soma dos avanços
// dos glifos) — nada de caixinha quebrada e nada estourando a linha.
//
// 🖌️ O texto é pintado glifo a glifo usando o ALFA da textura como cobertura
// (o `print` do Jimp mistura o glifo branco com o fundo e o texto sairia
// lavado, sem a cor pedida).
// ============================================================

const fs = require('fs')
const path = require('path')
const { Jimp, JimpMime, loadFont } = require('jimp')
const { SANS_32_WHITE, SANS_64_WHITE } = require('jimp/fonts')
// 🎨 O emoji do /corvip traduzido em tinta (mesmo mapa do /procurado).
const { corDoEmoji, COR_PADRAO } = require('./cores-vip')

// 📂 Onde vive o quadro (arquivo versionado no repositório).
const CAMINHO_MOLDURA = path.join(__dirname, '..', 'assets', 'quadros', 'ranking-pergaminho.png')

// 📐 Tamanho do asset (o quadro sai com estas dimensões, sem redimensionar).
const LARG = 1024
const ALT = 1536

// -------------------------------------------------------------------
// 📐 CALIBRADO para assets/quadros/ranking-pergaminho.png (1024×1536).
// Medido no arquivo de verdade (varredura de linha e de coluna sobre os
// pixels escuros do quadro), não chutado:
//
//   • filete da 1ª linha: y 505..506  • 2ª: 639..640  • 3ª: 772..773
//     4ª: 900..901  • 5ª: 1032..1034  • 6ª: 1163..1164  • 7ª: 1295..1296
//     (o `y` de cada posição é o CENTRO do filete);
//   • o pontilhado começa em x=276 e corre até x≈840;
//   • o emblema (coroa + louros + número) ocupa x 100..283, y ±62 do filete
//     — por isso o nome começa em x=292, já fora da grinalda;
//   • a estrelinha decorativa fica em x≈853 (as medidas de `fim` aotriaram
//     ~840, e a estrela começa logo depois) — por isso a contagem termina em
//     838 e nunca invade a estrela.
//
// ⚠️ RECALIBRAR se a imagem for trocada: as sete posições são a única coisa
// que este módulo precisa conferir no arquivo novo.
// -------------------------------------------------------------------
const POSICOES_RANKING = [
  { y: 505 },  // 1º lugar
  { y: 639 },  // 2º
  { y: 772 },  // 3º
  { y: 900 },  // 4º
  { y: 1032 }, // 5º
  { y: 1163 }, // 6º
  { y: 1295 }  // 7º
]

// ✍️ Colunas de TEXTO dentro do pontilhado.
// O nome começa em x=292 (à esquerda do pontilhado, que nasce em 276) e a
// contagem TERMINA em 832, antes da estrelinha (que começa em ~845). A
// largura do nome é DINÂMICA: ele só pode ir até `CONTAGEM_X1 - FOLGA -
// larguraDaContagem`, então um total de 3 dígitos deixa o nome mais largo do
// que um total de 7 — e nenhum dos dois nunca invade a coluna vizinha.
const NOME_X0 = 292
const CONTAGEM_X1 = 832
const FOLGA = 28

// 🖋️ Onde a tinta do nome ASSENTA no filete. 0 = a linha atravessa o meio do
// texto (letra pequena fica "riscada"); 1 = a BASE da tinta pousa 3 px acima
// do filete, como quem escreve numa linha de caderno. Medido na amostra: 1
// lê melhor nas duas menores, e o grande continua apoiado na linha.
const ASSENTA_ACIMA = 1
const RESPIRO_FILLETE = 3

// 🪜 Escada do NOME: as FONTES, da MAIOR para a menor (`escolher` recebe as
// fontes já carregadas — ver `comporPergaminhoRanking`). O MAIOR que couber
// inteiro vence; só corta com "..." se nenhum couber (e mesmo assim deixando
// MIN_VISIVEL_NOME letras visíveis).
const ESCADARIA_NOME = [SANS_64_WHITE, SANS_32_WHITE]
const MIN_VISIVEL_NOME = 12

// 🏛️ Cabeçalho (nome do grupo) na faixa vazia entre o templo e a 1ª linha.
// A faixa livre vai de y≈270 a y≈440; o emblema da 1ª posição começa em 443.
const SUBTITULO_Y = 365
const SUBTITULO_LARGURA = 560
const ESCADARIA_SUBTITULO = [SANS_64_WHITE, SANS_32_WHITE]

// 📜 Rodapé: a nota de quem saiu do grupo (o único aviso que sobra no quadro).
// Faixa livre entre o 7º filete (1296) e o rolo dourado da base (~1408).
const RODAPE_NOTA_Y = 1345
const NOTA_SAIU = '* saiu do grupo'

// 🎨 Tintas do texto. TINTA é o mesmo marrom do cartaz do /procurado;
// TINTA_SUAVE é a versão apagada (legível, mas sem competir com o nome).
const TINTA = '#2b1d10'
const TINTA_SUAVE = '#5c452c'

// 🪵 O pergaminho DESTE asset é bem mais escuro que o do cartaz
// (rgb ~208,179,133): várias cores do /corvip ficariam com contraste baixo
// aqui (o 🟡 dourado ficava em 2:1). Por isso toda cor de nome passa por
// `escurecerParaContraste`, que escurece em degraus até bater o mínimo — o
// nome continua sendo "a cor do VIP", só que legível no papel de verdade.
const FUNDO_PARAGRAMENTO = [208, 179, 133]
const CONTRASTE_MINIMO = 4.5

// ─── ✍️ Texto: as mesmas réguas do cartaz do /procurado ───

// Cache id→glifo de cada fonte (as chaves de `font.chars` são índices, não
// codepoints — o `id` de cada glifo é que é o codepoint de verdade).
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

// loadFont lê o .fnt do disco: carrega uma vez só por fonte.
async function fonte (qual) {
  if (!CACHE_FONTES.has(qual)) CACHE_FONTES.set(qual, await loadFont(qual))
  return CACHE_FONTES.get(qual)
}

// Troca por espaço o que a fonte NÃO sabe desenhar (emoji, grego, japonês…)
// e junta os espaços que sobram: o texto sempre termina desenhável e medível.
function limparParaFonte (font, texto) {
  const mapa = glifos(font)
  let saida = ''
  for (const ch of String(texto ?? '')) saida += mapa.has(ch.codePointAt(0)) ? ch : ' '
  return saida.replace(/\s+/g, ' ').trim()
}

// Largura do texto = soma dos avanços dos glifos. É a MESMA conta que o
// desenhador faz, então alinhamento e medida nunca brigam.
function medir (font, texto) {
  const mapa = glifos(font)
  let largura = 0
  for (const ch of String(texto ?? '')) {
    const glifo = mapa.get(ch.codePointAt(0))
    if (glifo) largura += glifo.xadvance
  }
  return largura
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

// `y` que APOIA a base da tinta RESPIRO_FILLETE acima de `filete` — o texto
// fica POUSADO na linha pontilhada em vez de ser atravessado por ela (quem
// escreve senta a base na linha, não o meio das letras).
function yParaAssentar (font, texto, filete) {
  if (!ASSENTA_ACIMA) return yParaCentrar(font, texto, filete)
  const { base } = tintaVertical(font, texto)
  return Math.round(filete - base - RESPIRO_FILLETE)
}

// Corta com "..." até caber em `larguraMax` — nunca estoura a linha.
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

// ─── 🪜 escolher(candidatos, texto, larguraMax) ───
// `candidatos` vem do MAIOR para o menor (as fontes da escada):
//   1) 1ª passada: o MAIOR que couber INTEIRO vence — mesmo que desça um
//      degrau, o nome inteiro é mais útil que meia palavra gigante;
//   2) 2ª passada (só se ninguém coube inteiro): vale o MAIOR que ainda
//      MOSTRA `minimoVisivel` letras cortadas — "Ana Beatriz Cavalc..."
//      numa letra grande é melhor do que o nome todo numa letra ilegível;
//   3) nem isso? fica o maior cortado (plano B), sempre dentro da largura.
function escolher (candidatos, texto, larguraMax, minimoVisivel = MIN_VISIVEL_NOME) {
  const limpo = String(texto ?? '')
  if (!limpo) return null

  for (const cand of candidatos) {
    if (medir(cand, limpo) <= larguraMax) return { font: cand, texto: limpo, cortado: false }
  }

  let reserva = null
  for (const cand of candidatos) {
    const cortado = cortarParaCaber(cand, limpo, larguraMax)
    const visiveis = cortado.replace(/\.{3}$/, '').length
    if (!reserva) reserva = { font: cand, texto: cortado, cortado: true }
    if (visiveis >= minimoVisivel) return { font: cand, texto: cortado, cortado: true }
  }
  return reserva
}

// ─── 🎨 Cor ───

// "#rrggbb" → [r, g, b]. Só o hexadecimal é usado aqui (as paletas do
// projeto são todas hex), então a conversão é simples e previsível.
function canais (cor) {
  const limpo = String(cor || '').replace('#', '')
  return [
    parseInt(limpo.slice(0, 2), 16) || 0,
    parseInt(limpo.slice(2, 4), 16) || 0,
    parseInt(limpo.slice(4, 6), 16) || 0
  ]
}

function paraHex ([r, g, b]) {
  const parte = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${parte(r)}${parte(g)}${parte(b)}`
}

// Luminância WCAG (para saber se a tinta "lê" no pergaminho).
function luminancia ([r, g, b]) {
  const canal = (v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
}

// Razão de contraste entre duas cores (1 = invisível, 21 = máximo).
function contraste (a, b) {
  const la = luminancia(a)
  const lb = luminancia(b)
  const clara = Math.max(la, lb)
  const escura = Math.min(la, lb)
  return (clara + 0.05) / (escura + 0.05)
}

// Escurece a cor em degraus de 6% até ela atingir o contraste mínimo contra
// o pergaminho. O HUE não muda (multiplicar os três canais por um mesmo fator
// preserva a cor, só leva a tinta para o escuro) — o nome continua sendo a
// cor do VIP, só que legível no papel deste quadro.
function escurecerParaContraste (cor, minimo = CONTRASTE_MINIMO, fundo = FUNDO_PARAGRAMENTO) {
  let rgb = canais(cor)
  let guarda = 0
  while (contraste(rgb, fundo) < minimo && guarda < 40) {
    rgb = rgb.map((c) => c * 0.94)
    guarda += 1
  }
  return paraHex(rgb)
}

// ─── 🖌️ Desenho do texto ───
// ⚠️⚠️ ESTA VERSÃO DO JIMP TEM `setPixelColor` COM DESLOCAMENTO DE CANAL (grava
// [A, R, G, B] em vez de [R, G, B, A]). O `getPixelColor` desmente de volta, e
// por isso o par get/set passa despercebido — mas qualquer escrita DIRETA no
// `bitmap.data` (que é [R, G, B, A]) bate com o setPixelColor e TROCA os
// canais. Foi isso que pintou o cartaz do /procurado de vermelho. Por isso
// NENHUMA cor é passada ao setPixelColor aqui: escrevemos sempre no data.
function pintarPixel (imagem, x, y, r, g, b) {
  const { width, height, data } = imagem.bitmap
  if (x < 0 || y < 0 || x >= width || y >= height) return
  const k = (y * width + x) * 4
  data[k] = r
  data[k + 1] = g
  data[k + 2] = b
  data[k + 3] = 255
}

// Escreve o texto NA COR pedida misturando cada pixel do glifo com o fundo pelo
// alfa da textura da fonte. Devolve a largura usada (igual ao `medir`).
function escrever (imagem, font, x, y, texto, cor) {
  const limpo = String(texto ?? '')
  if (!limpo) return 0
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
        const px = Math.round(x + avanco + glifo.xoffset + gx)
        const py = Math.round(y + glifo.yoffset + gy)
        if (px < 0 || py < 0 || px >= width || py >= height) continue
        const k = (py * width + px) * 4
        pintarPixel(
          imagem,
          px,
          py,
          Math.round(data[k] + (r - data[k]) * cobertura),
          Math.round(data[k + 1] + (g - data[k + 1]) * cobertura),
          Math.round(data[k + 2] + (b - data[k + 2]) * cobertura)
        )
      }
    }
    avanco += glifo.xadvance
  }
  return avanco
}

// ✍️ Alinhado à DIREITA (o texto TERMINA em `fim`) — é assim que a contagem
// fica "colada" na estrelinha, do outro lado da linha pontilhada.
function escreverDireita (imagem, font, fim, y, texto, cor) {
  const limpo = String(texto ?? '')
  if (!limpo) return 0
  return escrever(imagem, font, Math.round(fim - medir(font, limpo)), y, limpo, cor)
}

// ✍️ Centralizado no eixo X (centro dado) — só o subtítulo do cabeçalho usa.
function escreverCentrado (imagem, font, centro, y, texto, cor) {
  const limpo = String(texto ?? '')
  if (!limpo) return 0
  return escrever(imagem, font, Math.round(centro - medir(font, limpo) / 2), y, limpo, cor)
}

// ─── 📜 Uma posição do pódio ───
// `item` = { nome, cor (emoji do corVip), total, saiu }. A posição (1..7), a
// coroa, a grinalda de louros e a linha pontilhada JÁ estão no asset — aqui só
// entra o texto, apoiado no filete (como quem escreve numa linha de caderno).
// `fontes` = { escadaNome: [font64, font32], contagem: font32 }.
function desenharLinha (imagem, fontes, item, posicao) {
  if (!item) return
  const centro = posicao.y

  // 📊 Contagem: fonte pequena, alinhada à direita e terminada ANTES da
  // estrelinha. Sai sempre em tinta — aqui o número não compete com o nome,
  // é só o dado de apoio. A largura da contagem é medida ANTES do nome
  // porque é ela que diz até onde o nome pode ir.
  const total = Math.max(0, Number(item.total) || 0)
  const totalTexto = String(total)
  const larguraContagem = medir(fontes.contagem, totalTexto)
  const larguraNomeMax = CONTAGEM_X1 - FOLGA - larguraContagem - NOME_X0

  // 🎨 Nome: o maior que couber INTEIRO na metade esquerda do pontilhado.
  const bruto = String(item.nome ?? '').trim()
  if (bruto && larguraNomeMax > 0) {
    const escolha = escolher(fontes.escadaNome, bruto, larguraNomeMax)
    if (escolha) {
      // A cor do VIP entra escurecida até bater o contraste do pergaminho real
      // (ver `escurecerParaContraste`); sem cor, é a tinta padrão do quadro.
      const corBase = item.cor ? corDoEmoji(item.cor) : COR_PADRAO
      escrever(
        imagem,
        escolha.font,
        NOME_X0,
        yParaAssentar(escolha.font, escolha.texto, centro),
        escolha.texto,
        escurecerParaContraste(corBase)
      )
    }
  }

  escreverDireita(
    imagem,
    fontes.contagem,
    CONTAGEM_X1,
    yParaAssentar(fontes.contagem, totalTexto, centro),
    totalTexto,
    TINTA
  )
}

// 🏛️ Cabeçalho: o nome do grupo na faixa vazia entre o templo e o 1º emblema.
// Sem nome de grupo (sem metadados) não se escreve nada — o quadro continua
// parecendo um quadro, não um erro.
function desenharSubtitulo (imagem, fontes, subtitulo) {
  const bruto = String(subtitulo ?? '').trim()
  if (!bruto) return
  const escolha = escolher(fontes.escadaSubtitulo, bruto, SUBTITULO_LARGURA)
  if (!escolha) return
  escreverCentrado(
    imagem,
    escolha.font,
    LARG / 2,
    yParaCentrar(escolha.font, escolha.texto, SUBTITULO_Y),
    escolha.texto,
    TINTA_SUAVE
  )
}

// 📜 Rodapé: a legenda de quem saiu do grupo, numa vez só (não uma por linha).
function desenharRodape (imagem, fontes, teveSaida) {
  if (!teveSaida) return
  escreverCentrado(
    imagem,
    fontes.contagem,
    LARG / 2,
    yParaCentrar(fontes.contagem, NOTA_SAIU, RODAPE_NOTA_Y),
    NOTA_SAIU,
    TINTA_SUAVE
  )
}

// ─── 🖼️ O quadro ───
// itens = [{ nome, cor, total, saiu }] — no máximo as 7 posições do asset.
// Devolve o PNG em Buffer. Problema aqui é ERRO: o comando trata e cai no
// texto, então nada de try/catch silencioso neste arquivo.
async function comporPergaminhoRanking (args) {
  // 🖼️ O quadro tem que estar no disco (é versionado no repositório).
  if (!fs.existsSync(CAMINHO_MOLDURA)) {
    throw new Error('quadro do ranking não encontrado: ' + CAMINHO_MOLDURA)
  }
  const imagem = await Jimp.read(CAMINHO_MOLDURA)
  if (imagem.bitmap.width !== LARG || imagem.bitmap.height !== ALT) {
    throw new Error(
      `quadro do ranking com tamanho inesperado: ${imagem.bitmap.width}x${imagem.bitmap.height}`
    )
  }

  // As fontes da escada são carregadas uma vez e guardadas no `fontes`.
  const fontes = {
    escadaNome: await Promise.all(ESCADARIA_NOME.map((q) => fonte(q))),
    escadaSubtitulo: await Promise.all(ESCADARIA_SUBTITULO.map((q) => fonte(q))),
    contagem: await fonte(SANS_32_WHITE)
  }

  const itens = (Array.isArray(args?.itens) ? args.itens : []).slice(0, POSICOES_RANKING.length)
  desenharSubtitulo(imagem, fontes, args?.subtitulo)
  for (let i = 0; i < itens.length; i += 1) {
    desenharLinha(imagem, fontes, itens[i], POSICOES_RANKING[i])
  }
  desenharRodape(imagem, fontes, itens.some((item) => item?.saiu === true))

  return imagem.getBuffer(JimpMime.png)
}

// 🖼️ Miniatura 64×64 em JPEG (preview do WhatsApp) — feita no Jimp para a
// Baileys não precisar chamar sharp/ffmpeg dentro do processo do bot.
async function miniaturaDoPergaminho (bufferPng) {
  const imagem = await Jimp.read(bufferPng)
  imagem.cover({ w: 64, h: 64 })
  const mini = await imagem.getBuffer(JimpMime.jpeg, { quality: 80 })
  return mini.toString('base64')
}

module.exports = {
  CAMINHO_MOLDURA,
  LARG,
  ALT,
  POSICOES_RANKING,
  comporPergaminhoRanking,
  miniaturaDoPergaminho,
  __internos: {
    NOME_X0,
    CONTAGEM_X1,
    FOLGA,
    ASSENTA_ACIMA,
    RESPIRO_FILLETE,
    ESCADARIA_NOME,
    ESCADARIA_SUBTITULO,
    MIN_VISIVEL_NOME,
    SUBTITULO_Y,
    SUBTITULO_LARGURA,
    RODAPE_NOTA_Y,
    NOTA_SAIU,
    TINTA,
    TINTA_SUAVE,
    FUNDO_PARAGRAMENTO,
    CONTRASTE_MINIMO,
    limparParaFonte,
    medir,
    tintaVertical,
    yParaCentrar,
    yParaAssentar,
    cortarParaCaber,
    escolher,
    canais,
    paraHex,
    luminancia,
    contraste,
    escurecerParaContraste,
    escrever,
    escreverDireita,
    escreverCentrado,
    desenharLinha,
    desenharSubtitulo,
    desenharRodape
  }
}