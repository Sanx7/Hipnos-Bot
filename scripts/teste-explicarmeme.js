// ============================================
// 🧪 teste-explicarmeme.js — Valida o /explicarmeme (IA com VISÃO)
// ============================================
// RODA 100% OFFLINE: nenhuma requisição de rede é feita.
//   - o núcleo de IA é injetado com _injetarIa() na maioria dos casos;
//   - nos testes de integração, usa _restaurarIa() + fetch SIMULADO (nunca
//     real) para exercitar o código de verdade (montagem do corpo multimodal,
//     HTTP 401/429/500, timeout, resposta vazia e o fallback entre modelos);
//   - o download da imagem também é injetado (_injetarDownload), então o teste
//     nunca toca na rede do WhatsApp.
// Provedor: OPENROUTER (mesmo client do /resumir e do /reescrever).
// Verifica:
//   - exports (nome, aliases, categoria, ganchos e __internos);
//   - modelo COM VISÃO (não pode ser o de só texto dos outros comandos) e a
//     lista de candidatos :free que aceitam imagem;
//   - as DUAS formas de uso (imagem na legenda e imagem citada em reply) —
//     o bug do /s (só reply) NÃO pode existir aqui;
//   - sem imagem → ajuda, sem chamar a IA;
//   - imagem corrompida/vazia → aviso amigável;
//   - corpo multimodal montado certo (text + image_url com data URL base64);
//   - fallback entre modelos de visão quando um dá 429;
//   - falhas de API: sem chave, 401, 429, timeout, resposta vazia, HTTP 500;
//   - resposta longa dividida em blocos de 2500 caracteres.
// Uso: node scripts/teste-explicarmeme.js
// ============================================

const assert = require('assert')
const explicarmeme = require('../comandos/menu-utilitario/explicarmeme')
const I = explicarmeme.__internos

const JID = '120363000000000000@g.us'
const MSG = { key: { remoteJid: JID, fromMe: false, id: 'MSG' }, message: { conversation: '/explicarmeme' } }
const RESPOSTA_IA = 'É o meme do boneco "Plans", que explodiu na internet por causa das edições hilárias.'

// 🖼️ JPEG 1x1 válido (base64) — só usado como payload p/ os mocks
const JPEG_1X1_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiiv/9k='

const BUFFER_JPEG = Buffer.from(JPEG_1X1_BASE64, 'base64')

// 🖼️ Monta mensagens nos DOIS formatos aceitos pelo comando:
//    (a) legenda: { imageMessage: { ..., contextInfo: { caption } } }
//    (b) reply:   { extendedTextMessage: { contextInfo: { quotedMessage: { imageMessage } } } }
function msgLegenda () {
  return {
    key: { remoteJid: JID, fromMe: false, id: 'M1' },
    message: {
      imageMessage: {
        mimetype: 'image/jpeg',
        caption: '/explicarmeme',
        mediaKey: 'k',
        directPath: '/x',
        url: 'https://mmg.whatsapp.net/x'
      }
    }
  }
}

function msgReply () {
  return {
    key: { remoteJid: JID, fromMe: false, id: 'M2' },
    message: {
      extendedTextMessage: {
        text: '/explicarmeme',
        contextInfo: {
          quotedMessage: {
            imageMessage: {
              mimetype: 'image/jpeg',
              mediaKey: 'k',
              directPath: '/x',
              url: 'https://mmg.whatsapp.net/x'
            }
          }
        }
      }
    }
  }
}

function criarSock () {
  const enviadas = []
  const sock = {
    user: { id: '5555999999999:12@s.whatsapp.net' },
    enviadas,
    async sendMessage (jid, conteudo, opcoes) {
      enviadas.push({ jid, conteudo, opcoes })
      return { key: { id: 'fake' } }
    }
  }
  return { sock, enviadas }
}

function textoEnviado (sock) {
  return sock.enviadas.map((e) => e.conteudo?.text || '').join('\n')
}

// 🧪 Injeta um download falso (nunca toca na rede do WhatsApp) e restaura ao
//    final. Um buffer vazio (0 bytes) simula imagem corrompida.
function comDownloadFalso (buffer, fn) {
  explicarmeme._injetarDownload(async () => (async function * () { yield buffer })())
  return Promise.resolve()
    .then(fn)
    .finally(() => explicarmeme._restaurarDownload())
}

