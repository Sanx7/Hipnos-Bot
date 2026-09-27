// ============================================================
// 🧪 teste-desenharpalavra.js — Testes OFFLINE do /desenharpalavra
// ============================================================
// RODA SEM WhatsApp e SEM rede: sock mockado e agendador injetado
// (nenhum timer real de 3 minutos é criado).
// ⚠️ MONGODB_URI zerada no TOPO (o config.js carrega o .env da raiz).
//
// Cobre: início com a palavra SÓ no PV do descritor, aviso no grupo SEM
// a palavra, dica bloqueada (palavra e raiz), palpite certo de outro
// jogador, palpite errado em silêncio, palpite do descritor não conta,
// timeout revelando a palavra, bloqueio de jogo duplicado, bloqueio
// cruzado, fora de grupo, desistência e a comparação tolerante comum.
// Uso: node scripts/teste-desenharpalavra.js
// ============================================================

process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''

const jogosAtivos = require('../dados/jogos-ativos')
const comparacao = require('../dados/comparacao-palavras')

const DESCRITOR = '5511900000001@s.whatsapp.net'
const JOGADOR = '5511900000002@s.whatsapp.net'
const JOGADOR2 = '5511900000003@s.whatsapp.net'
const JID = '120363000000000000@g.us'
const PV = '5511900000001@s.whatsapp.net'

let passou = 0
let falhou = 0
function ok (cond, nome, extra) {
  if (cond) { passou++; console.log(`✅ ${nome}`) } else { falhou++; console.log(`❌ ${nome}${extra ? ': ' + extra : ''}`) }
}

function criarSock () {
  const enviadas = []
  return {
    enviadas,
    sock: {
      sendMessage: async (para, conteudo, extra) => {
        enviadas.push({ para, conteudo, extra })
        return { key: { id: `f${enviadas.length}` } }
      }
    }
  }
}

function msgDe (autor, texto = '') {
  return {
    key: { remoteJid: JID, participant: autor, fromMe: false, id: 'M' + Math.random().toString(36).slice(2, 7) },
    message: { conversation: texto }
  }
}

const paraGrupo = (e) => e.filter((x) => x.para === JID)
const paraPv = (e) => e.filter((x) => x.para === PV)
const textos = (e) => e.map((x) => x.conteudo?.text || '').join(' | ')
const ultimo = (e) => (e.length ? e[e.length - 1].conteudo?.text || '' : '')

// ⏱️ Agendador controlado: guarda o callback, NUNCA cria timer real
let timerAgendado = null
function injetar () {
  const cmd = require('../comandos/menu-brincadeiras/desenharpalavra')
  cmd._injetarSorteio(() => ({ palavra: 'ELEFANTE', categoria: 'animais' }))
  cmd._injetarAgendador((fn) => { timerAgendado = fn; return 1 }, () => {})
  return cmd
}

async function iniciarRodada (cmd) {
  const { sock, enviadas } = criarSock()
  await cmd.executar(sock, JID, msgDe(DESCRITOR, '/desenharpalavra'), '/desenharpalavra')
  return { sock, enviadas }
}

