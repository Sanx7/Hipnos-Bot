// ============================================================
// 🧪 teste-adivinha-emoji.js — Testes OFFLINE do /adivinha-emoji
// Parte 1/2: harness + sorteio/acerto/tolerância
// Rode com: node scripts/teste-adivinha-emoji.js
// ============================================================

const cmd = require('../comandos/menu-brincadeiras/adivinha-emoji')
const banco = require('../dados/emoji-charadas')
const jogosAtivos = require('../dados/jogos-ativos')

let passou = 0
function ok (nome, cond) {
  if (!cond) throw new Error('FALHOU: ' + nome)
  passou++
  console.log(`  ✅ ${nome}`)
}

function fakeSock () {
  const enviadas = []
  return { enviadas, sendMessage: async (jid, conteudo, opts) => { enviadas.push({ jid, conteudo, opts }); return {} } }
}

function fakeMsg (autor) {
  return { key: { remoteJid: 'JID', participant: autor || '5511888888888@s.whatsapp.net', fromMe: false }, message: { conversation: '/adivinha-emoji' } }
}

function ultimoTexto (sock) {
  return String(sock.enviadas[sock.enviadas.length - 1]?.conteudo?.text || '')
}

const JID = '120363000000000000@g.us'
const JID2 = '120363000000000001@g.us'

const FIXA = { emojis: '🦁👑', resposta: 'o rei leão', dicas: ['filhote que vira rei da selva'] }
const SEM_DICA = { emojis: '🧪👨', resposta: 'matrix', dicas: [] }
cmd._injetarSorteio(() => FIXA)
// Agendador fake: captura os timers em vez de esperar de verdade.
let timers = []
let seqTimer = 0
cmd._injetarAgendador((fn, ms) => { const id = ++seqTimer; timers.push({ id, fn, ms }); return id }, () => {})
function timerPorMs (ms) { return timers.find((t) => t.ms === ms) }

