const { getPlayer } = require('../../rpg/database')
const { formatarReais } = require('../../rpg/economia')
const { enviar, contexto, mensagemErro } = require('../../rpg/comandos')
const { empregoAtual } = require('../../rpg/empregos')
const { linhasAcademicas } = require('../../rpg/faculdade-comandos')
const { linhaFicha } = require('../../dados/aniversarios-comandos')
function barra(valor) {
  const n = Math.max(0, Math.min(100, Number(valor) || 0))
  const blocos = Math.round(n / 10)
  return '🟩'.repeat(blocos) + '⬜'.repeat(10 - blocos) + ' ' + n + '/100'
}
module.exports = {
  nome: 'ficha', aliases: ['rpgperfil'], descricao: 'Mostra sua ficha do RPG.',
  async executar(sock, jid, msg) {
    try {
      const ctx = await contexto(sock, jid, msg)
      const p = await getPlayer(ctx.sender, ctx.participantes)
      let emprego = p.emprego || 'sem emprego'
      if (p.emprego) {
        try { emprego = empregoAtual(p).cargo.nome } catch { /* Exibe legado sem modificar. */ }
      }
      const aviso = p.nome ? '' : '\n⚠️ Você ainda não se registrou. Use /registrar <nome> <M ou F>.\n'
      let escolaridade
      try { escolaridade = linhasAcademicas(p) } catch { escolaridade = '\n🎓 Histórico acadêmico preservado, pendente de revisão.' }
      const aniversario = await linhaFicha(sock, jid, msg, ctx.participantes)
      return enviar(sock, jid, msg,
        (p.nome ? '🌙 *FICHA ONÍRICA — ' + p.nome + '*' : '🌙 *FICHA PROVISÓRIA (sem registro)*') +
        '\n━━━━━━━━━━━━━━━━━━━\n' + aviso +
        '\n🪪 Nome: ' + (p.nome || '—') + '\n🚻 Gênero: ' + (p.genero || '—') +
        '\n🎂 Idade: ' + (p.idade ?? '?') + ' anos' +
        aniversario +
        escolaridade +
        '\n💼 Emprego: ' + (p.emprego ? emprego + ' (cargo ' + p.cargo + ')' : 'sem emprego') +
        '\n💵 Carteira: ' + formatarReais(p.carteira) + '\n🏦 Banco: ' + formatarReais(p.banco) +
        '\n⭐ Fama: ' + (p.fama ?? 0) + '\n🍽️ Fome: ' + barra(p.fome) + '\n⚡ Energia: ' + barra(p.energia) +
        '\n\n💤 Hipnos observa seus sonhos...')
    } catch (err) { return enviar(sock, jid, msg, '⚠️ ' + mensagemErro(err)) }
  }
}
