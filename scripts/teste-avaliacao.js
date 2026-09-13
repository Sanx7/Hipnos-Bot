// ============================================
// 🧪 teste-avaliacao.js — Valida /avaliar + /mediaavaliacoes
// ============================================
// RODA OFFLINE: injeta no avaliacoes.js uma collection fake em memória
// (via o gancho __definirColecaoTeste — mesmo padrão do teste-sugestao)
// que reproduz o contrato do driver MongoDB (findOne/insertOne com
// erro 11000 de duplicate key + aggregate $avg/$sum). Verifica:
//   - exports dos 2 comandos (nome/aliases/executar);
//   - /avaliar sem nota e com nota inválida: aviso de formato SEM
//     tocar no banco;
//   - /avaliar 5: salva (numero, nota, data) + confirmação;
//   - reavaliar: recusa com carinho, SEM sobrescrever/duplicar;
//   - corrida duplicate key (11000): também vira recusa amigável;
//   - /mediaavaliacoes: média via $avg ("⭐ 4,3/5 baseado em N");
//   - sem avaliações: aviso pedindo a 1ª nota;
//   - erro sem MONGODB_URI é ruidoso (não silencioso).
// Uso: node scripts/teste-avaliacao.js
// ============================================

const path = require('path')
const banco = require(path.resolve(__dirname, '..', 'avaliacoes'))
const avaliar = require(path.resolve(__dirname, '..', 'comandos', 'menu-principal', 'avaliar'))
const mediaavaliacoes = require(path.resolve(__dirname, '..', 'comandos', 'menu-principal', 'mediaavaliacoes'))

// ─── Collection fake em memória (com aggregate $avg/$sum) ───
function criarColecaoFake() {
  const docs = []
  return {
    _docs: docs,
    async createIndex() { return 'fake' },
    async findOne(filtro) {
      return docs.find((d) => Object.entries(filtro || {}).every(([k, v]) => d[k] === v)) || null
    },
    async insertOne(doc) {
      if (docs.some((d) => d.numero === doc.numero)) {
        const erro = new Error('E11000 duplicate key error collection: avaliacoes')
        erro.code = 11000
        throw erro
      }
      const salvo = { ...doc, _id: `fakeid${docs.length}` }
      docs.push(salvo)
      return { insertedId: salvo._id }
    },
    async countDocuments(filtro) {
      return docs.filter((d) => Object.entries(filtro || {}).every(([k, v]) => d[k] === v)).length
    },
    async aggregate(pipeline) {
      const grupo = (pipeline || []).find((e) => e.$group)
      const linhas = []
      if (grupo && docs.length) {
        const soma = docs.reduce((acc, d) => acc + Number(d.nota), 0)
        linhas.push({ _id: null, media: soma / docs.length, total: docs.length })
      }
      return { toArray: async () => linhas }
    }
  }
}

const NUM_A = '5511999990001'
const NUM_B = '5511999990002'
const JID_GRUPO = '120363000000000000@g.us'

function criarSock() {
  const enviadas = []
  return {
    enviadas,
    sock: {
      sendMessage: async (jid, conteudo) => {
        enviadas.push({ jid, conteudo })
        return { key: { id: `fake-${enviadas.length}` } }
      },
      groupMetadata: async () => ({ subject: 'Grupo Teste', participants: [] })
    }
  }
}

function criarMsg({ remetente = `${NUM_A}@s.whatsapp.net`, texto = '/avaliar' } = {}) {
  return {
    key: { remoteJid: JID_GRUPO, fromMe: false, id: 'MSG', participant: remetente },
    pushName: 'Autor',
    message: { extendedTextMessage: { text: texto, contextInfo: {} } }
  }
}

const ultimoTexto = (enviadas) => {
  const e = [...enviadas].reverse().find((x) => x.conteudo?.text)
  return e ? e.conteudo.text : null
}

