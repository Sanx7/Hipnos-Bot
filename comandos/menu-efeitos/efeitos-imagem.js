// ============================================
// 🎭 EFEITOS DE IMAGEM (menu-efeitos) — uso LIVRE
// ============================================
// Módulo ÚNICO com todos os comandos de efeito sobre FOTO DE PERFIL.
// Cada item exportado (array) é registrado pelo loader como um comando.
//
// 🗺️ Fontes (sondadas em 17/09/2026, scripts/sonda-final.js):
//   - Some Random API (api.some-random-api.com/canvas, SEM key, PNG):
//       · misc/circle, overlay/{jail,triggered,wasted,gay,glass,comrade},
//         filter/{blur,greyscale,sepia,invert,clown} → VIVOS (200);
//       · misc/{kiss,ship,slap,spank,batslap,delete,beautiful,bobross,ad}
//         → MORTOS (404) — NÃO são implementados aqui.
//   - Nekobot (todos os tipos testados) → 501 "Not implemented". Morta.
//   Por isso kiss/ship são GERADOS LOCALMENTE com a lib `canvas`
//   (a mesma do /brat): duas fotos lado a lado + coração (kiss) ou
//   barra de % (ship — percentual SORTEADO localmente, já que a API
//   que gerava esse número saiu do ar).
//   Filtros simples (blur/greyscale/sepia/invert/circle) têm FALLBACK
//   LOCAL com jimp se a SRA estiver fora do ar.
//
// 📌 Regra de ouro do projeto (wiki.js/revelar/meme.js/perfil): a imagem
//    é enviada com `jpegThumbnail` PRONTA — gerada pelo binário do ffmpeg
//    em PROCESSO FILHO. A Baileys NUNCA gera thumbnail sozinha (o sharp/
//    libvips nativo in-process é a causa raiz dos crashes não capturáveis).
//   - timeout de 10s em TODA requisição (axios);
//   - menções validadas ANTES de gastar chamada de rede;
//   - sem foto de perfil → aviso amigável (nada de stack);
//   - NADA escapa para o listener (try/catch em cada executar).
//   ⚠️ /sfundo (remoção de fundo) NÃO existe aqui: serviço desse tipo
//      (remove.bg etc.) é pago/com key — decidir o provedor antes.
//
// 📚 DOC OFICIAL CONFIRMADA EM 26/09/2026 (docs.some-random-api.com — a raiz
//    some-random-api.com/docs responde 404; a doc vive no subdomínio):
//   Base real: https://api.some-random-api.com/canvas
//   Parâmetro de imagem em TODOS: `avatar=<url>`, e a fonte PRECISA ser PNG
//   (o JPEG cru do profilePictureUrl às vezes é rejeitado).
//   O que a API REALMENTE tem hoje:
//     · overlay/  → comrade, gay, glass, jail, passed, triggered, wasted
//     · filter/   → blue, blurple, pixelate, blur, blurple2, brightness,
//                   color, green, greyscale, invert, red, invertgreyscale,
//                   sepia, threshold
//     · misc/     → bisexual, circle, heart, horny, its-so-stupid, lesbian,
//                   lgbt, lied, lolice, namecard, nobitches, nonbinary,
//                   oogway, oogway2, pansexual, simpcard, tonikawa,
//                   transgender, tweet, youtube-comment
//   ⚠️ NÃO existem na API: kiss, ship, slap, spank, delete, batslap,
//      beautiful, bobross, ad — não aparecem na doc atual.
//   → kiss/ship (pares) e slap/spank/apagar/batslap/beautiful/bobross/ad
//     são gerados LOCALMENTE com `canvas`/`jimp` (dependências já do
//     projeto), sem depender de API que pode sumir do dia para a noite.
//   ⚠️ /clown: a doc lista clown em NEHUMA seção (só em fontes antigas) —
//     o comando passou a ser 100% local (jimp), sem chamada de rede.
//   ⚠️ /apagar (era /delete na SRA): "delete" colide com o comando admin
//     comandos/admin/delete.js — por isso o nome é /apagar (aliases
//     /deletar, /delete-foto), conforme pedido de evitar conflito.
// ============================================

const axios = require('axios')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Jimp, JimpMime } = require('jimp')
const { createCanvas, loadImage } = require('canvas')
const { caminhoFfmpeg, apagarComRetry } = require('../menu-utilitario/audio-extrator')
// 🎨 Tema VIP (/temavip — campo `temaVip` no documento do VIP): paleta de
// fundo/texto/destaque escolhida por QUEM INVOCOU o comando de par. Sem tema
// (mortal, VIP sem escolha ou banco fora) os cards seguem com as cores fixas
// de sempre — a leitura nunca lança (mesmo padrão do /s com a assinatura).
const vip = require('../../vip')
const temasVip = require('../../temas-vip')

const BASE_SRA = 'https://api.some-random-api.com/canvas'
const TIMEOUT_API_MS = 10000
const QUALIDADE_THUMB = 60

// 🧩 JPEG 8x8 válido (mesmo fallback do meme.js/nasa.js) — a Baileys nunca
// toca no sharp nativo, nem se o ffmpeg falhar na miniatura.
const THUMB_FALLBACK_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzU4LjQyLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAEBEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgACAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AD//Z'

// 🧨 Erro de domínio: mensagem amigável + tipo p/ o aviso correto
class ErroEfeitos extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroEfeitos'
    this.tipo = tipo // 'sem_mencao' | 'sem_foto' | 'api' | 'privado'
  }
}

// ─── 🔌 Pontos de rede isolados (var p/ o gancho _injetar dos testes) ───
let baixarBuffer = async (url) => {
  const resposta = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: TIMEOUT_API_MS,
    maxContentLength: 15 * 1024 * 1024
  })
  return Buffer.from(resposta.data)
}

