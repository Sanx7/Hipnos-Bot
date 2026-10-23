const arcontes = require('../../dados/arcontes-olimpo')
module.exports = { nome: 'arconte', executar: (...args) => arcontes.executar('arconte', ...args) }
