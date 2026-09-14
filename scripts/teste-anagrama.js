// ============================================================
// 🧪 Teste offline do /anagrama (menu-brincadeiras/anagrama.js)
// Sem WhatsApp real e SEM rede: o sorteio é injetado via
// _injetarSorteio (mesmo padrão do pinterest/letra) e o estado
// dos jogos é manipulado direto pelo Map exportado.
//
// Uso (na raiz do projeto):  node scripts/teste-anagrama.js
// ============================================================
const anagrama = require('../comandos/menu-brincadeiras/anagrama')
const palavras = require('../dados/palavras-anagrama')

const jidFalso = 'teste-anagrama@g.us'
const autorFalso = '5511999999999@s.whatsapp.net'
const msgFalsa = { key: { id: 'TESTE-ANAGRAMA', participant: autorFalso } }

function criarSockFalso (registro) {
  return {
    async sendMessage (jid, conteudo) {
      registro.push(conteudo)
      return { ok: true }
    }
  }
}

const textos = (registro) => registro.filter(m => typeof m.text === 'string').map(m => m.text)

// Jogo controlado (sem depender do bônus aleatório) para testar os chutes
function jogoControlado (extra = {}) {
  return Object.assign({
    palavra: 'SAPATO',
    categoria: 'objetos',
    reveladas: new Set(['S']),
    chutesErrados: new Set(),
    autor: autorFalso
  }, extra)
}

let reprovadas = 0
const testar = (nome, ok, detalhe) => {
  console.log((ok ? '✅' : '❌') + ' ' + nome + (ok ? '' : ` — ${detalhe || ''}`))
  if (!ok) reprovadas++
}

