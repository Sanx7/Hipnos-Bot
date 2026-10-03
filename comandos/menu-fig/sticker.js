// ============================================
// 📸 STICKER (/s) — Imagens, GIFs e VÍDEOS → Figurinha de WhatsApp
// ============================================
// - Imagens/GIFs → wa-sticker-formatter (como sempre).
// - Vídeo → pipeline com o ffmpeg EMBUTIDO (@ffmpeg-installer/ffmpeg):
//   1) ⏱️ Limite de 10 segundos: se o metadado `seconds` do vídeo passa o
//      limite, rejeitamos pedindo um clipe mais curto (o ffmpeg também
//      aplica `-t 10` como rede de segurança);
//   2) ffmpeg recorta para quadrado 512×512 (com pad negro só para fontes
//      minúsculas), baixa a 12 fps e codifica WEBP animado (encoder
//      libwebp) SEM áudio;
//   3) os metadados do pack ("Hipnos Bot" + autor) são injetados com
//      node-webpmux via a classe Exif de wa-sticker-formatter — SEM
//      re-encodear frames (o sharp tardaria/pesaria; o webp do ffmpeg já é
//      figurinha válida);
//   4) se o webp supera ~1 MB (limite de figurinha animada no WhatsApp)
//      DESCE A ESCADA de compressão (ESCADA_COMPRESSAO): primeiro baixa a
//      QUALIDADE (segue a 12 fps) e só nos últimos degraus baixa o FPS —
//      ver o bloco "FLUIDEZ x TAMANHO" abaixo. Se nem o último degrau
//      couber, avisamos o usuário com uma mensagem dedicada.
//
// ✍️📦 ASSINATURA VIP (/assinatura): NÃO é marca d'água desenhada — são os
//    nomes de PACK e AUTOR no EXIF da figurinha (o "pack • autor" que o
//    WhatsApp mostra ao segurar a figurinha). Pack = packCustom do VIP (ou
//    "Hipnos Bot" quando não há) + autor = assinatura do VIP (ou
//    "Sombras do Limbo" quando não há). O VIP personaliza os dois
//    separadamente: /assinatura <texto> (autor) e /assinatura pack <texto>
//    (pack).
// ============================================

const {
  downloadContentFromMessage,
  // 🔓 normalizeMessageContent: desembrulho de containers de protocolo
  // (viewOnceMessage/V2/Extension, ephemeralMessage, documentWithCaption,
  // editedMessage) — mídia "ver uma vez" também vira figurinha.
  normalizeMessageContent
} = require('@whiskeysockets/baileys')
const { Sticker, StickerTypes } = require('wa-sticker-formatter')
const { rodarExecutavel } = require('./webp-animado')
const fs = require('fs')
const os = require('os')
const path = require('path')

// ⏳ COOLDOWN do /s (dados/cooldowns.js — Map em memória, mesmo padrão do
// jogos-ativos.js) + 💠 verificação de VIP (vip.js — o MESMO sistema do
// /darvip e do /listavip; isVip aceita JID "@lid" e resolve pelo mapeamento).
const { verificar: verificarCooldown, marcar: marcarCooldown } = require('../../dados/cooldowns')
const vip = require('../../vip')
const { limparNumero } = require('../../config')
// 🪪 Número REAL de quem chamou (vip-acesso.js, fonte única do pacote VIP):
// o documento de VIP é gravado pelo telefone (/darvip), mas o autor chega
// como LID cru em grupos com LID habilitado — consultar o estilo com o LID
// nunca encontra nada e a assinatura não sai (mesmo bug do /corvip).
const { resolverAutorVip } = require('../../vip-acesso')

// 🧪 Gancho de teste: troca o executor do ffmpeg (padrão _injetar* do projeto).
// Sem injeção, roda o ffmpeg de verdade — o comportamento não muda.
let rodar = rodarExecutavel

// ⏱️ Cooldown: 3 minutos POR USUÁRIO (vale em grupo e no PV) — VIPs ficam
// isentos (a checagem de VIP pula o cooldown inteiramente, nem consulta o Map).
const COOLDOWN_S_MS = 3 * 60 * 1000

// ⏱️ Limites
const LIMITE_VIDEO_SEGUNDOS = 10
const LIMITE_BYTES_VIDEO = 25 * 1024 * 1024 // 25 MB ao baixar (igual que /togif e /tomp4)
const LIMITE_BYTES_STICKER = 1024 * 1024    // ~1 MB, limite típico de figurinha no WhatsApp

