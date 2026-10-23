const arcontes = require('../../dados/arcontes-olimpo')
module.exports = { nome: 'listaarcontes', executar: (...args) => arcontes.executar('listaarcontes', ...args) }
