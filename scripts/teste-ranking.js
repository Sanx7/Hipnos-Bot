// ============================================================
// TESTE-RANKING — o pergaminho grego do /ranking (offline)
// Roda 100% offline: banco de mensagens e VIPs são injetados, nada de rede.
// Uso (na raiz do projeto):  node scripts/teste-ranking.js
// ============================================================
// ⚠️ As URIs do Mongo são zeradas ANTES de qualquer require (mesma razão do
// teste-nomecustom.js): o /ranking agora resolve o identificador de cada
// pessoa e, quando ela não está nos metadados do grupo, consulta o mapeamento
// LID→telefone na sessão. Sem esta linha o teste pegaria o Atlas real da .env
// da raiz — e este arquivo promete rodar 100% offline.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const fs = require('fs')
const path = require('path')
const { Jimp, loadFont } = require('jimp')
const { SANS_16_WHITE, SANS_32_WHITE } = require('jimp/fonts')

// ─── 🗄️ Banco FAKE — instalado ANTES do require do comando ───
// O ranking desestrutura `buscarRanking` na importação, então a troca do
// banco precisa acontecer antes do require.
const database = require('../database')
let rankingFake = []
// 🪪 Guardamos o limite pedido: o comando tem que buscar MAIS linhas que as 10
// exibidas, porque o agrupamento por número (a mesma pessoa com LID + telefone
// no banco) só sai certo se os DOIS documentos entrarem antes do corte.
let limitePedido = 0
database.buscarRanking = async (_grupo, limite) => { limitePedido = limite; return rankingFake }

// 💠 VIPs FAKE: nenhuma consulta ao Mongo, só o mapa que cada teste montar.
const vip = require('../vip')
// ⚠️ O filtro por número abaixo é FIEL ao vip.obterEstilosVip de verdade — e é
// justamente por isso que ele importa: o banco devolve o `usuario_id` como o
// Baileys mandou (LID cru num grupo com LID) e o mapa do VIP é indexado pelo
// NÚMERO REAL. Um mock que devolvesse o mapa inteiro, sem filtrar, esconderia
// EXATAMENTE o bug que estes testes agora cobrem.
let estilosFake = new Map()
const pedidosDeEstilos = []
vip.obterEstilosVip = async (numeros) => {
  const lista = Array.isArray(numeros) ? numeros : []
  pedidosDeEstilos.push(lista.slice())
  const mapa = new Map()
  for (const bruto of lista) {
    const chave = String(bruto).replace(/\D/g, '')
    const achado = estilosFake.get(chave)
    if (achado) mapa.set(chave, achado)
  }
  return mapa
}

// 🪪 Cenário REAL de produção: o ranking traz o identificador do jeito que o
// bot.js gravou (o `sender` cru, que num grupo com LID habilitado é o LID) e o
// documento de VIP está no número real — porque /darvip, /nomecustom e /corvip
// resolvem o LID antes de gravar. É o caso que quebrava a cor no pergaminho.
const LID_CRUDO = '175952680210489'
const NUM_REAL = '5541998887777'
const PARTICIPANTES_LID = [{ id: LID_CRUDO + '@lid', phoneNumber: NUM_REAL + '@s.whatsapp.net' }]

