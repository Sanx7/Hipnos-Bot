// ============================================
// 🟩 BRAT (/brat) e BRATVID (/bratvid) — Capa estilo "Brat"
// ============================================
// Gera a capa estilo "Brat" (álbum da Charli XCX): fundo verde #8ACE00
// com texto em minúsculas, branco, bold e sans-serif — e envia como
// FIGURINHA (sock.sendMessage com sticker), como pede o meme.
//   /brat oi mundo     → versão ESTÁTICA (PNG → figurinha);
//   /bratvid oi mundo  → versão ANIMADA (as palavras aparecem aos poucos
//                        com tremida sutil → webp animado).
//
// ⚠️ POR QUE NÃO USA A API brat.caliphdev.com? TESTADO em 17/09/2026
// (DNS + HTTP + Wayback): o subdomínio não existe mais (SOA/NXDOMAIN).
// Como era um serviço de terceiro não-oficial e está fora, seguimos o
// MESMO padrão do /attp: pipeline 100% self-hosted (node-canvas + ffmpeg
// EMBUTIDO do projeto + wa-sticker-formatter) — sem key, sem rede e o
// texto do usuário não vaza para nenhum serviço externo.
// Uso LIVRE: qualquer pessoa pode chamar /brat e /bratvid.
// ============================================

const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCanvas } = require('canvas')
const { Sticker, StickerTypes } = require('wa-sticker-formatter')

// ─── Estilo visual "Brat" ───
const LADO = 512
const MARGEM = 44
const COR_FUNDO = '#8ACE00'          // o verde do álbum
const COR_TEXTO = '#FFFFFF'
const LIMITE_CARACTERES = 60
const FONTE_PILHA = '"Arial", "DejaVu Sans", "Helvetica", sans-serif'

// ─── Parâmetros do vídeo (mesma régua do /attp) ───
const FPS = 8
const FRAMES = 16
const TREMIDA_MAX_PX = 2

// ─── ffmpeg: binário embutido (igual ao /attp, /togif e /tomp4) ───
function caminhoFfmpeg() {
  try {
    return require('@ffmpeg-installer/ffmpeg').path
  } catch (err) {
    return 'ffmpeg'
  }
}

// ─── ✂️ Extrai o texto depois do comando ("/brat oi" → "oi") ───
function extrairTexto(texto) {
  return String(texto || '').split(' ').slice(1).join(' ').trim()
}

// ─── 🔤 Quebra o texto em linhas que caibam na largura útil ───
function quebrarLinhas(ctx, texto, tamanhoFonte, larguraMaxima) {
  ctx.font = `bold ${tamanhoFonte}px ${FONTE_PILHA}`
  const palavras = texto.split(/\s+/).filter(Boolean)
  const linhas = []
  let linhaAtual = ''
  for (const palavra of palavras) {
    const tentativa = linhaAtual ? `${linhaAtual} ${palavra}` : palavra
    if (ctx.measureText(tentativa).width <= larguraMaxima || !linhaAtual) {
      linhaAtual = tentativa
    } else {
      linhas.push(linhaAtual)
      linhaAtual = palavra
    }
  }
  if (linhaAtual) linhas.push(linhaAtual)
  return linhas
}

// ─── 📐 Auto-ajuste da fonte até o bloco caber (largura E altura) ───
function calcularLayout(ctx, texto) {
  const larguraUtil = LADO - MARGEM * 2
  let tamanhoFonte = 110
  let linhas = []
  for (;;) {
    linhas = quebrarLinhas(ctx, texto, tamanhoFonte, larguraUtil)
    ctx.font = `bold ${tamanhoFonte}px ${FONTE_PILHA}`
    const estouraLargura = linhas.some(l => ctx.measureText(l).width > larguraUtil)
    const alturaBloco = linhas.length * tamanhoFonte * 1.06
    if (tamanhoFonte <= 28 || (!estouraLargura && alturaBloco <= LADO - MARGEM * 2)) break
    tamanhoFonte -= 4
  }
  return { tamanhoFonte, linhas }
}

// ─── 🟩 Desenha UM quadro (tremida opcional p/ o vídeo) ───
function desenharQuadro(ctx, layout, deslocamento) {
  const { tamanhoFonte, linhas } = layout
  const entrelinha = tamanhoFonte * 1.06

  ctx.save()
  ctx.fillStyle = COR_FUNDO
  ctx.fillRect(0, 0, LADO, LADO)
  if (deslocamento) ctx.translate(deslocamento.x, deslocamento.y)

  ctx.fillStyle = COR_TEXTO
  ctx.font = `bold ${tamanhoFonte}px ${FONTE_PILHA}`
  ctx.textBaseline = 'middle'

  // Alinhamento à ESQUERDA e no topo — assinatura visual da capa
  const alturaTotal = (linhas.length - 1) * entrelinha + tamanhoFonte * 0.72
  const topo = (LADO - alturaTotal) / 2 + tamanhoFonte * 0.36
  linhas.forEach((linha, indice) => {
    ctx.fillText(linha, MARGEM, topo + indice * entrelinha)
  })
  ctx.restore()
}
// ─── 🖼️ Capa ESTÁTICA em PNG (Buffer) ───
function gerarPng(texto) {
  const canvas = createCanvas(LADO, LADO)
  const ctx = canvas.getContext('2d')
  const layout = calcularLayout(ctx, texto)
  desenharQuadro(ctx, layout, null)
  return canvas.toBuffer('image/png')
}

