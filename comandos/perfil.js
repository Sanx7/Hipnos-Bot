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
  try {
    const conTimeout = await Promise.race([
      globalThis.fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'WhatsApp/2.24.6.77' }
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ao baixar a foto')), timeoutMs))
    ])
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
module.exports = {
  nome: 'perfil',
  descricao: 'Mostra o perfil do autor (ou de um @mencionado): foto, nome, número, recado, %% e frase filosófica.',

  async executar(sock, jid, msg) {
    // Caminhos temporários (limpeza no finally)
    let caminhoInput = null
    let caminhoThumbTemp = null

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
            e = buscarEstatisticasUsuario(jid, candidato)
          } catch (errBanco) {
            console.error('[perfil] ⚠️ banco do ranking não disponível:', errBanco?.message || errBanco)
          }
          if (!e) { bancoIndisponible = true; continue }
          if (e.total > 0) { estatisticas = e; break }
        }
      }

      // 6) Nome: pushName do autor; para mencionados o nome do banco; se não, o número
      const nombreExhibicion =
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
      for (const caminho of [caminhoInput, caminhoThumbTemp]) {
        if (caminho && fs.existsSync(caminho)) await apagarComRetry(caminho)
      }
    }
  }
}