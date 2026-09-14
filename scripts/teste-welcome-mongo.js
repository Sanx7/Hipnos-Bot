// ============================================
// 🧪 teste-welcome-mongo.js — Valida o /welcome e a persistência POR GRUPO
// ============================================
// RODA OFFLINE: injeta no configuracoes-grupo.js uma collection fake em
// memória (via o gancho __definirColecaoTeste) que reproduz o contrato do
// driver MongoDB (findOne/updateOne com upsert) e substitui o sock do
// Baileys por um mock (mesmo padrão do teste-delete.js). Verifica:
//   - estrutura do comando (nome "welcome" + aliases /bemvindo e /boasvindas);
//   - recusas: fora de grupo, membro comum e opção inválida;
//   - status sem argumento (desligado/ligado);
//   - ligar/desligar por 1/0 e por on/off/ligar/desligar;
//   - ISOLAMENTO: ligar num grupo nunca afeta outro grupo;
//   - upsert: 1 documento por grupo (sem duplicar);
//   - welcomeHabilitado NUNCA lança (fail-safe = false) e definirWelcome
//     falha RUIDOSAMENTE sem MONGODB_URI.
// Uso: node scripts/teste-welcome-mongo.js
// ============================================

const comandoWelcome = require('../comandos/admin/welcome')
const config = require('../configuracoes-grupo')

const JID_GRUPO = '120363000000000000@g.us'
const JID_OUTRO_GRUPO = '120363000000000001@g.us'
const JID_PRIVADO = '5555000000001@s.whatsapp.net'
const JID_ADMIN = '5555000000002@s.whatsapp.net'
const JID_MEMBRO = '5555000000003@s.whatsapp.net'

// ─── Collection fake (contrato mínimo do driver MongoDB) ───
function criarColecaoFake() {
  const docs = new Map()
  const clone = (d) => JSON.parse(JSON.stringify(d))
  const casa = (d, filtro) =>
    Object.entries(filtro).every(([k, v]) => d[k] === v)

  return {
    _mapa: docs, // acesso direto p/ os testes conferirem o que foi gravado
    async createIndex() {
      return 'idx_config_grupo_id'
    },
    async findOne(filtro) {
      for (const d of docs.values()) if (casa(d, filtro)) return clone(d)
      return null
    },
    async updateOne(filtro, atualizacao, opcoes = {}) {
      for (const [, d] of docs) {
        if (casa(d, filtro)) {
          Object.assign(d, atualizacao.$set || {})
          return { matchedCount: 1 }
        }
      }
      if (opcoes.upsert) {
        const novo = { ...(atualizacao.$setOnInsert || {}), ...(atualizacao.$set || {}) }
        docs.set(novo.grupo_id, novo)
        return { upsertedCount: 1 }
      }
      return { matchedCount: 0 }
    }
  }
}

// ─── Mock do sock do Baileys ───
// O wrapper devolve { enviadas, sock } (padrão do teste-delete.js) e o
// próprio sock falso também expõe `enviadas` — assim os helpers podem ser
// usados tanto com o wrapper quanto com o socket passado ao comando.
function criarSock(participants) {
  const enviadas = []
  const sock = {
    enviadas,
    groupMetadata: async () => ({ participants, owner: JID_ADMIN }),
    sendMessage: async (jid, conteudo, extra) => {
      enviadas.push({ jid, conteudo, extra })
      return { key: { id: `fake-${enviadas.length}` } }
    }
  }
  return { enviadas, sock }
}

// Admin + membro comum (o dono do grupo é o próprio admin, via owner)
const participantesPadrao = () => [
  { id: JID_ADMIN, admin: 'admin' },
  { id: JID_MEMBRO, admin: null }
]

// ─── Mock de mensagem do comando ───
function criarMsg({ grupo = true, autor = JID_ADMIN, texto = '/welcome' } = {}) {
  const jid = grupo ? JID_GRUPO : JID_PRIVADO
  return {
    key: {
      remoteJid: jid,
      fromMe: false,
      id: 'COMANDO123',
      participant: grupo ? autor : undefined
    },
    message: { conversation: texto }
  }
}

