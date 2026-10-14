const { getPlayer } = require('../../rpg/database')
const { formatarReais } = require('../../rpg/economia')
const { enviar, contexto, mensagemErro } = require('../../rpg/comandos')
module.exports = {
  nome: 'carteira', aliases: ['banco', 'saldo', 'dinheiro'], descricao: 'Mostra carteira e banco do RPG.',
  async executar(sock, jid, msg) {
    try {
      const ctx = await contexto(sock, jid, msg)
      const p = await getPlayer(ctx.sender, ctx.participantes)
      return enviar(sock, jid, msg, '💰 *SUAS MOEDAS NO SONHO*\n━━━━━━━━━━━━━━━━━━━\n' +
        '\n👛 Carteira: ' + formatarReais(p.carteira) + '\n🏦 Banco: ' + formatarReais(p.banco) +
        '\n💎 Total: ' + formatarReais(Number(p.carteira) + Number(p.banco)) +
        '\n\n/depositar <valor> • /sacar <valor> • /transferir @alguém <valor>\nUse todos para mover o saldo inteiro.')
    } catch (err) { return enviar(sock, jid, msg, '⚠️ ' + mensagemErro(err)) }
  }
}
