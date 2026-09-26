// ============================================================
// 👤 PERFIL — Pergaminho de identidade de um mortal (uso LIVRE)
// ============================================================
// Exibe o perfil do AUTOR (ou de uma pessoa @mencionada) com:
//   1. FOTO DE PERFIL (real; se não tem → avatar padrão)
//   2. NOME (pushName do autor, ou o nome salvo, ou o número)
//   3. NÚMERO formatado (+55 11 99999-9999)
//   4. RECADO / status ("about") via sock.fetchStatus
//   5-7. % Bonito/Gostoso/Safado (aleatórios, 0-100, a cada chamada)
//   8. Frase filosófica aleatória
//   + Extras: cargo no grupo e estatísticas do /ranking (em grupo)
//
// ⚠️ CAUSA RAIZ DO CRASH CORRIGIDA AQUI (mesmo padrão do /revelar):
//   O envio anterior usava `{ image: { url: fotoUrl } }` SEM jpegThumbnail.
//   Ao preparar a imagem, a Baileys gera a miniatura com a lib nativa
//   sharp/libvips DENTRO do processo (messages-media.js → extractImageThumb),
//   e qualquer falha NATIVA dessa stack mata o processo sem dar chance ao
//   try/catch — por isso o /perfil derrubava a conexão inteira.
//   AGORA a foto é baixada por nós, a miniatura é gerada com o binário
//   ffmpeg em PROCESSO FILHO (nunca toca o sharp) e é entregue pronta via
//   `jpegThumbnail` (com isso requiresThumbnailComputation = false e a lib
//   PULA o processamento de imagem nativo por completo).
//   Se a foto não existe/restrita/falha → avatar padrão embutido.
// ============================================================

const { normalizeMessageContent } = require('@whiskeysockets/baileys')
const { exec } = require('child_process')
const fs = require('fs')
const path = require('path')
const { formatarNumero, acharParticipante, RODAPE_MENU } = require('../config')
const { buscarEstatisticasUsuario, normalizarId } = require('../database')
// 💠 Nome custom dos VIPs (campo `nomeCustom` do documento VIP — /nomecustom):
// quando existe, ele SUBSTITUI o pushName/nome do banco no card.
const vip = require('../vip')
// 🎨 Tema VIP (/temavip — campo `temaVip`): paleta de fundo/texto/destaque
// escolhida pelo VIP; catálogo puro (sem rede/banco) em temas-vip.js.
const temasVip = require('../temas-vip')
// 🖼️ Composição do card temático com JIMP (JS puro) — REGRA DE OURO do
// projeto: nada de sharp/libvips/canvas nativo in-process; é a mesma lib
// com que o boasvindas compõe banner + foto.
const { Jimp, JimpMime, loadFont, measureText } = require('jimp')
const { SANS_32_WHITE } = require('jimp/fonts')

// Usa o binário de FFmpeg instalado no projeto, com fallback para o PATH
const binarioFfmpeg = (() => {
  try {
    return require('@ffmpeg-installer/ffmpeg').path
  } catch (err) {
    return 'ffmpeg'
  }
})()

