// ============================================================
// 🧪 teste-enquete-admin.js — Testes OFFLINE do /enquete-admin
// ============================================================
// RODA SEM WhatsApp e SEM rede: sock mockado, agendador injetado e o
// banirDoGrupo do /ban com o gancho de gravação de blacklist (o teste
// NUNCA escreve no blacklist.json real).
// ⚠️ MONGODB_URI zerada no TOPO (o config.js carrega o .env da raiz).
//
// Cobre: criação (só admin), votos, troca de voto, encerramento por
// tempo e manual, resultado com vencedora e empate, bloqueio de
// enquete duplicada, bloqueio cruzado, e a AÇÃO DE BAN (o "sim" vence →
// bane; "sim" perde/empate/alvo-dono → não bane).
// Uso: node scripts/teste-enquete-admin.js
// ============================================================

process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''

const jogosAtivos = require('../dados/jogos-ativos')
const protocolo = require('./helpers/enquete-nativa-fake')
const modulos = require('../comandos/admin/enquete-admin')
const enquete = modulos[0]      // /enquete-admin
const encerrarCmd = modulos[1]  // /encerrar-enquete
// 🧪 O /ban grava no disco: trocamos por um espião (mesmo padrão do teste-adv)
const ban = require('../comandos/admin/ban')
const gravadosNaBlacklist = []
ban.__definirGravacaoBlacklistTeste((n) => { gravadosNaBlacklist.push(n) })
// 🔑 A proteção do dono usa a lista REAL de donos do config.js
const { getDonos } = require('../config')

const JID = '120363000000000000@g.us'
const ADMIN = '5511900000001@s.whatsapp.net'
const MEMBRO = '5511900000002@s.whatsapp.net'
const MEMBRO2 = '5511900000003@s.whatsapp.net'
const ALVO_BAN = '5511900000009@s.whatsapp.net'
const LID_MEMBRO = '999888777@lid'

const PARTICIPANTES = [
  { id: ADMIN, admin: 'admin' },
  { id: MEMBRO },
  { id: MEMBRO2 },
  { id: LID_MEMBRO, phoneNumber: MEMBRO }, // mesmo_member, chegando como LID
  { id: ALVO_BAN }
]

let passou = 0
let falhou = 0
function ok (cond, nome, extra) {
  if (cond) { passou++; console.log(`✅ ${nome}`) } else { falhou++; console.log(`❌ ${nome}${extra ? ': ' + extra : ''}`) }
}

const baneados = []
function criarSock () {
  const enviadas = []
  return {
    enviadas, baneados,
    sock: {
      user: { id: '5511999999999@s.whatsapp.net' },
      groupMetadata: async () => ({ participants: PARTICIPANTES, owner: ADMIN }),
      groupParticipantsUpdate: async (gid, alvos, acao) => { baneados.push({ alvos, acao }); return alvos },
      sendMessage: async (para, conteudo, extra) => { enviadas.push({ para, conteudo, extra }); return protocolo.mensagemEnviada(para, conteudo) }
    }
  }
}

function msg (autor = ADMIN) {
  return {
    key: { remoteJid: JID, participant: autor, fromMe: false, id: 'M' + Math.random().toString(36).slice(2, 7) },
    message: { conversation: '/enquete-admin' }
  }
}

function msgComMencao (mencionado) {
  return {
    key: { remoteJid: JID, participant: ADMIN, fromMe: false, id: 'MM' },
    message: { extendedTextMessage: { text: '/enquete-admin-ban', contextInfo: { mentionedJid: [mencionado] } } }
  }
}

const ultimo = (e) => (e.length ? e[e.length - 1].conteudo?.text || '' : '')
const textos = (e) => e.map((x) => x.conteudo?.text || '').join(' | ')

// ⏱️ Agendador controlado: guarda o callback, NUNCA cria timer real
let timerAgendado = null
enquete._injetarAgendador((fn) => { timerAgendado = fn; return 1 }, () => {})

const votar = async (s, quem, n) => {
  const dados = enquete._enqueteAtiva(JID)
  const indice = Number(n) - 1
  const mensagem = dados && Number.isInteger(indice) && indice >= 0 && indice < dados.opcoes.length ? protocolo.voto(dados, JID, quem, [indice]) : msg(quem)
  return jogosAtivos.processarMensagemLivre(s.sock, JID, mensagem, String(n))
}