// ─── Suíte ───
async function main() {
  const colecaoFake = criarColecaoFake()
  config.__definirColecaoTeste(colecaoFake)

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

  // Helpers de asserção sobre o que o comando respondeu
  const textoUnico = (sock) => {
    const textos = sock.enviadas.filter((e) => e.conteudo?.text)
    return textos.length === 1 ? textos[0].conteudo.text : null
  }
  const estadoDe = (jid) => config.welcomeHabilitado(jid)

  await testar('estrutura: nome "welcome" + aliases /bemvindo e /boasvindas', async () => {
    if (comandoWelcome.nome !== 'welcome') throw new Error(`nome inesperado: ${comandoWelcome.nome}`)
    if (typeof comandoWelcome.executar !== 'function') throw new Error('executar não é função')
    const aliases = comandoWelcome.aliases || []
    for (const apelido of ['bemvindo', 'boasvindas']) {
      if (!aliases.includes(apelido)) throw new Error(`alias ausente: ${apelido}`)
    }
  })

  await testar('recusa no PRIVADO (não grava nada)', async () => {
    const { sock } = criarSock(participantesPadrao())
    await comandoWelcome.executar(sock, JID_PRIVADO, criarMsg({ grupo: false }), '/welcome 1')
    const texto = textoUnico(sock)
    if (!texto || !/grupo/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
    if ((await estadoDe(JID_PRIVADO)) !== false) throw new Error('não deveria gravar no privado')
    if (colecaoFake._mapa.size !== 0) throw new Error('a collection não deveria ter documentos')
  })

  await testar('recusa MEMBRO COMUM (não grava nada)', async () => {
    const { sock } = criarSock(participantesPadrao())
    await comandoWelcome.executar(sock, JID_GRUPO, criarMsg({ autor: JID_MEMBRO }), '/welcome 1')
    const texto = textoUnico(sock)
    if (!texto || !/administradores/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
    if ((await estadoDe(JID_GRUPO)) !== false) throw new Error('membro comum não deveria mudar o estado')
  })

  await testar('sem argumento: mostra o STATUS (desligado no início)', async () => {
    const { sock } = criarSock(participantesPadrao())
    await comandoWelcome.executar(sock, JID_GRUPO, criarMsg(), '/welcome')
    const texto = textoUnico(sock)
    if (!texto || !/DESATIVADAS/i.test(texto)) throw new Error(`status inesperado: ${texto}`)
  })

  await testar('/welcome 1 LIGA e persiste por grupo (documento correto)', async () => {
    const { sock } = criarSock(participantesPadrao())
    await comandoWelcome.executar(sock, JID_GRUPO, criarMsg({ texto: '/welcome 1' }), '/welcome 1')
    const texto = textoUnico(sock)
    if (!texto || !/ATIVAD/i.test(texto)) throw new Error(`confirmação inesperada: ${texto}`)
    if ((await estadoDe(JID_GRUPO)) !== true) throw new Error('deveria estar LIGADO no banco')

    const doc = colecaoFake._mapa.get(JID_GRUPO)
    if (!doc) throw new Error('documento não gravado na collection')
    if (doc.grupo_id !== JID_GRUPO) throw new Error(`grupo_id gravado: ${doc.grupo_id}`)
    if (doc.welcome !== true) throw new Error('campo welcome deveria ser true')
    if (typeof doc.atualizado_em !== 'number') throw new Error('atualizado_em deveria ser número (ms)')
  })

  await testar('sem argumento (depois de ligado): mostra ATIVADAS', async () => {
    const { sock } = criarSock(participantesPadrao())
    await comandoWelcome.executar(sock, JID_GRUPO, criarMsg(), '/welcome')
    const texto = textoUnico(sock)
    if (!texto || !/ATIVADAS/i.test(texto)) throw new Error(`status inesperado: ${texto}`)
  })

  await testar('ISOLAMENTO: ligar no grupo A não afeta o grupo B', async () => {
    if ((await estadoDe(JID_OUTRO_GRUPO)) !== false) throw new Error('o grupo B deveria seguir DESLIGADO')
    if (colecaoFake._mapa.has(JID_OUTRO_GRUPO)) throw new Error('o grupo B não deveria ter documento')
  })

  await testar('variações: on/ligar LIGAM, off/desligar DESLIGAM', async () => {
    const casos = [
      { texto: '/welcome on', esperado: true },
      { texto: '/welcome desligar', esperado: false },
      { texto: '/welcome ligar', esperado: true },
      { texto: '/welcome off', esperado: false }
    ]
    for (const caso of casos) {
      const { sock } = criarSock(participantesPadrao())
      await comandoWelcome.executar(sock, JID_GRUPO, criarMsg({ texto: caso.texto }), caso.texto)
      const estado = await estadoDe(JID_GRUPO)
      if (estado !== caso.esperado) {
        throw new Error(`${caso.texto} deveria deixar welcome=${caso.esperado} (ficou ${estado})`)
      }
    }
  })

  await testar('estado repetido: avisa e NÃO duplica documento', async () => {
    const { sock } = criarSock(participantesPadrao())
    await comandoWelcome.executar(sock, JID_GRUPO, criarMsg({ texto: '/welcome 0' }), '/welcome 0')
    const { sock: sock2 } = criarSock(participantesPadrao())
    await comandoWelcome.executar(sock2, JID_GRUPO, criarMsg({ texto: '/welcome 0' }), '/welcome 0')
    const texto = textoUnico(sock2)
    if (!texto || !/já estão DESATIVADAS/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
    if (colecaoFake._mapa.size !== 1) throw new Error(`deveria haver 1 documento, há ${colecaoFake._mapa.size}`)
  })

  await testar('opção INVÁLIDA: avisa e não altera o estado', async () => {
    const { sock } = criarSock(participantesPadrao())
    await comandoWelcome.executar(sock, JID_GRUPO, criarMsg({ texto: '/welcome banana' }), '/welcome banana')
    const texto = textoUnico(sock)
    if (!texto || !/inválido/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
    if ((await estadoDe(JID_GRUPO)) !== false) throw new Error('estado não deveria ter mudado')
  })

  await testar('upsert: 1 documento por grupo (grupo B ganha o dele)', async () => {
    const { sock } = criarSock(participantesPadrao())
    await comandoWelcome.executar(sock, JID_OUTRO_GRUPO, criarMsg({ texto: '/welcome 1' }), '/welcome 1')
    if ((await estadoDe(JID_OUTRO_GRUPO)) !== true) throw new Error('o grupo B deveria estar LIGADO')
    if (colecaoFake._mapa.size !== 2) throw new Error(`esperava 2 documentos, há ${colecaoFake._mapa.size}`)
    if (colecaoFake._mapa.get(JID_OUTRO_GRUPO).grupo_id !== JID_OUTRO_GRUPO) throw new Error('grupo_id do B incorreto')
  })

  await testar('welcomeHabilitado: false p/ grupo sem registro ou id vazio', async () => {
    if ((await config.welcomeHabilitado('')) !== false) throw new Error('id vazio deveria ser false')
    if ((await config.welcomeHabilitado('   ')) !== false) throw new Error('id em branco deveria ser false')
    if ((await config.welcomeHabilitado('120363000000000009@g.us')) !== false) throw new Error('grupo sem registro deveria ser false')
  })

  await testar('obterConfiguracoes/configuracaoPadrao: docs e defaults corretos', async () => {
    const doc = await config.obterConfiguracoes(JID_GRUPO)
    if (!doc || doc.grupo_id !== JID_GRUPO) throw new Error('documento do grupo A incorreto')
    if ((await config.obterConfiguracoes('')) !== null) throw new Error('id vazio deveria devolver null')

    const padrao = config.configuracaoPadrao('  120363000000000010@g.us  ')
    if (padrao.welcome !== false) throw new Error('padrão deveria nascer DESLIGADO')
    if (padrao.grupo_id !== '120363000000000010@g.us') throw new Error('grupo_id do padrão deveria vir sem espaços')
  })

  await testar('definirWelcome: null p/ id vazio (sem tocar no banco)', async () => {
    if ((await config.definirWelcome('', true)) !== null) throw new Error('id vazio deveria devolver null')
    if ((await config.definirWelcome(null, true)) !== null) throw new Error('id nulo deveria devolver null')
  })

  await testar('sem collection e sem MONGODB_URI: erro RUIDOSO + fail-safe false', async () => {
    const uriOriginal = process.env.MONGODB_URI
    // String vazia (falsy) torna o teste DETERMINÍSTICO e offline mesmo que a
    // máquina tenha uma MONGODB_URI real no .env — nunca toca em rede.
    process.env.MONGODB_URI = ''
    config.__definirColecaoTeste(null)

    try {
      // definirWelcome (escrita) precisa FALHAR alto, não em silêncio
      let estourou = false
      try {
        await config.definirWelcome(JID_GRUPO, true)
      } catch (err) {
        estourou = true
        if (!/MONGODB_URI/.test(err?.message || '')) throw err
      }
      if (!estourou) throw new Error('definirWelcome deveria rejeitar sem MONGODB_URI')

      // welcomeHabilitado (leitura, usada pelo handler) NUNCA lança
      if ((await config.welcomeHabilitado(JID_GRUPO)) !== false) {
        throw new Error('welcomeHabilitado deveria devolver false (fail-safe)')
      }
    } finally {
      // Restaura o ambiente p/ não vazar estado entre execuções
      if (uriOriginal === undefined) delete process.env.MONGODB_URI
      else process.env.MONGODB_URI = uriOriginal
      config.__definirColecaoTeste(colecaoFake)
    }
  })

  console.log('')
  console.log(`🗄️ Collection usada no teste: ${config.NOME_COLECAO} (db: ${config.NOME_BANCO})`)
  console.log('ℹ️ O padrão de conexão real (singleton + ping + reconexão) é o MESMO')
  console.log('   já validado em produção pelos módulos database.js / vip.js / rpg/database.js.')
  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()