// 🎭 Avatar padrão (fallback quando não há foto pública ou o download falha).
// Arquivos versionados em comandos/dados; o thumbnail base64 vai EMBUTIDO
// como backup caso os arquivos faltem no deploy.
const RUTA_AVATAR = path.join(__dirname, 'dados', 'avatar-perfil.jpg')
const RUTA_AVATAR_THUMB = path.join(__dirname, 'dados', 'avatar-perfil-thumb.jpg')
const THUMB_AVATAR_BASE64 =
  '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzU4LjQyLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xAB6AAEBAQEAAAAAAAAAAAAAAAAABAMHAQADAQEAAAAAAAAAAAAAAAAAAQMCBRAAAQMCBwADAQAAAAAAAAAAAAMCBAEFVXSSNNMRtEEUFTERAAEDAwAGCwEBAAAAAAAAAAEAAwIRBBNSMiEVYQWzkrKUgXM00zHRQmJR/8AAEQgAQABAAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8A5E98SJEg1rBQXcsi5R71Hr0r3RZ7P4xVtOuqU+DP9CJhcPXK5xcNpa8q/wBCpKdW7u32HsbeKMYtsUGBg/LMCdsmiTUkkklanOUZUFKUj+Y6I4Kr9CJhcPXK5x+hEwuHrlc5KCe8bvSa7vbe0lln/PVj9Kr9CJhcPXK5x+hEwuHrlc5KA3jd6TXd7b2kZZ/z1Y/Sq/QiYXD1yuc0Y+JLiTq0goIORRaox6b1617qsxn8eq6nXVa/BCVW/aXTKs9CRS0u333sbmKUZNv1GBgfDMyNsWgRQgEEFOE5SlQ0pSX5jonglw2lryr/AEKkpVcNpa8q/wBCpKT5h6o+Xb9A2k7r+EeyEABBZQAAhCq37S6ZVnoSJSq37S6ZVnoSL8v9UPLuOgcWmtfwl2Slw2lryr/QqSlVw2lryr/QqShzD1R8u36BtDuv4R7IQAEFlAACEKrftLplWehIlKrftLplWehIvy/1Q8u46Bxaa1/CXZKXDaWvKv8AQqSlz2RJcSDSs6Og5FFyb2KNXrXuqz3/ANYk6nXTqfJn9CJikPRK4Cl3aPPvZG8UoybYoc9uPhmAOyToIoQQQQnOEpSqKUpH9R0RxUoKvoRMUh6JXAPoRMUh6JXAT3ddf413i295LFPh1o/alBV9CJikPRK4B9CJikPRK4A3ddf413i295GKfDrR+1KVW/aXTKs9CQ+hExSHolcBoxkSJEnUpOjruWRamxibV6V7osx/9ek2nXTa/JS0tHmHsjmKMYtv1Oe3PyzMDZF0k1JAAAThCUZVNKUl+o6J4r//2Q=='

// Carrega o avatar padrão (JPEG) a partir dos arquivos do repo; se faltarem,
// usa o thumbnail embutido como último recurso (ficará pequeno mas é
// uma imagem válida e evita depender de bibliotecas nativas para gerá-lo).
function cargarAvatarPadrao() {
  try {
    const b = fs.readFileSync(RUTA_AVATAR)
    if (b && b.length > 0) return Buffer.from(b)
  } catch (e) { /* sigue al respaldo */ }
  try {
    const b = fs.readFileSync(RUTA_AVATAR_THUMB)
    if (b && b.length > 0) return Buffer.from(b)
  } catch (e) { /* sigue al respaldo */ }
  return Buffer.from(THUMB_AVATAR_BASE64, 'base64')
}

/**
 * Baixa uma imagem (URL pública do WhatsApp) e a retorna como Buffer.
 * NUNCA lança: qualquer falha (rede, timeout, tamanho) → null. Usa o fetch
 * global do Node 18+ (a mesma API que a própria Baileys em getHttpStream).
 */
async function descargarFoto(url, limiteBytes = 8 * 1024 * 1024, timeoutMs = 20000) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return null
  if (typeof globalThis.fetch !== 'function') return null
  // ⏱️ Handle do timer do timeout — limpo assim que o download termina.
  // ⚠️ BUG REAL (corrigido): o setTimeout do Promise.race NUNCA era cancelado
  // quando o fetch resolvia/falhava primeiro. Ele seguia ARMADO (ref'd) por até
  // 20s segurando o event loop do processo — o harness de testes ficava
  // pendurado depois do "🏁 Fim dos testes" e cada /perfil com foto deixava um
  // timer + closures vivos à toa. O .finally abaixo garante o clearTimeout nos
  // DOIS caminhos (sucesso e erro), sem mudar nenhum comportamento visível.
  let temporizadorTimeout = null
  try {
    const conTimeout = await Promise.race([
      globalThis.fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'WhatsApp/2.24.6.77' }
      }),
      new Promise((_, rej) => {
        temporizadorTimeout = setTimeout(() => rej(new Error('timeout ao baixar a foto')), timeoutMs)
      })
    ]).finally(() => {
      if (temporizadorTimeout) clearTimeout(temporizadorTimeout)
    })
    if (!conTimeout.ok) return null
    const bytes = new Uint8Array(await conTimeout.arrayBuffer())
    if (bytes.length === 0 || bytes.length > limiteBytes) return null
    return Buffer.from(bytes)
  } catch (err) {
    console.error('[perfil] ⚠️ não foi possível baixar a foto (será usado o avatar padrão):', err?.message || err)
    return null
  }
}

