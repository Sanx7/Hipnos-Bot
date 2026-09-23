// ============================================
// 🧪 teste-novidades.js — Valida o /novidades (menu-principal/novidades.js)
// ============================================
// RODA 100% OFFLINE: sock fake, sem WhatsApp real e sem rede. A lista de
// entradas é injetada via _injetarEntradas (o changelog real NÃO é alterado).
// Uso: node scripts/teste-novidades.js
// ============================================

const novidades = require('../comandos/menu-principal/novidades')

const JID = '120363000000000000@g.us'
const MSG = { key: { remoteJid: JID, fromMe: false, id: 'MSG' }, message: { conversation: '/novidades' } }

function gerarEntradasFalsas(total) {
  const lista = []
  for (let i = 1; i <= total; i++) {
    const dia = String(i).padStart(2, '0')
    lista.push({
      data: `2026-08-${dia}`,
      titulo: `Novidade ${i}`,
      detalhes: i % 3 === 0 ? '' : `Detalhe da novidade ${i}.`
    })
  }
  return lista.reverse()
}

function criarSock() {
  const enviadas = []
  return {
    enviadas,
    sock: {
      async sendMessage(jid, conteudo, opcoes) {
        enviadas.push({ jid, conteudo, opcoes })
        return { key: { id: `fake-${enviadas.length}` } }
      }
    }
  }
}

function textoUnico(enviadas) {
  const textos = enviadas.map((e) => e.conteudo && e.conteudo.text).filter((t) => typeof t === 'string')
  if (textos.length !== 1) throw new Error(`esperava exatamente 1 mensagem, veio ${textos.length}`)
  return textos[0]
}

let reprovadas = 0
async function testar(nome, fn) {
  try {
    await fn()
    console.log('✅ ' + nome)
  } catch (err) {
    reprovadas += 1
    console.error('❌ ' + nome + ' →', err && err.message ? err.message : err)
  }
}

