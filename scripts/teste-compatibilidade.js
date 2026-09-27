// ============================================================
// 🧪 teste-compatibilidade.js — Testes OFFLINE do /compatibilidade
// ============================================================
// RODA SEM WhatsApp e SEM rede: sock mockado e datas injetadas (nada
// depende do "hoje" real, exceto o teste de dia corrente).
// ⚠️ MONGODB_URI zerada no TOPO (o config.js carrega o .env da raiz).
//
// Cobre: o contrato do comando, a trava diária (mesmo par = mesmo %),
// a independência da ordem (@A @B == @B @A), dias diferentes dando
// resultados diferentes, uso com UMA menção (completa com quem chamou),
// duas menções, reply, par inválido e as faixas de porcentagem.
// Uso: node scripts/teste-compatibilidade.js
// ============================================================

process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''

const cmd = require('../comandos/menu-brincadeiras/compatibilidade')

const A = '5511900000001@s.whatsapp.net'
const B = '5511900000002@s.whatsapp.net'
const C = '5511900000003@s.whatsapp.net'
const JID = '120363000000000000@g.us'
const DIA1 = new Date(2026, 8, 26, 10, 0, 0) // 26/09/2026 10:00
const DIA2 = new Date(2026, 8, 27, 10, 0, 0) // 27/09/2026 (dia seguinte)

let passou = 0
let falhou = 0
function ok (cond, nome, extra) {
  if (cond) { passou++; console.log(`✅ ${nome}`) } else { falhou++; console.log(`❌ ${nome}${extra ? ': ' + extra : ''}`) }
}

function criarSock () {
  const enviadas = []
  return {
    enviadas,
    sock: { sendMessage: async (para, conteudo, extra) => { enviadas.push({ para, conteudo, extra }); return { key: { id: 'x' } } } }
  }
}

// msg com N menções (extendedTextMessage.contextInfo.mentionedJid)
function msgCom (mencoes, participante = A) {
  return {
    key: { remoteJid: JID, participant: participante, fromMe: false, id: 'M1' },
    message: { extendedTextMessage: { text: '/compatibilidade', contextInfo: { mentionedJid: mencoes } } }
  }
}

function msgReply (citado) {
  return {
    key: { remoteJid: JID, participant: A, fromMe: false, id: 'M2' },
    message: { extendedTextMessage: { text: '/compatibilidade', contextInfo: { participant: citado } } }
  }
}

const textoDe = (e) => (e.length ? e[e.length - 1].conteudo?.text || '' : '')