/**
 * Gera o thumbnail JPEG (~64px) com o binário do ffmpeg em PROCESSO FILHO
 * — nunca toca a stack nativa de imagem da Baileys (sharp/libvips).
 * NUNCA lança: retorna null se falhar.
 * @returns {Promise<{base64: string, caminho: string} | null>}
 */
function gerarThumbnailJpeg(caminhoImagem, pastaTemp, idUnico) {
  return new Promise((resolve) => {
    const caminhoThumb = path.join(pastaTemp, `thumb_${idUnico}.jpg`)
    const cmd = `"${binarioFfmpeg}" -y -nostdin -i "${caminhoImagem}" -vf "scale=64:-1" -vframes 1 "${caminhoThumb}"`
    exec(cmd, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (error) => {
      try {
        if (!error && fs.existsSync(caminhoThumb)) {
          const bufferThumb = fs.readFileSync(caminhoThumb)
          if (bufferThumb.length > 0) {
            return resolve({ base64: bufferThumb.toString('base64'), caminho: caminhoThumb })
          }
        }
        console.error('[perfil] ⚠️ ffmpeg não produziu thumbnail:', error?.message || 'arquivo ausente')
      } catch (errLeitura) {
        console.error('[perfil] ⚠️ falha ao ler o thumbnail:', errLeitura?.message)
      }
      resolve(null)
    })
  })
}
// Frases filosóficas / pensamientos aleatorios del /perfil
const FRASES_FILOSOFICAS = [
  'Cada sonho que esquecemos foi uma vida que poderíamos ter vivido.',
  'As sombras só existem onde antes houve luz.',
  'Não dormimos para descansar: dormimos para esquecer o peso do dia.',
  'Quem controla seus sonhos, controla seus medos.',
  'Às vezes a resposta não está em despertar, mas em aprender a sonhar acordado.',
  'O silêncio da noite diz mais que mil conversas de dia.',
  'A lua não ilumina: lembra aos que sabem olhar.',
  'Um mau sonho é só uma história que sua mente inventou para que você valorizasse o despertar.',
  'Vivemos no mundo, mas sonhamos em solidão.',
  'A paciência é a arte de esperar sem que a alma durma.',
  'Atrás de cada pessoa calada há uma tempestade de pensamentos que ninguém quis ouvir.',
  'O tempo não passa: nós o passamos.',
  'Se você não gosta de como amanhece, troca o travesseiro, não o mundo.',
  'As grandes perguntas não se respondem: se habitam.',
  'Tudo o que você ama um dia será lembrança: faça disso agora algo digno de lembrar.',
  'Você não é responsável pela primeira impressão, mas sim pela última.',
  'A verdade é uma sombra que persegue quem foge dela.',
  'O coração pede pouco: um bom sonho, uma boa risada e alguém que te espere.',
  'Faça da sua vida uma resposta tão contundente que o mundo não tenha mais perguntas.',
  'Até a lua, que não tem luz própria, ilumina as noites do mundo.',
  'Se você pudesse ver todos os caminhos, nenhum valeria a pena ser caminhado.',
  'Um sonho sem ação é uma derrota que ainda não se consumou.',
  'Cada noite que cai te presenteia a oportunidade de começar de novo, e em silêncio.',
  'O medo é um sonho que a mente escolhe acreditar.',
  'Não busque a luz: torne-se ela e deixe que a noite te tome como exemplo.',
  'A memória é o sonho que nos permite continuar sendo quem fomos.',
  'Se hoje você não aprendeu nada, não foi culpa do dia: foi que você fechou os olhos.',
  'A escuridão não é a ausência de luz: é a tela onde a imaginação pinta.'
]

// ⚔️ Cargo legible del participante en el grupo (null fuera de grupo)
function cargoDoParticipante(participante) {
  if (!participante) return null
  if (participante.admin === 'superadmin') return '👑 Dono(a) do grupo'
  if (participante.admin === 'admin') return '🛡️ Administrador(a)'
  return '👤 Membro'
}

