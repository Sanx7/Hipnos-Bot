// ============================================================
// 🏛️ ENQUETE-ADMIN — VOTAÇÃO DE DECISÃO do grupo (só admin)
// ============================================================
//   /enquete-admin pergunta | opção 1 | opção 2 | ...
//   /enquete-admin-ban @alvo | sim | não   → vota o BAN do alvo
//   /encerrar-enquete                → encerra antes (só admin)
//
// 🏛️ DIFERENTE DO /enquete: aquela é OPINIÃO e qualquer membro abre; esta é
//    DECISÃO (banir alguém, mudar regra, aprovar algo) e SÓ ADMIN abre —
//    mesmo padrão do /ban (isAdmin + metadados do grupo).
//
// 🗳️ VOTAÇÃO: texto livre no grupo, respondendo o NÚMERO da opção
//    (mesmo gancho do /gartic, /anagrama, /quiz, /enquete). Um voto por
//    pessoa e pode trocar; o voto é contado pelo NÚMERO REAL (lid.js —
//    quem vota chega como "@lid" em grupos com LID ligado).
//
// ⏱️ DURAÇÃO: 2 minutos (constante abaixo) ou até /encerrar-enquete.
// 🔒 Uma decisão por grupo, no registro COMPARTILHADO (dados/jogos-ativos.js):
//    bloqueia com /velha, /anagrama, /gartic, /quiz, /forca, /enquete,
//    /desenharpalavra e /adivinha-emoji, e não convive com outro jogo.
//
// ☠️ AÇÃO ESPECIAL — VOTAÇÃO DE BAN:
//    /enquete-admin-ban @alvo | sim | não
//    (ou a pergunta começando com "banir", com @alvo na mensagem)
//    Se a opção do SIM vencer, o bot bane sozinho ao final, REUSANDO a
//    função banirDoGrupo do /ban — mesma blacklist e mesmas proteções:
//    dono do bot (ehDonoDoBot) e o próprio bot. Nenhuma decisão de ban
//    acontece se houver empate, se o SIM não vencer ou se o alvo for
//    protegido. É uma sugestão que o grupo VOTA — o Modular só executa
//    o que a maioria aprovou.
// ============================================================

const { ehDonoDoBot, ehAdminDoGrupo, limparNumero } = require('../../config')
const { resolverNumeroAlvo } = require('../../lid')
const { TIPOS, rotuloDoTipo, registrarJogo, removerJogo, obterJogo, registrarOuvinteTexto } = require('../../dados/jogos-ativos')
// ♻️ A punição é a MESMA do /ban: grava na blacklist e remove do grupo
const { banirDoGrupo } = require('../admin/ban')
const { ehProprioBot, respostaAutoexpulsao } = require('../../dados/protecao-bot')

const TIPO_JOGO = TIPOS.ENQUETE_ADMIN
const DURACAO_ENQUETE_MS = 2 * 60 * 1000 // ⏱️ 2 minutos
const MAX_OPCOES = 6
const MIN_OPCOES = 2
const EMOJIS_NUMERO = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣']

// ─── ✉️ Mensagens ───
const AVISO_SEM_ADMIN = '🏛️ *Só administradores do grupo podem abrir uma votação de decisão.*'
const AVISO_SEM_ENQUETE = '❌ Não tem nenhuma enquete de decisão rolando neste grupo.'
const AVISO_ERRO = '⛔ A votação se desfez nas sombras... Tente novamente em instantes.'
const AVISO_USO =
  '🏛️ *ENQUETE-ADMIN — votação de decisão*\n\n' +
  '`/enquete-admin pergunta | opção 1 | opção 2`\n\n' +
  'Ex.: `/enquete-admin Mudar a regra do grupo? | Mudar | Deixar como está`\n\n' +
  `ℹ️ Só admin abre. De ${MIN_OPCOES} a ${MAX_OPCOES} opções, 2 minutos.\n` +
  '🗳️ Para votar, mande o NÚMERO da opção no chat. /encerrar-enquete fecha antes.'

// ─── 📋 Estado (ganchos p/ testes offline) ───
let agendar = (fn, ms) => setTimeout(fn, ms)
let limparTimer = (id) => clearTimeout(id)

// ─── 🔓 Encerra ───
function encerrarEnquete (jid) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) return null
  const dados = jogo.dados || {}
  if (dados.timer) { limparTimer(dados.timer); dados.timer = null }
  removerJogo(jid, TIPO_JOGO)
  return dados
}