const ranking = require('../comandos/ranking')
// 🪪 lid.js entra DEPOIS do comando (que já o requireou): é o MESMO objeto de
// módulo, então o gancho __definirConsultaSessaoTeste abaixo vale para o
// /ranking de verdade — sem precisar injetar nada no comando.
const lid = require('../lid')
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

  // ═══════════════════════════════════════════════════════════════════
  // 🪪 REGRESSÃO DO LID — o bug real: o `usuario_id` do banco é o que o
  // bot.js gravou a partir do `sender` cru (num grupo com LID habilitado isso
  // é o LID, ex.: "175952680210489"), enquanto o documento de VIP fica no
  // NÚMERO REAL (o /darvip, o /nomecustom e o /corvip resolvem antes). Com
  // o mock fiel ao vip.js, consultar pelo identificador cru simplesmente não
  // acha o VIP → nome do banco e tinta padrão. Estes testes travam isso.
  // ═══════════════════════════════════════════════════════════════════
  await testar('regressão LID: VIP salvo pelo número real aparece com nome e cor mesmo vindo por LID', async () => {
    pedidosDeEstilos.length = 0
    rankingFake = [{ usuario_id: LID_CRUDO, nome: 'NomeVindoDoBanco', total: 1287 }]
    estilosFake = new Map([[NUM_REAL, { numero: NUM_REAL, nome: 'MeuNomeVip', cor: '🔥', alcunha: null }]])
    const { sock, enviadas } = criarSock({
      groupMetadata: async () => ({ subject: 'Recinto LID', participants: PARTICIPANTES_LID })
    })
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking'))

    // 1) A consulta ao banco de VIPs foi feita pelo NÚMERO REAL, não pelo LID
    const pedido = pedidosDeEstilos[pedidosDeEstilos.length - 1] || []
    exigir(pedido.includes(NUM_REAL), 'a consulta não usou o numero resolvido: ' + JSON.stringify(pedido))
    exigir(!pedido.includes(LID_CRUDO), 'a consulta mandou o LID cru: ' + JSON.stringify(pedido))

    // 2) O nome custom (não o do banco) e a cor chegaram no item desenhado
    let itemTop = null
    ranking._injetarCapa(async (args) => { itemTop = args.itens[0]; return Buffer.alloc(8) })
    const { sock: sock2, enviadas: env2 } = criarSock({
      groupMetadata: async () => ({ subject: 'Recinto LID', participants: PARTICIPANTES_LID })
    })
    await ranking.executar(sock2, JID_GRUPO, mensagem('/ranking'))
    ranking._restaurarCapa()

    exigir(itemTop, 'o desenho nao recebeu nenhum item')
    exigir(itemTop.nome === 'MeuNomeVip', 'o nome custom nao foi usado: ' + itemTop.nome)
    exigir(itemTop.cor === '🔥', 'a cor do corVip nao chegou no item: ' + JSON.stringify(itemTop.cor))
    exigir(itemTop.saiu === false, 'o lider por LID foi marcado como saiu do grupo a toa')
    // (o composer fake devolve um buffer invalido, entao aqui o comando cai
    // no fallback em TEXTO — e ele tambem tem que sair com a cor)
    const txt = textoUnico(env2)
    exigir(/🔥 MeuNomeVip/.test(txt), 'o fallback em texto perdeu a cor/nome: ' + txt)

    // 3) No pergaminho DE VERDADE a cor é pintada na linha do topo
    estilosFake = new Map([[NUM_REAL, { numero: NUM_REAL, nome: 'MeuNomeVip', cor: '🔥', alcunha: null }]])
    const { sock: sock3, enviadas: env3 } = criarSock({
      groupMetadata: async () => ({ subject: 'Recinto LID', participants: PARTICIPANTES_LID })
    })
    await ranking.executar(sock3, JID_GRUPO, mensagem('/ranking'))
    estilosFake = new Map()

    const envio = imagemEnviada(env3)
    exigir(envio, 'deveria mandar o pergaminho')
    const imagem = await Jimp.read(envio.conteudo.image)
    const pintados = contarCor(
      imagem, coresVip.corDoEmoji('🔥'),
      I.ROW_NOME_X, I.ROW_INICIO, I.ROW_X1 - I.ROW_RESERVA_TOTAL, I.ROW_INICIO + I.ROW_ALT
    )
    exigir(pintados > 40, 'a cor do corVip NAO apareceu no pergaminho vindo por LID (' + pintados + ' px)')
  })

  await testar('regressão LID: LID fora dos metadados cai no mapeamento da sessão', async () => {
    const { resolverNumeros } = ranking.__internos
    // Sem participante nos metadados → tenta o lid-mapping da Baileys
    lid.__definirConsultaSessaoTeste(async (lidCru) => (lidCru === LID_CRUDO ? NUM_REAL : null))
    const mapa = await resolverNumeros([], [LID_CRUDO])
    exigir(mapa.get(LID_CRUDO) === NUM_REAL, 'o mapeamento da sessao nao resolveu: ' + JSON.stringify([...mapa]))
    lid.__definirConsultaSessaoTeste(null)
  })

  // ═══════════════════════════════════════════════════════════════════
  // 🪪👥 A MESMA PESSOA EM DOIS DOCUMENTOS (LID + telefone) — o bug que
  // a migração (scripts/migrar-ranking-lid.js) conserta no banco e que o
  // comando precisa tolerar enquanto o banco ainda não foi migrado: sem
  // agrupar, a pessoa aparecia DUAS vezes e o ranking tinha um buraco.
  // ═══════════════════════════════════════════════════════════════════
  await testar('agrupamento: LID + telefone da MESMA pessoa viram UMA linha com a SOMA', async () => {
    pedidosDeEstilos.length = 0
    rankingFake = [
      { usuario_id: LID_CRUDO, nome: 'NomeVindoDoBanco', total: 7 },
      { usuario_id: NUM_REAL, nome: 'NomeVindoDoBanco', total: 5 }
    ]
    estilosFake = new Map([[NUM_REAL, { numero: NUM_REAL, nome: 'MeuNomeVip', cor: '🔥', alcunha: null }]])
    let itensDesenhados = null
    ranking._injetarCapa(async (args) => { itensDesenhados = args.itens; return Buffer.alloc(8) })
    const { sock } = criarSock({
      groupMetadata: async () => ({ subject: 'Recinto LID', participants: PARTICIPANTES_LID })
    })
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking'))
    ranking._restaurarCapa()

    exigir(itensDesenhados, 'o desenho não recebeu itens')
    exigir(itensDesenhados.length === 1, 'a pessoa foi duplicada no pódio: ' + JSON.stringify(itensDesenhados.map((i) => i.total)))
    exigir(itensDesenhados[0].total === 12, 'os totais não foram somados: ' + itensDesenhados[0].total)
    exigir(itensDesenhados[0].nome === 'MeuNomeVip', 'o VIP do número real não foi usado: ' + itensDesenhados[0].nome)
    exigir(itensDesenhados[0].saiu === false, 'quem está no grupo foi marcado como saiu')
    estilosFake = new Map()
  })

  await testar('agrupamento: quem tem documento por LID e por telefone não vira "saiu do grupo"', async () => {
    rankingFake = [
      { usuario_id: LID_CRUDO, nome: 'Fantasma', total: 9 },
      { usuario_id: NUM_REAL, nome: 'Fantasma', total: 4 }
    ]
    // O LID resolve pelo mapeamento da SESSÃO e, nos metadados, só sobrou o
    // TELEFONE da pessoa (o participante saiu pelo LID, continuou pelo número):
    // com os DOIS ids no item, ela não pode ser marcada como "saiu do grupo".
    lid.__definirConsultaSessaoTeste(async (lidCru) => (lidCru === LID_CRUDO ? NUM_REAL : null))
    let itensDesenhados = null
    ranking._injetarCapa(async (args) => { itensDesenhados = args.itens; return Buffer.alloc(8) })
    const { sock } = criarSock({
      groupMetadata: async () => ({ subject: 'Recinto', participants: [{ id: NUM_REAL + '@s.whatsapp.net' }] })
    })
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking'))
    ranking._restaurarCapa()
    lid.__definirConsultaSessaoTeste(null)

    exigir(itensDesenhados, 'o desenho não recebeu itens')
    exigir(itensDesenhados.length === 1, 'a pessoa foi duplicada: ' + JSON.stringify(itensDesenhados))
    exigir(itensDesenhados[0].total === 13, 'a soma (13) não saiu: ' + itensDesenhados[0].total)
    exigir(itensDesenhados[0].saiu === false, 'marcou "saiu" mesmo estando no grupo pelo telefone')
  })

  await testar('busca: o comando pede MAIS linhas que as 10 exibidas (antes de agrupar)', async () => {
    rankingFake = [{ usuario_id: ID_TOP, nome: 'João', total: 1 }]
    const { sock } = criarSock()
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking'))
    exigir(limitePedido === ranking.__internos.LIMITE_BUSCA_AGRUPAMENTO,
      'buscou ' + limitePedido + ' linhas, deveria buscar ' + ranking.__internos.LIMITE_BUSCA_AGRUPAMENTO)
    exigir(limitePedido > 10, 'com apenas 10 linhas, o agrupamento perderia o documento do telefone')
  })

  await testar('resolverNumeros: número real fica, LID dos metadados vira telefone e o desconhecido fica', async () => {
    const { resolverNumeros } = ranking.__internos
    lid.__definirConsultaSessaoTeste(async () => null)
    const mapa = await resolverNumeros(PARTICIPANTES_LID, [
      ID_TOP,                       // ja e numero real (esta nos metadados)
      LID_CRUDO,                    // LID com phoneNumber nos metadados
      '5511999990000',              // ninguem conhece: segue como veio
      '',                           // id vazio: ignorado
      ID_TOP + ':7'                 // com sufixo de dispositivo
    ])
    exigir(mapa.get(ID_TOP) === ID_TOP, 'numero real alterado: ' + mapa.get(ID_TOP))
    exigir(mapa.get(LID_CRUDO) === NUM_REAL, 'LID dos metadados nao virou telefone: ' + mapa.get(LID_CRUDO))
    exigir(mapa.get('5511999990000') === '5511999990000', 'desconhecido foi inventado: ' + mapa.get('5511999990000'))
    exigir(!mapa.has(''), 'id vazio entrou no mapa')
    // A chave é sempre o id NORMALIZADO: "…:7" colapsa em ID_TOP (uma entrada só)
    exigir(mapa.get(ID_TOP) === ID_TOP, 'sufixo :7 nao colapsou no id certo: ' + mapa.get(ID_TOP))
    exigir(mapa.size === 3, 'mapa com tamanho inesperado (id duplicado?): ' + JSON.stringify([...mapa]))
    lid.__definirConsultaSessaoTeste(null)
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



