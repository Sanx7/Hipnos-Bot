const arcontes = require('../../dados/arcontes-olimpo')
module.exports = { nome: 'removerarconte', executar: (...args) => arcontes.executar('removerarconte', ...args) }
