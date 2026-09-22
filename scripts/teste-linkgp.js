// ============================================
// 🧪 teste-linkgp.js — Permissão do /linkgp (pós-correção LID)
// ============================================
// RODA OFFLINE: sock fake (groupMetadata/groupInviteCode/sendMessage
// simulados) + LID da sessão injetado via __definirConsultaSessaoTeste.
// Função sensível: revelar o link de convite (groupInviteCode) — o teste
// afirma o link enviado E que NÃO é chamado na recusa.
// Verifica: exports; admin autorizado; dono não-admin autorizado; intruso
// recusado (sem groupInviteCode); LID por id (grupo LID); LID via sessão;
// LID não resolvível recusado; groupMetadata falho → aviso.
// Uso: node scripts/teste-linkgp.js
// ============================================
process.env.OWNER_NUMBERS = '5511999990009' // ANTES do require (config lê no load)

const cmd = require('../comandos/admin/linkgp')
const { __definirConsultaSessaoTeste } = require('../lid')

const JID = '120363000000000000@g.us'
const DONO = '5511999990009'
const ADMIN = '5511777766665'
const INTRUSO = '5511888880008'
const RECUSA = /apenas os administradores e o Soberano/
const LINK = /chat\.whatsapp\.com\/AbCdEfGhIjK/
const LID_SESSAO = '175952680210500' // → ADMIN via mapeamento da sessão
const LID_ID = '175952680210400' // id de um participant (grupo LID)
const LID_DESCONHECIDO = '175952680210999'

function criarSock (participantes, opcoes = {}) {
  const enviadas = []
  let chamadasConvite = 0
  return {
    enviadas,
    get chamadasConvite () { return chamadasConvite },
    sock: {
      async groupMetadata () {
        if (opcoes.falharMeta) throw new Error('metadata indisponível')
        return { id: JID, subject: 'Grupo Teste', participants: participantes }
      },
      async groupInviteCode () {
        chamadasConvite += 1
        return 'AbCdEfGhIjK'
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
  message: { conversation: '/linkgp' }
})
const p = (id, admin = null, phoneNumber) => ({ id, admin, phoneNumber })
const textoUnico = (enviadas) => {
  const t = enviadas.map((e) => e.conteudo?.text).filter((x) => typeof x === 'string')
  if (t.length !== 1) throw new Error(`esperava 1 mensagem, veio ${t.length}`)
  return t[0]
}

let reprovadas = 0
async function testar (nome, fn) {
  try { await fn(); console.log('✅ ' + nome) } catch (err) {
    reprovadas += 1
    console.error('❌ ' + nome + ' →', err?.message || err)
  }
}

async function main () {
  __definirConsultaSessaoTeste(async (lid) => (lid === LID_SESSAO ? ADMIN : null))

  await testar('exports: nome linkgp e executar', () => {
    if (cmd.nome !== 'linkgp') throw new Error('nome errado: ' + cmd.nome)
    if (typeof cmd.executar !== 'function') throw new Error('sem executar')
  })

  await testar('admin autorizado → revela o link (função sensível)', async () => {
    const r = criarSock([p(`${ADMIN}@s.whatsapp.net`, 'admin')])
    await cmd.executar(r.sock, JID, msgDe(`${ADMIN}@s.whatsapp.net`), '/linkgp')
    const texto = textoUnico(r.enviadas)
    if (!LINK.test(texto)) throw new Error('não revelou o link: ' + texto)
    if (r.chamadasConvite !== 1) throw new Error('groupInviteCode x' + r.chamadasConvite)
  })

  await testar('dono do bot não-admin autorizado → revela o link', async () => {
    const r = criarSock([p(`${DONO}@s.whatsapp.net`, null), p(`${ADMIN}@s.whatsapp.net`, 'admin')])
    await cmd.executar(r.sock, JID, msgDe(`${DONO}@s.whatsapp.net`), '/linkgp')
    if (!LINK.test(textoUnico(r.enviadas))) throw new Error('dono barrado')
  })

  await testar('não-admin/não-dono → recusa, groupInviteCode NÃO é chamado', async () => {
    const r = criarSock([p(`${ADMIN}@s.whatsapp.net`, 'admin'), p(`${INTRUSO}@s.whatsapp.net`, null)])
    await cmd.executar(r.sock, JID, msgDe(`${INTRUSO}@s.whatsapp.net`), '/linkgp')
    const texto = textoUnico(r.enviadas)
    if (!/Hipnos recusa/.test(texto) || !RECUSA.test(texto)) throw new Error('sem recusa: ' + texto)
    if (r.chamadasConvite !== 0) throw new Error('vazou o groupInviteCode pra intruso!')
  })

  await testar('sender @lid de ADMIN (grupo LID) bate pelo id → autorizado', async () => {
    const r = criarSock([p(`${LID_ID}@lid`, 'admin'), p(`${INTRUSO}@s.whatsapp.net`, null)])
    await cmd.executar(r.sock, JID, msgDe(`${LID_ID}@lid`), '/linkgp')
    if (!LINK.test(textoUnico(r.enviadas))) throw new Error('admin LID barrado')
  })

  await testar('sender @lid do ADMIN resolve via SESSÃO (lid.js) → autorizado', async () => {
    const r = criarSock([p(`${ADMIN}@s.whatsapp.net`, 'admin')])
    await cmd.executar(r.sock, JID, msgDe(`${LID_SESSAO}@lid`), '/linkgp')
    if (!LINK.test(textoUnico(r.enviadas))) throw new Error('LID→número não resolveu')
  })

  await testar('sender @lid não resolvível de intruso → recusa', async () => {
    const r = criarSock([p(`${ADMIN}@s.whatsapp.net`, 'admin'), p(`${INTRUSO}@s.whatsapp.net`, null)])
    await cmd.executar(r.sock, JID, msgDe(`${LID_DESCONHECIDO}@lid`), '/linkgp')
    const texto = textoUnico(r.enviadas)
    if (!RECUSA.test(texto)) throw new Error('LID desconhecido passou: ' + texto)
    if (r.chamadasConvite !== 0) throw new Error('vazou o groupInviteCode!')
  })

  await testar('groupMetadata falho → aviso amigável, nada escapa', async () => {
    const r = criarSock([], { falharMeta: true })
    let lancou = false
    try { await cmd.executar(r.sock, JID, msgDe(`${ADMIN}@s.whatsapp.net`), '/linkgp') } catch (e) { lancou = true }
    if (lancou) throw new Error('o executor lançou')
    if (!/Não consegui ler os membros/.test(textoUnico(r.enviadas))) throw new Error('sem aviso de metadata')
  })

  __definirConsultaSessaoTeste(null)
  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main().catch((err) => { console.error('💥 Falha inesperada no teste:', err); process.exit(1) })