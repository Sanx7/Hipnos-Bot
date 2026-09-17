// DICIONÁRIO — Significados do Limbo (uso LIVRE)
// Consulta a definição de uma palavra em português.
// Grupos e privado: /dicionario efêmero (aliases: /significado, /dicio, /definicao)
//
// 🔍 CAUSAS RAIZ DOS ERROS CORRIGIDOS (investigação):
//   1) "dictionaryapi falhou: timeout" → o api.dictionaryapi.dev estava com a
//      ORIGEM MORTA: o Cloudflare respondia HTTP 522 ("Connection timed out"
//      na origem) em 2 testes reais consecutivos (~19,8s e ~19,5s — acima dos
//      10s do AbortController, que abortava antes de ver o 522). Fonte FORA
//      DO AR ⇒ REMOVIDA do fallback (não vale queimar +10s em toda falha).
//   2) "dicio falhou: fetch failed" → a URL usada era https://api.dicio.com.br/v2/...
//      e o host api.dicio.com.br NÃO EXISTE NO DNS (ENOTFOUND confirmado).
//      Não era bloqueio de scraping nem User-Agent: a API JSON nunca existiu.
//      O SITE REAL www.dicio.com.br responde 200 com o verbete completo.
//
// ✅ PROVEDORES ATUAIS (ordem, mesma técnica do /clima):
//   1) Dicio (HTML): https://www.dicio.com.br/{palavra}/
//      → parser da seção <p class="significado..."> (spans cl/tag/definição;
//        etimologia excluída). Palavra inexistente → HTTP 404 real.
//   2) Significados (HTML): https://significados.com.br/{palavra}/
//      → fallback: parágrafos do <article> (verbete em prosa, cortado).
//        Palavra inexistente → HTTP 404 real.
// Ambos usam User-Agent de NAVEGADOR + Accept-Language pt-BR (defesa contra
// filtragem por UA — mesmo padrão já visto no projeto com YouTube/TikTok).
// Timeout 10s via AbortController. Logs "[dicionario] ..." com a CAUSE original.
const TIMEOUT_API_MS = 10000
const MAX_SIGNIFICADOS = 5
const URL_DICIO = 'https://www.dicio.com.br'
const URL_SIGNIFICADOS = 'https://significados.com.br'
// 🧭 UA de navegador comum (o antigo "HipnosBot/1.0" é exatamente o tipo de
// client que sites com anti-scraping filtram; testado: o dicio responde 200
// com ambos hoje, mas UA de navegador é o mais resistente a mudanças).
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
class ErroDicionario extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroDicionario'
    this.tipo = tipo
  }
}


// -------------------------------------------------------------------
// Detalha erros de rede: "fetch failed" sozinho não diz nada — a causa
// real (DNS, conexão recusada, TLS, reset...) vive em err.cause (undici).
// -------------------------------------------------------------------
function descreverErroRede(err) {
  const causa = err && err.cause
  if (!causa) return (err && err.message) || String(err)
  const detalhe = String(causa.code || causa.message || causa)
  return ((err && err.message) || String(err)) + ' ← causa original: ' + detalhe
}

async function buscarTexto(url) {
  const controller = new AbortController()
  const tout = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
      },
      signal: controller.signal
    })
    clearTimeout(tout)
    if (!r.ok) {
      if (r.status === 404) throw new ErroDicionario('HTTP 404', 'nao_encontrado')
      throw new ErroDicionario('HTTP ' + r.status, 'api')
    }
    return await r.text()
  } catch (err) {
    clearTimeout(tout)
    if (err instanceof ErroDicionario) throw err
    if (err.name === 'AbortError') throw new ErroDicionario('timeout (' + (TIMEOUT_API_MS / 1000) + 's)', 'api')
    throw new ErroDicionario(descreverErroRede(err), 'api')
  }
}

