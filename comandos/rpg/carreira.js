const { getPlayer } = require('../../rpg/database')
const empregos = require('../../rpg/empregos')
const { nivelProfissional } = require('../../rpg/empregos-catalogo')
const { formatarReais } = require('../../rpg/economia')
const { enviar, contexto, mensagemErro } = require('../../rpg/comandos')
const { cursoDaCarreira } = require('../../rpg/faculdades-catalogo')
module.exports = {
  nome: 'carreira', descricao: 'Consulta, contratação e promoção profissional do RPG.',
  async executar(sock, jid, msg, texto) {
    const args = String(texto || '').trim().split(/\s+/).slice(1)
    if (args.length > 2 || (args.length === 2 && args[1] !== 'confirmar') || (args[0] === 'promover' && args.length > 1)) {
      return enviar(sock, jid, msg, 'Uso: /carreira • /carreira <id> [confirmar] • /carreira promover')
    }
    try {
      const ctx = await contexto(sock, jid, msg)
      if (!args.length) {
        const p = await getPlayer(ctx.sender, ctx.participantes)
        if (![p.xpTierTotal ?? 0, p.xpTrabalho ?? 0].every(n => Number.isSafeInteger(n) && n >= 0)) {
          return enviar(sock, jid, msg, '⚠️ ' + mensagemErro('progresso_incompativel'))
        }
        const atual = empregos.empregoAtual(p)
        if (!atual) return enviar(sock, jid, msg, 'Você está sem emprego. Consulte /empregos e escolha com /carreira <id>.')
        const proximo = atual.carreira.cargos[atual.cargo.numero]
        return enviar(sock, jid, msg, '💼 *SUA CARREIRA*\n' + atual.cargo.nome +
          '\nSalário por jornada: ' + formatarReais(atual.cargo.salario) +
          '\nNível da carreira: ' + atual.carreira.nivelCarreira +
          '\nNível profissional: ' + nivelProfissional(p.xpTierTotal || 0) +
          '\nXP da carreira: ' + (p.xpTrabalho ?? 0) + ' • XP total: ' + (p.xpTierTotal ?? 0) +
          '\n' + (proximo ? 'Próximo cargo: ' + proximo.nome + ' • ' + proximo.xpMinimo + ' XP' +
            (proximo.exigeFaculdade ? ' e diploma de ' + cursoDaCarreira(atual.carreira.id).nome : '') + '\nUse /carreira promover.' : 'Sem outras promoções internas.') +
          '\nUse /trabalhar para cumprir uma jornada.')
      }
      const r = args[0] === 'promover'
        ? await empregos.promover(ctx.sender, ctx)
        : await empregos.contratar(ctx.sender, args[0], args[1] === 'confirmar', ctx)
      if (!r.ok) return enviar(sock, jid, msg, '⚠️ ' + mensagemErro(r.motivo))
      return enviar(sock, jid, msg, '💼 *' + (args[0] === 'promover' ? 'PROMOÇÃO CONFIRMADA' : 'CONTRATAÇÃO CONFIRMADA') +
        '*\nCargo: ' + r.cargo + (r.repetida ? '\nEsta mensagem já foi processada.' : '') + '\nUse /trabalhar.')
    } catch (err) { return enviar(sock, jid, msg, '⚠️ ' + mensagemErro(err)) }
  }
}