// ─── 🗳️ Resolve quem votou para o NÚMERO REAL (lid.js) ───
// Sem isso, quem vota num grupo com LID ligado contaria como "@lid" e
// poderia "votar duas vezes" (uma como LID, outra como número).
async function numeroRealDe (participantes, jid) {
  try {
    const { numero, via } = await resolverNumeroAlvo(participantes, jid)
    return numero || limparNumero(jid)
  } catch (err) {
    console.error('[enquete-admin] falha ao resolver LID do votante:', err?.message || err)
    return limparNumero(jid)
  }
}

// ─── 📊 Apura o resultado ───
function apurar (dados) {
  const contagem = dados.opcoes.map((texto, i) => ({
    indice: i, texto, votos: (dados.votos.get(i) || new Set()).size
  }))
  const total = contagem.reduce((s, c) => s + c.votos, 0)
  if (!total) return { contagem, total, vencedoras: [], empate: false, semVotos: true }
  const maximo = Math.max(...contagem.map((c) => c.votos))
  const vencedoras = contagem.filter((c) => c.votos === maximo)
  return { contagem, total, maximo, vencedoras, empate: vencedoras.length > 1, semVotos: false }
}

// ─── ⌂️ Parse: pergunta + opções ───
function parse (texto) {
  const bruto = String(texto || '').replace(/^\/\S+\s*/, '')
  const partes = bruto.split('|').map((p) => p.trim()).filter(Boolean)
  if (partes.length < 2) return { pergunta: '', opcoes: [] }
  return { pergunta: partes[0], opcoes: partes.slice(1) }
}

// ─── ☠️ A pergunta é de BAN? (para o kick automático) ───
function ehVotacaoDeBan (dados) {
  if (dados.alvoBan) return true
  return /^banir|banner|expulsar/i.test(String(dados.pergunta || ''))
}

// ─── 🥇 Índice da opção "sim" (a que dispara o ban) ───
function indiceDoSim (dados) {
  const achado = dados.opcoes.findIndex((o) => /^(sim|s|ban|banir|expulsar|aprovar)$/i.test(String(o).trim()))
  return achado
}

// ─── 📤 Texto da enquete ───
function textoDaEnquete (dados) {
  const minutos = Math.max(1, Math.round(dados.duracaoMs / 60000))
  const linhas = [`🏛️ *VOTAÇÃO DE DECISÃO*\n\n❓ *${dados.pergunta}*\n`]
  dados.opcoes.forEach((o, i) => linhas.push(`${EMOJIS_NUMERO[i]} ${o}`))
  linhas.push(
    '\n🗳️ *Vote mandando o NÚMERO da opção aqui no chat.*' +
    `\n⏱️ Fecha em ~${minutos} minuto(s) ou antes, com /encerrar-enquete.` +
    `\n🏛️ Abriu: @${String(dados.autor).split('@')[0]}`
  )
  if (dados.alvoBan) linhas.push(`\n☠️ Atenção: se o SIM vencer, @${limparNumero(dados.alvoBan)} é removido e vai para a blacklist.`)
  return linhas.join('\n')
}

// ─── 📊 Texto do resultado (com aviso de decisão pendente) ───
function textoResultado (dados, motivo) {
  const r = apurar(dados)
  const linhas = [
    motivo === 'tempo' ? '⏱️ *VOTAÇÃO ENCERRADA (tempo esgotado)*' : '🏁 *VOTAÇÃO ENCERRADA*',
    `📊 *${dados.pergunta}*\n`
  ]
  for (const c of r.contagem) {
    const barra = '█'.repeat(c.votos).padEnd(r.total, '░')
    linhas.push(`${EMOJIS_NUMERO[c.indice]} ${c.texto} — *${c.votos}* voto(s) \`${barra}\``)
  }
  linhas.push(`\n🗳️ Total: *${r.total}** voto(s)`)

  if (r.semVotos) {
    linhas.push('\n🌙 Ninguém votou. Nada foi decidido.')
    return linhas.join('\n')
  }
  if (r.empate) {
    linhas.push(`\n🤝 *EMPATE!* Empataram: *${r.vencedoras.map((c) => c.texto).join(' e ')}* (${r.maximo} voto(s) cada).`)
    linhas.push('\n⚖️ Empate não decide nada: o grupo precisa votar de novo.')
    return linhas.join('\n')
  }
  linhas.push(`\n🏆 *VENCEU:* ${r.vencedoras[0].texto} (${r.vencedoras[0].votos} voto(s))`)
  return linhas.join('\n')
}

