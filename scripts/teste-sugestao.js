// ============================================
// 🧪 teste-sugestao.js — Valida /sugestao + /versugestoes + /marcarsugestao
// ============================================
// RODA OFFLINE: injeta no sugestoes.js uma collection fake em memória
// (via o gancho __definirColecaoTeste — mesmo padrão do teste-vip-mongo)
// que reproduz o contrato do driver MongoDB (insertOne/findOne/updateOne/
// countDocuments e find+sort+limit). A lógica DE NEGÓCIO testada é a
// mesma que roda no Atlas. Verifica:
//   - exports dos 3 comandos (nome/aliases/executar);
//   - salvarSugestao: campos gravados (numero, grupo, texto, pendente);
//   - /sugestao sem texto: aviso de uso SEM tocar no banco;
//   - /sugestao com texto: confirmação + DM aos donos (exceto o autor);
//   - gate de dono: não-dono é barrado no /versugestoes e /marcarsugestao;
//   - fluxo completo: lista numerada → marcar atendida → some da lista;
//   - erro sem MONGODB_URI é ruidoso (não silencioso).
// Uso: node scripts/teste-sugestao.js
// ============================================

const path = require('path')
const modulo = path.resolve(__dirname, '..', 'sugestoes')
const banco = require(modulo)
const sugestao = require(path.resolve(__dirname, '..', 'comandos', 'menu-principal', 'sugestao'))
const versugestoes = require(path.resolve(__dirname, '..', 'comandos', 'menu-principal', 'versugestoes'))
const marcarsugestao = require(path.resolve(__dirname, '..', 'comandos', 'menu-principal', 'marcarsugestao'))
const { OWNER_NUMBERS, limparNumero } = require(path.resolve(__dirname, '..', 'config'))

// ─── Collection fake em memória ───
function criarColecaoFake() {
  const docs = []
  let seq = 0
  const igual = (doc, filtro) => Object.entries(filtro || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && ('$gte' in v || '$lte' in v || '$gt' in v)) {
      if ('$gte' in v && !(doc[k] >= v.$gte)) return false
      if ('$lte' in v && !(doc[k] <= v.$lte)) return false
      if ('$gt' in v && !(doc[k] > v.$gt)) return false
      return true
    }
    return doc[k] === v
  })
  return {
    _docs: docs,
    async createIndex() { return 'fake' },
    async insertOne(doc) {
      seq += 1
      const salvo = { ...doc, _id: `fakeid${String(seq).padStart(22, '0')}` }
      docs.push(salvo)
      return { insertedId: salvo._id }
    },
    async findOne(filtro) { return docs.find((d) => igual(d, filtro)) || null },
    async updateOne(filtro, update) {
      const alvo = docs.find((d) => igual(d, filtro))
      if (!alvo) return { matchedCount: 0 }
      Object.assign(alvo, update?.$set || {})
      return { matchedCount: 1 }
    },
    async countDocuments(filtro) { return docs.filter((d) => igual(d, filtro)).length },
    find(filtro) {
      const base = docs.filter((d) => igual(d, filtro))
      return {
        sort(ordem) {
          const [[campo, dir]] = Object.entries(ordem)
          base.sort((a, b) => (a[campo] < b[campo] ? -1 : a[campo] > b[campo] ? 1 : 0) * dir)
          return {
            limit(n) {
              return { toArray: async () => base.slice(0, n) }
            }
          }
        }
      }
    }
  }
}

const DONO_NUMERO = String((OWNER_NUMBERS || []).map(limparNumero).find(Boolean) || '177060848861240')
const JID_DONO = `${DONO_NUMERO}@s.whatsapp.net`
const NUM_AUTOR = '5511999990001'
const JID_AUTOR = `${NUM_AUTOR}@s.whatsapp.net`
const NUM_ESTRANHO = '5511999990002'
const JID_GRUPO = '120363000000000000@g.us'

function criarSock({ participantes = [], metadadosGrupo = null } = {}) {
  const enviadas = []
  const dms = []
  return {
    enviadas,
    dms,
    sock: {
      sendMessage: async (jid, conteudo) => {
        enviadas.push({ jid, conteudo })
        if (String(jid).endsWith('@s.whatsapp.net')) dms.push({ jid, conteudo })
        return { key: { id: `fake-${enviadas.length}` } }
      },
      groupMetadata: async () => metadadosGrupo || { subject: 'Grupo Teste', participants: participantes }
    }
  }
}

function criarMsg({ grupo = true, remetente = JID_AUTOR, texto = '/sugestao', pushName = 'Autor' } = {}) {
  return {
    key: {
      remoteJid: grupo ? JID_GRUPO : JID_AUTOR,
      fromMe: false,
      id: 'MSG',
      participant: grupo ? remetente : undefined
    },
    pushName,
    message: { extendedTextMessage: { text: texto, contextInfo: {} } }
  }
}

