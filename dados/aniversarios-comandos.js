const { criarRepositorio } = require('./aniversarios-mongo')
const tempo = require('./aniversarios-tempo')
const identidade = require('./aniversarios-identidade')
const { obterPrefixo } = require('../prefixo')
const NOMES = ['aniversario', 'meuaniversario', 'aniversarios', 'removeraniversario']
function criarComandos({ repo = criarRepositorio(), relogio = Date.now,
  notificar = () => require('../aniversarios').agendador.verificar() } = {}) {
  return NOMES.map(nome => ({
    nome, aliases: [], categoria: 'rpg', descricao: 'Gerencia aniversários com privacidade.',
    async executar(sock, jid, msg, texto = '') {
      const responder = (text, mentions) => sock.sendMessage(jid, { text, ...(mentions?.length ? { mentions } : {}) }, { quoted: msg })
      try {
        const prefixo = await obterPrefixo()
        const args = String(texto).trim().split(/\s+/).slice(1)
        const c = await identidade.autor(sock, jid, msg)
        if (nome === 'aniversario') {
          if (args.length === 1 && ['publico', 'privado'].includes(args[0].toLowerCase())) {
            const publico = args[0].toLowerCase() === 'publico'
            if (!await repo.privacidade(c.numero, publico, relogio())) return responder(`Você ainda não tem cadastro. Use ${prefixo}aniversario DD/MM.`)
            // Antecipar a consulta do próprio dia, sem aguardar o transporte dos grupos.
            if (publico) Promise.resolve().then(notificar).catch(() => {})
            return responder(publico
              ? `🌟 Divulgação autorizada em todos os grupos elegíveis: listagem, ficha pública e homenagem anual com menção ao grupo inteiro. Para revogar: ${prefixo}aniversario privado.`
              : '🔒 Divulgação revogada. Seu aniversário fica fora das listas, fichas públicas e novas homenagens. Mensagens já enviadas não são apagadas.')
          }
          const data = args.length === 1 && tempo.lerData(args[0])
          if (!data) return responder(`🎂 Use ${prefixo}aniversario DD/MM. Ex.: ${prefixo}aniversario 27/10.\nO cadastro começa privado. ${prefixo}aniversario publico autoriza divulgação e homenagem com menção a todos nos grupos; ${prefixo}aniversario privado revoga.\n29/02 é comemorado em 28/02 nos anos não bissextos.`)
          await repo.salvar(c.numero, data, relogio())
          return responder(`🌙 Cadastro salvo e privado, sem recompensas de RPG. Para consultar a data, use ${prefixo}meuaniversario no privado.\nSe quiser divulgação em todos os grupos elegíveis, autorize com ${prefixo}aniversario publico. Isso inclui homenagem com menção a todos. Alterar a data exige nova autorização.\n29/02 é comemorado em 28/02 nos anos não bissextos.`)
        }
        if (nome === 'removeraniversario') {
          if (args.length) return responder(`Use ${prefixo}removeraniversario sem argumentos; somente seu cadastro será excluído.`)
          await repo.remover(c.numero)
          return responder('🔒 Seu cadastro de aniversário foi removido. Nenhuma nova divulgação será feita. Mensagens já enviadas não são apagadas.')
        }
        if (nome === 'meuaniversario') {
          if (args.length) return responder(`Use ${prefixo}meuaniversario sem argumentos.`)
          const doc = await repo.consultar(c.numero)
          // Somente autorização pública explícita permite mostrar a data no grupo.
          if (String(jid).endsWith('@g.us') && doc?.publico !== true) return responder(`🔒 Consulte sua data no privado com ${prefixo}meuaniversario.`)
          if (!doc || !tempo.validar(doc.dia, doc.mes)) return responder(`Sem cadastro válido. Use ${prefixo}aniversario DD/MM.`)
          return responder(`🎂 Seu aniversário: ${tempo.exibir(doc)}\n${doc.publico === true ? '🌟 Público: autorizado nos grupos, incluindo menção geral.' : '🔒 Privado: sem divulgação nos grupos.'}\n29/02 é comemorado em 28/02 nos anos não bissextos.\nControle: ${prefixo}aniversario publico ou ${prefixo}aniversario privado.`)
        }
        if (!String(jid).endsWith('@g.us')) return responder('🌙 Consulte os próximos aniversariantes dentro de um grupo.')
        const pagina = !args.length ? 1 : args.length === 1 && /^[1-9]\d{0,3}$/.test(args[0]) ? Number(args[0]) : 0
        const membros = await identidade.membros(c.participantes)
        const hoje = tempo.calendario(relogio())
        const docs = (await repo.publicos([...membros.keys()])).filter(d => d.publico === true && membros.has(d._id) && tempo.validar(d.dia, d.mes))
          .map(d => ({ ...d, proxima: tempo.proxima(d, hoje) })).sort((a, b) => a.proxima.ordem - b.proxima.ordem || a._id.localeCompare(b._id))
        const paginas = Math.max(1, Math.ceil(docs.length / 20))
        if (pagina < 1 || pagina > paginas) return responder(`Use ${prefixo}aniversarios de 1 a ${paginas}.`)
        const lista = docs.slice((pagina - 1) * 20, pagina * 20), mentions = lista.map(d => membros.get(d._id))
        const linhas = lista.map(d => `🎂 ${tempo.exibir(d.proxima)} · @${membros.get(d._id).split('@')[0]}${d.dia === 29 && d.mes === 2 ? ' (cadastro 29/02)' : ''}`)
        return responder(`🏛️ *PRÓXIMAS CELEBRAÇÕES DO OLIMPO*\n${linhas.join('\n') || 'Nenhum participante autorizou a divulgação.'}\n\nPágina ${pagina}/${paginas} · São Paulo\nSomente membros atuais com autorização pública.${pagina < paginas ? `\nPróxima: ${prefixo}aniversarios ${pagina + 1}` : ''}`, mentions)
      } catch (_) {
        console.warn('[aniversarios]', { evento: 'comando_indisponivel' })
        try { await responder('🌑 Não foi possível confirmar a operação ou a identidade agora. Consulte seu cadastro no privado antes de tentar novamente.') } catch (_) {}
      }
    }
  }))
}
async function linhaFicha(sock, jid, msg, participantes) {
  try {
    const c = await identidade.autor(sock, jid, msg, participantes)
    const doc = await criarRepositorio().consultar(c.numero)
    if (!doc || !tempo.validar(doc.dia, doc.mes) || (String(jid).endsWith('@g.us') && doc.publico !== true)) return ''
    return `\n🎈 Aniversário: ${tempo.exibir(doc)}`
  } catch { return '' } // A disponibilidade de aniversários não impede a ficha do RPG.
}
module.exports = { criarComandos, linhaFicha, NOMES }
