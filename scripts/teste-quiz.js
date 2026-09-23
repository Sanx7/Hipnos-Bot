// ============================================
// 🧪 TESTE DO COMANDO /quiz (offline)
// ============================================
//
// Roda SEM rede, SEM Mongo e SEM Baileys: o sock é um fake e os timers das
// perguntas são encurtados pelo ponto de injeção _definirDuracaoPergunta.
//
//   node scripts/teste-quiz.js
//
// Cobre: contrato do comando, banco de perguntas, início de rodada, resposta
// correta, resposta errada, timeout sem acerto, filtro por categoria,
// encerramento manual, bloqueio de jogo duplicado no grupo e o gancho de texto
// livre que o bot.js usa.

const quiz = require('../comandos/menu-brincadeiras/quiz')
const jogos = require('../dados/jogos-ativos')

// ============================================
// 🧰 HARNESS
// ============================================

let total = 0
let falhas = 0

async function testar (nome, fn) {
  total++
  try {
    await fn()
    console.log(`✅ ${nome}`)
  } catch (err) {
    falhas++
    console.error(`❌ ${nome}`)
    console.error(`   ↳ ${err?.message || err}`)
  }
}

function afirmar (condicao, mensagem) {
  if (!condicao) throw new Error(mensagem || 'afirmação falhou')
}

function igual (recebido, esperado, mensagem) {
  if (recebido !== esperado) {
    throw new Error(`${mensagem || 'valores diferentes'} (recebido: ${JSON.stringify(recebido)}, esperado: ${JSON.stringify(esperado)})`)
  }
}

function contem (texto, trecho, mensagem) {
  if (!String(texto).includes(trecho)) {
    throw new Error(`${mensagem || 'trecho ausente'}: esperava encontrar ${JSON.stringify(trecho)} em ${JSON.stringify(String(texto).slice(0, 400))}`)
  }
}

// ============================================
// 🎭 FAKES (sock, mensagens, metadados)
// ============================================

const JID = '120363000000000000@g.us'
const JID_PRIVADO = '5511999999999@s.whatsapp.net'
const JOGADOR_A = '5511911111111@s.whatsapp.net'
const JOGADOR_B = '5511922222222@s.whatsapp.net'
const ADMIN = '5511933333333@s.whatsapp.net'
const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F']

const PARTICIPANTES_PADRAO = [
  { id: JOGADOR_A, admin: null },
  { id: JOGADOR_B, admin: null },
  { id: ADMIN, admin: 'admin' }
]

function criarSock (opcoes = {}) {
  const enviadas = []
  const sock = {
    enviadas,
    groupMetadata: async () => ({
      participants: opcoes.participantes || PARTICIPANTES_PADRAO,
      owner: opcoes.owner || ADMIN
    }),
    sendMessage: async (jid, payload) => {
      enviadas.push({ jid, ...payload })
      return { key: { id: 'fake_' + enviadas.length } }
    }
  }
  return sock
}

function msgDe (autor) {
  return { key: { remoteJid: JID, participant: autor, fromMe: false } }
}

function textosDe (sock) {
  return sock.enviadas.map((m) => m.text || '').join('\n')
}

function ultimoTextoDe (sock) {
  const lista = sock.enviadas.filter((m) => m.text)
  return lista.length ? lista[lista.length - 1].text : ''
}

function jogoAtual () {
  return jogos.obterJogo(JID)
}

function dadosAtuais () {
  const jogo = jogoAtual()
  return jogo ? jogo.dados : null
}

// Letra da alternativa CORRETA da pergunta na tela agora.
function letraCerta () {
  const dados = dadosAtuais()
  return LETRAS[dados.atual.correta]
}

// Letra de uma alternativa ERRADA da pergunta na tela agora.
function letraErrada () {
  const dados = dadosAtuais()
  const total = dados.atual.alternativas.length
  for (let i = 0; i < total; i++) {
    if (i !== dados.atual.correta) return LETRAS[i]
  }
  return 'A'
}

// 🧽 Limpa o estado compartilhado de jogos entre um teste e outro.
async function limparTudo () {
  const jogo = jogoAtual()
  if (jogo && jogo.dados?.timer) clearTimeout(jogo.dados.timer)
  jogos.limparJogos()
  quiz._definirDuracaoPergunta(quiz.TIMEOUT_PERGUNTA_MS)
}

