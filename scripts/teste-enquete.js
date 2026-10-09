// ============================================================
// 🧪 teste-enquete.js — Testes OFFLINE do /enquete (+ /encerrar-enquete)
// ============================================================
// RODA SEM WhatsApp e SEM rede: sock mockado e agendador injetado (nenhum
// timer real de 2 minutos é criado).
// ⚠️ MONGODB_URI zerada no TOPO (o config.js carrega o .env da raiz).
//
// Cobre: criação nativa, votos cifrados no protocolo real do Baileys,
// troca de voto, resultado com vencedora, empate, encerramento
// por TEMPO e MANUAL, bloqueio de enquete duplicada, bloqueio cruzado
// com outro jogo, limites de opções, fora de grupo e erro de rede.
// Uso: node scripts/teste-enquete.js
// ============================================================

process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''

const jogosAtivos = require('../dados/jogos-ativos')
const protocolo = require('./helpers/enquete-nativa-fake')
const modulos = require('../comandos/menu-brincadeiras/enquete')
const enquete = modulos[0]          // /enquete
const encerrarCmd = modulos[1]      // /encerrar-enquete

const JID = '120363000000000000@g.us'
const A = '5511900000001@s.whatsapp.net'
const B = '5511900000002@s.whatsapp.net'
const C = '5511900000003@s.whatsapp.net'

let passou = 0
let falhou = 0
function ok (cond, nome, extra) {
  if (cond) { passou++; console.log(`✅ ${nome}`) } else { falhou++; console.log(`❌ ${nome}${extra ? ': ' + extra : ''}`) }
}

function criarSock () {
  const enviadas = []
  return {
    enviadas,
    sock: { user: { id: protocolo.BOT }, sendMessage: async (para, conteudo, extra) => { enviadas.push({ para, conteudo, extra }); return protocolo.mensagemEnviada(para, conteudo) } }
  }
}

function msg (autor) {
  return {
    key: { remoteJid: JID, participant: autor, fromMe: false, id: 'M' + Math.random().toString(36).slice(2, 7) },
    message: { conversation: '/enquete' }
  }
}

const ultimo = (e) => (e.length ? e[e.length - 1].conteudo?.text || '' : '')
const textos = (e) => e.map((x) => x.conteudo?.text || '').join(' | ')

// ⏱️ Agendador controlado: guarda o callback, NUNCA cria timer real
let timerAgendado = null
enquete._injetarAgendador((fn) => { timerAgendado = fn; return 1 }, () => {})

async function abrir (pergunta = 'Melhor opção?', opcoes = ['Ana', 'Bia', 'Cauã']) {
  jogosAtivos.limparJogos()
  timerAgendado = null
  const s = criarSock()
  await enquete.executar(s.sock, JID, msg(A), `/enquete ${pergunta} | ${opcoes.join(' | ')}`)
  return s
}

const votar = async (s, quem, texto) => {
  const dados = enquete._enqueteAtiva(JID)
  const indice = /^\d+$/.test(texto) ? Number(texto) - 1 : dados?.opcoes.findIndex(o => o.toLowerCase() === texto.toLowerCase())
  const mensagem = dados && indice >= 0 && indice < dados.opcoes.length ? protocolo.voto(dados, JID, quem, [indice]) : msg(quem)
  return jogosAtivos.processarMensagemLivre(s.sock, JID, mensagem, texto)
}

