// ============================================
// Teste do /rimas (sorteio + anti-repetição)
// ============================================
// Roda 100% offline: sock falso, sem WhatsApp real.
// Uso: node scripts/teste-rimas.js
// ============================================

const rimas = require('../comandos/menu-brincadeiras/rimas')

const JID = '120363000000000000@g.us'
const MSG = { key: { remoteJid: JID, fromMe: false, id: 'MSG' }, message: { conversation: '/rimas' } }

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

// Extrai a palavra sorteada pelo marcador "Rime com: *PALAVRA*" — busca
// exata em vez de includes(), pois o cabeçalho também contém palavras do
// banco (ex.: "DESAFIO" está na lista e aparece em "DESAFIO DA RIMA").
function extrairPalavra(texto) {
  const m = String(texto || '').match(/Rime com:\s*\*([A-Z]+)\*/)
  const palavra = m && m[1]
  if (palavra && rimas.PALAVRAS.indexOf(palavra) !== -1) return palavra
  return null
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
  rimas._limparMemoria()

  await testar('exports (nome/aliases/executar)', async function () {
    if (rimas.nome !== 'rimas') throw new Error('nome errado')
    if (typeof rimas.executar !== 'function') throw new Error('sem executar')
    if (!rimas.aliases || rimas.aliases.indexOf('rima') === -1) throw new Error('falta alias rima')
  })

  await testar('banco tem pelo menos 150 palavras', async function () {
    if (!Array.isArray(rimas.PALAVRAS)) throw new Error('PALAVRAS não é array')
    if (rimas.PALAVRAS.length < 150) throw new Error('só ' + rimas.PALAVRAS.length + ' palavras, precisa de 150+')
    const vistas = new Set()
    for (const p of rimas.PALAVRAS) {
      if (typeof p !== 'string' || !/^[A-Z]+$/.test(p.trim())) throw new Error('palavra fora do padrão: ' + p)
      if (vistas.has(p)) throw new Error('palavra duplicada: ' + p)
      vistas.add(p)
    }
  })

  await testar('sorteio simples envia um desafio', async function () {
    const s = criarSock()
    await rimas.executar(s.sock, JID, MSG, '/rimas')
    const texto = textoUnico(s.enviadas)
    if (!/DESAFIO DA RIMA/i.test(texto)) throw new Error('sem cabeçalho: ' + texto)
    if (!/Rime com:/i.test(texto)) throw new Error('sem desafio: ' + texto)
    const palavra = extrairPalavra(texto)
    if (!palavra) throw new Error('a mensagem não contém palavra do banco')
  })

  await testar('não repete a última consecutiva (50 sorteios)', async function () {
    const s = criarSock()
    let anterior = null
    for (let i = 0; i < 50; i++) {
      s.enviadas.length = 0
      await rimas.executar(s.sock, JID, MSG, '/rimas')
      const texto = textoUnico(s.enviadas)
      const palavra = extrairPalavra(texto)
      if (!palavra) throw new Error('sorteio ' + i + ' não trouxe palavra do banco')
      if (anterior !== null && palavra === anterior) throw new Error('repetiu consecutiva: ' + palavra)
      anterior = palavra
    }
  })

  await testar('memória é por grupo (outro jid não herda)', async function () {
    rimas._limparMemoria()
    const s = criarSock()
    await rimas.executar(s.sock, JID, MSG, '/rimas')
    const primeira = textoUnico(s.enviadas)
    if (rimas._ultimaPorGrupo.get(JID) === undefined) throw new Error('não guardou a última do grupo')
    if (rimas._ultimaPorGrupo.get('outro@g.us') !== undefined) throw new Error('vazou memória entre grupos')
    if (!primeira) throw new Error('sem texto')
  })

  await testar('executor nunca lança com sock quebrado', async function () {
    const sockQuebrado = { sendMessage: async function () { throw new Error('rede fora') } }
    let escapou = false
    try {
      await rimas.executar(sockQuebrado, JID, MSG, '/rimas')
    } catch (err) {
      escapou = true
    }
    if (escapou) throw new Error('o erro escapou do executar')
  })

  rimas._limparMemoria()
  console.log(reprovadas === 0 ? 'Todos os testes passaram.' : reprovadas + ' teste(s) reprovados.')
  process.exit(reprovadas === 0 ? 0 : 1)
}

main().catch(function (err) {
  console.error('Falha inesperada:', err)
  process.exit(1)
})
