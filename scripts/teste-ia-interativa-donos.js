// ============================================
// 🧪 teste-ia-interativa-donos.js — cooldown de 15s + reconhecimento dos DONOS
// ============================================
// RODA 100% OFFLINE (nenhuma chamada de rede/Mongo real):
//   - a chamada da IA é substituída por um mock (__definirChamadaIATeste);
//   - o toggle por grupo usa uma collection FAKE (configuracoes-grupo
//     .__definirColecaoTeste);
//   - o mapeamento LID→telefone usa um gancho fake (lid.js
//     .__definirConsultaSessaoTeste) para o cenário de PV.
// Verifica:
//   - cooldown de 15s POR USUÁRIO (2ª msg imediata ignorada; libera após 15s);
//   - mensagem de DONO (grupo, via LID nos metadados) recebe a instrução
//     extra no system prompt, com a personalidade original intacta;
//   - mensagem de NÃO-dono NÃO recebe a instrução;
//   - resolução LID→número (PV e grupo) via lid.js + ehDonoDoBot;
//   - reconhecimento do dono vale A CADA mensagem dele (não só na 1ª).
// No final, roda o teste-loader.js (child_process).
// Uso: node scripts/teste-ia-interativa-donos.js
// ============================================

const { spawnSync } = require('child_process')
const path = require('path')
const ia = require('../ia-interativa')
const config = require('../configuracoes-grupo')
const lid = require('../lid')
const { getDonos } = require('../config')

const JID_GRUPO = '120363777777777777@g.us'
const JID_PRIVADO = '5557777777777@s.whatsapp.net'

const BOT_NUMERO = '5555999999999'
const BOT_JID = `${BOT_NUMERO}@s.whatsapp.net`
const BOT_LID = '999887766554433221@lid'

// Dono real da config (funciona com qualquer .env) + um LID fake para ele
const DONO_NUMERO = getDonos()[0]
const DONO_LID = '333333333333333333@lid'
const NAO_DONO_LID = '444444444444444444@lid'

function criarColecaoFake () {
  const documentos = new Map()
  return {
    async findOne (filtro) { return documentos.get(filtro.grupo_id) || null },
    async updateOne (filtro, atualizacao) {
      const existente = documentos.get(filtro.grupo_id) || { ...filtro }
      Object.assign(existente, atualizacao.$set)
      documentos.set(filtro.grupo_id, existente)
      return {}
    },
    async createIndex () {}
  }
}

const PARTICIPANTES = [
  { id: BOT_LID, admin: 'admin' },
  { id: DONO_LID, phoneNumber: `${DONO_NUMERO}@s.whatsapp.net`, admin: null },
  { id: NAO_DONO_LID, admin: null }
]

function criarSock (participantes = PARTICIPANTES) {
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
      async groupMetadata () { return { participants: participantes } }
    }
  }
}

function criarMsgIA ({ autor = NAO_DONO_LID, mencionados = [BOT_JID] } = {}) {
  return {
    key: { remoteJid: JID_GRUPO, fromMe: false, id: 'MSG', participant: autor },
    pushName: 'Sonhador',
    message: {
      extendedTextMessage: {
        text: 'hipnos, me escuta',
        contextInfo: { mentionedJid: mencionados }
      }
    }
  }
}

const textos = (enviadas) => enviadas.map((e) => e.conteudo?.text).filter((t) => typeof t === 'string')

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

function instalarIAMock (resposta = 'As sombras te ouvem.') {
  const chamadas = []
  ia.__definirChamadaIATeste(async (mensagem, extra) => {
    chamadas.push({ mensagem, extra })
    return resposta
  })
  return chamadas
}

const ehPromptDeDono = (prompt) => /CRIADORES e DONOS/i.test(String(prompt || ''))

