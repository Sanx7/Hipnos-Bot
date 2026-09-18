// ============================================
// 🧪 teste-cep.js — Valida o comando /cep (BrasilAPI + fallback ViaCEP)
// ============================================
// RODA OFFLINE: substitui global.fetch por um mock (com contagem das URLs
// e cenários controlados por serviço — mesmo padrão do teste-ddd.js).
// Verifica:
//   - exports (nome, aliases, descricao, categoria);
//   - validação: aceita com/sem hífen; rejeita sem parâmetro e entradas
//     com menos/mais de 8 dígitos SEM consultar nenhuma API;
//   - sucesso na BrasilAPI v2: rua, bairro, cidade, UF e coordenadas;
//   - base sem coordenadas: mensagem sai sem a linha delas;
//   - fallback: BrasilAPI 404/500/quebrada/sem rede → ViaCEP responde;
//   - CEP inexistente (404 na BrasilAPI + {"erro":true} na ViaCEP) →
//     aviso amigável;
//   - as duas APIs fora → aviso amigável sem propagar erro.
// Uso: node scripts/teste-cep.js
// ============================================

// Controles dos cenários
let modoBrasil = 'ok' // 'ok' | '404' | 'erro500' | 'quebrada' | 'rede-fora'
let modoVia = 'ok'    // 'ok' | '404' | 'erro500' | 'rede-fora' | 'erro-true'
let respostaBrasil = {}
let respostaVia = {}

const fetchReal = global.fetch
const urlsChamadas = []
global.fetch = async (url) => {
  const endereco = String(url)
  if (endereco.includes('brasilapi.com.br')) {
    urlsChamadas.push(endereco)
    if (modoBrasil === '404') return { ok: false, status: 404 }
    if (modoBrasil === 'erro500') return { ok: false, status: 500 }
    if (modoBrasil === 'rede-fora') throw new Error('ENOTFOUND: sem rede')
    if (modoBrasil === 'quebrada') return { ok: true, status: 200, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(respostaBrasil)) }
  }
  if (endereco.includes('viacep.com.br')) {
    urlsChamadas.push(endereco)
    if (modoVia === '404') return { ok: false, status: 404 }
    if (modoVia === 'erro500') return { ok: false, status: 500 }
    if (modoVia === 'rede-fora') throw new Error('ENOTFOUND: sem rede')
    if (modoVia === 'erro-true') return { ok: true, status: 200, json: async () => ({ erro: true }) }
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(respostaVia)) }
  }
  return fetchReal(url)
}

const comando = require('../comandos/menu-utilitario/cep')

const JID_GRUPO = '120363000000000000@g.us'
const JID_PRIVADO = '5555000000001@s.whatsapp.net'