async function main () {
  console.log('🧪 /enquete — testes offline\n')

  // 0) Contrato dos comandos
  ok(Array.isArray(modulos) && modulos.length === 2, 'módulo exporta 2 comandos (array, padrão do loader)')
  ok(enquete.nome === 'enquete', 'nome = enquete')
  ok(encerrarCmd.nome === 'encerrar-enquete', 'nome = encerrar-enquete')
  ok(typeof enquete.executar === 'function' && typeof encerrarCmd.executar === 'function', 'ambos têm executar')
  ok(enquete.MAX_OPCOES === 12 && enquete.MIN_OPCOES === 2, 'limite de 2 a 12 opções')
  ok(enquete.TIPO_JOGO === jogosAtivos.TIPOS.ENQUETE, 'tipo registrado no registro compartilhado')

  // 0.1) parse: pergunta + opções
  const p = enquete.parse('/enquete Melhor? | Ana | Bia | Caua')
  ok(p.pergunta === 'Melhor?' && p.opcoes.length === 3, 'parse separa pergunta e opções', JSON.stringify(p))
  ok(enquete.parse('/enquete sem separador').opcoes.length === 0, 'sem "|" não acha opções')

  // 1) CRIAÇÃO
  let s = await abrir()
  let t = ultimo(s.enviadas)
  const poll = s.enviadas[0].conteudo.poll
  ok(Boolean(poll), 'a enquete nativa foi criada')
  ok(poll.name === 'Melhor opção?', 'a pergunta aparece na enquete')
  ok(poll.values.join('|') === 'Ana|Bia|Cauã', 'opções nativas preservadas')
  ok(poll.selectableCount === 1, 'apenas uma escolha por pessoa')
  ok(jogosAtivos.tipoAtivo(JID) === 'enquete', 'a enquete ficou registrada no grupo')
  ok(typeof timerAgendado === 'function', 'o timer de duração foi agendado')

  // O helper converte a escolha em voto nativo criptografado.
  ok(await votar(s, A, '1') === true, 'voto nativo na primeira opção é aceito')
  ok(s.enviadas.length === 1, 'voto nativo não gera confirmação por texto')
  let d = enquete._enqueteAtiva(JID)
  ok(d.votos.get(0).has(A.split('@')[0]), 'o voto foi para a opção 1')

  ok(await votar(s, B, 'Bia') === true, 'voto nativo na opção Bia é aceito')
  d = enquete._enqueteAtiva(JID)
  ok(d.votos.get(1).has(B.split('@')[0]), 'o voto foi para a opção 2 (Bia)')

  // 2.2) Voto inválido (número fora / texto desconhecido) → silêncio
  const antesRuidoso = s.enviadas.length
  ok(await votar(s, C, '9') === false, 'número fora da faixa não é voto')
  ok(await votar(s, C, 'lixo qualquer') === false, 'texto desconhecido não é voto')
  ok(s.enviadas.length === antesRuidoso, 'voto inválido não gera mensagem')

  // 2.3) Um voto por pessoa: votar de novo TROCA
  await votar(s, A, '3')
  d = enquete._enqueteAtiva(JID)
  ok(!d.votos.get(0).has(A.split('@')[0]), 'o voto antigo foi removido ao trocar')
  ok(d.votos.get(2).has(A.split('@')[0]), 'o voto novo foi registrado')
  ok(enquete.apurar(d).total === 2, 'continua sendo 1 voto por pessoa', String(enquete.apurar(d).total))

  // 3) RESULTADO com vencedora
  s = await abrir('Pizza ou sushi?', ['Pizza', 'Sushi'])
  await votar(s, A, '1')     // Pizza
  await votar(s, B, 'pizza')  // Pizza (pelo texto, sem acento)
  await votar(s, C, '2')     // Sushi
  const enc = criarSock()
  await encerrarCmd.executar(enc.sock, JID, msg(A))
  t = ultimo(enc.enviadas)
  ok(/ENQUETE ENCERRADA/i.test(t), 'o encerramento manual anuncia', t)
  ok(/VENCEDORA/i.test(t), 'há uma opção vencedora')
  ok(t.includes('Pizza'), 'a vencedora foi identificada', t)
  ok(/2 voto/.test(t), 'a contagem de votos aparece', t)
  ok(jogosAtivos.tipoAtivo(JID) === null, 'a enquete saiu do registro')

  // 4) EMPATE
  s = await abrir('Empate?', ['Xis', 'Ipsilon'])
  await votar(s, A, '1')
  await votar(s, B, '2')
  const encEmpate = criarSock()
  await encerrarCmd.executar(encEmpate.sock, JID, msg(A))
  t = ultimo(encEmpate.enviadas)
  ok(/EMPATE/i.test(t), 'o empate é anunciado', t)
  ok(!/VENCEDORA/i.test(t), 'não há vencedora única no empate', t)
  ok(t.includes('Xis') && t.includes('Ipsilon'), 'as duas empatadas aparecem', t)

  // 4.1) Enquete sem votos
  s = await abrir('Ninguém vota?', ['A1', 'B1'])
  const encVazio = criarSock()
  await encerrarCmd.executar(encVazio.sock, JID, msg(A))
  t = ultimo(encVazio.enviadas)
  ok(/Ninguém votou/i.test(t), 'enquete sem votos avisa', t)

  // 5) ENCERRAMENTO POR TEMPO
  s = await abrir('Por tempo?', ['A2', 'B2'])
  await votar(s, A, '2')
  if (timerAgendado) timerAgendado()
  t = ultimo(s.enviadas)
  ok(/TEMPO ESGOTADO/i.test(t), 'o tempo encerra a enquete', t)
  ok(t.includes('B2'), 'o resultado do fim do tempo mostra a vencedora', t)
  ok(jogosAtivos.tipoAtivo(JID) === null, 'o registro foi limpo no fim do tempo')

  // 6) BLOQUEIO de enquete duplicada
  s = await abrir('Duplicada?', ['A3', 'B3'])
  const dup = criarSock()
  await enquete.executar(dup.sock, JID, msg(C), '/enquete outra | X | Y')
  t = ultimo(dup.enviadas)
  ok(/🔒/.test(t) && /enquete/i.test(t), 'a segunda enquete é bloqueada', t)
  ok(enquete._enqueteAtiva(JID).pergunta === 'Duplicada?', 'a enquete original continua de pé')

  // 6.1) BLOQUEIO CRUZADO com outro jogo
  jogosAtivos.limparJogos()
  jogosAtivos.registrarJogo(JID, jogosAtivos.TIPOS.GARTIC, { palavra: 'X' })
  const cruzado = criarSock()
  await enquete.executar(cruzado.sock, JID, msg(A), '/enquete teste cruzado | 1 | 2')
  ok(/gartic/i.test(ultimo(cruzado.enviadas)), 'não abre com outro jogo rolando', ultimo(cruzado.enviadas))
  jogosAtivos.limparJogos()

  // 7) Encerramento manual: só quem criou
  s = await abrir('Privada?', ['A4', 'B4'])
  const outro = criarSock()
  await encerrarCmd.executar(outro.sock, JID, msg(C)) // C não criou
  t = outro.enviadas
  ok(/Só quem criou/i.test(ultimo(t)), 'quem não criou não encerra', ultimo(t))
  ok(jogosAtivos.tipoAtivo(JID) === 'enquete', 'a enquete continua aberta')

  // 7.1) /encerrar-enquete sem enquete ativa
  jogosAtivos.limparJogos()
  const semEnquete = criarSock()
  await encerrarCmd.executar(semEnquete.sock, JID, msg(A))
  ok(/Não tem nenhuma enquete/i.test(ultimo(semEnquete.enviadas)), 'encerra sem enquete avisa', ultimo(semEnquete.enviadas))

  // 8) Limites de opções
  jogosAtivos.limparJogos()
  let lim = criarSock()
  await enquete.executar(lim.sock, JID, msg(A), '/enquete so uma | X')
  ok(/pelo menos/i.test(ultimo(lim.enviadas)), 'exige pelo menos 2 opções', ultimo(lim.enviadas))
  lim = criarSock()
  await enquete.executar(lim.sock, JID, msg(A), '/enquete muitas | 1|2|3|4|5|6|7|8|9|10|11|12|13')
  ok(/Limite de/i.test(ultimo(lim.enviadas)), 'recusa mais de 12 opções', ultimo(lim.enviadas))

  // 8.1) Sem "|" → instruções de uso
  lim = criarSock()
  await enquete.executar(lim.sock, JID, msg(A), '/enquete')
  ok(/monte assim/i.test(ultimo(lim.enviadas)), 'sem opções mostra o modo de uso', ultimo(lim.enviadas))

  // 9) Fora de grupo
  const pv = criarSock()
  await enquete.executar(pv.sock, A, msg(A), '/enquete pergunta | X | Y')
  ok(/coisa de grupo/i.test(ultimo(pv.enviadas)), 'fora de grupo avisa', ultimo(pv.enviadas))

  // 10) Erro de rede não escapa
  const quebrado = { sendMessage: async () => { throw new Error('rede fora') } }
  let escapou = false
  try {
    await enquete.executar(quebrado, JID, msg(A), '/enquete x | y | z')
  } catch (e) { escapou = true }
  ok(escapou === false, 'erro de rede não escapa para o socket')
  jogosAtivos.limparJogos()

  // 11) Vote sem enquete ativa não é consumido (não engole a mensagem)
  jogosAtivos.limparJogos()
  const vag = criarSock()
  ok(await votar(vag, A, '1') === false, 'sem enquete ativa o número não é engolido')

  console.log(`\n🎉 ${passou} testes passaram, ${falhou} falharam (enquete)\n`)
  process.exit(falhou === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('💥 erro fatal:', err)
  process.exit(1)
})
