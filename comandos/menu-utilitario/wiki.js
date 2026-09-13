// ============================================
// 📚 WIKI — Pergaminhos da Wikipédia (uso LIVRE)
// ============================================
// Busca o resumo de um artigo da Wikipédia em português e responde em
// PT-BR com a temática do Limbo. Se houver imagem no artigo, envia como
// foto com legenda; se não houver, envia só texto. Sempre com o link do
// artigo completo no final.
//
// Como usar (grupos e privado):
//   /wiki Buraco Negro
//   (também: /wikipedia, /wikipredia e /pesquisar)
//
// Como funciona:
//   1) Resumo direto: https://pt.wikipedia.org/api/rest_v1/page/summary/<termo>
//   2) Se der 404 (título exato não existe), cai na API de busca tradicional
//      (action=query&list=search) e refaz o resumo com o 1º título achado;
//   3) Resumo truncado a ~800 caracteres ("..." no corte), para não estourar
//      o tamanho de legenda do WhatsApp;
//   4) User-Agent descritivo (HipnosBot/1.0 + repo), exigido pelas políticas
//      da Wikipédia; timeout de 10s via AbortController.
//
// ⚠️ CAUSA RAIZ DO CRASH (mesmo padrão do /revelar, /perfil, /toimg e /nasa):
//   Quando o artigo tem miniatura, o envio antigo fazia
//   `sock.sendMessage(jid, { image: buffer })` SEM `jpegThumbnail`. Ao
//   preparar a mídia, a Baileys gera a miniatura com a lib NATIVA
//   sharp/libvips DENTRO do processo (messages-media.js → extractImageThumb),
//   e uma falha nativa dessa stack mata o processo SEM chance de try/catch —
//   por isso o /wiki derrubava a conexão inteira (a maioria dos artigos tem
//   thumbnail, então quase toda consulta passava pelo caminho da foto).
//   AGORA o thumbnail é gerado ANTES pelo binário do ffmpeg em PROCESSO
//   FILHO e entregue pronto via `jpegThumbnail` (requiresThumbnailComputation
//   vira false e a lib PULA o sharp/libvips por completo). Se o ffmpeg
//   falhar, usamos um JPEG 8x8 embutido como fallback e a foto ainda sai.
//
// Tratamento de erros (mesmo padrão do /clima, /nasa e /ddd):
//   - termo ausente -> instruções de uso;
//   - nada encontrado -> "não retornou conhecimento no Limbo";
//   - rede/timeout/API fora -> aviso amigável; logs "[wiki] ..." no console;
//   - o isolamento do bot.js garante que nada derrube o listener.
// ============================================

const { exec } = require('child_process')
const fs = require('fs')
const path = require('path')

// ⏳ Timeout das chamadas HTTP (ms) — requisito: 10s
const TIMEOUT_API_MS = 10000

// ✂️ Limite do resumo na mensagem ("cerca de 800-1000"; usamos 800 p/ caber
// com folga na legenda da imagem junto de título, link e assinatura)
const MAX_EXTRATO = 800

const URL_RESUMO = 'https://pt.wikipedia.org/api/rest_v1/page/summary'
const URL_BUSCA = 'https://pt.wikipedia.org/w/api.php'

// 🌐 User-Agent descritivo — exigido pela política da Wikipédia
const USER_AGENT = 'HipnosBot/1.0 (https://github.com/Sanx7/Hipnos-Bot)'

// Limite defensivo do download da miniatura (10 MB).
const LIMITE_BYTES_IMAGEM = 10 * 1024 * 1024

// Usa o binário de FFmpeg instalado com o projeto, com fallback para o PATH
const binarioFfmpeg = (() => {
  try {
    return require('@ffmpeg-installer/ffmpeg').path
  } catch (err) {
    return 'ffmpeg'
  }
})()

// 🧩 JPEG 8x8 válido (gerado pelo próprio @ffmpeg-installer do projeto) —
// fallback caso até o ffmpeg falhe ao gerar a miniatura do artigo.
const THUMB_FALLBACK_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzU4LjQyLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAEBEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgACAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AD//Z'

