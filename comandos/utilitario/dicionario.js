// DICIONÁRIO — Significados do Limbo (uso LIVRE)
// Consulta a definição de uma palavra em português.
// Grupos e privado: /dicionario efêmero (aliases: /significado, /dicio, /definicao)
// Provedores (ordem, mesma técnica do /clima):
//   1) https://api.dictionaryapi.dev/api/v2/entries/pt/{palavra}
//   2) https://api.dicio.com.br/v2/{palavra}
// Timeout 10s via AbortController. Logs "[dicionario] ...".
const TIMEOUT_API_MS = 10000
const MAX_SIGNIFICADOS = 5
const URL_DICTIONARY_API = 'https://api.dictionaryapi.dev/api/v2/entries'
const URL_DICIO = 'https://api.dicio.com.br/v2'
const USER_AGENT = 'HipnosBot/1.0 (https://github.com/Sanx7/Hipnos-Bot)'
class ErroDicionario extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroDicionario'
    this.tipo = tipo
  }
}


async function buscarTexto(url) {
  const controller = new AbortController()
  const tout = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT },
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
    if (err.name === 'AbortError') throw new ErroDicionario('timeout', 'api')
    throw new ErroDicionario((err && err.message) || String(err), 'api')
  }
}

function normalizar(texto) {
  return String(texto || '').replace(/^\/\S+\s*/, '').trim().replace(/\s+/g, ' ').toLowerCase()
}


function traduzirClasse(classe) {
  const mapa = { noun: 'substantivo', verb: 'verbo', adjective: 'adjetivo', adverb: 'advérbio',
    pronoun: 'pronome', preposition: 'preposição', conjunction: 'conjunção',
    interjection: 'interjeição', article: 'artigo', determiner: 'determinante' }
  if (!classe) return '—'
  const chave = String(classe).trim().toLowerCase()
  return mapa[chave] || chave
}

function extrair(lista) {
  const achadas = []
  if (!Array.isArray(lista)) return achadas
  for (const item of lista) {
    let t = item
    if (item && typeof item === 'object') t = item.definition || item.definicao
    if (typeof t === 'string' && t.trim()) achadas.push(t.trim())
  }
  return achadas
}

function parserA(texto, palavraBuscada) {
  let dados
  try { dados = JSON.parse(texto) } catch (e) { return null }
  if (!Array.isArray(dados) || !dados.length) return null
  const entrada = dados[0]
  const sentidos = Array.isArray(entrada.meanings) ? entrada.meanings : []
  const definicoes = []
  const classes = []
  for (const s of sentidos) {
    const c = traduzirClasse(s.partOfSpeech)
    if (c !== '—' && classes.indexOf(c) < 0) classes.push(c)
    const lista = extrair(s.definitions)
    for (const d of lista) definicoes.push(d)
  }
  if (!definicoes.length) return null
  const palavra = String(entrada.word || palavraBuscada).trim() || palavraBuscada
  return { palavra, classes: classes.slice(0, 3), definicoes }
}

function parserB(texto, palavraBuscada) {
  let dados
  try { dados = JSON.parse(texto) } catch (e) { return null }
  const alvos = Array.isArray(dados) ? dados : [dados]
  const definicoes = []
  const classes = []
  let achada = ''
  for (const a of alvos) {
    if (!a || typeof a !== 'object') continue
    if (!achada) achada = String(a.word || a.palavra || '').trim()
    const c = traduzirClasse(a.partOfSpeech || a.part_of_speech || a.classe || a.class)
    if (c !== '—' && classes.indexOf(c) < 0) classes.push(c)
    const listas = [a.meanings, a.definitions, a.definicoes, a.significados]
    for (const lista of listas) {
      const parcial = extrair(lista)
      for (const d of parcial) definicoes.push(d)
    }
  }
  if (!definicoes.length) return null
  return { palavra: achada || palavraBuscada, classes, definicoes }
}



async function pesquisar(palavraBuscada) {
  const cod = encodeURIComponent(palavraBuscada)
  const provs = [
    { nome: 'dictionaryapi', url: URL_DICTIONARY_API + '/pt/' + cod, parser: parserA },
    { nome: 'dicio', url: URL_DICIO + '/' + cod, parser: parserB }
  ]
  let houve404 = false
  let ultimo = null
  for (const p of provs) {
    try {
      const texto = await buscarTexto(p.url)
      const ok = p.parser(texto, palavraBuscada)
      if (!ok) throw new ErroDicionario('esquema irreconhecível', 'api')
      return ok
    } catch (err) {
      if (err instanceof ErroDicionario && err.tipo === 'nao_encontrado') houve404 = true
      ultimo = err
      console.error('[dicionario] ' + p.nome + ' falhou:', (err && err.message) || err)
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
