const rodadas = require('../../dados/vouc-rodadas')

module.exports = {
  nome: 'verdadeouconsequencia',
  aliases: ['vouc', 'verdadeconsequencia', 'verdadeouconseq'],
  descricao: 'Abre uma enquete de Verdade ou Consequência para você ou alguém mencionado.',
  categoria: 'brincadeiras',
  async executar(sock, jid, msg) {
    return rodadas.obter(sock).abrir(jid, msg)
  }
}
