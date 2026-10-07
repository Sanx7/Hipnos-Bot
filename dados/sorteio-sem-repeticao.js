// Um índice por grupo; sorteio uniforme entre todas as opções exceto a última.
module.exports = function criarSorteio(lista) {
  const ultimas = new Map()
  return {
    sortear(jid) {
      const anterior = ultimas.get(jid)
      let indice = Math.floor(Math.random() * (lista.length - (anterior === undefined ? 0 : 1)))
      if (anterior !== undefined && indice >= anterior) indice++
      ultimas.set(jid, indice)
      return lista[indice]
    },
    limpar: () => ultimas.clear()
  }
}
