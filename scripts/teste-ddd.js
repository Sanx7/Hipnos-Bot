// ============================================
// 🧪 teste-ddd.js — Valida o comando /ddd (BrasilAPI, offline)
// ============================================
// RODA OFFLINE: substitui global.fetch por um mock da BrasilAPI (com
// contagem das URLs chamadas e cenários controlados). Verifica:
//   - exports (nome, aliases, descricao, categoria) + registro de aliases
//     como o loader do bot.js faria;
//   - extração do DDD: direto (/ddd 11), número completo (11999998888 → 11)
//     e com DDI (+55 11 99999-8888 → 11);
//   - entradas malformadas (sem parâmetro, 1 dígito, "10") → aviso de uso;
//   - mensagem com estado, total e lista truncada (15 + nota de restantes);
//   - HTTP 404 → "DDD não existe"; falha de API/rede → aviso amigável
//     sem propagar erro;
//   - funciona no privado.
// Uso: node scripts/teste-ddd.js
// ============================================

// Controles dos cenários
let modoBrasilApi = 'ok' // 'ok' | '404' | 'erro500' | 'rede-fora'
let respostaFake = { state: 'SP', cities: [] }

// ─── Mock do global.fetch ───
const fetchReal = global.fetch
const urlsChamadas = []
global.fetch = async (url) => {
  const endereco = String(url)
  if (endereco.includes('brasilapi.com.br')) {
    urlsChamadas.push(endereco)
    if (modoBrasilApi === '404') return { ok: false, status: 404 }
    if (modoBrasilApi === 'erro500') return { ok: false, status: 500 }
    if (modoBrasilApi === 'rede-fora') throw new Error('ENOTFOUND: sem rede')
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(respostaFake)) }
  }
  return fetchReal(url)
}

const comando = require('../comandos/utilitario/ddd')

// ─── Mocks de mensagem/sock ───
const JID_GRUPO = '120363000000000000@g.us'
const JID_PRIVADO = '5555000000001@s.whatsapp.net'

