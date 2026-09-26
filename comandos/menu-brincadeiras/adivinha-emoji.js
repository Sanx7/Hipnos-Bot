// ============================================================
// 🧩 ADIVINHA-EMOJI — Parte 1/2: sorteio + comparação tolerante
// ============================================================

const CHARADAS_BRUTAS = require('../../dados/emoji-charadas')
const {
  TIPOS,
  rotuloDoTipo,
  registrarOuvinteTexto,
  obterJogo,
  registrarJogo,
  removerJogo
} = require('../../dados/jogos-ativos')

const TIPO_JOGO = TIPOS.ADIVINHA_EMOJI

const DURACAO_PARTIDA_MS = 90 * 1000 // ~90s por rodada
const INTERVALO_DICA_MS = 20 * 1000 // dica a cada ~20s
const LIMIAR_SIMILARIDADE = 0.8 // 80% parecido = acerto

const AVISO_FORA_GRUPO =
  '🧩 *ADIVINHA-EMOJI DO SONHO*\n\n' +
  'Os enigmas só se revelam dentro de um grupo. Use `/adivinha-emoji` num grupo e desafie os mortais.'

const AVISO_SEM_JOGO =
  '❌ Não tem nenhum adivinha-emoji rolando neste grupo. Comece com `/adivinha-emoji`!'

const AVISO_SEM_BANCO =
  '⛔ O pergaminho dos emojis está vazio... tente de novo em instantes.'

const AVISO_ERRO =
  '⛔ As sombras embaralharam os emojis... Tente novamente em instantes.'

let sortear = sortearCharada
let duracaoPartidaMs = DURACAO_PARTIDA_MS
let intervaloDicaMs = INTERVALO_DICA_MS
let agendar = (fn, ms) => setTimeout(fn, ms)
let limparTimer = (id) => clearTimeout(id)

