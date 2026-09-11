// ============================================
// 🗑️ D — Alias de /delete
// ============================================
// Permite invocar o mesmo comando com /d,
// reaproveitando a implementação de delete.js.
// ============================================

const deletar = require("./delete");

module.exports = {
  nome: "d",
  descricao: deletar.descricao,
  executar: deletar.executar
};