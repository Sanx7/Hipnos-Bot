// ============================================
// 🧪 teste-antilink.js — Permissão do /antilink (pós-correção LID)
// ============================================
// RODA OFFLINE: sock fake (groupMetadata/sendMessage simulados) + LID da
// sessão injetado via __definirConsultaSessaoTeste. O toggle '1'/'0' grava
// em comandos/dados/antias.json — o teste faz BACKUP/RESTORE do arquivo.
// Verifica: exports; admin autorizado (função sensível: toggle grava/remove);
// dono não-admin autorizado; não-admin recusado; LID bate por id (grupo LID);
// LID resolvido via sessão (lid.js); LID não resolvível recusado;
// groupMetadata falho → aviso amigável.
// Uso: node scripts/teste-antilink.js
// ============================================
process.env.OWNER_NUMBERS = '5511999990009' // ANTES do require (config lê no load)

const fs = require('fs')
const path = require('path')
const cmd = require('../comandos/admin/antilink')
const { __definirConsultaSessaoTeste } = require('../lid')

const JID = '120363000000000000@g.us'
const DONO = '5511999990009'
const ADMIN = '5511777766665'
const INTRUSO = '5511888880008'
const CHAVE = 'antiLink'
const RECUSA = /portais deste reino/
const USO = /selar os portais/
const ARQ = path.join(__dirname, '..', 'comandos', 'dados', 'antias.json')
const LID_SESSAO = '175952680210500' // → ADMIN via mapeamento da sessão
const LID_ID = '175952680210400' // id de um participant (grupo LID)
const LID_DESCONHECIDO = '175952680210999'

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
  message: { conversation: '/antilink' }
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

  await testar('exports: nome antilink e executar', () => {
    if (cmd.nome !== 'antilink') throw new Error('nome errado: ' + cmd.nome)
    if (typeof cmd.executar !== 'function') throw new Error('sem executar')
  })

  await testar('admin autorizado → toggle 1 GRAVA e 0 REMOVE (função sensível)', async () => {
    const backup = fs.existsSync(ARQ) ? fs.readFileSync(ARQ, 'utf8') : null
    try {
      let r = criarSock([p(`${ADMIN}@s.whatsapp.net`, 'admin')])
      await cmd.executar(r.sock, JID, msgDe(`${ADMIN}@s.whatsapp.net`), '/antilink 1')
      const cfg1 = JSON.parse(fs.readFileSync(ARQ, 'utf8'))
      if (!Array.isArray(cfg1[CHAVE]) || !cfg1[CHAVE].includes(JID)) throw new Error('toggle 1 não gravou ' + CHAVE)

      r = criarSock([p(`${ADMIN}@s.whatsapp.net`, 'admin')])
      await cmd.executar(r.sock, JID, msgDe(`${ADMIN}@s.whatsapp.net`), '/antilink 0')
      const cfg2 = JSON.parse(fs.readFileSync(ARQ, 'utf8'))
      if (cfg2[CHAVE].includes(JID)) throw new Error('toggle 0 não removeu ' + CHAVE)
    } finally {
      if (backup === null) { if (fs.existsSync(ARQ)) fs.unlinkSync(ARQ) }
      else fs.writeFileSync(ARQ, backup)
    }
  })

  await testar('dono do bot não-admin autorizado → vê o uso', async () => {
    const { sock, enviadas } = criarSock([p(`${DONO}@s.whatsapp.net`, null), p(`${ADMIN}@s.whatsapp.net`, 'admin')])
    await cmd.executar(sock, JID, msgDe(`${DONO}@s.whatsapp.net`), '/antilink')
    const texto = textoUnico(enviadas)
    if (RECUSA.test(texto)) throw new Error('dono barrado: ' + texto)
    if (!USO.test(texto)) throw new Error('não mostrou o uso: ' + texto)
  })

  await testar('não-admin/não-dono → recusa temática, sem efeito', async () => {
    const { sock, enviadas } = criarSock([p(`${ADMIN}@s.whatsapp.net`, 'admin'), p(`${INTRUSO}@s.whatsapp.net`, null)])
    await cmd.executar(sock, JID, msgDe(`${INTRUSO}@s.whatsapp.net`), '/antilink 1')
    const texto = textoUnico(enviadas)
    if (!/Hipnos recusa/.test(texto) || !RECUSA.test(texto)) throw new Error('sem recusa: ' + texto)
  })

  await testar('sender @lid de ADMIN (grupo LID) bate pelo id → autorizado', async () => {
    const { sock, enviadas } = criarSock([p(`${LID_ID}@lid`, 'admin'), p(`${INTRUSO}@s.whatsapp.net`, null)])
    await cmd.executar(sock, JID, msgDe(`${LID_ID}@lid`), '/antilink')
    const texto = textoUnico(enviadas)
    if (!USO.test(texto)) throw new Error('admin LID barrado: ' + texto)
  })

  await testar('sender @lid do ADMIN resolve via SESSÃO (lid.js) → autorizado', async () => {
    const { sock, enviadas } = criarSock([p(`${ADMIN}@s.whatsapp.net`, 'admin')])
    await cmd.executar(sock, JID, msgDe(`${LID_SESSAO}@lid`), '/antilink')
    const texto = textoUnico(enviadas)
    if (!USO.test(texto)) throw new Error('LID→número não resolveu: ' + texto)
  })

  await testar('sender @lid não resolvível de intruso → recusa', async () => {
    const { sock, enviadas } = criarSock([p(`${ADMIN}@s.whatsapp.net`, 'admin'), p(`${INTRUSO}@s.whatsapp.net`, null)])
    await cmd.executar(sock, JID, msgDe(`${LID_DESCONHECIDO}@lid`), '/antilink 1')
    const texto = textoUnico(enviadas)
    if (!RECUSA.test(texto)) throw new Error('LID desconhecido passou: ' + texto)
  })

  await testar('groupMetadata falho → aviso amigável, nada escapa', async () => {
    const { sock, enviadas } = criarSock([], { falharMeta: true })
    let lancou = false
    try { await cmd.executar(sock, JID, msgDe(`${ADMIN}@s.whatsapp.net`), '/antilink 1') } catch (e) { lancou = true }
    if (lancou) throw new Error('o executor lançou')
    if (!/Não consegui ler os membros/.test(textoUnico(enviadas))) throw new Error('sem aviso de metadata')
  })

  __definirConsultaSessaoTeste(null)
  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main().catch((err) => { console.error('💥 Falha inesperada no teste:', err); process.exit(1) })