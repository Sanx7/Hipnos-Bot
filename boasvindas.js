// ============================================================
// 🌙 boasvindas.js — BOAS-VINDAS com BANNER PERSONALIZADO POR GRUPO
// ============================================================
// Responsável por TUDO que acontece quando uma alma nova entra em um grupo
// com o /welcome ligado:
//
//   1) 📝 pega a LEGENDA (customizada do grupo via /legendabv, senão a
//      LEGENDA_PADRAO) e substitui os placeholders @nome, @numero, @grupo
//      e @quantidade;
//   2) 🖼️ pega o BANNER (customizado do grupo via /setbannerbv, senão o
//      arquivo local dados/banners/padrao-boasvindas.png — com fallback para
//      comandos/dados/banners/padrao-boasvindas.png);
//   3) 📸 pega a FOTO do membro (sock.profilePictureUrl + download). Sem
//      foto pública/privacidade/erro → avatar padrão GERADO NA HORA;
//   4) 🎨 compõe a foto dentro da área reservada do banner (modo "cover",
//      preenchendo sem distorcer) — ver AREA_FOTO;
//   5) 📤 envia imagem + legenda, com fallback para TEXTO puro se QUALQUER
//      etapa falhar e com fallback final silencioso (nunca lança).
//
// ️ REGRA DE OURO DO PROJETO — NUNCA usar lib nativa in-process
// (sharp / libvips / canvas nativo) para manipular imagem: já causou
// múltiplos crashes documentados. Toda a composição aqui usa a lib
// **jimp** (JavaScript puro, sem binding nativo).
// Além disso, ao enviar a imagem damos a `jpegThumbnail` PRONTA: com isso
// a Baileys marca requiresThumbnailComputation = false e PULA o
// processamento nativo de imagem dela (mesmo padrão do /perfil e /revelar).
//
// 🔒 AUTORIZAÇÃO: ehAutorizadoNoGrupo() reproduz o MESMO critério do
// /soadm e do /welcome (dono do bot [PROOF-LID] OU admin do grupo OU dono
// do grupo) e é reutilizada pelos comandos /setbannerbv e /legendabv.
//
// Tudo neste módulo NUNCA lança para o listener do Baileys: falha de banco,
// de rede, de imagem ou de envio é logada e resolvida com um fallback.
//
// Uso pelo bot.js (evento group-participants.update, action === 'add'):
//   const { enviarBoasVindas } = require('./boasvindas')
//   await enviarBoasVindas(sock, { grupoId, participanteId, nome, nomeGrupo, totalMembros })
// ============================================================

const fs = require('fs')
const path = require('path')
const { Jimp, JimpMime } = require('jimp')

// 👑 Configurações globais: helpers PROOF-LID (mesmo critério do /soadm) e
// o carregamento do .env (config.js já faz isso na primeira importação).
const { limparNumero, formatarNumero, ehAdminDoGrupo, ehDonoDoBot } = require('./config')

// ️ Persistência POR GRUPO (banner + legenda) — Mongo, collection
// "configuracoesGrupo". obterBanner/obterLegenda NUNCA lançam.
const { obterBanner, obterLegenda } = require('./configuracoes-grupo')
// -------------------------------------------------------------------
// 📐 ÁREA RESERVADA PARA A FOTO DO USUÁRIO DENTRO DO BANNER
// (a moldura dourada do banner padrão, de 1344x768 px)
// x: 550 a 786  → largura 237
// y: 147 a 492  → altura  346
// 📌 Valores MEDIDOS pixel a pixel na arte REAL do projeto
// (dados/banners/padrao-boasvindas.png): a região escura interna da moldura
// (luminância <= 60) forma exatamente este retângulo — as bordas claras
// (o ouro da moldura) ficam FORA dos limites acima.
// ⚠️ Se você trocar o banner padrão, mantenha a moldura EXATAMENTE nestas
// coordenadas (ou ajuste só esta constante).
// -------------------------------------------------------------------
const AREA_FOTO = Object.freeze({ x: 550, y: 147, w: 237, h: 346 })

// 🖼️ Banner padrão (arquivo local, versionado no repositório).
// 🔎 Procura em DOIS caminhos, NA ORDEM — o 1º que existir vence:
//   1) dados/banners/padrao-boasvindas.png          ← arte oficial do projeto
//   2) comandos/dados/banners/padrao-boasvindas.png ← alternativa (é o que
//      scripts/gerar-banner-padrao.js gera)
const CAMINHOS_BANNER_PADRAO = Object.freeze([
  path.join(__dirname, 'dados', 'banners', 'padrao-boasvindas.png'),
  path.join(__dirname, 'comandos', 'dados', 'banners', 'padrao-boasvindas.png')
])

