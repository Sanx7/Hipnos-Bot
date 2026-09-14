// ============================================================
// 🧪 teste-gartic.js — Testes OFFLINE do /gartic (sem WhatsApp e sem rede)
// ============================================================
// Usa injeção de dependências do próprio comando (_injetarSorteio /
// _injetarBuscaFotos / _injetarDownload / _definirDuracao) para não tocar
// na Pixabay. A thumbnail do ffmpeg roda de verdade (helper central com
// fallback de JPEG 8x8 — nunca rejeita).
//
// Rode com: node scripts/teste-gartic.js
// ============================================================

const assert = require('assert')
const gartic = require('../comandos/menu-brincadeiras/gartic')
const jogosAtivos = require('../dados/jogos-ativos')

let passou = 0
function ok(nome, cond) {
  if (!cond) throw new Error('FALHOU: ' + nome)
  passou++
  console.log(`  ✅ ${nome}`)
}

// ─── Helpers ───
function fakeSock() {
  const enviadas = []
  return {
    enviadas,
    sendMessage: async (jid, conteudo, opts) => {
      enviadas.push({ jid, conteudo, opts })
      return {}
    },
    groupMetadata: async () => ({ participants: [] }),
    user: { id: '5511999999999:3' }
  }
}

function fakeMsg(autor = '5511888888888@s.whatsapp.net') {
  return {
    key: { remoteJid: '120363000000000000@g.us', participant: autor, fromMe: false },
    message: { conversation: 'palavra' }
  }
}

// Estado das injeções
const INJ = {
  palavra: null,
  fotos: null,
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x00]), // JPEG mínimo fake
  nTentativasBusca: 0
}
gartic._injetarSorteio(() => INJ.palavra)
gartic._injetarBuscaFotos(async (palavra) => {
  INJ.nTentativasBusca++
  if (INJ.fotos === null) return []
  return INJ.fotos.map((u, i) => (i === 0 ? u : u + '?v=' + i))
})
gartic._injetarDownload(async () => INJ.buffer)

const JID = '120363000000000000@g.us'
const AVISO_SEM_CHAVE = 'PIXABAY_API_KEY não configurada'

// Garante a chave desde o início do harness (o .env NÃO é carregado por
// padrão neste processo de teste): o teste "sem chave" apaga e restaura.
process.env.PIXABAY_API_KEY = 'chave-de-teste'

console.log('🧪 /gartic — testes offline\n')

