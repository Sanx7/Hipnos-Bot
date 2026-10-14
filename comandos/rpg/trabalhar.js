const { trabalhar } = require('../../rpg/empregos')
const { formatarReais } = require('../../rpg/economia')
const { enviar, contexto, mensagemErro } = require('../../rpg/comandos')
module.exports = {
  nome: 'trabalhar', descricao: 'Cumpre uma jornada remunerada do RPG.',
  async executar(sock, jid, msg, texto) {
    if (String(texto || '').trim().split(/\s+/).length !== 1) return enviar(sock, jid, msg, 'Uso: /trabalhar')
    try {
      const ctx = await contexto(sock, jid, msg)
      const r = await trabalhar(ctx.sender, ctx)
      if (!r.ok) return enviar(sock, jid, msg, '⚠️ ' + mensagemErro(r.motivo))
      return enviar(sock, jid, msg, '💼 *JORNADA CONCLUÍDA*' + (r.repetida ? ' (já processada)' : '') +
        '\nCargo: ' + r.cargo + '\nSalário: ' + formatarReais(r.salario) +
        '\nCarteira após a jornada: ' + formatarReais(r.saldoCarteira) +
        '\nXP profissional: +' + r.xpGanho + ' • XP da carreira: ' + r.xpTrabalho +
        '\nEnergia após a jornada: ' + r.energia + '/100' +
        '\nPróxima jornada: ' + new Date(r.proximaJornadaEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))
    } catch (err) { return enviar(sock, jid, msg, '⚠️ ' + mensagemErro(err)) }
  }
}