async function abrir (pergunta = 'Mudar a regra?', opcoes = ['Sim', 'Não']) {
  jogosAtivos.limparJogos()
  timerAgendado = null
  gravadosNaBlacklist.length = 0
  baneados.length = 0
  const s = criarSock()
  await enquete.executar(s.sock, JID, msg(ADMIN), `/enquete-admin ${pergunta} | ${opcoes.join(' | ')}`)
  return s
}

async function main () {
  console.log('🧪 /enquete-admin — testes offline\n')

  // 0) Contrato
  ok(Array.isArray(modulos) && modulos.length === 2, 'módulo exporta 2 comandos (array, padrão do loader)')
  ok(enquete.nome === 'enquete-admin' && encerrarCmd.nome === 'encerrar-enquete', 'nomes corretos')
  ok(typeof enquete.executar === 'function', 'tem executar')
  ok(enquete.TIPO_JOGO === jogosAtivos.TIPOS.ENQUETE_ADMIN, 'tipo registrado no compartilhado')
  const p = enquete.parse('/enquete-admin Mudar? | Sim | Não')
  ok(p.pergunta === 'Mudar?' && p.opcoes.length === 2, 'parse separa pergunta e opções', JSON.stringify(p))

  // 1) SÓ ADMIN abre
  let s = criarSock()
  await enquete.executar(s.sock, JID, msg(MEMBRO), '/enquete-admin Isso? | Sim | Não')
  ok(/administradores/i.test(ultimo(s.enviadas)), 'membro comum NÃO abre votação', ultimo(s.enviadas))
  ok(jogosAtivos.tipoAtivo(JID) === null, 'nada foi registrado para o membro')

  // 1.1) Admin abre
  s = await abrir()
  let t = ultimo(s.enviadas)
  ok(s.enviadas[0].conteudo.poll?.name === 'Mudar a regra?', 'admin abre a enquete nativa')
  ok(s.enviadas[0].conteudo.poll?.values.join('|') === 'Sim|Não', 'opções nativas preservadas')
  ok(jogosAtivos.tipoAtivo(JID) === 'enquete-admin', 'votação registrada no grupo')
  ok(typeof timerAgendado === 'function', 'timer de duração agendado')

  // 2) VOTOS
  ok(await votar(s, MEMBRO, 1) === true, 'voto nativo na primeira opção é aceito')
  let d = enquete._enqueteAtiva(JID)
  ok(d.votos.get(0).size === 1, '1 voto na opção 1')
  ok(await votar(s, MEMBRO2, 2) === true, 'segundo voto aceito')
  d = enquete._enqueteAtiva(JID)
  ok(enquete.apurar(d).total === 2, 'total de 2 votos', String(enquete.apurar(d).total))

  // 2.1) Troca de voto
  await votar(s, MEMBRO, 2)
  d = enquete._enqueteAtiva(JID)
  ok(d.votos.get(0).size === 0, 'o voto antigo saiu da opção 1')
  ok(d.votos.get(1).size === 2, 'os 2 votos agora estão na opção 2')
  ok(enquete.apurar(d).total === 2, 'continua sendo 1 voto por pessoa')

  // 2.2) Voto por LID conta como a MESMA pessoa (não vira 2 votos)
  s = await abrir()
  await votar(s, MEMBRO, 1)
  await votar(s, LID_MEMBRO, 2) // mesmo MEMBRO chegando como @lid
  d = enquete._enqueteAtiva(JID)
  ok(enquete.apurar(d).total === 1, 'voto via @lid conta como a mesma pessoa', String(enquete.apurar(d).total))

  // 2.3) Voto inválido
  s = await abrir()
  const antes = s.enviadas.length
  ok(await votar(s, MEMBRO, 9) === false, 'número fora da faixa não é voto')
  ok(await votar(s, MEMBRO, 'sim') === false, 'texto livre não é voto nativo')
  ok(s.enviadas.length === antes, 'voto inválido é ignorado em silêncio')

  // 3) RESULTADO com vencedora
  s = await abrir('Mudar a regra?', ['Sim', 'Não'])
  await votar(s, MEMBRO, 1)
  await votar(s, MEMBRO2, 1)
  const enc = criarSock()
  await encerrarCmd.executar(enc.sock, JID, msg(ADMIN))
  t = ultimo(enc.enviadas)
  ok(/VOTACAO ENCERRADA|VOTAÇÃO ENCERRADA/i.test(t), 'resultado anunciado', t)
  ok(/VENCEU/i.test(t), 'há vencedora', t)
  ok(/2 voto/.test(t), 'contagem aparece', t)
  ok(jogosAtivos.tipoAtivo(JID) === null, 'saiu do registro')

  // 4) EMPATE
  s = await abrir('Empate?', ['X', 'Y'])
  await votar(s, MEMBRO, 1)
  await votar(s, MEMBRO2, 2)
  const encE = criarSock()
  await encerrarCmd.executar(encE.sock, JID, msg(ADMIN))
  t = ultimo(encE.enviadas)
  ok(/EMPATE/i.test(t), 'empate anunciado', t)
  ok(/não decide nada|Nada foi decidido|não decide/i.test(textos(encE.enviadas)), 'empate não decide nada', t)

  // 5) ENCERRAMENTO POR TEMPO
  s = await abrir('Por tempo?', ['A', 'B'])
  await votar(s, MEMBRO, 1)
  if (timerAgendado) timerAgendado()
  t = ultimo(s.enviadas)
  ok(/TEMPO ESGOTADO/i.test(t), 'o tempo encerra a votação', t)
  ok(t.includes('A'), 'mostra a vencedora do fim do tempo', t)
  ok(jogosAtivos.tipoAtivo(JID) === null, 'registro limpo no fim do tempo')

  // 6) ENCERRAMENTO MANUAL só por admin
  s = await abrir('Privada?', ['A', 'B'])
  const naoAdmin = criarSock()
  await encerrarCmd.executar(naoAdmin.sock, JID, msg(MEMBRO))
  ok(/administradores/i.test(ultimo(naoAdmin.enviadas)), 'membro não encerra', ultimo(naoAdmin.enviadas))
  ok(jogosAtivos.tipoAtivo(JID) === 'enquete-admin', 'votação continua aberta')

  // 7) BLOQUEIO de enquete duplicada
  s = await abrir('Duplicada?', ['A', 'B'])
  const dup = criarSock()
  await enquete.executar(dup.sock, JID, msg(ADMIN), '/enquete-admin outra | X | Y')
  ok(/🔒/.test(ultimo(dup.enviadas)), 'segunda votação é bloqueada', ultimo(dup.enviadas))
  ok(enquete._enqueteAtiva(JID).pergunta === 'Duplicada?', 'a original continua de pé')

  // 7.1) BLOQUEIO CRUZADO com a /enquete de opinião
  jogosAtivos.limparJogos()
  jogosAtivos.registrarJogo(JID, jogosAtivos.TIPOS.ENQUETE, { pergunta: 'x', opcoes: ['a', 'b'], votos: new Map() })
  const cruz = criarSock()
  await enquete.executar(cruz.sock, JID, msg(ADMIN), '/enquete-admin teste | 1 | 2')
  ok(/enquete/i.test(ultimo(cruz.enviadas)), 'não abre com a /enquete de opinião ativa', ultimo(cruz.enviadas))
  jogosAtivos.limparJogos()

  // 8) AÇÃO DE BAN — o "sim" vence → bane automaticamente
  jogosAtivos.limparJogos()
  gravadosNaBlacklist.length = 0
  baneados.length = 0
  const ban1 = criarSock()
  await enquete.executar(ban1.sock, JID, msgComMencao(ALVO_BAN), '/enquete-admin-ban @alvo | sim | não')
  t = ultimo(ban1.enviadas)
  ok(ban1.enviadas.some(e => e.conteudo.poll?.name === 'Banir o marcado?'), 'votação nativa de ban foi criada')
  ok(textos(ban1.enviadas).includes('5511900000009'), 'a mensagem avisa que o alvo pode ser banido')
  await votar(ban1, MEMBRO, 1)  // sim
  await votar(ban1, MEMBRO2, 1) // sim
  const encBan = criarSock()
  await encerrarCmd.executar(encBan.sock, JID, msg(ADMIN))
  ok(baneados.length === 1, 'o alvo FOI removido do grupo', JSON.stringify(baneados))
  ok(baneados[0] && baneados[0].acao === 'remove', 'a ação é "remove"', JSON.stringify(baneados[0]))
  ok(gravadosNaBlacklist.includes('5511900000009'), 'o alvo foi para a blacklist', JSON.stringify(gravadosNaBlacklist))
  ok(/Decisão executada/i.test(textos(encBan.enviadas)), 'o grupo foi avisado da decisão', ultimo(encBan.enviadas))

  // 8.1) "sim" PERDE → ninguém é banido
  jogosAtivos.limparJogos()
  gravadosNaBlacklist.length = 0
  baneados.length = 0
  const ban2 = criarSock()
  await enquete.executar(ban2.sock, JID, msgComMencao(ALVO_BAN), '/enquete-admin-ban @alvo | sim | não')
  await votar(ban2, MEMBRO, 1)
  await votar(ban2, MEMBRO2, 2) // "não" vence
  await enquete.encerrarManual(ban2.sock, JID, msg(ADMIN), ADMIN)
  ok(baneados.length === 0, 'se o "não" vence, ninguém é banido', JSON.stringify(baneados))
  ok(gravadosNaBlacklist.length === 0, 'nada foi gravado na blacklist')
  ok(/SIM não venceu/i.test(textos(ban2.enviadas)), 'o grupo é avisado que o SIM perdeu', ultimo(ban2.enviadas))

  // 8.2) EMPATE em votação de ban → não decide
  jogosAtivos.limparJogos()
  gravadosNaBlacklist.length = 0
  baneados.length = 0
  const ban3 = criarSock()
  await enquete.executar(ban3.sock, JID, msgComMencao(ALVO_BAN), '/enquete-admin-ban @alvo | sim | não')
  await votar(ban3, MEMBRO, 1)
  await votar(ban3, MEMBRO2, 2)
  await enquete.encerrarManual(ban3.sock, JID, msg(ADMIN), ADMIN)
  ok(baneados.length === 0, 'empate em ban não bane ninguém', JSON.stringify(baneados))
  ok(gravadosNaBlacklist.length === 0, 'empate não grava na blacklist')

  // 8.3) PROTEÇÃO DO DONO DO BOT: se o alvo for dono, nunca bane
  //     Usa um número REAL da lista de donos (config.js), senão o teste
  //     passaria a banir "qualquer um" e não provaria a proteção.
  const DONO = `${getDonos()[0]}@s.whatsapp.net`
  const comDono = [
    ...PARTICIPANTES,
    { id: DONO, admin: 'admin' }
  ]
  jogosAtivos.limparJogos()
  gravadosNaBlacklist.length = 0
  baneados.length = 0
  const ban4 = criarSock()
  ban4.sock.groupMetadata = async () => ({ participants: comDono, owner: ADMIN })
  await enquete.executar(ban4.sock, JID, msgComMencao(DONO), '/enquete-admin-ban @dono | sim | não')
  await votar(ban4, MEMBRO, 1)
  await enquete.encerrarManual(ban4.sock, JID, msg(ADMIN), ADMIN)
  ok(baneados.length === 0, 'nunca bane o dono do bot (mesmo com "sim" vencendo)', JSON.stringify(baneados))
  ok(gravadosNaBlacklist.length === 0, 'dono não entra na blacklist')
  ok(/dono do bot/i.test(textos(ban4.enviadas)), 'o motivo da recusa é explicado', ultimo(ban4.enviadas))

  // 8.4) A enquete comum NÃO tem alvo de ban (não executa nada ao fechar)
  s = await abrir('Só opinião', ['A', 'B'])
  await votar(s, MEMBRO, 1)
  const encSimples = criarSock()
  await encerrarCmd.executar(encSimples.sock, JID, msg(ADMIN))
  ok(baneados.length === 0, 'enquete de opinião não bane ninguém', JSON.stringify(baneados))

  // 9) Fora de grupo
  const pv = criarSock()
  await enquete.executar(pv.sock, ADMIN, msg(ADMIN), '/enquete-admin x | 1 | 2')
  ok(/grupo/i.test(ultimo(pv.enviadas)), 'fora de grupo avisa', ultimo(pv.enviadas))

  // 10) Erro de rede não escapa
  const quebrado = { sendMessage: async () => { throw new Error('rede fora') }, groupMetadata: async () => ({ participants: PARTICIPANTES }) }
  let escapou = false
  try { await enquete.executar(quebrado, JID, msg(ADMIN), '/enquete-admin x | 1 | 2') } catch (e) { escapou = true }
  ok(escapou === false, 'erro de rede não escapa para o socket')
  jogosAtivos.limparJogos()

  console.log(`\n🎉 ${passou} testes passaram, ${falhou} falharam (enquete-admin)\n`)
  process.exit(falhou === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('💥 erro fatal:', err)
  process.exit(1)
})