// 📌 Caminho OFICIAL (o 1º da lista) — mantido como constante própria para
// quem só precisa apontar/registrar o arquivo padrão.
const CAMINHO_BANNER_PADRAO = CAMINHOS_BANNER_PADRAO[0]

// 📝 Legenda padrão (usada quando o grupo não tem /legendabv salvo).
const LEGENDA_PADRAO =
  '🌙 *Bem-vindo(a) aos Campos Elísios, @nome.* O sono profundo te aguarda em *@grupo*.'

// 🏷️ Placeholders suportados (usados pelo /legendabv na ajuda ao admin).
const PLACEHOLDERS = Object.freeze(['@nome', '@numero', '@grupo', '@quantidade'])

// 🎨 Ajustes de qualidade/tamanho
const QUALIDADE_JPEG = 92        // banner final (1344x768 ≈ 250-400 KB)
const QUALIDADE_THUMBNAIL = 60   // miniatura enviada pronta à Baileys
const LADO_THUMBNAIL = 64        // ~64px, igual ao padrão do WhatsApp
const COR_FUNDO_BANNER = 0x0b0a1fff // fundo escuro p/ banners PNG transparentes

// 📸 Avatar padrão (gerado em memória com jimp quando o membro não tem foto)
const LADO_AVATAR = 512
const COR_FUNDO_AVATAR = 0x120e24ff
const COR_SILHUETA = [58, 50, 92, 255]

// 📥 Limites do download da foto de perfil (mesmos valores do /perfil)
const LIMITE_BYTES_FOTO = 8 * 1024 * 1024
const TIMEOUT_FOTO_MS = 20000

// 🔔 MARCAR SEMPRE O NOVO MEMBRO: o WhatsApp só "pinga" e destaca quem tem o
// número presente no TEXTO da mensagem + no array `mentions`. Se a legenda
// (padrão ou customizada) não contiver "@<numero>", acrescentamos uma linha
// de menção no fim — assim a alma nova é realmente notificada.
// Coloque `false` se preferir a legenda exatamente como foi escrita.
const MENCIONAR_SEMPRE = true
// -------------------------------------------------------------------
// 🖼️ carregarBannerPadrao(): lê o banner padrão do disco (Buffer) ou null.
// Cacheia por mtime: se o arquivo for trocado em tempo de execução, a
// próxima saudação já usa o novo (sem precisar reiniciar o bot).
// NUNCA lança.
// -------------------------------------------------------------------
let cacheBannerPadrao = null

function carregarBannerPadrao() {
  try {
    const info = fs.statSync(CAMINHO_BANNER_PADRAO)
    if (cacheBannerPadrao && cacheBannerPadrao.mtimeMs === info.mtimeMs) {
      return cacheBannerPadrao.buffer
    }
    const buffer = fs.readFileSync(CAMINHO_BANNER_PADRAO)
    if (!buffer || buffer.length === 0) {
      console.error('[boasvindas] ️ banner padrão vazio em', CAMINHO_BANNER_PADRAO)
      return null
    }
    cacheBannerPadrao = { mtimeMs: info.mtimeMs, buffer }
    return buffer
  } catch (err) {
    console.error('════════════════════════════════════════════════════════')
    console.error('⚠️ [boasvindas] banner padrão NÃO encontrado:', CAMINHO_BANNER_PADRAO)
    console.error('   → Gere um com: node scripts/gerar-banner-padrao.js')
    console.error('   → Ou salve a sua arte nesse caminho (1344x768, moldura em 560,155)')
    console.error('   Por enquanto as boas-vindas seguem só com TEXTO.')
    console.error('════════════════════════════════════════════════════════')
    return null
  }
}

// -------------------------------------------------------------------
// 🖼️ obterBannerDoGrupo(grupoId): banner customizado do grupo (Mongo) ou o
// padrão local. Devolve { buffer, mime, origem } ou null se nenhum existir.
// NUNCA lança.
// -------------------------------------------------------------------
async function obterBannerDoGrupo(grupoId) {
  const customizado = await obterBanner(grupoId)
  if (customizado?.buffer?.length) {
    return {
      buffer: customizado.buffer,
      mime: customizado.mime || JimpMime.png,
      origem: 'customizado'
    }
  }

  const padrao = carregarBannerPadrao()
  if (padrao?.length) {
    return { buffer: padrao, mime: JimpMime.png, origem: 'padrao' }
  }

  return null
}

