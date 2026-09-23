// ============================================
// TEMPO-RESPOSTA — Mede o tempo de resposta do bot (/tempo-resposta)
// ============================================
// Uso LIVRE: /tempo-resposta (também: /latencia).
//
// Como mede: marca Date.now() na entrada do executar e monta a resposta
// só no final — o valor em ms reflete processamento + ping do Mongo.
// O Baileys do projeto não edita mensagem de forma confiável, então a
// estratégia é enviar direto o tempo calculado antes do envio.
//
// Info extra: uptime do processo (mesmo formato do /info) e latência do
// Mongo (ping simples com timeout curto). Se o banco não responder, a
// linha mostra "indisponível" em vez de quebrar o comando.
// ============================================

const { RODAPE_MENU } = require('../../config')

// Timeout do ping no Mongo (ms) — curto p/ não prender o comando.
const TIMEOUT_MONGO_MS = 3000

// Ping no Mongo injetável (testes passam um falso sem rede).
let pingMongoInjetado = null

// Formata o uptime igual ao /info (ex.: "2d 3h 4m 5s").
function formatarUptime(segundos) {
  const total = Math.floor(Number(segundos) || 0)
  const dias = Math.floor(total / 86400)
  const horas = Math.floor((total % 86400) / 3600)
  const minutos = Math.floor((total % 3600) / 60)
  const resto = total % 60
  const partes = []
  if (dias > 0) partes.push(dias + 'd')
  if (horas > 0) partes.push(horas + 'h')
  if (minutos > 0) partes.push(minutos + 'm')
  partes.push(resto + 's')
  return partes.join(' ')
}

// Mede a latência do Mongo com um ping simples. Retorna ms ou null.
// Nunca lança: sem MONGODB_URI, timeout ou erro → null (indisponível).
async function medirPingMongo() {
  if (typeof pingMongoInjetado === 'function') {
    try {
      const valor = await pingMongoInjetado()
      return Number.isFinite(valor) ? valor : null
    } catch (err) {
      return null
    }
  }
  if (!process.env.MONGODB_URI) return null
  let MongoClient = null
  try {
    MongoClient = require('mongodb').MongoClient
  } catch (err) {
    return null
  }
  const inicio = Date.now()
  let cliente = null
  try {
    cliente = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: TIMEOUT_MONGO_MS
    })
    await cliente.connect()
    await cliente.db('admin').command({ ping: 1 })
    return Date.now() - inicio
  } catch (err) {
    return null
  } finally {
    try {
      if (cliente) await cliente.close()
    } catch (err) {
      // Fechamento best-effort — nunca quebra o comando.
    }
  }
}

function montarTexto(tempoMs, uptimeTexto, pingMongoMs) {
  const linhas = []
  linhas.push('TEMPO DE RESPOSTA')
  linhas.push('')
  linhas.push('Resposta do bot: ' + tempoMs + ' ms')
  linhas.push('Tempo online: ' + uptimeTexto)
  if (pingMongoMs === null || pingMongoMs === undefined) {
    linhas.push('Mongo: indisponível no momento')
  } else {
    linhas.push('Mongo: ' + pingMongoMs + ' ms')
  }
  linhas.push('')
  linhas.push(RODAPE_MENU)
  return linhas.join('\n')
}

module.exports = {
  nome: 'tempo-resposta',
  aliases: ['latencia'],
  descricao: 'Mede o tempo de resposta do bot (também: /latencia).',
  categoria: 'utilitario',

  async executar(sock, jid, msg) {
    const inicio = Date.now()
    try {
      const pingMongoMs = await medirPingMongo()
      const uptimeTexto = formatarUptime(process.uptime())
      const tempoMs = Date.now() - inicio
      await sock.sendMessage(jid, {
        text: montarTexto(tempoMs, uptimeTexto, pingMongoMs)
      }, { quoted: msg })
    } catch (err) {
      console.error('[tempo-resposta] erro ao medir:', err)
      await sock.sendMessage(jid, {
        text: 'Não consegui medir o tempo de resposta agora. Tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  TIMEOUT_MONGO_MS,
  formatarUptime,
  medirPingMongo,
  montarTexto,
  _injetarPingMongo: (fn) => { pingMongoInjetado = fn },
  _restaurarPingMongo: () => { pingMongoInjetado = null }
}
