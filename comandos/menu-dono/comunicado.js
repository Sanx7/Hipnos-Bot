const { sistema } = require('../../comunicados')

module.exports = {
  nome: 'comunicado',
  aliases: ['avisogeral', 'broadcast', 'anunciar'],
  categoria: 'dono',
  descricao: 'Envia comunicados oficiais aos grupos após confirmação (somente dono).',
  executar: sistema.executar
}