// ============================================
// 🧪 TESTES
// ============================================

const banco = require('../dados/perguntas-quiz')
const LISTA_BANCO = Array.isArray(banco) ? banco : (banco.PERGUNTAS || [])

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Abre uma rodada limpa e devolve o sock com as mensagens enviadas.
async function abrirRodada (textoComando = '/quiz', autor = JOGADOR_A, opcoes = {}) {
  await limparTudo()
  const sock = criarSock(opcoes)
  await quiz.executar(sock, JID, msgDe(autor), textoComando)
  return sock
}

// 🧽 Descarta o que a abertura da rodada já enviou (anúncio + 1ª pergunta),
// pra medir só o que a RESPOSTA do jogador gerou.
function esvaziar (sock) {
  sock.enviadas.length = 0
}

async function principal () {
  // ─────────────────────────────────────────────────────────
  // 1) CONTRATO DO COMANDO
  // ─────────────────────────────────────────────────────────
  await testar('comando exporta nome "quiz" e uma função executar', async () => {
    igual(quiz.nome, 'quiz', 'nome do comando')
    igual(typeof quiz.executar, 'function', 'executar deve ser função')
    igual(quiz.TIPO_JOGO, 'quiz', 'tipo do jogo em jogos-ativos')
  })

  await testar('jogos-ativos conhece o tipo quiz (base do bloqueio de jogo duplicado)', async () => {
    igual(jogos.TIPOS.QUIZ, 'quiz', 'TIPOS.QUIZ')
    igual(jogos.rotuloDoTipo('quiz'), 'quiz', 'rótulo do tipo')
  })

  // ─────────────────────────────────────────────────────────
  // 2) BANCO DE PERGUNTAS
  // ─────────────────────────────────────────────────────────
  await testar('banco tem 200+ perguntas bem formadas em 4 categorias', async () => {
    afirmar(LISTA_BANCO.length >= 200, `esperava 200+ perguntas, achei ${LISTA_BANCO.length}`)
    for (const p of LISTA_BANCO) {
      afirmar(typeof p.pergunta === 'string' && p.pergunta.trim(), 'pergunta vazia no banco')
      afirmar(Array.isArray(p.alternativas) && p.alternativas.length === 4, `"${p.pergunta}" não tem 4 alternativas`)
      afirmar(Number.isInteger(p.correta) && p.correta >= 0 && p.correta < 4, `"${p.pergunta}" tem índice de correta inválido`)
      afirmar(typeof p.categoria === 'string' && p.categoria.trim(), `"${p.pergunta}" sem categoria`)
    }
    const cats = new Set(LISTA_BANCO.map((p) => p.categoria))
    afirmar(cats.size >= 4, `esperava 4+ categorias, achei ${cats.size}`)
  })

  await testar('ajuda de uso lista as categorias e o modo parar', async () => {
    const sock = criarSock()
    await quiz.executar(sock, JID, msgDe(JOGADOR_A), '/quiz categorias')
    const texto = ultimoTextoDe(sock)
    contem(texto, 'QUIZ DO LIMBO', 'cabeçalho')
    contem(texto, 'Conhecimentos Gerais', 'categoria gerais')
    contem(texto, 'Geografia', 'categoria geografia')
    contem(texto, '/quiz parar', 'dica de encerramento')
  })

  // ─────────────────────────────────────────────────────────
  // 3) INÍCIO DE RODADA
  // ─────────────────────────────────────────────────────────
  await testar('/quiz inicia rodada com 5 perguntas e registra o jogo no grupo', async () => {
    const sock = await abrirRodada('/quiz')

    const dados = dadosAtuais()
    afirmar(dados, 'a rodada deveria estar registrada em jogos-ativos')
    igual(dados.fila.length, quiz.PERGUNTAS_POR_RODADA, 'perguntas na rodada')
    igual(dados.indice, 0, 'deveria estar na 1ª pergunta')
    igual(dados.autor, JOGADOR_A, 'autor da rodada')
    igual(dados.pontos.size, 0, 'ninguém pontuou ainda')

    const texto = ultimoTextoDe(sock)
    contem(texto, 'QUIZ DO LIMBO', 'cabeçalho da pergunta')
    contem(texto, 'Pergunta *1/5*', 'contador da pergunta')
    contem(texto, dados.atual.pergunta, 'enunciado na mensagem')
    contem(texto, 'A) ', 'alternativa A numerada')
  })

  await testar('pergunta publicada NÃO revela a resposta correta', async () => {
    await abrirRodada('/quiz')
    const dados = dadosAtuais()
    const texto = quiz.montarPergunta(dados)
    afirmar(!texto.includes('Resposta') && !texto.includes('✅'), 'a mensagem da pergunta não pode revelar o gabarito')
    contem(
      texto,
      `${LETRAS[dados.atual.correta]}) ${dados.atual.alternativas[dados.atual.correta]}`,
      'a alternativa correta aparece como opção normal'
    )
  })

  // ─────────────────────────────────────────────────────────
  // 4) RESPOSTA CORRETA / ERRADA
  // ─────────────────────────────────────────────────────────
  await testar('acerto por letra dá 1 ponto e avança para a próxima pergunta', async () => {
    const sock = await abrirRodada('/quiz')
    const pergunta = dadosAtuais().atual
    const consumida = await quiz.aoReceberResposta(sock, JID, msgDe(JOGADOR_A), letraCerta())

    igual(consumida, true, 'a mensagem de acerto deve ser consumida')
    const dados = dadosAtuais()
    igual(dados.pontos.get(JOGADOR_A)?.pontos, 1, 'pontos do jogador')
    igual(dados.indice, 1, 'deveria ter avançado para a 2ª pergunta')
    const texto = textosDe(sock)
    contem(texto, 'Acertou', 'aviso de acerto')
    contem(texto, pergunta.alternativas[pergunta.correta], 'confirmação da resposta certa')
    contem(ultimoTextoDe(sock), 'Pergunta *2/5*', 'próxima pergunta publicada')
  })

  await testar('resposta errada não pontua, não avança e não gera spam', async () => {
    const sock = await abrirRodada('/quiz')
    esvaziar(sock) // descarta anúncio + 1ª pergunta
    const consumida = await quiz.aoReceberResposta(sock, JID, msgDe(JOGADOR_B), letraErrada())

    igual(consumida, true, 'a mensagem de erro deve ser consumida (sem spam)')
    const dados = dadosAtuais()
    afirmar(!dados.pontos.has(JOGADOR_B), 'quem errou não pode pontuar')
    igual(dados.indice, 0, 'a rodada deve continuar na mesma pergunta')
    igual(sock.enviadas.length, 0, 'o 1º erro é silencioso')
  })

  await testar('segundo erro do mesmo jogador recebe aviso com menção', async () => {
    const sock = await abrirRodada('/quiz')
    esvaziar(sock) // descarta anúncio + 1ª pergunta
    await quiz.aoReceberResposta(sock, JID, msgDe(JOGADOR_B), letraErrada())
    await quiz.aoReceberResposta(sock, JID, msgDe(JOGADOR_B), letraErrada())

    const enviadas = sock.enviadas.filter((m) => m.text)
    igual(enviadas.length, 1, 'deveria avisar só no 2º erro')
    contem(enviadas[0].text, 'Errou de novo', 'aviso de erro repetido')
    afirmar(
      Array.isArray(enviadas[0].mentions) && enviadas[0].mentions.includes(JOGADOR_B),
      'deveria mencionar o jogador'
    )
  })

  await testar('acerto por número (1-4) e pelo texto da alternativa também valem', async () => {
    const sock = await abrirRodada('/quiz')
    const dados = dadosAtuais()

    // 1️⃣ número da alternativa correta
    const numero = `${dados.atual.correta + 1}`
    igual(await quiz.aoReceberResposta(sock, JID, msgDe(JOGADOR_B), numero), true, 'número deve ser aceito')
    igual(dadosAtuais().pontos.get(JOGADOR_B)?.pontos, 1, 'ponto por número')

    // 2️⃣ texto exato da alternativa correta da NOVA pergunta
    const proxima = dadosAtuais().atual
    igual(
      await quiz.aoReceberResposta(sock, JID, msgDe(JOGADOR_A), proxima.alternativas[proxima.correta]),
      true,
      'texto da alternativa deve ser aceito'
    )
    igual(dadosAtuais().pontos.get(JOGADOR_A)?.pontos, 1, 'ponto por texto da alternativa')
  })

  await testar('variações de escrita da resposta ("a)", "letra B", "alternativa 3") são aceitas', async () => {
    // Usa um gabarito artificial para não depender do sorteio do banco.
    const pergunta = { alternativas: ['um', 'dois', 'três', 'quatro'], correta: 1 }
    igual(quiz.resolverResposta('b', pergunta), 1, '"b"')
    igual(quiz.resolverResposta('B)', pergunta), 1, '"B)"')
    igual(quiz.resolverResposta('letra b', pergunta), 1, '"letra b"')
    igual(quiz.resolverResposta('2', pergunta), 1, '"2"')
    igual(quiz.resolverResposta('alternativa 2', pergunta), 1, '"alternativa 2"')
    igual(quiz.resolverResposta('dois', pergunta), 1, 'texto da alternativa')
    igual(quiz.resolverResposta('quatro', pergunta), 3, 'texto da 4ª alternativa')
    igual(quiz.resolverResposta('bom dia', pergunta), null, 'conversa comum → null')
  })

  await testar('mensagem que não é resposta não é consumida (conversa do grupo segue)', async () => {
    const sock = await abrirRodada('/quiz')
    esvaziar(sock) // descarta anúncio + 1ª pergunta
    const consumida = await quiz.aoReceberResposta(sock, JID, msgDe(JOGADOR_B), 'bom dia galera, tudo certo por aqui?')
    igual(consumida, false, 'texto livre não deve ser consumido pelo quiz')
    igual(sock.enviadas.length, 0, 'nada deve ser enviado')
  })

  await testar('letra fora do intervalo de alternativas é ignorada', async () => {
    const sock = await abrirRodada('/quiz')
    // A pergunta tem 4 alternativas, então "f" não existe → null → não consome
    igual(quiz.resolverResposta('f', dadosAtuais().atual), null, 'letra inexistente deve virar null')
    igual(await quiz.aoReceberResposta(sock, JID, msgDe(JOGADOR_B), 'f'), false, 'não consome a mensagem')
  })

  // ─────────────────────────────────────────────────────────
  // 5) TIMEOUT DA PERGUNTA
  // ─────────────────────────────────────────────────────────
  await testar('timeout sem acerto revela a resposta e passa para a próxima', async () => {
    await limparTudo()
    quiz._definirDuracaoPergunta(60) // ⏱️ encurta os 30s reais para o teste
    const sock = criarSock()
    await quiz.executar(sock, JID, msgDe(JOGADOR_A), '/quiz')

    await esperar(95)
    const texto = textosDe(sock)
    contem(texto, 'Tempo esgotado', 'aviso de tempo esgotado')
    contem(texto, 'Resposta certa', 'gabarito revelado após o timeout')

    const dados = dadosAtuais()
    igual(dados.indice, 1, 'deveria ter avançado para a 2ª pergunta')
    igual(dados.pontos.size, 0, 'ninguém pontua por timeout')
    contem(ultimoTextoDe(sock), 'Pergunta *2/5*', 'próxima pergunta publicada')
    await limparTudo()
  })

  await testar('timeout na última pergunta encerra a rodada sozinho', async () => {
    await limparTudo()
    quiz._definirDuracaoPergunta(30)
    const sock = criarSock()
    await quiz.executar(sock, JID, msgDe(JOGADOR_A), '/quiz')

    // Deixa as 5 perguntas expirarem (30ms cada) + folga de agendamento
    await esperar(30 * 5 + 220)

    const texto = textosDe(sock)
    contem(texto, 'FIM DO QUIZ', 'ranking final automático')
    contem(texto, 'Ninguém pontuou nesta rodada', 'ninguém acertou')
    igual(jogoAtual(), null, 'o grupo deve ficar livre para outro jogo')
    await limparTudo()
  })

  // ─────────────────────────────────────────────────────────
  // 6) PONTUAÇÃO E RANKING FINAL
  // ─────────────────────────────────────────────────────────
  await testar('rodada completa de 5 perguntas gera ranking com quem mais acertou', async () => {
    await limparTudo()
    quiz._definirDuracaoPergunta(4000)
    const sock = criarSock()
    await quiz.executar(sock, JID, msgDe(JOGADOR_A), '/quiz')

    // A acerta 3 (perguntas 1, 3, 5) e B acerta 2 (perguntas 2 e 4)
    const autores = [JOGADOR_A, JOGADOR_B, JOGADOR_A, JOGADOR_B, JOGADOR_A]
    for (const autor of autores) {
      await quiz.aoReceberResposta(sock, JID, msgDe(autor), letraCerta())
    }

    const texto = ultimoTextoDe(sock)
    contem(texto, 'FIM DO QUIZ', 'cabeçalho do ranking')
    contem(texto, '🥇', 'medalha do 1º lugar')
    contem(texto, '*3* pontos', 'pontuação de quem mais acertou')
    contem(texto, '*2* pontos', 'pontuação do 2º lugar')
    afirmar(texto.indexOf('🥇') < texto.indexOf('*2* pontos'), 'o 1º lugar deve vir antes do 2º')
    igual(jogoAtual(), null, 'a rodada deve ser liberada ao fim')
  })

  // ─────────────────────────────────────────────────────────
  // 7) FILTRO POR CATEGORIA
  // ─────────────────────────────────────────────────────────
  await testar('/quiz geografia sorteia só perguntas da categoria', async () => {
    const sock = await abrirRodada('/quiz geografia')
    const dados = dadosAtuais()
    afirmar(dados, 'a rodada deveria ter começado')
    igual(dados.categoria, 'geografia', 'categoria da rodada')
    igual(dados.fila.length, 5, 'perguntas da rodada')
    afirmar(dados.fila.every((p) => p.categoria === 'geografia'), 'todas as perguntas devem ser de geografia')
    contem(ultimoTextoDe(sock), 'Geografia', 'categoria aparece na pergunta')
  })

  await testar('filtro aceita nome parcial e sem acento (ex: "geo")', async () => {
    await abrirRodada('/quiz geo')
    igual(dadosAtuais()?.categoria, 'geografia', 'categoria resolvida por prefixo')
    await abrirRodada('/quiz CIÊNCIAS')
    igual(dadosAtuais()?.categoria, 'ciencias', 'categoria resolvida sem acento/maiúsculas')
  })

  await testar('categoria desconhecida avisa e NÃO abre rodada', async () => {
    await limparTudo()
    const sock = criarSock()
    await quiz.executar(sock, JID, msgDe(JOGADOR_A), '/quiz futebol americano')

    const texto = ultimoTextoDe(sock)
    contem(texto, 'Não conheço a categoria', 'aviso de categoria desconhecida')
    contem(texto, 'Conhecimentos Gerais', 'lista as categorias disponíveis')
    igual(jogoAtual(), null, 'nenhuma rodada deve ser registrada')
  })

  // ─────────────────────────────────────────────────────────
  // 8) ENCERRAMENTO MANUAL
  // ─────────────────────────────────────────────────────────
  await testar('quem iniciou a rodada consegue parar (/quiz parar) com ranking parcial', async () => {
    const sock = await abrirRodada('/quiz')
    await quiz.aoReceberResposta(sock, JID, msgDe(JOGADOR_B), letraCerta()) // B pontua 1
    await quiz.executar(sock, JID, msgDe(JOGADOR_A), '/quiz parar')

    const texto = ultimoTextoDe(sock)
    contem(texto, 'QUIZ ENCERRADO ANTES DO FIM', 'cabeçalho de encerramento')
    contem(texto, '*1* ponto', 'ranking parcial com os pontos da rodada')
    igual(jogoAtual(), null, 'o grupo deve ficar livre depois de parar')
  })

  await testar('admin do grupo também pode parar a rodada', async () => {
    const sock = await abrirRodada('/quiz')
    await quiz.executar(sock, JID, msgDe(ADMIN), '/quiz parar')
    contem(ultimoTextoDe(sock), 'QUIZ ENCERRADO ANTES DO FIM', 'admin encerrou')
    igual(jogoAtual(), null, 'grupo liberado')
  })

  await testar('jogador comum (nem admin, nem quem iniciou) NÃO consegue parar', async () => {
    const sock = await abrirRodada('/quiz')
    await quiz.executar(sock, JID, msgDe(JOGADOR_B), '/quiz parar')

    contem(ultimoTextoDe(sock), 'Só quem iniciou', 'aviso de permissão')
    afirmar(jogoAtual(), 'a rodada deve continuar ativa')
  })

  await testar('/quiz parar sem rodada ativa avisa que não tem jogo', async () => {
    await limparTudo()
    const sock = criarSock()
    await quiz.executar(sock, JID, msgDe(JOGADOR_A), '/quiz parar')
    contem(ultimoTextoDe(sock), 'Não tem nenhum quiz rolando', 'aviso de rodada inexistente')
  })

  // ─────────────────────────────────────────────────────────
  // 9) BLOQUEIO DE JOGO DUPLICADO NO GRUPO
  // ─────────────────────────────────────────────────────────
  await testar('não dá para abrir dois quizzes no mesmo grupo', async () => {
    const sock = await abrirRodada('/quiz')
    const filaAntes = dadosAtuais().fila
    await quiz.executar(sock, JID, msgDe(JOGADOR_B), '/quiz')

    contem(ultimoTextoDe(sock), 'JÁ TEM UM QUIZ ROLANDO', 'aviso de jogo duplicado')
    igual(dadosAtuais().fila, filaAntes, 'a rodada original deve continuar intacta')
    igual(dadosAtuais().autor, JOGADOR_A, 'o dono da rodada não muda')
  })

  await testar('quiz não começa se já houver outro jogo (ex: gartic) no grupo', async () => {
    await limparTudo()
    jogos.registrarJogo(JID, 'gartic', { palavra: 'teste', timer: null })
    const sock = criarSock()
    await quiz.executar(sock, JID, msgDe(JOGADOR_A), '/quiz')

    const texto = ultimoTextoDe(sock)
    contem(texto, 'Já tem um', 'aviso de conflito com outro jogo')
    contem(texto, 'gartic', 'nomeia o jogo que está rolando')
    igual(jogoAtual().tipo, 'gartic', 'o jogo anterior deve continuar sendo o dono do grupo')
    await limparTudo()
  })

  // ─────────────────────────────────────────────────────────
  // 10) ROBUSTEZ E GANCHO DO bot.js
  // ─────────────────────────────────────────────────────────
  await testar('/quiz fora de grupo avisa e não registra rodada', async () => {
    await limparTudo()
    const sock = criarSock()
    await quiz.executar(sock, JID_PRIVADO, { key: { remoteJid: JID_PRIVADO, participant: JOGADOR_A } }, '/quiz')
    contem(ultimoTextoDe(sock), 'quiz é coisa de grupo', 'aviso de fora de grupo')
    igual(jogos.obterJogo(JID_PRIVADO), null, 'nada registrado no privado')
  })

  await testar('gancho de texto livre do bot.js entrega a resposta ao quiz', async () => {
    const sock = await abrirRodada('/quiz')
    const certa = letraCerta()
    // É exatamente assim que o bot.js chama o gancho (mensagem sem "/").
    await jogos.processarMensagemLivre(sock, JID, msgDe(JOGADOR_A), certa)

    const dados = dadosAtuais()
    igual(dados.pontos.get(JOGADOR_A)?.pontos, 1, 'ponto contabilizado pelo gancho')
    igual(dados.indice, 1, 'a rodada avançou pela mensagem livre')
  })

  await testar('gancho ignora mensagem livre sem rodada ativa (não quebra nada)', async () => {
    await limparTudo()
    const sock = criarSock()
    await jogos.processarMensagemLivre(sock, JID, msgDe(JOGADOR_A), 'a')
    igual(jogoAtual(), null, 'nada deve ser criado')
    igual(sock.enviadas.length, 0, 'nada deve ser enviado')
  })

  await testar('erro de rede/socket não derruba o executar do /quiz', async () => {
    const sockQuebrado = {
      groupMetadata: async () => { throw new Error('rede fora') },
      sendMessage: async () => { throw new Error('rede fora') }
    }
    // Não pode lançar: o catch interno do executar segura a exceção.
    await quiz.executar(sockQuebrado, JID, msgDe(JOGADOR_A), '/quiz')
    await limparTudo()
    afirmar(true, 'chegou aqui sem explodir')
  })

  // ─────────────────────────────────────────────────────────
  // 📊 RESUMO
  // ─────────────────────────────────────────────────────────
  await limparTudo()
  console.log('\n────────────────────────────────────────')
  console.log(`🧪 ${total - falhas}/${total} testes passaram`)
  if (falhas) {
    console.error(`❌ ${falhas} teste(s) falharam`)
    process.exit(1)
  }
  console.log('✅ /quiz ok: rodada, acerto, erro, timeout, categoria, encerramento e bloqueio duplicado.')
  process.exit(0)
}

principal().catch((err) => {
  console.error('💥 falha inesperada no teste:', err?.stack || err)
  process.exit(1)
})




