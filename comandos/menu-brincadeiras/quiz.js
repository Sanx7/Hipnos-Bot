// ============================================
// 🧠 /quiz — Perguntas de múltipla escolha
// ============================================
//
// Arquitetura: MESMO padrão de jogo do /gartic e /anagrama
//   - O estado da rodada vive em dados/jogos-ativos.js (registrarJogo), então
//     é impossível ter dois jogos ao mesmo tempo no mesmo grupo;
//   - Os palpites em texto livre chegam pelo gancho do bot.js
//     (processarMensagemLivre → registrarOuvinteTexto). O ouvinte é
//     registrado UMA vez, no carregamento deste módulo;
//   - Nada de Mongo: a pontuação é POR PARTIDA, em memória.
//
// Regras da rodada:
//   - 5 perguntas, uma por vez, com 30s para acertar cada uma;
//   - o PRIMEIRO a acertar leva o ponto e já abre a próxima pergunta;
//   - ninguém acertou no tempo → revela a resposta e passa pra próxima;
//   - no fim (ou em `/quiz parar`) sai o ranking da rodada.
//
// SUPOSIÇÕES (documentadas, no espírito do que o /gartic já usa):
//   - O ouvinte de texto livre recebe (sock, jid, msg, texto) e devolve
//     `true` (mensagem consumida) ou `false` (segue o fluxo normal). Como o
//     estado é lido direto de obterJogo(jid), NÃO dependemos de nenhum
//     parâmetro extra do gancho;
//   - O autor da mensagem sai de msg.key.participant (mesmo campo que o
//     Baileys usa para menções), com fallbacks defensivos;
//   - As alternativas NÃO são embaralhadas: a letra correta de cada pergunta
//     é a do banco (as corretas já variam entre A/B/C/D lá dentro, e manter a
//     ordem original deixa o comportamento determinístico para os testes).

// ============================================
// 📦 IMPORTAÇÕES
// ============================================

const {
  TIPOS,
  rotuloDoTipo,
  registrarOuvinteTexto,
  obterJogo,
  registrarJogo,
  removerJogo
} = require('../../dados/jogos-ativos')

// Verificação PROOF-LID de admin/dono (mesmo critério do /gartic, /soadm,
// /hidetag e /roletarussa) — o WhatsApp às vezes entrega o remetente como @lid,
// e comparar a string crua falharia.
const { ehAdminDoGrupo, ehDonoDoBot } = require('../../config')

// ============================================
// 📚 BANCO DE PERGUNTAS
// ============================================

const bancoQuiz = require('../../dados/perguntas-quiz')

// O banco pode exportar um array puro ou { PERGUNTAS, CATEGORIAS } — aceita os
// dois formatos para não quebrar se o arquivo for reorganizado depois.
const PERGUNTAS_BRUTAS = Array.isArray(bancoQuiz)
  ? bancoQuiz
  : (bancoQuiz?.PERGUNTAS || [])

const CATEGORIAS_BRUTAS = Array.isArray(bancoQuiz) ? [] : (bancoQuiz?.CATEGORIAS || [])

// 🛡️ Só entra no jogo pergunta bem formada (protege contra typo no banco).
//    `let` (não `const`) porque os testes offline trocam o banco via _injetarBanco.
let PERGUNTAS = PERGUNTAS_BRUTAS.filter((p) => (
  p &&
  typeof p.pergunta === 'string' && p.pergunta.trim() &&
  Array.isArray(p.alternativas) && p.alternativas.length >= 2 &&
  Number.isInteger(p.correta) &&
  p.correta >= 0 && p.correta < p.alternativas.length
))

// ============================================
// ⚙️ CONSTANTES
// ============================================

const TIPO_JOGO = TIPOS.QUIZ
const PERGUNTAS_POR_RODADA = 5
const TIMEOUT_PERGUNTA_MS = 30000
const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F']

const AVISO_FORA_GRUPO =
  '🌙 O quiz é coisa de grupo! Chame os amigos em um grupo e rode `/quiz` lá.'

const AVISO_SEM_JOGO =
  '❌ Não tem nenhum quiz rolando neste grupo. Comece com `/quiz`!'

