// ============================================
// 🏷️ GERAR NOME — A IA inventa nomes criativos pra qualquer tema (/gerar-nome)
// ============================================
// Uso LIVRE em grupos e no privado:
//   /gerar-nome rpg fantasia
//   /gerar-nome banda de rock
//   /gerar-nome time de futebol
//   /gerar-nome nome engraçado pra grupo do whatsapp
//   (também: /gerarnome)
//
// Regras:
//   - tema LIVRE em texto: NÃO existe lista fixa engessada, a IA lida com
//     qualquer tema descrito (inclusive com emoji e texto comprido);
//   - sempre 5 sugestões por chamada, numeradas (1) a (5) — a numeração é
//     aplicada pelo BOT, não pela IA, então sai limpa mesmo se o modelo
//     devolver bullets, numeração própria ou texto corrido;
//   - sem tema -> aviso de uso, sem gastar API;
//   - client de IA: o MESMO do RPG (ia-interativa.js) e do /gpt — Groq
//     (GROQ_API_KEY + /openai/v1/chat/completions). Modelo sobrescrevível
//     por variável de ambiente sem tocar no código (GROQ_MODEL_GERARNOME);
//   - 429/timeout -> "mente sobrecarregada..."; qualquer falha -> aviso,
//     NUNCA exceção vazando para o listener do Baileys.
// ============================================

const TIMEOUT_API_MS = 20000
const TAMANHO_BLOCO = 2500
const QUANTIDADE = 5
const LIMITE_TEMA = 300
const URL_GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions'
const MODELO_PADRAO = 'openai/gpt-oss-20b'

class ErroGerarNome extends Error {
  constructor (mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroGerarNome'
    this.tipo = tipo
  }
}

function modeloGerarNome () {
  const personalizado = String(process.env.GROQ_MODEL_GERARNOME || process.env.GROQ_MODEL || '').trim()
  return personalizado || MODELO_PADRAO
}

function extrairTema (texto) {
  return String(texto || '').replace(/^\/\S+\s*/, '').trim()
}

// 🎭 Prompt fixo em pt-BR: nomes criativos e variados, estilos diferentes
// entre si, resposta SÓ com a lista (sem explicação, sem introdução).
function promptPara (tema) {
  return 'Você é Hipnos, o guardião do Limbo e dos sonhos (pt-BR). ' +
    'Sua única tarefa é sugerir ' + QUANTIDADE + ' nomes para o tema informado pelo usuário: "' + tema + '". ' +
    'Regras: os ' + QUANTIDADE + ' nomes devem ter estilos bem diferentes entre si ' +
    '(evite repetir o mesmo padrão de nome entre as opções), devem ser curtos, ' +
    'fáceis de lembrar e em português do Brasil quando o tema permitir. ' +
    'Responda SOMENTE com a lista: uma opção por linha, sem numeração, sem bullets, ' +
    'sem aspas e sem nenhuma explicação ou comentário.'
}

async function gerarNomesComIa (tema) {
  const chave = String(process.env.GROQ_API_KEY || '').trim()
  if (!chave) throw new ErroGerarNome('sem GROQ_API_KEY', 'sem_chave')
  const controller = new AbortController()
  const tout = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  let resposta
  try {
    resposta = await fetch(URL_GROQ_CHAT, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modeloGerarNome(),
        messages: [
          { role: 'system', content: promptPara(tema) },
          { role: 'user', content: 'Tema: ' + tema }
        ],
        temperature: 1,
        max_tokens: 500
      }),
      signal: controller.signal
    })
  } catch (err) {
    clearTimeout(tout)
    if (err && err.name === 'AbortError') throw new ErroGerarNome('timeout', 'timeout')
    throw new ErroGerarNome(String((err && err.message) || err), 'api')
  }
  clearTimeout(tout)
  if (!resposta.ok) {
    if (resposta.status === 401 || resposta.status === 403) throw new ErroGerarNome('HTTP 401', 'chave_invalida')
    if (resposta.status === 429) throw new ErroGerarNome('HTTP 429', 'limite')
    throw new ErroGerarNome('HTTP ' + resposta.status, 'api')
  }
  const dados = await resposta.json().catch(() => null)
  const msgIa = dados && dados.choices && dados.choices[0] && dados.choices[0].message
  const texto = String((msgIa && msgIa.content) || '').trim()
  if (!texto) throw new ErroGerarNome('resposta vazia', 'vazia')
  return texto
}

