// ============================================
// 🪙 FLIP — Alias de /moeda
// ============================================
// Permite invocar o mesmo comando com /flip,
// reaproveitando a implementação de moeda.js.
// ============================================

const moeda = require('./moeda')

module.exports = {
  nome: 'flip',
  descricao: moeda.descricao,
  executar: moeda.executar
}