function criarMsg(texto = '/ddd 11', jid = JID_GRUPO) {
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

const textoUnico = (enviadas) => {
  const textos = enviadas.filter((e) => e.conteudo?.text)
  return textos.length === 1 ? textos[0].conteudo.text : null
}

// Simula o roteador do bot.js: chama executar(sock, jid, msg, text)
async function executarCom(sock, jid, texto) {
  return comando.executar(sock, jid, criarMsg(texto, jid), texto)
}

// 25 cidades fake em MAIÚSCULAS e fora de ordem (a BrasilAPI devolve assim;
// o comando deve formatar em título-case e ordenar em pt-BR)
function gerarCidades(quantidade) {
  const base = [
    'VOTORANTIM', 'ARAÇATUBA', 'CAMPINAS', 'OSASCO', 'ITU',
    'SOROCABA', 'GUARULHOS', 'JUNDIAÍ', 'DIADEMA', 'MAUÁ',
    'SÃO BERNARDO DO CAMPO', 'SANTO ANDRÉ', 'RIBEIRÃO PRETO', 'BAURU', 'TAUBATÉ',
    'CARAPICUÍBA', 'BARUERI', 'COTIA', 'ITAPEVI', 'FERRAZ DE VASCONCELOS',
    'POÁ', 'SALESÓPOLIS', 'UBATUBA', 'VINHEDO', 'EMBU DAS ARTES'
  ]
  return base.slice(0, quantidade)
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
    if (comando.nome !== 'ddd') throw new Error(`nome: ${comando.nome}`)
    if (JSON.stringify(comando.aliases) !== JSON.stringify(['estado-ddd', 'cidades-ddd'])) {
      throw new Error(`aliases: ${JSON.stringify(comando.aliases)}`)
    }
    if (!/Consulta o estado e as principais cidades pertencentes a um DDD do Brasil\./.test(comando.descricao)) {
      throw new Error(`descricao: ${comando.descricao}`)
    }
    if (comando.categoria !== 'utilitario') throw new Error(`categoria: ${comando.categoria}`)
    if (typeof comando.executar !== 'function') throw new Error('executar não é função')
    comandos.set(comando.nome, comando)
    for (const apelido of comando.aliases) {
      if (!comandos.has(apelido)) comandos.set(apelido, comando)
    }
    for (const rota of ['ddd', 'estado-ddd', 'cidades-ddd']) {
      if (comandos.get(rota) !== comando) throw new Error(`rota /${rota} não resolve para o módulo`)
    }
  })

  await testar('lista longa (25 cidades): estado, total, 15 exibidas + nota de restantes', async () => {
    modoBrasilApi = 'ok'
    respostaFake = { state: 'SP', cities: gerarCidades(25) }
    urlsChamadas.length = 0
    const { sock, enviadas } = criarSock()
    await executarCom(sock, JID_GRUPO, '/ddd 11')
    if (urlsChamadas.length !== 1) throw new Error(`esperava 1 consulta, houve ${urlsChamadas.length}`)
    if (!urlsChamadas[0].endsWith('/ddd/v1/11')) throw new Error(`URL inesperada: ${urlsChamadas[0]}`)
    const texto = textoUnico(enviadas)
    if (!texto || !/Estado: \*SP\*/.test(texto)) throw new Error('estado ausente')
    if (!texto || !/\*25\* cidades/.test(texto)) throw new Error('total de cidades ausente')
    if (!texto || !texto.includes('• Araçatuba')) throw new Error('1ª cidade (ordem pt-BR) ausente')
    if (!texto || !texto.includes('• Embu das Artes')) throw new Error('título-case ausente (EMBU DAS ARTES → Embu das Artes)')
    if (!texto || !texto.includes('• Osasco')) throw new Error('15ª cidade (Osasco) deveria estar exibida')
    if (texto && texto.includes('• Poá')) throw new Error('16ª cidade não deveria ser exibida')
    if (!texto || !/\+10 cidades seguem dormindo no limbo/.test(texto)) throw new Error('nota de restantes ausente')
    if (!texto || !/mostradas 15 de 25/.test(texto)) throw new Error('resumo "15 de 25" ausente')
  })

  await testar('lista curta (3 cidades): todas exibidas sem nota de restantes', async () => {
    modoBrasilApi = 'ok'
    respostaFake = { state: 'SP', cities: gerarCidades(3) }
    urlsChamadas.length = 0
    const { sock, enviadas } = criarSock()
    await executarCom(sock, JID_GRUPO, '/ddd 11')
    const texto = textoUnico(enviadas)
    if (!texto || !/\*3\* cidades/.test(texto)) throw new Error('total de cidades ausente')
    if (!texto || !texto.includes('• Votorantim')) throw new Error('cidade exibida deveria aparecer')
    if (texto && texto.includes('dormindo no limbo')) throw new Error('não deveria haver nota de restantes')
  })

  await testar('número completo e DDI: extrai os 2 primeiros dígitos do DDD', async () => {
    modoBrasilApi = 'ok'
    respostaFake = { state: 'SP', cities: gerarCidades(3) }
    urlsChamadas.length = 0
    const { sock, enviadas } = criarSock()
    await executarCom(sock, JID_GRUPO, '/ddd 11999998888')
    await executarCom(sock, JID_GRUPO, '/ddd +55 (11) 99999-8888')
    if (urlsChamadas.length !== 2) throw new Error(`esperava 2 consultas, houve ${urlsChamadas.length}`)
    if (!urlsChamadas[0].endsWith('/ddd/v1/11')) throw new Error(`número completo → URL: ${urlsChamadas[0]}`)
    if (!urlsChamadas[1].endsWith('/ddd/v1/11')) throw new Error(`com DDI → URL: ${urlsChamadas[1]}`)
  })

  await testar('sem parâmetro ou malformado → aviso de uso, sem consultar', async () => {
    modoBrasilApi = 'ok'
    // Sem parâmetro
    urlsChamadas.length = 0
    let { sock, enviadas } = criarSock()
    await executarCom(sock, JID_GRUPO, '/ddd')
    let texto = textoUnico(enviadas)
    if (urlsChamadas.length !== 0) throw new Error('consultou sem DDD informado')
    if (!texto || !/Me diga qual DDD/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
    // 1 dígito só
    urlsChamadas.length = 0
    ;({ sock, enviadas } = criarSock())
    await executarCom(sock, JID_GRUPO, '/ddd 7')
    if (urlsChamadas.length !== 0) throw new Error('consultou com 1 dígito')
    // "10" (DDD abaixo de 11)
    urlsChamadas.length = 0
    ;({ sock, enviadas } = criarSock())
    await executarCom(sock, JID_GRUPO, '/ddd 10')
    if (urlsChamadas.length !== 0) throw new Error('consultou com DDD 10')
    texto = textoUnico(enviadas)
    if (!texto || !/Me diga qual DDD/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  await testar('HTTP 404 → avisa que o DDD não existe no Brasil', async () => {
    modoBrasilApi = '404'
    urlsChamadas.length = 0
    const { sock, enviadas } = criarSock()
    await executarCom(sock, JID_GRUPO, '/ddd 39')
    modoBrasilApi = 'ok'
    const texto = textoUnico(enviadas)
    if (!texto || !/não existe nos mapas do Brasil/i.test(texto)) {
      throw new Error(`aviso inesperado: ${texto}`)
    }
  })

  await testar('falha de API/rede → aviso amigável sem propagar', async () => {
    modoBrasilApi = 'erro500'
    urlsChamadas.length = 0
    let { sock, enviadas } = criarSock()
    await executarCom(sock, JID_GRUPO, '/ddd 21')
    let texto = textoUnico(enviadas)
    if (!texto || !/rotas do limbo/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)

    modoBrasilApi = 'rede-fora'
    urlsChamadas.length = 0
    ;({ sock, enviadas } = criarSock())
    await executarCom(sock, JID_PRIVADO, '/ddd 21')
    modoBrasilApi = 'ok'
    texto = textoUnico(enviadas)
    if (!texto || !/rotas do limbo/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()