// ============================================================
// 🧠 comparacao-palavras.js — Comparação TOLERANTE de palpites (comum)
// ============================================================
// FONTE ÚNICA de "esses dois textos são a mesma resposta?".
//
// 🌐 Por que um módulo só: o /adivinha-emoji já tinha essa lógica (levenshtein
// + remoção de artigos + similaridade) e o /desenharpalavra precisa da MESMA
// tolerância — sem ela, "rei leao" não bateria com "o rei leão" e o jogo
// ficaria injusto. Extrair aqui é o que o projeto pediu: um lugar para
// ajustar a tolerância, em vez de duas cópias que divergem com o tempo.
//
// ✅ Tolerâncias aceitas (todas do /adivinha-emoji, preservadas):
//   - igual ignorando maiúsculas e acentos        ("O REI LEÃO" = "o rei leão")
//   - pontuação/espaços ignorados                  (" rei  leão!" = "rei leao")
//   - artigos ignorados                            ("rei leão" = "o rei leão")
//   - umaContainda outra, com 4+ letras            ("gato preto" ~ "gato")
//   - erro de digitação pequeno por similaridade  ("rey leao" ~ "rei leão")
//
// ⚠️ O limiar padrão é 0.8 (o mesmo do /adivinha-emoji). Palavras curtas NÃO
// passam por similaridade (ex.: "o" nunca vira "rei") — evita falso positivo
// em respostas de 1-2 letras.
// ============================================================

// 🎯 Limiar de similaridade (0..1) aceito como acerto
const LIMIAR_SIMILARIDADE_PADRAO = 0.8

// 🔤 Normaliza: sem acento, minúsculo, sem sobra nas pontas
function normalizar (texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

// 🚫 Palavras vazias (de, da, o, a...) que não mudam o sentido da resposta
const STOP_WORDS = new Set([
  'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das',
  'e', 'em', 'no', 'na', 'nos', 'nas', 'para', 'pra', 'por', 'com', 'que'
])

function semArtigos (texto) {
  return String(texto || '')
    .split(/\s+/)
    .filter((p) => p && !STOP_WORDS.has(p))
    .join(' ')
}

// 🔢 Só letras e números, sem acento (o que realmente identifica a resposta)
function soAlfaNum (texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

// 📏 Distância de edição (Levenshtein) — quantos caracteres precisam mudar
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

// 📊 Similaridade de 0 (nada a ver) a 1 (idêntico)
function similaridade (a, b) {
  const s = String(a || '')
  const t = String(b || '')
  if (!s && !t) return 1
  if (!s || !t) return 0
  return 1 - levenshtein(s, t) / Math.max(s.length, t.length)
}

// ✅ acertou(palpite, resposta, limiar?): o chute do jogador bate com a
// resposta dentro da tolerância acima? (mesma função do /adivinha-emoji)
function acertou (palpite, resposta, limiar = LIMIAR_SIMILARIDADE_PADRAO) {
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

  if (similaridade(alvoCru, chuteCru) >= limiar) return true
  if (alvoMioloCru && chuteMioloCru && similaridade(alvoMioloCru, chuteMioloCru) >= limiar) return true
  return false
}

module.exports = {
  LIMIAR_SIMILARIDADE_PADRAO,
  normalizar,
  semArtigos,
  soAlfaNum,
  levenshtein,
  similaridade,
  acertou
}