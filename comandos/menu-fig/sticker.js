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
//   3) os metadados do pack ("Hipnos Bot") são injetados com node-webpmux
//      via a classe Exif de wa-sticker-formatter — SEM re-encodear frames
//      (o sharp tardaria/pesaria; o webp do ffmpeg já é figurinha válida);
//   4) se o webp supera ~1 MB (limite típico de figurinha no WhatsApp)
//      re-codificamos a 8 fps e qualidade menor; se ainda assim fica
//      grande, avisamos o usuário.
// ============================================

const {
  downloadContentFromMessage,
  // 🔓 normalizeMessageContent: desembrulho de containers de protocolo
  // (viewOnceMessage/V2/Extension, ephemeralMessage, documentWithCaption,
  // editedMessage) — mídia "ver uma vez" também vira figurinha.
  normalizeMessageContent
} = require('@whiskeysockets/baileys')
const { Sticker, StickerTypes } = require('wa-sticker-formatter')
const { rodarExecutavel, comAssinatura, prepararAssinatura } = require('./webp-animado')
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
const FPS_PRIMARIO = 12
const FPS_COMPRIMIDO = 8
const QUALITY_PRIMARIA = 80
const QUALITY_COMPRIMIDA = 60

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

// ─── ✍️ ASSINATURA VIP: camada extra antes do webp (caminho de IMAGEM) ───
// O caminho de imagem do /s NÃO usa ffmpeg (quem recorta e re-encoda é o
// wa-sticker-formatter), então a marca d'água é gravada numa PASSADA SEPARADA:
// entrada → PNG com o drawtext → o Sticker() recebe o PNG e faz o que sempre
// fez. Como a marca só existe quando o autor é VIP com assinatura, sem ela
// nada muda: nem arquivo, nem ffmpeg, nem buffer diferente.
async function aplicarAssinaturaNaImagem(caminhoEntrada, caminhoSaida, assinatura) {
  await rodar(
    caminhoFfmpeg(),
    [
      '-y', '-nostdin',
      '-i', caminhoEntrada,
      '-vf', comAssinatura('', assinatura),
      '-frames:v', '1',
      caminhoSaida
    ],
    120000
  );

  if (!fs.existsSync(caminhoSaida) || fs.statSync(caminhoSaida).size === 0) {
    throw new Error('o ffmpeg não conseguiu estampar a assinatura na imagem');
  }
  return fs.readFileSync(caminhoSaida);
}

// ─── 🎬 Vídeo → WEBP animado (quadrado 512×512, sem áudio) ───
// @param {string} caminhoVideo
// @param {string} caminhoWebp
// @param {number} [limiteBytes] Limite de bytes que dispara uma 2ª passada
//                                a menor qualidade/fps (por padrão 1 MB).
// @returns {Promise<{bytes: number, segundaPassada: boolean}>}
async function videoParaWebpAnimado(caminhoVideo, caminhoWebp, limiteBytes = LIMITE_BYTES_STICKER, assinatura = null) {
  const construirArgs = (fps, qualidade) => [
    '-y', '-nostdin',
    '-i', caminhoVideo,
    '-t', String(LIMITE_VIDEO_SEGUNDOS), // rede de segurança: máximo 10s
    '-vf',
    // ✍️ Assinatura no FIM da cadeia (depois do pad, as coordenadas w/h já
    // são as do quadrado 512×512 final). Sem assinatura, filtro idêntico.
    comAssinatura(
      'scale=512:512:force_original_aspect_ratio=increase,' +
      'crop=min(iw\\,512):min(ih\\,512),' +        // recorta apenas quando sobra
      'pad=512:512:(ow-iw)/2:(oh-ih)/2:black,' +  // preenche fontes minúsculas
      `fps=${fps}`,
      assinatura
    ),
    '-c:v', 'libwebp',
    '-lossless', '0',
    '-q:v', String(qualidade),
    '-loop', '0',
    '-an',
    caminhoWebp
  ]

  await rodar(caminhoFfmpeg(), construirArgs(FPS_PRIMARIO, QUALITY_PRIMARIA), 120000)

  let bytes = fs.existsSync(caminhoWebp) ? fs.statSync(caminhoWebp).size : 0
  if (bytes === 0) throw new Error('ffmpeg não conseguiu produzir o webp animado do vídeo')

  // 🔽 2ª passada se a figurinha fica pesada demais para WhatsApp
  let segundaPassada = false
  if (bytes > limiteBytes) {
    await rodar(caminhoFfmpeg(), construirArgs(FPS_COMPRIMIDO, QUALITY_COMPRIMIDA), 120000)
    bytes = fs.existsSync(caminhoWebp) ? fs.statSync(caminhoWebp).size : 0
    segundaPassada = true
    if (bytes === 0) throw new Error('ffmpeg não conseguiu produzir o webp comprimido')
  }
  return { bytes, segundaPassada }
}

