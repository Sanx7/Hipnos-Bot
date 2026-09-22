// ============================================
// 🧪 teste-hidetag.js — Valida a permissão do /hidetag
// ============================================
// RODA OFFLINE: sock fake com groupMetadata/sendMessage simulados — nenhuma
// chamada real ao WhatsApp. O mapeamento LID→número da SESSÃO é injetado no
// lid.js via __definirConsultaSessaoTeste (gancho oficial do módulo). Verifica:
//   - exports (nome, executar);
//   - fora de grupo → aviso, sem convocação;
//   - ADMIN do grupo consegue usar (sender número real);
//   - DONO do bot consegue usar mesmo NÃO sendo admin (regra: admin OU dono)
//     — OWNER_NUMBERS controlado por env ANTES do require do config;
//   - não-admin/não-dono é recusado (sem convocação);
//   - LID: sender "@lid" bate pelo id do participant; sender "@lid" num grupo
//     indexado por NÚMERO resolve via mapeamento da sessão (lid.js);
//     dono "escondido" atrás de LID resolve via ehDonoDoBot;
//     LID não resolvível → só candidato cru (nunca grava LID cru);
//   - menções saem NO FORMATO do grupo (id LID continua LID);
//   - groupMetadata falho → aviso amigável, nada escapa.
// Uso: node scripts/teste-hidetag.js
// ============================================

// 👑 DONO do teste: fixado ANTES de require('../config') (o config.js calcula
// OWNER_NUMBERS no carregamento e o carregarDotEnv NÃO sobrescreve env já
// setada — então este valor vence o .env e o DONOS_PADRAO).
process.env.OWNER_NUMBERS = '5511999990009'

const hidetag = require('../comandos/admin/hidetag')
const { __definirConsultaSessaoTeste } = require('../lid')

const JID = '120363000000000000@g.us'
const DONO = '5511999990009'          // OWNER_NUMBERS do teste (não-admin)
const ADMIN = '5511777766665'         // admin do grupo, sem dono
const INTRUSO = '5511888880008'       // nem admin nem dono

// 🧩 Sock fake: registra envios e devolve os participants pedidos
function criarSock (participantes, opcoes = {}) {
  const enviadas = []
  return {
    enviadas,
    sock: {
      async groupMetadata () {
        if (opcoes.falharMeta) throw new Error('metadata indisponível')
        return { id: JID, subject: 'Grupo Teste', participants: participantes }
      },
      async sendMessage (jid, conteudo) {
        enviadas.push({ jid, conteudo })
        return { key: { id: `fake-${enviadas.length}` } }
      }
    }
  }
}

const msgDe = (participant) => ({
  key: { remoteJid: JID, fromMe: false, id: 'MSG', participant },
  pushName: 'Autor',
  message: { conversation: '/hidetag' }
})

const p = (id, admin = null, phoneNumber) => ({ id, admin, phoneNumber })

