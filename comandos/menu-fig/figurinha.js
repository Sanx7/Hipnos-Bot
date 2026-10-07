// ============================================
// 🖼️ FIGURINHA (/figurinha) — figurinha SEM CORTE (imagem ESTICADA no quadrado todo)
// ============================================
// Primo "sem corte" do /s (comandos/menu-fig/sticker.js), que CORTA a mídia
// para preencher o quadrado 512×512 (StickerTypes.CROPPED). Aqui a proposta
// é inversa:
//   ✅ a imagem entra INTEIRA (nada é cortado);
//   ✅ é ESTICADA/ESPREMIDA até preencher o quadrado 512×512 INTEIRO;
//   ✅ nada sobra: sem faixas transparentes e sem cor de fundo de preenchimento.
//
// 🪞 O PREÇO (e o motivo do comando existir): esticar muda a PROPORÇÃO da
//    imagem — uma foto 300×600 (retrato estreito) sai mais "larga" que o
//    original e uma 600×300 sai mais "alta". É o preço de não cortar nada:
//    o /s corta para manter a proporção; o /figurinha estica para não cortar.
//    A escolha fica sempre com o usuário (são comandos separados).
//
// ⚙️ PROCESSAMENTO — ffmpeg em PROCESSO FILHO (execFile + args em ARRAY,
//    nada passa por shell). 🚫 NUNCA sharp/libvips in-process: a regra de
//    ouro do projeto (o libvips/GLib já derrubou o processo do bot sem
//    chance de try/catch). O wa-sticker-formatter NÃO é usado aqui para
//    imagem — só a classe Exif (node-webpmux puro) é reaproveitada.
//
//   Imagem → scale=512:512 (SEM force_original_aspect_ratio) → webp (libwebp)
//
// 🚫 SEM ALFA DE PADDING: o antigo `pad=512:512:...:color=0x00000000` (e o
//    `format=yuva420p`, que existia SÓ para o pad ganhar canal alfa — ver o
//    histórico no git) saíram junto com o encaixe proporcional. Como agora a
//    imagem cobre o quadrado TODO, não existe sobra para preencher: o webp
//    sai opaco e alguns KB menor (sem o canal de alfa que ia em cada frame
//    do vídeo/GIF — o que até ajuda na escada de compressão).
//    ⚠️ Transparência que venha DA PRÓPRIA MÍDIA (um PNG com fundo vazado,
//    por exemplo) segue sendo preservada: o `scale` só muda o tamanho.
//
// 📥 ENTRADA — as DUAS formas, igual ao /s (o bug do "só reply" não existe
//    aqui; a legenda direta é até prioritária):
//      a) 🖼️ mídia COM o comando na LEGENDA (imageMessage/videoMessage da
//         própria mensagem — o bot.js entrega `.caption` no parâmetro texto);
//      b) 💬 REPLY/citação de uma mídia já enviada.
//    🔓 normalizeMessageContent desembrulha view-once, mensagens temporárias
//    e documentWithCaption ANTES da leitura.
//
// 🏷️ METADADOS — os MESMOS do /s (pack = packCustom quando há, "Hipnos Bot"
//    quando não + autor = assinatura VIP quando há, "Sombras do Limbo"
//    quando não) pelo MESMO método: classe Exif do wa-sticker-formatter, que
//    por baixo usa node-webpmux (injeta o chunk EXIF sem re-encodear, logo sem
//    sharp/libvips). Se a injeção falhar, o webp do ffmpeg já vale como
//    figurinha — mesmo fallback tolerante do /s.
//
// ✍️📦 ASSINATURA VIP (/assinatura e /assinatura pack): NÃO é marca d'água
//    desenhada — são os nomes de PACK e AUTOR no EXIF (o "pack • autor" que o
//    WhatsApp mostra ao segurar a figurinha). Os dois personalizáveis
//    separadamente pelo VIP.
//
// 🧹 Temporários: sempre apagados no finally com apagarComRetry (o padrão
//    compartilhado do projeto contra EPERM/EBUSY do Windows/antivírus).
// ============================================

