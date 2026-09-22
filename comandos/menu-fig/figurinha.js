// ============================================
// 🖼️ FIGURINHA (/figurinha) — figurinha SEM CORTE (imagem inteira + fundo transparente)
// ============================================
// Primo "encaixe" do /s (comandos/menu-fig/sticker.js), que CORTA a mídia
// para preencher o quadrado 512×512 (StickerTypes.CROPPED). Aqui a proposta
// é inversa:
//   ✅ a imagem entra INTEIRA (nada é cortado);
//   ✅ encolhe proporcionalmente até caber no quadrado;
//   ✅ o espaço que sobra — laterais (retrato) ou topo/base (paisagem) —
//      é preenchido com FUNDO TRANSPARENTE.
//
// ⚙️ PROCESSAMENTO — ffmpeg em PROCESSO FILHO (execFile + args em ARRAY,
//    nada passa por shell). 🚫 NUNCA sharp/libvips in-process: a regra de
//    ouro do projeto (o libvips/GLib já derrubou o processo do bot sem
//    chance de try/catch). O wa-sticker-formatter NÃO é usado aqui para
//    imagem — só a classe Exif (node-webpmux puro) é reaproveitada.
//
//   Imagem → scale=512:512:force_original_aspect_ratio=decrease,
//            format=yuva420p,                    ← ver "SEGREDO DO ALFA"
//            pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000 → webp (libwebp)
//
// ⚠️ SEGREDO DO ALFA (medido com o ffmpeg embutido do projeto):
//    o `pad` NÃO cria canal alfa — ele propaga o pixel format que chega do
//    `scale`. Se a entrada é JPEG (o caso MAIS comum no WhatsApp) o
//    pipeline negocia um formato SEM alfa e o `color=0x00000000` sai PRETO
//    OPACO: o webp final fica sem o chunk ALPH (VP8X ausente) e o encaixe
//    perde a transparência justamente onde ela é a razão de existir.
//    Medições nesta máquina (mesmo filtro, só variando a entrada):
//      • JPEG de cor sólida (yuvj420p) → VP8X=false ALPH=false alfa=255;
//      • PNG, GIF e JPEG do lavfi testsrc → VP8X=true ALPH=true alfa=0.
//    Com `format=yuva420p` ANTES do pad TODAS as entradas passam a sair
//    com ALPH e padding de alfa 0 (remedido). O filtro continua sendo o do
//    requisito (scale decrease + pad transparente), apenas com o passo de
//    formato explícito no meio — o mesmo remédio já usado no vídeo.
//
// 📥 ENTRADA — as DUAS formas, igual ao /s (o bug do "só reply" não existe
//    aqui; a legenda direta é até prioritária):
//      a) 🖼️ mídia COM o comando na LEGENDA (imageMessage/videoMessage da
//         própria mensagem — o bot.js entrega `.caption` no parâmetro texto);
//      b) 💬 REPLY/citação de uma mídia já enviada.
//    🔓 normalizeMessageContent desembrulha view-once, mensagens temporárias
//    e documentWithCaption ANTES da leitura.
//
// 🏷️ METADADOS — os MESMOS do /s (pack "Hipnos Bot" / autor "Sombras do
//    Limbo") pelo MESMO método: classe Exif do wa-sticker-formatter, que por
//    baixo usa node-webpmux (injeta o chunk EXIF sem re-encodear, logo sem
//    sharp/libvips). Se a injeção falhar, o webp do ffmpeg já vale como
//    figurinha — mesmo fallback tolerante do /s.
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

// ─── 📐 Constantes ───
const LADO = 512                             // lado do quadrado da figurinha
const LIMITE_VIDEO_SEGUNDOS = 10             // igual ao /s e ao /tomp4
const LIMITE_BYTES_MIDIA = 25 * 1024 * 1024  // 25 MB ao baixar (igual /s, /togif, /tomp4)
const LIMITE_BYTES_STICKER = 1024 * 1024     // ~1 MB típico de figurinha no WhatsApp
const FPS_PRIMARIO = 12
const FPS_COMPRIMIDO = 8
const QUALIDADE_PRIMARIA = 80
const QUALIDADE_COMPRIMIDA = 60
const TIMEOUT_FFMPEG_MS = 120000