// 📊 Seção de estatísticas do card (null quando está fora do grupo)
function secaoEstatisticas(estatisticas, bancoIndisponible, emGrupo) {
  if (!emGrupo) return null

  if (estatisticas) {
    const palabra = estatisticas.total > 1 ? 'mensagens' : 'mensagem'
    return (
      `🏆 Posição no ranking: *#${estatisticas.posicao ?? '—'} de ${estatisticas.totalUsuarios ?? '—'} ranqueados*\n` +
      `💬 Mensagens registradas: *${estatisticas.total ?? 0}* ${palabra}`
    )
  }

  if (bancoIndisponible) {
    return '📊 Estatísticas: não disponíveis agora (banco do ranking desativado).'
  }

  return '🌑 *Ainda sem ecos neste recinto* — nenhuma mensagem registrada aqui até agora.'
}
// 🧹 Exclusão tolerante de temporários (nunca lança; falha limpa no Windows)
function apagarComRetry(caminho, tentativas = 3) {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms))
  return (async () => {
    if (!caminho) return
    for (let i = 0; i < tentativas; i++) {
      try {
        if (!fs.existsSync(caminho)) return
        fs.unlinkSync(caminho)
        return
      } catch (err) {
        if (i === tentativas - 1) {
          console.error('⚠️ [perfil] falha ao excluir temporário:', caminho, err?.message)
        } else {
          await espera(150)
        }
      }
    }
  })()
}

// 🎲 Porcentaje aleatorio 0-100 (independiente en cada llamada)
const porcentajeAleatorio = () => Math.floor(Math.random() * 101)

// 🌟 Recado ("about") do contato via USync — NUNCA lança (erros → null)
async function obtenerRecado(sock, jidRecado) {
  try {
    const resultado = await sock.fetchStatus(jidRecado)
    const lista = resultado?.list
    if (!Array.isArray(lista) || lista.length === 0) return null
    const coincidencia = lista.find((item) => normalizarId(item?.id) === normalizarId(jidRecado)) || lista[0]
    const status = coincidencia?.status
    if (typeof status !== 'string' || status.trim().length === 0) return null
    return status.trim()
  } catch (err) {
    // Privacidade (código 401 no parser da lib), contato fora do
    // WhatsApp ou rede instável → exibe "Sem recado definido"
    console.error('[perfil] ⚠️ não foi possível obter o recado:', err?.message || err)
    return null
  }
}

// -------------------------------------------------------------------
// 🎨 CARD TEMÁTICO (/temavip) — a foto do usuário sobre as cores escolhidas
// -------------------------------------------------------------------
// Quando a pessoa DO CARD (a cujo perfil você está olhando) tem `temaVip`,
// o /perfil deixa de mandar a foto crua e manda ESTE card:
//   fundo do tema → foto quadrada com moldura na cor DESTAQUE → faixa
//   inferior (destaque) com o nome impresso na cor de TEXTO do tema.
// Sem tema (mortal, VIP sem escolha, falha aqui ou no banco) o /perfil
// segue 100% como hoje: foto crua + legenda de texto.
// Jimp (JS puro) — mesma lib do boasvindas; envio continua com
// jpegThumbnail pronta via ffmpeg (regra de ouro: nada de sharp in-process).
// -------------------------------------------------------------------
const CARD_LADO = 720                              // lado do card
const CARD_FAIXA = 90                              // altura da faixa (destaque)
const CARD_BORDA = 14                              // espessura da moldura (destaque)
const CARD_FOTO = 500                              // lado da foto (cover, sem distorcer)
const CARD_X_FOTO = (CARD_LADO - CARD_FOTO) / 2                    // 110
const CARD_Y_FOTO = (CARD_LADO - CARD_FAIXA - CARD_FOTO) / 2       // 65