;(async () => {
  console.log('🧪 /adivinha-emoji — testes offline\n')

  console.log('── Exports e banco ──')
  ok('nome = adivinha-emoji', cmd.nome === 'adivinha-emoji')
  ok('aliases completos', Array.isArray(cmd.aliases) && cmd.aliases.includes('emojiadivinha') && cmd.aliases.includes('adivinheemoji'))
  ok('executar é função', typeof cmd.executar === 'function')
  ok('banco tem 150+ itens', Array.isArray(banco) && banco.length >= 150)
  ok('itens bem formados', banco.every((it) => typeof it.emojis === 'string' && it.emojis.trim() && typeof it.resposta === 'string' && it.resposta.trim() && Array.isArray(it.dicas)))
  ok('limiar é 0.8', cmd.LIMIAR_SIMILARIDADE === 0.8)
  ok('duracao é ~90s', cmd.DURACAO_PARTIDA_MS === 90000)
  ok('intervalo de dica é ~20s', cmd.INTERVALO_DICA_MS === 20000)
  ok('tipo registrado', cmd.TIPO_JOGO === jogosAtivos.TIPOS.ADIVINHA_EMOJI)

  console.log('── Sorteio ──')
  jogosAtivos.limparJogos()
  timers = []
  {
    const sock = fakeSock()
    await cmd.executar(sock, JID, fakeMsg(), '/adivinha-emoji')
    const t = ultimoTexto(sock)
    ok('envia os emojis', t.includes('🦁👑'))
    ok('NÃO revela a resposta na largada', !t.toLowerCase().includes('rei leão') && !t.toLowerCase().includes('rei leao'))
    ok('mostra o tempo (~90s)', t.includes('90'))
    ok('registra o jogo', jogosAtivos.tipoAtivo(JID) === 'adivinha-emoji')
    ok('agenda o fim (~90s)', !!timerPorMs(90000))
    ok('agenda a dica (~20s)', !!timerPorMs(20000))
  }

  console.log('── Acerto exato e tolerância ──')
  {
    ok('exato acerta', cmd.acertou('o rei leão', 'o rei leão') === true)
    ok('maiúscula acerta', cmd.acertou('O REI LEÃO', 'o rei leão') === true)
    ok('sem acento acerta', cmd.acertou('o rei leao', 'o rei leão') === true)
    ok('parcial razoável acerta', cmd.acertou('rei leão', 'o rei leão') === true)
    ok('pequeno typo acerta', cmd.acertou('o rey leao', 'o rei leão') === true)
    ok('nada a ver erra', cmd.acertou('titanic', 'o rei leão') === false)
    ok('curto demais erra', cmd.acertou('o', 'o rei leão') === false)
    ok('vazio erra', cmd.acertou('', 'o rei leão') === false)
  }

  console.log('── Palpite via texto livre ──')
  {
    const sock = fakeSock()
    let ret = await jogosAtivos.processarMensagemLivre(sock, JID, fakeMsg(), 'titanic do mar')
    ok('chute errado não consome', ret === false)
    ok('chute errado mantém o jogo', jogosAtivos.estaAtivo(JID) === true)
    ret = await jogosAtivos.processarMensagemLivre(sock, JID, fakeMsg('5511999999999@s.whatsapp.net'), 'Rei Leao')
    ok('acerto tolerante consome', ret === true)
    ok('acerto menciona o vencedor', (sock.enviadas[sock.enviadas.length - 1]?.conteudo?.mentions || []).length === 1)
    ok('acerto revela a resposta', ultimoTexto(sock).includes('o rei leão'))
    ok('acerto encerra', jogosAtivos.estaAtivo(JID) === false)
  }

  console.log('── Dica no tempo certo ──')
  {
    jogosAtivos.limparJogos()
    timers = []
    const sock = fakeSock()
    await cmd.executar(sock, JID, fakeMsg(), '/adivinha-emoji')
    const antes = sock.enviadas.length
    const dica = timerPorMs(20000)
    ok('timer de dica existe', !!dica)
    await dica.fn()
    ok('dica revela o texto do banco', ultimoTexto(sock).includes('filhote que vira rei'))
    ok('dica repete os emojis', ultimoTexto(sock).includes('🦁👑'))
    ok('dica mantém o jogo', jogosAtivos.estaAtivo(JID) === true)
    ok('dica reagenda o próximo ciclo', timers.filter((t) => t.ms === 20000).length >= 2)
    ok('dica mandou só 1 mensagem', sock.enviadas.length === antes + 1)
  }

  console.log('── Dica com letra (sem dica no banco) ──')
  {
    jogosAtivos.limparJogos()
    cmd._injetarSorteio(() => SEM_DICA)
    timers = []
    const sock = fakeSock()
    await cmd.executar(sock, JID2, fakeMsg(), '/adivinha-emoji')
    const dica = timerPorMs(20000)
    await dica.fn()
    const t = ultimoTexto(sock)
    ok('sem dica no banco revela letra', t.includes('🔤') && t.includes('m'))
    cmd._injetarSorteio(() => FIXA)
  }

  console.log('── Timeout sem acerto ──')
  {
    jogosAtivos.limparJogos()
    timers = []
    const sock = fakeSock()
    await cmd.executar(sock, JID, fakeMsg(), '/adivinha-emoji')
    const fim = timerPorMs(90000)
    ok('timer de fim existe', !!fim)
    // Troca o sock do estado para ler a mensagem de timeout no mesmo fake.
    jogosAtivos.obterJogo(JID).dados.sock = sock
    await fim.fn()
    ok('timeout revela a resposta', ultimoTexto(sock).includes('o rei leão'))
    ok('timeout encerra', jogosAtivos.estaAtivo(JID) === false)
  }

  console.log('── Bloqueio duplicado e extras ──')
  {
    jogosAtivos.limparJogos()
    timers = []
    const sock = fakeSock()
    await cmd.executar(sock, JID, fakeMsg(), '/adivinha-emoji')
    await cmd.executar(sock, JID, fakeMsg(), '/adivinha-emoji')
    ok('segundo comando mostra a rodada ativa', ultimoTexto(sock).includes('JÁ TEM UM ADIVINHA-EMOJI'))
    jogosAtivos.limparJogos()
    jogosAtivos.registrarJogo(JID, jogosAtivos.TIPOS.VELHA, { partida: {} })
    await cmd.executar(sock, JID, fakeMsg(), '/adivinha-emoji')
    ok('bloqueio cruzado com velha', ultimoTexto(sock).includes('jogo da velha'))
    jogosAtivos.limparJogos()
  }
  {
    jogosAtivos.limparJogos()
    timers = []
    const sock = fakeSock()
    await cmd.executar(sock, JID, fakeMsg(), '/adivinha-emoji')
    await cmd.executar(sock, JID, fakeMsg(), '/adivinha-emoji desistir')
    ok('desistir revela e encerra', ultimoTexto(sock).includes('o rei leão') && jogosAtivos.estaAtivo(JID) === false)
    await cmd.executar(sock, '5511999999999@s.whatsapp.net', fakeMsg(), '/adivinha-emoji')
    ok('fora de grupo avisa', ultimoTexto(sock).includes('dentro de um grupo'))
    let escapou = false
    try { await cmd.executar({ sendMessage: async () => { throw new Error('rede fora') } }, JID2, fakeMsg(), '/adivinha-emoji') } catch (e) { escapou = true }
    ok('erro de rede não escapa', escapou === false)
    jogosAtivos.limparJogos()
  }

  cmd._injetarSorteio(null)
  cmd._definirDuracao(null)
  cmd._definirIntervaloDica(null)
  cmd._injetarAgendador(null, null)
  console.log(`\n🎉 ${passou} testes passaram (adivinha-emoji)\n`)
  process.exit(0)
})().catch((erro) => {
  console.error('💥 teste-adivinha-emoji:', erro?.message || erro)
  process.exit(1)
})

