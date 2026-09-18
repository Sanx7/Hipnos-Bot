// ============================================
// 🎭 EFEITOS DE IMAGEM (menu-fig) — uso LIVRE
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
// ============================================

const axios = require('axios')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Jimp, JimpMime } = require('jimp')
const { createCanvas, loadImage } = require('canvas')
const { caminhoFfmpeg, apagarComRetry } = require('../menu-utilitario/audio-extrator')

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
async function comporPar(fotoA, fotoB, modo, percentual) {
  const imagemA = await loadImage(fotoA)
  const imagemB = await loadImage(fotoB)
  const LADO = 400
  const RAIO = 130
  const canvas = createCanvas(LADO * 2, LADO + 90)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0b141a'
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
    ctx.strokeStyle = modo === 'ship' ? '#7c3aed' : '#f43f5e'
    ctx.lineWidth = 6
    ctx.stroke()
  }
  desenharFoto(imagemA, 230)
  desenharFoto(imagemB, 570)

  if (modo === 'ship') {
    // 📊 Barra de compatibilidade
    ctx.fillStyle = '#1f2c34'
    ctx.fillRect(120, 400, 560, 34)
    ctx.fillStyle = percentual >= 50 ? '#22c55e' : '#f59e0b'
    ctx.fillRect(120, 400, Math.round(560 * (percentual / 100)), 34)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 30px Sans'
    ctx.textAlign = 'center'
    ctx.fillText(`${percentual}%`, 400, 480)
  } else {
    // ❤️ Coração entre as duas fotos
    ctx.fillStyle = '#f43f5e'
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

// ─── 🎛️ Filtros locais (jimp) — fallback quando a SRA está fora ───
const FILTROS_JIMP = {
  blur: (img) => img.blur(10),
  greyscale: (img) => img.greyscale(),
  sepia: (img) => img.sepia(),
  invert: (img) => img.invert(),
  circulo: (img) => img.circle()
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
        const fotoA = await fotoDePerfil(sock, sender)
        const fotoB = alvo === sender ? fotoA : await fotoDePerfil(sock, alvo)
        const buffer = await comporPar(fotoA.buffer, fotoB.buffer, modo, percentual)
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

// ─── 📨 Exporta TODOS os comandos (o loader registra cada item do array) ───
// ⚠️ kiss/ship/slap/spank/batslap/delete/beautiful/bobross/ad saíram do ar
//    na SRA e na Nekobot (scripts/sonda-final.js, 17/09/2026) — só entram
//    aqui os endpoints VIVOS + os pares gerados localmente. /sfundo segue
//    desativado (serviço pago/com key — ver cabeçalho).
module.exports = [
  // 💞 PARES — geração local (canvas), sem API externa
  comandoPar({ nome: 'kiss', descricao: 'Manda um beijo juntando a sua foto com a de quem você mencionar (ex: /kiss @fulano).', modo: 'kiss', par: 'mencao' }),
  comandoPar({ nome: 'kissme', descricao: 'Manda um beijo sem precisar mencionar: usa a foto de quem você responder ou a sua própria.', modo: 'kiss', par: 'auto' }),
  comandoPar({ nome: 'ship', descricao: 'Mede a compatibilidade entre você e quem você mencionar, com % na imagem (ex: /ship @fulano).', modo: 'ship', par: 'mencao' }),
  comandoPar({ nome: 'shipme', descricao: 'Sorteia um membro aleatório do grupo e revela a % de compatibilidade com você.', modo: 'ship', par: 'aleatorio' }),

  // 🎭 OVERLAYS — Some Random API (vivos na sonda de 17/09/2026)
  comandoOverlay({ nome: 'jail', descricao: 'Coloca a foto atrás das grades da prisão (ex: /jail @fulano).', rota: 'overlay/jail', legenda: '⛓️ Preso nas sombras do limbo!' }),
  comandoOverlay({ nome: 'triggered', descricao: 'Meme "TRIGGERED" sobre a foto (ex: /triggered @fulano).', rota: 'overlay/triggered', legenda: '😤 TRIGGERED!' }),
  comandoOverlay({ nome: 'wasted', descricao: 'Overlay "WASTED" estilo GTA sobre a foto (ex: /wasted @fulano).', rota: 'overlay/wasted', legenda: '☠️ WASTED' }),
  comandoOverlay({ nome: 'gay', descricao: 'Overlay arco-íris sobre a foto (ex: /gay @fulano).', rota: 'overlay/gay', legenda: '🌈 O arco-íris do sono' }),
  comandoOverlay({ nome: 'glass', descricao: 'Efeito de vidro estilhaçado sobre a foto (ex: /glass @fulano).', rota: 'overlay/glass', legenda: '🪞 Através do vidro...' }),
  comandoOverlay({ nome: 'comrade', descricao: 'Pôster soviético com a foto (ex: /comrade @fulano).', rota: 'overlay/comrade', legenda: '☭ Camarada do limbo!' }),

  // 🎛️ FILTROS — SRA com fallback local (jimp) quando a API cair
  comandoFiltro({ nome: 'circulo', descricao: 'Recorta a foto em formato circular (ex: /circulo @fulano).', rota: 'misc/circle', filtro: 'circulo', legenda: '⭕ Alma em círculo' }),
  comandoFiltro({ nome: 'blur', descricao: 'Desfoca a foto (ex: /blur @fulano).', rota: 'filter/blur', filtro: 'blur', legenda: '🌫️ Tudo embaçado...' }),
  comandoFiltro({ nome: 'greyscale', descricao: 'Foto em preto e branco (ex: /greyscale @fulano).', rota: 'filter/greyscale', filtro: 'greyscale', legenda: '🖤 Preto no branco' }),
  comandoFiltro({ nome: 'grayscale', descricao: 'Foto em preto e branco — mesma coisa do /greyscale, só muda a grafia.', rota: 'filter/greyscale', filtro: 'greyscale', legenda: '🖤 Preto no branco' }),
  comandoFiltro({ nome: 'sepia', descricao: 'Foto com tom sépia vintage (ex: /sepia @fulano).', rota: 'filter/sepia', filtro: 'sepia', legenda: '📜 Um retrato do passado' }),
  comandoFiltro({ nome: 'invert', descricao: 'Inverte as cores da foto (ex: /invert @fulano).', rota: 'filter/invert', filtro: 'invert', legenda: '🔁 Cores do mundo invertidas' }),
  comandoFiltro({ nome: 'clown', descricao: 'Aplica maquiagem de palhaço na foto (ex: /clown @fulano).', rota: 'filter/clown', filtro: null, legenda: '🤡 O circo chegou ao limbo' }),

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