const {
  downloadContentFromMessage,
  normalizeMessageContent
} = require('@whiskeysockets/baileys')
// 🛠️ Helpers compartilhados do projeto (mesmo par usado por /play e /tiktok):
// binário do ffmpeg embutido + exclusão com retry.
const { caminhoFfmpeg, apagarComRetry } = require('../menu-utilitario/audio-extrator')
const { rodarExecutavel, webpEhAnimado } = require('./webp-animado')
const fs = require('fs')
const os = require('os')
const path = require('path')
// 💠 Assinatura VIP (campos `assinatura` e `packCustom` do documento de VIP —
// /assinatura e /assinatura pack): UMA consulta tolerante por figura. Sem VIP,
// sem assinatura ou sem banco, o EXIF sai no padrão (a imagem/webp sai
// EXATAMENTE como hoje).
const vip = require('../../vip')
// 🪪 Número REAL de quem enviou (vip-acesso.js, fonte única do pacote VIP): o
// documento de VIP é gravado pelo TELEFONE (/assinatura e /darvip resolvem o
// LID antes de gravar), então consultar a assinatura com o "@lid" cru nunca
// acha nada — resolvido aqui pelos metadados do grupo (mesmo remédio do /s,
// do /corvip e do /ranking).
const { resolverAutorVip } = require('../../vip-acesso')

// 🏷️ EXIF padrão (pack fixo + autor padrão — mesmos do /s).
const PACK_PADRAO = 'Hipnos Bot'
const AUTOR_PADRAO = 'Sombras do Limbo'

// 🧪 Gancho de teste: troca o executor do ffmpeg (padrão _injetar* do projeto).
// Sem injeção, roda o ffmpeg de verdade — o comportamento não muda.
let rodar = rodarExecutavel

// ─── 📐 Constantes ───
const LADO = 512                             // lado do quadrado da figurinha
const LIMITE_VIDEO_SEGUNDOS = 10             // igual ao /s e ao /tomp4
const LIMITE_BYTES_MIDIA = 25 * 1024 * 1024  // 25 MB ao baixar (igual /s, /togif, /tomp4)
const LIMITE_BYTES_STICKER = 1024 * 1024     // ~1 MB típico de figurinha no WhatsApp
const QUALIDADE_IMAGEM = 80                  // qualidade do webp ESTÁTICO (libwebp)
const TIMEOUT_FFMPEG_MS = 120000

// ─── 🎬 ESCADA DE COMPRESSÃO do vídeo (MESMA do /s) ───
// 🔍 Por que existe: o WhatsApp decodifica a figurinha animada EM TEMPO REAL
//    no aparelho. Arquivo grande demais (ou denso demais por frame) não é
//    decodificado a 12 fps e a animação "escorrega" — na prática parece rodar
//    a ~2 fps, mesmo com os delays CERTOS dentro do container webp.
// ✅ Como funciona: tentamos degraus até o webp CABER em ~1 MB. Primeiro cai
//    a QUALIDADE (a animação segue a 12 fps, só perde nitidez) e o FPS só cai
//    nos últimos degraus, porque é ele que dá a fluidez. O degrau 0 é o
//    pipeline original (12 fps / q80) — nada que já cabia muda de resultado.
// 📏 O bloco completo, com as medições de tamanho desta máquina, está em
//    comandos/menu-fig/sticker.js (constante ESCADA_COMPRESSAO).
const ESCADA_COMPRESSAO = [
  { fps: 12, qualidade: 80 }, // degrau 0: o pipeline original (nada piora)
  { fps: 12, qualidade: 65 },
  { fps: 12, qualidade: 45 },
  { fps: 12, qualidade: 30 },
  { fps: 10, qualidade: 25 }, // daqui para baixo já é perda de fluidez
  { fps: 8,  qualidade: 20 },
  { fps: 6,  qualidade: 18 }  // último degrau: quase sempre cabe em 1 MB
]

