const catalogo = require('../../gartic-catalogo')
module.exports = ['add', 'lista', 'remover'].map(acao => ({
  nome: `gartic-${acao}`,
  descricao: `Gerencia o catálogo do Gartic (${acao}, somente dono).`,
  categoria: 'dono',
  async executar(sock, jid, msg, texto) { return catalogo.executar(acao, sock, jid, msg, texto) }
}))
