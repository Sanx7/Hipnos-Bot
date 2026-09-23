// ============================================
// 📚 PERGUNTAS-QUIZ — Banco de perguntas do /quiz
// ============================================
// Pergunta + 4 alternativas + índice da correta, organizadas por categoria.
// O conteúdo bruto vive nas partes (parte1..parte4) — este módulo monta e
// exporta { PERGUNTAS, CATEGORIAS, sortearPerguntas } pronto p/ uso.
//
// Consumo:
//   const { PERGUNTAS, CATEGORIAS, sortearPerguntas } = require('../../dados/perguntas-quiz')
//   sortearPerguntas(5)                → 5 aleatórias (sem repetir na rodada)
//   sortearPerguntas(5, 'geografia')   → 5 só da categoria (null se inválida)
// Para adicionar perguntas, acrescente linhas "pergunta|A|B|C|D|indice|cat"
// em qualquer parte (índice 0-3, categoria em minúsculas, sem acento).
// ============================================

const partes = [
  require('./perguntas-quiz-parte1'),
  require('./perguntas-quiz-parte2'),
  require('./perguntas-quiz-parte3'),
  require('./perguntas-quiz-parte4')
]

function montarPerguntas() {
  const linhas = partes.join('\n').split(/\r?\n/)
    .map((l) => String(l).trim())
    .filter((l) => l && !l.startsWith('/'))
  const lista = []
  const vistas = new Set()
  for (const linha of linhas) {
    const campos = linha.split('|')
    if (campos.length !== 7) continue
    const pergunta = campos[0].trim()
    const alternativas = campos.slice(1, 5).map((a) => String(a).trim())
    const correta = Number(campos[5].trim())
    const categoria = String(campos[6]).trim().toLowerCase()
    if (!pergunta || alternativas.some((a) => !a)) continue
    if (!Number.isInteger(correta) || correta < 0 || correta > 3) continue
    if (!categoria) continue
    const chave = pergunta.toLowerCase()
    if (vistas.has(chave)) continue
    vistas.add(chave)
    lista.push({ pergunta, alternativas, correta, categoria })
  }
  return lista
}

const PERGUNTAS = montarPerguntas()

const CATEGORIAS = [...new Set(PERGUNTAS.map((p) => p.categoria))].sort()

function normalizarCategoria(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

// Sorteia N perguntas sem repetir na rodada. Com categoria válida, filtra;
// com categoria inválida retorna null (o comando avisa as válidas).
function sortearPerguntas(total, categoria) {
  let banco = PERGUNTAS
  if (categoria) {
    const cat = normalizarCategoria(categoria)
    if (!CATEGORIAS.includes(cat)) return null
    banco = PERGUNTAS.filter((p) => p.categoria === cat)
  }
  const copia = [...banco]
  const sorteadas = []
  while (copia.length > 0 && sorteadas.length < total) {
    const i = Math.floor(Math.random() * copia.length)
    sorteadas.push(copia.splice(i, 1)[0])
  }
  return sorteadas
}

module.exports = { PERGUNTAS, CATEGORIAS, sortearPerguntas, normalizarCategoria }
