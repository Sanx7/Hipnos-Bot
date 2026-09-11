// ============================================
// 🌌 NASA — Foto Astronômica do Dia (APOD) do Limbo
// ============================================
// Exibe a Foto Astronômica do Dia da NASA com título e explicação
// traduzidos para pt-BR via Groq (com fallback para o inglês).
//
// Como usar (uso LIVRE, funciona em grupos e no privado):
//   /nasa
//   (também: /apod, /astronomia e /foto-nasa)
//
// Regras (mesmo padrão do /ddd e do /wiki):
//   - NASA_API_KEY do ambiente, com fallback para 'DEMO_KEY';
//   - GET https://api.nasa.gov/planetary/apod?api_key=... (timeout 15s);
//   - media_type "image" -> baixa url (fallback hdurl, limite 15 MB) e
//     envia { image: Buffer, caption }; download falhou -> texto + link;
//   - media_type "video" -> texto explicativo + link do vídeo;
//   - tradução título+explicação em UMA chamada Groq (json_object);
//     qualquer falha -> texto original em inglês, sem quebrar;
//   - 429/403 -> aviso de limite citando a NASA_API_KEY;
//   - NASA fora do ar -> mensagem amigável; logs "[nasa] ...".
// ============================================

const TIMEOUT_API_MS = 15000
const LIMITE_BYTES_IMAGEM = 15 * 1024 * 1024
const URL_APOD = 'https://api.nasa.gov/planetary/apod?api_key='
const URL_GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions'
const MODELO_TRADUCAO = 'openai/gpt-oss-20b'

class ErroNasa extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroNasa'
    this.tipo = tipo
  }
}

function chaveNasa() {
  const chave = String(process.env.NASA_API_KEY || '').trim()
  return chave || 'DEMO_KEY'
}

function modeloTraducao() {
  const personalizado = String(process.env.GROQ_MODEL || '').trim()
  return personalizado || MODELO_TRADUCAO
}

// ─── 🌌 GET no APOD com timeout → JSON parseado ───
async function buscarApod() {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    const resposta = await fetch(URL_APOD + encodeURIComponent(chaveNasa()), {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'HipnosBot/1.0' },
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      if (resposta.status === 429 || resposta.status === 403) {
        throw new ErroNasa('limite da API atingido (HTTP ' + resposta.status + ')', 'limite')
      }
      throw new ErroNasa('a API da NASA respondeu HTTP ' + resposta.status, 'api')
    }
    const dados = await resposta.json().catch(() => null)
    if (!dados || typeof dados !== 'object') {
      throw new ErroNasa('a NASA devolveu resposta inválida', 'api')
    }
    return dados
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof ErroNasa) throw err
    if (err && err.name === 'AbortError') {
      throw new ErroNasa('a consulta demorou demais (timeout)', 'api')
    }
    throw new ErroNasa(String((err && err.message) || err), 'api')
  }
}

// ─── 🈯 Traduz título+explicação via Groq (UMA chamada) ───
// Qualquer falha (sem chave, timeout, JSON inválido) -> null e o
// comando segue com o texto original em inglês (fallback).
async function traduzir(titulo, explicacao) {
  const chave = String(process.env.GROQ_API_KEY || '').trim()
  if (!chave) return null
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    const resposta = await fetch(URL_GROQ_CHAT, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modeloTraducao(),
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Você traduz textos astronômicos para o português do Brasil (pt-BR). Responda APENAS com um JSON válido no formato {"titulo": "...", "explicacao": "..."} sem comentários extras.'
          },
          { role: 'user', content: 'Traduza para o português do Brasil:\n\nTÍTULO: ' + titulo + '\n\nEXPLICAÇÃO: ' + explicacao }
        ]
      }),
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      console.error('[nasa] Groq respondeu HTTP ' + resposta.status + ' — usando texto original.')
      return null
    }
    const dados = await resposta.json().catch(() => null)
    const bruto = String((dados && dados.choices && dados.choices[0] && dados.choices[0].message && dados.choices[0].message.content) || '')
    const par = bruto.match(/\{[\s\S]*\}/)
    if (!par) {
      console.error('[nasa] Groq devolveu JSON inválido — usando texto original.')
      return null
    }
    const traduzido = JSON.parse(par[0])
    const tituloTraduzido = String(traduzido.titulo || '').trim()
    const explicacaoTraduzida = String(traduzido.explicacao || '').trim()
    if (!tituloTraduzido || !explicacaoTraduzida) return null
    return { titulo: tituloTraduzido, explicacao: explicacaoTraduzida }
  } catch (err) {
    clearTimeout(timeoutId)
    console.error('[nasa] tradução falhou — usando texto original:', (err && err.message) || err)
    return null
  }
}