// ─── 🏷️ Injeta os metadados do pack (node-webpmux) sem re-encodear ───
// O Exif de wa-sticker-formatter usa node-webpmux: carrega o webp, injeta
// o chunk EXIF ("sticker-pack-name", etc.) e o guarda — os frames ANMF se
// conservam tal qual (comprovado: 48 → 48 frames).
function inyectarMetadatosWebp(buffer) {
  const { default: ClaseExif } = require('wa-sticker-formatter/dist/internal/Metadata/Exif.js')
  const exif = new ClaseExif({
    pack: 'Hipnos Bot',
    author: 'Sombras do Limbo',
    id: 'hipnos_s_video',
    categories: ['🔮']
  })
  return exif.add(buffer)
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
  // este comando; eles ficam com o modo ENCAIXE (imagem inteira + fundo
  // transparente), que é exatamente o que o nome "figurinha" descreve.
  aliases: ['sticker', 'stiker', 'sticker2'],
  descricao: 'Transforma imagens, GIFs ou vídeos (máx. 10 segundos) em figurinhas.',

  async executar(sock, jid, msg, texto) {
    let caminhoVideo = null
    let caminhoWebp = null
    // ✍️ Temporários da assinatura (só existem se o autor tiver uma)
    let caminhoAssinatura = null
    let caminhoImagemMarcada = null

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

      // ─── ✍️ ASSINATURA DO AUTOR (VIP, /assinatura) ───
      // Uma consulta tolerante ao documento de VIP, feita DEPOIS da captura (ou
      // seja, só quando há mesmo figura para marcar). Sem VIP, sem assinatura ou
      // com o banco fora, `assinatura` fica null: nenhum arquivo, nenhum drawtext,
      // nenhuma chamada extra ao ffmpeg. Falha aqui NUNCA derruba a figurinha.
      let assinatura = null
      try {
        assinatura = prepararAssinatura(await vip.obterAssinatura(autorVip), `s-${Date.now()}`)
        if (assinatura) {
          caminhoAssinatura = assinatura.caminhoTexto
          console.log(`[s] ✍️ assinatura aplicada: "${assinatura.texto}"`)
        }
      } catch (errAssinatura) {
        console.error('[s] ⚠️ falha ao ler a assinatura (figura sem marca d\'água):', errAssinatura?.message || errAssinatura)
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

        const { bytes, segundaPassada } = await videoParaWebpAnimado(caminhoVideo, caminhoWebp, undefined, assinatura)
        console.log(`[s] 🎬 webp animado pronto: ${bytes} bytes${segundaPassada ? ' (2ª passada comprimida)' : ''}`)

        if (bytes > LIMITE_BYTES_STICKER) {
          throw new Error(`A figurinha animada ficou em ${bytes} bytes (queríamos ${LIMITE_BYTES_STICKER} ou menos).`)
        }

        stickerBuffer = fs.readFileSync(caminhoWebp)

        // Injeta pack/autor; se falha, o webp do ffmpeg já vale como figurinha
        try {
          const conMetadatos = await inyectarMetadatosWebp(stickerBuffer)
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

        // ✍️ Camada extra da assinatura (só com VIP+assinatura): a imagem vai
        // para um PNG com o drawtext e é esse PNG que entra no Sticker(). Sem
        // assinatura, `buffer` segue intacto e o caminho é o de sempre.
        if (assinatura) {
          const idMarcado = `s-ass-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          caminhoImagemMarcada = path.join(os.tmpdir(), `${idMarcado}.png`)
          const origemMarcada = path.join(os.tmpdir(), `${idMarcado}.origem`)
          fs.writeFileSync(origemMarcada, buffer)
          try {
            buffer = await aplicarAssinaturaNaImagem(origemMarcada, caminhoImagemMarcada, assinatura)
            console.log(`[s] ✍️ marca d'água estampada na imagem (${buffer.length} bytes)`)
          } finally {
            await apagarComRetry(origemMarcada)
          }
        }

        // Cria e formata a figurinha
        const sticker = new Sticker(buffer, {
          pack: 'Hipnos Bot',         // Nome do pacote de figurinhas
          author: 'Sombras do Limbo', // Nome do autor
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
      await sock.sendMessage(jid, {
        text: '❌ Ocorreu um erro ao tentar gerar a figurinha.'
      }, { quoted: msg }).catch(() => {})
    } finally {
      // 🧹 Limpeza sempre (incluso em erros)
      for (const caminho of [caminhoVideo, caminhoWebp, caminhoAssinatura, caminhoImagemMarcada]) {
        if (caminho) await apagarComRetry(caminho)
      }
    }
  }
}

// Exporta utilidades para os testes (mesmo padrão que webp-animado.js)
Object.assign(module.exports, {
  videoParaWebpAnimado,
  inyectarMetadatosWebp,
  LIMITE_VIDEO_SEGUNDOS,
  LIMITE_BYTES_STICKER,
  aplicarAssinaturaNaImagem,
  // 🧪 Ganchos dos testes offline da assinatura VIP (/assinatura): permite
  // inspecionar os args do ffmpeg (o drawtext no -vf) sem gravar nada.
  _injetarRodarExecutavel: (fn) => { rodar = fn || rodarExecutavel }
})