// ─── ☠️ Executa a decisão de BAN (só se o SIM ganhou sem empate) ───
async function aplicarBanSeVenceu (sock, jid, dados) {
  if (!ehVotacaoDeBan(dados) || !dados.alvoBan) return null
  const r = apurar(dados)

  // Empate ou ninguém votou → não decide, não bane
  if (r.semVotos || r.empate) {
    return { executado: false, motivo: r.semVotos ? 'sem-votos' : 'empate' }
  }

  const sim = indiceDoSim(dados)
  // A opção vencedora precisa ser a do "sim"/"banir"
  if (sim !== -1 && r.vencedoras[0].indice !== sim) {
    return { executado: false, motivo: 'sim-perdeu' }
  }

  // 🛡️ Proteções IGUAIS às do /ban (nada é gravado/removido antes)
  let metadados = null
  try { metadados = await sock.groupMetadata(jid) } catch (e) { /* segue */ }
  if (metadados && ehDonoDoBot(metadados.participants, dados.alvoBan)) {
    return { executado: false, motivo: 'alvo-dono' }
  }
  try {
    if (await ehProprioBot(sock, jid, dados.alvoBan, metadados?.participants)) {
      return { executado: false, motivo: 'alvo-e-o-bot' }
    }
    await banirDoGrupo(sock, jid, dados.alvoBan)
    return { executado: true, numero: limparNumero(dados.alvoBan) }
  } catch (err) {
    console.error('[enquete-admin] falha ao banir o vencedor:', err?.message || err)
    return { executado: false, motivo: 'falha-ban' }
  }
}

// ─── 📤 Resultado + linha da decisão de ban (se houver) ───
async function anunciarResultado (sock, jid, dados, motivo) {
  await sock.sendMessage(jid, { text: textoResultado(dados, motivo) }).catch(() => {})
  if (!ehVotacaoDeBan(dados) || !dados.alvoBan) return

  const r = apurar(dados)
  const sim = indiceDoSim(dados)
  // O "sim" ganhou? (e houve decisão)
  const simVenceu = !r.semVotos && !r.empate && (sim === -1 || r.vencedoras[0].indice === sim)
  if (!simVenceu) {
    await sock.sendMessage(jid, { text: '🛡️ O SIM não venceu: **ninguém foi banido**.' }).catch(() => {})
    return
  }
  const b = await aplicarBanSeVenceu(sock, jid, dados)
  if (b.executado) {
    await sock.sendMessage(jid, { text: `☠️ *Decisão executada:* @${b.numero} foi removido do grupo e entrou na blacklist.` }).catch(() => {})
  } else {
    if (b.motivo === 'alvo-e-o-bot') {
      await sock.sendMessage(jid, { text: respostaAutoexpulsao() }).catch(() => {})
      return
    }
    const motivo = { 'sim-perdeu': 'o SIM não venceu', empate: 'empate', 'sem-votos': 'ninguém votou', 'alvo-dono': 'o alvo é dono do bot', 'alvo-e-o-bot': 'o alvo é o próprio bot', 'falha-ban': 'o WhatsApp recusou (o bot precisa ser admin)' }[b.motivo] || b.motivo
    await sock.sendMessage(jid, { text: `🛡️ *Ban não executado:* ${motivo}.` }).catch(() => {})
  }
}