// ─── 🖼️ Filtro de ESTICAMENTO da imagem — preenche o quadrado INTEIRO ───
// ⚠️ `scale` DIRETO em 512:512, SEM `force_original_aspect_ratio`: o ffmpeg
//    espreme/estica a imagem para caber EXATAMENTE no quadrado, ignorando a
//    proporção original (é o requisito do comando). Sem `pad` e sem `crop`:
//    não sobra espaço para preencher e nada é cortado.
const FILTRO_IMAGEM = `scale=${LADO}:${LADO}`

// ─── 🎬 Filtro do vídeo/GIF animado — MESMO esticamento + fps de saída ───
// Mesma cadeia do estático (scale forçado, sem pad, sem crop e sem o antigo
// alfa de padding) com o `fps` da figurinha animada no fim.
function filtroVideo (fps) {
  return `scale=${LADO}:${LADO},fps=${fps}`
}

// ─── 🧯 Marca timeouts do ffmpeg na MESMA convenção do projeto ───
// (mantém compatível com a classificação de erro usada em /tomp3 e /play)
function marcarTimeout (err) {
  const texto = String(err?.mensagemExecutavel || err?.message || '')
  if (err?.killed || err?.signal === 'SIGKILL' || err?.code === 'ETIMEDOUT' || /timed out/i.test(texto)) {
    err.timeout = true
  }
  return err
}

// ─── 🖼️ Imagem → webp 512×512 (esticada: preenche o quadrado todo) ───
async function gerarWebpEsticado (caminhoEntrada, caminhoSaida) {
  try {
    await rodar(
      caminhoFfmpeg(),
      [
        '-y', '-nostdin',
        '-i', caminhoEntrada,
        '-vf', FILTRO_IMAGEM,
        '-c:v', 'libwebp',
        '-lossless', '0',
        '-quality', String(QUALIDADE_IMAGEM), // mesmo parâmetro do -q:v (medido)
        '-an',
        caminhoSaida
      ],
      TIMEOUT_FFMPEG_MS
    )
  } catch (err) {
    throw marcarTimeout(err)
  }

  const bytes = fs.existsSync(caminhoSaida) ? fs.statSync(caminhoSaida).size : 0
  if (bytes === 0) throw new Error('o ffmpeg não conseguiu produzir o webp da figurinha')
  return { bytes }
}

// ─── 🎬 Vídeo/GIF → WEBP animado (esticado no quadrado 512×512) ───
// Mesmo pipeline de vídeo do /s (webp animado, mudo, começando a 12 fps), só
// troca o CROP pelo ESTICAMENTO. Tamanho é o que manda na fluidez: descemos a
// MESMA ESCADA de compressão do /s (primeiro a qualidade, o fps só no fim)
// até o webp caber em ~1 MB — arquivo pesado roda travado no celular, porque
// o WhatsApp decodifica a figurinha em tempo real (ver o bloco completo em
// comandos/menu-fig/sticker.js).
async function videoParaWebpEsticado (caminhoVideo, caminhoWebp, limiteBytes = LIMITE_BYTES_STICKER) {
  const construirArgs = (fps, qualidade) => [
    '-y', '-nostdin',
    '-i', caminhoVideo,
    '-t', String(LIMITE_VIDEO_SEGUNDOS), // rede de segurança: máximo 10s
    '-vf', filtroVideo(fps),
    '-c:v', 'libwebp',
    '-lossless', '0',
    '-quality', String(qualidade),       // ver bloco ESCADA_COMPRESSAO do /s
    '-loop', '0',
    '-an',
    caminhoWebp
  ]

  // 🔽 Desce a escada até CABER (o 1º degrau que couber é o escolhido).
  let bytes = 0
  let indice = 0
  for (; indice < ESCADA_COMPRESSAO.length; indice += 1) {
    const { fps, qualidade } = ESCADA_COMPRESSAO[indice]
    try {
      await rodar(caminhoFfmpeg(), construirArgs(fps, qualidade), TIMEOUT_FFMPEG_MS)
    } catch (err) {
      throw marcarTimeout(err)
    }
    bytes = fs.existsSync(caminhoWebp) ? fs.statSync(caminhoWebp).size : 0
    if (bytes === 0) throw new Error('ffmpeg não conseguiu produzir o webp animado do vídeo')
    if (bytes <= limiteBytes) break
  }
  // Se nem o último degrau coube, devolve o último mesmo (o chamador avisa).
  if (indice >= ESCADA_COMPRESSAO.length) indice = ESCADA_COMPRESSAO.length - 1
  const { fps, qualidade } = ESCADA_COMPRESSAO[indice]

  return { bytes, segundaPassada: indice > 0, degrau: indice, fps, qualidade }
}