async function main() {
  await testar('exports (nome/executar/aliases/limite)', async () => {
    if (novidades.nome !== 'novidades') throw new Error('nome diferente de "novidades"')
    if (typeof novidades.executar !== 'function') throw new Error('sem executar')
    if (!Array.isArray(novidades.aliases)) throw new Error('sem aliases')
    if (!novidades.aliases.includes('changelog')) throw new Error('falta alias changelog')
    if (!novidades.aliases.includes('atualizacoes')) throw new Error('falta alias atualizacoes')
    if (novidades.LIMITE_PADRAO !== 10) throw new Error('LIMITE_PADRAO diferente de 10')
  })

  await testar('listagem padrao mostra as 10 mais recentes', async () => {
    novidades._injetarEntradas(gerarEntradasFalsas(12))
    const { sock, enviadas } = criarSock()
    await novidades.executar(sock, JID, MSG, '/novidades')
    const texto = textoUnico(enviadas)
    if (!texto.includes('NOVIDADES DO LIMBO')) throw new Error('sem cabecalho tematico')
    if (!texto.includes('Novidade 12')) throw new Error('falta a mais recente (Novidade 12)')
    if (!texto.includes('Novidade 3')) throw new Error('falta a 10a (Novidade 3)')
    if (texto.includes('Novidade 2')) throw new Error('vazou a 11a (Novidade 2)')
    novidades._restaurarEntradas()
  })

  await testar('/novidades tudo mostra o historico completo', async () => {
    novidades._injetarEntradas(gerarEntradasFalsas(12))
    const { sock, enviadas } = criarSock()
    await novidades.executar(sock, JID, MSG, '/novidades tudo')
    const texto = textoUnico(enviadas)
    for (let i = 1; i <= 12; i++) {
      if (!texto.includes(`Novidade ${i}`)) throw new Error(`falta a Novidade ${i}`)
    }
    novidades._restaurarEntradas()
  })

  await testar('/novidades 5 mostra as 5 mais recentes', async () => {
    novidades._injetarEntradas(gerarEntradasFalsas(12))
    const { sock, enviadas } = criarSock()
    await novidades.executar(sock, JID, MSG, '/novidades 5')
    const texto = textoUnico(enviadas)
    for (const n of [12, 11, 10, 9, 8]) {
      if (!texto.includes(`Novidade ${n}`)) throw new Error(`falta a Novidade ${n}`)
    }
    if (texto.includes('Novidade 7')) throw new Error('vazou a 6a (Novidade 7) com limite 5')
    novidades._restaurarEntradas()
  })

  await testar('lista vazia gera aviso amigavel', async () => {
    novidades._injetarEntradas([])
    const { sock, enviadas } = criarSock()
    await novidades.executar(sock, JID, MSG, '/novidades')
    const texto = textoUnico(enviadas)
    if (!/nenhuma novidade/i.test(texto)) throw new Error('sem aviso de lista vazia: ' + texto)
    novidades._restaurarEntradas()
  })

  for (const invalido of ['/novidades abc', '/novidades 0', '/novidades -3', '/novidades 2.5']) {
    await testar(`numero invalido (${invalido}) gera aviso de uso`, async () => {
      novidades._injetarEntradas(gerarEntradasFalsas(3))
      const { sock, enviadas } = criarSock()
      await novidades.executar(sock, JID, MSG, invalido)
      const texto = textoUnico(enviadas)
      if (!/entendi|uso|novidades 5/i.test(texto)) throw new Error('sem aviso de uso: ' + texto)
      novidades._restaurarEntradas()
    })
  }

  await testar('formatacao: data DD/MM, titulo em negrito, detalhes abaixo', async () => {
    novidades._injetarEntradas([
      { data: '2026-09-23', titulo: 'Comando novo', detalhes: 'Explicacao de como usar.' },
      { data: '2026-09-20', titulo: 'So titulo' }
    ])
    const { sock, enviadas } = criarSock()
    await novidades.executar(sock, JID, MSG, '/novidades tudo')
    const texto = textoUnico(enviadas)
    if (!texto.includes('23/09')) throw new Error('data fora do formato pt-BR (23/09)')
    if (!texto.includes('*Comando novo*')) throw new Error('titulo sem negrito')
    if (!texto.includes('Explicacao de como usar.')) throw new Error('detalhes sumiram')
    if (!texto.includes('*So titulo*')) throw new Error('entrada sem detalhes sumiu')
    novidades._restaurarEntradas()
  })

  await testar('formatarData: AAAA-MM-DD vira DD/MM', async () => {
    if (novidades.formatarData('2026-09-23') !== '23/09') throw new Error('2026-09-23 nao virou 23/09')
    if (novidades.formatarData('2026-01-05') !== '05/01') throw new Error('2026-01-05 nao virou 05/01')
  })

  await testar('resolverQuantidade: padrao/tudo/n/invalido', async () => {
    if (novidades.resolverQuantidade('').tipo !== 'padrao') throw new Error('vazio nao e padrao')
    if (novidades.resolverQuantidade('tudo').tipo !== 'tudo') throw new Error('tudo nao e tudo')
    const cinco = novidades.resolverQuantidade('5')
    if (cinco.tipo !== 'n' || cinco.total !== 5) throw new Error('5 nao resolveu para N=5')
    if (novidades.resolverQuantidade('abc').tipo !== 'invalido') throw new Error('abc nao e invalido')
    if (novidades.resolverQuantidade('0').tipo !== 'invalido') throw new Error('0 nao e invalido')
  })

  await testar('changelog real: array valido e ordenado (recente para antigo)', async () => {
    novidades._restaurarEntradas()
    const lista = require('../dados/changelog')
    if (!Array.isArray(lista) || !lista.length) throw new Error('changelog vazio ou invalido')
    for (const entrada of lista) {
      if (!entrada.data || !entrada.titulo) throw new Error('entrada sem data/titulo')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.data)) throw new Error('data fora do padrao: ' + entrada.data)
    }
    const chaves = lista.map((e) => e.data)
    const ordenadas = [...chaves].sort().reverse()
    if (JSON.stringify(chaves) !== JSON.stringify(ordenadas)) throw new Error('changelog fora de ordem')
  })

  console.log(reprovadas === 0 ? '\nTodos os testes passaram.' : `\n${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('Falha inesperada no teste:', err)
  process.exit(1)
})
