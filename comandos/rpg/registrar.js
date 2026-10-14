const { getPlayer, savePlayer } = require('../../rpg/database')
const { enviar, contexto, mensagemErro } = require('../../rpg/comandos')
module.exports = {
  nome: 'registrar', descricao: 'Registra sua identidade no RPG. Uso: /registrar <nome> <M ou F>',
  async executar(sock, jid, msg, texto) {
    const args = String(texto || '').trim().split(/\s+/).slice(1)
    const generoBruto = args.pop()
    const nome = args.join(' ').trim()
    if (!nome || !generoBruto) return enviar(sock, jid, msg,
      '🪪 *Como se registrar no mundo onírico:*\n/registrar <nome> <M ou F>\nEx.: /registrar João M • /registrar Maria F\nNome de 2 a 20 caracteres.')
    const genero = ({ m: 'M', masculino: 'M', f: 'F', feminino: 'F' })[generoBruto.toLowerCase()]
    if (!genero) return enviar(sock, jid, msg, '🚻 *Gênero inválido.* Aceito M/masculino ou F/feminino.')
    if (nome.length < 2 || nome.length > 20) return enviar(sock, jid, msg, '📏 *Nome fora dos limites:* use de 2 a 20 caracteres.')
    try {
      const ctx = await contexto(sock, jid, msg)
      const jogador = await getPlayer(ctx.sender, ctx.participantes)
      await savePlayer(ctx.sender, { nome, genero }, ctx.participantes)
      const saudacao = genero === 'F' ? 'Bem-vinda' : 'Bem-vindo'
      return enviar(sock, jid, msg, jogador.nome
        ? '🔄 *Registro ATUALIZADO!*\n' + saudacao + ' de volta, *' + nome + '*!\n🚻 Gênero: ' + genero + '\nUse /ficha para conferir.'
        : '🪪 *REGISTRO CONCLUÍDO*\n' + saudacao + ' ao RPG, *' + nome + '*!\n🚻 Gênero: ' + genero + '\nUse /ficha para conferir.')
    } catch (err) { return enviar(sock, jid, msg, '⚠️ ' + mensagemErro(err)) }
  }
}
