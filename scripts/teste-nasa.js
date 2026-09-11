// ============================================
// 🧪 teste-nasa.js — Valida o comando /nasa (APOD + tradução Groq)
// ============================================
// RODA OFFLINE: substitui global.fetch por um mock que despacha por URL
// (api.nasa.gov, api.groq.com e o host da imagem fake), controlando cada
// cenário. Verifica:
//   - exports (nome, aliases, descricao, categoria) + registro de aliases
//     como o loader do bot.js faria;
//   - media_type "image" → envia { image: Buffer, caption } com título/
//     explicação traduzidos, data e créditos;
//   - media_type "video" → envia só texto com o link (funciona no privado);
//   - sem GROQ_API_KEY → texto original em inglês (fallback);
//   - Groq falhando (HTTP 500) → texto original, sem quebrar;
//   - NASA falhando (HTTP 500) → mensagem amigável;
//   - NASA 429 → aviso de limite (DEMO_KEY/NASA_API_KEY);
//   - download da imagem falhando → envia o link no texto.
// Uso: node scripts/teste-nasa.js
// ============================================

// Controles dos cenários (mudados a cada teste)
let modoNasa = 'ok' // 'ok' | 'erro500' | 'limite429'
let modoGroq = 'ok' // 'ok' | 'erro500'
let modoImagem = 'ok' // 'ok' | 'erro'

const APOD_FALSO = {
  date: '2026-09-11',
  explanation: 'A star factory in the nebula glows in the dark.',
  title: 'Pillars of Creation',
  media_type: 'image',
  url: 'https://img.teste/apod.jpg',
  hdurl: 'https://img.teste/apod_hd.jpg',
  copyright: 'NASA, ESA'
}
const TRADUCAO_FALSA = {
  titulo: 'Pilares da Criação',
  explicacao: 'Uma fábrica de estrelas brilha no escuro.'
}

// ─── Mock do global.fetch (despacha por URL) ───
const fetchReal = global.fetch
global.fetch = async (url) => {
  const endereco = String(url)
  if (endereco.includes('api.nasa.gov')) {
    if (modoNasa === 'erro500') return { ok: false, status: 500 }
    if (modoNasa === 'limite429') return { ok: false, status: 429 }
    return { ok: true, status: 200, json: async () => ({ ...APOD_FALSO }) }
  }
  if (endereco.includes('api.groq.com')) {
    if (modoGroq === 'erro500') return { ok: false, status: 500 }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(TRADUCAO_FALSA) } }] })
    }
  }
  if (endereco.includes('img.teste')) {
    if (modoImagem === 'erro') return { ok: false, status: 404 }
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) // assinatura JPEG falsa
    return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer }
  }
  return fetchReal(url)
}

const comando = require('../comandos/utilitario/nasa')

// ─── Mocks de mensagem/sock ───
const JID_GRUPO = '120363000000000000@g.us'
const JID_PRIVADO = '5555000000001@s.whatsapp.net'