// ─── 🎬 FLUIDEZ x TAMANHO — a "escada" de compressão (o pulo do gato) ───
// 🔍 SINTOMA (bug relatado): a figurinha animada "escorregava" — parecia rodar
//    a ~2 fps em vez dos 12 fps gravados no arquivo.
// 🧪 CAUSA MEDIDA nesta máquina: o WhatsApp decodifica o webp NO APARELHO, em
//    tempo real. A versão anterior tinha UMA única 2ª passada fixa (12→8 fps e
//    qualidade 80→60) e, em clipe com muito movimento, o arquivo FINAL ainda
//    ficava com vários MB — medi 6,3 MB num clipe de 5 s (o limite de
//    figurinha ANIMADA no WhatsApp é ~1 MB). Com o container pesado o celular
//    não consegue decodificar a 12 fps e reproduz o MESMO arquivo a ~2 fps.
//    Os delays do container estavam CERTOS o tempo todo (medi 83/84 ms por
//    frame = 12,00 fps exatos): faltava o arquivo CABER no limite.
// ✅ A ESCADA: em vez de um salto único e cego, tentamos degraus até o webp
//    CABER no limite. A ORDEM importa — primeiro cai a QUALIDADE (a animação
//    continua a 12 fps, só perde nitidez) e o FPS só cai nos últimos degraus
//    (último recurso, porque é o fps que dá a fluidez). Isso também corrige o
//    caso em que o salto antigo matava a fluidez à toa: agora um clipe que
//    caberia a 12 fps com qualidade um pouco menor NÃO cai mais para 8 fps.
//    O degrau 0 é exatamente o pipeline que já existia (12 fps / q80), então
//    nenhum vídeo que já cabia em 1 MB muda de resultado.
// 📏 Medições nesta máquina (clipe de 5 s bem detalhado, 512×512, mesmo
//    filtro): q80 → 542 KB · q75 → 466 KB · q60 → 408 KB · q50 → 378 KB ·
//    q35 → 308 KB · q25 → 267 KB.
// ⚠️ `-quality <0-100>` (float) é o nome explícito da opção e `-q:v N` é
//    ATALHO DO MESMO parâmetro neste encoder (medido: os dois dão byte a byte
//    o mesmo arquivo). Usamos `-quality` por ser o nome documentado.
const ESCADA_COMPRESSAO = [
  { fps: 12, qualidade: 80 }, // degrau 0: o pipeline original (nada piora)
  { fps: 12, qualidade: 65 },
  { fps: 12, qualidade: 45 },
  { fps: 12, qualidade: 30 },
  { fps: 10, qualidade: 25 }, // daqui para baixo já é perda de fluidez
  { fps: 8,  qualidade: 20 },
  { fps: 6,  qualidade: 18 }  // último degrau: quase sempre cabe em 1 MB
]

// ─── ffmpeg: binário embutido (igual que /togif, /tomp4 e /attp) ───
function caminhoFfmpeg() {
  try {
    return require('@ffmpeg-installer/ffmpeg').path
  } catch (err) {
    return 'ffmpeg'
  }
}

/** Apaga temporário com retry (EPERM/EBUSY no Windows). NUNCA lança. */
function apagarComRetry(caminho, tentativas = 3) {
  const espera = (ms) => new Promise((resolver) => setTimeout(resolver, ms))
  return (async () => {
    for (let tentativa = 0; tentativa < tentativas; tentativa += 1) {
      try {
        if (!fs.existsSync(caminho)) return
        fs.unlinkSync(caminho)
        return
      } catch (err) {
        if (tentativa < tentativas - 1) await espera(150)
        else console.error('⚠️ [s] falha ao apagar', caminho, err?.message)
      }
    }
  })()
}

// 🏷️ EXIF padrão do /s (pack fixo + autor padrão).
const PACK_PADRAO = 'Hipnos Bot'
const AUTOR_PADRAO = 'Sombras do Limbo'

