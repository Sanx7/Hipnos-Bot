const { comandos } = require('../comandos-registry')
const { obterPrefixo, removerPrefixo } = require('../prefixo')
const { RODAPE_MENU } = require('../config')
const { portais, catalogo } = require('./menus-catalogo')

const POR_PAGINA = 12
function entradas(categoria) {
  return catalogo.filter(item => item.categoria === categoria &&
    comandos.get(item.nome)?.nome === item.nome && typeof comandos.get(item.nome)?.executar === 'function')
}
function principal(prefixo) {
  return ['🌙 *HIPNOS BOT*', '🏛️ *PORTAIS DO OLIMPO*', '',
    'Entre os sonhos e o limbo, escolha seu portal.', '',
    ...portais.map(p => `${p.simbolo} *${p.titulo}*\n${prefixo}${p.nome} — ${p.descricao}\n`),
    '🌑 Cada domínio preserva suas próprias permissões.', '', RODAPE_MENU].join('\n')
}
function submenu(categoria, pagina, prefixo) {
  const portal = portais.find(p => p.categoria === categoria)
  if (!portal) throw new Error('MENU_DESCONHECIDO')
  const lista = entradas(categoria)
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA))
  if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > paginas) {
    return `🌑 Página não encontrada. Use ${prefixo}${portal.nome} de 1 a ${paginas}.`
  }
  const partes = [`🌙 *HIPNOS BOT*\n${portal.simbolo} *${portal.titulo.toLocaleUpperCase('pt-BR')}*`,
    `${portal.descricao}\n${portal.aviso}`, `📖 *Página:* ${pagina}/${paginas}`, '━━━━━━━━━━━━━━']
  let secao
  for (const item of lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)) {
    if (item.secao !== secao) { partes.push(`*${item.secao}*`); secao = item.secao }
    partes.push(`*${prefixo}${item.nome}*${item.uso ? ` ${item.uso}` : ''}\n↳ ${item.descricao}`)
  }
  if (!lista.length) partes.push('Nenhum comando desta categoria está carregado agora.')
  partes.push('━━━━━━━━━━━━━━')
  if (pagina > 1) partes.push(`◀️ Anterior: ${prefixo}${portal.nome} ${pagina - 1}`)
  if (pagina < paginas) partes.push(`▶️ Próxima: ${prefixo}${portal.nome} ${pagina + 1}`)
  partes.push(`🏛️ Portais: ${prefixo}menu`, RODAPE_MENU)
  return partes.join('\n\n')
}
function criarMenu(categoria, { aliases = [] } = {}) {
  const portal = portais.find(p => p.categoria === categoria)
  return {
    nome: categoria === 'principal' ? 'menu' : portal.nome,
    aliases,
    descricao: categoria === 'principal' ? 'Abre os Portais do Olimpo.' : portal.descricao,
    async executar(sock, jid, msg, texto = '') {
      try {
        const prefixo = await obterPrefixo()
        const args = removerPrefixo(texto, prefixo).trim().split(/\s+/).slice(1)
        const pagina = !args.length ? 1 : args.length === 1 && /^[1-9]\d{0,3}$/.test(args[0]) ? Number(args[0]) : NaN
        const text = categoria === 'principal' ? principal(prefixo) : submenu(categoria, pagina, prefixo)
        await sock.sendMessage(jid, { text }, { quoted: msg })
      } catch (_) {
        console.warn('[menus]', { evento: 'envio_indisponivel' })
      }
    }
  }
}
module.exports = { criarMenu, principal, submenu, entradas, POR_PAGINA }