// ─── 🎬 Frames do vídeo: palavras surgem em degraus + tremida sutil ───
function gerarFrames(pastaFrames, texto) {
  const canvas = createCanvas(LADO, LADO)
  const ctx = canvas.getContext('2d')
  const layout = calcularLayout(ctx, texto)
  const palavras = texto.split(/\s+/).filter(Boolean)
  const degraus = Math.max(palavras.length, 1)
  for (let indice = 0; indice < FRAMES; indice += 1) {
    const visiveis = Math.max(1, Math.ceil((indice / FRAMES) * degraus))
    const parcial = palavras.slice(0, visiveis).join(' ')
    const layoutParcial = parcial === texto ? layout : calcularLayout(ctx, parcial)
    const deslocamento = parcial === texto
      ? { x: indice % 2 === 0 ? TREMIDA_MAX_PX : -TREMIDA_MAX_PX, y: 0 }
      : null
    desenharQuadro(ctx, layoutParcial, deslocamento)
    const caminho = path.join(pastaFrames, `frame_${String(indice).padStart(3, '0')}.png`)
    fs.writeFileSync(caminho, canvas.toBuffer('image/png'))
  }
}

// ─── 🎞️ Webp animado (mesmo comando ffmpeg do /attp) ───
function montarWebpAnimado(pastaFrames) {
  return new Promise((resolver, rejeitar) => {
    const entrada = path.join(pastaFrames, 'frame_%03d.png')
    const saida = path.join(pastaFrames, 'brat.webp')
    execFile(
      caminhoFfmpeg(),
      ['-y', '-framerate', String(FPS), '-i', entrada,
       '-c:v', 'libwebp', '-lossless', '0', '-q:v', '80', '-loop', '0', '-an', saida],
      { windowsHide: true, timeout: 45000 },
      (erro) => (erro ? rejeitar(erro) : resolver(saida))
    )
  })
}

// ─── 📦 Empacota (PNG ou webp) como figurinha FULL ───
async function empacotarSticker(buffer, id) {
  const sticker = new Sticker(buffer, {
    pack: 'Hipnos Bot',
    author: 'Sombras do Limbo',
    type: StickerTypes.FULL,
    categories: ['🟩'],
    id,
    quality: 100
  })
  return sticker.toBuffer()
}

// ─── 📨 Fábrica: mesmo núcleo p/ /brat (estático) e /bratvid (animado) ───
function criarComando({ nome, animado, id }) {
  return {
    nome,
    descricao: animado
      ? 'Gera uma figurinha ANIMADA estilo "Brat" (álbum da Charli XCX) com o seu texto (ex: /bratvid oi mundo).'
      : 'Gera uma figurinha estilo "Brat" (álbum da Charli XCX) com o seu texto (ex: /brat oi mundo).',

    async executar(sock, jid, msg, texto) {
      try {
        // 1) Valida o texto do usuário
        const corpo = extrairTexto(texto)
        if (!corpo) {
          return await sock.sendMessage(jid, {
            text: '🟩 *Você precisa me dizer o que escrever na capa...*\n\n' +
              `Use: */${nome} <texto>*\n` +
              `Exemplo: */${nome} hipnos bot*`
          }, { quoted: msg })
        }

        // 2) Trunca textos longos (a figurinha precisa continuar legível)
        const textoFinal = corpo.length > LIMITE_CARACTERES
          ? `${corpo.slice(0, LIMITE_CARACTERES).trim()}...`
          : corpo

        // 3) Gera a arte: 1 PNG (estático) ou N frames → webp (animado)
        let bufferArte
        if (animado) {
          const pastaFrames = fs.mkdtempSync(path.join(os.tmpdir(), 'brat-'))
          try {
            gerarFrames(pastaFrames, textoFinal)
            const caminhoWebp = await montarWebpAnimado(pastaFrames)
            bufferArte = fs.readFileSync(caminhoWebp)
          } finally {
            try { fs.rmSync(pastaFrames, { recursive: true, force: true }) } catch (e) { /* já limpo */ }
          }
        } else {
          bufferArte = gerarPng(textoFinal)
        }

        // 4) Empacota como figurinha e envia
        const stickerBuffer = await empacotarSticker(bufferArte, id)
        await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg })
      } catch (err) {
        if (String(err?.message || '').includes("Cannot find module 'canvas'")) {
          return await sock.sendMessage(jid, {
            text: '⚠️ O /' + nome + ' precisa do pacote *canvas* neste servidor (npm install canvas). Peça ao dono do bot para instalá-lo.'
          }, { quoted: msg })
        }
        console.error(`[${nome}] Erro ao gerar a capa estilo brat:`, err?.message || err)
        await sock.sendMessage(jid, {
          text: '⛔ O estúdio das sombras apagou a capa... Tente novamente em instantes.'
        }, { quoted: msg }).catch(() => {})
      }
    }
  }
}

// 📦 O loader do bot.js aceita ARRAY: um arquivo, dois comandos.
module.exports = [
  criarComando({ nome: 'brat', animado: false, id: 'hipnos_brat' }),
  criarComando({ nome: 'bratvid', animado: true, id: 'hipnos_bratvid' })
]

