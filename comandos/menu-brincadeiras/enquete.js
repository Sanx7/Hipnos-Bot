// ============================================================
// 📊 ENQUETE — enquete de opinião do grupo, por TEXTO LIVRE (uso LIVRE)
// ============================================================
//   /enquete pergunta | opção 1 | opção 2 | ...
//   /encerrar-enquete            → encerra antes da hora (só quem criou)
//   /enquete status              → mostra a enquete ativa
//
// 📊 DIFERENTE DO /enquete-admin: aquele é para DECISÃO ADMINISTRATIVA
// (apenas admins, resultado estratégico). Esta é uma enquete de OPINIÃO
// rápida: QUALQUER membro do grupo pode abrir e votar.
//
// 🔴 POR QUE VOTO POR TEXTO E NÃO POR REAÇÃO (1️⃣2️⃣3️⃣)?
// A versão instalada (Baileys 7.0.0-rc14) TEM o evento `messages.reaction`
// e o `sock.readMessages`, mas o voto por reação não é viável aqui:
//   1) o bot.js NÃO escuta `messages.reaction` (só `messages.upsert`,
//      `creds.update` e `group-participants.update`) — seria preciso
//      abrir um listener novo no roteador;
//   2) as reações ficam num BUFFER de eventos: se o bot reiniciar ou o
//      evento chegar enquanto ele reconecta, o voto se perde — e a
//      enquete ficaria sem resultado justo quando o usuário mais precisa;
//   3) para ler a reação de TERCEIROS é preciso marcar a mensagem como
//      lida (readMessages), o que tem efeito colateral no grupo.
// Já o voto por TEXTO LIVRE usa o caminho JÁ VALIDADO do projeto
// (processarMensagemLivre, o mesmo do /gartic, /quiz, /forca,
// /desenharpalavra e /adivinha-emoji): sem listener novo, sem buffer,
// sem marcar nada como lido, e o voto NÃO se perde se o bot reiniciar
// (o contador vive na rodada em memória enquanto ela dura).
// ℹ️ Trade-off: enquanto houver enquete ativa, um número solto no grupo conta
// como voto (o mesmo comportamento já aceito no /quiz).
//
// ⏱️ DURAÇÃO: 2 minutos (constante abaixo), ou até /encerrar-enquete.
// 🔒 Uma enquete por grupo via registro COMPARTILHADO (dados/jogos-ativos.js):
//    bloqueia com o /velha, /anagrama, /gartic, /quiz, /forca,
//    /adivinha-emoji e /desenharpalavra, e não convive com outra enquete.
// 🗳️ Um voto por pessoa: pode trocar de opção a qualquer momento antes do fim.
// ============================================================

const { TIPOS, rotuloDoTipo, registrarJogo, removerJogo, obterJogo, registrarOuvinteTexto } = require('../../dados/jogos-ativos')
const { normalizar } = require('../../dados/comparacao-palavras')

const TIPO_JOGO = TIPOS.ENQUETE

// ⏱️ Duração da enquete (ms) — configurável aqui
let DURACAO_ENQUETE_MS = 2 * 60 * 1000

// 🎯 Limites de opções
const MAX_OPCOES = 6
const MIN_OPCOES = 2

// 🔢 Emojis de número para citar as opções no texto da mensagem
const EMOJIS_NUMERO = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣']

// ─── ✉️ Mensagens ───
const AVISO_USO =
  '📊 *ENQUETE DO LIMBO* — monte assim:\n\n' +
  '`/enquete pergunta | opção 1 | opção 2 | ...`\n\n' +
  'Ex.: `/enquete Pedro ou Ana? | Pedro | Ana | Não sei`\n\n' +
  `ℹ️ De ${MIN_OPCOES} a ${MAX_OPCOES} opções. Quem chamar, pode ser qualquer pessoa do grupo.\n` +
  '🗳️ Para votar, mande o NÚMERO da opção (1, 2, 3...) direto no chat.\n' +
  '⏱️ A enquete dura 2 minutos (ou até alguém usar /encerrar-enquete).'

const AVISO_ERRO = '⛔ A enquete se desfez nas sombras... Tente novamente em instantes.'

// ─── 📋 Estado (ganchos p/ testes offline) ───
let agendar = (fn, ms) => setTimeout(fn, ms)
let limparTimer = (id) => clearTimeout(id)

// ─── 🔓 Encerra a rodada ───
function encerrarEnquete (jid) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) return null
  const dados = jogo.dados || {}
  if (dados.timer) {
    limparTimer(dados.timer)
    dados.timer = null
  }
  removerJogo(jid, TIPO_JOGO)
  return dados
}

