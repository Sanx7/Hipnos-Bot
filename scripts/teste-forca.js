// ============================================================
// 🧪 teste-forca.js — Testes OFFLINE do /forca (sem rede)
// Sorteio injetado (_injetarSorteio) p/ palavras determinísticas.
// Rode com: node scripts/teste-forca.js
// ============================================================

const assert = require('assert')
const forca = require('../comandos/menu-brincadeiras/forca')
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
  return { key: { remoteJid: 'JID', participant: autor || '5511888888888@s.whatsapp.net', fromMe: false }, message: { conversation: '/forca' } }
}

function ultimoTexto (sock) {
  return String(sock.enviadas[sock.enviadas.length - 1]?.conteudo?.text || '')
}

const JID = '120363000000000000@g.us'
const JID2 = '120363000000000001@g.us'

forca._injetarSorteio(() => ({ palavra: 'GATO', categoria: 'animais' }))

;(async () => {
  console.log('🧪 /forca — testes offline\n')

  console.log('── Exports ──')
  ok('nome = forca', forca.nome === 'forca')
  ok('executar é função', typeof forca.executar === 'function')
  ok('MAX_ERROS é 6', forca.MAX_ERROS === 6)
  ok('7 estágios de desenho', Array.isArray(forca.DESENHOS) && forca.DESENHOS.length === 7)
  ok('estágio 0 sem boneco', !forca.desenhoForca(0).includes('O'))
  ok('estágio 6 com boneco', forca.desenhoForca(6).includes('O'))
  ok('tabuleiro inicial mascarado', forca.montarTabuleiro('GATO', new Set()) === '_ _ _ _')
  ok('tabuleiro revela letra', forca.montarTabuleiro('GATO', new Set(['A'])) === '_ A _ _')

  console.log('── Início ──')
  jogosAtivos.limparJogos()
  {
    const sock = fakeSock()
    await forca.executar(sock, JID, fakeMsg(), '/forca')
    const t = ultimoTexto(sock)
    ok('mascara a palavra', t.includes('_ _ _ _'))
    ok('mostra a forca', t.includes('+---+'))
    ok('mostra a categoria', t.includes('animais'))
    ok('mostra 0/6', t.includes('0/6'))
    ok('registra o jogo', jogosAtivos.tipoAtivo(JID) === 'forca')
  }

  console.log('── Acerto e erro de letra ──')
  {
    const sock = fakeSock()
    await forca.executar(sock, JID, fakeMsg(), '/forca A')
    ok('acerto confirma', ultimoTexto(sock).includes('está na palavra'))
    ok('acerto revela no tabuleiro', ultimoTexto(sock).includes('_ A _ _'))
    await forca.executar(sock, JID, fakeMsg(), '/forca A')
    ok('repetida não penaliza', ultimoTexto(sock).includes('já foi tentada') && ultimoTexto(sock).includes('0/6'))
    await forca.executar(sock, JID, fakeMsg(), '/forca Z')
    ok('erro avisa', ultimoTexto(sock).includes('não está na palavra'))
    ok('erro conta 1/6', ultimoTexto(sock).includes('1/6'))
  }
  console.log('── Vitória, derrota e palavra completa ──')
  {
    jogosAtivos.limparJogos()
    const sock = fakeSock()
    await forca.executar(sock, JID, fakeMsg(), '/forca')
    await forca.executar(sock, JID, fakeMsg(), '/forca G')
    await forca.executar(sock, JID, fakeMsg(), '/forca A')
    await forca.executar(sock, JID, fakeMsg(), '/forca T')
    await forca.executar(sock, JID, fakeMsg(), '/forca O')
    ok('vitória por letras', ultimoTexto(sock).includes('FORCA FOI VENCIDA'))
    ok('vitória menciona o vencedor', (sock.enviadas[sock.enviadas.length - 1]?.conteudo?.mentions || []).length === 1)
    ok('vitória encerra', jogosAtivos.estaAtivo(JID) === false)
  }
  {
    jogosAtivos.limparJogos()
    const sock = fakeSock()
    await forca.executar(sock, JID, fakeMsg(), '/forca')
    await forca.executar(sock, JID, fakeMsg(), '/forca gato')
    ok('palavra completa certa vence', ultimoTexto(sock).includes('PALAVRA COMPLETA'))
    ok('palavra certa encerra', jogosAtivos.estaAtivo(JID) === false)
  }
  {
    jogosAtivos.limparJogos()
    const sock = fakeSock()
    await forca.executar(sock, JID, fakeMsg(), '/forca')
    await forca.executar(sock, JID, fakeMsg(), '/forca cachorro')
    ok('palavra errada conta 1 erro', ultimoTexto(sock).includes('1/6'))
    ok('palavra errada mantém o jogo', jogosAtivos.estaAtivo(JID) === true)
    jogosAtivos.limparJogos()
  }
  {
    jogosAtivos.limparJogos()
    const sock = fakeSock()
    await forca.executar(sock, JID, fakeMsg(), '/forca')
    for (const letra of ['Z', 'X', 'Q', 'W', 'Y', 'K']) {
      await forca.executar(sock, JID, fakeMsg(), '/forca ' + letra)
    }
    ok('derrota após 6 erros', ultimoTexto(sock).includes('forca venceu'))
    ok('derrota revela a palavra', ultimoTexto(sock).includes('GATO'))
    ok('derrota encerra', jogosAtivos.estaAtivo(JID) === false)
  }

  console.log('── Bloqueio duplicado, texto livre e extras ──')
  {
    jogosAtivos.limparJogos()
    const sock = fakeSock()
    await forca.executar(sock, JID, fakeMsg(), '/forca')
    await forca.executar(sock, JID, fakeMsg(), '/forca')
    ok('segundo /forca mostra o jogo ativo', ultimoTexto(sock).includes('Já tem uma forca'))
    jogosAtivos.limparJogos()
    jogosAtivos.registrarJogo(JID, jogosAtivos.TIPOS.VELHA, { partida: {} })
    await forca.executar(sock, JID, fakeMsg(), '/forca')
    ok('bloqueio cruzado com velha', ultimoTexto(sock).includes('jogo da velha'))
    jogosAtivos.limparJogos()
  }
  {
    jogosAtivos.limparJogos()
    const sock = fakeSock()
    await forca.executar(sock, JID, fakeMsg(), '/forca')
    const ret = await jogosAtivos.processarMensagemLivre(sock, JID, fakeMsg(), 'o')
    ok('texto livre consome a jogada', ret === true)
    ok('texto livre revela a letra', ultimoTexto(sock).includes('_ _ _ O'))
    await forca.executar(sock, '5511999999999@s.whatsapp.net', fakeMsg(), '/forca')
    ok('fora de grupo avisa', ultimoTexto(sock).includes('coisa de grupo'))
    await forca.executar(sock, JID2, fakeMsg(), '/forca')
    await forca.executar(sock, JID2, fakeMsg(), '/forca desistir')
    ok('desistir revela e encerra', ultimoTexto(sock).includes('GATO') && jogosAtivos.estaAtivo(JID2) === false)
    let escapou = false
    try { await forca.executar({ sendMessage: async () => { throw new Error('rede fora') } }, JID, fakeMsg(), '/forca') } catch (e) { escapou = true }
    ok('erro de rede não escapa', escapou === false)
    jogosAtivos.limparJogos()
  }

  forca._injetarSorteio(null)
  console.log(`\n🎉 ${passou} testes passaram (forca)\n`)
  process.exit(0)
})().catch((erro) => {
  console.error('💥 teste-forca:', erro?.message || erro)
  process.exit(1)
})
