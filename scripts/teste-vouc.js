// ============================================
// 🎭 TESTE OFFLINE — /verdadeouconsequencia
// ============================================
// Cobre: sorteio livre, forçar verdade, forçar desafio, com menção, sem menção,
// a trava diária determinística, LID → número real e os erros do executor.
// 100% offline: nenhuma chamada de rede (groupMetadata é mock, quando chamado).
//
// Rode com:  node scripts/teste-vouc.js
// ============================================

const assert = require('assert')
const vouc = require('../comandos/menu-brincadeiras/verdadeouconsequencia')
const { VERDADES, DESAFIOS } = require('../dados/perguntas-vouc')
const T = vouc.__teste

const JID_GRUPO = '5511900000000-123456@g.us'
const NUM_A = '5511999990001'
const NUM_B = '5522888880002'

let passou = 0
let falhou = 0

async function testar (nome, fn) {
  try {
    await fn()
    passou++
    console.log('  OK  ' + nome)
  } catch (err) {
    falhou++
    console.log('  XX  ' + nome)
    console.log('      ' + (err && err.message ? err.message : err))
  }
}

// ─── 🧪 Sock falso: registra o que foi enviado ───
// (os .enviados ficam NO PRÓPRIO sock, assim `textoEnviado(sock)` funciona
//  tanto com `const { sock } = ...` quanto com `const { sock, enviados } = ...`)
function criarSock (opcoes) {
  const enviados = []
  const { participantes, falharMetadata, falharEnvio } = opcoes || {}
  const sock = {
    user: { id: `${NUM_A}:1@s.whatsapp.net` },
    enviados,
    groupMetadata: async () => {
      if (falharMetadata) throw new Error('sem metadados')
      return { participants: participantes || [] }
    },
    sendMessage: async (jid, conteudo, opts) => {
      if (falharEnvio) throw new Error('socket fora do ar')
      enviados.push({ jid, conteudo, opts })
    }
  }
  return { sock, enviados }
}

function textoEnviado (sock) {
  return sock.enviados.map((e) => e.conteudo?.text || '').join('\n')
}

// ─── 🧪 Mensagens falsas ───
// Só texto, sem menção: o autor é msg.key.participant
function msgSimples (comando) {
  return {
    key: { participant: `${NUM_A}:1@s.whatsapp.net` },
    message: { extendedTextMessage: { text: comando, contextInfo: {} } }
  }
}

// Texto com @menção (JID "normalizado" que o Baileys entrega)
function msgComMencao (comando, menciona) {
  return {
    key: { participant: `${NUM_A}:1@s.whatsapp.net` },
    message: {
      extendedTextMessage: {
        text: comando,
        contextInfo: { mentionedJid: [`${menciona}:1@s.whatsapp.net`] }
      }
    }
  }
}