;(async () => {
  console.log('🧪 Teste offline do /anagrama\n')

  // 0) exports do comando e do banco de palavras
  testar('exports do comando',
    anagrama.nome === 'anagrama' &&
    typeof anagrama.executar === 'function' &&
    anagrama.jogos instanceof Map &&
    typeof anagrama.criarJogo === 'function' &&
    typeof anagrama.montarTabuleiro === 'function' &&
    anagrama.MAX_ERROS === 6 &&
    typeof anagrama._injetarSorteio === 'function')

  const lista = palavras.PALAVRAS
  testar('banco com ~500-600 palavras', Array.isArray(lista) && lista.length >= 500 && lista.length <= 600, `len=${lista.length}`)
  testar('palavras únicas', new Set(lista.map(p => p.palavra)).size === lista.length)
  testar('palavras só com A-Z', lista.every(p => /^[A-Z]+$/.test(p.palavra)))
  testar('todas com categoria', lista.every(p => typeof p.categoria === 'string' && p.categoria.length > 0))
  testar('sortearPalavra(categoria) filtra certo', palavras.sortearPalavra('animais')?.categoria === 'animais')
  testar('sortearPalavra(categoria inválida) → null', palavras.sortearPalavra('inexistente') === null)

  // 1) Inicia jogo: tabuleiro com "_" e pelo menos 1 letra de bônus revelada
  anagrama._injetarSorteio(() => ({ palavra: 'SAPATO', categoria: 'objetos' }))
  anagrama.jogos.clear()
  let registro = []
  await anagrama.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/anagrama')
  const t1 = textos(registro).join('\n')
  testar('inicia jogo com título e categoria', t1.includes('ANAGRAMA') && t1.includes('objetos'))
  const jogoCriado = anagrama.jogos.get(jidFalso)
  testar('revela 1 letra de bônus', jogoCriado && jogoCriado.reveladas.size === 1)
  const tabuleiro = anagrama.montarTabuleiro('SAPATO', jogoCriado.reveladas)
  testar('tabuleiro tem "_" e a letra de bônus', tabuleiro.includes('_') && tabuleiro !== '_ _ _ _ _ _' && tabuleiro.includes([...jogoCriado.reveladas][0]))

  // 2) Só um jogo por grupo (segundo /anagrama mostra o jogo ativo)
  registro = []
  await anagrama.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/anagrama')
  testar('segundo /anagrama mostra o jogo ativo', textos(registro).some(t => t.toLowerCase().includes('já tem um anagrama rolando')))
  anagrama.jogos.clear()
  // 3) Letra certa revela TODAS as ocorrências (A em SAPATO)
  anagrama.jogos.set(jidFalso, jogoControlado())
  registro = []
  await anagrama.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/anagrama A')
  testar('letra certa revela todas as ocorrências', textos(registro).some(t => t.includes('S A _ A _ _') && t.includes('está na palavra')))
  anagrama.jogos.clear()

  // 4) Letra errada conta erro
  anagrama.jogos.set(jidFalso, jogoControlado())
  registro = []
  await anagrama.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/anagrama Z')
  testar('letra errada conta erro (1/6)', textos(registro).some(t => t.includes('não está na palavra') && t.includes('(1/6)')))
  anagrama.jogos.clear()

  // 5) 6 erros encerram mostrando a resposta
  anagrama.jogos.set(jidFalso, jogoControlado({ chutesErrados: new Set(['B', 'C', 'D', 'E', 'F']) }))
  registro = []
  await anagrama.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/anagrama Z')
  const t5 = textos(registro).join('\n')
  testar('6 erros encerram mostrando a resposta', t5.includes('Seis erros') && t5.includes('SAPATO'))
  testar('jogo removido após 6 erros', !anagrama.jogos.has(jidFalso))

  // 6) Palpite certo encerra e anuncia vencedor (com mention)
  anagrama.jogos.set(jidFalso, jogoControlado())
  registro = []
  await anagrama.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/anagrama palpite sapato')
  const vencedor = registro.find(m => typeof m.text === 'string' && m.text.includes('ACERTOU A PALAVRA COMPLETA'))
  testar('palpite certo anuncia vencedor (aceita minúscula)', !!vencedor && vencedor.text.includes('SAPATO'))
  testar('vencedor é mencionado', !!vencedor && Array.isArray(vencedor.mentions) && vencedor.mentions[0] === autorFalso)
  testar('jogo removido após acerto', !anagrama.jogos.has(jidFalso))

  // 7) Palpite errado conta erro
  anagrama.jogos.set(jidFalso, jogoControlado())
  registro = []
  await anagrama.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/anagrama palpite CAMISA')
  testar('palpite errado conta erro', textos(registro).some(t => t.includes('não é a palavra') && t.includes('(1/6)')))
  anagrama.jogos.clear()

  // 8) Desistir revela a resposta
  anagrama.jogos.set(jidFalso, jogoControlado())
  registro = []
  await anagrama.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/anagrama desistir')
  testar('desistir revela a resposta', textos(registro).some(t => t.includes('Jogo encerrado') && t.includes('SAPATO')))
  testar('jogo removido após desistir', !anagrama.jogos.has(jidFalso))

  // 9) Letra/palpite/desistir sem jogo ativo → aviso
  anagrama.jogos.clear()
  registro = []
  await anagrama.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/anagrama A')
  const registro2 = []
  await anagrama.executar(criarSockFalso(registro2), jidFalso, msgFalsa, '/anagrama palpite SAPATO')
  const registro3 = []
  await anagrama.executar(criarSockFalso(registro3), jidFalso, msgFalsa, '/anagrama desistir')
  testar('letra sem jogo ativo → aviso', textos(registro).some(t => t.includes('Não tem anagrama ativo')))
  testar('palpite sem jogo ativo → aviso', textos(registro2).some(t => t.includes('Não tem anagrama ativo')))
  testar('desistir sem jogo ativo → aviso', textos(registro3).some(t => t.includes('Não tem anagrama ativo')))
  // 10) Categoria válida inicia com a categoria certa (sorteio real)
  anagrama._injetarSorteio()
  anagrama.jogos.clear()
  registro = []
  await anagrama.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/anagrama animais')
  testar('categoria válida inicia jogo da categoria', anagrama.jogos.get(jidFalso)?.categoria === 'animais')
  anagrama.jogos.clear()

  // 10b) Categoria sem pool (sorteio devolve null) → lista de categorias
  anagrama._injetarSorteio(() => null)
  registro = []
  await anagrama.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/anagrama')
  testar('sem pool → lista de categorias válidas', textos(registro).some(t => t.includes('Não conheço essa categoria') && t.includes('animais')))
  anagrama._injetarSorteio()

  // 10c) Texto desconhecido → ajuda
  anagrama.jogos.clear()
  registro = []
  await anagrama.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/anagrama blablabla123')
  testar('texto desconhecido → ajuda', textos(registro).some(t => t.includes('Não entendi') && t.includes('/anagrama palpite')))

  console.log('')
  if (reprovadas === 0) console.log('🎉 Todos os testes do /anagrama passaram.')
  else { console.log(`💥 ${reprovadas} teste(s) reprovado(s).`); process.exitCode = 1 }
})().catch(err => {
  console.error('Erro no harness de teste:', err)
  process.exitCode = 1
})
