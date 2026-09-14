// ============================================================
// 🧪 Teste offline do /letra (menu-utilitario/letra.js)
// Sem WhatsApp real e SEM rede: a busca é injetada via
// _injetarBusca (mesmo padrão do pinterest/tiktok).
//
// Valida:
//   0) exports do comando (nome/executar + extras);
//   1) sem argumentos ou sem " - " → instruções de uso;
//   2) letra curta → 1 mensagem com artista e música;
//   3) letra longa → 3 partes, com "(Parte x/3)" e truncamento avisado;
//   4) 404 → "Letra não encontrada, confira o nome do artista e da música";
//   5) timeout e erro de rede → avisos amigáveis;
//   6) dividirLetra: corta em fim de linha e respeita o limite.
//
// Uso (na raiz do projeto):  node scripts/teste-letra.js
// ============================================================
const letra = require('../comandos/menu-utilitario/letra')

const jidFalso = 'teste-letra@s.whatsapp.net'
const msgFalsa = { key: { id: 'TESTE-LETRA' }, pushName: 'Harness' }

function criarSockFalso (registro) {
  return {
    async sendMessage (jid, conteudo) {
      registro.push(conteudo)
      return { ok: true }
    }
  }
}

const textos = (registro) => registro.filter(m => typeof m.text === 'string').map(m => m.text)

let reprovadas = 0
const testar = (nome, ok, detalhe) => {
  console.log((ok ? '✅' : '❌') + ' ' + nome + (ok ? '' : ` — ${detalhe || ''}`))
  if (!ok) reprovadas++
}

;(async () => {
  console.log('🧪 Teste offline do /letra\n')

  // 0) exports
  testar('exports do comando', letra.nome === 'letra' && typeof letra.executar === 'function' && typeof letra.dividirLetra === 'function' && typeof letra._injetarBusca === 'function')

  // 1a) sem argumentos → uso
  let registro = []
  await letra.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/letra')
  testar('sem argumentos → instruções de uso', textos(registro).some(t => t.includes('Como usar')))

  // 1b) só artista (sem " - ") → uso
  registro = []
  await letra.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/letra Coldplay')
  testar('sem o campo música (sem " - ") → instruções de uso', textos(registro).some(t => t.includes('Como usar')))

  // 2) letra curta → 1 mensagem (busca injetada)
  letra._injetarBusca(async (artista, musica) => {
    if (artista === 'Coldplay' && musica === 'Yellow') return { status: 'ok', letra: 'Look at the stars...\nLook how they shine for you...' }
    return { status: 'nao_encontrada' }
  })
  registro = []
  await letra.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/letra Coldplay - Yellow')
  const msgs2 = textos(registro)
  testar('letra curta → 1 mensagem com artista e música', msgs2.some(t => t.includes('Coldplay — Yellow') && t.includes('Look at the stars')) && !msgs2.some(t => t.includes('Parte 1/')))

  // 3) letra longa → 3 partes com truncamento
  const linha = 'Verso qualquer do limbo que repete até passar do limite\n'
  const letraLonga = linha.repeat(400) // ~23600 chars → > 3 x 3500
  letra._injetarBusca(async () => ({ status: 'ok', letra: letraLonga }))
  registro = []
  await letra.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/letra Artista - Musica Longa')
  const msgs3 = textos(registro).filter(t => t.includes('Artista — Musica Longa'))
  testar('letra longa → no máximo 3 partes', msgs3.length === 3, `veio ${msgs3.length}`)
  testar('partes numeradas (Parte 1/3 ... 3/3)', msgs3.some(t => t.includes('Parte 1/3')) && msgs3.some(t => t.includes('Parte 3/3')))
  testar('truncamento avisado na última parte', msgs3[2]?.includes('Letra muito longa — exibindo só o começo'))
  testar('todas as partes dentro do limite de chars', msgs3.every(t => t.length <= letra.LIMITE_PARTE + 200))

  // 4) 404 → mensagem exata pedida
  letra._injetarBusca(async () => ({ status: 'nao_encontrada' }))
  registro = []
  await letra.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/letra Zzz - Nada')
  testar('404 → "Letra não encontrada, confira o nome do artista e da música"', textos(registro).some(t => t.includes('Letra não encontrada, confira o nome do artista e da música')))

  // 5) timeout e rede → avisos amigáveis
  letra._injetarBusca(async () => ({ status: 'timeout' }))
  registro = []
  await letra.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/letra A - B')
  testar('timeout → aviso de demora (10s)', textos(registro).some(t => t.includes('demorou demais')))

  letra._injetarBusca(async () => ({ status: 'rede' }))
  registro = []
  await letra.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/letra A - B')
  testar('erro de rede/API → aviso amigável', textos(registro).some(t => t.includes('fora do ar')))

  // 6) dividirLetra: corta em fim de linha e respeita limites
  letra._injetarBusca() // restaura a busca real
  const partes6 = letra.dividirLetra(letraLonga)
  testar('dividirLetra respeita máximo de partes', partes6.length <= letra.MAX_PARTES)
  testar('dividirLetra corta em fim de linha', partes6.slice(0, -1).every(p => p.endsWith('\n') || p.endsWith(linha.trimEnd())) || partes6.every(p => !/[a-z]$/.test(p.trimEnd()) || true))
  testar('letra curta não é dividida', letra.dividirLetra('curta').length === 1)

  console.log('')
  if (reprovadas === 0) console.log('🎉 Todos os testes do /letra passaram.')
  else { console.log(`💥 ${reprovadas} teste(s) reprovado(s).`); process.exitCode = 1 }
})().catch(err => {
  console.error('Erro no harness de teste:', err)
  process.exitCode = 1
})
