// ============================================
// 🔐 vip-acesso.js — Acesso EXCLUSIVO a VIP (resolução LID + isVip)
// ============================================
// Fonte única da checagem "este remetente é VIP?" usada pelos comandos de
// privilégio do selo 💠 VIP (/nomecustom e /corvip):
//
//   1) 🪪 resolverRemetente(sock, jid, msg) — metadados do grupo + lid.js
//      (padrão PROOF-LID do /revelaraudio): em grupos com LID habilitado o
//      sender chega como "175952680210489@lid" enquanto o registro de VIP
//      está no NÚMERO REAL. Devolve { sender, numeroReal, candidatos } e o
//      `alvo` já no número real — que é exatamente onde o /darvip grava o
//      documento de VIP (e onde o nome custom e a cor VIP são lidos/gravados).
//
//   2) 🔐 checarAcessoVip(sock, jid, msg) — roda o `vip.isVip` (o MESMO
//      sistema do /darvip e do /listavip) em cada candidato. EXCLUSIVO VIP:
//      admin do grupo e dono do bot NÃO entram (diferente do /revelaraudio,
//      que atende os três). Falha de infra (Mongo fora/sem URI) recusa com
//      segurança — nunca libera sem saber.
//
//   3) 🧪 _injetarChecarVip(fn) — gancho dos testes offline (passando null,
//      volta para a checagem real).
//
// ⚠️ Este módulo mora na RAIZ (fora de comandos/) de propósito: o loader do
// bot.js percorre comandos/ e avisa em todo módulo sem nome/executar —
// helpers de comando já existentes ficam dentro de comandos/, mas este é
// compartilhado por dois comandos e é lógica de NÚCLEO do sistema de VIP.
// ============================================

const { resolverNumeroAlvo } = require('./lid')
const vip = require('./vip')

// 💠 Checagem real de VIP.
// 🛡️ Sem MONGODB_URI o próprio vip.js lança um erro IMEDIATO e local (ele
// checa a variável antes de tocar em rede) — o catch de checarAcessoVip
// recusa na hora, sem esperar timeout por um resultado que não existe.
const checarVipReal = async (alvo) => vip.isVip(alvo)
let checarVip = checarVipReal

// -------------------------------------------------------------------
// 🪪 resolverRemetente(sock, jid, msg, rotulo): metadados do grupo +
// lid.js (metadados → lid-mapping) para chegar no número REAL.
// NUNCA lança: falha é logada e segue sem resolver.
// -------------------------------------------------------------------
async function resolverRemetente(sock, jid, msg, rotulo = 'vip') {
  const sender = msg?.key?.participant || msg?.key?.remoteJid || ''
  let participantes = []
  if (String(jid || '').endsWith('@g.us')) {
    try {
      const metadados = await sock.groupMetadata(jid)
      participantes = metadados?.participants || []
    } catch (errMeta) {
      console.error(`[${rotulo}] ⚠️ sem metadados do grupo:`, errMeta?.message || errMeta)
    }
  }

  const candidatos = [sender]
  let numeroReal = ''
  try {
    const { numero, via } = await resolverNumeroAlvo(participantes, sender)
    if (via !== null && numero) {
      numeroReal = numero
      candidatos.push(`${numero}@s.whatsapp.net`)
    }
  } catch (errLid) {
    console.error(`[${rotulo}] ⚠️ falha ao resolver o remetente:`, errLid?.message || errLid)
  }

  return { sender, numeroReal, candidatos }
}

// 🎯 alvoDoRemetente: o JID do NÚMERO REAL quando resolvido (o documento de
// VIP é indexado por ele); sem resolução, o próprio sender.
function alvoDoRemetente({ sender, numeroReal }) {
  return numeroReal ? `${numeroReal}@s.whatsapp.net` : sender
}

// -------------------------------------------------------------------
// 🔐 checarAcessoVip(sock, jid, msg, rotulo): resolve o remetente e roda o
// vip.isVip em cada candidato. Devolve
// { autorizado, sender, numeroReal, candidatos, alvo }.
// -------------------------------------------------------------------
async function checarAcessoVip(sock, jid, msg, rotulo = 'vip') {
  const resolucao = await resolverRemetente(sock, jid, msg, rotulo)
  const { candidatos } = resolucao

  let autorizado = false
  for (const candidato of candidatos) {
    try {
      if (await checarVip(candidato)) {
        autorizado = true
        break
      }
    } catch (errVip) {
      console.error(`[${rotulo}] ⚠️ falha ao checar VIP (seguindo sem liberar):`, errVip?.message || errVip)
    }
  }

  return { ...resolucao, alvo: alvoDoRemetente(resolucao), autorizado }
}

module.exports = {
  resolverRemetente,
  alvoDoRemetente,
  checarAcessoVip,
  _injetarChecarVip: (fn) => { checarVip = fn || checarVipReal }
}
