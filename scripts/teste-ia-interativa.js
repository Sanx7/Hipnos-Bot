// ============================================
// 🧪 teste-ia-interativa.js — IA conversacional + /ia-interativa
// ============================================
// RODA 100% OFFLINE (nenhuma chamada de rede é feita):
//   - a chamada da IA é substituída por um mock (__definirChamadaIATeste);
//   - o toggle por grupo usa uma collection FAKE injetada via
//     configuracoes-grupo.__definirColecaoTeste (mesmo padrão do
//     scripts/teste-welcome-mongo.js).
// Verifica:
//   - exports do módulo e o system prompt (personalidade fixa);
//   - gatilho: menção ao bot (número, JID e LID), reply ao bot, e o que
//     NÃO dispara (menção a terceiros, reply a terceiros, sem contexto);
//   - gatilho em mensagem de mídia (contextInfo fora do extendedTextMessage);
//   - toggle por grupo (desligado → NÃO gasta API), fora de grupo e sem gatilho;
//   - cooldown de 30s POR USUÁRIO (e liberação após os 30s);
//   - falha silenciosa: IA devolve null / lança erro → nada é enviado;
//   - banco fora → assume DESLIGADO (fail-safe), sem quebrar;
//   - /ia-interativa: só dono, status sem argumento, 1/0 gravando no banco;
//   - integração: depois de /ia-interativa 1, o gatilho responde.
// Uso: node scripts/teste-ia-interativa.js
// ============================================

const ia = require('../ia-interativa')
const config = require('../configuracoes-grupo')
const toggle = require('../comandos/menu-dono/ia-toggle')
const { getDonos } = require('../config')

const JID_GRUPO = '120363000000000000@g.us'
const JID_OUTRO_GRUPO = '120363111111111111@g.us'
const JID_PRIVADO = '5551111111111@s.whatsapp.net'

const BOT_NUMERO = '5555999999999'
const BOT_JID = `${BOT_NUMERO}@s.whatsapp.net`
const BOT_LID = '999887766554433221@lid'

const AUTOR_LID = '111111111111111111@lid'
const AUTOR_NUMERO = '5551111111111@s.whatsapp.net'
const OUTRO_LID = '222222222222222222@lid'

// Dono do bot (pego da config real p/ funcionar com qualquer .env)
const DONO = getDonos()[0]
const DONO_LID = '333333333333333333@lid'
const NAO_DONO_LID = '444444444444444444@lid'

// ─── 📦 Collection fake em memória (configuracoesGrupo) ───
function criarColecaoFake ({ falhar = false } = {}) {
  const documentos = new Map()
  return {
    __documentos: documentos,
    async findOne (filtro) {
      if (falhar) throw new Error('mongo fora (simulado)')
      return documentos.get(filtro.grupo_id) || null
    },
    async updateOne (filtro, atualizacao) {
      if (falhar) throw new Error('mongo fora (simulado)')
      const existente = documentos.get(filtro.grupo_id) || { ...filtro }
      Object.assign(existente, atualizacao.$set)
      documentos.set(filtro.grupo_id, existente)
      return {}
    },
    async createIndex () {}
  }
}

// ─── 🧪 Sock mock ───
function criarSock (participantes = []) {
  const enviadas = []
  return {
    enviadas,
    sock: {
      user: { id: `${BOT_NUMERO}:12@s.whatsapp.net`, lid: BOT_LID },
      authState: { creds: { me: { id: `${BOT_NUMERO}:12@s.whatsapp.net`, lid: BOT_LID } } },
      async sendMessage (jid, conteudo, opcoes) {
        enviadas.push({ jid, conteudo, opcoes })
        return { key: { id: 'fake' } }
      },
      async groupMetadata () {
        return { participants: participantes }
      }
    }
  }
}

