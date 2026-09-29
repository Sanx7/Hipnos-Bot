// ============================================================
// TESTE-RANKING — o pergaminho grego do /ranking (offline)
// Roda 100% offline: banco de mensagens e VIPs são injetados, nada de rede.
// Uso (na raiz do projeto):  node scripts/teste-ranking.js
// ============================================================
const fs = require('fs')
const path = require('path')
const { Jimp, loadFont } = require('jimp')
const { SANS_16_WHITE, SANS_32_WHITE } = require('jimp/fonts')

// ─── 🗄️ Banco FAKE — instalado ANTES do require do comando ───
// O ranking desestrutura `buscarRanking` na importação, então a troca do
// banco precisa acontecer antes do require.
const database = require('../database')
let rankingFake = []
database.buscarRanking = async () => rankingFake

// 💠 VIPs FAKE: nenhuma consulta ao Mongo, só o mapa que cada teste montar.
const vip = require('../vip')
let estilosFake = new Map()
vip.obterEstilosVip = async () => estilosFake

const ranking = require('../comandos/ranking')
const coresVip = require('../dados/cores-vip')
const pergaminho = require('../pergaminho-ranking')
const temasVip = require('../temas-vip')
const I = pergaminho.__internos

const JID_GRUPO = '120363000000000001@g.us'
const JID_COMUM = '5511900000002'
const ID_TOP = '5511900000001'
const PARTICIPANTES = [{ id: ID_TOP + '@s.whatsapp.net' }, { id: JID_COMUM + '@s.whatsapp.net' }]

let reprovadas = 0
async function testar (nome, fn) {
  try { await fn(); console.log('PASSOU: ' + nome) }
  catch (err) { reprovadas += 1; console.log('FALHOU: ' + nome + ' :: ' + (err?.message || err)) }
}
function exigir (cond, detalhe) { if (!cond) throw new Error(detalhe || 'condicao falsa') }

function criarSock (overrides) {
  const cfg = overrides || {}
  const enviadas = []
  const sock = {
    groupMetadata: cfg.groupMetadata || (async () => ({ subject: 'Recinto de Teste', participants: PARTICIPANTES })),
    sendMessage: async (jid, conteudo, extra) => {
      enviadas.push({ jid, conteudo, extra })
      return { key: { id: 'fake-' + enviadas.length } }
    }
  }
  return { sock, enviadas }
}
const mensagem = (texto) => ({ key: { remoteJid: JID_GRUPO, fromMe: false, id: 'r1' }, message: { conversation: texto } })
const textos = (enviadas) => enviadas.map((e) => e.conteudo?.text).filter((t) => typeof t === 'string')
const textoUnico = (enviadas) => textos(enviadas).join(' | ')
const imagemEnviada = (enviadas) => enviadas.find((e) => e.conteudo?.image)

// 🔎 Conta pixels EXATAMENTE de um hex numa região (nomes das linhas/rodapé).
// Só os pixels opacos dos glifos ficam com a cor cheia — é o suficiente para
// provar que a cor foi pintada ali.
function contarCor (imagem, hex, x0, y0, x1, y1) {
  const alvo = temasVip.hexParaJimp(hex)
  let n = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if ((imagem.getPixelColor(x, y) >>> 0) === alvo) n += 1
    }
  }
  return n
}

// ─── 🖼️ Itens fixos do pergaminho usado nos testes ───
const ITENS_TESTE = [
  { nome: 'João da Silva', cor: '🔥', total: 1287, palavra: 'mensagens', saiu: false },
  { nome: 'Coração Valente', cor: '💎', total: 903, palavra: 'mensagens', saiu: false },
  { nome: 'Ana', cor: '👑', total: 812, palavra: 'mensagens', saiu: false },
  { nome: 'Lobo Solitário', cor: '🐺', total: 640, palavra: 'mensagens', saiu: false },
  { nome: 'Zé do Zap', cor: '', total: 512, palavra: 'mensagens', saiu: false },
  { nome: 'Nome Gigante Que Nunca Vai Caber Na Coluna Do Pergaminho De Jeito Nenhum Mesmo', cor: '🦋', total: 480, palavra: 'mensagens', saiu: true },
  { nome: 'Mortal Comum', cor: '', total: 44, palavra: 'mensagens', saiu: false },
  { nome: 'Sr. Emoji 🚀 火', cor: '☕', total: 33, palavra: 'mensagens', saiu: false },
  { nome: 'Úrsula Çedilha', cor: '🌙', total: 2, palavra: 'mensagens', saiu: false },
  { nome: 'Fantasma', cor: '👻', total: 1, palavra: 'mensagem', saiu: false }
]