let reprovadas = 0
async function testar (nome, fn) {
  try {
    await fn()
    console.log('✅ ' + nome)
  } catch (err) {
    reprovadas += 1
    console.error('❌ ' + nome + ' →', err?.message || err)
  }
}

async function principal () {
  // ─── 📦 EXPORTS ───
  await testar('exports: nome, aliases, categoria e função executar', () => {
    assert.strictEqual(explicarmeme.nome, 'explicarmeme')
    assert.ok(explicarmeme.aliases.includes('explicameme'))
    assert.strictEqual(explicarmeme.categoria, 'utilitario')
    assert.strictEqual(typeof explicarmeme.executar, 'function')
    assert.strictEqual(typeof explicarmeme._injetarIa, 'function')
    assert.strictEqual(typeof explicarmeme._injetarDownload, 'function')
    assert.ok(I && I.SYSTEM_PROMPT)
  })

  // ─── 👁️ MODELO COM VISÃO ───
  await testar('modelo padrão é de VISÃO (não pode ser o de só texto do /resumir)', () => {
    assert.notStrictEqual(I.MODELO_PADRAO, 'nvidia/nemotron-3-super-120b-a12b:free')
    assert.ok(I.MODELOS_VISAO.length >= 1)
    for (const m of I.MODELOS_VISAO) {
      assert.ok(m.endsWith(':free'), m + ' não é gratuito (:free)')
    }
  })

  await testar('endpoint é a OpenRouter (mesmo client do /resumir)', () => {
    assert.strictEqual(I.URL_OPENROUTER_CHAT, 'https://openrouter.ai/api/v1/chat/completions')
  })

  await testar('EXPLICARMEME_MODEL fixa o modelo; sem ele usa o padrão', () => {
    const antes = process.env.EXPLICARMEME_MODEL
    try {
      delete process.env.EXPLICARMEME_MODEL
      assert.strictEqual(I.modeloExplicarMeme(), I.MODELO_PADRAO)
      process.env.EXPLICARMEME_MODEL = 'google/gemma-4-31b-it:free'
      assert.strictEqual(I.modeloExplicarMeme(), 'google/gemma-4-31b-it:free')
    } finally {
      if (antes === undefined) delete process.env.EXPLICARMEME_MODEL
      else process.env.EXPLICARMEME_MODEL = antes
    }
  })

  // ─── 🧠 PROMPT FIXO ───
  await testar('prompt fixo pede humor/contexto/referência em pt-BR e resposta curta', () => {
    const p = I.SYSTEM_PROMPT
    assert.ok(/humor/i.test(p), 'não fala de humor')
    assert.ok(/contexto/i.test(p), 'não fala de contexto')
    assert.ok(/refer[êe]ncia/i.test(p), 'não fala de referência')
    assert.ok(/3 frases/.test(p), 'não pede resposta curta')
  })

  // ─── 📎 CAPTURA: AS DUAS FORMAS (o bug do /s não pode existir) ───
  await testar('CAPTURA: imagem na legenda é detectada', () => {
    const achado = I.localizarImagem(msgLegenda())
    assert.ok(achado, 'não achou a imagem da legenda')
    assert.strictEqual(achado.origem, 'enviada')
    assert.strictEqual(achado.midia.mimetype, 'image/jpeg')
  })

  await testar('CAPTURA: imagem citada em reply é detectada', () => {
    const achado = I.localizarImagem(msgReply())
    assert.ok(achado, 'não achou a imagem citada')
    assert.strictEqual(achado.origem, 'citada')
  })

  await testar('CAPTURA: sem imagem devolve null (texto puro)', () => {
    assert.strictEqual(I.localizarImagem(MSG), null)
    assert.strictEqual(I.localizarImagem({}), null)
  })

  await testar('CAPTURA: documento com mime de imagem também vale', () => {
    const achado = I.localizarImagem({ message: { documentMessage: { mimetype: 'image/png' } } })
    assert.ok(achado)
    assert.strictEqual(achado.origem, 'documento enviado')
  })

  // ─── 🧩 MAGIC BYTES ───
  await testar('mimePeloBuffer reconhece jpeg, png, gif e webp', () => {
    assert.strictEqual(I.mimePeloBuffer(Buffer.from([0xff, 0xd8, 0x00])), 'image/jpeg')
    assert.strictEqual(I.mimePeloBuffer(Buffer.from([0x89, 0x50, 0x00])), 'image/png')
    assert.strictEqual(I.mimePeloBuffer(Buffer.from([0x47, 0x49, 0x00])), 'image/gif')
    const webp = Buffer.alloc(12)
    webp[8] = 0x57
    webp[9] = 0x45
    assert.strictEqual(I.mimePeloBuffer(webp), 'image/webp')
    assert.strictEqual(I.mimePeloBuffer(Buffer.from([0, 1, 2])), null)
  })

  // ─── 🖼️ CONVERSÃO PARA BASE64 ───
  await testar('imagem vira data URL base64 com o mime certo', async () => {
    await comDownloadFalso(BUFFER_JPEG, async () => {
      const dataUrl = await I.imagemParaBase64({ mimetype: 'image/jpeg' })
      assert.ok(dataUrl.startsWith('data:image/jpeg;base64,'))
      const b64 = dataUrl.split(',')[1]
      assert.strictEqual(Buffer.from(b64, 'base64').length, BUFFER_JPEG.length)
    })
  })

  await testar('imagem sem mimetype na msg: adivinha pelos magic bytes', async () => {
    await comDownloadFalso(BUFFER_JPEG, async () => {
      const dataUrl = await I.imagemParaBase64({})
      assert.ok(dataUrl.startsWith('data:image/jpeg;base64,'))
    })
  })

  await testar('imagem corrompida/vazia → erro do tipo imagem_invalida', async () => {
    await comDownloadFalso(Buffer.from([]), async () => {
      await assert.rejects(
        () => I.imagemParaBase64({ mimetype: 'image/jpeg' }),
        (err) => {
          assert.strictEqual(err.tipo, 'imagem_invalida')
          return true
        }
      )
    })
  })

  await testar('download que estoura (lixo) → aviso amigável, sem estourar', async () => {
    explicarmeme._injetarDownload(async () => { throw new Error('stream quebrado') })
    explicarmeme._injetarIa(async () => RESPOSTA_IA)
    const { sock } = criarSock()
    try {
      await explicarmeme.executar(sock, JID, msgLegenda(), '/explicarmeme')
    } finally {
      explicarmeme._restaurarDownload()
      explicarmeme._restaurarIa()
    }
    assert.ok(textoEnviado(sock).includes('não conseguiu ler'), textoEnviado(sock))
  })

  // ─── ❌ SEM IMAGEM ───
  await testar('sem imagem → mostra a ajuda e NÃO chama a IA', async () => {
    const { sock } = criarSock()
    let chamouIa = false
    explicarmeme._injetarIa(async () => { chamouIa = true; return RESPOSTA_IA })
    try {
      await explicarmeme.executar(sock, JID, MSG, '/explicarmeme')
    } finally {
      explicarmeme._restaurarIa()
    }
    assert.ok(!chamouIa, 'a IA não deveria ser chamada sem imagem')
    assert.ok(textoEnviado(sock).includes('EXPLICAR MEME'))
    assert.ok(textoEnviado(sock).includes('legenda'))
  })

  // ─── 😄 FLUXO FELIZ (os DOIS formatos) ───
  await testar('fluxo feliz: imagem NA LEGENDA explica e cita a mensagem', async () => {
    const { sock, enviadas } = criarSock()
    let dataUrlRecebida = null
    explicarmeme._injetarIa(async (dataUrl) => { dataUrlRecebida = dataUrl; return RESPOSTA_IA })
    try {
      await comDownloadFalso(BUFFER_JPEG, async () => {
        await explicarmeme.executar(sock, JID, msgLegenda(), '/explicarmeme')
      })
    } finally {
      explicarmeme._restaurarIa()
    }
    assert.ok(dataUrlRecebida && dataUrlRecebida.startsWith('data:image/'), 'IA não recebeu a imagem')
    assert.ok(textoEnviado(sock).includes(RESPOSTA_IA))
    assert.ok(textoEnviado(sock).includes('DECIFROU A ZOEIRA'))
    assert.ok(enviadas.some((e) => e.opcoes?.quoted), 'a resposta não citava o usuário')
  })

  await testar('fluxo feliz: imagem CITADA em reply também explica', async () => {
    const { sock } = criarSock()
    let recebeu = false
    explicarmeme._injetarIa(async () => { recebeu = true; return RESPOSTA_IA })
    try {
      await comDownloadFalso(BUFFER_JPEG, async () => {
        await explicarmeme.executar(sock, JID, msgReply(), '/explicarmeme')
      })
    } finally {
      explicarmeme._restaurarIa()
    }
    assert.ok(recebeu, 'a IA não foi chamada no formato reply')
    assert.ok(textoEnviado(sock).includes(RESPOSTA_IA))
  })

  // ─── ✂️ BLOCOS ───
  await testar('resposta longa é dividida em blocos de 2500', () => {
    const longa = 'palavra '.repeat(600) // ~4800 chars
    const blocos = I.dividirEmBlocos(longa)
    assert.ok(blocos.length > 1, 'não dividiu')
    for (const b of blocos) assert.ok(b.length <= I.TAMANHO_BLOCO, 'bloco maior que o limite')
    assert.strictEqual(blocos.join(' ').replace(/\s+/g, ' '), longa.trim().replace(/\s+/g, ' '))
    assert.deepStrictEqual(I.dividirEmBlocos('curto'), ['curto'])
    assert.deepStrictEqual(I.dividirEmBlocos('   '), [])
  })

  await testar('executor envia blocos e cita só no primeiro', async () => {
    const { sock, enviadas } = criarSock()
    explicarmeme._injetarIa(async () => 'palavra '.repeat(600))
    try {
      await comDownloadFalso(BUFFER_JPEG, async () => {
        await explicarmeme.executar(sock, JID, msgLegenda(), '/explicarmeme')
      })
    } finally {
      explicarmeme._restaurarIa()
    }
    const comTexto = enviadas.filter((e) => e.conteudo?.text && !e.conteudo.text.includes('decifrando'))
    assert.ok(comTexto.length > 1, 'esperava mais de um bloco')
    assert.ok(comTexto[0].opcoes?.quoted, 'o 1º bloco deve citar')
    assert.ok(!comTexto[1].opcoes?.quoted, 'os demais não devem citar')
  })

  // ─── ⛔ FALHAS DA API (núcleo real + fetch SIMULADO, nunca rede) ───
  const fetchOriginal = global.fetch
  const envChaveOriginal = process.env.OPENROUTER_API_KEY

  function simularFetch (status, corpo) {
    global.fetch = async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => corpo
    })
    process.env.OPENROUTER_API_KEY = 'chave-falsa-teste'
  }

  function restaurar () {
    global.fetch = fetchOriginal
    if (envChaveOriginal === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = envChaveOriginal
  }

  await testar('API: sem OPENROUTER_API_KEY → erro sem_chave, sem exceção', async () => {
    explicarmeme._restaurarIa()
    delete process.env.OPENROUTER_API_KEY
    try {
      await assert.rejects(
        () => I.explicarComIa('data:image/jpeg;base64,AAA'),
        (err) => { assert.strictEqual(err.tipo, 'sem_chave'); return true }
      )
    } finally { restaurar() }
  })

  await testar('API: corpo multimodal montado certo (text + image_url base64)', async () => {
    let corpoEnviado = null
    let headersEnviados = null
    let urlEnviada = null
    global.fetch = async (url, opts) => {
      urlEnviada = url
      headersEnviados = opts.headers
      corpoEnviado = JSON.parse(opts.body)
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: RESPOSTA_IA } }] }) }
    }
    process.env.OPENROUTER_API_KEY = 'chave-falsa-teste'
    try {
      const r = await I.explicarComIa('data:image/jpeg;base64,QUJD')
      assert.strictEqual(r, RESPOSTA_IA)
      assert.strictEqual(urlEnviada, I.URL_OPENROUTER_CHAT)
      assert.strictEqual(headersEnviados.Authorization, 'Bearer chave-falsa-teste')
      assert.ok(headersEnviados['HTTP-Referer'], 'faltou HTTP-Referer')
      assert.ok(headersEnviados['X-Title'], 'faltou X-Title')
      assert.strictEqual(corpoEnviado.model, I.MODELO_PADRAO)
      assert.strictEqual(corpoEnviado.messages[0].content, I.SYSTEM_PROMPT)
      const parts = corpoEnviado.messages[1].content
      assert.ok(Array.isArray(parts), 'content não é array (não é multimodal)')
      assert.strictEqual(parts[0].type, 'text')
      assert.ok(parts[0].text.length > 0)
      assert.strictEqual(parts[1].type, 'image_url')
      assert.strictEqual(parts[1].image_url.url, 'data:image/jpeg;base64,QUJD')
    } finally { restaurar() }
  })

  await testar('API: 401 (chave inválida) → não fica tentando outros modelos', async () => {
    let chamadas = 0
    global.fetch = async () => { chamadas++; return { ok: false, status: 401, json: async () => ({}) } }
    process.env.OPENROUTER_API_KEY = 'chave-falsa-teste'
    try {
      await assert.rejects(
        () => I.explicarComIa('data:image/jpeg;base64,QUJD'),
        (err) => { assert.strictEqual(err.tipo, 'chave_invalida'); return true }
      )
      assert.strictEqual(chamadas, 1, 'não deveria gastar chamada com o resto da lista')
    } finally { restaurar() }
  })

  await testar('API: 429 no 1º modelo → cai no próximo modelo de visão', async () => {
    let chamadas = 0
    const modelosVistos = []
    global.fetch = async (url, opts) => {
      chamadas++
      modelosVistos.push(JSON.parse(opts.body).model)
      if (chamadas === 1) return { ok: false, status: 429, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: RESPOSTA_IA } }] }) }
    }
    process.env.OPENROUTER_API_KEY = 'chave-falsa-teste'
    try {
      const r = await I.explicarComIa('data:image/jpeg;base64,QUJD')
      assert.strictEqual(r, RESPOSTA_IA)
      assert.strictEqual(chamadas, 2)
      assert.strictEqual(modelosVistos[0], I.MODELO_PADRAO)
      assert.strictEqual(modelosVistos[1], I.MODELOS_VISAO[1], 'não foi p/ o 2º candidato')
    } finally { restaurar() }
  })

  await testar('API: todos os modelos de visão dão 429 → erro de limite', async () => {
    let chamadas = 0
    global.fetch = async () => { chamadas++; return { ok: false, status: 429, json: async () => ({}) } }
    process.env.OPENROUTER_API_KEY = 'chave-falsa-teste'
    try {
      await assert.rejects(
        () => I.explicarComIa('data:image/jpeg;base64,QUJD'),
        (err) => { assert.strictEqual(err.tipo, 'limite'); return true }
      )
      assert.strictEqual(chamadas, I.MODELOS_VISAO.length, 'deveria tentar a lista inteira')
    } finally { restaurar() }
  })

  await testar('API: resposta vazia → erro do tipo vazia', async () => {
    simularFetch(200, { choices: [{ message: { content: '   ' } }] })
    try {
      await assert.rejects(
        () => I.explicarComIa('data:image/jpeg;base64,QUJD'),
        (err) => { assert.strictEqual(err.tipo, 'vazia'); return true }
      )
    } finally { restaurar() }
  })

  await testar('API: timeout (AbortError) → erro do tipo timeout', async () => {
    global.fetch = async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }
    process.env.OPENROUTER_API_KEY = 'chave-falsa-teste'
    try {
      await assert.rejects(
        () => I.explicarComIa('data:image/jpeg;base64,QUJD'),
        (err) => { assert.strictEqual(err.tipo, 'timeout'); return true }
      )
    } finally { restaurar() }
  })

  await testar('API: erro do executor NUNCA escapa (HTTP 500 no comando inteiro)', async () => {
    explicarmeme._restaurarIa()
    simularFetch(500, {})
    try {
      const { sock } = criarSock()
      await comDownloadFalso(BUFFER_JPEG, async () => {
        await explicarmeme.executar(sock, JID, msgLegenda(), '/explicarmeme')
      })
      assert.ok(textoEnviado(sock).length > 0, 'deveria ter mandado algum aviso')
    } finally { restaurar() }
  })

  await testar('API: sock quebrado não derruba o comando', async () => {
    const sockQuebrado = {
      user: { id: '1:1@s.whatsapp.net' },
      sendMessage: async () => { throw new Error('socket fora do ar') }
    }
    explicarmeme._injetarIa(async () => { throw Object.assign(new Error('ia fora'), { tipo: 'api' }) })
    try {
      await comDownloadFalso(BUFFER_JPEG, async () => {
        await explicarmeme.executar(sockQuebrado, JID, msgLegenda(), '/explicarmeme')
      })
    } finally {
      explicarmeme._restaurarIa()
    }
  })

  explicarmeme._restaurarIa()
  explicarmeme._restaurarDownload()
  restaurar()

  console.log('\n' + (reprovadas === 0
    ? '🎉 TODOS OS TESTES DO /explicarmeme PASSARAM!'
    : '💥 ' + reprovadas + ' teste(s) FALHARAM.'))
  if (reprovadas > 0) process.exitCode = 1
}

principal()
