// ============================================
// 🧪 teste-aleatorios.js — Valida /sorte /gay /qi /parecido /crush
// ============================================
// RODA 100% OFFLINE: injeta uma collection FAKE de "brincadeiraDiaria"
// (mapa em memória com findOne/updateOne — mesmo padrão do
// __definirColecaoTeste do configuracoes-grupo.js) e usa um sock mock.
// Verifica:
//   - exports: o arquivo registra os 5 comandos;
//   - trava diária: 2 chamadas no mesmo dia → mesmo veredito;
//   - pregravando vereditos na fake, cada comando devolve o valor certo;
//   - /sorte ignora veredito de ONTEM (novo dia, novo sorteio);
//   - /gay e /qi sem menção → miram em quem mandou;
//   - /parecido sem menção → pede menção (não toca no banco);
//   - /parecido com menção → trava por par e menciona os dois;
//   - /crush fora de grupo → aviso; em grupo → nunca é o autor nem o bot,
//     e o crush é o MESMO o dia inteiro;
//   - banco fora → os comandos ainda respondem (sorteio sem trava).
// Uso: node scripts/teste-aleatorios.js
// ============================================

const aleatorios = require('../comandos/menu-brincadeiras/aleatorios')

const comandos = new Map(aleatorios.map((c) => [c.nome, c]))

// ─── 📦 Collection fake em memória ───
function criarColecaoFake ({ falhar = false } = {}) {
  const documentos = new Map()
  const chaveDe = (f) =>
    [f.comando, f.grupo_id, f.autor_id, f.alvo_id, f.dia].join('|')
  return {
    __documentos: documentos,
    async findOne (filtro) {
      if (falhar) throw new Error('mongo fora (simulado)')
      return documentos.get(chaveDe(filtro)) || null
    },
    async updateOne (filtro, atualizacao) {
      if (falhar) throw new Error('mongo fora (simulado)')
      const chave = chaveDe(filtro)
      const existente = documentos.get(chave) || { ...filtro }
      Object.assign(existente, atualizacao.$set)
      documentos.set(chave, existente)
      return {}
    },
    async createIndex () {}
  }
}

const JID_GRUPO = '120363000000000000@g.us'
const AUTOR = '5551111111111@s.whatsapp.net'
const OUTRO = '5552222222222@s.whatsapp.net'
const TERCEIRO = '5553333333333@s.whatsapp.net'
const BOT = '5555999999999'

function criarMsg ({ autor = AUTOR, mencionados = [] } = {}) {
  const key = { remoteJid: JID_GRUPO, fromMe: false, id: 'MSG' }
  if (autor) key.participant = autor
  return {
    key,
    pushName: 'Sonhador',
    message: {
      extendedTextMessage: {
        text: '/comando',
        contextInfo: { mentionedJid: mencionados }
      }
    }
  }
}

function criarSock () {
  const enviadas = []
  return {
    enviadas,
    sock: {
      user: { id: `${BOT}:12@s.whatsapp.net` },
      async sendMessage (jid, conteudo) {
        enviadas.push(conteudo)
        return { key: { id: 'fake' } }
      },
      async groupMetadata (jid) {
        return {
          participants: [
            { id: `${BOT}@s.whatsapp.net`, admin: 'admin' },                                 // bot
            { id: '111111111111111111@lid', phoneNumber: AUTOR, admin: null },               // autor (como LID)
            { id: OUTRO, admin: null },                                                      // membro
            { id: TERCEIRO, admin: null },                                                   // membro
            { id: `${OUTRO}:77@s.whatsapp.net`, admin: null }                                // duplicado
          ]
        }
      }
    }
  }
}

const respostaUnica = (enviadas) => {
  const textos = enviadas.filter((e) => typeof e.text === 'string')
  return textos.length === 1 ? textos[0] : null
}