// ─── 🎬 Vídeo → WEBP animado (quadrado 512×512, sem áudio) ───
// @param {string} caminhoVideo
// @param {string} caminhoWebp
// @param {number} [limiteBytes] Teto de bytes que a escada persegue
//                                (por padrão ~1 MB, o limite da figurinha
//                                animada no WhatsApp).
// @returns {Promise<{bytes: number, segundaPassada: boolean, degrau: number,
//                    fps: number, qualidade: number}>}
// `segundaPassada` segue existindo (nome histórico dos testes): significa
// "precisou descer a escada além do 1º degrau".
async function videoParaWebpAnimado(caminhoVideo, caminhoWebp, limiteBytes = LIMITE_BYTES_STICKER) {
  const construirArgs = (fps, qualidade) => [
    '-y', '-nostdin',
    '-i', caminhoVideo,
    '-t', String(LIMITE_VIDEO_SEGUNDOS), // rede de segurança: máximo 10s
    '-vf',
    'scale=512:512:force_original_aspect_ratio=increase,' +
      'crop=min(iw\\,512):min(ih\\,512),' +        // recorta apenas quando sobra
      'pad=512:512:(ow-iw)/2:(oh-ih)/2:black,' +  // preenche fontes minúsculas
      `fps=${fps}`,
    '-c:v', 'libwebp',
    '-lossless', '0',
    '-quality', String(qualidade),               // ver bloco ESCADA_COMPRESSAO
    '-loop', '0',
    '-an',
    caminhoWebp
  ]

  // 🔽 Desce a escada até CABER. O 1º degrau que couber é o escolhido, então
  //    a fluidez só é sacrificada quando não há mais como reduzir tamanho.
  let bytes = 0
  let indice = 0
  for (; indice < ESCADA_COMPRESSAO.length; indice += 1) {
    const { fps, qualidade } = ESCADA_COMPRESSAO[indice]
    await rodar(caminhoFfmpeg(), construirArgs(fps, qualidade), 120000)
    bytes = fs.existsSync(caminhoWebp) ? fs.statSync(caminhoWebp).size : 0
    if (bytes === 0) throw new Error('ffmpeg não conseguiu produzir o webp animado do vídeo')
    if (bytes <= limiteBytes) break
  }
  // Se nem o último degrau coube, devolve o último mesmo (o chamador avisa).
  if (indice >= ESCADA_COMPRESSAO.length) indice = ESCADA_COMPRESSAO.length - 1
  const { fps, qualidade } = ESCADA_COMPRESSAO[indice]

  return { bytes, segundaPassada: indice > 0, degrau: indice, fps, qualidade }
}