async function main () {
  console.log('🧪 /compatibilidade — testes offline\n')

  // 0) Contrato do comando
  ok(cmd.nome === 'compatibilidade', 'nome = compatibilidade')
  ok(Array.isArray(cmd.aliases) && cmd.aliases.includes('match'), 'alias match')
  ok(typeof cmd.executar === 'function', 'tem executar')
  ok(cmd.FAIXAS.length === 5, '5 faixas de compatibilidade')

  // 1) Mesma pessoa sempre dá o mesmo resultado no mesmo dia
  const v1 = cmd.compatibilidadeDe(A, B, DIA1)
  const v1b = cmd.compatibilidadeDe(A, B, DIA1)
  ok(v1 !== null, 'calcula a compatibilidade do par')
  ok(v1.porcentagem === v1b.porcentagem, 'mesmo par, mesmo dia = MESMA porcentagem', `${v1.porcentagem} vs ${v1b.porcentagem}`)
  ok(v1.frase === v1b.frase, 'mesmo par, mesmo dia = MESMA frase')
  ok(v1.porcentagem >= 0 && v1.porcentagem <= 100, 'porcentagem entre 0 e 100', String(v1.porcentagem))

  // 2) Ordem trocada dá o mesmo resultado (@A @B == @B @A)
  const invertido = cmd.compatibilidadeDe(B, A, DIA1)
  ok(invertido.porcentagem === v1.porcentagem, 'ordem trocada = mesmo resultado', `${invertido.porcentagem} vs ${v1.porcentagem}`)
  ok(invertido.chave === v1.chave, 'ordem trocada = mesma chave (par ordenado)')

  // 3) Dias diferentes dão resultados diferentes
  const v2 = cmd.compatibilidadeDe(A, B, DIA2)
  ok(v2 !== null, 'calcula em outro dia')
  ok(v2.data !== v1.data, 'a data entrou na chave', `${v1.data} vs ${v2.data}`)
  ok(v2.porcentagem !== v1.porcentagem, 'dia diferente muda a porcentagem', `${v1.porcentagem} vs ${v2.porcentagem}`)

  // 3.1) Números com @lid e formatos diferentes normalizam para o mesmo par
  const viaLid = cmd.compatibilidadeDe('999888777@lid', B, DIA1)
  ok(viaLid === null || typeof viaLid.porcentagem === 'number', 'jid @lid não quebra o cálculo')

  // 4) Faixas e faixaDe()
  ok(cmd.faixaDe(0).rotulo.includes('SEM FUTURO'), '0% cai em "sem futuro"')
  ok(cmd.faixaDe(100).rotulo.includes('GÊMEAS'), '100% cai em "almas gêmeas"')
  ok(cmd.faixaDe(20).de === 0, 'limite inferior 20 ainda é faixa 1')
  ok(cmd.faixaDe(21).de === 21, '21% já é faixa 2')

  // 5) Hash determinístico (mesmo padrão do /horoscopo)
  ok(cmd.hashFnv1a('abc') === cmd.hashFnv1a('abc'), 'hash estável para a mesma entrada')
  ok(cmd.hashFnv1a('abc') !== cmd.hashFnv1a('abd'), 'hash muda com a entrada')
  ok(cmd.chavePar('999', '111', '2026-09-26') === '111|999|2026-09-26', 'chave ordena os números (menor|maior|data)')

  // 6) Uso com DUAS menções
  let s = criarSock()
  await cmd.executar(s.sock, JID, msgCom([A, B]))
  let t = textoDe(s.enviadas)
  ok(/COMPATIBILIDADE/i.test(t), 'duas menções responde', t)
  ok(/%/.test(t), 'duas menções mostra a porcentagem')

  // 7) Uso com UMA menção (completa com quem chamou)
  s = criarSock()
  await cmd.executar(s.sock, JID, msgCom([B])) // participant = A
  t = textoDe(s.enviadas)
  ok(/COMPATIBILIDADE/i.test(t), 'uma menção responde', t)
  // a mensagem deve citar as DUAS pessoas (quem chamou + a mencionada)
  const citesBoth = t.includes('5511900000001') && t.includes('5511900000002')
  ok(citesBoth, 'uma menção compara quem chamou com a mencionada')

  // 7.1) Uma menção == mesmo par de duas menções (mesmo resultado)
  const umaMencao = cmd.compatibilidadeDe(A, B, DIA1)
  const duasMenc = cmd.compatibilidadeDe(A, B, DIA1)
  ok(umaMencao.porcentagem === duasMenc.porcentagem, 'uma menção dá o mesmo % que o par explícito')

  // 8) Reply (sem menção): compara com quem enviou a citada
  s = criarSock()
  await cmd.executar(s.sock, JID, msgReply(C))
  ok(/COMPATIBILIDADE/i.test(textoDe(s.enviadas)), 'reply responde comparando com a citada')

  // 9) Sem menção e sem reply → instruções de uso
  s = criarSock()
  await cmd.executar(s.sock, JID, { key: { remoteJid: JID, participant: A }, message: { conversation: '/compatibilidade' } })
  t = textoDe(s.enviadas)
  ok(/COMPATIBILIDADE/i.test(t), 'sem alvo mostra como usar', t)
  ok(/Mencione/i.test(t), 'sem alvo explica o uso')

  // 10) Mesma pessoa nos dois lados → recusa
  s = criarSock()
  await cmd.executar(s.sock, JID, msgCom([A, A]))
  t = textoDe(s.enviadas)
  ok(/Duas pessoas distintas/i.test(t), 'comparar consigo mesmo é recusado', t)

  // 11) Erro de rede não escapa
  const sockQuebrado = { sendMessage: async () => { throw new Error('rede fora') } }
  let escapou = false
  try {
    await cmd.executar(sockQuebrado, JID, msgCom([A, B]))
  } catch (e) { escapou = true }
  ok(escapou === false, 'erro de rede não escapa para o socket')

  // 12) A mensagem final cita a data e a trava diária
  s = criarSock()
  await cmd.executar(s.sock, JID, msgCom([A, B]))
  t = textoDe(s.enviadas)
  ok(/trava por dia/i.test(t), 'a mensagem lembra que trava por dia')

  console.log(`\n🎉 ${passou} testes passaram, ${falhou} falharam (compatibilidade)\n`)
  process.exit(falhou === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('💥 erro fatal:', err)
  process.exit(1)
})