// -------------------------------------------------------------------
// 📸 gerarAvatarPadrao(): cria em MEMÓRIA (jimp, JS puro) um avatar genérico
// para membros sem foto pública — fundo de névoa com silhueta. O resultado
// (JPEG) é cacheado no processo: o custo é pago uma única vez.
// NUNCA lança (em falha devolve null → o handler envia só texto).
// -------------------------------------------------------------------
let cacheAvatarPadrao = null

async function gerarAvatarPadrao() {
  if (cacheAvatarPadrao) return cacheAvatarPadrao

  try {
    const imagem = new Jimp({
      width: LADO_AVATAR,
      height: LADO_AVATAR,
      color: COR_FUNDO_AVATAR
    })

    const { data, width, height } = imagem.bitmap
    const centroX = width / 2
    const raioCabeca = LADO_AVATAR * 0.19
    const centroCabecaY = LADO_AVATAR * 0.40
    const ombros = {
      x: centroX,
      y: LADO_AVATAR * 0.97,
      rx: LADO_AVATAR * 0.34,
      ry: LADO_AVATAR * 0.34
    }

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const indice = (y * width + x) * 4

        const naCabeca =
          Math.hypot(x - centroX, y - centroCabecaY) <= raioCabeca
        const dx = (x - ombros.x) / ombros.rx
        const dy = (y - ombros.y) / ombros.ry
        const nosOmbros = dx * dx + dy * dy <= 1

        if (naCabeca || nosOmbros) {
          data[indice] = COR_SILHUETA[0]
          data[indice + 1] = COR_SILHUETA[1]
          data[indice + 2] = COR_SILHUETA[2]
          data[indice + 3] = COR_SILHUETA[3]
          continue
        }

        //  Fundo: brilho radial (névoa) em direção ao centro-topo
        const distancia =
          Math.hypot(x - centroX, y - LADO_AVATAR * 0.45) / (LADO_AVATAR * 0.75)
        const brilho = Math.max(0, 1 - distancia)
        data[indice] = Math.min(255, Math.round(18 + brilho * 24))
        data[indice + 1] = Math.min(255, Math.round(14 + brilho * 18))
        data[indice + 2] = Math.min(255, Math.round(36 + brilho * 36))
        data[indice + 3] = 255
      }
    }

    cacheAvatarPadrao = await imagem.getBuffer(JimpMime.jpeg, { quality: 88 })
    console.log(
      `[boasvindas]  avatar padrão gerado em memória (${cacheAvatarPadrao.length} bytes)`
    )
    return cacheAvatarPadrao
  } catch (err) {
    console.error('[boasvindas] ️ não foi possível gerar o avatar padrão:', err?.message || err)
    return null
  }
}
// -------------------------------------------------------------------
// 📥 baixarImagem(url): baixa uma imagem pública (o CDN do WhatsApp) e
// devolve Buffer — ou null. Usa o fetch global do Node 18+ (a mesma API que
// a Baileys usa em getHttpStream), exactamente como o /perfil faz.
// NUNCA lança.
// -------------------------------------------------------------------
async function baixarImagem(url, limiteBytes = LIMITE_BYTES_FOTO, timeoutMs = TIMEOUT_FOTO_MS) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return null
  if (typeof globalThis.fetch !== 'function') return null

  try {
    const resposta = await Promise.race([
      globalThis.fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'WhatsApp/2.24.6.77' }
      }),
      new Promise((_, rejeitar) =>
        setTimeout(() => rejeitar(new Error('timeout ao baixar a imagem')), timeoutMs)
      )
    ])

    if (!resposta.ok) return null

    const bytes = new Uint8Array(await resposta.arrayBuffer())
    if (bytes.length === 0 || bytes.length > limiteBytes) return null
    return Buffer.from(bytes)
  } catch (err) {
    console.error('[boasvindas] ⚠️ falha ao baixar a imagem:', err?.message || err)
    return null
  }
}