const AVISO_PERMISSAO =
  '🚫 Só quem iniciou a rodada, os admins do grupo ou os donos do bot podem parar o quiz.'

// ─── 🪝 Pontos de injeção dos testes offline (mesmo padrão do /gartic) ───
let duracaoPerguntaMs = TIMEOUT_PERGUNTA_MS

// ============================================
// 🔤 UTILITÁRIOS DE TEXTO
// ============================================

// Minúsculas + sem acento + sem espaços nas pontas (compara "Geografia" com
// "geografia" e "São Paulo" com "sao paulo").
function normalizar (texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

// 👤 Quem mandou a mensagem (mesmo campo que o Baileys usa para menções).
function jidDe (msg) {
  const bruto = msg?.key?.participant || msg?.participant || msg?.key?.remoteJid || ''
  return String(bruto) || 'desconhecido@s.whatsapp.net'
}

// O que aparece depois do "@" — o WhatsApp troca por nome real na menção.
function numeroDe (jid) {
  return String(jid).split('@')[0]
}

// ============================================
// 📂 CATEGORIAS
// ============================================

// O banco guarda as categorias como chaves cruas ("gerais", "ciencias"). Aqui
// só definimos como elas aparecem para o usuário — o casamento do filtro
// continua sendo por chave normalizada.
const ROTULO_CATEGORIA = {
  gerais: 'Conhecimentos Gerais',
  geografia: 'Geografia',
  entretenimento: 'Entretenimento',
  ciencias: 'Ciências'
}

function nomeCategoria (categoria) {
  if (!categoria) return ''
  return ROTULO_CATEGORIA[normalizar(categoria)] || String(categoria)
}

// Lista canônica vinda do banco (ou derivada das perguntas, se o banco não
// expuser CATEGORIAS).
function listaCategorias () {
  if (Array.isArray(CATEGORIAS_BRUTAS) && CATEGORIAS_BRUTAS.length) {
    return CATEGORIAS_BRUTAS
      .map((c) => (typeof c === 'string' ? c : c?.nome))
      .filter(Boolean)
  }
  return [...new Set(PERGUNTAS.map((p) => p.categoria).filter(Boolean))]
}

// Casa o que o usuário digitou com a categoria do banco: exato → começa com →
// contém (então "geo" acha "Geografia").
function casarCategoria (filtro) {
  const alvo = normalizar(filtro)
  if (!alvo) return null
  const cats = listaCategorias()
  return cats.find((c) => normalizar(c) === alvo) ||
    cats.find((c) => normalizar(c).startsWith(alvo)) ||
    cats.find((c) => normalizar(c).includes(alvo)) ||
    null
}

function filtrarCategoria (categoria) {
  const alvo = normalizar(categoria)
  return PERGUNTAS.filter((p) => normalizar(p.categoria) === alvo)
}

// 🎲 Sorteia N perguntas sem repetir (Fisher-Yates numa cópia do pool).
function sortearPerguntas (categoria, quantidade) {
  const pool = categoria ? filtrarCategoria(categoria) : PERGUNTAS
  const embaralhado = [...pool]
  for (let i = embaralhado.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = embaralhado[i]
    embaralhado[i] = embaralhado[j]
    embaralhado[j] = temp
  }
  return embaralhado.slice(0, quantidade)
}

// ============================================
// 💬 INTERPRETAÇÃO DAS RESPOSTAS
// ============================================

// Aceita, em qualquer ordem de preferência do jogador:
//   - a LETRA:      "a", "A)", "b.", "c) ", "letra d"
//   - o NÚMERO:     "1", "2)", "3.", "alternativa 4", "opcao 2"
//   - o TEXTO:      o conteúdo exato de uma das alternativas
// Devolve o índice da alternativa (0-based) ou null se não parece resposta.
function resolverResposta (texto, pergunta) {
  if (!pergunta || !Array.isArray(pergunta.alternativas)) return null
  const total = pergunta.alternativas.length
  const limpo = normalizar(texto)
  if (!limpo) return null

  // Tira pontuação final ("a)", "b.", "3,") antes de comparar
  const enxuto = limpo.replace(/[.)\-,;:\s]+$/g, '').trim()

  // 1️⃣ Letra (com ou sem o prefixo "letra")
  const letra = enxuto.match(/^(?:letra\s+)?([a-f])$/)
  if (letra) {
    const idx = letra[1].charCodeAt(0) - 97
    return idx < total ? idx : null
  }

  // 2️⃣ Número (com ou sem "alternativa"/"opcao")
  const numero = enxuto.match(/^(?:alternativa\s+|opcao\s+)?([1-9])$/)
  if (numero) {
    const idx = Number(numero[1]) - 1
    return idx < total ? idx : null
  }

  // 3️⃣ Texto completo de uma alternativa
  const idx = pergunta.alternativas.findIndex((alt) => normalizar(alt) === limpo)
  return idx >= 0 ? idx : null
}