// ─── 🏷️ Metadados do pack (MESMO método do /s) ───
// O /s injeta EXIF com a classe Exif de wa-sticker-formatter (node-webpmux
// por baixo) — os frames/alfa são preservados porque o arquivo NÃO é
// re-encodado. Usamos a mesma classe com o MESMO pack padrão/id/categorias,
// importando o módulo interno direto (como o /renomear já faz) para não
// arrastar o pipeline de imagem do wa-sticker-formatter (sharp) à toa.
// ✍️ `autor` é a assinatura VIP quando há (senão AUTOR_PADRAO); `pack` é o
// pack custom quando há (senão PACK_PADRAO) — mesma lógica do autor.
async function aplicarMetadados (buffer, autor = null, pack = null) {
  const { default: ClaseExif } = require('wa-sticker-formatter/dist/internal/Metadata/Exif.js')
  const exif = new ClaseExif({
    pack: pack || PACK_PADRAO,
    author: autor || AUTOR_PADRAO,
    id: 'hipnos_s_video',
    categories: ['🔮']
  })
  return exif.add(buffer)
}

// ─── ✍️ Resolve o nome de AUTOR do EXIF para o autor resolvido ───
// Consulta tolerante ao documento de VIP (NUNCA lança): sem VIP, sem
// assinatura ou com o banco fora, devolve AUTOR_PADRAO e o EXIF segue padrão.
// 🪪 O chamador passa SEMPRE o número resolvido via resolverAutorVip (LID cru
// nunca acha o documento — era o bug que apagava a assinatura em grupos).
async function resolverAutorExif (autorVip) {
  try {
    const assinatura = await vip.obterAssinatura(autorVip)
    if (assinatura) return assinatura
  } catch (errAssinatura) {
    console.error('[figurinha] ⚠️ falha ao ler a assinatura (EXIF padrão):', errAssinatura?.message || errAssinatura)
  }
  return AUTOR_PADRAO
}

// ─── 📦 Resolve o nome do PACK do EXIF para o autor resolvido ───
// Mesma lógica do autor: packCustom do VIP quando há, PACK_PADRAO quando não.
// NUNCA lança.
async function resolverPackExif (autorVip) {
  try {
    const packCustom = await vip.obterPackCustom(autorVip)
    if (packCustom) return packCustom
  } catch (errPack) {
    console.error('[figurinha] ⚠️ falha ao ler o pack custom (EXIF padrão):', errPack?.message || errPack)
  }
  return PACK_PADRAO
}

// ─── ✍️📦 Resolve AUTOR + PACK do EXIF numa consulta só ───
// Atalho que o executar usa (evita 2 idas ao banco); NUNCA lança.
async function resolverExif (autorVip) {
  try {
    const completo = await vip.obterAssinaturaCompleta(autorVip)
    return {
      autor: completo?.autor || AUTOR_PADRAO,
      pack: completo?.pack || PACK_PADRAO
    }
  } catch (errExif) {
    console.error('[figurinha] ⚠️ falha ao ler a assinatura completa (EXIF padrão):', errExif?.message || errExif)
    return { autor: AUTOR_PADRAO, pack: PACK_PADRAO }
  }
}

