const { CARREIRAS } = require('../../rpg/empregos-catalogo')
const { formatarReais } = require('../../rpg/economia')
const { enviar } = require('../../rpg/comandos')
const { cursoDaCarreira } = require('../../rpg/faculdades-catalogo')
module.exports = {
  nome: 'empregos', descricao: 'Catálogo das 34 carreiras oficiais do RPG.',
  async executar(sock, jid, msg, texto) {
    const args = String(texto || '').trim().split(/\s+/).slice(1)
    if (args.length > 1 || (args.length && !/^[123]$/.test(args[0]))) return enviar(sock, jid, msg, 'Uso: /empregos [1|2|3]')
    const carreiras = CARREIRAS.filter(c => !args.length || c.nivelCarreira === Number(args[0]))
    return enviar(sock, jid, msg, '💼 *CARREIRAS DO RPG*\nSalários fictícios por jornada; propostas de balanceamento.\n\n' +
      carreiras.map(c => c.ordem + '. ' + c.cargos.map(g => g.nome + ' (' + formatarReais(g.salario) +
        (g.exigeFaculdade ? ', diploma: ' + cursoDaCarreira(c.id).nome : '') + ')').join(' → ') +
        '\nID: ' + c.id + ' • Nível da carreira: ' + c.nivelCarreira + ' • XP total mínimo: ' + c.xpTotalMinimo).join('\n\n') +
      '\n\nEscolha: /carreira <id>\nJornada: /trabalhar\nPromoção: /carreira promover')
  }
}