// ============================================
// ✍️ MENSAGENS DA RODADA
// ============================================

function corretaEmTexto (pergunta) {
  return `${LETRAS[pergunta.correta]}) ${pergunta.alternativas[pergunta.correta]}`
}

// Pergunta em si (NUNCA revela a resposta)
function montarPergunta (dados) {
  const p = dados.atual
  const total = dados.fila.length
  const alternativas = p.alternativas
    .map((alt, i) => `${LETRAS[i]}) ${alt}`)
    .join('\n')

  return '🧠 *QUIZ DO LIMBO* 🧠\n\n' +
    `📊 Pergunta *${dados.indice + 1}/${total}*` +
    (p.categoria ? ` — 📂 *${nomeCategoria(p.categoria)}*` : '') + '\n\n' +
    `❓ *${p.pergunta}*\n\n` +
    alternativas + '\n\n' +
    '💬 Responda aqui no grupo com a *letra* (A-D) ou o *número* (1-4).\n' +
    `⏳ ${Math.round(duracaoPerguntaMs / 1000)}s para alguém acertar.`
}

// Placar (parcial ou final) + jids para o campo mentions
function montarRanking (dados, titulo) {
  const lista = [...dados.pontos.values()]
    .sort((a, b) => (b.pontos - a.pontos) || (a.sequencia - b.sequencia))

  if (!lista.length) {
    return { texto: `${titulo}\n\n😴 Ninguém pontuou nesta rodada.`, mentions: [] }
  }

  const medalhas = ['🥇', '🥈', '🥉']
  const linhas = lista.map((jogador, i) => {
    const posicao = medalhas[i] || `${i + 1}º`
    const plural = jogador.pontos === 1 ? 'ponto' : 'pontos'
    return `${posicao} @${numeroDe(jogador.jid)} — *${jogador.pontos}* ${plural}`
  })

  return { texto: `${titulo}\n\n${linhas.join('\n')}`, mentions: lista.map((j) => j.jid) }
}

// 📤 Envia sempre por aqui (e sempre com mentions quando houver alguém a marcar)
async function responder (sock, jid, texto, mentions) {
  const payload = { text: texto }
  if (Array.isArray(mentions) && mentions.length) payload.mentions = mentions
  return await sock.sendMessage(jid, payload)
}

// ============================================
// 🎮 FLUXO DA RODADA
// ============================================

// 🧹 Encerra a rodada: limpa o timer e libera o grupo em jogos-ativos.
function encerrarRodada (jid) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) return null
  if (jogo.dados?.timer) clearTimeout(jogo.dados.timer)
  removerJogo(jid, TIPO_JOGO)
  return jogo.dados
}

// 🏁 Mostra o ranking final e encerra de vez.
async function finalizar (jid, motivo, extra) {
  const dados = encerrarRodada(jid)
  if (!dados) return null

  const cabecalho = motivo === 'parada'
    ? '🛑 *QUIZ ENCERRADO ANTES DO FIM!*'
    : '🏁 *FIM DO QUIZ!*'

  const ranking = montarRanking(dados, cabecalho)
  const texto = (extra ? `${extra}\n\n` : '') + ranking.texto +
    '\n\n🌙 Rode `/quiz` pra outra rodada.'
  await responder(dados.sock, jid, texto, ranking.mentions)
  console.log(`[quiz] 🏁 rodada finalizada em ${jid} (${motivo})`)
  return dados
}