// ─── 🏷️ Injeta os metadados do pack (node-webpmux) sem re-encodear ───
// O Exif de wa-sticker-formatter usa node-webpmux: carrega o webp, injeta
// o chunk EXIF ("sticker-pack-name", etc.) e o guarda — os frames ANMF se
// conservam tal qual (comprovado: 48 → 48 frames).
// ✍️ `autor` é a assinatura VIP quando há (senão AUTOR_PADRAO); `pack` é o
// pack custom quando há (senão PACK_PADRAO) — mesma lógica do autor.
function inyectarMetadatosWebp(buffer, autor = null, pack = null) {
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
async function resolverAutorExif(autorVip) {
  try {
    const assinatura = await vip.obterAssinatura(autorVip)
    if (assinatura) return assinatura
  } catch (errAssinatura) {
    console.error('[s] ⚠️ falha ao ler a assinatura (EXIF padrão):', errAssinatura?.message || errAssinatura)
  }
  return AUTOR_PADRAO
}

// ─── 📦 Resolve o nome do PACK do EXIF para o autor resolvido ───
// Mesma lógica do autor: packCustom do VIP quando há, PACK_PADRAO quando não.
// NUNCA lança.
async function resolverPackExif(autorVip) {
  try {
    const packCustom = await vip.obterPackCustom(autorVip)
    if (packCustom) return packCustom
  } catch (errPack) {
    console.error('[s] ⚠️ falha ao ler o pack custom (EXIF padrão):', errPack?.message || errPack)
  }
  return PACK_PADRAO
}

// ─── ✍️📦 Resolve AUTOR + PACK do EXIF numa consulta só ───
// Atalho que o executar usa (evita 2 idas ao banco); NUNCA lança.
async function resolverExif(autorVip) {
  try {
    const completo = await vip.obterAssinaturaCompleta(autorVip)
    return {
      autor: completo?.autor || AUTOR_PADRAO,
      pack: completo?.pack || PACK_PADRAO
    }
  } catch (errExif) {
    console.error('[s] ⚠️ falha ao ler a assinatura completa (EXIF padrão):', errExif?.message || errExif)
    return { autor: AUTOR_PADRAO, pack: PACK_PADRAO }
  }
}

module.exports = {
  nome: 's',
  // 🏷️ ALIASES: o comando nasceu como /s, mas quem digita "/sticker" (o nome
  // "oficial" do recurso), "/stiker" (erro de digitação comum) ou "/sticker2"
  // precisa ser atendido do mesmo jeito. O loader do bot.js registra estes
  // apelidos sem sobrescrever nomes já existentes.
  //
  // 🔀 DIVISÃO COM O /figurinha (comandos/menu-fig/figurinha.js) — os apelidos
  // foram separados por SEMÂNTICA: aqui a mídia é CORTADA no quadrado 512×512
  // (StickerTypes.CROPPED), então "/fig" e "/figurinha" NÃO pertencem mais a
  // este comando; eles ficam com o modo ESTICAR (imagem inteira preenchendo o
  // quadrado 512×512, sem cortar nada), que é exatamente o que o nome
  // "figurinha" descreve.
  aliases: ['sticker', 'stiker', 'sticker2'],
  descricao: 'Transforma imagens, GIFs ou vídeos (máx. 10 segundos) em figurinhas.',

  async executar(sock, jid, msg, texto) {
    let caminhoVideo = null
    let caminhoWebp = null

    try {
      // ─── ⏳ COOLDOWN / 💠 VIP (por USUÁRIO, vale em grupo e no PV) ───
      // O VIP pula o cooldown inteiramente (nem consulta o Map). Sem VIP,
      // quem está dentro dos 3min desde o último uso BEM-SUCEDIDO recebe o
      // aviso e o pedido NEM é processado (a mídia nem é tocada).
      const autor = msg.key.participant || msg.key.remoteJid
      const chaveAutor = limparNumero(autor)
      // 🪪 NÚMERO REAL do autor (vip-acesso.js): o documento de VIP é gravado
      // pelo TELEFONE (/darvip) e num grupo com LID habilitado o autor chega
      // como "@lid" — com o número real resolvido o VIP é achado mesmo
      // quando o mapeamento LID→telefone da sessão ainda não sincronizou.
      const { numero: autorVip } = await resolverAutorVip(sock, jid, msg, 's')
      let ehVip = false
      try {
        ehVip = await vip.isVip(autorVip)
      } catch (errVip) {
        // 🛡️ Falha de infra (ex.: Mongo fora) não pune o usuário: segue com o
        // cooldown normal — o pior caso é esperar os 3min, nunca um bloqueio.
        console.error('[s] ⚠️ falha ao verificar VIP (seguindo com cooldown):', errVip?.message || errVip)
      }
      if (!ehVip) {
        const estado = verificarCooldown(chaveAutor, COOLDOWN_S_MS)
        if (estado.emCooldown) {
          console.log(`[s] ⏳ cooldown ativo p/ ${chaveAutor}: faltam ${estado.restanteFormatado}`)
          return await sock.sendMessage(jid, {
            text: `⏳ *Cooldown do /s* — a nuvem precisa descansar.\n\nAguarde *${estado.restanteFormatado}* para tecer outra figurinha.\n\n💠 VIPs têm invocação livre, sem espera.`
          }, { quoted: msg })
        }
      }

      // ─── 📎 CAPTURA DA MÍDIA (2 caminhos, nesta ORDEM de prioridade) ───
      // O comando agora aceita as DUAS formas de envio:
      //   a) 🖼️ MÍDIA + COMANDO NA LEGENDA (prioridade) — a imagem/GIF/vídeo
      //      vem na PRÓPRIA mensagem que contém o "/s" (imageMessage/
      //      videoMessage direto, com o comando em `.caption`). O bot.js
      //      entrega esse texto no parâmetro `texto` (extração de texto no
      //      messages.upsert lê conversation/text/caption);
      //   b) 💬 REPLY/CITAÇÃO — "/s" numa mensagem de texto respondendo uma
      //      mídia já enviada (extendedTextMessage.contextInfo.quotedMessage).
      // 🔓 normalizeMessageContent desembrulha as embalagens de protocolo
      // (viewOnceMessage/V2/Extension, ephemeralMessage, documentWithCaption,
      // editedMessage) — mídia "ver uma vez" também vira figurinha.
      // ⚠️ A ordem importa: se o usuário mandou uma mídia COM legenda "/s"
      // respondendo outra mídia, vale a mídia da PRÓPRIA mensagem (é o que
      // ele acabou de enviar) — a citada fica como fallback.
      const conteudoMsg = normalizeMessageContent(msg.message) || {}
      const contexto = conteudoMsg.extendedTextMessage?.contextInfo ||
        conteudoMsg.imageMessage?.contextInfo || conteudoMsg.videoMessage?.contextInfo
      const conteudoCotado = normalizeMessageContent(contexto?.quotedMessage) || {}
      const veioNaLegenda = Boolean(conteudoMsg.imageMessage || conteudoMsg.videoMessage)
      // Escolhe a mensagem inteira primeiro: mídia direta sempre vence,
      // inclusive foto direta respondendo a vídeo (e vice-versa).
      const origem = veioNaLegenda ? conteudoMsg : conteudoCotado
      const imagem = origem.imageMessage
      const video = origem.videoMessage

      if (!imagem && !video) {
        return await sock.sendMessage(jid, {
          text:
            '❌ *Ainda não vejo nenhuma mídia para tecer a figurinha.*\n\n' +
            '*Como usar o /s:*\n' +
            '🖼️ Envie a imagem/GIF/vídeo com `/s` na *legenda* — ou\n' +
            '💬 Responda (cite) uma imagem/GIF/vídeo já enviada com `/s`\n\n' +
            '🎬 Vídeos viram figurinha animada (máx. 10 segundos).'
        }, { quoted: msg })
      }

      console.log(`[s] 📎 mídia capturada: ${video ? 'vídeo' : 'imagem'} ${veioNaLegenda ? 'direta (legenda com o comando)' : 'citada (reply)'}`)

      // ─── ✍️📦 AUTOR + PACK DO EXIF (VIP, /assinatura e /assinatura pack) ───
      // Uma consulta tolerante ao documento de VIP, feita DEPOIS da captura (ou
      // seja, só quando há mesmo figura para marcar). Sem VIP, sem assinatura ou
      // com o banco fora, cai no padrão: pack "Hipnos Bot" + autor padrão.
      // 🪪 Sempre pelo número RESOLVIDO via resolverAutorVip (LID cru nunca
      // acha o documento — era o bug que apagava a assinatura em grupos).
      // Falha aqui NUNCA derruba a figurinha.
      const { autor: autorExif, pack: packExif } = await resolverExif(autorVip)
      if (autorExif !== AUTOR_PADRAO || packExif !== PACK_PADRAO) {
        console.log(`[s] ✍️ assinatura no EXIF: "${packExif} • ${autorExif}"`)
      }

      // Envia uma mensagem de carregamento
      await sock.sendMessage(jid, {
        text: '⏳ Tecendo sua figurinha nas sombras... Aguarde.'
      }, { quoted: msg })

      let stickerBuffer

      if (video) {
        // ─── 🎬 CAMINHO VÍDEO → figurinha animada ───
        const segundos = Number(video.seconds || 0)
        if (segundos > LIMITE_VIDEO_SEGUNDOS) {
          return await sock.sendMessage(jid, {
            text: `⏱️ *Limite de ${LIMITE_VIDEO_SEGUNDOS} segundos*...\n\nSeu vídeo dura ${segundos}s. Envie um clipe mais curto (máx. ${LIMITE_VIDEO_SEGUNDOS}s) e ele será tecido nas sombras.`
          }, { quoted: msg })
        }

        // Baixa o vídeo do WhatsApp
        const stream = await downloadContentFromMessage(video, 'video')
        let buffer = Buffer.from([])
        for await (const parte of stream) {
          buffer = Buffer.concat([buffer, parte])
          if (buffer.length > LIMITE_BYTES_VIDEO) {
            throw new Error('O vídeo supera o limite de 25 MB ao ser baixado.')
          }
        }
        if (buffer.length === 0) throw new Error('O vídeo foi baixado vazio (0 bytes).')

        // Converte vídeo → webp animado com o ffmpeg embutido
        const idUnico = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        caminhoVideo = path.join(os.tmpdir(), `${idUnico}.mp4`)
        caminhoWebp = path.join(os.tmpdir(), `${idUnico}.webp`)
        fs.writeFileSync(caminhoVideo, buffer)

        const { bytes, segundaPassada, fps, qualidade } = await videoParaWebpAnimado(caminhoVideo, caminhoWebp)
        console.log(`[s] 🎬 webp animado pronto: ${bytes} bytes @ ${fps} fps/q${qualidade}${segundaPassada ? ' (escada de compressão)' : ''}`)

        if (bytes > LIMITE_BYTES_STICKER) {
          const erroGrande = new Error(`A figurinha animada ficou em ${bytes} bytes (queríamos ${LIMITE_BYTES_STICKER} ou menos).`)
          erroGrande.codigo = 'FIGURINHA_GRANDE'
          throw erroGrande
        }

        stickerBuffer = fs.readFileSync(caminhoWebp)

        // Injeta pack/autor (pack custom + assinatura VIP quando há); se falha,
        // o webp do ffmpeg já vale como figurinha
        try {
          const conMetadatos = await inyectarMetadatosWebp(stickerBuffer, autorExif, packExif)
          if (conMetadatos && conMetadatos.length > 0) stickerBuffer = conMetadatos
        } catch (errMetadatos) {
          console.error('[s] ⚠️ não foi possível injetar os metadados (enviando o webp cru):', errMetadatos?.message || errMetadatos)
        }
      } else {
        // ─── 🖼️ CAMINHO IMAGEM/GIF → figurinha (como sempre) ───
        // ⬇️ Baixa a imagem do WhatsApp — o nó JÁ vem normalizado pela
        // captura acima (mídia direta com legenda OU citada no reply), então
        // basta repassar o próprio imageMessage: downloadContentFromMessage
        // lê mediaKey/url/directPath da mídia, não do wrapper da mensagem.
        const stream = await downloadContentFromMessage(imagem, 'image')

        let buffer = Buffer.from([])
        for await (const parte of stream) {
          buffer = Buffer.concat([buffer, parte])
        }

        // Cria e formata a figurinha (autor/pack = assinatura VIP quando há)
        const sticker = new Sticker(buffer, {
          pack: packExif,               // Nome do pack (pack custom VIP ou padrão)
          author: autorExif,            // Nome do autor (assinatura VIP ou padrão)
          type: StickerTypes.CROPPED, // Corta a imagem para caber perfeitamente no quadrado
          categories: ['🔮'],
          id: 'hipnos_s',
          quality: 70                 // Mantém uma qualidade boa sem pesar no envio
        })

        stickerBuffer = await sticker.toBuffer()
      }

      // Envia a figurinha de volta para o grupo ou chat privado
      await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg })

      // ⏳ Cooldown contado SÓ AGORA — uso BEM-SUCEDIDO (a figurinha saiu).
      // Falhas na geração/envio caem no catch abaixo sem consumir o uso.
      if (!ehVip) marcarCooldown(chaveAutor)

    } catch (err) {
      console.error('[s] 💥 erro ao criar figurinha:', err?.stack || err)
      if (err?.mensagemExecutavel) console.error('[s] 📎 stderr do ffmpeg:', err.mensagemExecutavel)
      // 🐢 Mensagem dedicada para o caso "ficou pesada demais": o usuário
      // precisa entender que o problema é o TAMANHO (o celular não decodifica
      // em tempo real e a figurinha roda travada), não um erro qualquer.
      const aviso = err?.codigo === 'FIGURINHA_GRANDE'
        ? '🐢 *Esta animação é pesada demais para virar figurinha.*\n\n' +
          'O WhatsApp decodifica a figurinha animada em tempo real no aparelho: ' +
          'um arquivo grande demais roda *travado* (parece câmera lenta). ' +
          'Envie um clipe *mais curto* ou com *menos movimento* que eu teço na hora.'
        : '❌ Ocorreu um erro ao tentar gerar a figurinha.'
      await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    } finally {
      // 🧹 Limpeza sempre (incluso em erros)
      for (const caminho of [caminhoVideo, caminhoWebp]) {
        if (caminho) await apagarComRetry(caminho)
      }
    }
  }
}

// Exporta utilidades para os testes (mesmo padrão que webp-animado.js)
Object.assign(module.exports, {
  videoParaWebpAnimado,
  inyectarMetadatosWebp,
  resolverAutorExif,
  resolverPackExif,
  resolverExif,
  PACK_PADRAO,
  AUTOR_PADRAO,
  LIMITE_VIDEO_SEGUNDOS,
  LIMITE_BYTES_STICKER,
  ESCADA_COMPRESSAO,
  // 🧪 Gancho dos testes offline: troca o executor do ffmpeg (padrão
  // _injetar* do projeto). Sem injeção, roda o ffmpeg de verdade.
  _injetarRodarExecutavel: (fn) => { rodar = fn || rodarExecutavel }
})