// -------------------------------------------------------------------
// 📸 obterFotoMembro(sock, jidMembro): foto de perfil do membro (URL pública
// → download) ou o avatar padrão gerado por nós.
// Devolve { buffer, origem } — `buffer` pode ser null em caso extremo
// (nem avatar foi possível gerar), e aí o handler manda só TEXTO.
// NUNCA lança.
// -------------------------------------------------------------------
async function obterFotoMembro(sock, jidMembro) {
  try {
    if (typeof sock?.profilePictureUrl === 'function') {
      const url = await sock.profilePictureUrl(jidMembro, 'image')
      if (url) {
        const buffer = await dependencias.baixarImagem(url)
        if (buffer?.length) return { buffer, origem: 'foto' }
        console.log('[boasvindas] ️ download da foto falhou — usando avatar padrão')
      }
    }
  } catch (err) {
    // Sem foto / privacidade (item-not-found) / erro de rede → avatar padrão
    console.log(
      '[boasvindas] 📸 membro sem foto pública (será usado o avatar padrão):',
      err?.message || err
    )
  }

  return { buffer: await dependencias.gerarAvatarPadrao(), origem: 'avatar-padrao' }
}

// -------------------------------------------------------------------
// 🎨 comporBanner(bannerBuffer, fotoBuffer): monta a imagem final.
//   - abre o banner (customizado do grupo ou o padrão) com jimp;
//   - achata a transparência sobre um fundo escuro (banners PNG
//     transparentes não viram preto no JPEG final);
//   - redimensiona a FOTO em modo "cover" — preenche a área reservada
//     inteira SEM distorcer (recorta o excesso);
//   - compõe a foto na posição EXATA da moldura (AREA_FOTO);
//   - gera o JPEG final + a miniatura (~64px) que a Baileys recebe pronta.
// Devolve { buffer, mime, jpegThumbnail, largura, altura }. Lança se o
// banner/foto forem inválidos (o chamador trata com o fallback de texto).
// -------------------------------------------------------------------
async function comporBanner(bannerBuffer, fotoBuffer) {
  const bannerOriginal = await Jimp.read(bannerBuffer)

  const largura = bannerOriginal.bitmap.width
  const altura = bannerOriginal.bitmap.height

  // 🖼️ Fundo sólido do tamanho exato do banner (achata transparências)
  const banner = new Jimp({ width: largura, height: altura, color: COR_FUNDO_BANNER })
  banner.composite(bannerOriginal, 0, 0)

  // 📸 Foto do membro: "cover" = preenche a moldura (237x346) SEM distorcer
  const foto = await Jimp.read(fotoBuffer)
  foto.cover({ w: AREA_FOTO.w, h: AREA_FOTO.h })

  // 🎯 Composição na posição exata da moldura dourada
  banner.composite(foto, AREA_FOTO.x, AREA_FOTO.y)

  const buffer = await banner.getBuffer(JimpMime.jpeg, { quality: QUALIDADE_JPEG })

  // 📎 Miniatura pronta (jimp, JS puro): evita o processamento nativo de
  // imagem da Baileys (sharp/libvips in-process) — causa raiz dos crashes
  // antigos do /perfil. Mesmo truque usado lá.
  let jpegThumbnail = null
  try {
    const miniatura = banner.clone()
    miniatura.cover({ w: LADO_THUMBNAIL, h: LADO_THUMBNAIL })
    jpegThumbnail = (
      await miniatura.getBuffer(JimpMime.jpeg, { quality: QUALIDADE_THUMBNAIL })
    ).toString('base64')
  } catch (err) {
    console.error('[boasvindas] ⚠️ falha ao gerar a miniatura (seguimos sem ela):', err?.message)
  }

  return { buffer, mime: JimpMime.jpeg, jpegThumbnail, largura, altura }
}
// -------------------------------------------------------------------
// 📝 montarLegenda(modelo, dados): substitui os placeholders da legenda
//   @nome       → pushName/nome do novo membro (ou o número formatado)
//   @numero     → número do novo membro (somente dígitos)
//   @grupo      → nome do grupo
//   @quantidade → total de membros do grupo APÓS a entrada
// `modelo` vazio/inválido → usa a LEGENDA_PADRAO. NUNCA lança.
// -------------------------------------------------------------------
function montarLegenda(modelo, dados = {}) {
  const texto = typeof modelo === 'string' && modelo.trim() ? modelo : LEGENDA_PADRAO
  return texto
    .replace(/@nome/gi, String(dados.nome ?? ''))
    .replace(/@numero/gi, String(dados.numero ?? ''))
    .replace(/@grupo/gi, String(dados.grupo ?? ''))
    .replace(/@quantidade/gi, String(dados.quantidade ?? ''))
}