// ─── 📥 Download seguro da mídia (com teto de bytes) ───
async function baixarMidia (no, tipo) {
  const stream = await downloadContentFromMessage(no, tipo)
  let buffer = Buffer.from([])
  for await (const parte of stream) {
    buffer = Buffer.concat([buffer, parte])
    if (buffer.length > LIMITE_BYTES_MIDIA) {
      const err = new Error('A mídia supera o limite de 25 MB ao ser baixada.')
      err.codigo = 'ARQUIVO_GRANDE'
      throw err
    }
  }
  if (buffer.length === 0) {
    const err = new Error('A mídia foi baixada vazia (0 bytes).')
    err.codigo = 'MIDIA_VAZIA'
    throw err
  }
  return buffer
}

// ─── 💬 Aviso amigável de "como usar" (nenhuma mídia encontrada) ───
const AJUDA =
  '❌ *Não vejo nenhuma mídia para virar figurinha.*\n\n' +
  '*Como usar o /figurinha:*\n' +
  '🖼️ Envie a imagem/GIF/vídeo com `/figurinha` na *legenda* — ou\n' +
  '💬 Responda (cite) uma imagem/GIF/vídeo já enviada com `/figurinha`\n\n' +
  '✨ Aqui a imagem entra INTEIRA e é *esticada* até preencher todo o ' +
  'quadrado 512×512 (diferente do /s, que corta para manter a proporção) — ' +
  'uma foto muito retangular sai com a forma alterada, mas nada é cortado.\n' +
  '🎬 Vídeos viram figurinha animada (máx. 10 segundos).'

// ─── 💬 Tradução dos erros em mensagens de chat amigáveis ───
function mensagemDeErro (err) {
  const texto = String(err?.mensagemExecutavel || err?.message || '')
  if (err?.codigo === 'ARQUIVO_GRANDE') {
    return '❌ *Arquivo grande demais.*\n\nO limbo aceita mídias de até *25 MB*. ' +
      'Envie uma imagem/vídeo menor e eu estico sem cortes.'
  }
  if (err?.timeout || err?.killed || err?.signal === 'SIGKILL' || /timed out/i.test(texto)) {
    return '⏱️ *O limbo demorou demais para tecer este encaixe.*\n\n' +
      'A mídia pode estar pesada ou travada. Tente de novo com um arquivo menor.'
  }
  if (err?.codigo === 'MIDIA_VAZIA' || /Invalid data found|Unable to find a suitable output format|matches no streams|does not contain any stream/i.test(texto)) {
    return '❌ *Não consegui ler esta mídia.*\n\n' +
      'O arquivo parece corrompido ou em um formato que o encaixe não entende. ' +
      'Tente outra imagem/vídeo.'
  }
  return '❌ O feitiço do encaixe falhou... As sombras não conseguiram montar a figurinha. Tente novamente em instantes.'
}

