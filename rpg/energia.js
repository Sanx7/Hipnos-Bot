const { erro } = require('./identidade')
const { RECUPERACAO_ENERGIA_MS } = require('./empregos-catalogo')
function inteiro(valor, padrao = 0) {
  const n = valor === undefined ? padrao : valor
  if (!Number.isSafeInteger(n) || n < 0) throw erro('progresso_incompativel')
  return n
}
function consumirEnergia(p, custo, tempo, referenciaAlternativa) {
  const base = inteiro(p.energia, 100)
  if (base > 100) throw erro('progresso_incompativel')
  const referencia = p.energiaAtualizadaEm ?? referenciaAlternativa
  if (referencia === undefined && base < custo) throw erro('energia_sem_referencia')
  const em = inteiro(referencia, tempo)
  if (em > tempo) throw erro('progresso_incompativel')
  const recuperados = Math.floor((tempo - em) / RECUPERACAO_ENERGIA_MS)
  const disponivel = Math.min(100, base + recuperados)
  if (disponivel < custo) throw erro('energia_insuficiente')
  return { energia: disponivel - custo,
    energiaAtualizadaEm: disponivel === 100 ? tempo : em + recuperados * RECUPERACAO_ENERGIA_MS }
}
module.exports = { inteiro, consumirEnergia }