// SRA: devolve o PNG do efeito. Falha → ErroEfeitos('api').
let buscarSra = async (rota, params) => {
  try {
    const resposta = await axios.get(`${BASE_SRA}/${rota}`, {
      params,
      responseType: 'arraybuffer',
      timeout: TIMEOUT_API_MS,
      maxContentLength: 15 * 1024 * 1024
    })
    const buffer = Buffer.from(resposta.data)
    if (!buffer.length) throw new Error('resposta vazia')
    return buffer
  } catch (err) {
    console.error(`[efeitos] SRA ${rota} falhou:`, err?.message || err)
    throw new ErroEfeitos('a Some Random API não respondeu agora', 'api')
  }
}


// ─── 🎯 Alvo da menção: @menção OU reply OU autor (padrão do /tapa) ───
function resolverAlvo(msg, sender) {
  const contexto = msg.message?.extendedTextMessage?.contextInfo
  return contexto?.mentionedJid?.[0] || contexto?.participant || sender || msg.key.remoteJid
}

function exigirAlvo(msg, sender) {
  const contexto = msg.message?.extendedTextMessage?.contextInfo
  const alvo = contexto?.mentionedJid?.[0] || contexto?.participant
  if (!alvo || alvo === sender) {
    throw new ErroEfeitos('mencione alguém com @ para usar este efeito', 'sem_mencao')
  }
  return alvo
}

// ─── 🎲 Par aleatório do grupo (via groupMetadata) ───
let parceiroAleatorio = async (sock, jid, sender) => {
  try {
    const metadados = await sock.groupMetadata(jid)
    const outros = (metadados?.participants || [])
      .map((p) => p.id)
      .filter((id) => id && id !== sender)
    if (!outros.length) throw new Error('grupo sem outros membros')
    return outros[Math.floor(Math.random() * outros.length)]
  } catch (err) {
    throw new ErroEfeitos(
      'use este comando DENTRO de um grupo (preciso sortear um par aleatório)',
      'privado'
    )
  }
}

