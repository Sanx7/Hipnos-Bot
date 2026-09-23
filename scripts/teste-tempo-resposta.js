// ============================================
// Teste do /tempo-resposta (execução básica + formatação)
// ============================================
// Roda 100% offline: o ping do Mongo é injetado via _injetarPingMongo,
// então nenhum teste toca em rede ou banco de verdade.
// Uso: node scripts/teste-tempo-resposta.js
// ============================================

const tempoResposta = require('../comandos/menu-utilitario/tempo-resposta')

const JID = '120363000000000000@g.us'
const MSG = { key: { remoteJid: JID, fromMe: false, id: 'MSG' }, message: { conversation: '/tempo-resposta' } }

function criarSock() {
  const enviadas = []
  return {
    enviadas: enviadas,
    sock: {
      sendMessage: async function (jid, conteudo, opcoes) {
        enviadas.push({ jid: jid, conteudo: conteudo, opcoes: opcoes })
        return { key: { id: 'fake-' + enviadas.length } }
      }
    }
  }
}

function textoUnico(enviadas) {
  const textos = enviadas.map(function (e) { return e.conteudo && e.conteudo.text }).filter(function (t) { return typeof t === 'string' })
  if (textos.length !== 1) throw new Error('esperava 1 mensagem, veio ' + textos.length)
  return textos[0]
}

let reprovadas = 0
async function testar(nome, fn) {
  try {
    await fn()
    console.log('OK ' + nome)
  } catch (err) {
    reprovadas += 1
    console.error('FALHOU ' + nome + ' -> ' + (err && err.message ? err.message : err))
  }
}

async function main() {
  await testar('exports (nome/aliases/executar)', async function () {
    if (tempoResposta.nome !== 'tempo-resposta') throw new Error('nome errado')
    if (typeof tempoResposta.executar !== 'function') throw new Error('sem executar')
    if (!tempoResposta.aliases || tempoResposta.aliases.indexOf('latencia') === -1) throw new Error('falta alias latencia')
  })

  await testar('formatarUptime segue o padrão do /info', async function () {
    if (tempoResposta.formatarUptime(5) !== '5s') throw new Error('5s errado: ' + tempoResposta.formatarUptime(5))
    if (tempoResposta.formatarUptime(65) !== '1m 5s') throw new Error('65 errado: ' + tempoResposta.formatarUptime(65))
    if (tempoResposta.formatarUptime(3665) !== '1h 1m 5s') throw new Error('3665 errado')
    if (tempoResposta.formatarUptime(90065) !== '1d 1h 1m 5s') throw new Error('90065 errado')
  })

  await testar('montarTexto traz resposta, uptime e mongo', async function () {
    const texto = tempoResposta.montarTexto(42, '1h 2m 3s', 15)
    if (!/TEMPO DE RESPOSTA/.test(texto)) throw new Error('sem título')
    if (!/42 ms/.test(texto)) throw new Error('sem tempo em ms')
    if (!/1h 2m 3s/.test(texto)) throw new Error('sem uptime')
    if (!/Mongo: 15 ms/.test(texto)) throw new Error('sem ping do mongo')
  })

  await testar('montarTexto com mongo indisponível não quebra', async function () {
    const texto = tempoResposta.montarTexto(42, '5s', null)
    if (!/indisponível/.test(texto)) throw new Error('sem aviso de indisponível: ' + texto)
  })

  await testar('execução básica responde com o tempo em ms', async function () {
    tempoResposta._injetarPingMongo(async function () { return 12 })
    const s = criarSock()
    await tempoResposta.executar(s.sock, JID, MSG, '/tempo-resposta')
    const texto = textoUnico(s.enviadas)
    if (!/TEMPO DE RESPOSTA/.test(texto)) throw new Error('sem título na resposta')
    if (!/\d+ ms/.test(texto)) throw new Error('sem tempo em ms: ' + texto)
    if (!/Tempo online/.test(texto)) throw new Error('sem uptime: ' + texto)
    if (!/Mongo: 12 ms/.test(texto)) throw new Error('sem ping do mongo: ' + texto)
    tempoResposta._restaurarPingMongo()
  })

  await testar('mongo fora do ar vira indisponível sem quebrar', async function () {
    tempoResposta._injetarPingMongo(async function () { throw new Error('banco fora') })
    const s = criarSock()
    await tempoResposta.executar(s.sock, JID, MSG, '/tempo-resposta')
    const texto = textoUnico(s.enviadas)
    if (!/indisponível/.test(texto)) throw new Error('sem aviso de indisponível: ' + texto)
    tempoResposta._restaurarPingMongo()
  })

  await testar('executor nunca lança mesmo com sock quebrado', async function () {
    tempoResposta._injetarPingMongo(async function () { return 5 })
    const sockQuebrado = {
      sendMessage: async function () { throw new Error('rede fora') }
    }
    let escapou = false
    try {
      await tempoResposta.executar(sockQuebrado, JID, MSG, '/tempo-resposta')
    } catch (err) {
      escapou = true
    }
    tempoResposta._restaurarPingMongo()
    if (escapou) throw new Error('o erro escapou do executar')
  })

  console.log(reprovadas === 0 ? 'Todos os testes passaram.' : reprovadas + ' teste(s) reprovados.')
  process.exit(reprovadas === 0 ? 0 : 1)
}

main().catch(function (err) {
  console.error('Falha inesperada:', err)
  process.exit(1)
})
