// ============================================
// 🎨 ATTP — Animated Text To (Sticker) Png
// ============================================
// Gera uma FIGURINHA ANIMADA (webp animado) a partir de um texto:
//   /attp Oi mundo
// Animação: zoom pulsante + leve rotação + cor pulsante por frame.
//
// Pipeline 100% self-hosted (sem APIs públicas — o texto do usuário
// não vaza para serviços externos):
//   1. opentype.js parseia a fonte embutida (assets/fonts/LuckiestGuy-
//      Regular.ttf) e entrega os CONTORNOS DOS GLIFOS como comandos de path
//      — NÃO usamos registerFont/GlobalFonts nem ctx.font: no canvas v3
//      (backend Pango) o registro de fontes customizadas falha
//      silenciosamente ("falling back to Sans"), então desenhamos a
//      geometria dos glifos DIRETO no contexto (moveTo/quadraticCurveTo/...),
//      o que é 100% determinístico em qualquer sistema;
//   2. node-canvas (canvas) renderiza N frames PNG 512x512 com zoom +
//      rotação + cor pulsante;
//   3. o ffmpeg JÁ EMBUTIDO no projeto (@ffmpeg-installer/ffmpeg, o mesmo
//      usado pelo /togif, /tomp4 e /revelar) monta o webp animado
//      (encoder libwebp + muxer webp — libwebp_anim não existe no build
//      embutido; o MUXER webp gera a animação/loop igualmente);
//   4. wa-sticker-formatter empacota com os mesmos metadados do /s
//      (pacote "Hipnos Bot", autor "Sombras do Limbo", tipo FULL —
//      preserva a animação).
// Depende de: npm install canvas opentype.js (ambos puros/sem compilação
// manual — binários pré-compilados existem para Windows e Linux x64).
// Uso LIVRE: qualquer pessoa pode chamar /attp.
// ============================================

const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCanvas } = require('canvas')
const opentype = require('opentype.js')
const { Sticker, StickerTypes } = require('wa-sticker-formatter')

// ─── Fonte embutida (determinística em qualquer servidor) ───
const CAMINHO_FONTE = path.join(__dirname, '..', '..', 'assets', 'fonts', 'LuckiestGuy-Regular.ttf')
let fonteAttp = null
try {
  if (fs.existsSync(CAMINHO_FONTE)) {
    const bruto = fs.readFileSync(CAMINHO_FONTE)
    fonteAttp = opentype.parse(bruto.buffer.slice(bruto.byteOffset, bruto.byteOffset + bruto.byteLength))
  }
} catch (err) {
  console.error('[attp] Falha ao carregar a fonte:', err?.message || err)
}

// ─── Parâmetros da animação ───
const LARGURA = 512
const ALTURA = 512
const FPS = 10           // quadros por segundo
const FRAMES = 20        // 2 segundos de loop
const CORES = ['#ff4757', '#ff6b81', '#ffa502', '#f9ca24', '#2ed573', '#18dcff', '#a55eea', '#ff7f50']
const COR_FUNDO = '#141428'
const LIMITE_CARACTERES = 50

// ─── ffmpeg: usa o binário EMBUTIDO (@ffmpeg-installer/ffmpeg); se faltar, cai para o 'ffmpeg' do PATH ───
function caminhoFfmpeg() {
  try {
    return require('@ffmpeg-installer/ffmpeg').path
  } catch (err) {
    return 'ffmpeg'
  }
}

// ─── Quebra o texto em linhas que caibam na largura útil (via advance da fonte) ───
function quebrarEmLinhas(texto, tamanhoFonte, larguraMaxima) {
  const palavras = texto.split(/\s+/).filter(Boolean)
  const linhas = []
  let linhaAtual = ''

  for (const palavra of palavras) {
    const tentativa = linhaAtual ? `${linhaAtual} ${palavra}` : palavra
    if (fonteAttp.getAdvanceWidth(tentativa, tamanhoFonte) <= larguraMaxima || !linhaAtual) {
      linhaAtual = tentativa
    } else {
      linhas.push(linhaAtual)
      linhaAtual = palavra
    }
  }
  if (linhaAtual) linhas.push(linhaAtual)
  return linhas
}