// Corpo dos testes (usa await no topo → precisa de escopo async)
;(async () => {

// ─── 1) Exports no padrão do loader ───
console.log('── Exports do comando ──')
ok('exporta nome = "gartic"', gartic.nome === 'gartic')
ok('exporta executar como função', typeof gartic.executar === 'function')
ok('exporta descricao não vazia', typeof gartic.descricao === 'string' && gartic.descricao.length > 0)

// ─── 2) Legenda não revela a resposta ───
console.log('── Legenda (nunca revela a palavra) ──')
{
  const legenda = gartic.montarLegenda({ palavra: 'SAPATO', categoria: 'objetos' }, 3)
  ok('menciona a categoria', legenda.includes('objetos'))
  ok('menciona os minutos', legenda.includes('3'))
  ok('NÃO revela a palavra', !legenda.toUpperCase().includes('SAPATO'))
}

// ─── 3) Palpites (ouvinte de texto livre) ───
console.log('── Palpites em texto livre ──')
{
  const sock = fakeSock()
  const dados = { palavra: 'SAPATO', categoria: 'objetos', inicio: Date.now(), duracaoMs: 60000, sock }
  jogosAtivos.registrarJogo(JID, gartic.TIPO_JOGO, dados)

  // chute errado → false (não consome, não encerra)
  let ret = await gartic.aoReceberPalpite(sock, JID, fakeMsg(), 'girafa', dados)
  ok('palpite errado → false', ret === false)
  ok('palpite errado não encerra (registro segue)', jogosAtivos.estaAtivo(JID) === true)

  // chute com acento e minúscula → acerto (normalização)
  const dados2 = { palavra: 'Café', categoria: 'comida', inicio: Date.now(), duracaoMs: 60000, sock }
  jogosAtivos.registrarJogo(JID, gartic.TIPO_JOGO, dados2)
  const msgAcerto = fakeMsg('5511777777777@s.whatsapp.net')
  ret = await gartic.aoReceberPalpite(sock, JID, msgAcerto, '  café ', dados2)
  ok('palpite normalizado (acento/caixa) → true', ret === true)
  ok('acerto encerra a rodada (registro limpo)', jogosAtivos.estaAtivo(JID) === false)
  const final = sock.enviadas[sock.enviadas.length - 1]
  ok('anuncia o vencedor com mention', final?.conteudo?.mentions?.includes('5511777777777@s.whatsapp.net'))
  ok('mensagem contém a palavra', String(final?.conteudo?.text || '').includes('Café'))
}

// ─── 4) Sem chave → aviso, sem tocar na API ───
console.log('── Sem PIXABAY_API_KEY ──')
{
  const chaveAntiga = process.env.PIXABAY_API_KEY
  delete process.env.PIXABAY_API_KEY
  const sock = fakeSock()
  jogosAtivos.limparJogos()
  await gartic.executar(sock, JID, fakeMsg(), '/gartic')
  const aviso = sock.enviadas[0]?.conteudo?.text || ''
  ok('avisa que a chave não está configurada', aviso.includes(AVISO_SEM_CHAVE))
  ok('não chegou a sortear/buscar', INJ.nTentativasBusca === 0)
  if (chaveAntiga) process.env.PIXABAY_API_KEY = chaveAntiga
  else delete process.env.PIXABAY_API_KEY
}

// ─── 6) Rodada completa via comando (com injeções) ───
console.log('── Rodada completa (fluxo do comando) ──')
{
  jogosAtivos.limparJogos()
  INJ.palavra = { palavra: 'BANANA', categoria: 'frutas' }
  INJ.fotos = ['https://exemplo.invalido/foto.jpg']
  const sock = fakeSock()
  await gartic.executar(sock, JID, fakeMsg(), '/gartic')

  ok('uma mensagem de imagem foi enviada', sock.enviadas.some((e) => e.conteudo?.image !== undefined))
  ok('rodada registrada no registro compartilhado', jogosAtivos.estaAtivo(JID) === true)

  // segundo /gartic → "já tem um gartic"
  const sock2 = fakeSock()
  await gartic.executar(sock2, JID, fakeMsg(), '/gartic')
  const aviso2 = sock2.enviadas[0]?.conteudo?.text || ''
  ok('segundo /gartic mostra aviso de rodada ativa', aviso2.includes('JÁ TEM UM GARTIC'))
  jogosAtivos.limparJogos()
}

// ─── 7) Busca sem resultado → tenta outra palavra (até 3) ───
console.log('── Tentativas de busca (sem resultado) ──')
{
  jogosAtivos.limparJogos()
  const palavrasSeq = [
    { palavra: 'AAA', categoria: 'animais' },
    { palavra: 'BBB', categoria: 'frutas' },
    { palavra: 'CCC', categoria: 'objetos' }
  ]
  let i = 0
  gartic._injetarSorteio(() => palavrasSeq[i++] || null)
  gartic._injetarBuscaFotos(async () => []) // nunca devolve foto
  const sock = fakeSock()
  await gartic.executar(sock, JID, fakeMsg(), '/gartic')
  const aviso = sock.enviadas[0]?.conteudo?.text || ''
  ok('após 3 tentativas sem foto → aviso amigável', aviso.includes('não devolveu nenhuma imagem'))
  ok('rodada NÃO fica registrada', jogosAtivos.estaAtivo(JID) === false)

  // restaura as injeções
  gartic._injetarSorteio(() => INJ.palavra)
  gartic._injetarBuscaFotos(async (palavra) => (INJ.fotos === null ? [] : INJ.fotos))
}

// ─── 8) Timeout → revela resposta e encerra ───
console.log('── Timeout (3 min) ──')
{
  jogosAtivos.limparJogos()
  const sock = fakeSock()
  const dados = { palavra: 'MELANCIA', categoria: 'frutas', inicio: Date.now(), duracaoMs: 60000, sock }
  jogosAtivos.registrarJogo(JID, gartic.TIPO_JOGO, dados)
  gartic.aoExpirar(JID)
  const final = sock.enviadas[sock.enviadas.length - 1]
  ok('revela a resposta no timeout', String(final?.conteudo?.text || '').includes('MELANCIA'))
  ok('encerra a rodada no timeout', jogosAtivos.estaAtivo(JID) === false)
}

// ─── 9) processarMensagemLivre (gancho do bot.js) ───
console.log('── Gancho de texto livre do bot.js ──')
{
  jogosAtivos.limparJogos()
  const sock = fakeSock()
  const dados = { palavra: 'ABACAXI', categoria: 'frutas', inicio: Date.now(), duracaoMs: 60000, sock }
  jogosAtivos.registrarJogo(JID, gartic.TIPO_JOGO, dados)

  // mensagem que não é palpite → não consome
  let ret = await jogosAtivos.processarMensagemLivre(sock, JID, fakeMsg(), 'oi pessoal')
  ok('texto comum → false (segue o fluxo)', ret === false)

  // palpite certo → consome e encerra
  ret = await jogosAtivos.processarMensagemLivre(sock, JID, fakeMsg(), 'abacaxi')
  ok('palpite certo → true (mensagem consumida)', ret === true)
  ok('registro limpo após acerto', jogosAtivos.estaAtivo(JID) === false)
}

// ─── 10) Uso fora de grupo → aviso ───
console.log('── Uso fora de grupo ──')
{
  jogosAtivos.limparJogos()
  process.env.PIXABAY_API_KEY = 'chave-de-teste'
  const sock = fakeSock()
  await gartic.executar(sock, '5511999999999@s.whatsapp.net', fakeMsg(), '/gartic')
  const aviso = sock.enviadas[0]?.conteudo?.text || ''
  ok('avisa que só funciona em grupo', aviso.includes('dentro de um grupo'))
}

jogosAtivos.limparJogos()

  // ─── 5) Bloqueio cruzado (outro jogo rolando no grupo) ───
  console.log('── Bloqueio cruzado 1 jogo por grupo ──')
  {
    jogosAtivos.limparJogos()
    process.env.PIXABAY_API_KEY = 'chave-de-teste'
    jogosAtivos.registrarJogo(JID, jogosAtivos.TIPOS.VELHA, { partida: {} })
    const sock = fakeSock()
    await gartic.executar(sock, JID, fakeMsg(), '/gartic')
    const aviso = sock.enviadas[0]?.conteudo?.text || ''
    ok('bloqueia quando há velha rolando', aviso.includes('jogo da velha'))
    jogosAtivos.limparJogos()
  }

  console.log(`\n🎉 ${passou} testes passaram (gartic)\n`)
  process.exit(0)
})().catch((erro) => {
  console.error('💥 teste-gartic:', erro?.message || erro)
  process.exit(1)
})