// Último texto enviado PARA o chat de origem (ignora as DMs aos donos,
// que também têm texto mas vão para JIDs individuais @s.whatsapp.net)
const ultimoTextoNoChat = (enviadas, jidChat) => {
  const e = [...enviadas].reverse().find((x) => x.jid === jidChat && x.conteudo?.text)
  return e ? e.conteudo.text : null
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

  await testar('exports dos 3 comandos', async () => {
    if (sugestao.nome !== 'sugestao') throw new Error(`nome: ${sugestao.nome}`)
    if (!sugestao.aliases.includes('sugerir')) throw new Error('alias sugerir faltando')
    if (versugestoes.nome !== 'versugestoes') throw new Error(`nome: ${versugestoes.nome}`)
    if (marcarsugestao.nome !== 'marcarsugestao') throw new Error(`nome: ${marcarsugestao.nome}`)
    for (const c of [sugestao, versugestoes, marcarsugestao]) {
      if (typeof c.executar !== 'function') throw new Error(`${c.nome}: executar não é função`)
    }
  })

  await testar('/sugestao sem texto: aviso de uso SEM tocar no banco', async () => {
    const antes = colecaoFake._docs.length
    const { sock, enviadas } = criarSock()
    await sugestao.executar(sock, JID_GRUPO, criarMsg({ texto: '/sugestao' }), '/sugestao')
    if (!/Conte sua ideia/i.test(ultimoTexto(enviadas) || '')) throw new Error('aviso de uso ausente')
    if (colecaoFake._docs.length !== antes) throw new Error('salvou sugestão vazia — bug')
  })

  await testar('/sugestao com texto: salva pendente + confirma + DM aos donos', async () => {
    const { sock, enviadas, dms } = criarSock()
    const texto = '/sugestao criar comando de lembretes'
    await sugestao.executar(sock, JID_GRUPO, criarMsg({ texto }), texto)
    if (!/Sugestão enviada/i.test(ultimoTextoNoChat(enviadas, JID_GRUPO) || '')) throw new Error('confirmação ausente')
    const doc = colecaoFake._docs[colecaoFake._docs.length - 1]
    if (!doc || doc.numero !== NUM_AUTOR) throw new Error(`numero: ${doc?.numero}`)
    if (doc.nome_grupo !== 'Grupo Teste') throw new Error(`grupo: ${doc?.nome_grupo}`)
    if (doc.texto !== 'criar comando de lembretes') throw new Error(`texto: ${doc?.texto}`)
    if (doc.status !== 'pendente') throw new Error(`status: ${doc?.status}`)
    if (!doc.criado_em) throw new Error('sem data/hora')
    const donosEsperados = [...new Set((OWNER_NUMBERS || []).map(limparNumero).filter(Boolean))]
      .filter((d) => d !== NUM_AUTOR)
    for (const dono of donosEsperados) {
      const achou = dms.some((d) => d.jid === `${dono}@s.whatsapp.net` && /Nova sugestão/i.test(d.conteudo.text))
      if (!achou) throw new Error(`DM ao dono ${dono} ausente`)
    }
  })

  await testar('gate de dono: estranho é barrado nos 2 comandos de dono', async () => {
    const participantes = [{ id: `${NUM_ESTRANHO}@s.whatsapp.net`, phoneNumber: `${NUM_ESTRANHO}@s.whatsapp.net` }]
    const { sock, enviadas } = criarSock({ participantes })
    const msg = criarMsg({ remetente: `${NUM_ESTRANHO}@s.whatsapp.net`, texto: '/versugestoes', pushName: 'X' })
    await versugestoes.executar(sock, JID_GRUPO, msg, '/versugestoes')
    if (!/só obedece aos donos/i.test(ultimoTexto(enviadas) || '')) throw new Error('não barrou no versugestoes')
    const msg2 = criarMsg({ remetente: `${NUM_ESTRANHO}@s.whatsapp.net`, texto: '/marcarsugestao 1 atendida', pushName: 'X' })
    await marcarsugestao.executar(sock, JID_GRUPO, msg2, '/marcarsugestao 1 atendida')
    if (!/só obedece aos donos/i.test(ultimoTexto(enviadas) || '')) throw new Error('não barrou no marcarsugestao')
  })

  await testar('fluxo do dono: lista numerada, marca 1 atendida, some da lista', async () => {
    const participantes = [{ id: JID_DONO, phoneNumber: JID_DONO }]
    const { sock, enviadas } = criarSock({ participantes })
    const msgLista = criarMsg({ remetente: JID_DONO, texto: '/versugestoes', pushName: 'Dono' })
    await versugestoes.executar(sock, JID_GRUPO, msgLista, '/versugestoes')
    const lista = ultimoTextoNoChat(enviadas, JID_GRUPO) || ''
    if (!/\*1\.\*/.test(lista)) throw new Error('lista sem numeração')
    if (!/criar comando de lembretes/.test(lista)) throw new Error('sugestão sumiu da lista')

    const msgMarca = criarMsg({ remetente: JID_DONO, texto: '/marcarsugestao 1 atendida', pushName: 'Dono' })
    await marcarsugestao.executar(sock, JID_GRUPO, msgMarca, '/marcarsugestao 1 atendida')
    if (!/marcada como \*atendida\*/i.test(ultimoTextoNoChat(enviadas, JID_GRUPO) || '')) throw new Error('confirmação de marca ausente')
    const doc = colecaoFake._docs.find((d) => d.texto === 'criar comando de lembretes')
    if (!doc || doc.status !== 'atendida') throw new Error('status não virou atendida no banco')
    if (!doc.resolvido_em || !doc.resolvido_por) throw new Error('sem rastro de quem/quando resolveu')

    const sock2 = criarSock({ participantes })
    await versugestoes.executar(sock2.sock, JID_GRUPO, msgLista, '/versugestoes')
    if (/criar comando de lembretes/.test(ultimoTexto(sock2.enviadas) || '')) {
      throw new Error('atendida ainda aparece como pendente')
    }
  })

  await testar('sem collection e sem MONGODB_URI: erro ruidoso', async () => {
    banco.__definirColecaoTeste(null)
    const salva = process.env.MONGODB_URI
    delete process.env.MONGODB_URI
    try {
      await banco.salvarSugestao({ numero: NUM_AUTOR, texto: 'x' })
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