// ─── 🏛️ Cria a votação (só admin) ───
async function criar (sock, jid, msg, autor, pergunta, opcoes, alvoBan = null) {
  if (!String(jid || '').endsWith('@g.us')) {
    return await sock.sendMessage(jid, { text: '🏛️ A decisão é tomada em grupo. Use lá dentro.' }, { quoted: msg })
  }

  // 1) Somente ADMIN abre votação de decisão (mesmo padrão do /ban)
  let metadados = null
  try { metadados = await sock.groupMetadata(jid) } catch (e) { /* segue */ }
  const participantes = metadados?.participants || []
  if (!ehAdminDoGrupo(participantes, autor) && !ehDonoDoBot(participantes, autor)) {
    return await sock.sendMessage(jid, { text: AVISO_SEM_ADMIN }, { quoted: msg })
  }
  if (alvoBan && await ehProprioBot(sock, jid, alvoBan, participantes)) {
    return await sock.sendMessage(jid, { text: respostaAutoexpulsao() }, { quoted: msg })
  }

  if (opcoes.length < MIN_OPCOES) {
    return await sock.sendMessage(jid, { text: `❌ Preciso de pelo menos *${MIN_OPCOES}* opções.\n\n\`/enquete-admin pergunta | opção 1 | opção 2\`` }, { quoted: msg })
  }
  if (opcoes.length > MAX_OPCOES) {
    return await sock.sendMessage(jid, { text: `❌ Limite de *${MAX_OPCOES}* opções (você mandou ${opcoes.length}).` }, { quoted: msg })
  }

  // 2) Uma por grupo: confere a própria (o registro só bloqueia tipos diferentes)
  const atual = obterJogo(jid)
  if (atual && atual.tipo === TIPO_JOGO) {
    return await sock.sendMessage(jid, { text: '🔒 Já tem uma votação de decisão rolando neste grupo! Vote ou use /encerrar-enquete.' }, { quoted: msg })
  }

  const dados = {
    pergunta, opcoes, alvoBan: alvoBan || null,
    votos: new Map(opcoes.map((_, i) => [i, new Set()])),
    autor, inicio: Date.now(), duracaoMs: DURACAO_ENQUETE_MS, timer: null, sock
  }
  const registro = registrarJogo(jid, TIPO_JOGO, dados)
  if (!registro.ok) {
    return await sock.sendMessage(jid, { text: `🔒 Já tem um *${rotuloDoTipo(registro.conflito?.tipo)}* rolando neste grupo. Termine (ou cancele) ele antes.` }, { quoted: msg })
  }

  dados.timer = agendar(() => aoExpirar(jid), dados.duracaoMs)
  console.log(`[enquete-admin] 🏛️ votação de "${autor}" em ${jid}: "${pergunta}"${alvoBan ? ` (ban de ${alvoBan})` : ''}`)
  return await sock.sendMessage(jid, { text: textoDaEnquete(dados) }, { quoted: msg })
}

// ─── ⏱️ Expirou ───
function aoExpirar (jid) {
  const dados = encerrarEnquete(jid)
  if (!dados || !dados.sock) return
  console.log(`[enquete-admin] ⌛ votação expirada em ${jid}: ${dados.pergunta}`)
  anunciarResultado(dados.sock, jid, dados, 'tempo').catch(() => {})
}

// ─── 🏁 Encerramento manual (só admin) ───
async function encerrarManual (sock, jid, msg, autor) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) {
    return await sock.sendMessage(jid, { text: AVISO_SEM_ENQUETE }, { quoted: msg })
  }
  let metadados = null
  try { metadados = await sock.groupMetadata(jid) } catch (e) { /* segue */ }
  const participantes = metadados?.participants || []
  if (!ehAdminDoGrupo(participantes, autor) && !ehDonoDoBot(participantes, autor)) {
    return await sock.sendMessage(jid, { text: AVISO_SEM_ADMIN }, { quoted: msg })
  }
  const dados = encerrarEnquete(jid)
  return await anunciarResultado(sock, jid, dados, 'manual')
}

// ─── 🗳️ Ouvinte de TEXTO LIVRE (o voto) ───
async function registrarVoto (sock, jid, msg, texto) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) return false
  const dados = jogo.dados || {}
  const chute = String(texto || '').trim()
  if (!chute) return false

  // Só NÚMERO conta na decisão (mais seguro: nada de o bot ler uma frase
  // inteira como voto).
  if (!/^\d{1,2}$/.test(chute)) return false
  const n = Number(chute) - 1
  if (n < 0 || n >= dados.opcoes.length) return false

  // 🪪 Vota pelo NÚMERO REAL (lid.js) — senão a mesma pessoa contaria 2x
  // (uma como "@lid" e outra como número).
  const autorJid = msg?.key?.participant || msg?.key?.remoteJid || ''
  let participantes = null
  try { participantes = (await sock.groupMetadata(jid))?.participants || null } catch (e) { /* segue */ }
  const numero = await numeroRealDe(participantes, autorJid)

  for (const conjunto of dados.votos.values()) conjunto.delete(numero)
  dados.votos.get(n).add(numero)

  const total = [...dados.votos.values()].reduce((s, c) => s + c.size, 0)
  console.log(`[enquete-admin] 🗳️ voto de ${numero} (opção ${n + 1}) — total ${total}`)
  await sock.sendMessage(jid, { text: `🗳️ Voto registrado: *${EMOJIS_NUMERO[n]} ${dados.opcoes[n]}* _(pode mudar o voto)_` }).catch(() => {})
  return true
}