// Dia civil (America/Sao_Paulo) — hoje e ontem, para os testes da trava
function diaDe (quando) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(quando)
}
const diaDeHoje = () => diaDe(new Date())
const diaDeOntem = () => diaDe(new Date(Date.now() - 24 * 60 * 60 * 1000))

async function pregravar (colecao, doc) {
  await colecao.updateOne(
    {
      comando: doc.comando,
      grupo_id: JID_GRUPO,
      autor_id: doc.autor,
      alvo_id: doc.alvo || '',
      dia: doc.dia || diaDeHoje()
    },
    { $set: { valor: doc.valor, extra: doc.extra ?? null, criado_em: 1 } },
    { upsert: true }
  )
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

async function main () {
  // ───── 1) Exports ─────
  await testar('exports: o arquivo registra os 5 comandos', async () => {
    for (const nome of ['sorte', 'gay', 'qi', 'parecido', 'crush']) {
      if (comandos.get(nome)?.nome !== nome) throw new Error(`comando ausente: ${nome}`)
    }
  })

  // ───── 2) /sorte — trava diária ─────
  await testar('/sorte: mesmo veredito nas duas chamadas do dia', async () => {
    const colecao = criarColecaoFake()
    aleatorios.__definirColecaoTeste(colecao)
    try {
      const { sock: s1, enviadas: e1 } = criarSock()
      await comandos.get('sorte').executar(s1, JID_GRUPO, criarMsg(), '/sorte')
      const r1 = respostaUnica(e1)
      if (!r1 || !/\d+%/.test(r1.text)) throw new Error('sem % na resposta: ' + r1.text)

      const { sock: s2, enviadas: e2 } = criarSock()
      await comandos.get('sorte').executar(s2, JID_GRUPO, criarMsg(), '/sorte')
      const r2 = respostaUnica(e2)
      if (!r2) throw new Error('2ª chamada não respondeu')
      if (r1.text !== r2.text) throw new Error('vereditos diferentes no mesmo dia')
      if (colecao.__documentos.size !== 1) throw new Error(`esperava 1 doc, há ${colecao.__documentos.size}`)
    } finally {
      aleatorios.__definirColecaoTeste(null)
    }
  })

  await testar('/sorte: veredito PREGRAVADO (95%) sai na mensagem; ontem é ignorado', async () => {
    const colecao = criarColecaoFake()
    aleatorios.__definirColecaoTeste(colecao)
    try {
      await pregravar(colecao, { comando: 'sorte', autor: AUTOR, dia: diaDeOntem(), valor: 42, extra: null })
      await pregravar(colecao, { comando: 'sorte', autor: AUTOR, valor: 95, extra: null })
      const { sock, enviadas } = criarSock()
      await comandos.get('sorte').executar(sock, JID_GRUPO, criarMsg(), '/sorte')
      const r = respostaUnica(enviadas)
      if (!r.text.includes('95%')) throw new Error('veredito pregravado ignorado: ' + r.text)
      if (r.text.includes('42%')) throw new Error('veredito de ONTEM vazou: ' + r.text)
      if (!r.text.includes('sorte extrema')) throw new Error('faixa errada: ' + r.text)
      if (!r.mentions?.includes(AUTOR)) throw new Error('autor não mencionado')
    } finally {
      aleatorios.__definirColecaoTeste(null)
    }
  })

  // ───── 3) /gay — default no autor + trava por par ─────
  await testar('/gay: sem menção mira em QUEM MANDOU (veredito pregravado)', async () => {
    const colecao = criarColecaoFake()
    aleatorios.__definirColecaoTeste(colecao)
    try {
      await pregravar(colecao, { comando: 'gay', autor: AUTOR, valor: 13, extra: null })
      const { sock, enviadas } = criarSock()
      await comandos.get('gay').executar(sock, JID_GRUPO, criarMsg(), '/gay')
      const r = respostaUnica(enviadas)
      if (!r.text.includes('13%')) throw new Error('valor errado: ' + r.text)
      if (!r.mentions?.includes(AUTOR)) throw new Error('não mirou o autor')
      if (colecao.__documentos.size !== 1) throw new Error('chave diária duplicada')
    } finally {
      aleatorios.__definirColecaoTeste(null)
    }
  })

  await testar('/gay: com menção trava o PAR (autor→alvo)', async () => {
    const colecao = criarColecaoFake()
    aleatorios.__definirColecaoTeste(colecao)
    try {
      await pregravar(colecao, { comando: 'gay', autor: AUTOR, alvo: OUTRO, valor: 80, extra: null })
      const { sock, enviadas } = criarSock()
      await comandos.get('gay').executar(sock, JID_GRUPO, criarMsg({ mencionados: [OUTRO] }), '/gay @membro')
      const r = respostaUnica(enviadas)
      if (!r.text.includes('80%')) throw new Error('valor errado: ' + r.text)
      if (!r.text.includes('@5552222222222')) throw new Error('alvo não citado: ' + r.text)
      if (colecao.__documentos.size !== 1) throw new Error('par não travou')
    } finally {
      aleatorios.__definirColecaoTeste(null)
    }
  })

  // ───── (continua: /qi, /parecido, /crush, banco fora) ─────
  await main2()
}

async function main2 () {
  // ───── 4) /qi — faixas de frase ─────
  await testar('/qi: faixas zoeira/normal/gênio (pregravados)', async () => {
    const colecao = criarColecaoFake()
    aleatorios.__definirColecaoTeste(colecao)
    try {
      const casos = [
        { valor: 55, genio: false, marcadores: ['neurônios', 'zoeira', 'preocupadas'] }, // faixa baixa (zoeira)
        { valor: 110, genio: false, marcadores: ['média', 'mortais', 'afine'] },          // faixa normal
        { valor: 175, genio: true, marcadores: ['GÊNIO', 'Einstein', 'autógrafo'] }       // gênio
      ]
      for (const caso of casos) {
        await pregravar(colecao, { comando: 'qi', autor: AUTOR, alvo: OUTRO, valor: caso.valor, extra: null })
        const { sock, enviadas } = criarSock()
        await comandos.get('qi').executar(sock, JID_GRUPO, criarMsg({ mencionados: [OUTRO] }), '/qi @membro')
        const r = respostaUnica(enviadas)
        if (!r.text.includes(String(caso.valor))) throw new Error(`valor ${caso.valor} ausente: ${r.text}`)
        const casou = caso.marcadores.some((p) => r.text.includes(p))
        if (!casou) throw new Error(`faixa errada p/ ${caso.valor}: ${r.text}`)
        // limpa o veredito p/ o próximo caso
        colecao.__documentos.clear()
      }
    } finally {
      aleatorios.__definirColecaoTeste(null)
    }
  })

  // ───── 5) /parecido — menção obrigatória + trava por par ─────
  await testar('/parecido: sem menção PEDE menção (sem tocar no banco)', async () => {
    const colecao = criarColecaoFake()
    aleatorios.__definirColecaoTeste(colecao)
    try {
      const { sock, enviadas } = criarSock()
      await comandos.get('parecido').executar(sock, JID_GRUPO, criarMsg(), '/parecido')
      const r = respostaUnica(enviadas)
      if (!r.text.includes('Marque alguém')) throw new Error('aviso inesperado: ' + r.text)
      if (colecao.__documentos.size !== 0) throw new Error('gravou sem menção')
    } finally {
      aleatorios.__definirColecaoTeste(null)
    }
  })

  await testar('/parecido: com menção trava o PAR e menciona os dois', async () => {
    const colecao = criarColecaoFake()
    aleatorios.__definirColecaoTeste(colecao)
    try {
      const { sock, enviadas: e1 } = criarSock()
      await comandos.get('parecido').executar(sock, JID_GRUPO, criarMsg({ mencionados: [OUTRO] }), '/parecido @membro')
      const r1 = respostaUnica(e1)
      if (!r1.text.includes(`@${AUTOR.split('@')[0]}`) || !r1.text.includes(`@${OUTRO.split('@')[0]}`)) {
        throw new Error('os dois não aparecem: ' + r1.text)
      }
      if (!r1.mentions?.includes(AUTOR) || !r1.mentions?.includes(OUTRO)) {
        throw new Error('mentions incompletas')
      }

      const { sock: s2, enviadas: e2 } = criarSock()
      await comandos.get('parecido').executar(s2, JID_GRUPO, criarMsg({ mencionados: [OUTRO] }), '/parecido @membro')
      const r2 = respostaUnica(e2)
      const valor1 = r1.text.match(/(\d+)%/)?.[1]
      const valor2 = r2.text.match(/(\d+)%/)?.[1]
      if (valor1 !== valor2) throw new Error(`par não travou: ${valor1}% vs ${valor2}%`)
    } finally {
      aleatorios.__definirColecaoTeste(null)
    }
  })

  // ───── 6) /crush ─────
  await testar('/crush: fora de grupo → aviso', async () => {
    aleatorios.__definirColecaoTeste(criarColecaoFake())
    try {
      const sock = { user: { id: BOT }, sendMessage: async (j, c) => ({ text: c.text }) }
      const aviso = await comandos.get('crush').executar(sock, '5551000000000@s.whatsapp.net', criarMsg())
      if (!aviso.text.includes('grupos')) throw new Error('aviso inesperado: ' + aviso.text)
    } finally {
      aleatorios.__definirColecaoTeste(null)
    }
  })

  await testar('/crush: em grupo nunca é o autor/bot e é fixo no dia', async () => {
    const colecao = criarColecaoFake()
    aleatorios.__definirColecaoTeste(colecao)
    try {
      const { sock, enviadas: e1 } = criarSock()
      await comandos.get('crush').executar(sock, JID_GRUPO, criarMsg(), '/crush')
      const r1 = respostaUnica(e1)
      if (!r1.mentions || r1.mentions.length !== 1) throw new Error('crush sem menção única')
      const crush1 = r1.mentions[0]
      const digitos1 = crush1.split('@')[0]
      if (digitos1 === '5551111111111') throw new Error('o autor virou o próprio crush')
      if (digitos1 === BOT) throw new Error('o bot virou o crush')
      if (digitos1 !== '5552222222222' && digitos1 !== '5553333333333') {
        throw new Error('crush fora do grupo: ' + crush1)
      }

      const { sock: s2, enviadas: e2 } = criarSock()
      await comandos.get('crush').executar(s2, JID_GRUPO, criarMsg(), '/crush')
      const r2 = respostaUnica(e2)
      if (r2.mentions[0] !== crush1) throw new Error('crush mudou no mesmo dia')
    } finally {
      aleatorios.__definirColecaoTeste(null)
    }
  })

  // ───── 7) Banco fora → os comandos ainda respondem ─────
  await testar('banco FORA: comandos respondem sem trava (nunca quebram)', async () => {
    aleatorios.__definirColecaoTeste(criarColecaoFake({ falhar: true }))
    try {
      const { sock, enviadas } = criarSock()
      await comandos.get('sorte').executar(sock, JID_GRUPO, criarMsg(), '/sorte')
      if (!/\d+%/.test(respostaUnica(enviadas).text)) throw new Error('/sorte quebrou')

      const { sock: s2, enviadas: e2 } = criarSock()
      await comandos.get('parecido').executar(s2, JID_GRUPO, criarMsg({ mencionados: [OUTRO] }), '/parecido @membro')
      if (!/\d+%/.test(respostaUnica(e2).text)) throw new Error('/parecido quebrou')

      const { sock: s3, enviadas: e3 } = criarSock()
      await comandos.get('crush').executar(s3, JID_GRUPO, criarMsg(), '/crush')
      if (!respostaUnica(e3).mentions?.length) throw new Error('/crush quebrou')
    } finally {
      aleatorios.__definirColecaoTeste(null)
    }
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()