async function main () {
  console.log('🧪 /desenharpalavra — testes offline\n')

  // 0) Contrato do comando
  const cmd = injetar()
  ok(cmd.nome === 'desenharpalavra', 'nome = desenharpalavra')
  ok(Array.isArray(cmd.aliases) && cmd.aliases.includes('pictionary'), 'alias pictionary')
  ok(typeof cmd.executar === 'function', 'tem executar')
  ok(cmd.TIPO_JOGO === jogosAtivos.TIPOS.DESENHAR_PALAVRA, 'tipo registrado no registro compartilhado')
  ok(cmd.DURACAO_PARTIDA_MS === 3 * 60 * 1000, 'duração de ~3 minutos')

  // 0.1) Comparação tolerante compartilhada
  ok(comparacao.acertou('elefante', 'ELEFANTE') === true, 'acerto ignorando caixa')
  ok(comparacao.acertou('o elefante', 'ELEFANTE') === true, 'acerto ignorando artigo')
  ok(comparacao.acertou('elefante', 'elefantes') === true, 'acerto tolerando variação')
  ok(comparacao.acertou('elefnte', 'ELEFANTE') === true, 'acerto tolerando 1 erro de digitação (7/8 = 0.875)')
  ok(comparacao.acertou('elefnate', 'ELEFANTE') === false, '2 erros de digitação (0.75) ficam fora do limiar 0.8')
  ok(comparacao.acertou('gato', 'ELEFANTE') === false, 'palpite errado não acerta')

  // 0.2) Checagem de dica estragada (palavra e raiz)
  ok(cmd.dicaInvalida('isso é um ELEFANTE', 'ELEFANTE') === true, 'dica com a palavra é invalidada')
  ok(cmd.dicaInvalida('tem listras e tromba', 'ELEFANTE') === false, 'dica boa passa')
  ok(cmd.dicaInvalida('é um elefante gigante', 'ELEFANTE') === true, 'dica com a raiz/plural é invalidada')
  ok(cmd.dicaInvalida('gato', 'ELEFANTE') === false, 'dica sem relação passa')

  // 1) Início: palavra SÓ no PV do descritor
  jogosAtivos.limparJogos()
  timerAgendado = null
  let r = await iniciarRodada(cmd)
  const pv = paraPv(r.enviadas)
  const grupo = paraGrupo(r.enviadas)
  ok(pv.length === 1, 'a palavra foi enviada no PV do descritor', `pv=${pv.length}`)
  ok(textos(pv).includes('ELEFANTE'), 'o PV mostra a palavra sorteada')
  ok(textos(pv).toLowerCase().includes('só você vê'), 'o PV avisa que é sigiloso')
  ok(grupo.length >= 1, 'o grupo recebeu o aviso', `grupo=${grupo.length}`)
  ok(!textos(grupo).includes('ELEFANTE'), '🔐 o NUNCA mostra a palavra no grupo')
  ok(textos(grupo).includes('descritor'), 'o grupo sabe quem é o descritor')
  ok(jogosAtivos.tipoAtivo(JID) === 'desenharpalavra', 'a rodada ficou registrada')
  ok(typeof timerAgendado === 'function', 'o timer de expiração foi agendado')

  // 2) Dica do descritor com a palavra → invalidada
  r = await iniciarRodada(cmd)
  const consumida = await jogosAtivos.processarMensagemLivre(r.sock, JID, msgDe(DESCRITOR, 'é um ELEFANTE gigante'), 'é um ELEFANTE gigante')
  ok(consumida === true, 'a dica estragada é consumida')
  ok(/estragou/i.test(textos(paraGrupo(r.enviadas))), 'o grupo avisou que a dica foi invalidada', ultimo(paraGrupo(r.enviadas)))

  // 3) Dica BOA do descritor → silêncio
  r = await iniciarRodada(cmd)
  const antes = paraGrupo(r.enviadas).length
  const consumidaBoa = await jogosAtivos.processarMensagemLivre(r.sock, JID, msgDe(DESCRITOR, 'tem tromba e listras'), 'tem tromba e listras')
  ok(consumidaBoa === false, 'dica boa NÃO é consumida')
  ok(paraGrupo(r.enviadas).length === antes, 'dica boa gera silêncio no grupo')

  // 4) Palpite ERRADO de um jogador → silêncio
  r = await iniciarRodada(cmd)
  const errados = await jogosAtivos.processarMensagemLivre(r.sock, JID, msgDe(JOGADOR, 'é um gato'), 'é um gato')
  ok(errados === false, 'palpite errado não é consumido')
  ok(jogosAtivos.tipoAtivo(JID) === 'desenharpalavra', 'a rodada continua depois do erro')

  // 5) Palpite CERTO de OUTRO jogador → vence
  r = await iniciarRodada(cmd)
  const certo = await jogosAtivos.processarMensagemLivre(r.sock, JID, msgDe(JOGADOR, 'ELEFANTE'), 'ELEFANTE')
  ok(certo === true, 'palpite certo é consumido')
  const msgVitoria = ultimo(paraGrupo(r.enviadas))
  ok(/ACERTOU/i.test(msgVitoria), 'o grupo recebe o anúncio de acerto', msgVitoria)
  ok(msgVitoria.includes('ELEFANTE'), 'a palavra é revelada na vitória')
  ok(jogosAtivos.tipoAtivo(JID) === null, 'a rodada foi encerrada no acerto')
  const envioVitoria = paraGrupo(r.enviadas)[paraGrupo(r.enviadas).length - 1]
  ok(Array.isArray(envioVitoria.conteudo.mentions) && envioVitoria.conteudo.mentions.includes(JOGADOR), 'o vencedor é marcado (mention)')

  // 5.1) Palpite do PRÓPRIO descritor não vence
  jogosAtivos.limparJogos()
  r = await iniciarRodada(cmd)
  await jogosAtivos.processarMensagemLivre(r.sock, JID, msgDe(DESCRITOR, 'ELEFANTE'), 'ELEFANTE')
  ok(jogosAtivos.tipoAtivo(JID) === 'desenharpalavra', 'o descritor NÃO ganha com o próprio palpite')

  // 5.2) Tolerância vale no palpite (1 erro de digitação + artigo)
  jogosAtivos.limparJogos()
  r = await iniciarRodada(cmd)
  const tolerante = await jogosAtivos.processarMensagemLivre(r.sock, JID, msgDe(JOGADOR2, 'o elefnte!'), 'o elefnte!')
  ok(tolerante === true, 'palpite com 1 erro de digitação também acerta')

  // 6) Timeout: revela a palavra
  jogosAtivos.limparJogos()
  r = await iniciarRodada(cmd)
  if (timerAgendado) timerAgendado()
  const msgTempo = ultimo(paraGrupo(r.enviadas))
  ok(/TEMPO ACABOU/i.test(msgTempo), 'o timeout avisa o grupo', msgTempo)
  ok(msgTempo.includes('ELEFANTE'), 'o timeout revela a palavra')
  ok(jogosAtivos.tipoAtivo(JID) === null, 'a rodada foi encerrada no timeout')

  // 7) Jogo duplicado no mesmo grupo
  jogosAtivos.limparJogos()
  await iniciarRodada(cmd)
  const { sock: s2, enviadas: e2 } = criarSock()
  await cmd.executar(s2, JID, msgDe(DESCRITOR, '/desenharpalavra'), '/desenharpalavra')
  ok(/JÁ TEM UM DESENHO/i.test(textos(paraGrupo(e2))), 'segundo comando avisa que já há rodada', ultimo(paraGrupo(e2)))

  // 7.1) Bloqueio CRUZADO com outro jogo (registro compartilhado)
  // O forca precisa estar ATIVO no registro ANTES da chamada; o
  // registrarJogo é recusado se o desenhopalavra já estiver lá, então
  // limpamos antes de registrar o forca.
  jogosAtivos.limparJogos()
  jogosAtivos.registrarJogo(JID, jogosAtivos.TIPOS.FORCA, { palavra: 'X' })
  const { sock: s3, enviadas: e3 } = criarSock()
  await cmd.executar(s3, JID, msgDe(DESCRITOR, '/desenharpalavra'), '/desenharpalavra')
  ok(/forca/i.test(textos(paraGrupo(e3))), 'não abre com outro jogo rolando', ultimo(paraGrupo(e3)))
  jogosAtivos.limparJogos()

  // 8) Fora de grupo
  const { sock: s4, enviadas: e4 } = criarSock()
  await cmd.executar(s4, PV, msgDe(DESCRITOR, '/desenharpalavra'), '/desenharpalavra')
  ok(/grupo/i.test(textos(e4)), 'fora de grupo avisa que precisa de grupo', ultimo(e4))
  ok(!textos(e4).includes('ELEFANTE'), 'fora de grupo não vaza a palavra')

  // 9) Desistência
  jogosAtivos.limparJogos()
  await iniciarRodada(cmd)
  const { sock: s5, enviadas: e5 } = criarSock()
  await cmd.executar(s5, JID, msgDe(DESCRITOR, '/desenharpalavra desistir'), '/desenharpalavra desistir')
  ok(/encerrada/i.test(textos(paraGrupo(e5))), 'desistir encerra a rodada', ultimo(paraGrupo(e5)))
  ok(jogosAtivos.tipoAtivo(JID) === null, 'a rodada sumiu do registro ao desistir')

  // 10) Erro de rede não escapa
  jogosAtivos.limparJogos()
  const sockQuebrado = { sendMessage: async () => { throw new Error('rede fora') } }
  let escapou = false
  try {
    await cmd.executar(sockQuebrado, JID, msgDe(DESCRITOR, '/desenharpalavra'), '/desenharpalavra')
  } catch (e) { escapou = true }
  ok(escapou === false, 'erro de rede não escapa para o socket')
  jogosAtivos.limparJogos()

  console.log(`\n🎉 ${passou} testes passaram, ${falhou} falharam (desenharpalavra)\n`)
  process.exit(falhou === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('💥 erro fatal:', err)
  process.exit(1)
})