// O mesmo pergaminho serve para vários testes (compor custa ~0,6s).
let cachePergaminho = null
async function pergaminhoDosTestes () {
  if (!cachePergaminho) {
    const buffer = await pergaminho.comporPergaminhoRanking({ itens: ITENS_TESTE, subtitulo: 'Recinto de Teste' })
    cachePergaminho = { buffer, imagem: await Jimp.read(buffer) }
  }
  return cachePergaminho
}

async function main () {
  console.log('Teste offline do /ranking (pergaminho em imagem)')

  await testar('exports: comando, medalhas e medidas do pergaminho', async () => {
    exigir(ranking.nome === 'ranking', 'nome errado')
    exigir(typeof ranking.executar === 'function', 'sem executar')
    exigir(typeof ranking._injetarCapa === 'function', 'sem gancho de imagem')
    exigir(Array.isArray(ranking.__internos.MEDALHAS) && ranking.__internos.MEDALHAS.length === 3, 'medalhas do podio')
    exigir(I.LARG === 900 && I.ALT === 1100, 'dimensoes do pergaminho')
    exigir(I.TITULO === 'RANKING DO OLIMPO', 'titulo errado')
    exigir(I.FRISCO.larg === 26 && I.FRISCO.esp === 4, 'faixa do frisco')
    exigir(I.ROLO_ALT === 44 && I.ROLO_RAIO === 22, 'rolos de ouro')
    exigir(I.ROW_ALT === 62 && I.ROW_INICIO === 250, 'grade das linhas')
  })

  await testar('cores-vip: os 10 emojis do /corvip lista têm cor fixa e distinta', async () => {
    const cores = []
    for (const emoji of vip.SUGESTOES_COR_VIP) {
      const hex = coresVip.corDoEmoji(emoji)
      exigir(coresVip.MAPA_COR_VIP[emoji] === hex, 'sem cor fixa para ' + emoji)
      exigir(/^#[0-9a-f]{6}$/.test(hex), 'hex invalido: ' + hex)
      exigir(!cores.includes(hex), 'cor repetida para ' + emoji)
      cores.push(hex)
    }
    exigir(cores.length === 10, 'esperava 10 sugestoes')
    exigir(new Set(coresVip.PALETA_AUXILIAR).size === coresVip.PALETA_AUXILIAR.length, 'paleta auxiliar com cores repetidas')
  })

  await testar('cores-vip: emoji fora da lista é estável; sem cor vira tinta padrão', async () => {
    const cor = coresVip.corDoEmoji('☕')
    exigir(cor === coresVip.corDoEmoji('☕'), 'emoji fora da lista deveria ser estavel')
    exigir(coresVip.PALETA_AUXILIAR.includes(cor), 'deveria sair da paleta auxiliar: ' + cor)
    exigir(!Object.values(coresVip.MAPA_COR_VIP).includes(cor), 'nao deveria repetir cor do mapa fixo')
    exigir(coresVip.corDoEmoji('') === coresVip.COR_PADRAO, 'sem cor deveria ser a tinta padrao')
    exigir(coresVip.corDoEmoji(null) === coresVip.COR_PADRAO, 'null deveria ser a tinta padrao')
  })

  await testar('fora de grupo avisa e não manda imagem', async () => {
    const { sock, enviadas } = criarSock()
    await ranking.executar(sock, '5511911112222@s.whatsapp.net', mensagem('/ranking'))
    exigir(!imagemEnviada(enviadas), 'nao devia mandar imagem em PV')
    exigir(/só funciona em grupos/.test(textoUnico(enviadas)), 'aviso de grupo ausente')
  })

  await testar('grupo ainda em silêncio avisa sem mandar imagem', async () => {
    rankingFake = []
    const { sock, enviadas } = criarSock()
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking'))
    exigir(!imagemEnviada(enviadas), 'nao devia mandar imagem sem mensagens')
    exigir(/silêncio/.test(textoUnico(enviadas)), 'aviso de silencio ausente')
  })

  await testar('pergaminho: PNG 900x1100 com moldura, rolos e borda sem estouro', async () => {
    const { buffer, imagem } = await pergaminhoDosTestes()
    exigir(Buffer.isBuffer(buffer) && buffer.length > 20000, 'buffer pequeno demais')
    exigir(imagem.bitmap.width === 900 && imagem.bitmap.height === 1100, 'dimensoes erradas')

    const { margemX, baseTopo, esp } = I.FRISCO
    exigir(contarCor(imagem, I.OURO, margemX, 550, margemX + esp, 553) > 0, 'moldura esquerda ausente')
    exigir(contarCor(imagem, I.OURO, 450, baseTopo, 453, baseTopo + esp + 3) > 0, 'moldura do topo ausente')
    exigir(contarCor(imagem, I.OURO, 0, 400, margemX - 4, 700) === 0, 'moldura estourou a borda esquerda')
    exigir(contarCor(imagem, I.OURO, margemX, 400, 900 - margemX, 700) > 0, 'sem ouro nenhum na moldura')

    // rolos de ouro do topo e da base (barra central)
    const meio = Math.round(900 / 2)
    const topo = imagem.getPixelColor(meio, I.ROLO_Y + Math.round(I.ROLO_ALT / 2)) >>> 0
    const base = imagem.getPixelColor(meio, I.ALT - I.ROLO_Y - Math.round(I.ROLO_ALT / 2)) >>> 0
    const vermelho = (topo >>> 24) & 0xff
    const verde = (topo >>> 16) & 0xff
    const azul = (topo >>> 8) & 0xff
    exigir(vermelho > 150 && verde > 110 && azul < 130, 'rolo do topo nao e dourado (' + topo.toString(16) + ')')
    exigir(base === topo, 'rolo da base diferente do topo')
    exigir((imagem.getPixelColor(450, 240) >>> 0) !== temasVip.hexParaJimp(I.OURO), 'papel nao deveria estar dourado')
  })

  await testar('nomes: a cor do corVip é pintada na linha certa', async () => {
    const { imagem } = await pergaminhoDosTestes()
    for (const [indice, emoji] of [[0, '🔥'], [1, '💎'], [2, '👑']]) {
      const y = I.ROW_INICIO + indice * I.ROW_ALT
      const pintados = contarCor(
        imagem, coresVip.corDoEmoji(emoji),
        I.ROW_NOME_X, y, I.ROW_X1 - I.ROW_RESERVA_TOTAL, y + I.ROW_ALT
      )
      exigir(pintados > 40, 'nome da linha ' + (indice + 1) + ' sem a cor ' + emoji + ' (' + pintados + ' px)')
    }
  })

  await testar('nomes: quem não tem cor sai na tinta padrão', async () => {
    const { imagem } = await pergaminhoDosTestes()
    const y = I.ROW_INICIO + 4 * I.ROW_ALT // 'Zé do Zap' (sem cor)
    const pintados = contarCor(imagem, I.TINTA, I.ROW_NOME_X, y, I.ROW_X1 - I.ROW_RESERVA_TOTAL, y + I.ROW_ALT)
    exigir(pintados > 40, 'nome sem cor deveria usar a tinta padrao (' + pintados + ' px)')
  })

  await testar('nome gigante é cortado com "..." dentro da coluna', async () => {
    const font = await loadFont(SANS_32_WHITE)
    const limite = I.ROW_X1 - I.ROW_NOME_X - I.ROW_RESERVA_TOTAL
    const cortado = I.cortarParaCaber(font, ITENS_TESTE[5].nome, limite)
    exigir(cortado.endsWith('...'), 'deveria terminar em ...')
    exigir(I.medir(font, cortado) <= limite, 'o corte estourou a coluna')
    exigir(cortado.length < ITENS_TESTE[5].nome.length, 'nada foi cortado')
  })

  await testar('nome com emoji/ideograma não quebra a medida nem o desenho', async () => {
    const font = await loadFont(SANS_32_WHITE)
    const limpo = I.limparParaFonte(font, ITENS_TESTE[7].nome)
    exigir(limpo === 'Sr. Emoji', 'emoji deveria sair do texto: "' + limpo + '"')
    exigir(I.medir(font, limpo) > 0, 'medida zerada')
    exigir(I.medir(font, I.limparParaFonte(font, 'Coração ç ã')) > 0, 'acentos deveriam continuar')
    exigir(I.tintaVertical(font, limpo).base > 0, 'tinta sem base medida')
  })

  await testar('pergaminho falhou: cai no texto de sempre (com aviso de quem saiu)', async () => {
    rankingFake = [
      { usuario_id: ID_TOP, nome: 'João do Banco', total: 120 },
      { usuario_id: '5511900000009', nome: 'Sumido', total: 1 }
    ]
    estilosFake = new Map()
    ranking._injetarCapa(async () => { throw new Error('jimp quebrou') })
    const { sock, enviadas } = criarSock()
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking'))
    ranking._restaurarCapa()

    exigir(!imagemEnviada(enviadas), 'nao devia mandar imagem quebrada')
    const txt = textoUnico(enviadas)
    exigir(/🥇 \*João do Banco\* — \*120\* mensagens/.test(txt), 'linha do podio errada: ' + txt)
    exigir(/\*1\* mensagem /.test(txt), 'singular errado: ' + txt)
    exigir(/\(saiu do grupo\)/.test(txt), 'aviso de saida ausente: ' + txt)
    exigir(/RANKING DOS MAIS ATIVOS/.test(txt), 'cabecalho do texto ausente')
    exigir(/O sono alcança até os mais falantes/.test(txt), 'frase final ausente')
  })

  await testar('fluxo feliz manda o pergaminho com legenda e miniatura', async () => {
    rankingFake = [
      { usuario_id: ID_TOP, nome: 'João do Banco', total: 120 },
      { usuario_id: JID_COMUM, nome: 'Comum', total: 5 }
    ]
    estilosFake = new Map([[ID_TOP, { numero: ID_TOP, nome: 'MeuNomeVip', cor: '🔥' }]])
    const { sock, enviadas } = criarSock()
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking'))
    estilosFake = new Map()

    const envio = imagemEnviada(enviadas)
    exigir(envio, 'deveria mandar imagem')
    exigir(Buffer.isBuffer(envio.conteudo.image) && envio.conteudo.image.length > 20000, 'imagem invalida')
    exigir(/Pergaminho do ranking/.test(String(envio.conteudo.caption)), 'legenda errada')
    exigir(typeof envio.conteudo.jpegThumbnail === 'string' && envio.conteudo.jpegThumbnail.length > 200,
      'faltou a miniatura (sem ela o Baileys chamaria sharp/ffmpeg)')
    exigir(textos(enviadas).length === 0, 'nao deveria mandar texto junto com a imagem')

    // A cor do VIP chegou ao desenho: o PNG enviado tem pixels da 🔥.
    const imagem = await Jimp.read(envio.conteudo.image)
    const pintados = contarCor(
      imagem, coresVip.corDoEmoji('🔥'),
      I.ROW_NOME_X, I.ROW_INICIO, I.ROW_X1 - I.ROW_RESERVA_TOTAL, I.ROW_INICIO + I.ROW_ALT
    )
    exigir(pintados > 40, 'a cor do VIP nao apareceu no pergaminho (' + pintados + ' px)')
  })

  await testar('sem metadados do grupo o pergaminho sai mesmo assim (com asterisco)', async () => {
    rankingFake = [{ usuario_id: '5511900000003', nome: 'Forasteiro', total: 3 }]
    const { sock, enviadas } = criarSock({ groupMetadata: async () => { throw new Error('sem metadados') } })
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking'))

    const envio = imagemEnviada(enviadas)
    exigir(envio, 'deveria mandar o pergaminho mesmo sem metadados')
    const imagem = await Jimp.read(envio.conteudo.image)
    const fontNota = await loadFont(SANS_16_WHITE)
    exigir(I.limparParaFonte(fontNota, I.NOTA_SAIU) === '* saiu do grupo', 'nota de saida mudou')
    exigir(contarCor(imagem, I.TINTA_SUAVE, 300, 890, 600, 916) > 20, 'rodape sem a nota de quem saiu')
  })

  await testar('arte sem lib nativa, com semente fixa e fallback no comando', async () => {
    const fonte = fs.readFileSync(path.join(__dirname, '..', 'pergaminho-ranking.js'), 'utf8')
    exigir(fonte.includes("require('jimp')"), 'deveria usar jimp')
    exigir(fonte.includes('SEMENTE') && fonte.includes('geradorSemente'), 'arte sem semente fixa')
    exigir(!/require\('(sharp|canvas|node-canvas)'\)/.test(fonte), 'nada de lib nativa no desenho')
    exigir(!/Math\.random\(/.test(fonte), 'arte deveria ser deterministica (sem Math.random)')
    const comando = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'ranking.js'), 'utf8')
    exigir(comando.includes('comporPergaminhoRanking'), 'comando sem o pergaminho')
    exigir(/catch \(errPergaminho\)/.test(comando), 'comando sem fallback em texto')
  })
}

async function runAll () {
  await main()
  console.log(reprovadas === 0 ? 'TODOS PASSARAM' : reprovadas + ' FALHARAM')
  process.exit(reprovadas === 0 ? 0 : 1)
}
runAll().catch((e) => { console.error(e); process.exit(1) })