// ─── 🖼️ Miniatura JPEG pronta via ffmpeg (processo filho, nunca lança) ───
async function gerarThumbnailJpeg(buffer) {
  const idUnico = `efeito-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const entrada = path.join(os.tmpdir(), `${idUnico}.png`)
  const saida = path.join(os.tmpdir(), `${idUnico}-thumb.jpg`)
  try {
    fs.writeFileSync(entrada, buffer)
    await new Promise((resolver) => {
      const { execFile } = require('child_process')
      execFile(
        caminhoFfmpeg(),
        ['-y', '-nostdin', '-i', entrada, '-vf', 'scale=64:-1', '-vframes', '1', saida],
        { timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
        () => resolver()
      )
    })
    if (fs.existsSync(saida)) {
      const jpeg = fs.readFileSync(saida)
      if (jpeg.length > 0) return jpeg.toString('base64')
    }
  } catch (err) {
    console.error('[efeitos] thumbnail falhou (fallback 8x8):', err?.message || err)
  } finally {
    await apagarComRetry(entrada)
    await apagarComRetry(saida)
  }
  return THUMB_FALLBACK_JPEG_BASE64
}

// ─── 📨 Envio padrão: imagem + caption + thumbnail pronta ───
async function enviarImagem(sock, jid, msg, buffer, caption, mentions) {
  const jpegThumbnail = await gerarThumbnailJpeg(buffer)
  const conteudo = { image: buffer, caption, jpegThumbnail }
  if (mentions && mentions.length) conteudo.mentions = mentions
  return sock.sendMessage(jid, conteudo, { quoted: msg })
}

// ─── 💞 Cena de PAR (kiss/ship) gerada LOCALMENTE com canvas ───
// Duas fotos redondas lado a lado; no kiss, um coração no meio; no ship,
// uma barra de compatibilidade com % SORTEADA localmente (a API que
// gerava esse número saiu do ar). Devolve PNG Buffer.
//
// 🎨 `paleta` (opcional): tema VIP do autor (/temavip) com as cores de
// FUNDO, TEXTO e DESTAQUE do card. Sem paleta (ou tema padrão aplicado
// sobre as cores atuais) o desenho usa as cores fixas de SEMPRE:
//   fundo #0b141a · anel roxo (ship) / rosa (kiss) · texto branco ·
//   trilho #1f2c34 · progresso verde/laranja conforme o %.
// Com paleta, fundo/anéis/coração/barra/texto vêm todas do tema.
async function comporPar(fotoA, fotoB, modo, percentual, paleta = null) {
  const imagemA = await loadImage(fotoA)
  const imagemB = await loadImage(fotoB)
  const LADO = 400
  const RAIO = 130
  const canvas = createCanvas(LADO * 2, LADO + 90)
  const ctx = canvas.getContext('2d')

  // 🎨 Cores: tema VIP quando há; senão, as fixas de hoje (byte a byte).
  const corFundo = paleta ? temasVip.hexParaCanvas(paleta.fundo) : '#0b141a'
  const corTexto = paleta ? temasVip.hexParaCanvas(paleta.texto) : '#ffffff'
  const corAnel = paleta
    ? temasVip.hexParaCanvas(paleta.destaque)
    : (modo === 'ship' ? '#7c3aed' : '#f43f5e')

  ctx.fillStyle = corFundo
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const desenharFoto = (img, cx) => {
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, 230, RAIO, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    const escala = Math.max((RAIO * 2) / img.width, (RAIO * 2) / img.height)
    const w = img.width * escala
    const h = img.height * escala
    ctx.drawImage(img, cx - w / 2, 230 - h / 2, w, h)
    ctx.restore()
    ctx.beginPath()
    ctx.arc(cx, 230, RAIO, 0, Math.PI * 2)
    ctx.strokeStyle = corAnel
    ctx.lineWidth = 6
    ctx.stroke()
  }
  desenharFoto(imagemA, 230)
  desenharFoto(imagemB, 570)

  if (modo === 'ship') {
    // 📊 Barra de compatibilidade
    if (paleta) {
      // Tema: trilho = destaque esmaecido (mistura com o fundo), preenchimento
      // = destaque sólido — as duas cores do tema garantem contraste em QUALQUER
      // combinação (a semântica verde/laranja só vale SEM tema, como hoje).
      ctx.save()
      ctx.globalAlpha = 0.3
      ctx.fillStyle = corAnel
      ctx.fillRect(120, 400, 560, 34)
      ctx.restore()
      ctx.fillStyle = corAnel
      ctx.fillRect(120, 400, Math.round(560 * (percentual / 100)), 34)
    } else {
      ctx.fillStyle = '#1f2c34'
      ctx.fillRect(120, 400, 560, 34)
      ctx.fillStyle = percentual >= 50 ? '#22c55e' : '#f59e0b'
      ctx.fillRect(120, 400, Math.round(560 * (percentual / 100)), 34)
    }
    ctx.fillStyle = corTexto
    ctx.font = 'bold 30px Sans'
    ctx.textAlign = 'center'
    ctx.fillText(`${percentual}%`, 400, 480)
  } else {
    // ❤️ Coração entre as duas fotos
    ctx.fillStyle = corAnel
    ctx.beginPath()
    const cx = 400
    const cy = 230
    const s = 38
    ctx.moveTo(cx, cy + s)
    ctx.bezierCurveTo(cx - s * 1.6, cy - s * 0.4, cx - s * 0.6, cy - s * 1.6, cx, cy - s * 0.4)
    ctx.bezierCurveTo(cx + s * 0.6, cy - s * 1.6, cx + s * 1.6, cy - s * 0.4, cx, cy + s)
    ctx.closePath()
    ctx.fill()
  }
  return canvas.toBuffer('image/png')
}

// ─── 🎛️ Filtros locais (jimp) — usados como fallback quando a SRA cai e
//     como caminho ÚNICO dos filtros que a API não tem.
//
// ⚠️ VERSÃO DO JIMP (1.6.1, a instalada aqui) — APIs conferidas na prática:
//   · .contrast(valor)   → aceita -1..+1 (LANÇA erro fora da faixa)
//   · .pixelate(tamanho) → blocos quadrados
//   · espelhar usa .flip({ horizontal: true, vertical: false }).
//     ⚠️ NÃO existe .mirror() nesta versão, e .flip() NÃO aceita booleanos
//     (exige objeto) — usar a forma com objeto ou o comando quebra.
const FILTROS_JIMP = {
  blur: (img) => img.blur(10),
  greyscale: (img) => img.greyscale(),
  sepia: (img) => img.sepia(),
  invert: (img) => img.invert(),
  circulo: (img) => img.circle(),
  // ── Novos (26/09/2026): 100% locais, a API não oferece nenhum deles ──
  contraste: (img) => img.contrast(0.5),
  espelhar: (img) => img.flip({ horizontal: true, vertical: false }),
  pixel: (img) => img.pixelate(12)
}

let filtroLocal = async (nome, foto) => {
  const transformar = FILTROS_JIMP[nome]
  if (!transformar) return null // overlay sem equivalente local
  const imagem = await Jimp.read(foto)
  transformar(imagem)
  return imagem.getBuffer(JimpMime.png)
}

// ─── 🧰 Foto de perfil: URL (p/ a SRA) + Buffer (p/ fallback local) ───
// Com um só download a gente cobre os dois caminhos (SRA viva ou morta).
async function fotoDePerfil(sock, jid, { comBuffer = true } = {}) {
  try {
    const url = await sock.profilePictureUrl(jid, 'image')
    if (!url) throw new Error('sem url')
    if (!comBuffer) return { url, buffer: null }
    return { url, buffer: await baixarBuffer(url) }
  } catch (err) {
    console.error(`[efeitos] sem foto de perfil de ${jid}:`, err?.message || err)
    throw new ErroEfeitos('essa alma não tem foto de perfil visível (ou está privada)', 'sem_foto')
  }
}

// ─── 💌 Aviso amigável central (nada escapa pro listener) ───
async function avisar(sock, jid, msg, err, nome) {
  console.error(`[efeitos] 💥 ${nome} falhou (o bot segue vivo):`, err?.stack || err)
  const mapa = {
    sem_mencao: '🎯 *Falta o alvo...*\n\nMencione alguém com @ para usar este efeito (ou responda a mensagem da pessoa).',
    sem_foto: '📷 *Sem foto de perfil...*\n\nEssa conta não tem foto visível (ou está privada). Não dá para aplicar o efeito.',
    privado: '👥 *Só funciona em grupo...*\n\nEste comando sorteia um membro aleatório — chame-o dentro de um grupo.',
    api: '⛔ *O estúdio de efeitos está fora do ar...*\n\nA Some Random API não respondeu agora. Tente novamente em instantes.'
  }
  const aviso = mapa[err instanceof ErroEfeitos ? err.tipo : ''] ||
    '⛔ *As sombras distorcem a imagem...*\n\nNão consegui aplicar o efeito agora. Tente novamente em instantes.'
  await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
}

// ─── 🏭 Fábrica OVERLAY (SRA direto; sem fallback local) ───
// Passa a URL da foto de perfil como `avatar` — sem download prévio.
function comandoOverlay({ nome, aliases, descricao, rota, legenda }) {
  return {
    nome,
    aliases,
    descricao,
    categoria: 'fig',
    async executar(sock, jid, msg) {
      try {
        const sender = msg.key.participant || msg.key.remoteJid
        const alvo = resolverAlvo(msg, sender)
        console.log(`[efeitos] ${nome} → overlay ${rota} (alvo ${alvo})`)
        const { url } = await fotoDePerfil(sock, alvo, { comBuffer: false })
        const buffer = await buscarSra(rota, { avatar: url })
        await enviarImagem(sock, jid, msg, buffer, legenda)
      } catch (err) {
        await avisar(sock, jid, msg, err, nome)
      }
    }
  }
}

// ─── 🏭 Fábrica FILTRO (SRA + fallback local no jimp) ───
function comandoFiltro({ nome, aliases, descricao, rota, filtro, legenda }) {
  return {
    nome,
    aliases,
    descricao,
    categoria: 'fig',
    async executar(sock, jid, msg) {
      try {
        const sender = msg.key.participant || msg.key.remoteJid
        const alvo = resolverAlvo(msg, sender)
        console.log(`[efeitos] ${nome} → ${rota} (alvo ${alvo})`)
        const { url, buffer: foto } = await fotoDePerfil(sock, alvo)
        let buffer = null
        try {
          buffer = await buscarSra(rota, { avatar: url })
        } catch (errSra) {
          buffer = await filtroLocal(filtro, foto)
          if (!buffer) throw errSra // overlay sem equivalente: mantém o erro da API
          console.log(`[efeitos] ${nome}: SRA fora — usei o fallback local do jimp`)
        }
        await enviarImagem(sock, jid, msg, buffer, legenda)
      } catch (err) {
        await avisar(sock, jid, msg, err, nome)
      }
    }
  }
}
// ─── 🏭 Fábrica PAR (kiss/ship) — geração LOCAL com canvas ───
// par: 'mencao' (exige @ ou reply) | 'auto' (menção/reply/próprio autor)
//      | 'aleatorio' (sorteia membro do grupo via groupMetadata)
function comandoPar({ nome, aliases, descricao, modo, par }) {
  return {
    nome,
    aliases,
    descricao,
    categoria: 'fig',
    async executar(sock, jid, msg) {
      try {
        const sender = msg.key.participant || msg.key.remoteJid
        const alvo = par === 'mencao'
          ? exigirAlvo(msg, sender)
          : par === 'aleatorio'
            ? await parceiroAleatorio(sock, jid, sender)
            : resolverAlvo(msg, sender)
        const percentual = 1 + Math.floor(Math.random() * 100)
        console.log(`[efeitos] ${nome} → par local (${sender} + ${alvo}) ${percentual}%`)

        // 🎨 Tema VIP (/temavip) de QUEM INVOCOU: paleta das cores do card.
        // Nunca lança — banco fora ou sem tema → cores fixas de sempre.
        let paleta = null
        try {
          const tema = await vip.obterTemaVip(sender)
          if (tema) paleta = temasVip.obterPaleta(tema)
        } catch (errTema) {
          console.error('[efeitos] ⚠️ falha ao ler o tema VIP:', errTema?.message || errTema)
        }

        const fotoA = await fotoDePerfil(sock, sender)
        const fotoB = alvo === sender ? fotoA : await fotoDePerfil(sock, alvo)
        const buffer = await comporPar(fotoA.buffer, fotoB.buffer, modo, percentual, paleta)
        const caption = modo === 'ship'
          ? `💘 *As almas foram medidas...* ${percentual}% de compatibilidade!`
          : '💋 *Um beijo atravessou o limbo...*'
        const mentions = alvo !== sender ? [alvo] : []
        await enviarImagem(sock, jid, msg, buffer, caption, mentions)
      } catch (err) {
        await avisar(sock, jid, msg, err, nome)
      }
    }
  }
}

// ─── 🖼️ Memes LOCAIS (canvas) — os que a SRA não oferece mais ───
// A doc oficial de 26/09/2026 não lista slap/spank/batslap/beautiful/
// bobross/ad/delete (nem kiss/ship, que já eram locais). Em vez de chamar
// uma API que pode sumir, estes memes são MONTADOS AQUI com `canvas` —
// mesma dependência que já desenha o /kiss e o /ship. Todos devolvem PNG.

// 🖼️ Base: imagem quadrada (cover) num canvas do tamanho pedido
async function quadrado(foto, lado) {
  const img = await loadImage(foto)
  const canvas = createCanvas(lado, lado)
  const ctx = canvas.getContext('2d')
  const escala = Math.max(lado / img.width, lado / img.height)
  const w = img.width * escala
  const h = img.height * escala
  ctx.drawImage(img, (lado - w) / 2, (lado - h) / 2, w, h)
  return { canvas, ctx, img }
}

// ─── 💢 SLAP — duas fotos + impacto (você ⇄ quem você mencionar)
async function comporSlap(fotoA, fotoB) {
  const LADO = 380
  const { canvas, ctx } = await quadrado(fotoA, LADO)
  const imgB = await loadImage(fotoB)
  const largura = canvas.width

  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(0, 0, largura, LADO)

  // Retrato do alvo virado, à direita
  const escalaB = Math.max(LADO / imgB.width, LADO / imgB.height)
  ctx.save()
  ctx.translate(largura - LADO * 0.18, LADO / 2)
  ctx.rotate(Math.PI * 0.06)
  ctx.translate(-LADO * 0.5, -LADO * 0.5)
  ctx.drawImage(imgB, 0, 0, LADO * 0.9, LADO)
  ctx.restore()

  // Mão estilizada (losango) indo na direção do alvo
  ctx.fillStyle = '#f8d9a0'
  ctx.strokeStyle = '#b07d4a'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(largura * 0.56, LADO * 0.42)
  ctx.lineTo(largura * 0.78, LADO * 0.5)
  ctx.lineTo(largura * 0.56, LADO * 0.58)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Efeito de impacto
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 6
  for (let i = 0; i < 3; i++) {
    ctx.beginPath()
    ctx.arc(largura * 0.72, LADO * 0.5, 18 + i * 16, -0.9, 0.9)
    ctx.stroke()
  }

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 42px Sans'
  ctx.textAlign = 'center'
  ctx.fillText('SLAP!', largura / 2, 58)
  return canvas.toBuffer('image/png')
}

// ─── 🍑 SPANK — moldura quente + aviso (variante leve do slap)
async function comporSpank(foto) {
  const LADO = 480
  const { canvas, ctx } = await quadrado(foto, LADO)
  ctx.fillStyle = 'rgba(80,20,60,0.45)'
  ctx.fillRect(0, 0, LADO, LADO)
  ctx.strokeStyle = '#ffd166'
  ctx.lineWidth = 14
  ctx.strokeRect(7, 7, LADO - 14, LADO - 14)
  ctx.fillStyle = '#ffd166'
  ctx.font = 'bold 64px Sans'
  ctx.textAlign = 'center'
  ctx.fillText('SPANK!', LADO / 2, 92)
  return canvas.toBuffer('image/png')
}

// ─── 🦇 BATSLAP — "BATS LAP" estilo quadrinho
async function comporBatslap(foto) {
  const LADO = 500
  const { canvas, ctx } = await quadrado(foto, LADO)
  ctx.fillStyle = 'rgba(20,20,40,0.5)'
  ctx.fillRect(0, 0, LADO, LADO)
  ctx.fillStyle = '#ffd700'
  ctx.font = 'bold 58px Sans'
  ctx.textAlign = 'center'
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 8
  ctx.strokeText('BATS LAP!', LADO / 2, 120)
  ctx.fillText('BATS LAP!', LADO / 2, 120)
  return canvas.toBuffer('image/png')
}

// ─── 🥹 BEAUTIFUL — "Tão bonito(a) que até chorei"
async function composeBeautiful(foto) {
  const LADO = 480
  const { canvas, ctx } = await quadrado(foto, LADO)
  ctx.fillStyle = 'rgba(255,180,220,0.35)'
  ctx.fillRect(0, 0, LADO, LADO)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 40px Sans'
  ctx.textAlign = 'center'
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 8
  ctx.fillText('Tão bonito(a) que', LADO / 2, LADO * 0.42)
  ctx.fillText('até chorei 😭', LADO / 2, LADO * 0.52)
  return canvas.toBuffer('image/png')
}

// ─── 🎨 BOBROSS — "pintura" com moldura dourada e assinatura falsa
async function comporBobross(foto) {
  const LADO = 500
  const { canvas, ctx } = await quadrado(foto, LADO)
  // Moldura de madeira dourada
  ctx.strokeStyle = '#8B5E3C'
  ctx.lineWidth = 28
  ctx.strokeRect(14, 14, LADO - 28, LADO - 28)
  ctx.strokeStyle = '#D4AF37'
  ctx.lineWidth = 10
  ctx.strokeRect(30, 30, LADO - 60, LADO - 60)
  // Assinatura "pintura"
  ctx.fillStyle = '#D4AF37'
  ctx.font = 'italic bold 34px Sans'
  ctx.textAlign = 'right'
  ctx.fillText('~ sessão do limbo ~', LADO - 44, LADO - 44)
  return canvas.toBuffer('image/png')
}

// ─── 📢 AD — outdoors/propaganda com a foto
async function comporAd(foto) {
  const LADO = 500
  const { canvas, ctx } = await quadrado(foto, LADO)
  // Faixa de propaganda no topo
  ctx.fillStyle = '#FFD700'
  ctx.fillRect(0, 0, LADO, 90)
  ctx.fillStyle = '#1a1a1a'
  ctx.font = 'bold 44px Sans'
  ctx.textAlign = 'center'
  ctx.fillText('APERTE LIKE', LADO / 2, 60)
  // Rodapé
  ctx.fillStyle = 'rgba(0,0,0,0.75)'
  ctx.fillRect(0, LADO - 80, LADO, 80)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 34px Sans'
  ctx.fillText('SEGUNDA A DOR SÓ', LADO / 2, LADO - 30)
  return canvas.toBuffer('image/png')
}

// ─── 🗑️ APAGAR — "esta mensagem foi apagada" (era /delete na SRA)
async function comporApagar(foto) {
  const LADO = 400
  const { canvas, ctx } = await quadrado(foto, LADO)
  // Escurece e aplica o "borrão" de mensagem apagada
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.fillRect(0, 0, LADO, LADO)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.font = 'bold 30px Sans'
  ctx.textAlign = 'center'
  ctx.fillText('Esta mensagem', LADO / 2, LADO * 0.46)
  ctx.fillText('foi apagada', LADO / 2, LADO * 0.55)
  return canvas.toBuffer('image/png')
}

// ─── 🪦 RIP — lápide LOCAL (o endpoint /canvas/misc/rip não existe na doc)
// A SRA não oferece mais este meme (doc oficial de 26/09/2026), então a
// lápide é DESENHADA aqui com canvas: pedra cinza com topo arredondado, a
// foto encaixada no miolo e o "RIP" gravado. Sem asset externo e sem rede.
async function comporRip(foto) {
  const LADO = 500
  const { canvas, ctx } = await quadrado(foto, LADO)
  const largura = LADO

  // Céu noturno (escuridão do limbo)
  ctx.fillStyle = 'rgba(8,10,16,0.72)'
  ctx.fillRect(0, 0, largura, LADO)

  // ── A pedra: retângulo com topo em arco ──
  const m = largura * 0.12            // margem lateral
  const yTopo = largura * 0.18
  const yBase = largura * 0.9
  const raio = largura * 0.21         // meia-lua do topo
  const pedra = ctx.createLinearGradient(0, yTopo, 0, yBase)
  pedra.addColorStop(0, '#8a8f98')
  pedra.addColorStop(0.5, '#6b7078')
  pedra.addColorStop(1, '#4a4e55')

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(m, yBase)
  ctx.lineTo(m, yTopo + raio)
  ctx.arc(m + (largura - m * 2) / 2, yTopo + raio, raio, Math.PI, 0)
  ctx.lineTo(largura - m, yBase)
  ctx.closePath()
  ctx.fillStyle = pedra
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.restore()

  // ── Foto recortada em arco no miolo da pedra ──
  const fotoLado = largura * 0.42
  const fotoX = (largura - fotoLado) / 2
  const fotoY = largura * 0.33
  const img = await loadImage(foto)
  ctx.save()
  ctx.beginPath()
  ctx.arc(fotoX + fotoLado / 2, fotoY + fotoLado / 2, fotoLado / 2, 0, Math.PI * 2)
  ctx.clip()
  const escala = Math.max(fotoLado / img.width, fotoLado / img.height)
  ctx.drawImage(
    img,
    fotoX - (img.width * escala - fotoLado) / 2,
    fotoY - (img.height * escala - fotoLado) / 2,
    img.width * escala,
    img.height * escala
  )
  ctx.restore()
  // Aro da foto
  ctx.beginPath()
  ctx.arc(fotoX + fotoLado / 2, fotoY + fotoLado / 2, fotoLado / 2, 0, Math.PI * 2)
  ctx.strokeStyle = '#2f333a'
  ctx.lineWidth = 6
  ctx.stroke()

  // ── "RIP" gravado na pedra ──
  ctx.fillStyle = '#e8e4da'
  ctx.textAlign = 'center'
  ctx.font = 'bold 92px Sans'
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 4
  ctx.fillText('RIP', largura / 2, largura * 0.855)
  ctx.shadowBlur = 0

  // Datas fictícias do submundo
  ctx.fillStyle = 'rgba(232,228,218,0.75)'
  ctx.font = '20px Sans'
  ctx.fillText('26 · 09 · 2026', largura / 2, largura * 0.895)
  ctx.font = 'italic 17px Sans'
  ctx.fillText('descansa entre os sonhos', largura / 2, largura * 0.925)

  return canvas.toBuffer('image/png')
}

// ─── 🏭 Fábrica FILTRO LOCAL (jimp puro, SEM tocar na API) ───
// Usada pelos filtros que a SRA não oferece (/contraste, /espelhar,
// /pixel): não há rota remota, então não gastam nem 1ms de rede nem
// arriscam cair quando a API estiver fora. A foto vai direto ao jimp e
// volta como PNG.
function comandoFiltroLocal({ nome, aliases, descricao, filtro, legenda }) {
  return {
    nome,
    aliases,
    descricao,
    categoria: 'fig',
    async executar(sock, jid, msg) {
      try {
        const sender = msg.key.participant || msg.key.remoteJid
        const alvo = resolverAlvo(msg, sender)
        console.log(`[efeitos] ${nome} → filtro local (alvo ${alvo})`)
        const { buffer: foto } = await fotoDePerfil(sock, alvo)
        const buffer = await filtroLocal(filtro, foto)
        if (!buffer) throw new ErroEfeitos(`filtro local "${filtro}" não implementado`, 'api')
        const mentions = alvo !== sender ? [alvo] : []
        await enviarImagem(sock, jid, msg, buffer, legenda, mentions)
      } catch (err) {
        await avisar(sock, jid, msg, err, nome)
      }
    }
  }
}

// ─── 🏭 Fábrica MEME LOCAL (duas fotos: autor + menção) ───
// par: 'mencao' (exige @) | 'auto' (menção/reply/própria) — igual ao /kiss.
function comandoMemePar({ nome, aliases, descricao, par = 'mencao', compor, legenda }) {
  return {
    nome,
    aliases,
    descricao,
    categoria: 'fig',
    async executar(sock, jid, msg) {
      try {
        const sender = msg.key.participant || msg.key.remoteJid
        // ⚠️ Menção validada ANTES de baixar qualquer foto
        const alvo = par === 'mencao' ? exigirAlvo(msg, sender) : resolverAlvo(msg, sender)
        console.log(`[efeitos] ${nome} → meme local (${sender} ⇄ ${alvo})`)

        const fotoA = await fotoDePerfil(sock, sender)
        const fotoB = alvo === sender ? fotoA : await fotoDePerfil(sock, alvo)
        const buffer = await compor(fotoA.buffer, fotoB.buffer)
        const mentions = alvo !== sender ? [alvo] : []
        await enviarImagem(sock, jid, msg, buffer, legenda, mentions)
      } catch (err) {
        await avisar(sock, jid, msg, err, nome)
      }
    }
  }
}

// ─── 🏭 Fábrica MEME SOLO LOCAL (uma foto) ───
// Usada por /spank, /batslap, /beautiful, /bobross e /ad: o efeito é
// aplicado na foto de QUEM MANDOU (ou de quem foi mencionado, se houver).
function comandoMemeSolo({ nome, aliases, descricao, compor, legenda }) {
  return {
    nome,
    aliases,
    descricao,
    categoria: 'fig',
    async executar(sock, jid, msg) {
      try {
        const sender = msg.key.participant || msg.key.remoteJid
        const alvo = resolverAlvo(msg, sender)
        console.log(`[efeitos] ${nome} → meme solo local (alvo ${alvo})`)
        const { buffer: foto } = await fotoDePerfil(sock, alvo)
        const buffer = await compor(foto)
        const mentions = alvo !== sender ? [alvo] : []
        await enviarImagem(sock, jid, msg, buffer, legenda, mentions)
      } catch (err) {
        await avisar(sock, jid, msg, err, nome)
      }
    }
  }
}

// ─── 🤡 CLOWN 100% LOCAL (a doc não lista /clown em nenhuma seção) ───
// Mesmo efeito do filtro antigo: nariz + sobrancelhas de palhaço, desenhados
// sobre a foto. Sem rede — se a SRA cair, o /clown continua funcionando.
async function comporClown(foto) {
  const { canvas, ctx } = await quadrado(foto, 500)
  const LADO = 500
  const cx = LADO / 2
  const cy = LADO * 0.52
  const raio = LADO * 0.11

  const grad = ctx.createRadialGradient(cx, cy - raio * 0.3, raio * 0.1, cx, cy, raio)
  grad.addColorStop(0, '#ff6b6b')
  grad.addColorStop(1, '#c1121f')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.ellipse(cx, cy, raio, raio * 1.15, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#c1121f'
  ctx.lineWidth = Math.max(4, LADO * 0.012)
  ctx.lineCap = 'round'
  for (const lado of [-1, 1]) {
    const x0 = cx + lado * LADO * 0.16
    ctx.beginPath()
    ctx.moveTo(x0 - lado * LADO * 0.09, LADO * 0.3)
    ctx.quadraticCurveTo(x0, LADO * 0.22, x0 + lado * LADO * 0.09, LADO * 0.3)
    ctx.stroke()
  }
  return canvas.toBuffer('image/png')
}

// ─── 📨 Exporta TODOS os comandos (o loader registra cada item do array) ───
// ⚠️ kiss/ship/slap/spank/batslap/apagar/beautiful/bobross/ad NÃO existem na
//    SRA (doc oficial de 26/09/2026) — todos são gerados LOCALMENTE com
//    canvas/jimp, sem depender de API que pode sumir. /clown idem.
//    /sfundo segue desativado (serviço pago/com key — ver cabeçalho).
module.exports = [
  // 💞 PARES — geração local (canvas), sem API externa
  comandoPar({ nome: 'kiss', descricao: 'Manda um beijo juntando a sua foto com a de quem você mencionar (ex: /kiss @fulano).', modo: 'kiss', par: 'mencao' }),
  comandoPar({ nome: 'kissme', descricao: 'Manda um beijo sem precisar mencionar: usa a foto de quem você responder ou a sua própria.', modo: 'kiss', par: 'auto' }),
  comandoPar({ nome: 'ship', descricao: 'Mede a compatibilidade entre você e quem você mencionar, com % na imagem (ex: /ship @fulano).', modo: 'ship', par: 'mencao' }),
  comandoPar({ nome: 'shipme', descricao: 'Sorteia um membro aleatório do grupo e revela a % de compatibilidade com você.', modo: 'ship', par: 'aleatorio' }),

  // 🎭 OVERLAYS — Some Random API (rotas confirmadas na doc oficial, 26/09/2026)
  comandoOverlay({ nome: 'jail', aliases: ['cadeia'], descricao: 'Coloca a foto atrás das grades da prisão (ex: /jail @fulano, também /cadeia).', rota: 'overlay/jail', legenda: '⛓️ Preso nas sombras do limbo!' }),
  comandoOverlay({ nome: 'triggered', descricao: 'Meme "TRIGGERED" sobre a foto (ex: /triggered @fulano).', rota: 'overlay/triggered', legenda: '😤 TRIGGERED!' }),
  comandoOverlay({ nome: 'wasted', descricao: 'Overlay "WASTED" estilo GTA sobre a foto (ex: /wasted @fulano).', rota: 'overlay/wasted', legenda: '☠️ WASTED' }),
  comandoOverlay({ nome: 'passed', descricao: 'Overlay "PASSED" sobre a foto (ex: /passed @fulano).', rota: 'overlay/passed', legenda: '🍃 Passou...' }),
  comandoOverlay({ nome: 'gay', descricao: 'Overlay arco-íris sobre a foto (ex: /gay @fulano).', rota: 'overlay/gay', legenda: '🌈 O arco-íris do sono' }),
  comandoOverlay({ nome: 'glass', descricao: 'Efeito de vidro estilhaçado sobre a foto (ex: /glass @fulano).', rota: 'overlay/glass', legenda: '🪞 Através do vidro...' }),
  comandoOverlay({ nome: 'comrade', descricao: 'Pôster soviético com a foto (ex: /comrade @fulano).', rota: 'overlay/comrade', legenda: '☭ Camarada do limbo!' }),

  // 🎛️ FILTROS — SRA com fallback local (jimp) quando a API cair
  comandoFiltro({ nome: 'circulo', descricao: 'Recorta a foto em formato circular (ex: /circulo @fulano).', rota: 'misc/circle', filtro: 'circulo', legenda: '⭕ Alma em círculo' }),
  comandoFiltro({ nome: 'blur', descricao: 'Desfoca a foto (ex: /blur @fulano).', rota: 'filter/blur', filtro: 'blur', legenda: '🌫️ Tudo embaçado...' }),
  comandoFiltro({ nome: 'greyscale', aliases: ['gray'], descricao: 'Foto em preto e branco (ex: /greyscale @fulano, também /gray).', rota: 'filter/greyscale', filtro: 'greyscale', legenda: '🖤 Preto no branco' }),
  comandoFiltro({ nome: 'grayscale', descricao: 'Foto em preto e branco — mesma coisa do /greyscale, só muda a grafia.', rota: 'filter/greyscale', filtro: 'greyscale', legenda: '🖤 Preto no branco' }),
  comandoFiltro({ nome: 'sepia', descricao: 'Foto com tom sépia vintage (ex: /sepia @fulano).', rota: 'filter/sepia', filtro: 'sepia', legenda: '📜 Um retrato do passado' }),
  comandoFiltro({ nome: 'invert', aliases: ['inverter'], descricao: 'Inverte as cores da foto (ex: /invert @fulano, também /inverter).', rota: 'filter/invert', filtro: 'invert', legenda: '🔁 Cores do mundo invertidas' }),
  comandoFiltro({ nome: 'heart', descricao: 'Coloca a foto dentro de um coração (ex: /heart @fulano).', rota: 'misc/heart', filtro: null, legenda: '💜 Coração do limbo' }),

  // 🆕 FILTROS LOCAIS (jimp) — a SRA não tem nenhum deles (doc 26/09/2026),
  // então rodam SEM REDE: nem tentam a API, vão direto no jimp.
  comandoFiltroLocal({ nome: 'contraste', aliases: ['contrast'], descricao: 'Aumenta o contraste da foto (ex: /contraste @fulano).', filtro: 'contraste', legenda: '🎚️ Contraste no talo' }),
  comandoFiltroLocal({ nome: 'espelhar', aliases: ['espelho', 'flip'], descricao: 'Espelha a foto horizontalmente (ex: /espelhar @fulano).', filtro: 'espelhar', legenda: '🪞 Reflexo do outro lado' }),
  // /pixel vira o nome canônico; /pixelate (que usava a API) vira ALIAS dele
  // para não haver dois comandos fazendo a mesma coisa.
  comandoFiltroLocal({ nome: 'pixel', aliases: ['pixelate'], descricao: 'Pixeliza a foto (ex: /pixel @fulano, também /pixelate).', filtro: 'pixel', legenda: '🟪 Tudo em blocos' }),

  // 🤡 CLOWN — 100% LOCAL (a doc oficial não lista /clown em nenhuma seção;
  //    a rota filter/clown antiga responde 404). Desenhado com canvas.
  comandoMemeSolo({ nome: 'clown', descricao: 'Aplica maquiagem de palhaço na foto (ex: /clown @fulano).', compor: comporClown, legenda: '🤡 O circo chegou ao limbo' }),

  // 💥 MEMES LOCAIS — a SRA não oferece mais slap/spank/batslap/beautiful/
  //    bobross/ad/delete (confirmado na doc de 26/09/2026). Gerados com canvas.
  comandoMemePar({ nome: 'slap', descricao: 'Manda um slap juntando a sua foto com a de quem você mencionar (ex: /slap @fulano).', par: 'mencao', compor: comporSlap, legenda: '💢 SLAP! O tapa cruzou o limbo' }),
  comandoMemeSolo({ nome: 'spank', descricao: 'Aplica um spank na sua foto (ou na de quem você mencionar).', compor: comporSpank, legenda: '🍑 SPANK! Ninguém escapou' }),
  comandoMemeSolo({ nome: 'batslap', descricao: 'Meme "BATS LAP" na sua foto (ou na de quem você mencionar).', compor: comporBatslap, legenda: '🦇 BATS LAP!' }),
  comandoMemeSolo({ nome: 'beautiful', descricao: 'Meme "tão bonito(a) que até chorei" na foto (ex: /beautiful @fulano).', compor: composeBeautiful, legenda: '🥹 Tão bonito(a) que até chorei' }),
  comandoMemeSolo({ nome: 'bobross', descricao: 'Coloca a foto dentro de uma pintura estilo Bob Ross (ex: /bobross @fulano).', compor: comporBobross, legenda: '🎨 Pintura da sessão do limbo' }),
  comandoMemeSolo({ nome: 'ad', descricao: 'Transforma a foto num outdoor de propaganda (ex: /ad @fulano).', compor: comporAd, legenda: '📢 SEGUNDA A DOR SÓ' }),

  // 🪦 RIP — lápide desenhada LOCALMENTE (o endpoint /canvas/misc/rip saiu da
  //    API; ver o cabeçalho com a doc de 26/09/2026). Sem asset e sem rede.
  comandoMemeSolo({ nome: 'rip', aliases: ['lápide', 'lapide'], descricao: 'Meme de lápide "RIP" com a foto (ex: /rip @fulano).', compor: comporRip, legenda: '🪦 RIP — descansa entre os sonhos' }),

  // 🚧 BOLSONARO — indisponível por decisão (mesmo caso do /sfundo): o
  //    endpoint /canvas/misc/bolsonaro NÃO consta na doc atual da SRA e é um
  //    meme/template pronto da API — NÃO tentamos recriá-lo do zero, porque
  //    sairia um desenho improvisado, não o meme que as pessoas conhecem.
  {
    nome: 'bolsonaro',
    descricao: 'Meme do Bolsonaro — indisponível (o endpoint saiu da Some Random API).',
    categoria: 'fig',
    async executar(sock, jid, msg) {
      await sock.sendMessage(jid, {
        text: '🚧 *Indisponível no limbo...*\n\nO meme do Bolsonaro dependia de um template da Some Random API que saiu do ar — e não tentamos desenhar um por nossa conta, para não entregar um desenho improvisado no lugar do meme de verdade.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  // 🗑️ APAGAR — era /delete na SRA, mas "delete" colide com o comando admin
  //    comandos/admin/delete.js. Nome livre: /apagar (aliases /deletar,
  //    /delete-foto) para não sobrescrever o admin no registro do loader.
  comandoMemeSolo({ nome: 'apagar', aliases: ['deletar', 'delete-foto'], descricao: 'Gera o meme "esta mensagem foi apagada" com a foto (ex: /apagar @fulano).', compor: comporApagar, legenda: '🗑️ Esta mensagem foi apagada' }),

  // 🚧 Indisponível por decisão: serviço de remoção de fundo é pago/com key
  //    (ex.: remove.bg). Fora do /menu-efeitos até escolhermos o provedor.
  {
    nome: 'sfundo',
    descricao: 'Remoção de fundo — indisponível (serviço pago/com key, provedor ainda não escolhido).',
    categoria: 'fig',
    async executar(sock, jid, msg) {
      await sock.sendMessage(jid, {
        text: '🚧 *Em breve no limbo...*\n\nA remoção de fundo depende de um serviço pago/com key (ex.: remove.bg) que ainda não foi escolhido. Este comando segue desativado.'
      }, { quoted: msg }).catch(() => {})
    }
  }
]

// 🔌 Gancho dos testes offline (injeção de rede/foto/parceiro)
module.exports._injetar = (overrides = {}) => {
  if (typeof overrides.buscarSra === 'function') buscarSra = overrides.buscarSra
  if (typeof overrides.baixarBuffer === 'function') baixarBuffer = overrides.baixarBuffer
  if (typeof overrides.fotoDePerfil === 'function') fotoDePerfil = overrides.fotoDePerfil
  if (typeof overrides.parceiroAleatorio === 'function') parceiroAleatorio = overrides.parceiroAleatorio
}

// 🧪 O card de par, p/ os testes (pixel a pixel, com e sem paleta do tema).
// Propriedade do ARRAY (o loader só registra itens com nome/executar).
module.exports.comporPar = comporPar

// 🧪 Os memes locais e o helper, p/ os testes offline provarem que cada
// `compor` devolve um PNG válido SEM tocar em rede.
module.exports.compor = {
  par: comporPar,
  slap: comporSlap,
  spank: comporSpank,
  batslap: comporBatslap,
  beautiful: composeBeautiful,
  bobross: comporBobross,
  ad: comporAd,
  apagar: comporApagar,
  clown: comporClown,
  rip: comporRip
}

// 🧪 A classe de erro, p/ o teste reproduzir o contrato REAL de 'sem_foto'.
module.exports.ErroEfeitos = ErroEfeitos

// 🧪 Os filtros LOCais do jimp, p/ o teste provar que cada um realmente
// transforma a imagem (ex.: o /espelhar precisa inverter os pixels).
module.exports.compor.filtro = filtroLocal