// ─── 🚀 Suíte ───
async function principal () {
  console.log('🎭 Testando o /verdadeouconsequencia...\n')

  // ─── 📦 Banco de conteúdo ───
  await testar('o banco tem 100+ verdade e 100+ desafio', () => {
    assert.ok(VERDADES.length >= 100, 'verdades: ' + VERDADES.length)
    assert.ok(DESAFIOS.length >= 100, 'desafios: ' + DESAFIOS.length)
  })

  await testar('o banco não tem pergunta repetida dentro de cada lista', () => {
    for (const [nome, lista] of [['verdades', VERDADES], ['desafios', DESAFIOS]]) {
      const minusculas = lista.map((p) => p.toLowerCase().trim())
      assert.strictEqual(new Set(minusculas).size, minusculas.length, nome + ' tem duplicada')
    }
  })

  await testar('toda pergunta é texto útil (não vazio, terminada corretamente)', () => {
    // Verdades são perguntas (terminam em "?"); desafios são ordens
    // ("Faca...", "Mande...", "Descreva...") e terminam em ponto.
    for (const p of VERDADES) {
      assert.ok(typeof p === 'string' && p.length > 8, 'verdade curta/vazia: ' + p)
      assert.ok(p.trim().endsWith('?'), 'verdade não termina em ?: ' + p)
    }
    for (const p of DESAFIOS) {
      assert.ok(typeof p === 'string' && p.length > 8, 'desafio curto/vazio: ' + p)
      assert.ok(p.trim().endsWith('.'), 'desafio não termina em ponto: ' + p)
    }
  })

  // ─── 🎲 Sorteio livre ───
  await testar('sorteio livre: devolve uma das duas categorias, com pergunta da lista', () => {
    for (let i = 0; i < 30; i++) {
      const s = T.sortear({ numero: NUM_A, data: '2026-09-25' })
      assert.ok(s.categoria === 'verdade' || s.categoria === 'desafio', s.categoria)
      const lista = s.categoria === 'verdade' ? VERDADES : DESAFIOS
      assert.ok(lista.includes(s.pergunta), 'pergunta não veio da lista: ' + s.pergunta)
    }
  })

  await testar('sorteio livre no comando: responde com verdade OU desafio', async () => {
    const { sock } = criarSock()
    await vouc.executar(sock, JID_GRUPO, msgSimples('/verdadeouconsequencia'), '/verdadeouconsequencia')
    const txt = textoEnviado(sock)
    assert.ok(txt.includes('VERDADE') || txt.includes('DESAFIO'), txt)
    assert.ok(txt.includes('@' + NUM_A), 'não marcou quem chamou: ' + txt)
  })

  await testar('o sorteio livre usa o sorteador injetado', async () => {
    const respostas = ['verdade', 'desafio', 'verdade']
    vouc._injetarSorteador(() => respostas.shift())
    try {
      assert.strictEqual(T.sortear({ numero: NUM_A, data: '2026-09-25' }).categoria, 'verdade')
      assert.strictEqual(T.sortear({ numero: NUM_A, data: '2026-09-25' }).categoria, 'desafio')
      assert.strictEqual(T.sortear({ numero: NUM_A, data: '2026-09-25' }).categoria, 'verdade')
    } finally {
      vouc._restaurarSorteador()
    }
  })

  // ─── 🎭 Forçar VERDADE ───
  await testar('forçar verdade: sempre dá VERDADE, com texto da lista de verdades', () => {
    for (let i = 0; i < 20; i++) {
      const s = T.sortear({ numero: `${NUM_A}${i}`, forcar: 'verdade', data: '2026-09-25' })
      assert.strictEqual(s.categoria, 'verdade')
      assert.ok(VERDADES.includes(s.pergunta), s.pergunta)
    }
  })

  await testar('comando "verdade" (com barra) responde VERDADE', async () => {
    const { sock } = criarSock()
    await vouc.executar(sock, JID_GRUPO, msgSimples('/verdadeouconsequencia verdade'), '/verdadeouconsequencia verdade')
    const txt = textoEnviado(sock)
    assert.ok(txt.includes('VERDADE'), txt)
    assert.ok(!txt.includes('DESAFIO'), 'vazou desafio: ' + txt)
  })

  // ─── 💣 Forçar DESAFIO ───
  await testar('forçar desafio: sempre dá DESAFIO, com texto da lista de desafios', () => {
    for (let i = 0; i < 20; i++) {
      const s = T.sortear({ numero: `${NUM_B}${i}`, forcar: 'desafio', data: '2026-09-25' })
      assert.strictEqual(s.categoria, 'desafio')
      assert.ok(DESAFIOS.includes(s.pergunta), s.pergunta)
    }
  })

  await testar('comando "desafio" (com barra) responde DESAFIO', async () => {
    const { sock } = criarSock()
    await vouc.executar(sock, JID_GRUPO, msgSimples('/verdadeouconsequencia desafio'), '/verdadeouconsequencia desafio')
    const txt = textoEnviado(sock)
    assert.ok(txt.includes('DESAFIO'), txt)
    assert.ok(!txt.includes('VERDADE'), 'vazou verdade: ' + txt)
  })

  await testar('"consequência" (com acento) também força desafio', async () => {
    assert.strictEqual(T.categoriaPedida('/verdadeouconsequencia consequência'), 'desafio')
    assert.strictEqual(T.categoriaPedida('/vouc CONSEQUENCIA'), 'desafio')
  })

  await testar('"Verdade" com maiúscula e "@" junto ainda é reconhecido', () => {
    assert.strictEqual(T.categoriaPedida('/verdadeouconsequencia  VERDADE @5511'), 'verdade')
  })

  // ─── 👥 Com menção ───
  await testar('com menção: o sorteio é marcado para a pessoa citada, não para quem chamou', async () => {
    const { sock, enviados } = criarSock()
    await vouc.executar(
      sock, JID_GRUPO,
      msgComMencao('/verdadeouconsequencia @pessoa', NUM_B),
      '/verdadeouconsequencia @pessoa'
    )
    const txt = textoEnviado(sock)
    assert.ok(txt.includes('@' + NUM_B), 'não marcou a pessoa citada: ' + txt)
    assert.ok(!txt.includes('@' + NUM_A), 'marcou quem chamou em vez do alvo: ' + txt)
    assert.deepStrictEqual(enviados[0].conteudo.mentions, [`${NUM_B}@s.whatsapp.net`])
  })

  await testar('menção + categoria: "verdade @pessoa" funciona (ordem invertida)', async () => {
    const { sock } = criarSock()
    await vouc.executar(
      sock, JID_GRUPO,
      msgComMencao('/verdadeouconsequencia verdade @pessoa', NUM_B),
      '/verdadeouconsequencia verdade @pessoa'
    )
    const txt = textoEnviado(sock)
    assert.ok(txt.includes('VERDADE'), txt)
    assert.ok(txt.includes('@' + NUM_B), txt)
  })

  await testar('sem menção: o sorteio marca quem chamou (o participant)', async () => {
    const { sock, enviados } = criarSock()
    await vouc.executar(sock, JID_GRUPO, msgSimples('/vouc'), '/vouc')
    assert.ok(textoEnviado(sock).includes('@' + NUM_A))
    assert.deepStrictEqual(enviados[0].conteudo.mentions, [`${NUM_A}@s.whatsapp.net`])
  })

  await testar('LID na menção é resolvido pelo metadado do grupo pro número real', async () => {
    const { sock, enviados } = criarSock({
      participantes: [{ id: '99887766@lid', phoneNumber: `${NUM_B}@s.whatsapp.net` }]
    })
    const msg = {
      key: { participant: `${NUM_A}:1@s.whatsapp.net` },
      message: {
        extendedTextMessage: {
          text: '/vouc @pessoa',
          contextInfo: { mentionedJid: ['99887766@lid'] }
        }
      }
    }
    await vouc.executar(sock, JID_GRUPO, msg, '/vouc @pessoa')
    assert.ok(textoEnviado(sock).includes('@' + NUM_B), textoEnviado(sock))
    assert.deepStrictEqual(enviados[0].conteudo.mentions, [`${NUM_B}@s.whatsapp.net`])
  })

  await testar('LID sem metadado do grupo: usa o próprio LID (não quebra, não inventa número)', async () => {
    const { sock, enviados } = criarSock({ falharMetadata: true })
    const msg = {
      key: { participant: `${NUM_A}:1@s.whatsapp.net` },
      message: {
        extendedTextMessage: {
          text: '/vouc @pessoa',
          contextInfo: { mentionedJid: ['99887766@lid'] }
        }
      }
    }
    await vouc.executar(sock, JID_GRUPO, msg, '/vouc @pessoa')
    assert.ok(textoEnviado(sock).includes('@99887766'), textoEnviado(sock))
    assert.deepStrictEqual(enviados[0].conteudo.mentions, ['99887766@lid'])
  })

  await testar('menção extra com :N (sufixo de dispositivo) é limpa', () => {
    assert.strictEqual(T.normalizarJid('5511999990001:12@s.whatsapp.net'), '5511999990001@s.whatsapp.net')
    assert.strictEqual(T.normalizarJid('99887766@lid'), '99887766@lid')
    assert.strictEqual(T.normalizarJid(''), '')
    assert.strictEqual(T.normalizarJid('sem-arroba'), '')
  })


  // ─── 🔒 Trava diária determinística ───
  await testar('mesma pessoa + mesma categoria + mesmo dia = MESMA pergunta', () => {
    const a = T.sortear({ numero: NUM_A, forcar: 'verdade', data: '2026-09-25' })
    const b = T.sortear({ numero: NUM_A, forcar: 'verdade', data: '2026-09-25' })
    assert.strictEqual(a.indice, b.indice)
    assert.strictEqual(a.pergunta, b.pergunta)
  })

  await testar('dia diferente muda a pergunta (o sorteio gira sozinho amanhã)', () => {
    const hoje = T.sortear({ numero: NUM_A, forcar: 'verdade', data: '2026-09-25' })
    const amanha = T.sortear({ numero: NUM_A, forcar: 'verdade', data: '2026-09-26' })
    assert.notStrictEqual(hoje.indice, amanha.indice)
  })

  await testar('pessoa diferente cai em item diferente', () => {
    const a = T.sortear({ numero: NUM_A, forcar: 'verdade', data: '2026-09-25' })
    const b = T.sortear({ numero: NUM_B, forcar: 'verdade', data: '2026-09-25' })
    assert.notStrictEqual(a.indice, b.indice)
  })

  await testar('trava cobre 100% das combinações (índice sempre dentro da lista)', () => {
    for (let i = 0; i < 200; i++) {
      const numero = `5511${String(i).padStart(7, '0')}`
      const cat = i % 2 === 0 ? 'verdade' : 'desafio'
      const s = T.sortear({ numero, forcar: cat, data: '2026-09-25' })
      const lista = cat === 'verdade' ? VERDADES : DESAFIOS
      assert.ok(s.indice >= 0 && s.indice < lista.length, `índice ${s.indice} fora de ${lista.length}`)
    }
  })

  await testar('chaveData monta YYYY-MM-DD e respeita a data injetada', () => {
    assert.strictEqual(T.chaveData(new Date(2026, 0, 5)), '2026-01-05')
    assert.strictEqual(T.chaveData(new Date(2026, 11, 31)), '2026-12-31')
  })

  // ─── 🛡️ Erros do executor ───
  await testar('mensagem sem autor nem menção → avisa e não lança', async () => {
    const { sock } = criarSock()
    const msgVazia = { key: {}, message: { extendedTextMessage: { text: '/vouc', contextInfo: {} } } }
    await vouc.executar(sock, JID_GRUPO, msgVazia, '/vouc')
    assert.ok(textoEnviado(sock).includes('Não consegui identificar'), textoEnviado(sock))
  })

  await testar('sock quebrado: o erro não escapa do comando', async () => {
    const { sock } = criarSock({ falharEnvio: true })
    await vouc.executar(sock, JID_GRUPO, msgSimples('/vouc'), '/vouc')
    assert.strictEqual(sock.enviados.length, 0, 'não deveria ter enviado nada')
  })

  await testar('a resposta sempre cita a mensagem do usuário', async () => {
    const { sock, enviados } = criarSock()
    await vouc.executar(sock, JID_GRUPO, msgSimples('/vouc verdade'), '/vouc verdade')
    assert.ok(enviados[0].opts && enviados[0].opts.quoted, 'não citava o usuário')
  })

  await testar('nenhum estado global: NÃO usa jogos-ativos nem Mongo', () => {
    const fonte = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'comandos', 'menu-brincadeiras', 'verdadeouconsequencia.js'),
      'utf8'
    )
    // Só o CÓDIGO importa: o cabeçalho comenta sobre o jogos-ativos de propósito.
    const codigo = fonte.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    assert.ok(!codigo.includes('jogos-ativos'), 'não deveria tocar em jogos-ativos')
    assert.ok(!/mongodb|MongoClient|collection\(|getDb\b/i.test(codigo), 'não deveria usar Mongo')
  })

  vouc._restaurarSorteador()

  console.log('\n' + (falhou === 0
    ? '🎉 TODOS OS TESTES DO /verdadeouconsequencia PASSARAM!'
    : '💥 ' + falhou + ' teste(s) FALHARAM de ' + (passou + falhou) + '.'))
  if (falhou > 0) process.exitCode = 1
}

principal()