async function main () {
  config.__definirColecaoTeste(criarColecaoFake())
  await config.definirIaInterativa(JID_GRUPO, true)
  // 🛡️ Fake PADRÃO p/ o mapeamento LID→telefone (100% offline). Os testes de
  // LID sobrescrevem com o seu cenário e voltam p/ ESTE fake nulo no finally
  // (nunca p/ o Mongo real, para o teste não abrir conexão alguma).
  lid.__definirConsultaSessaoTeste(async () => null)

  // ═══════════════ 1) Prompt: instrução condicional de dono ═══════════════
  await testar('prompt: sem dono = personalidade original, SEM instrução', async () => {
    const base = ia.__promptSistema()
    const montado = ia.__montarPromptSistema(false)
    if (montado !== base) throw new Error('o prompt mudou sem ser dono')
    if (ehPromptDeDono(montado)) throw new Error('instrução de dono presente para não-dono')
  })

  await testar('prompt: com dono = personalidade original + instrução EXTRA anexada', async () => {
    const base = ia.__promptSistema()
    const montado = ia.__montarPromptSistema(true)
    if (!montado.startsWith(base)) throw new Error('a personalidade original foi alterada')
    if (!ehPromptDeDono(montado)) throw new Error('a instrução de dono não foi acrescentada')
    if (montado === base) throw new Error('nada foi acrescentado ao prompt do dono')
  })

  // ═══════════════ 2) Dono em grupo (via LID nos metadados) ═══════════════
  await testar('dono em grupo (LID nos metadados) → system prompt COM a instrução', async () => {
    ia.__resetarCooldownsTeste()
    const chamadas = instalarIAMock()
    const { sock } = criarSock()
    await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ autor: DONO_LID }), 'mestre, sou eu')
    if (chamadas.length !== 1) throw new Error(`a IA foi chamada ${chamadas.length}x`)
    if (chamadas[0].extra?.ehDono !== true) throw new Error('o mock não recebeu ehDono=true')
    if (!ehPromptDeDono(chamadas[0].extra?.promptSistema)) throw new Error('prompt sem a instrução de dono')
  })

  await testar('não-dono em grupo → system prompt SEM a instrução', async () => {
    ia.__resetarCooldownsTeste()
    const chamadas = instalarIAMock()
    const { sock } = criarSock()
    await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ autor: NAO_DONO_LID }), 'oi hipnos')
    if (chamadas.length !== 1) throw new Error(`a IA foi chamada ${chamadas.length}x`)
    if (chamadas[0].extra?.ehDono !== false) throw new Error('não-dono marcado como dono')
    if (ehPromptDeDono(chamadas[0].extra?.promptSistema)) throw new Error('não-dono recebeu instrução de dono')
    if (chamadas[0].extra.promptSistema !== ia.__promptSistema()) throw new Error('prompt difere do original para não-dono')
  })

  await testar('dono reconhecido A CADA mensagem dele (não só na 1ª)', async () => {
    ia.__resetarCooldownsTeste()
    const chamadas = instalarIAMock()
    const { sock } = criarSock()
    const nowOriginal = Date.now
    let agora = nowOriginal()
    Date.now = () => agora
    try {
      for (let i = 0; i < 3; i++) {
        await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ autor: DONO_LID }), `fala ${i + 1}`)
        agora += 16000
      }
    } finally {
      Date.now = nowOriginal
    }
    if (chamadas.length !== 3) throw new Error(`esperava 3 chamadas, veio ${chamadas.length}`)
    chamadas.forEach((c, i) => {
      if (c.extra?.ehDono !== true) throw new Error(`chamada ${i + 1}: dono não reconhecido`)
      if (!ehPromptDeDono(c.extra?.promptSistema)) throw new Error(`chamada ${i + 1}: prompt sem instrução`)
    })
  })

  // ═══════════════ 3) Resolução LID ═══════════════
  await testar('dono em grupo SEM LID nos metadados → resolvido via mapeamento da sessão (lid.js)', async () => {
    ia.__resetarCooldownsTeste()
    lid.__definirConsultaSessaoTeste(async (l) => (l === '333333333333333333' ? DONO_NUMERO : null))
    try {
      const chamadas = instalarIAMock()
      const { sock } = criarSock([PARTICIPANTES[0], PARTICIPANTES[2]])
      await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ autor: DONO_LID }), 'por trás das sombras')
      if (chamadas.length !== 1) throw new Error(`a IA foi chamada ${chamadas.length}x`)
      if (chamadas[0].extra?.ehDono !== true) throw new Error('dono não reconhecido via mapeamento LID')
      if (!ehPromptDeDono(chamadas[0].extra?.promptSistema)) throw new Error('prompt sem instrução')
    } finally {
      lid.__definirConsultaSessaoTeste(async () => null) // volta p/ o fake offline
    }
  })

  await testar('dono no PV via LID → resolvido pelo mapeamento e reconhecido (remetenteEhDono)', async () => {
    lid.__definirConsultaSessaoTeste(async (l) => (l === '333333333333333333' ? DONO_NUMERO : null))
    try {
      const { sock } = criarSock([])
      const msg = { key: { remoteJid: JID_PRIVADO, participant: DONO_LID } }
      if (!(await ia.__remetenteEhDono(sock, JID_PRIVADO, msg))) {
        throw new Error('dono LID no PV não foi reconhecido')
      }
    } finally {
      lid.__definirConsultaSessaoTeste(async () => null) // volta p/ o fake offline
    }
  })

  await testar('não-dono no PV via LID → NÃO reconhecido', async () => {
    lid.__definirConsultaSessaoTeste(async (l) => (l === '444444444444444444' ? '5556666666666' : null))
    try {
      const { sock } = criarSock([])
      const msg = { key: { remoteJid: JID_PRIVADO, participant: NAO_DONO_LID } }
      if (await ia.__remetenteEhDono(sock, JID_PRIVADO, msg)) {
        throw new Error('não-dono foi reconhecido como dono no PV')
      }
    } finally {
      lid.__definirConsultaSessaoTeste(async () => null) // volta p/ o fake offline
    }
  })

  await testar('dono no PV com número real (sem LID) → reconhecido pelo fallback direto', async () => {
    const { sock } = criarSock([])
    const msg = { key: { remoteJid: JID_PRIVADO, participant: `${DONO_NUMERO}@s.whatsapp.net` } }
    if (!(await ia.__remetenteEhDono(sock, JID_PRIVADO, msg))) {
      throw new Error('dono com número real no PV não foi reconhecido')
    }
  })

  await testar('sock com metadados que falham → assume NÃO-dono sem quebrar', async () => {
    const { sock } = criarSock([])
    sock.groupMetadata = async () => { throw new Error('sem metadados (simulado)') }
    const msg = { key: { remoteJid: JID_GRUPO, participant: DONO_LID } }
    if (await ia.__remetenteEhDono(sock, JID_GRUPO, msg)) {
      throw new Error('falha nos metadados não deveria marcar como dono')
    }
  })

  // ═══════════════ 4) Cooldown de 15s ═══════════════
  await testar('cooldown de 15s POR USUÁRIO: 2ª msg imediata é ignorada (mesmo sendo dono)', async () => {
    ia.__resetarCooldownsTeste()
    const chamadas = instalarIAMock()
    const { sock } = criarSock()
    await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ autor: DONO_LID }), 'primeira')
    await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ autor: DONO_LID }), 'segunda')
    if (chamadas.length !== 1) throw new Error(`cooldown falhou (chamadas: ${chamadas.length})`)
    await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ autor: NAO_DONO_LID }), 'do outro')
    if (chamadas.length !== 2) throw new Error('o cooldown vazou para outro usuário')
  })

  await testar('cooldown: responde de novo após 15s (14s ainda bloqueia)', async () => {
    ia.__resetarCooldownsTeste()
    const chamadas = instalarIAMock()
    const { sock } = criarSock()
    const nowOriginal = Date.now
    let agora = nowOriginal()
    Date.now = () => agora
    try {
      await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ autor: NAO_DONO_LID }), 'a')
      agora += 14000
      await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ autor: NAO_DONO_LID }), 'b')
      if (chamadas.length !== 1) throw new Error('respondeu ANTES dos 15s')
      agora += 2000
      await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ autor: NAO_DONO_LID }), 'c')
      if (chamadas.length !== 2) throw new Error('não respondeu DEPOIS dos 15s')
    } finally {
      Date.now = nowOriginal
    }
  })

  // ═══════════════ 5) Integração: resposta enviada ao grupo ═══════════════
  await testar('integração: dono fala → mock responde e o bot envia no grupo citando a msg', async () => {
    ia.__resetarCooldownsTeste()
    instalarIAMock('Sim, meu criador. Os sonhos te aguardam.')
    const { sock, enviadas } = criarSock()
    await ia.processarGatilhoIA(sock, JID_GRUPO, criarMsgIA({ autor: DONO_LID }), 'meu criador, falas comigo?')
    const t = textos(enviadas)
    if (t.length !== 1 || t[0] !== 'Sim, meu criador. Os sonhos te aguardam.') throw new Error('resposta inesperada: ' + t)
    if (enviadas[0].jid !== JID_GRUPO) throw new Error('respondeu no chat errado')
    if (!enviadas[0].opcoes?.quoted) throw new Error('a resposta não citou a mensagem do gatilho')
  })

  ia.__definirChamadaIATeste(null)
  config.__definirColecaoTeste(null)

  // ═══════════════ 6) teste-loader.js no final ═══════════════
  console.log('\n📦 Rodando scripts/teste-loader.js...')
  const loader = spawnSync(process.execPath, [path.join(__dirname, 'teste-loader.js')], { encoding: 'utf8' })
  console.log(loader.stdout || '')
  if (loader.stderr) console.error(loader.stderr)
  if (loader.status !== 0) {
    reprovadas += 1
    console.error('❌ teste-loader.js falhou (status ' + loader.status + ')')
  }

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