function criarMsg(texto = '/cep 01310-100', jid = JID_GRUPO) {
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

const brasilOk = () => ({
  cep: '01310100',
  state: 'SP',
  city: 'São Paulo',
  neighborhood: 'Bela Vista',
  street: 'Avenida Paulista',
  service: 'open-cep',
  location: { coordinates: { latitude: '-23.5613', longitude: '-46.6565' } }
})

const viaOk = () => ({
  cep: '22041-011',
  logradouro: 'Praia de Copacabana',
  bairro: 'Copacabana',
  localidade: 'Rio de Janeiro',
  uf: 'RJ',
  erro: false
})

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

  await testar('exports: nome, aliases, descricao e categoria', async () => {
    if (comando.nome !== 'cep') throw new Error(`nome: ${comando.nome}`)
    if (typeof comando.executar !== 'function') throw new Error('sem executar')
    if (!comando.descricao) throw new Error('sem descricao')
    if (comando.categoria !== 'utilitario') throw new Error(`categoria: ${comando.categoria}`)
    for (const apelido of ['consulta-cep', 'consultacep']) {
      if (!comando.aliases?.includes(apelido)) throw new Error(`alias ausente: ${apelido}`)
    }
  })

  await testar('sucesso na BrasilAPI v2: endereço completo + coordenadas', async () => {
    modoBrasil = 'ok'
    modoVia = 'ok'
    respostaBrasil = brasilOk()
    respostaVia = viaOk()
    urlsChamadas.length = 0
    const { sock, enviadas } = criarSock()
    await executarCom(sock, JID_GRUPO, '/cep 01310-100')
    if (urlsChamadas.length !== 1 || !urlsChamadas[0].endsWith('/cep/v2/01310100')) {
      throw new Error(`URLs: ${urlsChamadas.join(' | ')}`)
    }
    const texto = textoUnico(enviadas)
    if (!texto || !/ENDEREÇO DO CEP 01310-100/i.test(texto)) throw new Error(`cabeçalho: ${texto}`)
    if (!texto.includes('Avenida Paulista')) throw new Error('rua ausente')
    if (!texto.includes('Bela Vista')) throw new Error('bairro ausente')
    if (!texto.includes('São Paulo')) throw new Error('cidade ausente')
    if (!texto.includes('SP')) throw new Error('UF ausente')
    if (!texto.includes('-23.5613, -46.6565')) throw new Error('coordenadas ausentes')
    if (!texto.includes('BrasilAPI')) throw new Error('fonte ausente')
    if (texto.includes('ViaCEP')) throw new Error('fallback citado sem motivo')
  })

  await testar('formatos: aceita sem hífen e rejeita malformado SEM consultar', async () => {
    modoBrasil = 'ok'
    modoVia = 'ok'
    respostaBrasil = brasilOk()
    // Sem hífen
    urlsChamadas.length = 0
    let { sock, enviadas } = criarSock()
    await executarCom(sock, JID_GRUPO, '/cep 01310100')
    if (!urlsChamadas[0]?.endsWith('/cep/v2/01310100')) throw new Error('sem hífen falhou')
    if (!textoUnico(enviadas)?.includes('Avenida Paulista')) throw new Error('resposta ausente')
    // Sem parâmetro
    urlsChamadas.length = 0
    ;({ sock, enviadas } = criarSock())
    await executarCom(sock, JID_GRUPO, '/cep')
    if (urlsChamadas.length !== 0) throw new Error('consultou sem CEP')
    if (!/Me diga qual CEP/i.test(textoUnico(enviadas) || '')) throw new Error('aviso de uso ausente')
    // 7 dígitos
    urlsChamadas.length = 0
    ;({ sock, enviadas } = criarSock())
    await executarCom(sock, JID_GRUPO, '/cep 1310100')
    if (urlsChamadas.length !== 0) throw new Error('consultou com 7 dígitos')
    // 9 dígitos
    urlsChamadas.length = 0
    ;({ sock, enviadas } = criarSock())
    await executarCom(sock, JID_GRUPO, '/cep 013101001')
    if (urlsChamadas.length !== 0) throw new Error('consultou com 9 dígitos')
    const texto = textoUnico(enviadas)
    if (!texto || !/Me diga qual CEP/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  await testar('sem coordenadas na base: mensagem sai SEM a linha delas', async () => {
    modoBrasil = 'ok'
    modoVia = 'ok'
    respostaBrasil = { ...brasilOk(), location: {} }
    respostaVia = viaOk()
    const { sock, enviadas } = criarSock()
    await executarCom(sock, JID_GRUPO, '/cep 01310100')
    const texto = textoUnico(enviadas)
    if (!texto || texto.includes('Coordenadas')) throw new Error('coordenadas vazias vazaram')
    if (!texto.includes('Avenida Paulista')) throw new Error('endereço ausente')
  })


  await testar('fallback: BrasilAPI fora/404/quebrada → ViaCEP responde', async () => {
    for (const modo of ['404', 'erro500', 'rede-fora', 'quebrada']) {
      modoBrasil = modo
      modoVia = 'ok'
      respostaBrasil = brasilOk()
      respostaVia = viaOk()
      urlsChamadas.length = 0
      const { sock, enviadas } = criarSock()
      await executarCom(sock, JID_GRUPO, '/cep 22041-011')
      if (urlsChamadas.length !== 2) throw new Error(`${modo}: esperava 2 consultas, houve ${urlsChamadas.length}`)
      if (!urlsChamadas[1].endsWith('/ws/22041011/json/')) throw new Error(`${modo}: ViaCEP não chamado`)
      const texto = textoUnico(enviadas)
      if (!texto || !texto.includes('Praia de Copacabana')) throw new Error(`${modo}: endereço ausente`)
      if (!texto.includes('Rio de Janeiro') || !texto.includes('RJ')) throw new Error(`${modo}: cidade/UF ausentes`)
      if (!texto.includes('Fonte: *ViaCEP*')) throw new Error(`${modo}: fonte errada`)
    }
    modoBrasil = 'ok'
  })

  await testar('CEP inexistente (BrasilAPI 404 + ViaCEP erro:true) → aviso amigável', async () => {
    modoBrasil = '404'
    modoVia = 'erro-true'
    urlsChamadas.length = 0
    const { sock, enviadas } = criarSock()
    await executarCom(sock, JID_PRIVADO, '/cep 99999999')
    modoBrasil = 'ok'
    modoVia = 'ok'
    if (urlsChamadas.length !== 2) throw new Error(`esperava 2 consultas, houve ${urlsChamadas.length}`)
    const texto = textoUnico(enviadas)
    if (!texto || !/não existe nos mapas do Brasil/i.test(texto)) {
      throw new Error(`aviso inesperado: ${texto}`)
    }
  })

  await testar('as duas APIs fora → aviso amigável, sem propagar erro', async () => {
    modoBrasil = 'erro500'
    modoVia = 'rede-fora'
    urlsChamadas.length = 0
    let { sock, enviadas } = criarSock()
    await executarCom(sock, JID_GRUPO, '/cep 01310-100')
    let texto = textoUnico(enviadas)
    if (urlsChamadas.length !== 2) throw new Error(`esperava 2 consultas, houve ${urlsChamadas.length}`)
    if (!texto || !/rotas do limbo/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)

    // Timeout da BrasilAPI + ViaCEP 500 também cai no mesmo aviso
    const fetchOriginal = global.fetch
    global.fetch = async (url) => {
      const endereco = String(url)
      if (endereco.includes('brasilapi.com.br')) {
        urlsChamadas.push(endereco)
        const erro = new Error('The operation was aborted')
        erro.name = 'AbortError'
        throw erro
      }
      if (endereco.includes('viacep.com.br')) {
        urlsChamadas.push(endereco)
        return { ok: false, status: 500 }
      }
      return fetchOriginal(url)
    }
    try {
      ;({ sock, enviadas } = criarSock())
      await executarCom(sock, JID_GRUPO, '/cep 01310-100')
      const textoTimeout = textoUnico(enviadas)
      if (!textoTimeout || !/rotas do limbo/i.test(textoTimeout)) {
        throw new Error(`aviso inesperado (timeout): ${textoTimeout}`)
      }
    } finally {
      global.fetch = fetchReal
      modoBrasil = 'ok'
      modoVia = 'ok'
    }
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
