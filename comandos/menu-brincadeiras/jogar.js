// ============================================
// ❌⭕ JOGAR — Marca uma casa na partida de /velha
// ============================================
// Reusa a função `jogar` de velha.js (mesmo padrão de brincadeira.js ->
// menu-brincadeiras.js): o estado da partida vive no módulo compartilhado por
// velha.js, e este comando apenas expõe a jogada com outro nome.
// ============================================

const velha = require('./velha')

module.exports = {
  nome: 'jogar',
  aliases: ['marcar', 'jugar'],
  descricao: 'Marca uma posição 1-9 do tabuleiro da partida de /velha em curso (teclado numérico).',
  executar: velha.jogar || velha.jugar
}