// -------------------------------------------------------------------
// Decodifica entidades HTML comuns (latin1 + numéricas) e remove tags.
// -------------------------------------------------------------------
const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã',
  eacute: 'é', ecirc: 'ê', egrave: 'è',
  iacute: 'í', icirc: 'î', igrave: 'ì',
  oacute: 'ó', ocirc: 'ô', otilde: 'õ', ograve: 'ò',
  uacute: 'ú', ucirc: 'û', ugrave: 'ù', ccedil: 'ç'
}
function decodificarEntidades(texto) {
  return String(texto || '')
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)) } catch (e) { return ' ' }
    })
    .replace(/&#(\d+);/g, (m, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)) } catch (e) { return ' ' }
    })
    .replace(/&([a-z]+);/gi, (m, nome) => {
      const minusculo = nome.toLowerCase()
      return Object.prototype.hasOwnProperty.call(ENTIDADES, minusculo) ? ENTIDADES[minusculo] : ' '
    })
}
function limparTexto(html) {
  return decodificarEntidades(String(html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim()
}

function normalizar(texto) {
  return String(texto || '').replace(/^\/\S+\s*/, '').trim().replace(/\s+/g, ' ').toLowerCase()
}

// -------------------------------------------------------------------
// 🟦 Parser do Dicio (www.dicio.com.br): a seção de significado usa
// <h2 class="tit-significado">Significado de X</h2> seguido de
// <p class="significado ..."> com spans:
//   <span class="cl">adjetivo</span>                 → classe gramatical
//   <span>definição...</span>                        → definição
//   <span><span class="tag">[Área]</span> ...</span> → definição com área
//   <span class="etim">Etimologia...</span>          → EXCLUÍDA
// Spans aninhadas são seguras: o regex global casa a externa até o 1º
// </span> (o da interna) e o conteúdo capturado já inclui a tag + texto.
// -------------------------------------------------------------------
function valorClasse(attrHtml) {
  const m = /class\s*=\s*["']([^"']*)["']/.exec(attrHtml || '')
  return m ? m[1].trim().split(/\s+/) : []
}

function parserDicio(texto, palavraBuscada) {
  // 📛 Palavra exibida: 1º <h1> da página (strip tags — o h1 traz um
  // <sg-speech-button> aninhado que some no strip)
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(texto)
  const palavra = limparTexto(h1 && h1[1]).split(' ')[0] || palavraBuscada

  const definicoes = []
  const classes = []
  const blocos = texto.match(/<p class="significado[^"]*">[\s\S]*?<\/p>/g) || []
  for (const bloco of blocos) {
    // Etimologia fora (não é definição)
    const semEtim = bloco.replace(/<span[^>]*class="[^"]*etim[^"]*"[^>]*>[\s\S]*?<\/span>/g, '')
    const spans = semEtim.match(/<span\b[^>]*>[\s\S]*?<\/span>/g) || []
    for (const spanBruto of spans) {
      const abertura = /<span\b([^>]*)>/.exec(spanBruto)
      const listaClasse = valorClasse(abertura && abertura[1])
      const conteudoHtml = spanBruto.replace(/^<span\b[^>]*>/, '').replace(/<\/span>$/, '')
      const textoLimpo = limparTexto(conteudoHtml)
      if (!textoLimpo) continue
      if (listaClasse.includes('cl')) {
        if (classes.length < 3 && classes.indexOf(textoLimpo) < 0) classes.push(textoLimpo)
      } else {
        definicoes.push(textoLimpo)
      }
    }
  }
  if (!definicoes.length) return null
  return { palavra, classes, definicoes }
}

// -------------------------------------------------------------------
// 🟨 Parser do Significados (significados.com.br) — verbete em PROSA:
// <article class="article"><h1 class="t">X</h1><p>parágrafo</p>...
// Sem classe gramatical estruturada (classes fica vazio e a linha some
// do card). Cada "definição" exibida é um parágrafo do verbete, cortado
// pra não virar parede de texto no WhatsApp.
// -------------------------------------------------------------------
function parserSignificados(texto, palavraBuscada) {
  const artigo = /<article\b[^>]*>([\s\S]*?)<\/article>/.exec(texto)
  const corpo = (artigo && artigo[1]) || texto

  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(corpo)
  const palavra = limparTexto(h1 && h1[1]) || palavraBuscada

  // Remove blocos não-textuais antes de varrer os parágrafos
  const limpo = corpo
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<h1\b[\s\S]*?<\/h1>/gi, ' ') // título já capturado

  const paragrafos = []
  const matches = limpo.match(/<p\b[^>]*>[\s\S]*?<\/p>/g) || []
  for (const p of matches) {
    const conteudo = limparTexto(p)
    if (conteudo.length < 40) continue // lixo (links soltos, rodapé...)
    paragrafos.push(conteudo.length > 350 ? conteudo.slice(0, 350).trim() + '…' : conteudo)
    if (paragrafos.length >= 4) break
  }
  if (!paragrafos.length) return null
  return { palavra, classes: [], definicoes: paragrafos }
}



async function pesquisar(palavraBuscada) {
  const cod = encodeURIComponent(palavraBuscada)
  const provs = [
    { nome: 'dicio', url: URL_DICIO + '/' + cod + '/', parser: parserDicio },
    { nome: 'significados', url: URL_SIGNIFICADOS + '/' + cod + '/', parser: parserSignificados }
  ]
  let houve404 = false
  let ultimo = null
  for (const p of provs) {
    try {
      const texto = await buscarTexto(p.url)
      const ok = p.parser(texto, palavraBuscada)
      if (!ok) throw new ErroDicionario('esquema irreconhecível (HTML mudou?)', 'api')
      return ok
    } catch (err) {
      if (err instanceof ErroDicionario && err.tipo === 'nao_encontrado') houve404 = true
      ultimo = err
      // 🧾 Log detalhado: fonte + URL chamada + mensagem COM a cause original
      console.error('[dicionario] ' + p.nome + ' (' + p.url + ') falhou:', (err && err.message) || err)
    }
  }
  if (houve404) throw new ErroDicionario('não encontrada', 'nao_encontrado')
  throw ultimo || new ErroDicionario('falha geral', 'api')
}

function montar(entrada) {
  const exibidas = entrada.definicoes.slice(0, MAX_SIGNIFICADOS)
  const restantes = entrada.definicoes.length - exibidas.length
  let texto = '📖 *DICIONÁRIO DO LIMBO* 📕\n\n✒️ Palavra: *' + entrada.palavra + '*\n'
  if (entrada.classes.length) texto += '📚 Classe gramatical: *' + entrada.classes.join(' · ') + '*\n'
  texto += '\n'
  exibidas.forEach((d, i) => { texto += (i + 1) + '. ' + d + '\n' })
  if (restantes > 0) texto += '\n🌙 *+' + restantes + ' nos pergaminhos...*\n'
  texto += '\n💤 *"Cada palavra guarda um significado."*'
  return texto
}

module.exports = {
  nome: 'dicionario',
  aliases: ['significado', 'dicio', 'definicao'],
  descricao: 'Exibe a definição e os significados de uma palavra em português.',
  categoria: 'utilitario'
}
module.exports.executar = async function (sock, jid, msg, text) {
  try {
    const palavra = normalizar(text)
    if (!palavra) {
      return await sock.sendMessage(jid, {
        text: '📖 *Me diga qual palavra procurar...*\n\nInforme a palavra depois do comando.\n\n🗝️ Exemplo: `/dicionario efêmero`'
      }, { quoted: msg })
    }
    const entrada = await pesquisar(palavra)
    return await sock.sendMessage(jid, { text: montar(entrada) }, { quoted: msg })
  } catch (err) {
    console.error('[dicionario] erro na consulta:', err)
    let aviso = '⛔ *As bibliotecas do limbo ficaram fora do alcance...*\n\nOs dicionários não responderam agora. Tente novamente em instantes.'
    if (err && err.tipo === 'nao_encontrado') {
      aviso = '📖 *Essa palavra não vive nos pergaminhos do Limbo...*\n\nNão encontrei definições para ela. Verifique a ortografia e tente de novo.\n\n🗝️ Exemplo: `/dicionario efêmero`'
    }
    return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
  }
}
// 🧪 Gancho de teste (padrão do projeto): permite exercitar a seleção de
// fontes e mocks sem passar pelo roteador do bot.
module.exports.__procurar = pesquisar
