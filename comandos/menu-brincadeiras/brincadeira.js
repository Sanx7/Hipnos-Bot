// ============================================
// 🎲 BRINCADEIRA — Alias de /menu-brincadeiras
// ============================================
// Permite invocar o mesmo comando com /brincadeira,
// reaproveitando a implementação de menu-brincadeiras.js.
// ============================================

const menuBrincadeiras = require('./menu-brincadeiras')

module.exports = {
  nome: 'brincadeira',
  descricao: menuBrincadeiras.descricao,
  executar: menuBrincadeiras.executar
}