// ➡️ Publica a próxima pergunta ou finaliza se a fila acabou.
async function proximaPergunta (jid) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) return null
  const dados = jogo.dados

  if (dados.timer) {
    clearTimeout(dados.timer)
    dados.timer = null
  }

  dados.indice += 1
  dados.atual = dados.fila[dados.indice] || null

  if (!dados.atual) return await finalizar(jid, 'fim')

  dados.inicioPergunta = Date.now()
  dados.timer = setTimeout(() => aoExpirar(jid), duracaoPerguntaMs)
  return await responder(dados.sock, jid, montarPergunta(dados))
}

// ⏳ Ninguém acertou no tempo: revela a resposta e passa pra próxima.
async function aoExpirar (jid) {
  try {
    const jogo = obterJogo(jid)
    if (!jogo || jogo.tipo !== TIPO_JOGO) return
    const dados = jogo.dados
    dados.timer = null

    const pergunta = dados.atual
    if (!pergunta) return

    console.log(`[quiz] ⏳ tempo esgotado na pergunta ${dados.indice + 1} de ${jid}`)
    await responder(
      dados.sock,
      jid,
      '⏳ *Tempo esgotado!* Ninguém acertou essa.\n\n' +
      `✅ Resposta certa: *${corretaEmTexto(pergunta)}*\n\n` +
      '➡️ Já vem a próxima...'
    )
    return await proximaPergunta(jid)
  } catch (err) {
    console.error('[quiz] 💥 erro no timeout da pergunta:', err?.stack || err)
    return null
  }
}

// 💬 Gancho de texto livre (bot.js → processarMensagemLivre).
// Devolve true = mensagem consumida pelo quiz; false = segue o fluxo normal.
async function aoReceberResposta (sock, jid, msg, texto) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) return false
  const dados = jogo.dados
  const pergunta = dados.atual
  if (!pergunta) return false

  const escolha = resolverResposta(texto, pergunta)
  // Não parece resposta (nem letra, nem número, nem alternativa): deixa a
  // conversa do grupo seguir normalmente.
  if (escolha === null) return false

  const autor = jidDe(msg)

  if (escolha !== pergunta.correta) {
    const anterior = dados.erros.get(autor)
    const erros = (anterior?.erros || 0) + 1
    dados.erros.set(autor, { jid: autor, erros })
    // A partir do 2º erro o jogador já foi avisado que está no caminho errado.
    if (erros >= 2) {
      await responder(dados.sock, jid, `❌ Errou de novo, @${numeroDe(autor)}! Tenta outra.`, [autor])
    }
    return true
  }

  // ✅ Acertou: ponto pra ele e segue pra próxima pergunta.
  const jogador = dados.pontos.get(autor) ||
    { jid: autor, pontos: 0, sequencia: dados.pontos.size }
  jogador.pontos += 1
  dados.pontos.set(autor, jogador)

  if (dados.timer) {
    clearTimeout(dados.timer)
    dados.timer = null
  }

  console.log(`[quiz] ✅ ${numeroDe(autor)} acertou a pergunta ${dados.indice + 1} em ${jid}`)
  await responder(
    dados.sock,
    jid,
    `✅ *Acertou, @${numeroDe(autor)}!* +1 ponto\n` +
    `Resposta: *${corretaEmTexto(pergunta)}*`,
    [autor]
  )
  // 👆 A resposta foi consumida pelo quiz: devolve true MESMO depois de abrir a
  // próxima pergunta (senão o gancho do bot.js acharia que a mensagem era
  // conversa solta e seguiria o fluxo normal).
  await proximaPergunta(jid)
  return true
}

// ============================================
// 🚀 INÍCIO E ENCERRAMENTO
// ============================================