// Cache da fonte bitmap (loadFont é async; carrega uma vez por processo) —
// mesmo padrão do /ttp e do /fake-chat.
const CACHE_FONTE_CARD = new Map()
async function fonteDoCard() {
  if (!CACHE_FONTE_CARD.has(SANS_32_WHITE)) {
    CACHE_FONTE_CARD.set(SANS_32_WHITE, await loadFont(SANS_32_WHITE))
  }
  return CACHE_FONTE_CARD.get(SANS_32_WHITE)
}

// 🟧 Retângulo sólido no bitmap (helper idêntico ao do /fake-chat.js).
function pintarReto(imagem, x, y, w, h, cor) {
  const { width, height } = imagem.bitmap
  const x0 = Math.max(0, x)
  const y0 = Math.max(0, y)
  const x1 = Math.min(width, x + w)
  const y1 = Math.min(height, y + h)
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) imagem.setPixelColor(cor, px, py)
  }
}

// 🖌️ Recolora na cor do tema os pixels BRANCOS de uma região (é o que a
// fonte bitmap imprime). A faixa é preenchida com o DESTAQUE e nenhuma
// paleta usa branco puro como destaque (regra do temas-vip.js) — então
// apenas o texto é tocado aqui.
function recolorirBrancos(imagem, x, y, w, h, cor) {
  const { width, height } = imagem.bitmap
  const x1 = Math.min(width, x + w)
  const y1 = Math.min(height, y + h)
  for (let py = Math.max(0, y); py < y1; py += 1) {
    for (let px = Math.max(0, x); px < x1; px += 1) {
      if (imagem.getPixelColor(px, py) === 0xffffffff) imagem.setPixelColor(cor, px, py)
    }
  }
}

