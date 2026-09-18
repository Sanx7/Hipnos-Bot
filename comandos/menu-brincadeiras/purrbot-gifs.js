// ============================================================
// 📦 CORE DA PURRBOT API (v2) — único ponto de chamada da API
//
// NÃO reescreve nada do projeto. Apenas:
//   - monta a URL no formato confirmado ao vivo: /v2/img/{rating}/{acao}/{formato}
//     (formulario gif ou img; formas img/sfw/{acao}/gif testadas = 200+JSON+link)
//   - faz a requisição com timeout de 10s;
//   - valida error/link;
//   - devolve a URL da mídia ou null (NUNCA lança).
//
// Fonte: raiz https://api.purrbot.site/v2/ anuncia o index; formato e JSON de
// resposta confirmados ao vivo contra os endpoints de interação (SFW gif/img e
// NSFW yaoi/yuri). Não inventamos ações: cada comando informa rating/acao/formato.
// ============================================================

const axios = require('axios')

// Tempo máximo de espera por chamada (ms). Padrão usado em todo o projeto para
// chamadas de rede (ex.: meme.js, nasa.js: timeout ~10s).
const TIMEOUT_MS = 10000

/**
 * montaUrl({rating, acao, formato})
 *   rating  : 'sfw' | 'nsfw'
 *   acao    : slug da ação (hug, kiss, slap, …)
 *   formato : 'gif' | 'img'
 * Devolve a URL pronta ou null se os parâmetros forem inválidos (causa interno,
 * não da API).
 */
function montaUrl({ rating, acao, formato }) {
  if (!rating || !acao || !formato) return null
  for (const [chave, opcoes] of Object.entries({
    rating  : ['sfw', 'nsfw'],
    formato : ['gif', 'img']
  })) {
    if (!opcoes.includes(chave === 'rating' ? rating : formato)) return null
  }
  const slug = String(acao).toLowerCase().trim().replace(/\s+/g, '-')
  if (!slug) return null
  const dominio = process.env.PURRBOT_BASE_URL || 'https://api.purrbot.site'
  return [dominio, 'v2', 'img', rating, slug, formato].join('/')
}

/**
 * obterMedia({rating, acao, formato})
 * Realiza a requisição ao vivo, valida a resposta e retorna a URL de download
 * (o campo `link` do JSON). Em qualquer falha retorna null.
 */
async function obterMedia({ rating, acao, formato }) {
  const url = montaUrl({ rating, acao, formato })
  if (!url) {
    console.warn(`[purrbot] URL malformada para ${acao} (${rating}/${formato})`)
    return null
  }
  try {
    const resposta = await axios.get(url, { timeout: TIMEOUT_MS, responseType: 'json' })
    if (!resposta || !resposta.data) return null
    const j = resposta.data
    // A API devolve o link direto; erro interno = error:true. Ambos => sem mídia.
    if (j.error) {
      console.warn(`[purrbot] API reports(error=true): ${url}`)
      return null
    }
    const link = String(j.link || '').trim()
    if (!link || !/(^https?:\/\/)|(i\.imgur\.com)/.test(link)) {
      console.warn(`[purrbot] link inválido/missing em ${url}`)
      return null
    }
    return link
  } catch (erro) {
    if (erro && erro.response && typeof erro.response.status === 'number') {
      console.warn(`[purrbot] HTTP ${erro.response.status} ao buscar ${acao} (${rating}/${formato})`)
    } else if (erro && (erro.code === 'ECONNABORTED' || /timed? ?out/i.test(String(erro.message || '')))) {
      console.warn(`[purrbot] timeout ao buscar ${acao} (${rating}/${formato})`)
    } else {
      console.warn(`[purrbot] falha ao buscar ${acao} (${rating}/${formato}): ${erro?.message || erro}`)
    }
    return null
  }
}

// ------------------------------------------------
// Regras de uso (exportadas para os comandos que
// precisarem exibir algo ao usuário):
// ------------------------------------------------

const REGRAS = {
  minutos : 5
}

// ------------------------------------------------
// Exportação
// ------------------------------------------------
module.exports = {
  montaUrl,
  obterMedia,

  // rating/acao/formato são escolhidos por cima de cada comando; mas poderei
  // exportar estes de assistência também:
  DEFAULT_RATING : 'sfw',
  TIMEOUT_MS
}