function ajudaUso (extra) {
  const cats = listaCategorias()
  return '🧠 *QUIZ DO LIMBO* 🧠\n\n' +
    (extra ? `${extra}\n\n` : '') +
    '📖 Como jogar: `/quiz` abre uma rodada de 5 perguntas e os jogadores ' +
    'respondem aqui no grupo com a *letra* (A-D) ou o *número* (1-4) da alternativa.\n\n' +
    '🎯 */quiz <categoria>* — rodada só de um assunto\n' +
    '🛑 */quiz parar* — encerra a rodada (admins e quem iniciou)\n\n' +
    '📂 Categorias: ' + (cats.length
      ? cats.map((c) => `*${nomeCategoria(c)}*`).join(', ')
      : '_o banco está vazio_')
}

// 🔐 Quem pode parar: quem iniciou, admin do grupo ou dono do bot.
async function podeParar (sock, jid, msg, autor, dados) {
  if (!dados) return false
  const iniciador = dados.autor
  // Compara o jid cru E o número puro: o WhatsApp pode entregar o iniciador
  // como @lid e a resposta vinda do @s.whatsapp.net (ou o contrário).
  if (iniciador && autor &&
    (String(iniciador) === String(autor) || numeroDe(iniciador) === numeroDe(autor))) {
    return true
  }
  try {
    const metadados = await sock.groupMetadata(jid)
    const participantes = metadados?.participants || []
    return Boolean(
      ehAdminDoGrupo(participantes, autor) ||
      ehDonoDoBot(participantes, autor) ||
      (metadados?.owner && numeroDe(metadados.owner) === numeroDe(autor))
    )
  } catch (err) {
    // Sem metadados (grupo/@lid exótico): cai no critério de quem iniciou.
    console.error('[quiz] 💥 não consegui ler os metadados do grupo:', err?.message || err)
    return false
  }
}

// 🛑 `/quiz parar` — encerra a rodada mostrando o ranking parcial.
async function parar (sock, jid, msg) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) {
    return await sock.sendMessage(jid, { text: AVISO_SEM_JOGO }, { quoted: msg })
  }
  const autor = jidDe(msg)
  const autorizado = await podeParar(sock, jid, msg, autor, jogo.dados)
  if (!autorizado) {
    return await sock.sendMessage(jid, { text: AVISO_PERMISSAO }, { quoted: msg })
  }
  return await finalizar(jid, 'parada')
}

// 🏁 `/quiz [categoria]` — abre a rodada.
async function iniciar (sock, jid, msg, autor, filtroCategoria) {
  if (!jid.endsWith('@g.us')) {
    return await sock.sendMessage(jid, { text: AVISO_FORA_GRUPO }, { quoted: msg })
  }

  // 📂 Categoria (aceita parcial: "geo" → "Geografia")
  let categoria = null
  if (filtroCategoria) {
    categoria = casarCategoria(filtroCategoria)
    if (!categoria) {
      return await sock.sendMessage(jid, {
        text: ajudaUso(`❓ Não conheço a categoria *${filtroCategoria}*.`)
      }, { quoted: msg })
    }
  }

  // 🔒 Já tem jogo neste grupo?
  const ativo = obterJogo(jid)
  if (ativo && ativo.tipo === TIPO_JOGO) {
    const dados = ativo.dados || {}
    return await sock.sendMessage(jid, {
      text: '🧠 *JÁ TEM UM QUIZ ROLANDO NESTE GRUPO!*\n\n' +
        `📊 Pergunta *${(dados.indice || 0) + 1}/${(dados.fila || []).length}*` +
        (dados.atual?.categoria ? ` — 📂 *${nomeCategoria(dados.atual.categoria)}*` : '') + '\n\n' +
        '💡 Responda aqui no grupo com a letra da alternativa ou use `/quiz parar`.'
    }, { quoted: msg })
  }
  if (ativo) {
    return await sock.sendMessage(jid, {
      text: `🔒 Já tem um *${rotuloDoTipo(ativo.tipo)}* rolando neste grupo. Termine (ou cancele) ele antes de abrir um quiz.`
    }, { quoted: msg })
  }

  // 🎲 Sorteia as perguntas da rodada
  const fila = sortearPerguntas(categoria, PERGUNTAS_POR_RODADA)
  if (!fila.length) {
    return await sock.sendMessage(jid, {
      text: ajudaUso(
        categoria
          ? `😴 Ainda não tenho perguntas de *${nomeCategoria(categoria)}*.`
          : '😴 O banco de perguntas está vazio.'
      )
    }, { quoted: msg })
  }

  // 🔒 Registra a rodada ANTES de publicar a 1ª pergunta.
  //    (indice começa em -1; proximaPergunta() soma 1 e publica a pergunta 1)
  const dados = {
    categoria: categoria || null,
    autor,
    inicio: Date.now(),
    fila,
    indice: -1,
    atual: null,
    inicioPergunta: 0,
    pontos: new Map(),
    erros: new Map(),
    timer: null,
    sock
  }
  const registro = registrarJogo(jid, TIPO_JOGO, dados)
  if (!registro.ok) {
    return await sock.sendMessage(jid, {
      text: `🔒 Já tem um *${rotuloDoTipo(registro.conflito?.tipo)}* rolando neste grupo.`
    }, { quoted: msg })
  }

  console.log(`[quiz] 🧠 nova rodada em ${jid} (${fila.length} perguntas${categoria ? `, ${categoria}` : ''})`)
  await sock.sendMessage(jid, {
    text: '🧠 *QUIZ DO LIMBO* 🧠\n\n' +
      `🎬 Rodada começando com *${fila.length}* perguntas` +
      (categoria ? ` de 📂 *${nomeCategoria(categoria)}*` : '') + '!\n' +
      '💬 Responda com a letra da alternativa — quem acertar primeiro leva o ponto.'
  }, { quoted: msg })

  return await proximaPergunta(jid)
}