// 🧪 Erro de domínio: mensagem amigável + tipo p/ o aviso correto
class ErroWiki extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroWiki'
    this.tipo = tipo // 'api' | 'nao_encontrado'
  }
}

/** Apaga um temporário com retry (EPERM/EBUSY no Windows). NUNCA lança. */
function apagarComRetry(caminho, tentativas = 3) {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms))
  return (async () => {
    for (let i = 0; i < tentativas; i++) {
      try {
        if (!fs.existsSync(caminho)) return
        fs.unlinkSync(caminho)
        return
      } catch (err) {
        if (i === tentativas - 1) {
          console.error('⚠️ wiki: falha ao apagar temporário', caminho, err?.message)
        } else {
          await espera(150)
        }
      }
    }
  })()
}

/**
 * Gera um thumbnail JPEG (~64px) da imagem usando o binário do ffmpeg em
 * PROCESSO FILHO — nunca toca na stack nativa de imagem da Baileys.
 * NUNCA rejeita: em caso de qualquer falha devolve o fallback 8x8.
 * @returns {Promise<{base64: string, fonte: 'ffmpeg'|'fallback', caminho: string}>}
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
            return resolve({ base64: bufferThumb.toString('base64'), fonte: 'ffmpeg', caminho: caminhoThumb })
          }
        }
        console.error('[wiki] ⚠️ ffmpeg não produziu thumbnail — usando fallback 8x8. Motivo:', error?.message || 'arquivo ausente')
      } catch (errLeitura) {
        console.error('[wiki] ⚠️ falha ao ler thumbnail gerado — usando fallback 8x8:', errLeitura?.message)
      }
      // Fallback não cria arquivo (só devolve o JPEG embutido em memória)
      resolve({ base64: THUMB_FALLBACK_JPEG_BASE64, fonte: 'fallback', caminho: caminhoThumb })
    })
  })
}
// ─── 🌐 GET com timeout de 10s (mesmo padrão do /clima) → JSON parseado ───
async function buscarJson(url) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    const resposta = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT
      },
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      if (resposta.status === 404) {
        throw new ErroWiki('artigo não encontrado (HTTP 404)', 'nao_encontrado')
      }
      throw new ErroWiki(`a Wikipédia respondeu HTTP ${resposta.status}`, 'api')
    }
    return await resposta.json()
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof ErroWiki) throw err
    if (err.name === 'AbortError') {
      throw new ErroWiki('a consulta demorou demais (timeout)', 'api')
    }
    throw new ErroWiki(err?.message || String(err), 'api')
  }
}

// ─── 🖼️ Baixa a miniatura do artigo p/ Buffer (falha NUNCA derruba o fluxo) ───
// Retorna Buffer ou null (quem chama cai para "só texto"). Com limite
// defensivo de 10 MB para não estourar a memória do Render (plano free).
async function baixarImagem(url) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    const resposta = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      console.error(`[wiki] 📎 thumbnail respondeu HTTP ${resposta.status} — enviando só o texto`)
      return null
    }
    const tamanhoDeclarado = Number(resposta.headers?.get?.('content-length'))
    if (Number.isFinite(tamanhoDeclarado) && tamanhoDeclarado > LIMITE_BYTES_IMAGEM) {
      console.error(`[wiki] 📎 thumbnail de ~${Math.round(tamanhoDeclarado / 1024 / 1024)} MB excede o limite — enviando só o texto`)
      return null
    }
    const buffer = Buffer.from(await resposta.arrayBuffer())
    if (!buffer.length || buffer.length > LIMITE_BYTES_IMAGEM) {
      console.error('[wiki] 📎 thumbnail inválida ou grande demais — enviando só o texto')
      return null
    }
    return buffer
  } catch (err) {
    clearTimeout(timeoutId)
    console.error('[wiki] 📎 download da imagem falhou — enviando só o texto:', err?.message || err)
    return null
  }
}

// ─── 📄 Resumo do artigo, com fallback de busca quando dá 404 ───
// 1) tentativa direta com o termo digitado;
// 2) 404 -> API de busca tradicional (list=search) p/ achar o título
//    correto e refazer o resumo com ele.
async function buscarResumo(termo) {
  try {
    return await buscarJson(`${URL_RESUMO}/${encodeURIComponent(termo)}`)
  } catch (err) {
    // Só faz sentido tentar a busca quando o artigo não foi encontrado
    if (!(err instanceof ErroWiki) || err.tipo !== 'nao_encontrado') throw err
    console.error(`[wiki] 📄 resumo direto 404 — tentando a busca tradicional: "${termo}"`)
  }

  const busca = await buscarJson(
    `${URL_BUSCA}?action=query&list=search&srsearch=${encodeURIComponent(termo)}&format=json`
  )
  const tituloAchado = busca?.query?.search?.[0]?.title
  if (!tituloAchado) {
    throw new ErroWiki('nenhum resultado na busca da Wikipédia', 'nao_encontrado')
  }
  console.error(`[wiki] 🔍 busca achou "${tituloAchado}" — refazendo o resumo`)
  return await buscarJson(`${URL_RESUMO}/${encodeURIComponent(tituloAchado)}`)
}

// ─── ✂️ Trunca o resumo em ~MAX_EXTRATO, cortando em fim de palavra ───
function truncar(texto, max = MAX_EXTRATO) {
  const limpo = String(texto || '').replace(/\s+/g, ' ').trim()
  if (limpo.length <= max) return limpo
  const cortado = limpo.slice(0, max)
  const espaco = cortado.lastIndexOf(' ')
  return (espaco > max * 0.6 ? cortado.slice(0, espaco) : cortado).trim() + '...'
}

// ─── ✉️ Monta a mensagem temática do pergaminho ───
function montarLegenda(resumo) {
  const titulo = String(resumo.title || '').trim() || 'Pergaminho sem título'
  const extrato = truncar(resumo.extract)
  const link =
    resumo.content_urls?.desktop?.page ||
    `https://pt.wikipedia.org/wiki/${encodeURIComponent(String(resumo.title || '').replace(/\s+/g, '_'))}`

  return (
    `📚 *WIKIPÉDIA DO LIMBO* 🌙\n\n` +
    `✨ *${titulo}*\n\n` +
    `📖 ${extrato}\n\n` +
    `🌌 *Ler o artigo completo:* ${link}\n\n` +
    `💤 *"O conhecimento também descansa nos sonhos."*`
  )
}
// ─── 📨 Execução do comando ───
module.exports = {
  nome: 'wiki',
  aliases: ['wikipedia', 'wikipredia', 'pesquisar'],
  descricao: 'Busca e exibe o resumo de um artigo da Wikipédia em português.',
  categoria: 'utilitario',

  async executar(sock, jid, msg, text) {
    let caminhoImagemTemp = null
    let caminhoThumbTemp = null

    try {
      // 1) 🔍 Extrai o termo de busca (tudo depois de "/wiki")
      const termo = String(text || '').replace(/^\/\S+\s*/, '').trim()
      if (!termo) {
        return await sock.sendMessage(jid, {
          text: '📚 *Me diga o que procurar nos pergaminhos...*\n\n' +
            'Informe o termo logo após o comando.\n\n' +
            '🗝️ Exemplo: `/wiki Buraco Negro`'
        }, { quoted: msg })
      }

      // 2) 📄 Resumo (com fallback de busca em 404)
      console.log(`[wiki] ① buscando resumo de "${termo}"...`)
      const resumo = await buscarResumo(termo)
      console.log(`[wiki] ② resumo obtido: "${resumo.title || '?'}" (extrato ${String(resumo.extract || '').length} chars)`)

      // Artigo sem texto (página de desambiguação vazia, etc.)
      if (!String(resumo.extract || '').trim()) {
        throw new ErroWiki('resumo vazio para o artigo', 'nao_encontrado')
      }

      // 3) ✉️ Monta a mensagem (resumo truncado a ~800 + link no final)
      const legenda = montarLegenda(resumo)
      console.log(`[wiki] ③ legenda montada (${legenda.length} chars)`)
      const urlImagem = resumo.thumbnail?.source

      // 4) 🖼️ Com imagem: envia foto com legenda. ⚠️ O thumbnail é gerado por
      //    nós ANTES do envio (ffmpeg em processo filho) e entregue pronto via
      //    `jpegThumbnail` — sem isso a Baileys usaria sharp/libvips in-process
      //    (causa raiz do crash). Download falhou -> envia só o texto.
      if (urlImagem) {
        console.log('[wiki] ④ artigo tem imagem — baixando miniatura...')
        const imagem = await baixarImagem(urlImagem)
        if (imagem && imagem.length > 0) {
          try {
            const idUnico = Math.random().toString(36).substring(2, 10)
            const pastaTemp = path.join(__dirname, '..', 'dados', 'temp')
            if (!fs.existsSync(pastaTemp)) fs.mkdirSync(pastaTemp, { recursive: true })
            caminhoImagemTemp = path.join(pastaTemp, `wiki_${idUnico}.jpg`)
            fs.writeFileSync(caminhoImagemTemp, imagem)
            console.log(`[wiki] ⑤ miniatura baixada (${imagem.length} bytes) — gerando thumbnail via ffmpeg (processo filho)...`)
            const thumb = await gerarThumbnailJpeg(caminhoImagemTemp, pastaTemp, idUnico)
            caminhoThumbTemp = thumb.caminho
            const jpegThumbnail = thumb.base64
            console.log(`[wiki] ⑥ jpegThumbnail pronto (fonte: ${thumb.fonte}, ${jpegThumbnail.length} chars base64)`)
            try {
              console.log('[wiki] ⑦ enviando imagem COM jpegThumbnail (Baileys pula sharp/libvips)...')
              return await sock.sendMessage(jid, {
                image: imagem,
                caption: legenda,
                jpegThumbnail // ← entrega pronto: Baileys NÃO gera miniatura nativa
              }, { quoted: msg })
            } catch (erroEnvio) {
              // 🪵 Ponto exato de falha no log, sem derrubar nada
              console.error('[wiki] 💥 falha no envio da imagem (capturada — a conexão NÃO cai):', erroEnvio?.stack || erroEnvio)
              throw erroEnvio
            }
          } catch (errImagem) {
            console.error('[wiki] 📎 erro ao preparar/enviar a imagem — enviando só o texto:', errImagem?.message || errImagem)
          }
        } else {
          console.error('[wiki] 📎 download da imagem falhou — enviando só o texto')
        }
      }

      // 5) 📜 Sem imagem (ou download falhou): mensagem de texto
      console.log('[wiki] ⑤ enviando mensagem de texto (sem imagem)...')
      return await sock.sendMessage(jid, { text: legenda }, { quoted: msg })
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa para o socket.
      console.error('[wiki] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      const aviso = err?.tipo === 'nao_encontrado'
        ? '📚 *Essa consulta não retornou conhecimento no Limbo...*\n\n' +
          'A Wikipédia não achou nada com esse termo. Tente outras palavras.\n\n' +
          '🗝️ Exemplo: `/wiki Buraco Negro`'
        : '⛔ *Os pergaminhos do limbo ficaram fora do alcance...*\n\n' +
          'A Wikipédia não respondeu agora. Tente novamente em instantes.'
      return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    } finally {
      // 🧹 Limpeza tolerante dos temporários (nunca lança)
      for (const caminho of [caminhoImagemTemp, caminhoThumbTemp]) {
        if (caminho && fs.existsSync(caminho)) await apagarComRetry(caminho)
      }
    }
  }
}