// ─── 📊 Apura o resultado (contagem + vencedora/empate) ───
function apurar (dados) {
  const contagem = dados.opcoes.map((texto, indice) => ({
    indice,
    texto,
    votos: (dados.votos.get(indice) || new Set()).size
  }))
  const total = contagem.reduce((soma, c) => soma + c.votos, 0)

  if (total === 0) {
    return { contagem, total, vencedoras: [], empate: false, semVotos: true }
  }

  const maximo = Math.max(...contagem.map((c) => c.votos))
  const vencedoras = contagem.filter((c) => c.votos === maximo)
  return {
    contagem,
    total,
    maximo,
    vencedoras,
    empate: vencedoras.length > 1,
    semVotos: false
  }
}

// ─── 📤 Monta o texto do resultado ───
function textoResultado (dados, motivo) {
  const r = apurar(dados)
  const linhas = []

  linhas.push(motivo === 'tempo' ? '⏱️ *TEMPO ESGOTADO!* Votação encerrada.' : '🏁 *ENQUETE ENCERRADA!*')
  linhas.push(`📊 *${dados.pergunta}*\n`)

  for (const c of r.contagem) {
    const barra = '█'.repeat(c.votos).padEnd(r.total, '░')
    linhas.push(`${EMOJIS_NUMERO[c.indice]} ${c.texto} — *${c.votos}* voto(s) \`${barra}\``)
  }

  linhas.push(`\n🗳️ Total: *${r.total}** voto(s)`)

  if (r.semVotos) {
    linhas.push('\n🌙 Ninguém votou... o limbo ficou em silêncio.')
  } else if (r.empate) {
    linhas.push(`\n🤝 *EMPATE!* Venceu (n)m... empataram: *${r.vencedoras.map((c) => c.texto).join(' e ')}* (${r.maximo} voto(s) cada).`)
  } else {
    linhas.push(`\n🏆 *VENCEDORA:* ${r.vencedoras[0].texto} (${r.vencedoras[0].votos} voto(s))`)
  }

  linhas.push(`\n🌙 Digite \`/enquete pergunta | ...\` para a próxima.`)
  return linhas.join('\n')
}

// ─── 🗳️ Monta a mensagem da enquete (pergunta + opções numeradas) ───
function textoDaEnquete (dados) {
  const minutos = Math.max(1, Math.round(dados.duracaoMs / 60000))
  const linhas = [`📊 *ENQUETE DO LIMBO*\n\n❓ *${dados.pergunta}*\n`]
  dados.opcoes.forEach((opcao, indice) => {
    linhas.push(`${EMOJIS_NUMERO[indice]} ${opcao}`)
  })
  linhas.push(
    '\n🗳️ *Para votar, mande o NÚMERO da opção direto aqui no chat* (1, 2, 3...).' +
    '\n⏱️ A enquete fecha em ~' + minutos + ' minuto(s) — ou antes, com /encerrar-enquete.' +
    `\n🔎 Quem criou: @${String(dados.autor).split('@')[0]}`
  )
  return linhas.join('\n')
}

// ─── 📊 Cria a enquete ───
async function criar (sock, jid, msg, autor, pergunta, opcoes) {
  if (!String(jid || '').endsWith('@g.us')) {
    return await sock.sendMessage(jid, {
      text: '🌙 *A enquete é coisa de grupo...*\n\nChame os amigos e rode `/enquete pergunta | opção 1 | opção 2` lá dentro.'
    }, { quoted: msg })
  }

  if (opcoes.length < MIN_OPCOES) {
    return await sock.sendMessage(jid, {
      text: `❌ Preciso de pelo menos *${MIN_OPCOES}* opções para enquete.\n\n\`/enquete pergunta | opção 1 | opção 2\``
    }, { quoted: msg })
  }
  if (opcoes.length > MAX_OPCOES) {
    return await sock.sendMessage(jid, {
      text: `❌ Limite de *${MAX_OPCOES}* opções por enquete (você mandou ${opcoes.length}).\n\nEncurte as opções e tente de novo.`
    }, { quoted: msg })
  }

  // 🔒 Uma enquete por grupo. O registro compartilhado SÓ bloqueia tipos
  // diferentes (o mesmo tipo pode ser re-registrado — é assim que o /forca e
  // o /gartic tratam "já tem jogo meu aqui"), então a própria enquete ativa
  // precisa ser conferida ANTES.
  const atual = obterJogo(jid)
  if (atual && atual.tipo === TIPO_JOGO) {
    const d = atual.dados || {}
    return await sock.sendMessage(jid, {
      text: `🔒 Já tem uma enquete rolando neste grupo!\n\n❓ *${d.pergunta}*\n` +
        d.opcoes.map((o, i) => `${EMOJIS_NUMERO[i]} ${o}`).join('\n') +
        '\n\n🗳️ Vote pelo número ou use /encerrar-enquete para fechar.'
    }, { quoted: msg })
  }

  const registro = registrarJogo(jid, TIPO_JOGO, {})
  if (!registro.ok) {
    return await sock.sendMessage(jid, {
      text: `🔒 Já tem um *${rotuloDoTipo(registro.conflito?.tipo)}* rolando neste grupo. Termine (ou cancele) ele antes.`
    }, { quoted: msg })
  }

  const dados = {
    pergunta,
    opcoes,
    // votos: índice da opção → Set de JIDs (um voto por pessoa)
    votos: new Map(opcoes.map((_, i) => [i, new Set()])),
    autor,
    inicio: Date.now(),
    duracaoMs: DURACAO_ENQUETE_MS,
    timer: null,
    sock
  }
  // registraJogo já criou o registro vazio: agora guardamos os dados reais
  const jogo = obterJogo(jid)
  if (jogo) jogo.dados = dados

  dados.timer = agendar(() => aoExpirar(jid), dados.duracaoMs)
  console.log(`[enquete] 📊 enquete de "${autor}" em ${jid}: "${pergunta}" (${opcoes.length} opções)`)

  return await sock.sendMessage(jid, { text: textoDaEnquete(dados) }, { quoted: msg })
}