// ─── 🖼️ Filtro de ENCAIXE da imagem — o do requisito + alfa garantido ───
// decrease: só reduz, preservando a proporção (nunca corta, nunca estoura);
// pad:      completa o quadrado com TRANSPARENTE total (0x00000000).
// format=yuva420p: garante canal alfa na ENTRADA do pad (ver cabeçalho);
// sem ele, entrada JPEG devolve padding PRETO OPACO (medido).
const FILTRO_IMAGEM =
  `scale=${LADO}:${LADO}:force_original_aspect_ratio=decrease,` +
  'format=yuva420p,' +
  `pad=${LADO}:${LADO}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`

// ─── 🎬 Filtro de ENCAIXE do vídeo/GIF animado ───
// Mesma cadeia + `format=yuva420p` antes do pad (ver comentário do cabeçalho:
// sem ele o alfa se perde no caminho de vídeo) + fps de saída da figurinha.
function filtroVideo (fps) {
  return `scale=${LADO}:${LADO}:force_original_aspect_ratio=decrease,` +
    'format=yuva420p,' +
    `pad=${LADO}:${LADO}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,` +
    `fps=${fps}`
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

// ─── 🖼️ Imagem → webp 512×512 (encaixe + fundo transparente) ───
async function gerarWebpComPadding (caminhoEntrada, caminhoSaida) {
  try {
    await rodarExecutavel(
      caminhoFfmpeg(),
      [
        '-y', '-nostdin',
        '-i', caminhoEntrada,
        '-vf', FILTRO_IMAGEM,
        '-c:v', 'libwebp',
        '-lossless', '0',
        '-q:v', String(QUALIDADE_PRIMARIA),
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

// ─── 🎬 Vídeo/GIF → WEBP animado (encaixe 512×512 + transparência) ───
// Mesmo formato do pipeline de vídeo do /s (webp animado, mudo, 12 fps com
// 2ª passada a 8 fps se passar de ~1 MB), só troca o CROP pelo ENCAIXE.
async function videoParaWebpComPadding (caminhoVideo, caminhoWebp, limiteBytes = LIMITE_BYTES_STICKER) {
  const construirArgs = (fps, qualidade) => [
    '-y', '-nostdin',
    '-i', caminhoVideo,
    '-t', String(LIMITE_VIDEO_SEGUNDOS), // rede de segurança: máximo 10s
    '-vf', filtroVideo(fps),
    '-c:v', 'libwebp',
    '-lossless', '0',
    '-q:v', String(qualidade),
    '-loop', '0',
    '-an',
    caminhoWebp
  ]

  try {
    await rodarExecutavel(caminhoFfmpeg(), construirArgs(FPS_PRIMARIO, QUALIDADE_PRIMARIA), TIMEOUT_FFMPEG_MS)
  } catch (err) {
    throw marcarTimeout(err)
  }

  let bytes = fs.existsSync(caminhoWebp) ? fs.statSync(caminhoWebp).size : 0
  if (bytes === 0) throw new Error('ffmpeg não conseguiu produzir o webp animado do vídeo')

  // 🔽 2ª passada se a figurinha fica pesada demais para o WhatsApp
  let segundaPassada = false
  if (bytes > limiteBytes) {
    try {
      await rodarExecutavel(caminhoFfmpeg(), construirArgs(FPS_COMPRIMIDO, QUALIDADE_COMPRIMIDA), TIMEOUT_FFMPEG_MS)
    } catch (err) {
      throw marcarTimeout(err)
    }
    bytes = fs.existsSync(caminhoWebp) ? fs.statSync(caminhoWebp).size : 0
    segundaPassada = true
    if (bytes === 0) throw new Error('ffmpeg não conseguiu produzir o webp comprimido')
  }
  return { bytes, segundaPassada }
}

// ─── 🏷️ Metadados do pack (MESMO método do /s) ───
// O /s injeta EXIF com a classe Exif de wa-sticker-formatter (node-webpmux
// por baixo) — os frames/alfa são preservados porque o arquivo NÃO é
// re-encodado. Usamos a mesma classe com os MESMOS pack/autor/id/categorias,
// importando o módulo interno direto (como o /renomear já faz) para não
// arrastar o pipeline de imagem do wa-sticker-formatter (sharp) à toa.
async function aplicarMetadados (buffer) {
  const { default: ClaseExif } = require('wa-sticker-formatter/dist/internal/Metadata/Exif.js')
  const exif = new ClaseExif({
    pack: 'Hipnos Bot',
    author: 'Sombras do Limbo',
    id: 'hipnos_s_video',
    categories: ['🔮']
  })
  return exif.add(buffer)
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
  '❌ *Não vejo nenhuma mídia para encaixar na figurinha.*\n\n' +
  '*Como usar o /figurinha:*\n' +
  '🖼️ Envie a imagem/GIF/vídeo com `/figurinha` na *legenda* — ou\n' +
  '💬 Responda (cite) uma imagem/GIF/vídeo já enviada com `/figurinha`\n\n' +
  '✨ Aqui a imagem entra INTEIRA no quadrado: o que sobra — laterais ou ' +
  'topo/base — fica com *fundo transparente* (diferente do /s, que corta).\n' +
  '🎬 Vídeos viram figurinha animada (máx. 10 segundos).'

// ─── 💬 Tradução dos erros em mensagens de chat amigáveis ───
function mensagemDeErro (err) {
  const texto = String(err?.mensagemExecutavel || err?.message || '')
  if (err?.codigo === 'ARQUIVO_GRANDE') {
    return '❌ *Arquivo grande demais.*\n\nO limbo aceita mídias de até *25 MB*. ' +
      'Envie uma imagem/vídeo menor e eu encaixo sem cortes.'
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
  // apontam para ESTE comando (modo ENCAIXE: imagem inteira + fundo
  // transparente), enquanto /s, /sticker, /stiker e /sticker2 ficam com o
  // modo CROP. Antes, "fig" e "figurinha" eram apelidos anunciados pelos dois
  // comandos e a precedência dependia da ordem da varredura da pasta; agora
  // cada apelido pertence a um único comando, sem ambiguidade.
  aliases: ['fig'],
  descricao: 'Cria figurinha SEM cortes: imagem inteira encaixada no quadrado 512×512 com fundo transparente.',

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
        text: '⏳ Encaixando sua figurinha nas sombras... (imagem inteira, fundo transparente)'
      }, { quoted: msg })

      const idUnico = `figurinha-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      let stickerBuffer

      if (video) {
        // ─── 🎬 VÍDEO/GIF → figurinha animada (encaixe + transparência) ───
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

        console.log('[figurinha] 🎬 convertendo vídeo → webp animado (encaixe 512×512, fundo transparente)...')
        const { bytes, segundaPassada } = await videoParaWebpComPadding(caminhoEntrada, caminhoWebp)
        console.log(`[figurinha] 🎬 webp animado pronto: ${bytes} bytes${segundaPassada ? ' (2ª passada comprimida)' : ''}`)

        if (bytes > LIMITE_BYTES_STICKER) {
          return await sock.sendMessage(jid, {
            text: '❌ *A figurinha animada ficou pesada demais para o WhatsApp.*\n\n' +
              'Envie um clipe mais curto ou com menos movimento — o encaixe inteiro aumenta a área da imagem.'
          }, { quoted: msg })
        }

        stickerBuffer = fs.readFileSync(caminhoWebp)
        console.log(`[figurinha] 🎬 figurinha animada? ${webpEhAnimado(stickerBuffer) ? 'SIM' : 'NÃO (saiu estática)'}`)
      } else {
        // ─── 🖼️ IMAGEM → figurinha 512×512 (encaixe + transparência) ───
        const buffer = await baixarMidia(imagem, 'image')
        // ⚠️ Sem extensão fixa: o ffmpeg detecta o formato pelo conteúdo.
        caminhoEntrada = path.join(os.tmpdir(), `${idUnico}.img`)
        caminhoWebp = path.join(os.tmpdir(), `${idUnico}.webp`)
        fs.writeFileSync(caminhoEntrada, buffer)

        console.log('[figurinha] 🖼️ encaixando a imagem inteira no quadrado 512×512 (sem cortes)...')
        const { bytes } = await gerarWebpComPadding(caminhoEntrada, caminhoWebp)
        console.log(`[figurinha] 🖼️ webp pronto: ${bytes} bytes`)

        stickerBuffer = fs.readFileSync(caminhoWebp)
      }

      // ─── 🏷️ METADADOS (mesmo pack/autor do /s; falha não derruba o envio) ───
      try {
        const comMetadados = await aplicarMetadados(stickerBuffer)
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
  gerarWebpComPadding,
  videoParaWebpComPadding,
  aplicarMetadados,
  LIMITE_VIDEO_SEGUNDOS,
  LIMITE_BYTES_MIDIA,
  LIMITE_BYTES_STICKER,
  LADO
})


