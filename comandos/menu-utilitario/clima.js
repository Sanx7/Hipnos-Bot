// ============================================
// 🌤️ CLIMA — Carta do Clima de Hipnos (uso LIVRE)
// ============================================
// Consulta a previsão do tempo da cidade informada e responde com:
// cidade, temperatura atual, sensação térmica, condição do tempo,
// umidade e vento — tudo em PT-BR.
//
// PROVEDORES (em ordem de prioridade):
//   1) HG Brasil Weather — usada APENAS se existir HGBRASIL_KEY no
//      .env (sem chave a API dela ignora o city_name e devolve o clima
//      do IP do servidor, o que não serve). Responde nativamente em PT-BR.
//   2) Open-Meteo — API gratuita e SEM chave (padrão, funciona de cara).
//      O geocoding vem traduzido (language=pt) e o weather_code (padrão
//      WMO) é traduzido aqui para PT-BR + emoji.
//
// Tratamento de erros (mesmo padrão dos demais comandos):
//   - Sem cidade → avisa e mostra um exemplo de uso.
//   - Cidade não encontrada → mensagem amigável + exemplo.
//   - API fora do ar / timeout / sem rede → mensagem amigável.
// Qualquer erro inesperado é capturado no try/catch final (e o isolamento
// do bot.js garante que nada derrube o listener).
// ============================================

// ⏳ Timeout de cada chamada HTTP (ms) — evita deixar o chat pendurado
const TIMEOUT_API_MS = 15000

// 🧪 Erro de domínio do /clima: carrega uma mensagem amigável + um "tipo"
// ('nao_encontrada' | 'api') para o roteador de provedores decidir qual
// aviso mostrar no fim (e se vale a pena tentar o próximo provedor).
class ErroClima extends Error {
  constructor(mensagem, tipo) {
    super(mensagem)
    this.name = 'ErroClima'
    this.tipo = tipo
  }
}

// ─── 🌐 Chamada GET com timeout, seguindo o padrão do /play ───
// Retorna o JSON parseado. Falha de rede/status/timeout → ErroClima('api').
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
      throw new ErroClima(`a API respondeu HTTP ${resposta.status}`, 'api')
    }
    return await resposta.json()
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof ErroClima) throw err
    if (err.name === 'AbortError') {
      throw new ErroClima('a consulta demorou demais (timeout)', 'api')
    }
    throw new ErroClima(err?.message || String(err), 'api')
  }
}

// ─── 🗺️ Tradução do código WMO do Open-Meteo → [descrição PT-BR, emoji] ───
const CODIGOS_WMO = {
  0: ['Céu limpo', '☀️'],
  1: ['Predominantemente limpo', '🌤️'],
  2: ['Parcialmente nublado', '⛅'],
  3: ['Nublado', '☁️'],
  45: ['Névoa', '🌫️'],
  48: ['Névoa congelante', '🌫️'],
  51: ['Garoa fraca', '🌦️'],
  53: ['Garoa moderada', '🌦️'],
  55: ['Garoa intensa', '🌧️'],
  56: ['Garoa congelante fraca', '🌧️'],
  57: ['Garoa congelante intensa', '🌧️'],
  61: ['Chuva fraca', '🌦️'],
  63: ['Chuva moderada', '🌧️'],
  65: ['Chuva forte', '⛈️'],
  66: ['Chuva congelante fraca', '🌧️'],
  67: ['Chuva congelante forte', '🌧️'],
  71: ['Neve fraca', '🌨️'],
  73: ['Neve moderada', '❄️'],
  75: ['Neve forte', '❄️'],
  77: ['Grãos de neve', '❄️'],
  80: ['Pancadas de chuva fracas', '🌦️'],
  81: ['Pancadas de chuva moderadas', '🌧️'],
  82: ['Pancadas de chuva violentas', '⛈️'],
  85: ['Pancadas de neve fracas', '🌨️'],
  86: ['Pancadas de neve fortes', '❄️'],
  95: ['Tempestade', '⛈️'],
  96: ['Tempestade com granizo', '⛈️'],
  99: ['Tempestade severa com granizo', '⛈️']
}