// ─── ⏱️ Expirou: apura e anuncia ───
function aoExpirar (jid) {
  try {
    const dados = encerrarEnquete(jid)
    if (!dados || !dados.sock) return
    console.log(`[enquete] ⌛ enquete expirada em ${jid}: ${dados.pergunta}`)
    dados.sock.sendMessage(jid, { text: textoResultado(dados, 'tempo') }).catch(() => {})
  } catch (err) {
    console.error('[enquete] 💥 erro ao encerrar por tempo:', err?.stack || err)
  }
}

// ─── 🏁 Encerramento manual (/encerrar-enquete) ───
async function encerrar (sock, jid, msg, autor) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) {
    return await sock.sendMessage(jid, {
      text: '❌ Não tem nenhuma enquete rolando neste grupo para encerrar.'
    }, { quoted: msg })
  }

  // 🔒 Só quem criou encerra antes da hora (conforme a regra do comando)
  if (jogo.dados?.autor && autor && jogo.dados.autor !== autor) {
    return await sock.sendMessage(jid, {
      text: '🔒 Só quem criou a enquete pode encerrá-la antes da hora.'
    }, { quoted: msg })
  }

  const dados = encerrarEnquete(jid)
  return await sock.sendMessage(jid, { text: textoResultado(dados, 'manual') }, { quoted: msg })
}

// ─── 🗳️ Ouvinte de TEXTO LIVRE — o voto em si ───
// O bot.js entrega toda mensagem SEM prefixo; aqui aceitamos:
//   · o NÚMERO da opção  ("1", "2"...)
//   · o TEXTO da opção    ("Pedro", "Ana")
// Um voto por pessoa: votar de novo TROCA o voto anterior.
async function registrarVoto (sock, jid, msg, texto) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) return false
  const dados = jogo.dados || {}
  const opcoes = dados.opcoes || []
  if (!opcoes.length) return false

  const chute = String(texto || '').trim()
  if (!chute) return false
  const autor = msg?.key?.participant || msg?.key?.remoteJid || ''

  // 1) Número da opção (1..N)
  let indice = -1
  if (/^\d{1,2}$/.test(chute)) {
    const n = Number(chute) - 1
    if (n >= 0 && n < opcoes.length) indice = n
  }

  // 2) Texto exato da opção (ignorando caixa/acento/espaço)
  if (indice === -1) {
    const alvo = normalizar(chute)
    const achado = opcoes.findIndex((o) => normalizar(o) === alvo)
    if (achado >= 0) indice = achado
  }

  // Não é voto válido (número fora da lista ou texto desconhecido) → silêncio
  if (indice === -1) return false

  // 3) Um voto por pessoa: remove o voto anterior antes de contar o novo
  for (const [opcao, conjunto] of dados.votos.entries()) {
    if (conjunto.has(autor)) conjunto.delete(autor)
  }
  dados.votos.get(indice).add(autor)

  const total = [...dados.votos.values()].reduce((soma, s) => soma + s.size, 0)
  console.log(`[enquete] 🗳️ voto de ${autor} na opção ${indice + 1} (${opcoes[indice]}) — total ${total}`)

  // Confirmação curtinha (o resultado completo sai no fim da enquete)
  await sock.sendMessage(jid, {
    text: `🗳️ Voto registrado: *${EMOJIS_NUMERO[indice]} ${opcoes[indice]}*\n_(já votou? Pode mudar o voto a qualquer momento)_`,
    mentions: [autor]
  }).catch(() => {})

  return true
}