// -------------------------------------------------------------------
// 🔔 garantirMencao(legenda, numero): se a legenda não cita "@<numero>",
// acrescenta uma linha com a menção — sem isso o membro novo NÃO é
// notificado pelo WhatsApp (ver MENCIONAR_SEMPRE).
// -------------------------------------------------------------------
function garantirMencao(legenda, numero) {
  if (!MENCIONAR_SEMPRE || !numero) return legenda
  if (legenda.includes(`@${numero}`)) return legenda
  return `${legenda}\n\n👁️‍🗨️ @${numero}`
}

// -------------------------------------------------------------------
// 🔒 ehAutorizadoNoGrupo(sock, jid, sender): MESMO critério de autorização do
// /soadm e do /welcome — dono do bot (PROOF-LID, pois o sender pode chegar
// como "@lid") OU admin do grupo OU dono do grupo.
// Devolve { autorizado, metadados, participantes } e lança apenas se
// groupMetadata falhar (o comando trata e responde com erro amigável).
// -------------------------------------------------------------------
async function ehAutorizadoNoGrupo(sock, jid, sender) {
  const metadados = await sock.groupMetadata(jid)
  const participantes = metadados?.participants || []

  const autorizado =
    ehDonoDoBot(participantes, sender) ||
    ehAdminDoGrupo(participantes, sender) ||
    limparNumero(sender) === limparNumero(metadados?.owner)

  return { autorizado, metadados, participantes }
}

// -------------------------------------------------------------------
// 🧪 DEPENDÊNCIAS INJETÁVEIS (usadas por obterFotoMembro/enviarBoasVindas).
// O gancho __definirDependenciasTeste permite que scripts/teste-boasvindas.js
// rode 100% OFFLINE (sem rede, sem Mongo, sem Baileys) — mesmo padrão do
// gancho __definirColecaoTeste de configuracoes-grupo.js.
// -------------------------------------------------------------------
const DEPENDENCIAS_PADRAO = {
  obterLegenda,
  obterBannerDoGrupo,
  obterFotoMembro,
  comporBanner,
  baixarImagem,
  gerarAvatarPadrao
}

let dependencias = { ...DEPENDENCIAS_PADRAO }

