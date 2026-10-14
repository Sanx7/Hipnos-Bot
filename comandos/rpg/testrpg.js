const { getPlayer } = require('../../rpg/database')
const { enviar, contexto, mensagemErro } = require('../../rpg/comandos')
module.exports = {
  nome: 'testrpg', descricao: 'Verifica o acesso à sua ficha sem expor identificadores internos.',
  async executar(sock, jid, msg) {
    try {
      const ctx = await contexto(sock, jid, msg)
      await getPlayer(ctx.sender, ctx.participantes)
      return enviar(sock, jid, msg, '🧪 *RPG — Fundação OK*\nSua ficha está acessível. Use /ficha ou /carteira para consultar seus dados.')
    } catch (err) { return enviar(sock, jid, msg, '⚠️ ' + mensagemErro(err)) }
  }
}
