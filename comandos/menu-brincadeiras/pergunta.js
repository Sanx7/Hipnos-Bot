const perguntas = require('../../dados/perguntas-reflexivas')
const sorteio = require('../../dados/sorteio-sem-repeticao')(perguntas)
module.exports = {
  nome: 'pergunta',
  async executar(sock, jid, msg) {
    await sock.sendMessage(jid, { text: `💭 Uma pergunta para despertar os sonhos:\n\n${sorteio.sortear(jid)}` }, { quoted: msg }).catch(() => {})
  },
  _limparMemoria: sorteio.limpar
}