// ─── Desenha os contornos dos glifos (opentype.js) direto no contexto ───
function desenharContornos(ctx, comandos) {
  ctx.beginPath()
  for (const cmd of comandos) {
    if (cmd.type === 'M') ctx.moveTo(cmd.x, cmd.y)
    else if (cmd.type === 'L') ctx.lineTo(cmd.x, cmd.y)
    else if (cmd.type === 'Q') ctx.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y)
    else if (cmd.type === 'C') ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y)
    else if (cmd.type === 'Z') ctx.closePath()
  }
}

// ─── Desenha UM frame da animação (zoom + rotação + cor pulsante) ───
function renderizarFrame(canvas, ctx, texto, indiceFrame) {
  const t = indiceFrame / FRAMES                     // 0 → 1 no loop
  const angulo = Math.sin(t * Math.PI * 2) * (Math.PI / 16)   // ±11,25°
  const escala = 1 + Math.sin(t * Math.PI * 2) * 0.08         // ±8% de zoom
  const cor = CORES[indiceFrame % CORES.length]

  ctx.save()
  ctx.fillStyle = COR_FUNDO
  ctx.fillRect(0, 0, LARGURA, ALTURA)

  // Auto-ajuste: começa grande e reduz até o texto caber (largura E altura)
  let tamanhoFonte = 96
  let linhas = []
  const larguraUtil = LARGURA - 60
  for (;;) {
    linhas = quebrarEmLinhas(texto, tamanhoFonte, larguraUtil)
    const alturaTexto = linhas.length * tamanhoFonte * 1.12
    if (tamanhoFonte <= 30 || alturaTexto <= ALTURA - 80) break
    tamanhoFonte -= 6
  }

  const entrelinha = tamanhoFonte * 1.12
  const alturaBloco = linhas.length * entrelinha
  const primeiraBase = -alturaBloco / 2 + tamanhoFonte * 0.85

  ctx.translate(LARGURA / 2, ALTURA / 2)
  ctx.rotate(angulo)
  ctx.scale(escala, escala)
  ctx.lineJoin = 'round'

  // Contorno preto grosso (antes do preenchimento — estilo clássico ATTP)
  ctx.lineWidth = Math.max(6, tamanhoFonte / 9)
  ctx.strokeStyle = '#000000'
  ctx.fillStyle = cor

  linhas.forEach((linha, indiceLinha) => {
    const avanco = fonteAttp.getAdvanceWidth(linha, tamanhoFonte)
    const caminho = fonteAttp.getPath(
      linha,
      -avanco / 2,
      primeiraBase + indiceLinha * entrelinha,
      tamanhoFonte
    )
    desenharContornos(ctx, caminho.commands)
    ctx.stroke()
    ctx.fill()
  })

  ctx.restore()
}

// ─── Monta o webp animado a partir dos frames PNG com o ffmpeg embutido ───
function montarWebpAnimado(pastaFrames) {
  return new Promise((resolver, rejeitar) => {
    const padraoEntrada = path.join(pastaFrames, 'frame_%03d.png')
    const saida = path.join(pastaFrames, 'attp.webp')

    execFile(
      caminhoFfmpeg(),
      [
        '-y',
        '-framerate', String(FPS),
        '-i', padraoEntrada,
        '-c:v', 'libwebp',
        '-lossless', '0',
        '-q:v', '80',
        '-loop', '0',          // loop infinito
        '-an',
        saida
      ],
      { windowsHide: true, timeout: 45000 },
      (erro) => (erro ? rejeitar(erro) : resolver(saida))
    )
  })
}