// 💬 O ouvinte de texto livre é registrado UMA vez, no carregamento do módulo
registrarOuvinteTexto(TIPO_JOGO, registrarVoto)

// ─── ✂️ Separar pergunta e opções (o separador é o "|") ───
function parse (texto) {
  const bruto = String(texto || '').replace(/^\/\S+\s*/, '')
  const partes = bruto.split('|').map((p) => p.trim()).filter(Boolean)
  if (partes.length < 2) return { pergunta: '', opcoes: [] }
  return { pergunta: partes[0], opcoes: partes.slice(1) }
}

// ---- EXPORTAÇÃO PRINCIPAL (mesmo contrato do loader) ----
// 📦 ARRAY de 2 comandos, como o /acoes faz: o loader percorre cada item do
// array e registra um comando (é assim que /encerrar-enquete entra no bot
// sem precisar de um arquivo só para ele).
const cmdEnquete = {
  nome: 'enquete',
  aliases: ['enquete-opiniao'],
  descricao: 'Enquete de opinião no grupo: /enquete pergunta | opção 1 | opção 2 (voto pelo número, 2 minutos).',

  executar: async function (sock, jid, msg, texto) {
    try {
      const autor = msg.key?.participant || msg.key?.remoteJid
      const bruto = String(texto || '').replace(/^\/\S+\s*/, '').trim()
      const normalizado = normalizar(bruto)

      // /encerrar-enquete escrito dentro do /enquete também funciona
      if (normalizado === 'encerrar-enquete' || normalizado === 'encerrar enquete') {
        return await encerrar(sock, jid, msg, autor)
      }

      const { pergunta, opcoes } = parse(texto)

      if (!pergunta || opcoes.length === 0) {
        // Sem "|" → mostra a ativa (se houver) ou as instruções
        const jogo = obterJogo(jid)
        if (jogo && jogo.tipo === TIPO_JOGO) {
          return await sock.sendMessage(jid, { text: textoDaEnquete(jogo.dados) }, { quoted: msg })
        }
        return await sock.sendMessage(jid, { text: AVISO_USO }, { quoted: msg })
      }

      return await criar(sock, jid, msg, autor, pergunta, opcoes)
    } catch (err) {
      // 🛡️ Nada escapa para o socket
      console.error('[enquete] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, { text: AVISO_ERRO }, { quoted: msg }).catch(() => {})
    }
  }
}

// 🏁 /encerrar-enquete — delega para a MESMA lógica de encerramento
const cmdEncerrar = {
  nome: 'encerrar-enquete',
  descricao: 'Encerra a enquete do grupo antes da hora (só quem criou).',

  executar: async function (sock, jid, msg) {
    try {
      const autor = msg.key?.participant || msg.key?.remoteJid
      return await encerrar(sock, jid, msg, autor)
    } catch (err) {
      console.error('[enquete] 💥 erro no /encerrar-enquete (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, { text: AVISO_ERRO }, { quoted: msg }).catch(() => {})
    }
  }
}

// 🧪 Extras internos para os testes offline (mesmo padrão do /acoes e do
// /desenharpalavra) — anexados aos DOIS itens para dar acesso a partir
// de qualquer um deles.
const EXTRAS = {
  TIPO_JOGO,
  MAX_OPCOES,
  MIN_OPCOES,
  EMOJIS_NUMERO,
  parse,
  apurar,
  textoResultado,
  textoDaEnquete,
  criar,
  aoExpirar,
  encerrar,
  encerrarEnquete,
  registrarVoto,
  _definirDuracao: (ms) => { DURACAO_ENQUETE_MS = Number(ms) > 0 ? Number(ms) : 2 * 60 * 1000 },
  _injetarAgendador: (fnAgendar, fnLimpar) => {
    agendar = fnAgendar || ((fn, ms) => setTimeout(fn, ms))
    if (typeof fnLimpar === 'function') limparTimer = fnLimpar
  },
  _enqueteAtiva: (jid) => {
    const j = obterJogo(jid)
    return j && j.tipo === TIPO_JOGO ? j.dados : null
  }
}

module.exports = [
  Object.assign(cmdEnquete, EXTRAS),
  Object.assign(cmdEncerrar, EXTRAS)
]