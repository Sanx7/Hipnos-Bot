// ============================================
// ðŸ“š WIKI â€” Pergaminhos da WikipÃ©dia (uso LIVRE)
// ============================================
// Busca o resumo de um artigo da WikipÃ©dia em portuguÃªs e responde em
// PT-BR com a temÃ¡tica do Limbo. Se houver imagem no artigo, envia como
// foto com legenda; se nÃ£o houver, envia sÃ³ texto. Sempre com o link do
// artigo completo no final.
//
// Como usar (grupos e privado):
//   /wiki Buraco Negro
//   (tambÃ©m: /wikipedia, /wikipredia e /pesquisar)
//
// Como funciona:
//   1) Resumo direto: https://pt.wikipedia.org/api/rest_v1/page/summary/<termo>
//   2) Se der 404 (tÃ­tulo exato nÃ£o existe), cai na API de busca tradicional
//      (action=query&list=search) e refaz o resumo com o 1Âº tÃ­tulo achado;
//   3) Resumo truncado a ~800 caracteres ("..." no corte), para nÃ£o estourar
//      o tamanho de legenda do WhatsApp;
//   4) User-Agent descritivo (HipnosBot/1.0 + repo), exigido pelas polÃ­ticas
//      da WikipÃ©dia; timeout de 10s via AbortController.
//
// Tratamento de erros (mesmo padrÃ£o do /clima, /nasa e /ddd):
//   - termo ausente -> instruÃ§Ãµes de uso;
//   - nada encontrado -> "nÃ£o retornou conhecimento no Limbo";
//   - rede/timeout/API fora -> aviso amigÃ¡vel; logs "[wiki] ..." no console;
//   - o isolamento do bot.js garante que nada derrube o listener.
// ============================================

// â³ Timeout das chamadas HTTP (ms) â€” requisito: 10s
const TIMEOUT_API_MS = 10000

// âœ‚ï¸ Limite do resumo na mensagem ("cerca de 800-1000"; usamos 800 p/ caber
// com folga na legenda da imagem junto de tÃ­tulo, link e assinatura)
const MAX_EXTRATO = 800

const URL_RESUMO = 'https://pt.wikipedia.org/api/rest_v1/page/summary'
const URL_BUSCA = 'https://pt.wikipedia.org/w/api.php'

// ðŸŒ User-Agent descritivo â€” exigido pela polÃ­tica da WikipÃ©dia
const USER_AGENT = 'HipnosBot/1.0 (https://github.com/Sanx7/Hipnos-Bot)'

// Limite defensivo do download da miniatura (10 MB).
const LIMITE_BYTES_IMAGEM = 10 * 1024 * 1024

// ðŸ§ª Erro de domÃ­nio: mensagem amigÃ¡vel + tipo p/ o aviso correto
class ErroWiki extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroWiki'
    this.tipo = tipo // 'api' | 'nao_encontrado'
  }
}

// â”€â”€â”€ ðŸŒ GET com timeout de 10s (mesmo padrÃ£o do /clima) â†’ JSON parseado â”€â”€â”€
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
        throw new ErroWiki('artigo nÃ£o encontrado (HTTP 404)', 'nao_encontrado')
      }
      throw new ErroWiki(`a WikipÃ©dia respondeu HTTP ${resposta.status}`, 'api')
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

// â”€â”€â”€ ðŸ–¼ï¸ Baixa a miniatura do artigo p/ Buffer (falha NUNCA derruba o fluxo) â”€â”€â”€
// Retorna Buffer ou null (quem chama cai para "sÃ³ texto"). Com limite
// defensivo de 10 MB para nÃ£o estourar a memÃ³ria do Render (plano free).
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
      console.error(`[wiki] ðŸ“Ž thumbnail respondeu HTTP ${resposta.status} â€” enviando sÃ³ o texto`)
      return null
    }
    const tamanhoDeclarado = Number(resposta.headers?.get?.('content-length'))
    if (Number.isFinite(tamanhoDeclarado) && tamanhoDeclarado > LIMITE_BYTES_IMAGEM) {
      console.error(`[wiki] ðŸ“Ž thumbnail de ~${Math.round(tamanhoDeclarado / 1024 / 1024)} MB excede o limite â€” enviando sÃ³ o texto`)
      return null
    }
    const buffer = Buffer.from(await resposta.arrayBuffer())
    if (!buffer.length || buffer.length > LIMITE_BYTES_IMAGEM) {
      console.error('[wiki] ðŸ“Ž thumbnail invÃ¡lida ou grande demais â€” enviando sÃ³ o texto')
      return null
    }
    return buffer
  } catch (err) {
    clearTimeout(timeoutId)
    console.error('[wiki] ðŸ“Ž download da imagem falhou â€” enviando sÃ³ o texto:', err?.message || err)
    return null
  }
}