module.exports = {
  nome: 'attp',
  descricao: 'Gera uma figurinha ANIMADA com o texto que você enviar (ex: /attp Oi mundo).',

  async executar(sock, jid, msg, texto) {
    try {
      // O roteador entrega o texto COM o prefixo (ex: "/attp Oi mundo") —
      // descarta o 1º token (o próprio comando) e junta o resto.
      const corpo = String(texto || '')
        .split(' ')
        .slice(1)
        .join(' ')
        .trim()

      // 1) Sem texto? Pede para o usuário informar.
      if (!corpo) {
        return await sock.sendMessage(jid, {
          text:
            '🕯️ *Você precisa me dizer o que escrever no pó da roleta...*\n\n' +
            'Use: */attp <texto>*\n' +
            'Exemplo: */attp Oi mundo*'
        }, { quoted: msg })
      }

      // 2) Trunca textos longos (figurinha precisa continuar legível)
      const textoFinal =
        corpo.length > LIMITE_CARACTERES
          ? `${corpo.slice(0, LIMITE_CARACTERES)}...`
          : corpo

      await sock.sendMessage(jid, {
        text: '⏳ Tecendo o texto nas sombras... Sua figurinha animada está a caminho.'
      }, { quoted: msg })

      // 3) Pasta temporária exclusiva desta execução (limpa no finally)
      const pastaFrames = fs.mkdtempSync(path.join(os.tmpdir(), 'attp-'))

      try {
        if (!fonteAttp) {
          return await sock.sendMessage(jid, {
            text: '⚠️ A fonte das sombras não foi encontrada neste servidor (assets/fonts/LuckiestGuy-Regular.ttf). O /attp está temporariamente adormecido.'
          }, { quoted: msg })
        }

        // 4) Renderiza os frames com node-canvas
        const canvas = createCanvas(LARGURA, ALTURA)
        const ctx = canvas.getContext('2d')

        for (let indice = 0; indice < FRAMES; indice += 1) {
          renderizarFrame(canvas, ctx, textoFinal, indice)
          const caminhoPng = path.join(pastaFrames, `frame_${String(indice).padStart(3, '0')}.png`)
          fs.writeFileSync(caminhoPng, canvas.toBuffer('image/png'))
        }

        // 5) Monta o webp animado com o ffmpeg embutido
        const caminhoWebp = await montarWebpAnimado(pastaFrames)
        const webpBuffer = fs.readFileSync(caminhoWebp)

        // 6) Empacota como figurinha (mesmos metadados do /s, tipo FULL
        //    para PRESERVAR a animação)
        const sticker = new Sticker(webpBuffer, {
          pack: 'Hipnos Bot',
          author: 'Sombras do Limbo',
          type: StickerTypes.FULL,
          categories: ['🔮'],
          id: 'hipnos_attp',
          quality: 100
        })
        const stickerBuffer = await sticker.toBuffer()

        // 7) Envia a figurinha animada
        await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg })
      } finally {
        // Nunca acumula lixo temporário, mesmo em caso de erro
        try {
          fs.rmSync(pastaFrames, { recursive: true, force: true })
        } catch (errLimpeza) {
          console.error('[attp] Falha ao limpar temporários:', errLimpeza?.message || errLimpeza)
        }
      }
    } catch (err) {
      // Mensagens amigáveis para as dependências opcionais (canvas/ffmpeg)
      if (String(err?.message || '').includes("Cannot find module 'canvas'")) {
        return await sock.sendMessage(jid, {
          text: '⚠️ O /attp precisa do pacote *canvas* neste servidor (npm install canvas). Peça ao dono do bot para instalá-lo.'
        }, { quoted: msg })
      }
      console.error('[attp] Erro ao gerar a figurinha animada:', err?.message || err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras se embaraçaram e o texto se dispersou... Tente novamente em instantes.'
      }, { quoted: msg })
    }
  }
}

