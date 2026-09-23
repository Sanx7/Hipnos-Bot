// ============================================
// Teste do /eununca (sorteio + anti-repetição)
// ============================================
// Roda 100% offline: sock falso, sem WhatsApp real.
// Uso: node scripts/teste-eununca.js
// ============================================

const eununca = require('../comandos/menu-brincadeiras/eununca')

const JID = '120363000000000000@g.us'
const MSG = { key: { remoteJid: JID, fromMe: false, id: 'MSG' }, message: { conversation: '/eununca' } }

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
  eununca._limparMemoria()

  await testar('exports (nome/aliases/executar)', async function () {
    if (eununca.nome !== 'eununca') throw new Error('nome errado')
    if (typeof eununca.executar !== 'function') throw new Error('sem executar')
    if (!eununca.aliases || eununca.aliases.indexOf('nuncaeu') === -1) throw new Error('falta alias nuncaeu')
  })

  await testar('banco tem pelo menos 150 frases', async function () {
    if (!Array.isArray(eununca.FRASES)) throw new Error('FRASES não é array')
    if (eununca.FRASES.length < 150) throw new Error('só ' + eununca.FRASES.length + ' frases, precisa de 150+')
    for (const f of eununca.FRASES) {
      if (typeof f !== 'string' || !/^Eu nunca/i.test(f.trim())) throw new Error('frase fora do padrão: ' + f)
    }
  })

  await testar('sorteio simples envia uma frase', async function () {
    const s = criarSock()
    await eununca.executar(s.sock, JID, MSG, '/eununca')
    const texto = textoUnico(s.enviadas)
    if (!/EU NUNCA/i.test(texto)) throw new Error('sem cabeçalho: ' + texto)
    const temFrase = eununca.FRASES.some(function (f) { return texto.includes(f) })
    if (!temFrase) throw new Error('a mensagem não contém frase do banco')
  })

  await testar('não repete a última consecutiva (50 sorteios)', async function () {
    const s = criarSock()
    let anterior = null
    for (let i = 0; i < 50; i++) {
      s.enviadas.length = 0
      await eununca.executar(s.sock, JID, MSG, '/eununca')
      const texto = textoUnico(s.enviadas)
      const frase = eununca.FRASES.find(function (f) { return texto.includes(f) })
      if (!frase) throw new Error('sorteio ' + i + ' não trouxe frase do banco')
      if (anterior !== null && frase === anterior) throw new Error('repetiu consecutiva: ' + frase)
      anterior = frase
    }
  })

  await testar('memória é por grupo (outro jid não herda)', async function () {
    eununca._limparMemoria()
    const s = criarSock()
    await eununca.executar(s.sock, JID, MSG, '/eununca')
    const primeira = textoUnico(s.enviadas)
    if (eununca._ultimaPorGrupo.get(JID) === undefined) throw new Error('não guardou a última do grupo')
    if (eununca._ultimaPorGrupo.get('outro@g.us') !== undefined) throw new Error('vazou memória entre grupos')
    if (!primeira) throw new Error('sem texto')
  })

  await testar('executor nunca lança com sock quebrado', async function () {
    const sockQuebrado = { sendMessage: async function () { throw new Error('rede fora') } }
    let escapou = false
    try {
      await eununca.executar(sockQuebrado, JID, MSG, '/eununca')
    } catch (err) {
      escapou = true
    }
    if (escapou) throw new Error('o erro escapou do executar')
  })

  eununca._limparMemoria()
  console.log(reprovadas === 0 ? 'Todos os testes passaram.' : reprovadas + ' teste(s) reprovados.')
  process.exit(reprovadas === 0 ? 0 : 1)
}

main().catch(function (err) {
  console.error('Falha inesperada:', err)
  process.exit(1)
})