// â”€â”€â”€ ðŸ“„ Resumo do artigo, com fallback de busca quando dÃ¡ 404 â”€â”€â”€
// 1) tentativa direta com o termo digitado;
// 2) 404 -> API de busca tradicional (list=search) p/ achar o tÃ­tulo
//    correto e refazer o resumo com ele.
async function buscarResumo(termo) {
  try {
    return await buscarJson(`${URL_RESUMO}/${encodeURIComponent(termo)}`)
  } catch (err) {
    // SÃ³ faz sentido tentar a busca quando o artigo nÃ£o foi encontrado
    if (!(err instanceof ErroWiki) || err.tipo !== 'nao_encontrado') throw err
    console.error(`[wiki] ðŸ“Ž resumo direto 404 â€” tentando a busca tradicional: "${termo}"`)
  }

  const busca = await buscarJson(
    `${URL_BUSCA}?action=query&list=search&srsearch=${encodeURIComponent(termo)}&format=json`
  )
  const tituloAchado = busca?.query?.search?.[0]?.title
  if (!tituloAchado) {
    throw new ErroWiki('nenhum resultado na busca da WikipÃ©dia', 'nao_encontrado')
  }
  console.error(`[wiki] ðŸ”Ž busca achou "${tituloAchado}" â€” refazendo o resumo`)
  return await buscarJson(`${URL_RESUMO}/${encodeURIComponent(tituloAchado)}`)
}

// â”€â”€â”€ âœ‚ï¸ Trunca o resumo em ~MAX_EXTRATO, cortando em fim de palavra â”€â”€â”€
function truncar(texto, max = MAX_EXTRATO) {
  const limpo = String(texto || '').replace(/\s+/g, ' ').trim()
  if (limpo.length <= max) return limpo
  const cortado = limpo.slice(0, max)
  const espaco = cortado.lastIndexOf(' ')
  return (espaco > max * 0.6 ? cortado.slice(0, espaco) : cortado).trim() + '...'
}

// â”€â”€â”€ âœ‰ï¸ Monta a mensagem temÃ¡tica do pergaminho â”€â”€â”€
function montarLegenda(resumo) {
  const titulo = String(resumo.title || '').trim() || 'Pergaminho sem tÃ­tulo'
  const extrato = truncar(resumo.extract)
  const link =
    resumo.content_urls?.desktop?.page ||
    `https://pt.wikipedia.org/wiki/${encodeURIComponent(String(resumo.title || '').replace(/\s+/g, '_'))}`

  return (
    `ðŸ“š *WIKIPÃ‰DIA DO LIMBO* ðŸŒ™\n\n` +
    `âœ¨ *${titulo}*\n\n` +
    `ðŸ“– ${extrato}\n\n` +
    `ðŸŒŒ *Ler o artigo completo:* ${link}\n\n` +
    `ðŸ’¤ *"O conhecimento tambÃ©m descansa nos sonhos."*`
  )
}

// â”€â”€â”€ ðŸ“¨ ExecuÃ§Ã£o do comando â”€â”€â”€
module.exports = {
  nome: 'wiki',
  aliases: ['wikipedia', 'wikipredia', 'pesquisar'],
  descricao: 'Busca e exibe o resumo de um artigo da WikipÃ©dia em portuguÃªs.',
  categoria: 'utilitario',

  async executar(sock, jid, msg, text) {
    try {
      // 1) ðŸ” Extrai o termo de busca (tudo depois de "/wiki")
      const termo = String(text || '').replace(/^\/\S+\s*/, '').trim()
      if (!termo) {
        return await sock.sendMessage(jid, {
          text: 'ðŸ“š *Me diga o que procurar nos pergaminhos...*\n\n' +
            'Informe o termo logo apÃ³s o comando.\n\n' +
            'ðŸ—ï¸ Exemplo: `/wiki Buraco Negro`'
        }, { quoted: msg })
      }

      // 2) ðŸ“„ Resumo (com fallback de busca em 404)
      const resumo = await buscarResumo(termo)

      // Artigo sem texto (pÃ¡gina de desambiguaÃ§Ã£o vazia, etc.)
      if (!String(resumo.extract || '').trim()) {
        throw new ErroWiki('resumo vazio para o artigo', 'nao_encontrado')
      }

      // 3) âœ‰ï¸ Monta a mensagem (resumo truncado a ~800 + link no final)
      const legenda = montarLegenda(resumo)
      const urlImagem = resumo.thumbnail?.source

      // 4) ðŸ–¼ï¸ Com imagem: envia foto com legenda; download falhou -> texto
      if (urlImagem) {
        try {
          const imagem = await baixarImagem(urlImagem)
          return await sock.sendMessage(jid, { image: imagem, caption: legenda }, { quoted: msg })
        } catch (errImagem) {
          console.error('[wiki] ðŸ“Ž download da imagem falhou â€” enviando sÃ³ o texto:', errImagem?.message || errImagem)
        }
      }

      // 5) ðŸ“œ Sem imagem (ou download falhou): mensagem de texto
      return await sock.sendMessage(jid, { text: legenda }, { quoted: msg })
    } catch (err) {
      console.error('[wiki] erro na consulta:', err)
      const aviso = err?.tipo === 'nao_encontrado'
        ? 'ðŸ“š *Essa consulta nÃ£o retornou conhecimento no Limbo...*\n\n' +
          'A WikipÃ©dia nÃ£o achou nada com esse termo. Tente outras palavras.\n\n' +
          'ðŸ—ï¸ Exemplo: `/wiki Buraco Negro`'
        : 'â›” *Os pergaminhos do limbo ficaram fora do alcance...*\n\n' +
          'A WikipÃ©dia nÃ£o respondeu agora. Tente novamente em instantes.'
      return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    }
  }
}