const textoUnico = (enviadas) => {
  const t = enviadas.map((e) => e.conteudo?.text).filter((x) => typeof x === 'string')
  if (t.length !== 1) throw new Error(`esperava exatamente 1 mensagem, veio ${t.length}`)
  return t[0]
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
  // 🪵 Mapeamento da sessão LID→número (injetado; limpa o cache a cada call)
  __definirConsultaSessaoTeste(async (lid) => {
    if (lid === '175952680210500') return ADMIN   // LID do admin p/ teste de resolução
    if (lid === '175952680210600') return DONO    // LID do dono p/ teste de resolução
    return null                                    // desconhecido → via: null
  })

  // ═══════════════ 1) Exports e guardas básicas ═══════════════
  await testar('exports: nome hidetag + executar', () => {
    if (hidetag.nome !== 'hidetag') throw new Error('nome errado: ' + hidetag.nome)
    if (typeof hidetag.executar !== 'function') throw new Error('sem executar')
  })

  await testar('fora de grupo → aviso, sem convocação', async () => {
    const { sock, enviadas } = criarSock([])
    await hidetag.executar(sock, '5511999998888@s.whatsapp.net', msgDe('5511999998888@s.whatsapp.net'), '/hidetag oi')
    const texto = textoUnico(enviadas)
    if (!/fora de um território coletivo/.test(texto)) throw new Error('sem aviso de grupo: ' + texto)
    if (enviadas[0].conteudo.mentions) throw new Error('não deveria haver menções fora de grupo')
  })

  // ═══════════════ 2) ADMIN do grupo consegue usar ═══════════════
  await testar('admin do grupo (sender número real) é autorizado', async () => {
    const participantes = [p(`${ADMIN}@s.whatsapp.net`, 'admin'), p(`${INTRUSO}@s.whatsapp.net`)]
    const { sock, enviadas } = criarSock(participantes)
    await hidetag.executar(sock, JID, msgDe(`${ADMIN}@s.whatsapp.net`), '/hidetag comparecam todos')
    const texto = textoUnico(enviadas)
    if (!/CONVOCAÇÃO DO LIMBO/.test(texto)) throw new Error('não convocou: ' + texto)
    if (!/comparecam todos/.test(texto)) throw new Error('perdeu o motivo: ' + texto)
    const mentions = enviadas[0].conteudo.mentions
    if (!Array.isArray(mentions) || mentions.length !== 2) throw new Error('menções erradas: ' + JSON.stringify(mentions))
    if (!mentions.includes(`${ADMIN}@s.whatsapp.net`) || !mentions.includes(`${INTRUSO}@s.whatsapp.net`)) {
      throw new Error('faltou membro nas menções: ' + JSON.stringify(mentions))
    }
  })

  await testar('admin sem motivo → frase padrão da convocação', async () => {
    const participantes = [p(`${ADMIN}@s.whatsapp.net`, 'admin')]
    const { sock, enviadas } = criarSock(participantes)
    await hidetag.executar(sock, JID, msgDe(`${ADMIN}@s.whatsapp.net`), '/hidetag')
    const texto = textoUnico(enviadas)
    if (!/O Soberano não deu explicações/.test(texto)) throw new Error('sem frase padrão: ' + texto)
  })

  // ═══════════════ 3) DONO do bot consegue (mesmo NÃO admin) ═══════════════
  await testar('dono do bot não-admin é autorizado (OWNER_NUMBERS)', async () => {
    const participantes = [p(`${DONO}@s.whatsapp.net`, null), p(`${ADMIN}@s.whatsapp.net`, 'admin')]
    const { sock, enviadas } = criarSock(participantes)
    await hidetag.executar(sock, JID, msgDe(`${DONO}@s.whatsapp.net`), '/hidetag soberano')
    const texto = textoUnico(enviadas)
    if (!/CONVOCAÇÃO DO LIMBO/.test(texto)) throw new Error('dono foi barrado: ' + texto)
    if (!/soberano/.test(texto)) throw new Error('perdeu o motivo: ' + texto)
  })

  await testar('dono de verdade do .env antigo (SEU_LID) segue funcionando', async () => {
    // O valor que vivia hardcoded no antigo SEU_LID continua em OWNER_NUMBERS
    // do DONOS_PADRAO — mas aqui garantimos: dono LISTADO é sempre aceito.
    const participantes = [p(`${DONO}@s.whatsapp.net`, null)]
    const { sock, enviadas } = criarSock(participantes)
    await hidetag.executar(sock, JID, msgDe(`${DONO}@s.whatsapp.net`), '/hidetag x')
    if (!/CONVOCAÇÃO DO LIMBO/.test(textoUnico(enviadas))) throw new Error('dono listado barrado')
  })

  // ═══════════════ 4) Não-admin/não-dono é recusado ═══════════════
  await testar('não-admin/não-dono → recusa, SEM convocação', async () => {
    const participantes = [p(`${ADMIN}@s.whatsapp.net`, 'admin'), p(`${INTRUSO}@s.whatsapp.net`, null)]
    const { sock, enviadas } = criarSock(participantes)
    await hidetag.executar(sock, JID, msgDe(`${INTRUSO}@s.whatsapp.net`), '/hidetag deixa eu')
    const texto = textoUnico(enviadas)
    if (!/recusa sua ordem/.test(texto)) throw new Error('não recusou: ' + texto)
    if (/CONVOCAÇÃO/.test(texto)) throw new Error('recusou mas mandou convocação junto')
    if (enviadas[0].conteudo.mentions) throw new Error('recusado não deveria gerar menções')
  })

  await testar('groupMetadata falho → aviso amigável, nada escapa', async () => {
    const { sock, enviadas } = criarSock([], { falharMeta: true })
    let lancou = false
    try {
      await hidetag.executar(sock, JID, msgDe(`${ADMIN}@s.whatsapp.net`), '/hidetag oi')
    } catch (e) {
      lancou = true
    }
    if (lancou) throw new Error('o executor lançou (deveria avisar)')
    const texto = textoUnico(enviadas)
    if (!/Não consegui ler os membros/.test(texto)) throw new Error('sem aviso de metadata: ' + texto)
  })

  // ═══════════════ 5) LID × número resolvidos (PROOF-LID) ═══════════════
  await testar('sender @lid de ADMIN bate pelo id do participant (grupo LID)', async () => {
    const participantes = [p('175952680210400@lid', 'admin'), p(`${INTRUSO}@s.whatsapp.net`, null)]
    const { sock, enviadas } = criarSock(participantes)
    await hidetag.executar(sock, JID, msgDe('175952680210400@lid'), '/hidetag convocação lid')
    const texto = textoUnico(enviadas)
    if (!/CONVOCAÇÃO DO LIMBO/.test(texto)) throw new Error('admin LID foi barrado: ' + texto)
    // Menções saem NO FORMATO do grupo: id LID continua LID
    const mentions = enviadas[0].conteudo.mentions
    if (!mentions.includes('175952680210400@lid')) throw new Error('menção saiu em formato errado: ' + JSON.stringify(mentions))
  })

  await testar('sender @lid de ADMIN em grupo indexado por NÚMERO → resolve via sessão (lid.js)', async () => {
    // participants só têm número real; o sender só existe como LID → a única
    // saída é o mapeamento da sessão (175952680210500 → ADMIN, injetado).
    const participantes = [p(`${ADMIN}@s.whatsapp.net`, 'admin', ADMIN)]
    const { sock, enviadas } = criarSock(participantes)
    await hidetag.executar(sock, JID, msgDe('175952680210500@lid'), '/hidetag resolvido')
    const texto = textoUnico(enviadas)
    if (!/CONVOCAÇÃO DO LIMBO/.test(texto)) throw new Error('LID→número não resolveu (lid.js?): ' + texto)
  })

  await testar('sender @lid do DONO em grupo por NÚMERO → resolve via sessão e autoriza', async () => {
    const participantes = [p(`${DONO}@s.whatsapp.net`, null), p(`${INTRUSO}@s.whatsapp.net`, null)]
    const { sock, enviadas } = criarSock(participantes)
    await hidetag.executar(sock, JID, msgDe('175952680210600@lid'), '/hidetag dono lid')
    const texto = textoUnico(enviadas)
    if (!/CONVOCAÇÃO DO LIMBO/.test(texto)) throw new Error('dono LID→número foi barrado: ' + texto)
  })

  await testar('sender @lid não resolvível de intruso → recusa (nunca grava LID cru)', async () => {
    // Sessão não mapeia 175952680210999 (retorna null) e o id não bate com
    // ninguém dos participants → via: null → só o candidato cru → recusa.
    const participantes = [p(`${ADMIN}@s.whatsapp.net`, 'admin'), p(`${INTRUSO}@s.whatsapp.net`, null)]
    const { sock, enviadas } = criarSock(participantes)
    await hidetag.executar(sock, JID, msgDe('175952680210999@lid'), '/hidetag ladrão')
    const texto = textoUnico(enviadas)
    if (!/recusa sua ordem/.test(texto)) throw new Error('LID desconhecido passou sem ser dono/admin: ' + texto)
  })

  await testar('sender @lid cujo phoneNumber bate com DONO nos metadados → autoriza', async () => {
    // Grupo LID: id é LID, phoneNumber expõe o número real do dono — o
    // ehDonoDoBot compara os DOIS números do participante contra OWNER_NUMBERS.
    const participantes = [p('175952680210700@lid', null, `${DONO}@s.whatsapp.net`)]
    const { sock, enviadas } = criarSock(participantes)
    await hidetag.executar(sock, JID, msgDe('175952680210700@lid'), '/hidetag dono atrás do lid')
    const texto = textoUnico(enviadas)
    if (!/CONVOCAÇÃO DO LIMBO/.test(texto)) throw new Error('dono via phoneNumber foi barrado: ' + texto)
  })

  // ─── limpeza ───
  __definirConsultaSessaoTeste(null)

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('💥 Falha inesperada no teste:', err)
  process.exit(1)
})