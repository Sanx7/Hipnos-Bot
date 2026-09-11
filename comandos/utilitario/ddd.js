// ============================================
// 🗺️ DDD — Mapa dos Territórios do Brasil
// ============================================
// Consulta o estado e as cidades de um DDD brasileiro na BrasilAPI
// (https://brasilapi.com.br/api/ddd/v1/{ddd}) e responde em PT-BR com a
// temática do Limbo:
//   - estado (sigla) dono do DDD;
//   - total de cidades atendidas;
//   - lista das cidades (se for longa, mostra as 15 primeiras e avisa
//     quantas restaram — evita estourar o limite de tamanho do WhatsApp).
//
// Como usar (uso LIVRE, funciona em grupos e no privado):
//   /ddd 11            -> DDD direto
//   /ddd 11999998888   -> número completo: usa os 2 primeiros dígitos
//   /ddd +55 11 99999-8888 -> com DDI: o 55 é descartado
//   (também: /estado-ddd e /cidades-ddd)
//
// Tratamento de erros (mesmo padrão do /clima e do /nasa):
//   - DDD malformado/ausente -> instruções de uso;
//   - HTTP 404 -> o DDD informado não existe no Brasil;
//   - API fora do ar / sem rede / timeout -> aviso amigável;
//   - logs "[ddd] ..." no console; o isolamento do bot.js garante que
//     nada derrube o listener.
// ============================================

// ⏳ Timeout da chamada HTTP (ms) — requisito: 10s
const TIMEOUT_API_MS = 10000

// 🏙️ Quantas cidades listar por vez (o resto vira nota de resumo — evita
// mensagem gigante que o WhatsApp corta)
const MAX_CIDADES_EXIBIDAS = 15

const URL_BRASILAPI = 'https://brasilapi.com.br/api/ddd/v1'

// 🧪 Erro de domínio: mensagem amigável + tipo p/ o aviso correto
class ErroDdd extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroDdd'
    this.tipo = tipo // 'api' | 'inexistente'
  }
}

// ─── 🌐 GET com timeout de 10s (mesmo padrão do /clima e do /nasa) ───
async function buscarJson(url) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    const resposta = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Hipnos-Bot/1.0'
      },
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      if (resposta.status === 404) {
        throw new ErroDdd('o DDD informado não existe no Brasil (HTTP 404)', 'inexistente')
      }
      throw new ErroDdd(`a BrasilAPI respondeu HTTP ${resposta.status}`, 'api')
    }
    return await resposta.json()
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof ErroDdd) throw err
    if (err.name === 'AbortError') {
      throw new ErroDdd('a consulta demorou demais (timeout)', 'api')
    }
    throw new ErroDdd(err?.message || String(err), 'api')
  }
}

// ─── 🔢 Extrai o DDD do texto digitado ───
// - "/ddd 11"            -> "11"
// - "/ddd 11999998888"   -> "11" (os 2 primeiros dígitos do número completo)
// - "/ddd +55 11 99999-8888" -> "11" (descarta o DDI 55 do começo)
// - entrada malformada (menos de 2 dígitos úteis) -> null
function extrairDdd(texto) {
  let digitos = String(texto || '')
    .replace(/^\/\S+\s*/, '')
    .replace(/\D/g, '')

  // Remove o DDI 55 quando o usuário colou o número com código do país
  if (digitos.length >= 12 && digitos.startsWith('55')) {
    digitos = digitos.slice(2)
  }

  if (digitos.length < 2) return null

  const ddd = digitos.slice(0, 2)
  const numero = Number(ddd)
  // DDD brasileiro nunca começa com 0 nem com 1 seguido de 0 (vai de 11 a 99);
  // DDDs bem formados mas inexistentes caem no HTTP 404 da BrasilAPI.
  if (!Number.isInteger(numero) || numero < 11 || numero > 99) return null
  return ddd
}

