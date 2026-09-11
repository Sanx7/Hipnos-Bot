// ============================================
// 🧪 teste-wiki.js — Valida o comando /wiki (Wikipédia, offline)
// ============================================
// RODA OFFLINE: substitui global.fetch por um mock da Wikipédia (resumo
// REST, busca tradicional e thumbnail fake), com cenários controlados e
// captura do User-Agent. Verifica:
//   - exports (nome, aliases, descricao, categoria) + registro de aliases
//     como o loader do bot.js faria;
//   - User-Agent descritivo em TODAS as chamadas (política da Wikipédia);
//   - resumo direto com termo encodeado (ex.: "Buraco Negro");
//   - 404 no resumo direto -> busca tradicional -> resumo com o 1º título;
//   - busca sem resultados -> "não retornou conhecimento no Limbo";
//   - truncagem do resumo (~800) com "..." e link do artigo no final;
//   - thumbnail -> foto com caption; sem thumbnail -> só texto;
//   - termo ausente -> aviso de uso sem consultar; rede fora -> amigável.
// Uso: node scripts/teste-wiki.js
// ============================================

// Controles dos cenários
let modoWiki = 'ok' // 'ok' | '404' | 'erro500'
let modoBusca = 'ok' // 'ok' | 'vazio'
let modoImagem = 'ok' // 'ok' | 'erro'
let resumoFake = null

// ─── Mock do global.fetch ───
const fetchReal = global.fetch
const chamadas = []
global.fetch = async (url, opcoes = {}) => {
  const endereco = String(url)
  chamadas.push({ endereco, ua: opcoes?.headers?.['User-Agent'] || null })
  if (endereco.includes('/api/rest_v1/page/summary')) {
    if (modoWiki === '404') return { ok: false, status: 404 }
    if (modoWiki === 'erro500') return { ok: false, status: 500 }
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(resumoFake)) }
  }
  if (endereco.includes('api.php')) {
    if (modoBusca === 'vazio') return { ok: true, status: 200, json: async () => ({ query: { search: [] } }) }
    return {
      ok: true,
      status: 200,
      json: async () => ({ query: { search: [{ title: 'Buraco negro' }, { title: 'Horizonte de eventos' }] } })
    }
  }
  if (endereco.includes('img.teste')) {
    if (modoImagem === 'erro') return { ok: false, status: 404 }
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // assinatura PNG falsa
    return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer }
  }
  return fetchReal(url, opcoes)
}

const comando = require('../comandos/utilitario/wiki')

// ─── Mocks de mensagem/sock ───
const JID_GRUPO = '120363000000000000@g.us'
const JID_PRIVADO = '5555000000001@s.whatsapp.net'
const UA_ESPERADO = 'HipnosBot/1.0 (https://github.com/Sanx7/Hipnos-Bot)'

// Resumo longo (> 800 chars) p/ testar a truncagem
const EXTRATO_LONGO = 'Um buraco negro é uma região do espaço-tempo em que a gravidade é tão forte que nada pode escapar. '.repeat(12)

function criarResumoFake({ comImagem = true, extrato = EXTRATO_LONGO } = {}) {
  return {
    title: 'Buraco negro',
    extract: extrato,
    type: 'standard',
    thumbnail: comImagem ? { source: 'https://img.teste/wiki.jpg' } : undefined,
    content_urls: { desktop: { page: 'https://pt.wikipedia.org/wiki/Buraco_negro' } }
  }
}

function criarMsg(texto = '/wiki Buraco Negro', jid = JID_GRUPO) {
  return {
    key: {
      remoteJid: jid,
      fromMe: false,
      id: 'MSG123',
      participant: jid.endsWith('@g.us') ? '5555000000002@s.whatsapp.net' : undefined
    },
    message: { conversation: texto }
  }
}

function criarSock() {
  const enviadas = []
  return {
    enviadas,
    sock: {
      sendMessage: async (jid, conteudo, extra) => {
        enviadas.push({ jid, conteudo, extra })
        return { key: { id: `fake-${enviadas.length}` } }
      }
    }
  }
}

// Simula o roteador do bot.js: chama executar(sock, jid, msg, text)
async function executarCom(sock, jid, texto) {
  return comando.executar(sock, jid, criarMsg(texto, jid), texto)
}

const textoUnico = (enviadas) => {
  const textos = enviadas.filter((e) => e.conteudo?.text)
  return textos.length === 1 ? textos[0].conteudo.text : null
}

