// ============================================
// 🪪 lid.js — Resolução LID ↔ NÚMERO DE TELEFONE REAL
// ============================================
// O WhatsApp (Baileys v7, com LID habilitado) às vezes identifica membros
// pelo LID (ex.: "175952680210489@lid") em vez do número real
// ("554184062975@s.whatsapp.net"). Gravar/consultar dados por LID quebra
// qualquer base indexada por telefone (VIPs, blacklist, etc.) — o
// /servip, por exemplo, exibia o LID no lugar do número.
//
// Este módulo centraliza a resolução LID→número reutilizando DUAS fontes
// que JÁ existem no projeto (nada de lógica nova paralela):
//
//   1) 🔎 METADADOS DO GRUPO (config.js — acharParticipante, a MESMA
//      abordagem PROOF-LID do ehDonoDoBot): procura o participante pelo
//      id (pode ser o LID) e devolve o `phoneNumber` (número real);
//
//   2) 🗄️ MAPEAMENTO DA SESSÃO (sessao-mongo.js): a Baileys grava o par
//      telefone↔LID na collection de auth (lib/Signal/lid-mapping.js):
//         keys.set({ 'lid-mapping': { [telefone]: lidUser,
//                                     [lidUser+'_reverse']: telefone } })
//      A mongo-baileys persiste cada par com _id = "lid-mapping-<id>"
//      (auth.js:114), e o vestirColecaoAuth devolve o valor STRING puro
//      no findOne (__rawValue__). Logo, para um LID "175952680210489":
//         findOne({ _id: 'lid-mapping-175952680210489_reverse' })
//      → "554184062975" (número real, quando o mapeamento já sincronizou).
//
// Funções:
//   - resolverNumeroAlvo(participants, jidBruto)  → { numero, via }
//       via: 'direto' (jid já é número real) | 'metadados' | 'mapeamento'
//       | null (LID não resolvível — o chamador decide o que fazer)
//   - resolverLidParaTelefone(lid) → telefone (dígitos) ou null
//
// ✳️ Toda falha de resolução é best-effort (loga e devolve null) — nunca
// derruba o comando que a chamou. Há cache em memória para não repetir
// a consulta ao Mongo a cada uso.
// ============================================

const { limparNumero, acharParticipante } = require('./config')
const { obterColecaoAuth } = require('./sessao-mongo')

// 🧠 Cache em memória: LID (dígitos) → telefone real (dígitos)
const cacheLidTelefone = new Map()

// 🪵 Consulta ao mapeamento da sessão (variável p/ o gancho de teste)
let consultarSessao = async (lid) => {
  const colecaoAuth = await obterColecaoAuth()
  // Formato gravado pela mongo-baileys: _id = "lid-mapping-<lid>_reverse",
  // valor = STRING pura do telefone (devolvida pura pelo __rawValue__).
  const documento = await colecaoAuth.findOne({ _id: `lid-mapping-${lid}_reverse` })
  return limparNumero(documento) || null
}

// 🧪 Gancho de teste (mesmo padrão dos __definirColecaoTeste do projeto):
// injeta uma consulta fake e limpa o cache. Passando null, volta ao real.
function __definirConsultaSessaoTeste(fn) {
  cacheLidTelefone.clear()
  consultarSessao = fn || (async (lid) => {
    const colecaoAuth = await obterColecaoAuth()
    const documento = await colecaoAuth.findOne({ _id: `lid-mapping-${lid}_reverse` })
    return limparNumero(documento) || null
  })
}

// 🪪 Diz se um JID é LID (termina com "@lid")
function ehLid(jid) {
  return String(jid || '').trim().endsWith('@lid')
}

// -------------------------------------------------------------------
// 🔎 resolverLidParaTelefone(lid): resolve um LID ("...@lid" ou só os
// dígitos) para o número de telefone real, consultando o mapeamento
// gravado pela Baileys na sessão (com cache). Devolve os DÍGITOS do
// telefone ou null (sem mapeamento/falha). NUNCA lança.
// -------------------------------------------------------------------
async function resolverLidParaTelefone(lidBruto) {
  const lid = limparNumero(lidBruto)
  if (!lid) return null

  if (cacheLidTelefone.has(lid)) return cacheLidTelefone.get(lid)

  try {
    const telefone = await consultarSessao(lid)
    if (telefone) {
      cacheLidTelefone.set(lid, telefone)
      console.log(`[lid] 🔎 LID ${lid} resolvido p/ o número real ${telefone}`)
    }
    return telefone
  } catch (err) {
    console.error('[lid] ⚠️ falha ao consultar o mapeamento LID→telefone na sessão:', err?.message || err)
    return null
  }
}

// -------------------------------------------------------------------
// 🎯 resolverNumeroAlvo(participants, jidBruto): resolve um alvo vindo de
// menção/reply (mentionedJid / contextInfo.participant) para o NÚMERO REAL.
// Ordem de resolução (mesma do ehDonoDoBot, PROOF-LID):
//   1) JID não é @lid → já é número real (limparNumero resolve o :device);
//   2) @lid → participante nos metadados do grupo (phoneNumber);
//   3) @lid → mapeamento "lid-mapping" da sessão (Mongo).
// NUNCA lança. `via: null` = não foi possível resolver o número real
// (o chamador NÃO deve gravar o LID cru — veja /darvip).
// -------------------------------------------------------------------
async function resolverNumeroAlvo(participants, jidBruto) {
  const jid = String(jidBruto || '').trim()
  const numeroDireto = limparNumero(jid)
  if (!numeroDireto) return { numero: '', via: null }

  // 1) JID real (ex.: "@s.whatsapp.net") — nada a resolver
  if (!ehLid(jid)) return { numero: numeroDireto, via: 'direto' }

  // 2) Metadados do grupo: participante achado pelo id (LID) → phoneNumber
  const participante = acharParticipante(participants, jid)
  const numeroMetadados = limparNumero(participante?.phoneNumber)
  if (numeroMetadados) return { numero: numeroMetadados, via: 'metadados' }

  // 3) Mapeamento da sessão gravado pela Baileys (lid-mapping reverse)
  const numeroSessao = await resolverLidParaTelefone(numeroDireto)
  if (numeroSessao) return { numero: numeroSessao, via: 'mapeamento' }

  // Não resolvível agora — devolve o LID cru com via: null p/ o chamador
  // decidir (o /darvip recusa e pede o número digitado, p/ não gravar LID).
  return { numero: numeroDireto, via: null }
}

module.exports = {
  ehLid,
  resolverNumeroAlvo,
  resolverLidParaTelefone,
  __definirConsultaSessaoTeste
}
