const arcontes = require('../../dados/arcontes-olimpo')
module.exports = {
  nome: 'kick',
  executar: (...args) => arcontes.executar('kick', ...args)
}
