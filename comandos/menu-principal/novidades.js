// ============================================
// 🌙 NOVIDADES — O que mudou recentemente no bot (/novidades)
// ============================================
// Uso LIVRE (qualquer mortal pode consultar):
//   /novidades            → mostra as ~10 entradas mais recentes
//   /novidades tudo       → mostra o histórico completo
//   /novidades <numero>   → mostra as N mais recentes (ex.: /novidades 5)
//
// Fonte dos dados: dados/changelog.js (curadoria MANUAL — só o que interessa
// pra quem usa o bot no grupo; bug interno e refatoração NÃO entram lá).
// Cada entrada: { data: 'AAAA-MM-DD', titulo, detalhes? } — do mais recente
// para o mais antigo.
//
// Formato: cabeçalho temático "🌙 NOVIDADES DO LIMBO", cada entrada com data
// em pt-BR (DD/MM), título em negrito e detalhes em texto normal logo abaixo
// (sem detalhes → só a linha do título).
//
// 🪝 Gancho de teste (_injetarEntradas/_restaurarEntradas): permite aos testes
// offline injetar uma lista falsa sem mexer no changelog real — mesmo padrão
// dos ganchos do /traduzir e do /resumir.
// ============================================

const { RODAPE_MENU } = require('../../config')

const LIMITE_PADRAO = 10

// Entradas injetadas pelos testes (null = usar o changelog real).
let entradasInjetadas = null

function carregarEntradas() {
  if (entradasInjetadas !== null) return entradasInjetadas
  try {
    const lista = require('../../dados/changelog')
    return Array.isArray(lista) ? lista : []
  } catch (err) {
    return []
  }
}

// "2026-09-23" → "23/09" (formato curto em pt-BR, sem o ano na listagem).
// Fora do padrão AAAA-MM-DD → devolve o texto cru (nunca quebra o comando).
function formatarData(data) {
  const texto = String(data || '').trim()
  const partes = texto.split('-')
  if (partes.length === 3 && partes[0].length === 4 && partes[1].length === 2 && partes[2].length === 2) {
    return `${partes[2]}/${partes[1]}`
  }
  return texto || '?'
}

function formatarEntrada(entrada) {
  const linhaTitulo = `📅 ${formatarData(entrada.data)} — *${entrada.titulo}*`
  const detalhes = String(entrada.detalhes || '').trim()
  return detalhes ? `${linhaTitulo}\n${detalhes}` : linhaTitulo
}

// Decide quantas entradas mostrar a partir do argumento cru.
// Retorna { tipo: 'padrao' } | { tipo: 'tudo' } | { tipo: 'n', total } |
// { tipo: 'invalido' } — o executor trata cada caso com mensagem amigável.
function resolverQuantidade(argumento) {
  const texto = String(argumento || '').trim().toLowerCase()
  if (!texto) return { tipo: 'padrao', total: LIMITE_PADRAO }
  if (texto === 'tudo' || texto === 'todas' || texto === 'todo' || texto === 'todos') {
    return { tipo: 'tudo' }
  }
  const numero = Number(texto)
  if (!Number.isInteger(numero) || numero <= 0) return { tipo: 'invalido' }
  return { tipo: 'n', total: numero }
}

function montarTexto(entradas, rotulo) {
  const linhas = entradas.map(formatarEntrada)
  return (
    '🌙 NOVIDADES DO LIMBO 🌙\n' +
    '\n' +
    `🌑 ${rotulo}\n` +
    '\n' +
    '════════════════════\n' +
    '\n' +
    linhas.join('\n\n') +
    '\n\n' +
    '════════════════════\n' +
    '\n' +
    '💡 Dica: `/novidades 5` mostra as 5 mais recentes • `/novidades tudo` mostra o histórico completo.\n' +
    '\n' +
    RODAPE_MENU
  )
}

module.exports = {
  nome: 'novidades',
  aliases: ['changelog', 'atualizacoes'],
  descricao: 'Mostra o que mudou recentemente no bot. Uso: /novidades [tudo|numero].',
  categoria: 'principal',

  async executar(sock, jid, msg, text) {
    try {
      const partes = String(text || '').trim().split(/\s+/)
      const argumento = partes.length > 1 ? partes.slice(1).join(' ') : ''
      const escolha = resolverQuantidade(argumento)
      const entradas = carregarEntradas()

      if (!entradas.length) {
        await sock.sendMessage(jid, {
          text: '🌙 *NOVIDADES DO LIMBO*\n\n📭 As sombras ainda não registraram nenhuma novidade por aqui... volte em breve. 💤'
        }, { quoted: msg })
        return
      }

      if (escolha.tipo === 'invalido') {
        await sock.sendMessage(jid, {
          text: '🌙 *NOVIDADES DO LIMBO*\n\n❓ Não entendi esse número... me diga quantas novidades você quer ver (ex.: `/novidades 5`) ou use `/novidades tudo` para ver o histórico completo.'
        }, { quoted: msg })
        return
      }

      if (escolha.tipo === 'tudo') {
        await sock.sendMessage(jid, {
          text: montarTexto(entradas, `Histórico completo — ${entradas.length} novidade${entradas.length === 1 ? '' : 's'}:`)
        }, { quoted: msg })
        return
      }

      const total = escolha.total
      const fatiadas = entradas.slice(0, total)
      await sock.sendMessage(jid, {
        text: montarTexto(fatiadas, `As ${fatiadas.length} mais recentes:`)
      }, { quoted: msg })
    } catch (err) {
      console.error('[novidades] erro ao mostrar o changelog:', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '❌ Não consegui consultar as novidades agora. Tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  // ─── Extras internos para os testes offline ───
  LIMITE_PADRAO,
  carregarEntradas,
  formatarData,
  formatarEntrada,
  resolverQuantidade,
  montarTexto,
  _injetarEntradas: (lista) => { entradasInjetadas = lista },
  _restaurarEntradas: () => { entradasInjetadas = null }
}