// ─── 🖼️ Baixa a imagem com limite defensivo (15 MB) ───
// Retorna Buffer ou null (o chamador cai para o modo "texto + link").
async function baixarImagem(url) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    const resposta = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'HipnosBot/1.0' },
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      console.error('[nasa] download da imagem falhou (HTTP ' + resposta.status + ') — enviando link.')
      return null
    }
    const tamanhoDeclarado = Number(resposta.headers && resposta.headers.get && resposta.headers.get('content-length'))
    if (Number.isFinite(tamanhoDeclarado) && tamanhoDeclarado > LIMITE_BYTES_IMAGEM) {
      console.error('[nasa] imagem de ~' + Math.round(tamanhoDeclarado / 1024 / 1024) + ' MB excede o limite — enviando link.')
      return null
    }
    const buffer = Buffer.from(await resposta.arrayBuffer())
    if (!buffer.length || buffer.length > LIMITE_BYTES_IMAGEM) {
      console.error('[nasa] imagem inválida ou grande demais — enviando link.')
      return null
    }
    return buffer
  } catch (err) {
    clearTimeout(timeoutId)
    console.error('[nasa] download da imagem falhou — enviando link:', (err && err.message) || err)
    return null
  }
}

// ─── ✉️ Monta a legenda temática da foto do dia ───
function montarLegenda(apod, traducao) {
  const titulo = (traducao && traducao.titulo) || apod.title || 'Sonho sem título'
  const explicacao = (traducao && traducao.explicacao) || apod.explanation || ''
  const linhaCreditos = apod.copyright ? '\n📸 Créditos: *' + String(apod.copyright).trim() + '*' : ''
  return (
    '🌌 *FOTO ASTRONÔMICA DO DIA* ✨\n\n' +
    '🔭 *' + titulo + '*\n' +
    '📅 Data: *' + (apod.date || 'desconhecida') + '*' +
    linhaCreditos +
    '\n\n' + explicacao +
    '\n\n💤 *"Enquanto os mortais dormem, o universo sonha junto."*'
  )
}

// ─── 📨 Execução do comando ───
module.exports = {
  nome: 'nasa',
  aliases: ['apod', 'astronomia', 'foto-nasa'],
  descricao: 'Exibe a Foto Astronômica do Dia (APOD) da NASA com explicação traduzida.',
  categoria: 'utilitario',

  async executar(sock, jid, msg) {
    try {
      // 1) 🌌 Busca o APOD do dia
      const apod = await buscarApod()
      const titulo = String(apod.title || '').trim()
      const explicacao = String(apod.explanation || '').trim()
      if (!titulo && !explicacao) {
        throw new ErroNasa('a NASA devolveu o dia vazio', 'api')
      }

      // 2) 🈯 Traduz (fallback silencioso para o inglês)
      const traducao = await traduzir(titulo, explicacao)
      const legenda = montarLegenda(apod, traducao)

      // 3) 🎬 Vídeo -> texto explicativo + link
      if (apod.media_type === 'video') {
        const link = String(apod.url || '').trim()
        return await sock.sendMessage(jid, {
          text: legenda + (link ? '\n\n▶️ Assista ao vídeo: ' + link : '')
        }, { quoted: msg })
      }

      // 4) 🖼️ Imagem -> foto com legenda (ou texto + link se o download falhar)
      const urlImagem = String(apod.url || apod.hdurl || '').trim()
      if (urlImagem) {
        const buffer = await baixarImagem(urlImagem)
        if (buffer) {
          return await sock.sendMessage(jid, { image: buffer, caption: legenda }, { quoted: msg })
        }
        return await sock.sendMessage(jid, { text: legenda + '\n\n🔗 Ver a foto: ' + urlImagem }, { quoted: msg })
      }
      return await sock.sendMessage(jid, { text: legenda }, { quoted: msg })
    } catch (err) {
      console.error('[nasa] erro ao buscar o APOD:', err)
      let aviso = '⛔ *A NASA está fora do ar...*\n\nO telescópio do limbo não alcançou as estrelas agora. Tente novamente em instantes.'
      if (err && err.tipo === 'limite') {
        aviso = '⏳ *O telescópio atingiu o limite de consultas...*\n\nA chave atual estourou a cota da NASA. O dono pode configurar uma NASA_API_KEY própria (grátis em https://api.nasa.gov) e tentar de novo em instantes.'
      }
      return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    }
  }
}