// ─── 🧪 Mensagem mock (gatilho da IA) ───
function criarMsgIA ({ mencionados = [], citado = null, fromMe = false, texto = 'hipnos, me responde' } = {}) {
  return {
    key: { remoteJid: JID_GRUPO, fromMe, id: 'MSG', participant: AUTOR_LID },
    pushName: 'Sonhador',
    message: {
      extendedTextMessage: {
        text: texto,
        contextInfo: { mentionedJid: mencionados, participant: citado || undefined }
      }
    }
  }
}

const textos = (enviadas) => enviadas
  .map((e) => e.conteudo?.text)
  .filter((t) => typeof t === 'string')

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

// Mock da IA: registra as mensagens recebidas e devolve uma resposta fixa
function instalarIAMock (resposta = 'As sombras sussurram: sim.') {
  const chamadas = []
  ia.__definirChamadaIATeste(async (mensagem) => {
    chamadas.push(mensagem)
    if (typeof resposta === 'function') return resposta(mensagem)
    return resposta
  })
  return chamadas
}

async function main () {
  // ═══════════════ 1) Exports e personalidade ═══════════════
  await testar('exports do módulo (processarGatilhoIA + ganchos de teste)', async () => {
    if (typeof ia.processarGatilhoIA !== 'function') throw new Error('processarGatilhoIA ausente')
    for (const g of ['__definirChamadaIATeste', '__resetarCooldownsTeste', '__disparouGatilho', '__estaEmCooldown', '__promptSistema']) {
      if (typeof ia[g] !== 'function') throw new Error(`gancho ausente: ${g}`)
    }
  })

  await testar('system prompt: personalidade do Hipnos + limite de 2-3 frases', async () => {
    const prompt = ia.__promptSistema()
    if (!/Hipnos/i.test(prompt)) throw new Error('o prompt não cita o Hipnos')
    if (!/sono/i.test(prompt)) throw new Error('o prompt não cita o sono')
    if (!/2-3 frases/i.test(prompt)) throw new Error('o prompt não limita o tamanho da resposta')
    if (!/português do Brasil/i.test(prompt)) throw new Error('o prompt não fixa o idioma pt-BR')
  })

  await testar('comando /ia-interativa: nome e aliases registrados', async () => {
    if (toggle.nome !== 'ia-interativa') throw new Error('nome inesperado: ' + toggle.nome)
    for (const a of ['ia-toggle', 'iatoggle', 'toggleia']) {
      if (!toggle.aliases?.includes(a)) throw new Error(`alias ausente: ${a}`)
    }
  })

  // ═══════════════ 2) Detecção de gatilho ═══════════════
  await testar('gatilho: menção ao número do bot → dispara', async () => {
    const { sock } = criarSock()
    if (!ia.__disparouGatilho(sock, criarMsgIA({ mencionados: [BOT_JID] }))) {
      throw new Error('menção ao JID do bot não disparou')
    }
    if (!ia.__disparouGatilho(sock, criarMsgIA({ mencionados: [BOT_NUMERO] }))) {
      throw new Error('menção ao número puro não disparou')
    }
  })

  await testar('gatilho: menção ao LID do bot → dispara', async () => {
    const { sock } = criarSock()
    const msg = criarMsgIA({ mencionados: [BOT_LID] })
    if (!ia.__disparouGatilho(sock, msg)) throw new Error('menção por LID não disparou')
  })

  await testar('gatilho: menção a OUTRA pessoa → NÃO dispara', async () => {
    const { sock } = criarSock()
    if (ia.__disparouGatilho(sock, criarMsgIA({ mencionados: [OUTRO_LID, AUTOR_NUMERO] }))) {
      throw new Error('disparou sem mencionar o bot')
    }
  })

  await testar('gatilho: reply a mensagem DO BOT → dispara', async () => {
    const { sock } = criarSock()
    if (!ia.__disparouGatilho(sock, criarMsgIA({ citado: BOT_JID }))) {
      throw new Error('reply ao bot não disparou')
    }
    if (!ia.__disparouGatilho(sock, criarMsgIA({ citado: BOT_LID }))) {
      throw new Error('reply ao LID do bot não disparou')
    }
  })

  await testar('gatilho: reply a OUTRA pessoa / sem contexto → NÃO dispara', async () => {
    const { sock } = criarSock()
    if (ia.__disparouGatilho(sock, criarMsgIA({ citado: OUTRO_LID }))) {
      throw new Error('reply a terceiro disparou')
    }
    const semContexto = {
      key: { remoteJid: JID_GRUPO, fromMe: false, id: 'X', participant: AUTOR_LID },
      message: { conversation: 'oi gente' }
    }
    if (ia.__disparouGatilho(sock, semContexto)) throw new Error('mensagem sem contexto disparou')
  })

  await testar('gatilho: mídia (contextInfo fora do extendedTextMessage) → dispara', async () => {
    const { sock } = criarSock()
    const msg = {
      key: { remoteJid: JID_GRUPO, fromMe: false, id: 'IMG', participant: AUTOR_LID },
      message: {
        messageContextInfo: { deviceListMetadataVersion: 2 },
        imageMessage: { caption: 'olha isso', contextInfo: { mentionedJid: [BOT_JID] } }
      }
    }
    if (!ia.__disparouGatilho(sock, msg)) throw new Error('menção em imagem não disparou')
  })

  // ═══════════════ 3) processarGatilhoIA: toggle, cooldown e falhas ═══════════════
  const banco = criarColecaoFake()
  config.__definirColecaoTeste(banco)

  await testar('IA: fora de grupo → ignora (sem gastar API)', async () => {
    ia.__resetarCooldownsTeste()
    const chamadas = instalarIAMock()
    const { sock, enviadas } = criarSock()
    await ia.processarGatilhoIA(sock, JID_PRIVADO, criarMsgIA({ mencionados: [BOT_JID] }), 'oi')
    if (chamadas.length !== 0 || enviadas.length !== 0) throw new Error('respondeu no privado')
  })

  await testar('IA: mensagem SEM gatilho → ignora (sem gastar API)', async () => {
    ia.__resetarCooldownsTeste()
    const chamadas = instalarIAMock()
    const { sock, enviadas } = criarSock()
    await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ mencionados: [OUTRO_LID] }), 'bom dia')
    if (chamadas.length !== 0 || enviadas.length !== 0) throw new Error('respondeu sem gatilho')
  })

  await testar('IA: toggle DESLIGADO no grupo → ignora ANTES de gastar API', async () => {
    await config.definirIaInterativa(JID_GRUPO, false)
    ia.__resetarCooldownsTeste()
    const chamadas = instalarIAMock()
    const { sock, enviadas } = criarSock()
    await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ mencionados: [BOT_JID] }), 'hipnos, responde')
    if (chamadas.length !== 0) throw new Error('chamou a IA com o toggle DESLIGADO')
    if (enviadas.length !== 0) throw new Error('respondeu com o toggle DESLIGADO')
  })

  await testar('IA: toggle LIGADO → responde citando a mensagem e sem histórico', async () => {
    await config.definirIaInterativa(JID_GRUPO, true)
    ia.__resetarCooldownsTeste()
    const chamadas = instalarIAMock('Sussurro da noite: sim.')
    const { sock, enviadas } = criarSock()
    await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ mencionados: [BOT_JID] }), 'hipnos, tudo bem?')

    if (chamadas.length !== 1) throw new Error(`a IA foi chamada ${chamadas.length}x (esperado 1)`)
    if (chamadas[0] !== 'hipnos, tudo bem?') throw new Error('o texto enviado à IA não foi a mensagem atual')
    const t = textos(enviadas)
    if (t.length !== 1 || t[0] !== 'Sussurro da noite: sim.') throw new Error('resposta inesperada: ' + t)
    if (enviadas[0].jid !== JID_GRUPO) throw new Error('respondeu no chat errado')
    if (!enviadas[0].opcoes?.quoted) throw new Error('a resposta não citou (quoted) a mensagem do gatilho')
  })

  await testar('IA: cooldown de 30s POR USUÁRIO (2ª tentativa imediata é ignorada)', async () => {
    await config.definirIaInterativa(JID_GRUPO, true)
    ia.__resetarCooldownsTeste()
    const chamadas = instalarIAMock()
    const { sock } = criarSock()
    const msgA = criarMsgIA({ mencionados: [BOT_JID] })
    await ia.processarGatilhoIA(sock, JID_GRUPO, msgA, 'primeira')
    await ia.processarGatilhoIA(sock, JID_GRUPO, msgA, 'segunda')
    if (chamadas.length !== 1) throw new Error(`cooldown falhou (chamadas: ${chamadas.length})`)

    // Outro usuário no MESMO grupo não é afetado pelo cooldown do primeiro
    const msgOutro = criarMsgIA({ mencionados: [BOT_JID] })
    msgOutro.key.participant = OUTRO_LID
    await ia.processarGatilhoIA(sock, JID_GRUPO, msgOutro, 'oi do outro')
    if (chamadas.length !== 2) throw new Error('o cooldown vazou para outro usuário')
  })

  await testar('IA: após 30s o mesmo usuário é respondido de novo', async () => {
    await config.definirIaInterativa(JID_GRUPO, true)
    ia.__resetarCooldownsTeste()
    const chamadas = instalarIAMock()
    const { sock } = criarSock()
    const nowOriginal = Date.now
    let agora = nowOriginal()
    Date.now = () => agora
    try {
      await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ mencionados: [BOT_JID] }), 'a')
      agora += 29000
      await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ mencionados: [BOT_JID] }), 'b')
      if (chamadas.length !== 1) throw new Error('respondeu ANTES dos 30s')

      agora += 2000 // 31s no total
      await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ mencionados: [BOT_JID] }), 'c')
      if (chamadas.length !== 2) throw new Error('não respondeu DEPOIS dos 30s')
    } finally {
      Date.now = nowOriginal
    }
  })

  await testar('IA: toggle é POR GRUPO (A ligado responde / B desligado em silêncio)', async () => {
    await config.definirIaInterativa(JID_GRUPO, true)
    await config.definirIaInterativa(JID_OUTRO_GRUPO, false)
    ia.__resetarCooldownsTeste()
    const chamadas = instalarIAMock()
    const { sock, enviadas } = criarSock()

    const msgB = criarMsgIA({ mencionados: [BOT_JID] })
    msgB.key.remoteJid = JID_OUTRO_GRUPO
    await ia.processarGatilhoIA(sock, JID_OUTRO_GRUPO, msgB, 'oi B')
    if (chamadas.length !== 0 || enviadas.length !== 0) throw new Error('respondeu no grupo DESLIGADO')

    await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ mencionados: [BOT_JID] }), 'oi A')
    if (chamadas.length !== 1 || enviadas.length !== 1) throw new Error('não respondeu no grupo LIGADO')
  })

  await testar('IA: sem texto na mensagem → ignora', async () => {
    await config.definirIaInterativa(JID_GRUPO, true)
    ia.__resetarCooldownsTeste()
    const chamadas = instalarIAMock()
    const { sock, enviadas } = criarSock()
    await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ mencionados: [BOT_JID] }), '   ')
    if (chamadas.length !== 0 || enviadas.length !== 0) throw new Error('respondeu a mensagem vazia')
  })

  await testar('IA: API devolve null → silêncio total (sem crash)', async () => {
    await config.definirIaInterativa(JID_GRUPO, true)
    ia.__resetarCooldownsTeste()
    instalarIAMock(null)
    const { sock, enviadas } = criarSock()
    await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ mencionados: [BOT_JID] }), 'oi')
    if (enviadas.length !== 0) throw new Error('enviou algo mesmo com a API falhando')
  })

  await testar('IA: chamada da IA LANÇA erro → não vaza para o handler', async () => {
    await config.definirIaInterativa(JID_GRUPO, true)
    ia.__resetarCooldownsTeste()
    ia.__definirChamadaIATeste(async () => { throw new Error('estourou (simulado)') })
    const { sock, enviadas } = criarSock()
    let lancou = false
    try {
      await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ mencionados: [BOT_JID] }), 'oi')
    } catch (err) {
      lancou = true
    }
    if (lancou) throw new Error('processarGatilhoIA lançou erro')
    if (enviadas.length !== 0) throw new Error('enviou algo após o erro')
  })

  await testar('IA: falha ao ENVIAR a resposta → também é silenciosa', async () => {
    await config.definirIaInterativa(JID_GRUPO, true)
    ia.__resetarCooldownsTeste()
    instalarIAMock('resposta qualquer')
    const { sock } = criarSock()
    sock.sendMessage = async () => { throw new Error('connection closed (simulado)') }
    let lancou = false
    try {
      await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ mencionados: [BOT_JID] }), 'oi')
    } catch (err) {
      lancou = true
    }
    if (lancou) throw new Error('o erro de envio escapou para o handler')
  })

  await testar('IA: banco fora → assume DESLIGADO (fail-safe, sem gastar API)', async () => {
    config.__definirColecaoTeste(criarColecaoFake({ falhar: true }))
    try {
      ia.__resetarCooldownsTeste()
      const chamadas = instalarIAMock()
      const { sock, enviadas } = criarSock()
      await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ mencionados: [BOT_JID] }), 'oi')
      if (chamadas.length !== 0) throw new Error('gastou API com o banco fora')
      if (enviadas.length !== 0) throw new Error('respondeu com o banco fora')
    } finally {
      config.__definirColecaoTeste(banco)
    }
  })

  // ═══════════════ 4) Comando /ia-interativa (só dono) ═══════════════
  const PARTICIPANTES = [
    { id: BOT_JID, admin: 'admin' },
    { id: DONO_LID, phoneNumber: `${DONO}@s.whatsapp.net`, admin: null },
    { id: NAO_DONO_LID, phoneNumber: '5599999999999@s.whatsapp.net', admin: 'superadmin' }
  ]

  function msgComando (texto, autor) {
    return {
      key: { remoteJid: JID_GRUPO, fromMe: false, id: 'CMD', participant: autor },
      pushName: 'Sonhador',
      message: { conversation: texto }
    }
  }

  await testar('comando: dono do bot está configurado (pré-requisito do teste)', async () => {
    if (!DONO) throw new Error('nenhum dono em OWNER_NUMBERS — configure o .env')
  })

  await testar('comando: fora de grupo → pede para usar num grupo', async () => {
    const { sock, enviadas } = criarSock(PARTICIPANTES)
    await toggle.executar(sock, JID_PRIVADO, msgComando('/ia-interativa 1', AUTOR_LID), '/ia-interativa 1')
    const t = textos(enviadas)
    if (t.length !== 1 || !/grupo/i.test(t[0])) throw new Error('não avisou sobre grupo: ' + t)
  })

  await testar('comando: ADMIN de grupo (não dono) → recusado e nada gravado', async () => {
    await config.definirIaInterativa(JID_OUTRO_GRUPO, false)
    const { sock, enviadas } = criarSock(PARTICIPANTES)
    await toggle.executar(sock, JID_OUTRO_GRUPO, msgComando('/ia-interativa 1', NAO_DONO_LID), '/ia-interativa 1')
    const t = textos(enviadas)
    if (t.length !== 1 || !/donos/i.test(t[0])) throw new Error('não recusou o não-dono: ' + t)
    if (await config.iaInterativaHabilitada(JID_OUTRO_GRUPO)) throw new Error('não-dono conseguiu ligar a IA')
  })

  await testar('comando: DONO liga a IA → grava no banco (PROOF-LID)', async () => {
    const { sock, enviadas } = criarSock(PARTICIPANTES)
    await toggle.executar(sock, JID_GRUPO, msgComando('/ia-interativa 1', DONO_LID), '/ia-interativa 1')
    const t = textos(enviadas)
    if (t.length !== 1 || !/ATIVADA/i.test(t[0])) throw new Error('não confirmou a ativação: ' + t)
    if (!(await config.iaInterativaHabilitada(JID_GRUPO))) throw new Error('não gravou ia_interativa=true')
    const doc = banco.__documentos.get(JID_GRUPO)
    if (doc?.ia_interativa !== true) throw new Error('documento do grupo sem ia_interativa=true')
  })

  await testar('comando: sem argumento → mostra o estado atual (LIGADA)', async () => {
    const { sock, enviadas } = criarSock(PARTICIPANTES)
    await toggle.executar(sock, JID_GRUPO, msgComando('/ia-interativa', DONO_LID), '/ia-interativa')
    const t = textos(enviadas)
    if (t.length !== 1 || !/LIGADA/i.test(t[0])) throw new Error('status incorreto: ' + t)
  })

  await testar('comando: opção inválida → avisa e NÃO muda o estado', async () => {
    const { sock, enviadas } = criarSock(PARTICIPANTES)
    await toggle.executar(sock, JID_GRUPO, msgComando('/ia-interativa talvez', DONO_LID), '/ia-interativa talvez')
    const t = textos(enviadas)
    if (t.length !== 1 || !/inválido/i.test(t[0])) throw new Error('não avisou do comando inválido: ' + t)
    if (!(await config.iaInterativaHabilitada(JID_GRUPO))) throw new Error('o estado mudou com opção inválida')
  })

  await testar('comando: DONO desliga (0) → grava false e o status muda', async () => {
    const { sock, enviadas } = criarSock(PARTICIPANTES)
    await toggle.executar(sock, JID_GRUPO, msgComando('/ia-interativa 0', DONO_LID), '/ia-interativa 0')
    if (!/DESATIVADA/i.test(textos(enviadas)[0])) throw new Error('não confirmou o desligamento')
    if (await config.iaInterativaHabilitada(JID_GRUPO)) throw new Error('não gravou ia_interativa=false')

    const { sock: s2, enviadas: e2 } = criarSock(PARTICIPANTES)
    await toggle.executar(s2, JID_GRUPO, msgComando('/ia-interativa', DONO_LID), '/ia-interativa')
    if (!/DESLIGADA/i.test(textos(e2)[0])) throw new Error('status deveria ser DESLIGADA')
  })

  await testar('integração: /ia-interativa 1 seguido de menção → o bot responde', async () => {
    await config.definirIaInterativa(JID_GRUPO, false)
    ia.__resetarCooldownsTeste()
    const chamadas = instalarIAMock('Que os sonhos te guardem.')

    // 1) o dono liga pelo comando
    const { sock, enviadas } = criarSock(PARTICIPANTES)
    await toggle.executar(sock, JID_GRUPO, msgComando('/ia-interativa 1', DONO_LID), '/ia-interativa 1')
    if (!(await config.iaInterativaHabilitada(JID_GRUPO))) throw new Error('a IA não ficou ligada')

    // 2) outra pessoa menciona o bot e é respondida
    await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ mencionados: [BOT_JID] }), 'hipnos, o que é o sono?')
    if (chamadas.length !== 1) throw new Error('o gatilho não chamou a IA depois do comando')
    const t = textos(enviadas)
    if (!t.includes('Que os sonhos te guardem.')) throw new Error('a IA não respondeu no grupo: ' + t)
  })

  ia.__definirChamadaIATeste(null)
  config.__definirColecaoTeste(null)

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