// ─── 🏙️ Normaliza o nome da cidade p/ exibição ───
// A BrasilAPI devolve os nomes em MAIÚSCULAS ("EMBU DAS ARTES") — para
// leitura agradável, aplicamos caixa de título preservando conectores:
// "Embu das Artes", "Várzea Paulista", "São Bernardo do Campo".
function formatarCidade(cidade) {
  const conectores = new Set(['de', 'da', 'do', 'dos', 'das', 'e'])
  return String(cidade || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((palavra, indice) =>
      indice > 0 && conectores.has(palavra)
        ? palavra
        : palavra.charAt(0).toUpperCase() + palavra.slice(1)
    )
    .join(' ')
}

// ─── ✉️ Monta a mensagem temática do mapa do DDD ───
function montarMensagem(ddd, dados) {
  const estado = String(dados.state || '').trim() || 'Desconhecido'
  const cidades = Array.isArray(dados.cities) ? dados.cities : []

  // Formata (título-case) e ordena alfabeticamente (pt-BR) p/ leitura agradável
  const cidadesOrdenadas = cidades
    .map(formatarCidade)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))

  const emExibicao = cidadesOrdenadas.slice(0, MAX_CIDADES_EXIBIDAS)
  const restantes = cidadesOrdenadas.length - emExibicao.length

  const linhas = emExibicao.map((cidade) => `• ${cidade}`).join('\n')
  const notaRestantes = restantes > 0
    ? `\n\n🌙 *+${restantes} cidade${restantes > 1 ? 's' : ''} seguem dormindo no limbo...* ` +
      `(mostradas ${emExibicao.length} de ${cidadesOrdenadas.length})`
    : ''

  return (
    `🗺️ *MAPA DO DDD ${ddd}* ✨\n\n` +
    `📍 Estado: *${estado}*\n` +
    `🏙️ *${cidadesOrdenadas.length.toLocaleString('pt-BR')}* cidade${cidadesOrdenadas.length === 1 ? '' : 's'} ecoam neste recinto:\n\n` +
    `${linhas || '• (nenhuma cidade listada pela BrasilAPI)'}` +
    notaRestantes +
    `\n\n💤 *"Todo número tem um lugar onde descansa."*`
  )
}

// ─── 📨 Execução do comando ───
module.exports = {
  nome: 'ddd',
  aliases: ['estado-ddd', 'cidades-ddd'],
  descricao: 'Consulta o estado e as principais cidades pertencentes a um DDD do Brasil.',
  categoria: 'utilitario',

  async executar(sock, jid, msg, text) {
    try {
      // 1) 🔢 Extrai e valida o DDD digitado
      const ddd = extrairDdd(text)
      if (!ddd) {
        return await sock.sendMessage(jid, {
          text: '🗺️ *Me diga qual DDD procurar...*\n\n' +
            'Informe o código logo após o comando (2 dígitos).\n\n' +
            '🗝️ Exemplos: `/ddd 11` • `/ddd 11999998888` (número completo também vale, e o `+55` do início é descartado).'
        }, { quoted: msg })
      }

      // 2) 🌐 Consulta a BrasilAPI (state + cities)
      const dados = await buscarJson(`${URL_BRASILAPI}/${ddd}`)

      // 3) ✉️ Resposta temática com estado, total e lista de cidades
      return await sock.sendMessage(jid, { text: montarMensagem(ddd, dados) }, { quoted: msg })
    } catch (err) {
      console.error('[ddd] erro na consulta:', err)
      const aviso = err?.tipo === 'inexistente'
        ? '🗺️ *Esse DDD não existe nos mapas do Brasil...*\n\n' +
          'Verifique o código (vai de 11 a 99) e tente de novo.\n\n' +
          '🗝️ Exemplos: `/ddd 11` • `/ddd 21` • `/ddd 31`'
        : '⛔ *As rotas do limbo interromperam a consulta...*\n\n' +
          'A BrasilAPI não respondeu agora. Tente novamente em instantes.'
      return await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {})
    }
  }
}