async function main() {
  let reprovadas = 0
  const testar = async (nome, fn) => {
    try {
      await fn()
      console.log(`✅ ${nome}`)
    } catch (err) {
      reprovadas += 1
      console.log(`❌ ${nome}:`, err?.message || err)
    }
  }

  const comandos = new Map()

  await testar('exports corretos + aliases registrados como o loader faria', async () => {
    if (comando.nome !== 'wiki') throw new Error(`nome: ${comando.nome}`)
    if (JSON.stringify(comando.aliases) !== JSON.stringify(['wikipedia', 'wikipredia', 'pesquisar'])) {
      throw new Error(`aliases: ${JSON.stringify(comando.aliases)}`)
    }
    if (!/resumo de um artigo da Wikipédia em português\./.test(comando.descricao)) {
      throw new Error(`descricao: ${comando.descricao}`)
    }
    if (comando.categoria !== 'utilitario') throw new Error(`categoria: ${comando.categoria}`)
    if (typeof comando.executar !== 'function') throw new Error('executar não é função')
    comandos.set(comando.nome, comando)
    for (const apelido of comando.aliases) {
      if (!comandos.has(apelido)) comandos.set(apelido, comando)
    }
    for (const rota of ['wiki', 'wikipedia', 'wikipredia', 'pesquisar']) {
      if (comandos.get(rota) !== comando) throw new Error(`rota /${rota} não resolve para o módulo`)
    }
  })

  await testar('resumo direto: foto com caption truncada, link e User-Agent correto', async () => {
    modoWiki = 'ok'
    modoBusca = 'ok'
    modoImagem = 'ok'
    resumoFake = criarResumoFake()
    chamadas.length = 0
    const { sock, enviadas } = criarSock()
    await executarCom(sock, JID_GRUPO, '/wiki Buraco Negro')
    const resumos = chamadas.filter((c) => c.endereco.includes('/api/rest_v1/page/summary'))
    if (resumos.length !== 1) throw new Error(`esperava 1 resumo, houve ${resumos.length}`)
    if (!resumos[0].endereco.endsWith('/Buraco%20Negro')) throw new Error(`URL: ${resumos[0].endereco}`)
    if (chamadas.some((c) => c.ua !== UA_ESPERADO)) throw new Error('User-Agent incorreto')
    if (enviadas.length !== 1) throw new Error(`esperava 1 envio, houve ${enviadas.length}`)
    if (!Buffer.isBuffer(enviadas[0].conteudo.image)) throw new Error('conteúdo não é image:Buffer')
    const caption = String(enviadas[0].conteudo.caption || '')
    if (!caption.includes('*Buraco negro*')) throw new Error('título ausente na legenda')
    if (!caption.includes('...')) throw new Error('resumo longo deveria ser truncado com "..."')
    if (!caption.includes('https://pt.wikipedia.org/wiki/Buraco_negro')) throw new Error('link do artigo ausente')
    if (!/WIKIPÉDIA DO LIMBO/.test(caption)) throw new Error('temática ausente')
    if (!enviadas[0].extra?.quoted) throw new Error('envio sem quoted')
  })

  await testar('404 no resumo direto → busca tradicional → resumo com o 1º título', async () => {
    modoBusca = 'ok'
    modoImagem = 'ok'
    resumoFake = criarResumoFake()
    const fetchMockado = global.fetch
    // Simula a Wikipédia de verdade: o termo digitado em minúsculas dá 404,
    // mas o título correto achado pela busca retorna o resumo.
    global.fetch = async (url, opcoes = {}) => {
      const endereco = String(url)
      if (endereco.includes('/api/rest_v1/page/summary')) {
        chamadas.push({ endereco, ua: opcoes?.headers?.['User-Agent'] || null })
        if (endereco.endsWith('/buraco%20negro')) return { ok: false, status: 404 }
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(resumoFake)) }
      }
      return fetchMockado(url, opcoes)
    }
    try {
      chamadas.length = 0
      const { sock, enviadas } = criarSock()
      await executarCom(sock, JID_GRUPO, '/wiki buraco negro')
      const resumos = chamadas.filter((c) => c.endereco.includes('/api/rest_v1/page/summary'))
      const buscas = chamadas.filter((c) => c.endereco.includes('api.php'))
      if (resumos.length !== 2) throw new Error(`esperava 2 resumos (404 + refetch), houve ${resumos.length}`)
      if (buscas.length !== 1) throw new Error(`esperava 1 busca, houve ${buscas.length}`)
      if (!buscas[0].endereco.includes('srsearch=buraco%20negro')) throw new Error(`busca: ${buscas[0].endereco}`)
      if (!buscas[0].endereco.includes('list=search')) throw new Error('busca sem list=search')
      if (!resumos[1].endereco.endsWith('/Buraco%20negro')) throw new Error(`refetch: ${resumos[1].endereco}`)
      if (!Buffer.isBuffer(enviadas[0].conteudo.image)) throw new Error('deveria enviar a foto do artigo')
    } finally {
      global.fetch = fetchMockado
    }
  })

  await testar('busca sem resultados → "não retornou conhecimento no Limbo"', async () => {
    modoWiki = '404'
    modoBusca = 'vazio'
    const { sock, enviadas } = criarSock()
    await executarCom(sock, JID_GRUPO, '/wiki TermoInexistenteXYZ')
    modoWiki = 'ok'
    const texto = textoUnico(enviadas)
    if (!texto || !/não retornou conhecimento no Limbo/i.test(texto)) {
      throw new Error(`aviso inesperado: ${texto}`)
    }
  })

  await testar('sem thumbnail → mensagem de texto com o link (no privado)', async () => {
    modoWiki = 'ok'
    modoBusca = 'ok'
    modoImagem = 'ok'
    resumoFake = criarResumoFake({ comImagem: false })
    chamadas.length = 0
    const { sock, enviadas } = criarSock()
    await executarCom(sock, JID_PRIVADO, '/wiki Buraco Negro')
    if (enviadas.some((e) => e.conteudo?.image)) throw new Error('não deveria enviar imagem')
    const texto = textoUnico(enviadas)
    if (!texto || !/https:\/\/pt\.wikipedia\.org\/wiki\/Buraco_negro/.test(texto)) {
      throw new Error('link do artigo ausente no texto')
    }
  })

  await testar('resumo curto: sem "..." na truncagem', async () => {
    modoWiki = 'ok'
    modoBusca = 'ok'
    modoImagem = 'ok'
    resumoFake = criarResumoFake({ extrato: 'Um buraco negro é uma região do espaço-tempo de gravidade intensa.' })
    const { sock, enviadas } = criarSock()
    await executarCom(sock, JID_GRUPO, '/wiki Buraco Negro')
    const caption = String(enviadas.find((e) => e.conteudo?.image)?.conteudo?.caption || '')
    if (caption.includes('...')) throw new Error('não deveria truncar resumo curto')
    if (!caption.includes('gravidade intensa.')) throw new Error('resumo completo ausente')
  })

  await testar('termo ausente → aviso de uso, sem consultar', async () => {
    modoWiki = 'ok'
    chamadas.length = 0
    const { sock, enviadas } = criarSock()
    await executarCom(sock, JID_GRUPO, '/wiki')
    if (chamadas.length !== 0) throw new Error('consultou sem termo')
    const texto = textoUnico(enviadas)
    if (!texto || !/Me diga o que procurar/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  await testar('rede fora → aviso amigável sem propagar', async () => {
    const fetchMockado = global.fetch
    global.fetch = async () => { throw new Error('ENOTFOUND: sem rede') }
    try {
      const { sock, enviadas } = criarSock()
      await executarCom(sock, JID_GRUPO, '/wiki Buraco Negro')
      const texto = textoUnico(enviadas)
      if (!texto || !/fora do alcance/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
    } finally {
      global.fetch = fetchMockado
    }
  })

  await testar('download da imagem falhando → envia só o texto', async () => {
    modoWiki = 'ok'
    modoBusca = 'ok'
    modoImagem = 'erro'
    resumoFake = criarResumoFake()
    const { sock, enviadas } = criarSock()
    await executarCom(sock, JID_GRUPO, '/wiki Buraco Negro')
    modoImagem = 'ok'
    if (enviadas.some((e) => e.conteudo?.image)) throw new Error('não deveria enviar imagem quebrada')
    const texto = textoUnico(enviadas)
    if (!texto || !/https:\/\/pt\.wikipedia\.org\/wiki\/Buraco_negro/.test(texto)) {
      throw new Error('texto sem o link do artigo')
    }
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()