function __definirDependenciasTeste(overrides) {
  dependencias = { ...DEPENDENCIAS_PADRAO, ...(overrides || {}) }
}
// ===================================================================
// 📤 enviarBoasVindas(sock, entrada) — ORQUESTRADOR (chamado pelo bot.js)
// ===================================================================
// entrada = {
//   grupoId,        // JID do grupo (@g.us)
//   participanteId, // JID do novo membro
//   nome,           // (opcional) pushName/notify do novo membro
//   nomeGrupo,      // (opcional) nome do grupo ("subject")
//   totalMembros    // (opcional) total de membros após a entrada
// }
//
// ✅ NUNCA LANÇA e NUNCA TRAVA O BOT. Sequência (com log por etapa):
//   [boasvindas] 📝 legenda → [boasvindas] 🖼️ banner → [boasvindas] 📸 foto
//   → [boasvindas] 🎨 compor → [boasvindas] 📤 enviar
// Se a composição da imagem falhar (ou não houver banner/foto), cai para
// uma mensagem de TEXTO com a mesma legenda; se até o envio falhar, apenas
// registra no log e devolve false.
// ===================================================================
async function enviarBoasVindas(sock, entrada = {}) {
  const grupoId = String(entrada.grupoId || '').trim()
  const jidMembro = String(entrada.participanteId || '').trim()

  if (!sock || !grupoId || !jidMembro) {
    console.error('[boasvindas] ️ chamada inválida (sock/grupo/membro ausente) — ignorando')
    return false
  }

  const numero = limparNumero(jidMembro) || String(jidMembro).split('@')[0]
  const nome = String(entrada.nome || '').trim() || formatarNumero(numero)
  const nomeGrupo = String(entrada.nomeGrupo || '').trim() || 'Recinto'
  const total = Number(entrada.totalMembros)
  const quantidade = Number.isFinite(total) && total > 0 ? total : '—'

  console.log(`[boasvindas] 🌙 nova entrada: ${numero} em "${nomeGrupo}" (${grupoId})`)

  // ── 1) 📝 LEGENDA (customizada do grupo ou a padrão) ──────────────
  let legenda
  try {
    const modelo = (await dependencias.obterLegenda(grupoId)) || LEGENDA_PADRAO
    const ehCustomizada = modelo !== LEGENDA_PADRAO
    legenda = garantirMencao(
      montarLegenda(modelo, { nome, numero, grupo: nomeGrupo, quantidade }),
      numero
    )
    console.log(`[boasvindas] 📝 legenda ${ehCustomizada ? 'CUSTOMIZADA' : 'PADRÃO'} montada (${legenda.length} caracteres)`)
  } catch (err) {
    console.error('[boasvindas] ⚠️ falha ao montar a legenda — usando a padrão:', err?.message || err)
    legenda = garantirMencao(
      montarLegenda(LEGENDA_PADRAO, { nome, numero, grupo: nomeGrupo, quantidade }),
      numero
    )
  }

  // ── 2) 🖼️ BANNER (customizado do grupo ou o arquivo padrão) ───────
  let banner = null
  try {
    banner = await dependencias.obterBannerDoGrupo(grupoId)
    if (banner?.buffer?.length) {
      console.log(`[boasvindas] 🖼️ banner ${banner.origem.toUpperCase()} obtido (${banner.buffer.length} bytes)`)
    } else {
      console.log('[boasvindas] 🖼️ nenhum banner disponível — seguindo só com texto')
    }
  } catch (err) {
    console.error('[boasvindas] ⚠️ falha ao buscar o banner — seguindo só com texto:', err?.message || err)
    banner = null
  }

  // ── 3) 📸 FOTO DO MEMBRO (real ou avatar padrão) ──────────────────
  let foto = { buffer: null, origem: null }
  try {
    foto = await dependencias.obterFotoMembro(sock, jidMembro)
    console.log(
      foto?.buffer?.length
        ? `[boasvindas] 📸 foto ${foto.origem === 'foto' ? 'REAL' : 'PADRÃO'} obtida (${foto.buffer.length} bytes)`
        : '[boasvindas] 📸 nenhuma foto/avatar disponível — seguindo só com texto'
    )
  } catch (err) {
    console.error('[boasvindas] ⚠️ falha ao obter a foto — seguindo só com texto:', err?.message || err)
    foto = { buffer: null, origem: null }
  }

  // ── 4) 🎨 COMPOR o banner com a foto na moldura (jimp) ────────────
  let composicao = null
  if (banner?.buffer?.length && foto?.buffer?.length) {
    try {
      composicao = await dependencias.comporBanner(banner.buffer, foto.buffer)
      console.log(
        `[boasvindas] 🎨 banner composto (${composicao.largura}x${composicao.altura}, ${composicao.buffer.length} bytes)`
      )
    } catch (err) {
      console.error(
        '[boasvindas] 💥 falha ao COMPOR a imagem — enviando a saudação em TEXTO:',
        err?.message || err
      )
      composicao = null
    }
  }

  // ── 5) 📤 ENVIAR (imagem + legenda; texto como fallback) ──────────
  if (composicao?.buffer?.length) {
    try {
      await sock.sendMessage(grupoId, {
        image: composicao.buffer,
        caption: legenda,
        mentions: [jidMembro],
        // 📎 Pronta: faz a Baileys pular o processamento nativo de imagem
        jpegThumbnail: composicao.jpegThumbnail || undefined
      })
      console.log('[boasvindas] ✅ boas-vindas enviadas COM banner 🖼️')
      return true
    } catch (err) {
      console.error(
        '[boasvindas] 💥 falha ao enviar a imagem — caindo para TEXTO puro:',
        err?.message || err
      )
    }
  }

  try {
    await sock.sendMessage(grupoId, { text: legenda, mentions: [jidMembro] })
    console.log('[boasvindas] ✅ boas-vindas enviadas em TEXTO (fallback)')
    return true
  } catch (err) {
    console.error('[boasvindas] 💥 nem o texto pôde ser enviado:', err?.message || err)
    return false
  }
}

module.exports = {
  enviarBoasVindas,
  // 🧩 Peças reutilizadas pelos comandos /setbannerbv e /legendabv (preview)
  montarLegenda,
  garantirMencao,
  ehAutorizadoNoGrupo,
  obterBannerDoGrupo,
  carregarBannerPadrao,
  comporBanner,
  gerarAvatarPadrao,
  // 🔧 Constantes
  AREA_FOTO,
  PLACEHOLDERS,
  LEGENDA_PADRAO,
  CAMINHO_BANNER_PADRAO,
  CAMINHOS_BANNER_PADRAO,
  // 🧪 Gancho de teste
  __definirDependenciasTeste
}