// ============================================
// 🔌 REGISTRO DO GANCHO DE TEXTO LIVRE
// ============================================

// O ouvinte é registrado UMA vez, no carregamento do módulo — exatamente como
// no /gartic. O bot.js só chama o gancho em mensagens que NÃO começam com "/".
registrarOuvinteTexto(TIPO_JOGO, aoReceberResposta)

// ============================================
// 📦 EXPORTAÇÃO PRINCIPAL (mesmo contrato do loader: nome + executar)
// ============================================

module.exports = {
  nome: 'quiz',
  descricao: 'Quiz: perguntas de múltipla escolha com ranking — 5 perguntas por rodada, um jogo por grupo.',

  executar: async function (sock, jid, msg, texto) {
    try {
      const resto = String(texto || '').replace(/^\/\S+\s*/, '').trim()
      const normalizado = normalizar(resto)

      // 🛑 Encerramento manual
      if (['parar', 'encerrar', 'cancelar', 'stop'].includes(normalizado)) {
        return await parar(sock, jid, msg)
      }

      // 📂 Lista de categorias
      if (['categorias', 'categoria', 'temas', 'assuntos'].includes(normalizado)) {
        return await sock.sendMessage(jid, { text: ajudaUso() }, { quoted: msg })
      }

      const autor = jidDe(msg)
      return await iniciar(sock, jid, msg, autor, normalizado || null)
    } catch (err) {
      // 🛡️ Nada escapa para o socket (o bot segue vivo)
      console.error('[quiz] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras embaralharam as perguntas... Tente `/quiz` de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  // ─── Extras internos usados pelos testes offline (mesmo padrão do /gartic) ───
  TIPO_JOGO,
  PERGUNTAS_POR_RODADA,
  TIMEOUT_PERGUNTA_MS,
  ajudaUso,
  montarPergunta,
  montarRanking,
  resolverResposta,
  casarCategoria,
  nomeCategoria,
  listaCategorias,
  sortearPerguntas,
  aoReceberResposta,
  aoExpirar,
  _injetarBanco: (lista) => {
    if (Array.isArray(lista)) PERGUNTAS = lista.filter(Boolean)
  },
  _definirDuracaoPergunta: (ms) => {
    duracaoPerguntaMs = Number(ms) > 0 ? Number(ms) : TIMEOUT_PERGUNTA_MS
  }
}

// ============================================
// 📝 CHANGELOG (entrada deste comando)
// ============================================
// Ao subir uma mudança relevante no quiz, adicione/atualize a entrada em
// dados/changelog.js (é o que o /novidades mostra pro grupo).