let chamadaIa = gerarNomesComIa
// 🧹 Limpa a resposta da IA e devolve ATÉ QUANTIDADE nomes limpos.
// Aceita: linhas numeradas ("1. Nome", "1) Nome", "2 - Nome"), bullets
// ("- Nome", "* Nome", "• Nome") ou texto corrido separado por vírgula.
function limparSugestoes (texto) {
  const bruto = String(texto || '').trim()
  if (!bruto) return []
  const linhas = bruto
    .split(/\r?\n|,|;/)
    .map((l) => String(l)
      .replace(/^\s*(?:\d+)?\s*[*•‣▪>»]?\s*[.)\-:–—]?\s*/, '')
      .replace(/^\s*\*\*(.+?)\*\*\s*$/, '$1')
      .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
      .trim())
    .filter((l) => l.length > 1 && l.length <= 80)
    .filter((l) => !/^(tema|sugest|escreva|aqui|claro|certo|ok|pronto)/i.test(l))
  const unicos = []
  for (const nome of linhas) {
    if (unicos.some((n) => n.toLowerCase() === nome.toLowerCase())) continue
    unicos.push(nome)
    if (unicos.length === QUANTIDADE) break
  }
  return unicos
}

function numerarSugestoes (nomes) {
  return nomes.map((nome, i) => `*${i + 1})* ${nome}`)
}

function truncarTema (tema) {
  if (tema.length <= LIMITE_TEMA) return tema
  return tema.slice(0, LIMITE_TEMA).trim()
}

function dividirEmBlocos (texto) {
  const limpo = String(texto || '').trim()
  if (!limpo) return []
  if (limpo.length <= TAMANHO_BLOCO) return [limpo]
  const blocos = []
  let restante = limpo
  while (restante.length > TAMANHO_BLOCO) {
    let corte = restante.lastIndexOf('\n', TAMANHO_BLOCO)
    if (corte < TAMANHO_BLOCO / 2) corte = restante.lastIndexOf(' ', TAMANHO_BLOCO)
    if (corte <= 0) corte = TAMANHO_BLOCO
    blocos.push(restante.slice(0, corte).trim())
    restante = restante.slice(corte).trim()
  }
  if (restante) blocos.push(restante)
  return blocos
}

function ajudaUso () {
  return '🏷️ *Me diga o tema que eu batizo...*\n\n' +
    '`/gerar-nome <tema em texto livre>`\n\n' +
    '🗝️ Exemplos:\n' +
    '- `/gerar-nome rpg fantasia`\n' +
    '- `/gerar-nome banda de rock`\n' +
    '- `/gerar-nome time de futebol`\n' +
    '- `/gerar-nome nome engraçado pra grupo do whatsapp`'
}

function cabecalho (tema) {
  return '🏷️ *NOMEIOS DO LIMBO* 🌙\n\n🎭 Tema: *' + tema + '*\n\n'
}

function avisoPara (tipo) {
  if (tipo === 'sem_chave' || tipo === 'chave_invalida') {
    return '😴 *A mente da IA ainda dorme neste recinto...*\n\nO recurso precisa da chave GROQ_API_KEY configurada pelo dono do bot (grátis em console.groq.com).'
  }
  if (tipo === 'limite' || tipo === 'timeout') {
    return '⏳ *A mente da IA está sobrecarregada...*\n\nAguarde um pouco e tente gerar os nomes de novo.'
  }
  return '⛔ *As sombras engoliram os nomes...*\n\nA IA não respondeu agora. Tente novamente em instantes.'
}

module.exports = {
  nome: 'gerar-nome',
  aliases: ['gerarnome', 'nomeia'],
  descricao: 'Gera 5 sugestões de nomes com a IA para qualquer tema (também: /gerarnome).',
  categoria: 'brincadeiras',

  async executar (sock, jid, msg, text) {
    try {
      const temaBruto = extrairTema(text)
      if (!temaBruto) {
        return await sock.sendMessage(jid, { text: ajudaUso() }, { quoted: msg })
      }
      const tema = truncarTema(temaBruto)
      const avisoCorte = temaBruto.length > LIMITE_TEMA
        ? '\n✂️ *Aviso:* tema muito longo, usei só os ' + LIMITE_TEMA + ' primeiros caracteres.\n\n'
        : ''
      const resposta = await chamadaIa(tema)
      const nomes = limparSugestoes(resposta)
      if (!nomes.length) throw new ErroGerarNome('lista vazia', 'vazia')
      const corpo = cabecalho(tema) + avisoCorte + numerarSugestoes(nomes).join('\n')
      const blocos = dividirEmBlocos(corpo)
      for (let i = 0; i < blocos.length; i++) {
        if (i === 0) await sock.sendMessage(jid, { text: blocos[i] }, { quoted: msg })
        else await sock.sendMessage(jid, { text: blocos[i] })
      }
    } catch (err) {
      console.error('[gerar-nome] erro ao gerar nomes:', err)
      return await sock.sendMessage(jid, { text: avisoPara(err && err.tipo) }, { quoted: msg }).catch(() => {})
    }
  },

  _injetarIa (fn) { chamadaIa = fn },
  _restaurarIa () { chamadaIa = gerarNomesComIa },
  __internos: {
    TIMEOUT_API_MS, TAMANHO_BLOCO, QUANTIDADE, LIMITE_TEMA, URL_GROQ_CHAT, MODELO_PADRAO,
    modeloGerarNome, extrairTema, promptPara, limparSugestoes, numerarSugestoes,
    truncarTema, dividirEmBlocos, ajudaUso, cabecalho, avisoPara
  }
}
