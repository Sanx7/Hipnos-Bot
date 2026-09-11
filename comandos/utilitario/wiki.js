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
// Tratamento de erros (mesmo padrão do /clima, /nasa e /ddd):
//   - termo ausente -> instruções de uso;
//   - nada encontrado -> "não retornou conhecimento no Limbo";
//   - rede/timeout/API fora -> aviso amigável; logs "[wiki] ..." no console;
//   - o isolamento do bot.js garante que nada derrube o listener.
// ============================================

// ⏳ Timeout das chamadas HTTP (ms) — requisito: 10s
const TIMEOUT_API_MS = 10000

// ✂️ Limite do resumo na mensagem ("cerca de 800-1000"; usamos 800 p/ caber
// com folga na legenda da imagem junto de título, link e assinatura)
const MAX_EXTRATO = 800

const URL_RESUMO = 'https://pt.wikipedia.org/api/rest_v1/page/summary'
const URL_BUSCA = 'https://pt.wikipedia.org/w/api.php'

// 🌐 User-Agent descritivo — exigido pela política da Wikipédia
const USER_AGENT = 'HipnosBot/1.0 (https://github.com/Sanx7/Hipnos-Bot)'

// 🧪 Erro de domínio: mensagem amigável + tipo p/ o aviso correto
class ErroWiki extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroWiki'
    this.tipo = tipo // 'api' | 'nao_encontrado'
  }
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
    if (!resposta.ok) throw new ErroWiki(`download da imagem falhou (HTTP ${resposta.status})`, 'api')
    const bytes = Buffer.from(await resposta.arrayBuffer())
    if (bytes.length === 0) throw new ErroWiki('download da imagem veio vazio', 'api')
    return bytes
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof ErroWiki) throw err
    if (err.name === 'AbortError') throw new ErroWiki('download da imagem demorou demais', 'api')
    throw new ErroWiki(err?.message || String(err), 'api')
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
    console.error(`[wiki] 📎 resumo direto 404 — tentando a busca tradicional: "${termo}"`)
  }

  const busca = await buscarJson(
    `${URL_BUSCA}?action=query&list=search&srsearch=${encodeURIComponent(termo)}&format=json`
  )
  const tituloAchado = busca?.query?.search?.[0]?.title
  if (!tituloAchado) {
    throw new ErroWiki('nenhum resultado na busca da Wikipédia', 'nao_encontrado')
  }
  console.error(`[wiki] 🔎 busca achou "${tituloAchado}" — refazendo o resumo`)
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
      const resumo = await buscarResumo(termo)

      // Artigo sem texto (página de desambiguação vazia, etc.)
      if (!String(resumo.extract || '').trim()) {
        throw new ErroWiki('resumo vazio para o artigo', 'nao_encontrado')
      }

      // 3) ✉️ Monta a mensagem (resumo truncado a ~800 + link no final)
      const legenda = montarLegenda(resumo)
      const urlImagem = resumo.thumbnail?.source

      // 4) 🖼️ Com imagem: envia foto com legenda; download falhou -> texto
      if (urlImagem) {
        try {
          const imagem = await baixarImagem(urlImagem)
          return await sock.sendMessage(jid, { image: imagem, caption: legenda }, { quoted: msg })
        } catch (errImagem) {
          console.error('[wiki] 📎 download da imagem falhou — enviando só o texto:', errImagem?.message || errImagem)
        }
      }

      // 5) 📜 Sem imagem (ou download falhou): mensagem de texto
      return await sock.sendMessage(jid, { text: legenda }, { quoted: msg })
    } catch (err) {
      console.error('[wiki] erro na consulta:', err)
      const aviso = err?.tipo === 'nao_encontrado'
        ? '📚 *Essa consulta não retornou conhecimento no Limbo...*\n\n' +
          'A Wikipédia não achou nada com esse termo. Tente outras palavras.\n\n' +
          '🗝️ Exemplo: `/wiki Buraco Negro`'
        : '⛔ *Os pergaminhos do limbo ficaram fora do alcance...*\n\n' +
          'A Wikipédia não respondeu agora. Tente novamente em instantes.'
      return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    }
  }
}