function normalizar (texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function semArtigos (texto) {
  const stop = new Set(['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'no', 'na', 'nos', 'nas', 'para', 'pra', 'por', 'com', 'que'])
  return String(texto || '').split(/\s+/).filter((p) => p && !stop.has(p)).join(' ')
}

function soAlfaNum (texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function levenshtein (a, b) {
  const s = String(a || '')
  const t = String(b || '')
  if (s === t) return 0
  if (!s.length) return t.length
  if (!t.length) return s.length
  let prev = new Array(t.length + 1)
  let curr = new Array(t.length + 1)
  for (let j = 0; j <= t.length; j++) prev[j] = j
  for (let i = 1; i <= s.length; i++) {
    curr[0] = i
    for (let j = 1; j <= t.length; j++) {
      const custo = s[i - 1] === t[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + custo)
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[t.length]
}

function similaridade (a, b) {
  const s = String(a || '')
  const t = String(b || '')
  if (!s && !t) return 1
  if (!s || !t) return 0
  const dist = levenshtein(s, t)
  return 1 - dist / Math.max(s.length, t.length)
}

function charadaValida (item) {
  return item &&
    typeof item.emojis === 'string' && item.emojis.trim() &&
    typeof item.resposta === 'string' && item.resposta.trim()
}

function sortearCharada () {
  const pool = (Array.isArray(CHARADAS_BRUTAS) ? CHARADAS_BRUTAS : []).filter(charadaValida)
  if (!pool.length) return null
  return pool[Math.floor(Math.random() * pool.length)]
}

function acertou (palpite, resposta) {
  const alvo = normalizar(resposta)
  const chute = normalizar(palpite)
  if (!alvo || !chute) return false
  if (chute === alvo) return true
  const alvoCru = soAlfaNum(alvo)
  const chuteCru = soAlfaNum(chute)
  if (!alvoCru || !chuteCru) return false
  if (chuteCru === alvoCru) return true
  const alvoMioloCru = soAlfaNum(semArtigos(alvo))
  const chuteMioloCru = soAlfaNum(semArtigos(chute))
  if (alvoMioloCru && alvoMioloCru === chuteMioloCru) return true
  if (alvoMioloCru.length >= 4 && chuteMioloCru.length >= 4) {
    if (alvoMioloCru.includes(chuteMioloCru) || chuteMioloCru.includes(alvoMioloCru)) return true
  }
  if (similaridade(alvoCru, chuteCru) >= LIMIAR_SIMILARIDADE) return true
  if (alvoMioloCru && chuteMioloCru && similaridade(alvoMioloCru, chuteMioloCru) >= LIMIAR_SIMILARIDADE) return true
  return false
}

function mascararResposta (resposta, reveladas) {
  return String(resposta || '').split('').map((ch) => {
    if (ch === ' ') return ' '
    if (!/[a-z0-9]/i.test(soAlfaNum(ch))) return ch
    return reveladas.has(soAlfaNum(ch)) ? ch : '_'
  }).join('')
}

function proximaLetraParaRevelar (resposta, reveladas) {
  const norm = normalizar(resposta)
  for (const ch of norm) {
    const chave = soAlfaNum(ch)
    if (/[a-z0-9]/.test(chave) && !reveladas.has(chave)) return chave
  }
  return null
}

function montarDica (dados) {
  const banco = Array.isArray(dados.charada?.dicas) ? dados.charada.dicas.filter((d) => typeof d === 'string' && d.trim()) : []
  if (dados.dicasDadas < banco.length) {
    const dica = String(banco[dados.dicasDadas]).trim()
    dados.dicasDadas += 1
    return '💡 *DICA:* ' + dica
  }
  const letra = proximaLetraParaRevelar(dados.charada.resposta, dados.reveladas)
  if (letra) {
    dados.reveladas.add(letra)
    return '🔤 *DICA:* ' + mascararResposta(dados.charada.resposta, dados.reveladas)
  }
  return null
}

function montarEnigma (charada, segundos) {
  return '🧩 *ADIVINHA-EMOJI* 🧩\n\n' +
    `${charada.emojis}\n\n` +
    'Que filme, expressão ou frase é essa? Escreva a resposta aqui no grupo!\n' +
    `⏳ ~${segundos}s para alguém acertar (dica a cada ~${Math.round(intervaloDicaMs / 1000)}s).\n\n` +
    '🏳️ `/adivinha-emoji desistir` encerra revelando.'
}

// ─── Parte 2/3: rodada (iniciar + timers de dica) ───
function encerrarRodada (jid) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) return null
  if (jogo.dados?.timerFim) limparTimer(jogo.dados.timerFim)
  if (jogo.dados?.timerDica) limparTimer(jogo.dados.timerDica)
  removerJogo(jid, TIPO_JOGO)
  return jogo.dados || null
}

async function iniciar (sock, jid, msg, autor) {
  if (!String(jid || '').endsWith('@g.us')) {
    return await sock.sendMessage(jid, { text: AVISO_FORA_GRUPO }, { quoted: msg })
  }
  const ativo = obterJogo(jid)
  if (ativo && ativo.tipo === TIPO_JOGO) {
    const dados = ativo.dados || {}
    const fim = Number(dados.inicio || 0) + Number(dados.duracaoMs || duracaoPartidaMs)
    const restanteSeg = Math.max(0, Math.ceil((fim - Date.now()) / 1000))
    return await sock.sendMessage(jid, {
      text: '🧩 *JÁ TEM UM ADIVINHA-EMOJI ROLANDO NESTE GRUPO!*\n\n' +
        `${dados.charada?.emojis || ''}\n` +
        `⏳ ~${restanteSeg}s restantes.\n\n` +
        '💡 Escreva a resposta aqui no grupo ou use `/adivinha-emoji desistir`.'
    }, { quoted: msg })
  }
  if (ativo) {
    return await sock.sendMessage(jid, {
      text: `🔒 Já tem um *${rotuloDoTipo(ativo.tipo)}* rolando neste grupo. Termine (ou cancele) ele antes de abrir um adivinha-emoji.`
    }, { quoted: msg })
  }
  const charada = sortear()
  if (!charada) {
    return await sock.sendMessage(jid, { text: AVISO_SEM_BANCO }, { quoted: msg })
  }
  const dados = {
    charada, autor, inicio: Date.now(), duracaoMs: duracaoPartidaMs,
    dicasDadas: 0, reveladas: new Set(), timerFim: null, timerDica: null, sock
  }
  const registro = registrarJogo(jid, TIPO_JOGO, dados)
  if (!registro.ok) {
    return await sock.sendMessage(jid, {
      text: `🔒 Já tem um *${rotuloDoTipo(registro.conflito?.tipo)}* rolando neste grupo.`
    }, { quoted: msg })
  }
  dados.timerFim = agendar(() => aoExpirar(jid), dados.duracaoMs)
  agendarDica(jid)
  console.log(`[adivinha-emoji] nova rodada em ${jid}: ${charada.resposta}`)
  const segundos = Math.round(dados.duracaoMs / 1000) || 90
  return await sock.sendMessage(jid, { text: montarEnigma(charada, segundos) }, { quoted: msg })
}

function agendarDica (jid) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) return
  const dados = jogo.dados
  if (dados.timerDica) limparTimer(dados.timerDica)
  dados.timerDica = agendar(() => aoRevelarDica(jid), intervaloDicaMs)
}

async function aoRevelarDica (jid) {
  try {
    const jogo = obterJogo(jid)
    if (!jogo || jogo.tipo !== TIPO_JOGO || !jogo.dados?.sock) return
    const dados = jogo.dados
    const texto = montarDica(dados)
    if (texto) {
      await dados.sock.sendMessage(jid, {
        text: `${texto}\n\n${dados.charada.emojis}\n\n💬 Continue chutando aqui no grupo!`
      }).catch(() => {})
    }
    agendarDica(jid)
  } catch (err) {
    console.error('[adivinha-emoji] erro ao revelar dica:', err?.stack || err)
  }
}

// ─── Parte 3/3: expiração + palpite livre + saída ───
async function aoExpirar (jid) {
  try {
    const dados = encerrarRodada(jid)
    if (!dados || !dados.sock) return
    console.log(`[adivinha-emoji] expirada em ${jid}: ${dados.charada?.resposta}`)
    await dados.sock.sendMessage(jid, {
      text: '⌛ *TEMPO ESGOTADO!* Ninguém acertou dessa vez...\n\n' +
        `🧩 A resposta era: *${dados.charada.resposta}*\n\n` +
        '🌙 Digite `/adivinha-emoji` para uma nova rodada!'
    }).catch(() => {})
  } catch (err) {
    console.error('[adivinha-emoji] erro ao encerrar por tempo:', err?.stack || err)
  }
}

async function aoReceberPalpite (sock, jid, msg, texto, dados) {
  const jogo = obterJogo(jid)
  const estado = dados || jogo?.dados
  if (!jogo || jogo.tipo !== TIPO_JOGO || !estado?.charada) return false
  const chute = normalizar(texto)
  if (!chute || chute.length < 2) return false
  if (!acertou(chute, estado.charada.resposta)) return false
  const autor = msg.key?.participant || msg.key?.remoteJid || ''
  const resposta = estado.charada.resposta
  encerrarRodada(jid)
  console.log(`[adivinha-emoji] acerto em ${jid}: ${resposta} por ${autor}`)
  await sock.sendMessage(jid, {
    text: `🏆 *ACERTOU!* @${String(autor).split('@')[0]} desvendou os emojis!\n\n` +
      `🧩 A resposta era: *${resposta}*\n\n` +
      '🌙 Digite `/adivinha-emoji` para uma nova rodada!',
    mentions: [autor]
  }, { quoted: msg })
  return true
}

async function desistir (sock, jid, msg) {
  const dados = encerrarRodada(jid)
  if (!dados) {
    return await sock.sendMessage(jid, { text: AVISO_SEM_JOGO }, { quoted: msg })
  }
  return await sock.sendMessage(jid, {
    text: `🏳️ Rodada encerrada. A resposta era: *${dados.charada.resposta}*\n\n` +
      '🌙 Digite `/adivinha-emoji` para jogar de novo!'
  }, { quoted: msg })
}

registrarOuvinteTexto(TIPO_JOGO, aoReceberPalpite)

module.exports = {
  nome: 'adivinha-emoji',
  aliases: ['emojiadivinha', 'adivinheemoji'],
  descricao: 'Adivinhe o filme, expressão ou frase pelos emojis — quem acertar primeiro vence (um jogo por grupo, ~90s por rodada).',
  executar: async function (sock, jid, msg, texto) {
    try {
      const resto = String(texto || '').replace(/^\/\S+\s*/, '').trim()
      const normalizado = normalizar(resto)
      if (normalizado === 'desistir' || normalizado === 'cancelar' || normalizado === 'parar') {
        return await desistir(sock, jid, msg)
      }
      const autor = msg.key?.participant || msg.key?.remoteJid
      return await iniciar(sock, jid, msg, autor)
    } catch (err) {
      console.error('[adivinha-emoji] erro:', err?.stack || err)
      await sock.sendMessage(jid, { text: AVISO_ERRO }, { quoted: msg }).catch(() => {})
    }
  },
  TIPO_JOGO, DURACAO_PARTIDA_MS, INTERVALO_DICA_MS, LIMIAR_SIMILARIDADE,
  normalizar, levenshtein, similaridade, acertou, mascararResposta,
  montarDica, montarEnigma, sortearCharada,
  aoReceberPalpite, aoRevelarDica, aoExpirar, encerrarRodada,
  _injetarSorteio: (fn) => { sortear = fn || sortearCharada },
  _definirDuracao: (ms) => { duracaoPartidaMs = Number(ms) > 0 ? Number(ms) : DURACAO_PARTIDA_MS },
  _definirIntervaloDica: (ms) => { intervaloDicaMs = Number(ms) > 0 ? Number(ms) : INTERVALO_DICA_MS },
  _injetarAgendador: (fnAgendar, fnLimpar) => {
    agendar = fnAgendar || ((fn, ms) => setTimeout(fn, ms))
    if (typeof fnLimpar === 'function') limparTimer = fnLimpar
  }
}