registrarOuvinteTexto(TIPO_JOGO, registrarVoto)

// ─── ☠️ Votação de BAN: /enquete-admin-ban @alvo | sim | não ───
async function abrirVotacaoDeBan (sock, jid, msg, texto) {
  const contexto = msg.message?.extendedTextMessage?.contextInfo
  const alvo = contexto?.mentionedJid?.[0] || contexto?.participant
  if (!alvo) {
    return await sock.sendMessage(jid, { text: '☠️ *Marque quem está em julgamento:*\n\n`/enquete-admin-ban @fulano | sim | não`' }, { quoted: msg })
  }
  const { opcoes } = parse(texto)
  if (opcoes.length < MIN_OPCOES) {
    return await sock.sendMessage(jid, { text: '❌ Formato: `/enquete-admin-ban @fulano | sim | não`' }, { quoted: msg })
  }
  const autor = msg.key?.participant || msg.key?.remoteJid
  return await criar(sock, jid, msg, autor, 'Banir o marcado?', opcoes, alvo)
}

// ---- EXPORTAÇÃO (array: /enquete-admin + /encerrar-enquete) ----
const cmdEnqueteAdmin = {
  nome: 'enquete-admin',
  descricao: 'Votação de DECISÃO do grupo (só admin): /enquete-admin pergunta | opção 1 | opção 2 (2 min).',
  aliases: ['votacao'],

  executar: async function (sock, jid, msg, texto) {
    try {
      const autor = msg.key?.participant || msg.key?.remoteJid
      const cru = String(texto || '')
      const bruto = cru.replace(/^\/\S+\s*/, '').trim()

      // ☠️ /enquete-admin-ban @alvo | sim | não  (ou /banir @alvo | sim | não)
      //    Precisa ser testado no texto CRU: o nome do comando é removido
      //    logo abaixo, então "enquete-admin-ban" já não existiria em "bruto".
      if (/enquete-?admin-?ban|^\/?\s*banir\b/i.test(cru)) {
        return await abrirVotacaoDeBan(sock, jid, msg, cru)
      }

      const { pergunta, opcoes } = parse(cru)
      if (!pergunta || opcoes.length === 0) {
        const jogo = obterJogo(jid)
        if (jogo && jogo.tipo === TIPO_JOGO) {
          return await sock.sendMessage(jid, { text: textoDaEnquete(jogo.dados) }, { quoted: msg })
        }
        return await sock.sendMessage(jid, { text: AVISO_USO }, { quoted: msg })
      }
      return await criar(sock, jid, msg, autor, pergunta, opcoes)
    } catch (err) {
      console.error('[enquete-admin] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, { text: AVISO_ERRO }, { quoted: msg }).catch(() => {})
    }
  }
}

const cmdEncerrar = {
  nome: 'encerrar-enquete',
  descricao: 'Encerra a votação de decisão do grupo antes da hora (só admin).',

  executar: async function (sock, jid, msg) {
    try {
      const autor = msg.key?.participant || msg.key?.remoteJid
      return await encerrarManual(sock, jid, msg, autor)
    } catch (err) {
      console.error('[enquete-admin] 💥 erro no /encerrar-enquete (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, { text: AVISO_ERRO }, { quoted: msg }).catch(() => {})
    }
  }
}

// 🧪 Extras internos para os testes offline
const EXTRAS = {
  TIPO_JOGO, MAX_OPCOES, MIN_OPCOES, EMOJIS_NUMERO,
  parse, apurar, textoResultado, textoDaEnquete, criar, aoExpirar,
  encerrarManual, encerrarEnquete, registrarVoto, abrirVotacaoDeBan,
  aplicarBanSeVenceu, anunciarResultado, ehVotacaoDeBan, indiceDoSim, numeroRealDe,
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
  Object.assign(cmdEnqueteAdmin, EXTRAS),
  Object.assign(cmdEncerrar, EXTRAS)
]