function criarMsg(jid = JID_GRUPO) {
  return {
    key: {
      remoteJid: jid,
      fromMe: false,
      id: 'MSG123',
      participant: jid.endsWith('@g.us') ? '5555000000002@s.whatsapp.net' : undefined
    },
    message: { conversation: '/nasa' }
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

  // Chaves de teste (o .env real é ignorado neste teste)
  const chaveGroqOriginal = process.env.GROQ_API_KEY
  process.env.NASA_API_KEY = 'chave-nasa-teste'
  process.env.GROQ_API_KEY = 'chave-groq-teste'

  const comandos = new Map()

  await testar('exports corretos + aliases registrados como o loader faria', async () => {
    if (comando.nome !== 'nasa') throw new Error(`nome: ${comando.nome}`)
    if (JSON.stringify(comando.aliases) !== JSON.stringify(['apod', 'astronomia', 'foto-nasa'])) {
      throw new Error(`aliases: ${JSON.stringify(comando.aliases)}`)
    }
    if (!/Foto Astronômica do Dia \(APOD\) da NASA com explicação traduzida/.test(comando.descricao)) {
      throw new Error(`descricao: ${comando.descricao}`)
    }
    if (comando.categoria !== 'utilitario') throw new Error(`categoria: ${comando.categoria}`)
    if (typeof comando.executar !== 'function') throw new Error('executar não é função')
    comandos.set(comando.nome, comando)
    for (const apelido of comando.aliases) {
      if (!comandos.has(apelido)) comandos.set(apelido, comando)
    }
    for (const rota of ['nasa', 'apod', 'astronomia', 'foto-nasa']) {
      if (comandos.get(rota) !== comando) throw new Error(`rota /${rota} não resolve para o módulo`)
    }
  })

  await testar('media_type "image" → envia Buffer com legenda traduzida', async () => {
    modoNasa = 'ok'
    modoGroq = 'ok'
    modoImagem = 'ok'
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, criarMsg())
    if (enviadas.length !== 1) throw new Error(`esperava 1 envio, houve ${enviadas.length}`)
    const envio = enviadas[0]
    if (!Buffer.isBuffer(envio.conteudo.image)) throw new Error('conteúdo não é image:Buffer')
    const legenda = String(envio.conteudo.caption || '')
    for (const esperado of ['Pilares da Criação', 'fábrica de estrelas', '2026-09-11', 'NASA, ESA']) {
      if (!legenda.includes(esperado)) throw new Error(`legenda sem "${esperado}"`)
    }
    if (!envio.extra?.quoted) throw new Error('envio sem quoted')
  })

  await testar('media_type "video" → só texto com o link (funciona no privado)', async () => {
    modoNasa = 'ok'
    modoGroq = 'ok'
    modoImagem = 'ok'
    const fetchMockado = global.fetch
    // APOD de vídeo: troca o mock só neste teste
    global.fetch = async (url) => {
      const endereco = String(url)
      if (endereco.includes('api.nasa.gov')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ...APOD_FALSO, media_type: 'video', url: 'https://img.teste/video.mp4' })
        }
      }
      return fetchMockado(url)
    }
    try {
      const { sock, enviadas } = criarSock()
      await comando.executar(sock, JID_PRIVADO, criarMsg(JID_PRIVADO))
      if (enviadas.some((e) => e.conteudo?.image)) throw new Error('não deveria enviar imagem')
      const texto = textoUnico(enviadas)
      if (!texto || !/https:\/\/img\.teste\/video\.mp4/.test(texto)) throw new Error('link do vídeo ausente')
      if (!texto || !/Pilares da Criação/.test(texto)) throw new Error('título traduzido ausente')
    } finally {
      global.fetch = fetchMockado
    }
  })

  await testar('sem GROQ_API_KEY → texto original em inglês (fallback)', async () => {
    modoNasa = 'ok'
    modoGroq = 'ok'
    modoImagem = 'ok'
    delete process.env.GROQ_API_KEY
    try {
      const { sock, enviadas } = criarSock()
      await comando.executar(sock, JID_GRUPO, criarMsg())
      const legenda = String(enviadas.find((e) => e.conteudo?.image)?.conteudo?.caption || '')
      for (const esperado of ['Pillars of Creation', 'A star factory']) {
        if (!legenda.includes(esperado)) throw new Error(`legenda sem o original "${esperado}"`)
      }
    } finally {
      process.env.GROQ_API_KEY = 'chave-groq-teste'
    }
  })

  await testar('Groq falhando (HTTP 500) → texto original, sem quebrar', async () => {
    modoNasa = 'ok'
    modoGroq = 'erro500'
    modoImagem = 'ok'
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, criarMsg())
    const legenda = String(enviadas.find((e) => e.conteudo?.image)?.conteudo?.caption || '')
    if (!legenda.includes('Pillars of Creation')) throw new Error('fallback p/ texto original não aconteceu')
    if (legenda.includes('Pilares da Criação')) throw new Error('tradução deveria ter falhado')
  })

  await testar('NASA fora do ar (HTTP 500) → mensagem amigável', async () => {
    modoNasa = 'erro500'
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, criarMsg())
    const texto = textoUnico(enviadas)
    if (!texto || !/NASA está fora do ar/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  await testar('NASA 429 → aviso de limite citando a chave', async () => {
    modoNasa = 'limite429'
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, criarMsg())
    modoNasa = 'ok'
    const texto = textoUnico(enviadas)
    if (!texto || !/limite/i.test(texto) || !/NASA_API_KEY/.test(texto)) {
      throw new Error(`aviso de limite inesperado: ${texto}`)
    }
  })

  await testar('download da imagem falhando → envia o link no texto', async () => {
    modoNasa = 'ok'
    modoGroq = 'ok'
    modoImagem = 'erro'
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, criarMsg())
    const texto = textoUnico(enviadas)
    if (enviadas.some((e) => e.conteudo?.image)) throw new Error('não deveria enviar imagem quebrada')
    if (!texto || !/https:\/\/img\.teste\/apod\.jpg/.test(texto)) throw new Error('link da foto ausente')
    if (!texto || !/Pilares da Criação/.test(texto)) throw new Error('legenda deveria acompanhar o link')
  })

  // Restaura o ambiente real do processo
  process.env.GROQ_API_KEY = chaveGroqOriginal
  delete process.env.NASA_API_KEY

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()