// 🎨 comporCardPerfil(bufferFoto, paleta, nomeExibicao) → PNG Buffer.
// `paleta` é o objeto { fundo, texto, destaque } do temas-vip.js.
async function comporCardPerfil(bufferFoto, paleta, nomeExibicao) {
  const corFundo = temasVip.hexParaJimp(paleta.fundo)
  const corDestaque = temasVip.hexParaJimp(paleta.destaque)
  const corTexto = temasVip.hexParaJimp(paleta.texto)

  const imagem = new Jimp({ width: CARD_LADO, height: CARD_LADO, color: corFundo })

  // 1) Moldura (retângulo DESTAQUE ao redor da área da foto)
  pintarReto(
    imagem,
    CARD_X_FOTO - CARD_BORDA,
    CARD_Y_FOTO - CARD_BORDA,
    CARD_FOTO + CARD_BORDA * 2,
    CARD_FOTO + CARD_BORDA * 2,
    corDestaque
  )

  // 2) Foto (cover 500×500: preenche sem distorcer, corta o excedente)
  const foto = await Jimp.read(bufferFoto)
  foto.cover({ w: CARD_FOTO, h: CARD_FOTO })
  imagem.composite(foto, CARD_X_FOTO, CARD_Y_FOTO)

  // 3) Faixa inferior (DESTAQUE) com o nome do perfil impresso
  const yFaixa = CARD_LADO - CARD_FAIXA
  pintarReto(imagem, 0, yFaixa, CARD_LADO, CARD_FAIXA, corDestaque)

  const font = await fonteDoCard()
  const alturaLinha = font.common?.lineHeight || 32
  let texto = String(nomeExibicao || '').trim() || 'Sem nome'
  const larguraUtil = CARD_LADO - 60
  if (measureText(font, texto) > larguraUtil) {
    while (texto.length > 1 && measureText(font, texto + '...') > larguraUtil) {
      texto = texto.slice(0, -1)
    }
    texto += '...'
  }
  imagem.print({
    font,
    x: Math.round((CARD_LADO - measureText(font, texto)) / 2),
    y: yFaixa + Math.round((CARD_FAIXA - alturaLinha) / 2),
    text: texto
  })
  // Nome impresso em branco → recolorido na cor de TEXTO do tema
  recolorirBrancos(imagem, 0, yFaixa, CARD_LADO, CARD_FAIXA, corTexto)

  return imagem.getBuffer(JimpMime.png)
}
module.exports = {
  nome: 'perfil',
  descricao: 'Mostra o perfil do autor (ou de um @mencionado): foto, nome, número, recado, %% e frase filosófica.',

  async executar(sock, jid, msg) {
    // Caminhos temporários (limpeza no finally)
    let caminhoInput = null
    let caminhoThumbTemp = null
    let caminhoCardTema = null

    try {
      const emGrupo = jid.endsWith('@g.us')
      const sender = msg.key.participant || msg.key.remoteJid

      // 1) Alvo: @mención (si hay) o el autor
      const conteudoMsg = normalizeMessageContent(msg.message) || {}
      const contextInfo = conteudoMsg.extendedTextMessage?.contextInfo
      const alvoJid = contextInfo?.mentionedJid?.[0] || sender

      // 2) Metadados do grupo (resolve LID → phoneNumber e cargo)
      let participantes = []
      if (emGrupo) {
        try {
          participantes = (await sock.groupMetadata(jid)).participants || []
        } catch (err) {
          console.error('[perfil] ⚠️ sem metadados do grupo (perde-se cargo/telefone):', err?.message || err)
        }
      }
      const participante = acharParticipante(participantes, alvoJid)

      // 3) Número de EXIBIÇÃO (resolução de LID)
      const digitosExibicion =
        normalizarId(participante?.phoneNumber) ||
        normalizarId(participante?.id) ||
        normalizarId(alvoJid)

      // 4) Autor?
      const ehAutor = normalizarId(alvoJid) === normalizarId(sender)

      // 5) Estatísticas do /ranking (só em grupo)
      let estatisticas = null
      let bancoIndisponible = false
      if (emGrupo) {
        const candidatos = [...new Set([
          normalizarId(participante?.id),
          normalizarId(participante?.phoneNumber),
          normalizarId(alvoJid)
        ].filter(Boolean))]
        for (const candidato of candidatos) {
          let e = null
          try {
            e = await buscarEstatisticasUsuario(jid, candidato)
          } catch (errBanco) {
            console.error('[perfil] ⚠️ banco do ranking não disponível:', errBanco?.message || errBanco)
          }
          if (!e) { bancoIndisponible = true; continue }
          if (e.total > 0) { estatisticas = e; break }
        }
      }

      // 6) Nome: 🏷️ nome custom do VIP (/nomecustom) > pushName do autor >
      //    nome do banco (mencionados) > número formatado. Só VIP ativo tem
      //    nome custom, e a leitura nunca lança: falha de infra cai no padrão.
      let nomeCustom = null
      try {
        nomeCustom = await vip.obterNomeCustom(participante?.phoneNumber || participante?.id || alvoJid)
      } catch (errNome) {
        console.error('[perfil] ⚠️ falha ao ler o nome custom do VIP:', errNome?.message || errNome)
      }
      const nombreExhibicion =
        nomeCustom ||
        (ehAutor && msg.pushName) ||
        estatisticas?.nome ||
        formatarNumero(digitosExibicion)

      // 🪵 LOG de diagnóstico (etapas) — padrão do /revelar
      console.log(`[perfil] 🔍 alvo=${alvoJid} | emGrupo=${emGrupo} | digits=${digitosExibicion}`)
      console.log('[perfil] 👤 nome/estatísticas OK, passando para o recado...')

      // 7) Recado ("about") — com fetchStatus (nunca lança)
      const recado = await obtenerRecado(sock, participante?.id || alvoJid)
      console.log(`[perfil] 💬 recado: ${recado ? `definido (${recado.length} chars)` : 'não definido/privado'}`)

      // 8) Foto de perfil (si el WhatsApp tiene y la privacidad permite)
      let fotoUrl = null
      try {
        console.log('[perfil] 📸 buscando foto de perfil...')
        fotoUrl = await sock.profilePictureUrl(participante?.id || alvoJid, 'image')
      } catch (err) {
        // sem foto / privacidade / rede → cai para o avatar padrão
        console.error('[perfil] 📸 sem foto pública (será usado avatar padrão):', err?.message || err)
      }

      // 9) Baixa a foto (se houver) → Buffer e thumbnail via ffmpeg (processo filho)
      let bufferImagen = null
      let jpegThumbnail = null
      const idUnico = Math.random().toString(36).substring(2, 10)
      const pastaTemp = path.join(__dirname, 'dados', 'temp')
      // Garante que a pasta temporária existe (está no .gitignore → pode
      // faltar em um deploy/instância nova); sem isso writeFileSync daria
      // ENOENT e o comando cairia no catch de erro genérico.
      try { if (!fs.existsSync(pastaTemp)) fs.mkdirSync(pastaTemp, { recursive: true }) }
      catch (errMkdir) { console.error('[perfil] ⚠️ não foi possível criar a pasta temporária:', errMkdir?.message) }

      if (fotoUrl) {
        console.log('[perfil] ⬇️ baixando foto de perfil...')
        const bufferDescargado = await descargarFoto(fotoUrl)
        if (bufferDescargado) {
          caminhoInput = path.join(pastaTemp, `perfil_${idUnico}.jpg`)
          fs.writeFileSync(caminhoInput, bufferDescargado)
          console.log(`[perfil] ✅ foto baixada (${bufferDescargado.length} bytes), gerando thumbnail via ffmpeg...`)
          const thumb = await gerarThumbnailJpeg(caminhoInput, pastaTemp, idUnico)
          if (thumb) { jpegThumbnail = thumb.base64; caminhoThumbTemp = thumb.caminho }
          else { console.error('[perfil] ⚠️ falha ao gerar thumbnail — usando backup embutido'); jpegThumbnail = THUMB_AVATAR_BASE64 }
          bufferImagen = bufferDescargado
        } else {
          console.error('[perfil] ⚠️ download da foto falhou — será usado avatar padrão')
        }
      }

      // 10) Se não há foto (nem real nem baixável) → avatar padrão
      if (!bufferImagen) {
        bufferImagen = cargarAvatarPadrao()
        // thumbnail do avatar: tenta ffmpeg (processo filho), senão o embutido
        caminhoInput = path.join(pastaTemp, `perfil_${idUnico}.jpg`)
        fs.writeFileSync(caminhoInput, bufferImagen)
        const thumb = await gerarThumbnailJpeg(caminhoInput, pastaTemp, idUnico)
        jpegThumbnail = thumb ? thumb.base64 : THUMB_AVATAR_BASE64
        if (thumb) caminhoThumbTemp = thumb.caminho
        console.log(`[perfil] 🎭 usando avatar padrão (${bufferImagen.length} bytes) como foto de perfil`)
      }
      console.log('[perfil] 🖼️ foto pronta — montando card...')

      // 10.5) 🎨 Tema VIP (/temavip): se a pessoa DO CARD escolheu um tema,
      //       a foto vira um card com fundo/moldura/faixa nas cores dele.
      //       A leitura NUNCA lança; qualquer falha → foto crua (sempre).
      let paletaTema = null
      try {
        const temaDoCard = await vip.obterTemaVip(
          participante?.phoneNumber || participante?.id || alvoJid
        )
        if (temaDoCard) paletaTema = temasVip.obterPaleta(temaDoCard)
      } catch (errTema) {
        console.error('[perfil] ⚠️ falha ao ler o tema VIP:', errTema?.message || errTema)
      }

      if (paletaTema) {
        try {
          const bufferCard = await comporCardPerfil(bufferImagen, paletaTema, nombreExhibicion)
          caminhoCardTema = path.join(pastaTemp, `perfil-card_${idUnico}.png`)
          fs.writeFileSync(caminhoCardTema, bufferCard)
          // Thumbnail do NOVO card (a da foto não representa mais o envio);
          // o caminho é o mesmo `thumb_${idUnico}.jpg` → sobrescreve com -y
          // e o finally continua apagando um arquivo só.
          const thumbCard = await gerarThumbnailJpeg(caminhoCardTema, pastaTemp, idUnico)
          if (thumbCard) {
            jpegThumbnail = thumbCard.base64
            caminhoThumbTemp = thumbCard.caminho
          } else {
            console.error('[perfil] ⚠️ thumbnail do card falhou — mantendo a da foto')
          }
          bufferImagen = bufferCard
          console.log(`[perfil] 🎨 card com tema VIP (${paletaTema.fundo} / ${paletaTema.destaque})`)
        } catch (errCard) {
          console.error('[perfil] ⚠️ falha ao compor o card temático (seguirá a foto crua):', errCard?.message || errCard)
          paletaTema = null
        }
      }

      // 11) Porcentagens aleatórias (independentes por chamada)
      const bonito = porcentajeAleatorio()
      const gostoso = porcentajeAleatorio()
      const safado = porcentajeAleatorio()

      // 12) Frase filosófica aleatória
      const frase = FRASES_FILOSOFICAS[Math.floor(Math.random() * FRASES_FILOSOFICAS.length)]

      // 13) Card
      const cargo = cargoDoParticipante(participante)
      const saiuDoGrupo = emGrupo && participantes.length > 0 && !participante && estatisticas
      const recadoTexto = recado ? recado : '_Sem recado definido_'

      const linhas = [
        '╔══════════════════════════════╗',
        '║     👤 𝐏𝐄𝐑𝐅𝐈𝐋 𝐏𝐀𝐑𝐀 𝐎 𝐋𝐈𝐌𝐁𝐎 👤    ║',
        '╚══════════════════════════════╝',
        '',
        '🌑 A identidade deste mortal, revelada pelas sombras:',
        '',
        `🪪 *Nome:* ${nombreExhibicion}`,
        `🔢 *Número:* ${formatarNumero(digitosExibicion)}`,
        `💬 *Recado:* ${recadoTexto}`
      ]
      if (cargo) linhas.push(`⚔️ *Cargo:* ${cargo}`)
      if (saiuDoGrupo) linhas.push('🚪 *(já não está neste grupo)*')
      linhas.push(
        '',
        '══ 📖 O JUÍZO DO LIMBO ══',
        '',
        `🌹 *Bonito(a):* ${bonito}%`,
        `🔥 *Gostoso(a):* ${gostoso}%`,
        `😈 *Safado(a):* ${safado}%`,
        '',
        `💭 *Pensamento:* "${frase}"`,
        ''
      )

      const rankingTexto = secaoEstatisticas(estatisticas, bancoIndisponible, emGrupo)
      if (rankingTexto) {
        linhas.push('════════════════════', '📊 ECOS NO RECINTO', '', rankingTexto, '')
      }

      linhas.push(
        '(Uso livre — qualquer mortal pode consultar um perfil.)',
        '',
        '════════════════════',
        '',
        RODAPE_MENU
      )
      const card = linhas.join('\n')

      // 14) Envia: SEMPRE imagem (foto real ou avatar) + card como legenda
      // ⚠️ Se entrega `jpegThumbnail` listo: la Baileys PULA el procesamiento
      // nativo de imagen (sharp/libvips in-process) que causaba el crash.
      // Se o envio da imagem falhar → reenvia como TEXTO puro.
      try {
        console.log('[perfil] 📤 enviando card com imagem...')
        await sock.sendMessage(jid, {
          image: bufferImagen,
          caption: card,
          jpegThumbnail
        }, { quoted: msg })
        console.log('[perfil] ✅ card con imagen enviado')
      } catch (erroEnvio) {
        console.error('[perfil] 💥 falha ao enviar com imagem — caindo para texto puro:', erroEnvio?.message || erroEnvio)
        await sock.sendMessage(jid, { text: card }, { quoted: msg }).catch(() => {})
        console.log('[perfil] ✅ card de texto enviado (fallback)')
      }
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa do comando para o socket.
      console.error('[perfil] 💥 erro capturado (o bot continua vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras não puderam revelar este perfil... Tente novamente.'
      }, { quoted: msg }).catch(() => {})
    } finally {
      // 🧹 Limpeza tolerante de temporários (nunca lança)
      for (const caminho of [caminhoInput, caminhoThumbTemp, caminhoCardTema]) {
        if (caminho && fs.existsSync(caminho)) await apagarComRetry(caminho)
      }
    }
  }
}

// 🧪 Exporta utilidades p/ os testes offline (mesmo padrão do /ttp, do
// /fake-chat e do /s): o card temático é testado pixel a pixel sem sock.
Object.assign(module.exports, {
  comporCardPerfil,
  CARD_LADO,
  CARD_FAIXA,
  CARD_BORDA,
  CARD_FOTO,
  CARD_X_FOTO,
  CARD_Y_FOTO
})