async function main() {
  const colecaoFake = criarColecaoFake()
  banco.__definirColecaoTeste(colecaoFake)

  let reprovadas = 0
  const testar = async (nome, fn) => {
    try { await fn(); console.log(`✅ ${nome}`) }
    catch (err) { reprovadas++; console.log(`❌ ${nome}:`, err?.message || err) }
  }

  await testar('exports dos 2 comandos', async () => {
    if (avaliar.nome !== 'avaliar') throw new Error(`nome: ${avaliar.nome}`)
    if (!avaliar.aliases.includes('nota')) throw new Error('alias nota faltando')
    if (mediaavaliacoes.nome !== 'mediaavaliacoes') throw new Error(`nome: ${mediaavaliacoes.nome}`)
    for (const c of [avaliar, mediaavaliacoes]) {
      if (typeof c.executar !== 'function') throw new Error(`${c.nome}: executar não é função`)
    }
  })

  await testar('/avaliar sem nota e inválida: formato SEM tocar no banco', async () => {
    const antes = colecaoFake._docs.length
    for (const texto of ['/avaliar', '/avaliar 0', '/avaliar 6', '/avaliar abc', '/avaliar 4.5', '/avaliar 55']) {
      const { sock, enviadas } = criarSock()
      await avaliar.executar(sock, JID_GRUPO, criarMsg({ texto }), texto)
      if (!/nota de \*1 a 5\*/i.test(ultimoTexto(enviadas) || '')) {
        throw new Error(`sem aviso de formato p/ "${texto}"`)
      }
    }
    if (colecaoFake._docs.length !== antes) throw new Error('salvou nota inválida — bug')
  })

  await testar('/avaliar 5: salva numero+nota+data e confirma', async () => {
    const { sock, enviadas } = criarSock()
    await avaliar.executar(sock, JID_GRUPO, criarMsg({ texto: '/avaliar 5' }), '/avaliar 5')
    if (!/Nota registrada/i.test(ultimoTexto(enviadas) || '')) throw new Error('confirmação ausente')
    const doc = colecaoFake._docs.find((d) => d.numero === NUM_A)
    if (!doc || doc.nota !== 5) throw new Error(`doc: ${JSON.stringify(doc)}`)
    if (!doc.criado_em) throw new Error('sem data')
  })

  await testar('reavaliar: recusa com carinho SEM sobrescrever', async () => {
    const { sock, enviadas } = criarSock()
    await avaliar.executar(sock, JID_GRUPO, criarMsg({ texto: '/avaliar 1' }), '/avaliar 1')
    if (!/já avaliou o bot anteriormente/i.test(ultimoTexto(enviadas) || '')) {
      throw new Error('recusa amigável ausente')
    }
    const docs = colecaoFake._docs.filter((d) => d.numero === NUM_A)
    if (docs.length !== 1) throw new Error(`duplicou: ${docs.length} docs`)
    if (docs[0].nota !== 5) throw new Error(`sobrescreveu a nota: ${docs[0].nota}`)
  })

  await testar('corrida duplicate key (11000): vira recusa amigável', async () => {
    // Garante um doc p/ NUM_B e força findOne null → insertOne lança 11000
    if (!colecaoFake._docs.some((d) => d.numero === NUM_B)) {
      await banco.salvarAvaliacao(NUM_B, 4)
    }
    const original = colecaoFake.findOne
    colecaoFake.findOne = async () => null
    let r = null
    try {
      r = await banco.salvarAvaliacao(NUM_B, 5)
    } finally {
      colecaoFake.findOne = original
    }
    if (!r || r.duplicada !== true) throw new Error('11000 não virou { duplicada: true }')
    const doc = colecaoFake._docs.find((d) => d.numero === NUM_B)
    if (doc.nota !== 4) throw new Error('corrida sobrescreveu a nota original')
  })

  await testar('/mediaavaliacoes: média $avg com 2 notas (5+4=4,5)', async () => {
    const { sock, enviadas } = criarSock()
    await mediaavaliacoes.executar(sock, JID_GRUPO, criarMsg({ texto: '/mediaavaliacoes' }), '/mediaavaliacoes')
    const texto = ultimoTexto(enviadas) || ''
    if (!/4,5\/5/.test(texto)) throw new Error(`média errada: ${texto}`)
    if (!/\*2\* avaliações/.test(texto)) throw new Error(`total errado: ${texto}`)
  })

  await testar('/mediaavaliacoes sem avaliações: pede a 1ª nota', async () => {
    colecaoFake._docs.length = 0
    const { sock, enviadas } = criarSock()
    await mediaavaliacoes.executar(sock, JID_GRUPO, criarMsg({ texto: '/mediaavaliacoes' }), '/mediaavaliacoes')
    if (!/Ainda não há avaliações/i.test(ultimoTexto(enviadas) || '')) throw new Error('aviso de vazio ausente')
  })

  await testar('sem collection e sem MONGODB_URI: erro ruidoso', async () => {
    banco.__definirColecaoTeste(null)
    const salva = process.env.MONGODB_URI
    delete process.env.MONGODB_URI
    try {
      await banco.salvarAvaliacao(NUM_A, 5)
      banco.__definirColecaoTeste(colecaoFake)
      if (salva !== undefined) process.env.MONGODB_URI = salva
      throw new Error('deveria rejeitar sem MONGODB_URI')
    } catch (err) {
      banco.__definirColecaoTeste(colecaoFake)
      if (salva !== undefined) process.env.MONGODB_URI = salva
      if (!/MONGODB_URI/.test(err?.message || '')) throw err
    }
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