module.exports = {
  nome: 'figurinha',
  // 🏷️ ALIASES: só /fig (atalho curto). O nome do comando já é "/figurinha",
  // por isso ele não se repete aqui — o loader registra `nome` + `aliases`.
  //
  // 🔀 DIVISÃO COM O /s (comandos/menu-fig/sticker.js): /fig e /figurinha
  // apontam para ESTE comando (modo ESTICAR: imagem inteira, esticada até
  // preencher o quadrado 512×512, sem cortar nada), enquanto /s, /sticker,
  // /stiker e /sticker2 ficam com o modo CROP. Antes, "fig" e "figurinha"
  // eram apelidos anunciados pelos dois comandos e a precedência dependia da
  // ordem da varredura da pasta; agora cada apelido pertence a um único
  // comando, sem ambiguidade.
  aliases: ['fig','f','figu'],
  descricao: 'Cria figurinha SEM cortes: a imagem inteira é esticada até preencher todo o quadrado 512×512.',

  async executar (sock, jid, msg, texto) {
    let caminhoEntrada = null
    let caminhoWebp = null

    try {
      // ─── 📎 CAPTURA DA MÍDIA (2 caminhos, nesta ORDEM de prioridade) ───
      // a) mídia DIRETA com o comando na legenda (vence sempre);
      // b) mídia CITADA no reply (fallback).
      // ⚠️ A ordem importa: quem manda uma foto COM "@/figurinha" na legenda
      // respondendo outra mídia quer a PRÓPRIA foto encaixada.
      const conteudoMsg = normalizeMessageContent(msg.message) || {}
      const contexto = conteudoMsg.extendedTextMessage?.contextInfo ||
        conteudoMsg.imageMessage?.contextInfo || conteudoMsg.videoMessage?.contextInfo
      const conteudoCotado = normalizeMessageContent(contexto?.quotedMessage) || {}
      const veioNaLegenda = Boolean(conteudoMsg.imageMessage || conteudoMsg.videoMessage)
      const origem = veioNaLegenda ? conteudoMsg : conteudoCotado
      const imagem = origem.imageMessage
      const video = origem.videoMessage

      if (!imagem && !video) {
        return await sock.sendMessage(jid, { text: AJUDA }, { quoted: msg })
      }

      console.log(`[figurinha] 📎 mídia capturada: ${video ? 'vídeo' : 'imagem'} ${veioNaLegenda ? 'direta (legenda com o comando)' : 'citada (reply)'}`)

      await sock.sendMessage(jid, {
        text: '⏳ Esticando sua figurinha nas sombras... (imagem inteira, sem cortes)'
      }, { quoted: msg })

      const idUnico = `figurinha-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      let stickerBuffer

      // ─── ✍️📦 AUTOR + PACK DO EXIF (VIP, /assinatura e /assinatura pack) ───
      // Uma consulta tolerante ao documento de VIP. Sem VIP, sem assinatura ou
      // com o banco fora, cai no padrão (pack "Hipnos Bot" + autor padrão).
      // Falha aqui NUNCA derruba a figurinha: o custom é um extra.
      // 🪪 Número REAL de quem enviou (vip-acesso.js): é ele que indexa o
      // documento de VIP lido aqui — ver a nota do require no topo.
      const { numero: autorVip } = await resolverAutorVip(sock, jid, msg, 'figurinha')
      const { autor: autorExif, pack: packExif } = await resolverExif(autorVip)
      if (autorExif !== AUTOR_PADRAO || packExif !== PACK_PADRAO) {
        console.log(`[figurinha] ✍️ assinatura no EXIF: "${packExif} • ${autorExif}"`)
      }

      if (video) {
        // ─── 🎬 VÍDEO/GIF → figurinha animada (esticado, sem cortes) ───
        const segundos = Number(video.seconds || 0)
        if (segundos > LIMITE_VIDEO_SEGUNDOS) {
          return await sock.sendMessage(jid, {
            text: `⏱️ *Limite de ${LIMITE_VIDEO_SEGUNDOS} segundos*\n\nSeu vídeo dura ${segundos}s. ` +
              `Envie um clipe mais curto (máx. ${LIMITE_VIDEO_SEGUNDOS}s) que eu encaixo sem cortes.`
          }, { quoted: msg })
        }

        const buffer = await baixarMidia(video, 'video')
        caminhoEntrada = path.join(os.tmpdir(), `${idUnico}.mp4`)
        caminhoWebp = path.join(os.tmpdir(), `${idUnico}.webp`)
        fs.writeFileSync(caminhoEntrada, buffer)

        console.log('[figurinha] 🎬 convertendo vídeo → webp animado (esticado no quadrado 512×512, sem cortes)...')
        const { bytes, segundaPassada, fps, qualidade } = await videoParaWebpEsticado(caminhoEntrada, caminhoWebp)
        console.log(`[figurinha] 🎬 webp animado pronto: ${bytes} bytes @ ${fps} fps/q${qualidade}${segundaPassada ? ' (escada de compressão)' : ''}`)

        if (bytes > LIMITE_BYTES_STICKER) {
          return await sock.sendMessage(jid, {
            text: '🐢 *Esta animação é pesada demais para virar figurinha.*\n\n' +
              'O WhatsApp decodifica a figurinha animada em tempo real no aparelho: ' +
              'um arquivo grande demais roda *travado* (parece câmera lenta). ' +
              'Envie um clipe *mais curto* ou com *menos movimento* — esticar a ' +
              'imagem para o quadrado inteiro pesa mais que o recorte do /s.'
          }, { quoted: msg })
        }

        stickerBuffer = fs.readFileSync(caminhoWebp)
        console.log(`[figurinha] 🎬 figurinha animada? ${webpEhAnimado(stickerBuffer) ? 'SIM' : 'NÃO (saiu estática)'}`)
      } else {
        // ─── 🖼️ IMAGEM → figurinha 512×512 (esticada, sem cortes) ───
        const buffer = await baixarMidia(imagem, 'image')
        // ⚠️ Sem extensão fixa: o ffmpeg detecta o formato pelo conteúdo.
        caminhoEntrada = path.join(os.tmpdir(), `${idUnico}.img`)
        caminhoWebp = path.join(os.tmpdir(), `${idUnico}.webp`)
        fs.writeFileSync(caminhoEntrada, buffer)

        console.log('[figurinha] 🖼️ esticando a imagem para preencher o quadrado 512×512 inteiro (sem cortes)...')
        const { bytes } = await gerarWebpEsticado(caminhoEntrada, caminhoWebp)
        console.log(`[figurinha] 🖼️ webp pronto: ${bytes} bytes`)

        stickerBuffer = fs.readFileSync(caminhoWebp)
      }

      // ─── 🏷️ METADADOS (pack + autor; falha não derruba o envio) ───
      try {
        const comMetadados = await aplicarMetadados(stickerBuffer, autorExif, packExif)
        if (comMetadados && comMetadados.length > 0) stickerBuffer = comMetadados
      } catch (errMetadados) {
        console.error('[figurinha] ⚠️ não foi possível injetar os metadados (enviando o webp cru):', errMetadados?.message || errMetadados)
      }

      if (!Buffer.isBuffer(stickerBuffer) || stickerBuffer.length === 0) {
        throw new Error('a figurinha saiu vazia')
      }

      await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg })
      console.log('[figurinha] ✅ figurinha enviada com sucesso')
    } catch (err) {
      console.error('[figurinha] 💥 erro ao gerar figurinha:', err?.stack || err)
      if (err?.mensagemExecutavel) console.error('[figurinha] 📎 stderr do ffmpeg:', err.mensagemExecutavel)
      await sock.sendMessage(jid, { text: mensagemDeErro(err) }, { quoted: msg }).catch(() => {})
    } finally {
      // 🧹 Limpeza sempre (inclusive em erro) — nunca lança
      for (const caminho of [caminhoEntrada, caminhoWebp]) {
        if (caminho) await apagarComRetry(caminho)
      }
    }
  }
}

// Exporta utilidades para os testes (mesmo padrão do /s e do webp-animado.js)
Object.assign(module.exports, {
  FILTRO_IMAGEM,
  filtroVideo,
  gerarWebpEsticado,
  videoParaWebpEsticado,
  aplicarMetadados,
  resolverAutorExif,
  resolverPackExif,
  resolverExif,
  PACK_PADRAO,
  AUTOR_PADRAO,
  LIMITE_VIDEO_SEGUNDOS,
  LIMITE_BYTES_MIDIA,
  LIMITE_BYTES_STICKER,
  QUALIDADE_IMAGEM,
  ESCADA_COMPRESSAO,
  LADO,
  // 🧪 Gancho dos testes offline: substitui o executor do ffmpeg (passar
  // null volta ao ffmpeg real).
  _injetarRodarExecutavel: (fn) => { rodar = fn || rodarExecutavel }
})


