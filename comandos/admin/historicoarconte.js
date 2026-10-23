const arcontes = require('../../dados/arcontes-olimpo')
module.exports = { nome: 'historicoarconte', executar: (...args) => arcontes.executar('historicoarconte', ...args) }