// ─── 🏷️ Emoji pela "condition_slug" da HG Brasil ───
const EMOJIS_HG = {
  storm: '⛈️',
  snow: '❄️',
  hail: '🌧️',
  rain: '🌧️',
  fog: '🌫️',
  cloud: '☁️',
  cloudly_day: '⛅',
  cloudly_night: '☁️',
  clear_day: '☀️',
  clear_night: '🌙',
  none: '🌤️'
}

// ─── 2️⃣ Open-Meteo — provedor padrão (grátis, sem chave) ───
// 1) geocoding: converte o nome da cidade em coordenadas (resposta em pt);
// 2) forecast: temperatura, sensação térmica, umidade, vento e weather_code.
// Cidade não encontrada → ErroClima(tipo 'nao_encontrada').
async function climaOpenMeteo(cidade) {
  const urlBusca =
    'https://geocoding-api.open-meteo.com/v1/search?name=' +
    encodeURIComponent(cidade) +
    '&count=1&language=pt&format=json'

  const busca = await buscarJson(urlBusca)
  const lugar = busca?.results?.[0]
  if (!lugar) {
    throw new ErroClima(`cidade "${cidade}" não encontrada no geocoding`, 'nao_encontrada')
  }

  const urlClima =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lugar.latitude}&longitude=${lugar.longitude}` +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m' +
    '&timezone=auto'

  const dados = await buscarJson(urlClima)
  const atual = dados?.current
  if (!atual || atual.temperature_2m == null) {
    throw new ErroClima(`Open-Meteo não devolveu dados atuais para "${cidade}"`, 'nao_encontrada')
  }

  // Monta o nome legível: "Campinas, São Paulo (Brasil)" — sem partes faltando
  const nomeLugar = [
    lugar.name,
    lugar.admin1,
    lugar.country ? `(${lugar.country})` : ''
  ].filter(Boolean).join(', ')

  const [condicao, emoji] = CODIGOS_WMO[atual.weather_code] || ['Condição desconhecida', '🌫️']

  return {
    cidade: nomeLugar,
    temperatura: Math.round(atual.temperature_2m),
    sensacao: atual.apparent_temperature != null ? Math.round(atual.apparent_temperature) : null,
    condicao,
    emoji,
    umidade: atual.relative_humidity_2m != null ? Math.round(atual.relative_humidity_2m) : null,
    vento: atual.wind_speed_10m != null ? `${Math.round(atual.wind_speed_10m)} km/h` : null
  }
}

// ─── 1️⃣ HG Brasil Weather — provedor primário SE houver HGBRASIL_KEY ───
// Responde em PT-BR nativo; no plano free ela NÃO traz sensação térmica
// (o campo fica "Indisponível"). Falha de chave/cidade → cai p/ Open-Meteo.
async function climaHgBrasil(cidade, chave) {
  const url =
    'https://api.hgbrasil.com/weather' +
    `?key=${encodeURIComponent(chave)}&city_name=${encodeURIComponent(cidade)}`

  const dados = await buscarJson(url)

  // Chave inválida/expirada: a HG devolve valid_key=false MAS ainda traz o
  // clima do IP do servidor (cidade errada!) — tratamos como falha para
  // cair no Open-Meteo, que responde a cidade certa.
  if (dados?.valid_key === false) {
    throw new ErroClima('HGBRASIL_KEY inválida ou expirada (valid_key=false)', 'api')
  }

  // Sem dados de temperatura, a resposta é inútil (chave inválida,
  // cidade desconhecida ou limite diário atingido) → próximo provedor.
  const resultados = dados?.results
  if (!resultados || resultados.temp == null) {
    throw new ErroClima(`HG Brasil não devolveu clima para "${cidade}"`, 'nao_encontrada')
  }

  return {
    cidade: resultados.city || cidade,
    temperatura: Math.round(resultados.temp),
    sensacao: null, // a HG Brasil (plano free) não informa sensação térmica
    condicao: resultados.description || 'Condição desconhecida',
    emoji: EMOJIS_HG[resultados.condition_slug] || '🌤️',
    umidade: resultados.humidity != null ? Math.round(resultados.humidity) : null,
    vento: resultados.wind_speedy || null
  }
}

// ─── ✉️ Monta a carta do clima (mesmo estilo de resposta dos comandos) ───
const FRASES_FINAIS = [
  '"O tempo passa, mas as sombras permanecem."',
  '"Até o clima obedece ao sono de Hipnos."',
  '"Chova ou faça sol, o limbo continua."',
  '"O vento sussurra o que os sonhos silenciam."'
]

function sortearFrase(lista) {
  return lista[Math.floor(Math.random() * lista.length)]
}

function montarMensagem(clima) {
  return (
    `🌤️ *CARTA DO CLIMA* ${clima.emoji}\n\n` +
    `🌫️ Hipnos sonha sobre *${clima.cidade}*\n\n` +
    `🌡️ Temperatura: *${clima.temperatura}°C*\n` +
    `🥵 Sensação térmica: *${clima.sensacao != null ? clima.sensacao + '°C' : 'Indisponível'}*\n` +
    `☁️ Condição: *${clima.condicao}*\n` +
    `💧 Umidade: *${clima.umidade != null ? clima.umidade + '%' : 'Indisponível'}*\n` +
    `🍃 Vento: *${clima.vento || 'Indisponível'}*\n\n` +
    `💤 ${sortearFrase(FRASES_FINAIS)}`
  )
}

// ─── 📨 Execução do comando ───
module.exports = {
  nome: 'clima',
  descricao: 'Mostra a previsão do tempo da cidade: temperatura, sensação térmica, condição e umidade.',

  async executar(sock, jid, msg, texto) {
    try {
      // Extrai a cidade digitada depois de "/clima" (mesma regex do /8ball)
      const cidade = String(texto || '').replace(/^\/\S+\s*/, '').trim()

      // Sem cidade: pede para o usuário informar (mensagem amigável)
      if (!cidade) {
        return await sock.sendMessage(jid, {
          text:
            '🌫️ *Você esqueceu de me dizer a cidade...*\n\n' +
            'Informe o nome depois do comando.\n\n' +
            '🗝️ Exemplo: `/clima Campinas`'
        }, { quoted: msg })
      }

      // Provedores em ordem de prioridade:
      // - HG Brasil entra na frente SOMENTE se houver chave no .env;
      // - Open-Meteo sempre cobre (é o padrão sem chave e o fallback).
      const provedores = []
      const chaveHg = (process.env.HGBRASIL_KEY || '').trim()
      if (chaveHg) provedores.push(() => climaHgBrasil(cidade, chaveHg))
      provedores.push(() => climaOpenMeteo(cidade))

      // Tenta cada provedor; o primeiro que responder bem vence.
      // Guarda o último erro para escolher o aviso final correto.
      let clima = null
      let ultimoErro = null
      for (const provedor of provedores) {
        try {
          clima = await provedor()
          break
        } catch (err) {
          ultimoErro = err
          console.error('[clima] provedor falhou:', err?.message || err)
        }
      }

      // Todos falharam: mensagem amigável conforme o motivo
      if (!clima) {
        const tipo = ultimoErro?.tipo || 'api'
        const aviso =
          tipo === 'nao_encontrada'
            ? '🌫️ *Não encontrei essa cidade nos meus sonhos...*\n\n' +
              'Verifique se o nome está escrito corretamente e tente de novo.\n\n' +
              '🗝️ Exemplo: `/clima Campinas`'
            : '⛔ *As correntes de ar do limbo interromperam a consulta ao clima...*\n\n' +
              'Tente novamente em instantes.'
        return await sock.sendMessage(jid, { text: aviso }, { quoted: msg })
      }

      await sock.sendMessage(jid, { text: montarMensagem(clima) }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando clima:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram a leitura do tempo... Tente novamente.'
      }, { quoted: msg })
    }
  }
}

