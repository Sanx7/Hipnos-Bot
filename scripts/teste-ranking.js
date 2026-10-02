// ============================================================
// 🏆 teste-ranking.js — testes OFFLINE do /ranking (quadro em imagem)
// ============================================================
// Roda SEM WhatsApp e SEM MongoDB:
//   🗄️ database FAKE (buscarRanking trocado ANTES do require do comando,
//      que faz destructuring);
//   💠 vip FAKE (obterEstilosVip) que FILTRA por número — exatamente como o
//      vip.js de verdade. É esse filtro que dá sentido à regressão do LID:
//      um mock que devolvesse o mapa inteiro esconderia o bug;
//   💬 sock mockado — só registra o que seria enviado;
//   🖼️ a arte REAL roda (Jimp + assets/quadros/ranking-pergaminho.png) e o
//      resultado é conferido pixel a pixel: nome na cor do corVip (já
//      escurecida para o papel), contagem alinhada à DIREITA terminando antes
//      da estrela, subtítulo centralizado no cabeçalho e o rodapé de quem
//      saiu do grupo.
//
// Cobre: metadados do comando, grupo obrigatório, grupo sem mensagens, as 7
// posições do asset (e o corte DEPOIS do agrupamento), nome gigante cortado
// com "...", emoji/ideograma fora da fonte, contraste mínimo da cor no papel,
// miniatura 64×64, fallback em texto quando a arte falha e a regressão do LID
// (VIP salvo pelo número real, LID + telefone da MESMA pessoa).
// Uso (na raiz do projeto):  node scripts/teste-ranking.js
// ============================================================
// ⚠️ As URIs do Mongo são zeradas ANTES de qualquer require (mesma razão do
// teste-nomecustom.js): o /ranking resolve o identificador de cada pessoa e,
// quando ela não está nos metadados do grupo, consulta o mapeamento
// LID→telefone na sessão. Sem esta linha o teste pegaria o Atlas real da .env
// da raiz — e este arquivo promete rodar 100% offline.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''

const fs = require('fs')
const path = require('path')
const { Jimp, loadFont } = require('jimp')
const { SANS_32_WHITE, SANS_64_WHITE } = require('jimp/fonts')

// ─── 🗄️ Banco FAKE — instalado ANTES do require do comando ───
// O ranking desestrutura `buscarRanking` na importação, então a troca do
// banco precisa acontecer antes do require.
const database = require('../database')
let rankingFake = []
// 🪪 Guardamos o limite pedido: o comando tem que buscar MAIS linhas que as 7
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
// EXATAMENTE o bug que estes testes cobrem.
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
// resolvem o LID antes de gravar. É o caso que quebrava a cor no quadro.
const LID_CRUDO = '175952680210489'
const NUM_REAL = '5541998887777'
const PARTICIPANTES_LID = [{ id: LID_CRUDO + '@lid', phoneNumber: NUM_REAL + '@s.whatsapp.net' }]

const ranking = require('../comandos/ranking')
// 🪪 lid.js entra DEPOIS do comando (que já o requireou): é o MESMO objeto de
// módulo, então o gancho __definirConsultaSessaoTeste abaixo vale para o
// /ranking de verdade — sem precisar injetar nada no comando.
const lid = require('../lid')
const coresVip = require('../dados/cores-vip')
const quadro = require('../dados/ranking-pergaminho')
const I = quadro.__internos

const JID_GRUPO = '120363000000000001@g.us'
const JID_COMUM = '5511900000002'
const ID_TOP = '5511900000001'
const PARTICIPANTES = [{ id: ID_TOP + '@s.whatsapp.net' }, { id: JID_COMUM + '@s.whatsapp.net' }]

let reprovadas = 0
let total = 0
async function testar (nome, fn) {
  total += 1
  try { await fn(); console.log('PASSOU: ' + nome) }
  catch (err) { reprovadas += 1; console.log('FALHOU: ' + nome + ' :: ' + (err?.message || err)) }
}
function exigir (cond, detalhe) { if (!cond) throw new Error(detalhe || 'condicao falsa') }

function criarSock (overrides) {
  const cfg = overrides || {}
  const enviadas = []
  const sock = {
    enviadas,
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

// ─── 🔎 Varredura de cor ───
// Devolve onde (e quantos) pixels têm EXATAMENTE o hex pedido. O texto é
// pintado glifo a glifo pelo alfa da fonte (ver dados/ranking-pergaminho.js):
// só os pixels de cobertura cheia ficam com a cor pura, e é o suficiente para
// provar que a cor foi pintada ali — e ONDE ela caiu na linha.
// ⚠️ Lê o `bitmap.data` (que é [R, G, B, A]) porque é assim que o módulo
// escreve; o getPixelColor desta versão do Jimp embaralha os canais.
function areaCor (imagem, hex, x0, y0, x1, y1) {
  const n = parseInt(String(hex).replace('#', ''), 16)
  const r = n >> 16
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const d = imagem.bitmap.data
  const W = imagem.bitmap.width
  const out = { n: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  for (let y = Math.max(0, y0); y < Math.min(imagem.bitmap.height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x += 1) {
      const j = (y * W + x) * 4
      if (d[j] === r && d[j + 1] === g && d[j + 2] === b) {
        out.n += 1
        if (x < out.minX) out.minX = x
        if (x > out.maxX) out.maxX = x
        if (y < out.minY) out.minY = y
        if (y > out.maxY) out.maxY = y
      }
    }
  }
  return out
}
const contarCor = (imagem, hex, x0, y0, x1, y1) => areaCor(imagem, hex, x0, y0, x1, y1).n

// 📐 Banda de UMA posição do pódio: pega a tinta acima do filete pontilhado
// (onde o nome e a contagem assentam) com folga para cima e para baixo.
const bandaDaPosicao = (pos) => ({ y0: pos.y - 80, y1: pos.y + 45 })

// ─── 🖼️ Os 7 itens do quadro usado nos testes (um por posição) ───
const ITENS_TESTE = [
  { nome: 'João da Silva', cor: '🔥', total: 1287, saiu: false },
  { nome: 'Coração Valente', cor: '💎', total: 903, saiu: false },
  { nome: 'Ana', cor: '👑', total: 812, saiu: false },
  { nome: 'Lobo Solitário', cor: '🐺', total: 640, saiu: false },
  { nome: 'Zé do Zap', cor: '', total: 512, saiu: false },
  { nome: 'Nome Gigante Que Nunca Vai Caber Na Linha Do Quadro Mesmo', cor: '🦋', total: 480, saiu: true },
  { nome: 'Mortal Comum', cor: '', total: 44, saiu: false }
]

// O quadro custa ~0,5s para compor: um só serve para vários testes.
let cacheQuadro = null
async function quadroDosTestes () {
  if (!cacheQuadro) {
    const buffer = await quadro.comporPergaminhoRanking({ itens: ITENS_TESTE, subtitulo: 'Recinto de Teste' })
    cacheQuadro = { buffer, imagem: await Jimp.read(buffer) }
  }
  return cacheQuadro
}

async function main () {
  console.log('Teste offline do /ranking (quadro em imagem)')

  await testar('exports: comando, medalhas, 7 posições e dimensões do asset', async () => {
    exigir(ranking.nome === 'ranking', 'nome errado')
    exigir(typeof ranking.executar === 'function', 'sem executar')
    exigir(typeof ranking._injetarCapa === 'function', 'sem gancho de imagem')
    exigir(Array.isArray(ranking.__internos.MEDALHAS) && ranking.__internos.MEDALHAS.length === 3, 'medalhas do podio')
    exigir(ranking.__internos.LIMITE_EXIBIDOS === 7, 'o ranking deveria exibir 7 posicoes')
    exigir(quadro.POSICOES_RANKING.length === 7, 'o asset deveria ter 7 posicoes')
    exigir(ranking.__internos.LIMITE_EXIBIDOS === quadro.POSICOES_RANKING.length,
      'o corte do top nao acompanha o numero de linhas do quadro')
    exigir(quadro.LARG === 1024 && quadro.ALT === 1536, 'dimensoes do quadro')
    exigir(fs.existsSync(quadro.CAMINHO_MOLDURA), 'o asset do quadro nao esta no repositorio: ' + quadro.CAMINHO_MOLDURA)
    // As 7 posições descem em y: a 1ª é a mais alta e cada uma tem seu filete.
    for (let i = 1; i < quadro.POSICOES_RANKING.length; i += 1) {
      exigir(quadro.POSICOES_RANKING[i].y > quadro.POSICOES_RANKING[i - 1].y,
        'a posicao ' + (i + 1) + ' nao esta abaixo da anterior')
    }
    exigir(/7 membros/.test(ranking.descricao), 'a descricao do menu deveria falar de 7 membros: ' + ranking.descricao)
  })

  await testar('quadro: sai no tamanho do asset e a moldura da arte fica intacta', async () => {
    const { buffer, imagem } = await quadroDosTestes()
    exigir(Buffer.isBuffer(buffer) && buffer.length > 20000, 'buffer pequeno demais')
    exigir(imagem.bitmap.width === quadro.LARG && imagem.bitmap.height === quadro.ALT,
      'dimensoes erradas: ' + imagem.bitmap.width + 'x' + imagem.bitmap.height)
    // O asset é a arte inteira: tem que estar versionado e no mesmo tamanho.
    const moldura = await Jimp.read(quadro.CAMINHO_MOLDURA)
    exigir(moldura.bitmap.width === quadro.LARG && moldura.bitmap.height === quadro.ALT, 'o asset mudou de tamanho')
    // Nada é pintado por cima do ornamento: os QUATRO cantos do quadro gerado
    // são idênticos aos do asset (a moldura grega continua lá).
    for (const [x, y] of [[0, 0], [quadro.LARG - 1, 0], [0, quadro.ALT - 1], [quadro.LARG - 1, quadro.ALT - 1]]) {
      exigir((imagem.getPixelColor(x, y) >>> 0) === (moldura.getPixelColor(x, y) >>> 0),
        'o canto ' + x + ',' + y + ' do quadro foi alterado')
    }
  })

  await testar('nomes: a cor do corVip é pintada na linha certa (escurecida para o papel)', async () => {
    const { imagem } = await quadroDosTestes()
    for (const [indice, emoji] of [[0, '🔥'], [1, '💎'], [2, '👑'], [3, '🐺']]) {
      const pos = quadro.POSICOES_RANKING[indice]
      const b = bandaDaPosicao(pos)
      // A cor chega ao papel ESCURECIDA até o contraste mínimo do quadro
      // (ver escurecerParaContraste) — é essa a tinta que o teste procura.
      const cor = I.escurecerParaContraste(coresVip.corDoEmoji(emoji))
      const area = areaCor(imagem, cor, I.NOME_X0, b.y0, I.CONTAGEM_X1, b.y1)
      exigir(area.n > 40, 'nome da linha ' + (indice + 1) + ' sem a cor ' + emoji + ' (' + area.n + ' px)')
      // O nome começa na coluna do pontilhado e para antes da coluna da contagem.
      exigir(area.minX <= I.NOME_X0 + 10, 'o nome nao comecou na coluna (x=' + area.minX + ')')
      exigir(area.maxX <= I.CONTAGEM_X1 - I.FOLGA, 'o nome invadiu a coluna da contagem (x=' + area.maxX + ')')
    }
  })

  await testar('nomes: quem não tem cor sai na tinta padrão do quadro', async () => {
    const { imagem } = await quadroDosTestes()
    const pos = quadro.POSICOES_RANKING[4] // 'Zé do Zap' (sem cor definida)
    const b = bandaDaPosicao(pos)
    const cor = I.escurecerParaContraste(coresVip.COR_PADRAO)
    const area = areaCor(imagem, cor, I.NOME_X0, b.y0, I.CONTAGEM_X1, b.y1)
    exigir(area.n > 40, 'nome sem cor deveria usar a tinta padrao (' + area.n + ' px)')
  })

  await testar('contagem: alinhada à DIREITA, pousando antes da estrela', async () => {
    const { imagem } = await quadroDosTestes()
    const font = await loadFont(SANS_32_WHITE)
    for (let i = 0; i < ITENS_TESTE.length; i += 1) {
      const pos = quadro.POSICOES_RANKING[i]
      const b = bandaDaPosicao(pos)
      const area = areaCor(imagem, I.TINTA, I.CONTAGEM_X1 - 170, b.y0, I.CONTAGEM_X1 + 8, b.y1)
      exigir(area.n > 20, 'a contagem da linha ' + (i + 1) + ' nao foi desenhada (' + area.n + ' px)')
      // O último pixel da contagem pousa em CONTAGEM_X1 (menos o respiro da
      // própria letra): é isso que a mantém longe da estrela decorativa.
      exigir(area.maxX <= I.CONTAGEM_X1, 'a contagem passou do limite (x=' + area.maxX + ')')
      exigir(area.maxX >= I.CONTAGEM_X1 - I.FOLGA, 'a contagem saiu de perto da estrela (x=' + area.maxX + ')')
      // A largura do que foi pintado não passa da largura do texto medido.
      const medido = I.medir(font, String(ITENS_TESTE[i].total))
      exigir(area.maxX - area.minX + 1 <= medido, 'a contagem saiu mais larga que o texto medido')
    }
  })

  await testar('nome gigante é cortado com "..." dentro da coluna do nome', async () => {
    const font32 = await loadFont(SANS_32_WHITE)
    const font64 = await loadFont(SANS_64_WHITE)
    const gigante = ITENS_TESTE[5]
    const larguraMax = I.CONTAGEM_X1 - I.FOLGA - I.medir(font32, String(gigante.total)) - I.NOME_X0
    exigir(larguraMax > 0, 'a coluna do nome ficou sem espaco')
    const escolha = I.escolher([font64, font32], gigante.nome, larguraMax)
    exigir(escolha && escolha.cortado === true, 'o nome gigante deveria ser cortado')
    exigir(escolha.texto.endsWith('...'), 'deveria terminar em ...: ' + escolha.texto)
    exigir(I.medir(escolha.font, escolha.texto) <= larguraMax, 'o corte estourou a coluna')
    exigir(escolha.texto.length < gigante.nome.length, 'nada foi cortado')
    // Nome curto sai INTEIRO na fonte GRANDE: a escada só desce se precisar.
    const curto = I.escolher([font64, font32], 'Ana', larguraMax)
    exigir(curto && curto.font === font64 && curto.cortado === false,
      'nome curto deveria sair inteiro na fonte grande')
  })

  await testar('emoji/ideograma não quebra a medida nem o desenho', async () => {
    const font = await loadFont(SANS_32_WHITE)
    const limpo = I.limparParaFonte(font, 'Sr. Emoji 🚀 火')
    exigir(limpo === 'Sr. Emoji', 'emoji/ideograma deveria sair do texto: "' + limpo + '"')
    exigir(I.medir(font, limpo) > 0, 'medida zerada')
    exigir(I.medir(font, I.limparParaFonte(font, 'Coração ç ã')) > 0, 'acentos deveriam continuar')
    exigir(I.tintaVertical(font, limpo).base > 0, 'tinta sem base medida')
    // O texto ASSENTA acima do filete (não é atravessado por ele).
    const y = I.yParaAssentar(font, limpo, 505)
    exigir(y + I.tintaVertical(font, limpo).base < 505, 'a tinta invadiu o filete (y=' + y + ')')
  })

  await testar('contraste: toda cor do /corvip sai legível no papel do quadro', async () => {
    // O papel deste quadro é bem mais escuro que o do cartaz do /procurado:
    // sem este ajuste o nome do VIP do /corvip sairia lavado. O HUE não muda —
    // o nome continua sendo "a cor do VIP", só que legível.
    const amostras = Object.keys(coresVip.MAPA_COR_VIP).concat(['☕', '🥑', '🟡'])
    for (const emoji of amostras) {
      const original = coresVip.corDoEmoji(emoji)
      const tinta = I.escurecerParaContraste(original)
      exigir(I.contraste(I.canais(tinta), I.FUNDO_PARAGRAMENTO) >= I.CONTRASTE_MINIMO,
        'a cor ' + emoji + ' (' + tinta + ') ficou abaixo do contraste minimo')
      exigir(I.luminancia(I.canais(tinta)) <= I.luminancia(I.canais(original)),
        'o escurecimento clareou a cor de ' + emoji)
    }
    // A tinta padrão (sem cor) já nasce legível: não é mexida.
    exigir(I.escurecerParaContraste(coresVip.COR_PADRAO) === coresVip.COR_PADRAO,
      'a tinta padrao nao deveria ser alterada')
  })

  await testar('subtítulo: o nome do grupo sai centralizado no cabeçalho', async () => {
    const { imagem } = await quadroDosTestes()
    const area = areaCor(imagem, I.TINTA_SUAVE, 0, I.SUBTITULO_Y - 65, quadro.LARG, I.SUBTITULO_Y + 75)
    exigir(area.n > 100, 'o subtitulo nao foi desenhado (' + area.n + ' px)')
    const meio = (area.minX + area.maxX) / 2
    exigir(Math.abs(meio - quadro.LARG / 2) <= 3, 'o subtitulo nao esta centralizado (meio ' + meio + ')')
    exigir(area.minX > 60 && area.maxX < quadro.LARG - 60, 'o subtitulo saiu do respiro do cabecalho')
    // Sem nome de grupo (sem metadados) o cabeçalho fica limpo — não é erro.
    const semNome = await Jimp.read(await quadro.comporPergaminhoRanking({
      itens: ITENS_TESTE.slice(0, 3),
      subtitulo: ''
    }))
    const vazio = contarCor(semNome, I.TINTA_SUAVE, 0, I.SUBTITULO_Y - 65, quadro.LARG, I.SUBTITULO_Y + 75)
    exigir(vazio === 0, 'o cabecalho ganhou tinta sem nome de grupo (' + vazio + ' px)')
  })

  await testar('rodapé: a nota de quem saiu do grupo só existe quando alguém saiu', async () => {
    const { imagem } = await quadroDosTestes() // tem um item com saiu: true
    const comNota = areaCor(imagem, I.TINTA_SUAVE, 0, I.RODAPE_NOTA_Y - 40, quadro.LARG, I.RODAPE_NOTA_Y + 40)
    exigir(comNota.n > 100, 'faltou a nota de quem saiu (' + comNota.n + ' px)')
    const meio = (comNota.minX + comNota.maxX) / 2
    exigir(Math.abs(meio - quadro.LARG / 2) <= 3, 'a nota do rodape nao esta centralizada (meio ' + meio + ')')
    // A nota é UMA só: o aviso vive no rodapé, não em cada linha do pódio.
    exigir(comNota.maxY - comNota.minY < 45, 'a nota do rodape virou varias linhas')
    const semSaida = await Jimp.read(await quadro.comporPergaminhoRanking({
      itens: ITENS_TESTE.map((item) => ({ ...item, saiu: false })),
      subtitulo: 'Recinto de Teste'
    }))
    const semNota = contarCor(semSaida, I.TINTA_SUAVE, 0, I.RODAPE_NOTA_Y - 45, quadro.LARG, I.RODAPE_NOTA_Y + 45)
    exigir(semNota < 40, 'o rodape ganhou nota sem ninguem ter saido (' + semNota + ' px)')
    exigir(I.NOTA_SAIU === '* saiu do grupo', 'a nota de saida mudou: ' + I.NOTA_SAIU)
  })

  await testar('miniatura: 64×64 em JPEG base64 (sem sharp/ffmpeg no processo do bot)', async () => {
    const { buffer } = await quadroDosTestes()
    const base64 = await quadro.miniaturaDoPergaminho(buffer)
    exigir(typeof base64 === 'string' && base64.length > 200, 'miniatura invalida')
    const mini = await Jimp.read(Buffer.from(base64, 'base64'))
    exigir(mini.bitmap.width === 64 && mini.bitmap.height === 64,
      'miniatura fora de 64x64: ' + mini.bitmap.width + 'x' + mini.bitmap.height)
  })

  await testar('grupo obrigatório: fora de grupo responde em texto e nem gera o quadro', async () => {
    const { sock, enviadas } = criarSock()
    await ranking.executar(sock, '5511900000002@s.whatsapp.net', mensagem('/ranking'))
    exigir(!imagemEnviada(enviadas), 'nao devia gerar quadro fora de grupo')
    exigir(/só funciona em grupos/.test(textoUnico(enviadas)), 'faltou o aviso de grupo: ' + textoUnico(enviadas))
  })

  await testar('grupo sem mensagens: resposta amigável, sem quadro', async () => {
    rankingFake = []
    const { sock, enviadas } = criarSock()
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking'))
    exigir(!imagemEnviada(enviadas), 'nao devia gerar quadro sem mensagens')
    exigir(/ainda está em silêncio/.test(textoUnico(enviadas)),
      'faltou a mensagem de grupo vazio: ' + textoUnico(enviadas))
  })

  await testar('busca: o comando pede MAIS linhas que as 7 exibidas (antes de agrupar)', async () => {
    rankingFake = [{ usuario_id: ID_TOP, nome: 'João', total: 1 }]
    const { sock } = criarSock()
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking'))
    exigir(limitePedido === ranking.__internos.LIMITE_BUSCA_AGRUPAMENTO,
      'buscou ' + limitePedido + ' linhas, deveria buscar ' + ranking.__internos.LIMITE_BUSCA_AGRUPAMENTO)
    exigir(limitePedido > ranking.__internos.LIMITE_EXIBIDOS,
      'com o mesmo limite do exibido, o agrupamento perderia o documento do telefone')
  })

  await testar('metadados do grupo são lidos UMA vez (nada de consulta por linha)', async () => {
    rankingFake = [
      { usuario_id: ID_TOP, nome: 'A', total: 10 },
      { usuario_id: JID_COMUM, nome: 'B', total: 5 }
    ]
    let chamadas = 0
    const { sock } = criarSock({
      groupMetadata: async () => { chamadas += 1; return { subject: 'Recinto', participants: PARTICIPANTES } }
    })
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking'))
    exigir(chamadas === 1, 'os metadados foram lidos ' + chamadas + ' vez(es)')
  })

  await testar('corte: no máximo as 7 posições do quadro descem para o desenho', async () => {
    rankingFake = []
    for (let i = 1; i <= 9; i += 1) {
      rankingFake.push({ usuario_id: '55119000000' + String(i).padStart(2, '0'), nome: 'Pessoa ' + i, total: 100 - i * 10 })
    }
    estilosFake = new Map()
    let itensDesenhados = null
    ranking._injetarCapa(async (args) => { itensDesenhados = args.itens; return Buffer.alloc(8) })
    const { sock, enviadas } = criarSock()
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking'))
    ranking._restaurarCapa()

    exigir(itensDesenhados, 'o desenho nao recebeu itens')
    exigir(itensDesenhados.length === 7, 'o podio deveria ter 7 itens, veio ' + itensDesenhados.length)
    exigir(itensDesenhados[0].total === 90 && itensDesenhados[6].total === 30,
      'os totais do corte sairam errados: ' + JSON.stringify(itensDesenhados.map((i) => i.total)))
    // O texto (fallback, já que o gerador injetado devolve um buffer inválido)
    // diz quantas posições o quadro tem.
    const legenda = String(imagemEnviada(enviadas)?.conteudo?.caption || '')
    exigir(/os 7 mais ativos/.test(legenda) || /Os 7 reinos/.test(textoUnico(enviadas)),
      'a contagem de posicoes nao aparece no texto')
  })

  await testar('arte falhou: cai no texto de sempre (mesma lista, com aviso de quem saiu)', async () => {
    rankingFake = [
      { usuario_id: ID_TOP, nome: 'João do Banco', total: 120 },
      { usuario_id: '5511900000009', nome: 'Sumido', total: 1 }
    ]
    estilosFake = new Map()
    ranking._injetarCapa(async () => { throw new Error('idQuadro quebrou') })
    const { sock, enviadas } = criarSock()
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking'))
    ranking._restaurarCapa()

    exigir(!imagemEnviada(enviadas), 'nao devia mandar imagem quebrada')
    const txt = textoUnico(enviadas)
    exigir(/🥇 \*João do Banco\* — \*120\* mensagens/.test(txt), 'linha do podio errada: ' + txt)
    exigir(/🥈 \*Sumido\* — \*1\* mensagem /.test(txt), 'singular/posicao errada: ' + txt)
    exigir(/\(saiu do grupo\)/.test(txt), 'aviso de saida ausente: ' + txt)
    exigir(/RANKING DOS MAIS ATIVOS/.test(txt), 'cabecalho do texto ausente')
    exigir(/Os 7 reinos/.test(txt), 'a contagem de posicoes nao aparece: ' + txt)
    exigir(/O sono alcança até os mais falantes/.test(txt), 'frase final ausente')
  })

  await testar('fluxo feliz: manda o quadro com legenda e miniatura, sem texto junto', async () => {
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
    exigir(/Quadro do ranking/.test(String(envio.conteudo.caption)), 'legenda errada: ' + envio.conteudo.caption)
    exigir(/os 7 mais ativos/.test(String(envio.conteudo.caption)), 'a legenda deveria citar as 7 posicoes')
    exigir(typeof envio.conteudo.jpegThumbnail === 'string' && envio.conteudo.jpegThumbnail.length > 200,
      'faltou a miniatura (sem ela o Baileys chamaria sharp/ffmpeg)')
    exigir(textos(enviadas).length === 0, 'nao deveria mandar texto junto com a imagem')

    // A cor do VIP chegou ao desenho: o PNG enviado tem pixels da 🔥 (na tinta
    // escurecida, claro) na PRIMEIRA posição do pódio.
    const imagem = await Jimp.read(envio.conteudo.image)
    const pos = quadro.POSICOES_RANKING[0]
    const b = bandaDaPosicao(pos)
    const cor = I.escurecerParaContraste(coresVip.corDoEmoji('🔥'))
    const pintados = contarCor(imagem, cor, I.NOME_X0, b.y0, I.CONTAGEM_X1, b.y1)
    exigir(pintados > 40, 'a cor do VIP nao apareceu no quadro (' + pintados + ' px)')
  })

  await testar('sem metadados do grupo o quadro sai mesmo assim (com a nota do rodapé)', async () => {
    rankingFake = [{ usuario_id: '5511900000003', nome: 'Forasteiro', total: 3 }]
    const { sock, enviadas } = criarSock({ groupMetadata: async () => { throw new Error('sem metadados') } })
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking'))

    const envio = imagemEnviada(enviadas)
    exigir(envio, 'deveria mandar o quadro mesmo sem metadados')
    exigir(!/saiu do grupo/.test(String(envio.conteudo.caption)), 'a legenda nao leva o aviso de saida')
    const imagem = await Jimp.read(envio.conteudo.image)
    const nota = contarCor(imagem, I.TINTA_SUAVE, 0, I.RODAPE_NOTA_Y - 45, quadro.LARG, I.RODAPE_NOTA_Y + 45)
    exigir(nota > 100, 'faltou a nota de quem nao esta mais no grupo (' + nota + ' px)')
  })

  // ═══════════════════════════════════════════════════════════════════
  // 📊 O CORTE ACONTECE DEPOIS DO AGRUPAMENTO — o caso que só passa se os
  // DOIS documentos (LID + telefone) da mesma pessoa forem juntados ANTES do
  // `.slice(0, 7)`: cortando antes, o documento do telefone (fora do top 7
  // cru) seria jogado fora, a soma sairia errada e a pessoa perderia a vaga
  // para quem tinha menos mensagens.
  // ═══════════════════════════════════════════════════════════════════
  await testar('corte: agrupa LID + telefone ANTES de cortar (não perde quem tem dois documentos)', async () => {
    estilosFake = new Map()
    rankingFake = [
      { usuario_id: '5511900000011', nome: 'P1', total: 100 },
      { usuario_id: '5511900000012', nome: 'P2', total: 90 },
      { usuario_id: '5511900000013', nome: 'P3', total: 80 },
      { usuario_id: '5511900000014', nome: 'P4', total: 70 },
      { usuario_id: '5511900000015', nome: 'P5', total: 60 },
      { usuario_id: '5511900000016', nome: 'P6', total: 50 },
      { usuario_id: '5511900000017', nome: 'Setimo Cru', total: 25 }, // 7º se cortasse ANTES
      { usuario_id: LID_CRUDO, nome: 'NomeVindoDoBanco', total: 21 }, // 8º cru
      { usuario_id: NUM_REAL, nome: 'NomeVindoDoBanco', total: 20 } // 9º cru (soma 41)
    ]
    let itensDesenhados = null
    ranking._injetarCapa(async (args) => { itensDesenhados = args.itens; return Buffer.alloc(8) })
    const { sock } = criarSock({
      groupMetadata: async () => ({ subject: 'Recinto LID', participants: PARTICIPANTES_LID })
    })
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking'))
    ranking._restaurarCapa()
    estilosFake = new Map()

    exigir(itensDesenhados, 'o desenho nao recebeu itens')
    exigir(itensDesenhados.length === 7, 'o podio deveria ter 7 itens, veio ' + itensDesenhados.length)
    const setimo = itensDesenhados[6]
    exigir(setimo.total === 41, 'o 7º lugar deveria ser a SOMA dos dois documentos (41), veio ' + setimo.total)
    exigir(!itensDesenhados.some((item) => item.total === 25),
      'quem estava no corte CRU vazou para o podio: ' + JSON.stringify(itensDesenhados.map((i) => i.total)))
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

    // 1) A consulta ao banco de VIPs foi feita pelo NÚMERO REAL, não pelo LID,
    //    e o nome/cor custom chegaram no item que vai para o desenho.
    let itemTop = null
    ranking._injetarCapa(async (args) => { itemTop = args.itens[0]; return Buffer.alloc(8) })
    const { sock, enviadas } = criarSock({
      groupMetadata: async () => ({ subject: 'Recinto LID', participants: PARTICIPANTES_LID })
    })
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking'))
    ranking._restaurarCapa()

    const pedido = pedidosDeEstilos[pedidosDeEstilos.length - 1] || []
    exigir(pedido.includes(NUM_REAL), 'a consulta não usou o numero resolvido: ' + JSON.stringify(pedido))
    exigir(!pedido.includes(LID_CRUDO), 'a consulta mandou o LID cru: ' + JSON.stringify(pedido))

    exigir(itemTop, 'o desenho nao recebeu nenhum item')
    exigir(itemTop.nome === 'MeuNomeVip', 'o nome custom nao foi usado: ' + itemTop.nome)
    exigir(itemTop.cor === '🔥', 'a cor do corVip nao chegou no item: ' + JSON.stringify(itemTop.cor))
    exigir(itemTop.saiu === false, 'o lider por LID foi marcado como saiu do grupo a toa')
    // (o gerador fake devolve um buffer inválido, então aqui o comando cai no
    // fallback em TEXTO — e ele também tem que sair com a cor)
    exigir(/🔥 MeuNomeVip/.test(textoUnico(enviadas)), 'o fallback em texto perdeu a cor/nome: ' + textoUnico(enviadas))

    // 2) No quadro DE VERDADE a cor é pintada na linha do topo
    const { sock: sock2, enviadas: env2 } = criarSock({
      groupMetadata: async () => ({ subject: 'Recinto LID', participants: PARTICIPANTES_LID })
    })
    await ranking.executar(sock2, JID_GRUPO, mensagem('/ranking'))
    estilosFake = new Map()

    const envio = imagemEnviada(env2)
    exigir(envio, 'deveria mandar o quadro')
    const imagem = await Jimp.read(envio.conteudo.image)
    const pos = quadro.POSICOES_RANKING[0]
    const b = bandaDaPosicao(pos)
    const cor = I.escurecerParaContraste(coresVip.corDoEmoji('🔥'))
    const pintados = contarCor(imagem, cor, I.NOME_X0, b.y0, I.CONTAGEM_X1, b.y1)
    exigir(pintados > 40, 'a cor do corVip NAO apareceu no quadro vindo por LID (' + pintados + ' px)')
  })

  await testar('regressão LID: LID fora dos metadados cai no mapeamento da sessão', async () => {
    const { resolverNumeros } = ranking.__internos
    // Sem participante nos metadados → tenta o lid-mapping da Baileys
    lid.__definirConsultaSessaoTeste(async (lidCru) => (lidCru === LID_CRUDO ? NUM_REAL : null))
    const mapa = await resolverNumeros([], [LID_CRUDO])
    exigir(mapa.get(LID_CRUDO) === NUM_REAL, 'o mapeamento da sessao nao resolveu: ' + JSON.stringify([...mapa]))
    lid.__definirConsultaSessaoTeste(null)
  })

  await testar('resolverNumeros: número real fica, LID dos metadados vira telefone e o desconhecido fica', async () => {
    const { resolverNumeros } = ranking.__internos
    lid.__definirConsultaSessaoTeste(async () => null)
    const mapa = await resolverNumeros(PARTICIPANTES_LID, [
      ID_TOP, // ja e numero real (esta nos metadados)
      LID_CRUDO, // LID com phoneNumber nos metadados
      '5511999990000', // ninguem conhece: segue como veio
      '', // id vazio: ignorado
      ID_TOP + ':7' // com sufixo de dispositivo
    ])
    exigir(mapa.get(ID_TOP) === ID_TOP, 'numero real alterado: ' + mapa.get(ID_TOP))
    exigir(mapa.get(LID_CRUDO) === NUM_REAL, 'LID dos metadados nao virou telefone: ' + mapa.get(LID_CRUDO))
    exigir(mapa.get('5511999990000') === '5511999990000', 'desconhecido foi inventado: ' + mapa.get('5511999990000'))
    exigir(!mapa.has(''), 'id vazio entrou no mapa')
    // A chave é sempre o id NORMALIZADO: "…:7" colapsa em ID_TOP (uma entrada só)
    exigir(mapa.size === 3, 'mapa com tamanho inesperado (id duplicado?): ' + JSON.stringify([...mapa]))
    lid.__definirConsultaSessaoTeste(null)
  })

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
    estilosFake = new Map()

    exigir(itensDesenhados, 'o desenho não recebeu itens')
    exigir(itensDesenhados.length === 1, 'a pessoa foi duplicada no pódio: ' + JSON.stringify(itensDesenhados.map((i) => i.total)))
    exigir(itensDesenhados[0].total === 12, 'os totais não foram somados: ' + itensDesenhados[0].total)
    exigir(itensDesenhados[0].nome === 'MeuNomeVip', 'o VIP do número real não foi usado: ' + itensDesenhados[0].nome)
    exigir(itensDesenhados[0].saiu === false, 'quem está no grupo foi marcado como saiu')
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

  await testar('arte: asset versionado, nada de lib nativa e o comando com fallback', async () => {
    const fonte = fs.readFileSync(path.join(__dirname, '..', 'dados', 'ranking-pergaminho.js'), 'utf8')
    exigir(fonte.includes("require('jimp')"), 'deveria usar jimp')
    exigir(/assets/.test(fonte) && fonte.includes('ranking-pergaminho.png'),
      'o modulo deveria apontar para o asset versionado')
    exigir(!/require\('(sharp|canvas|node-canvas)'\)/.test(fonte), 'nada de lib nativa no desenho')
    exigir(!/Math\.random\(/.test(fonte), 'o quadro deveria ser deterministico (sem Math.random)')
    exigir(fs.existsSync(path.join(__dirname, '..', 'assets', 'quadros', 'ranking-pergaminho.png')),
      'o asset do quadro sumiu do repositorio')
    // O pergaminho desenhado por código não existe mais: a arte é o arquivo.
    exigir(!fs.existsSync(path.join(__dirname, '..', 'pergaminho-ranking.js')),
      'o antigo pergaminho-ranking.js ainda esta no repositorio')
    const comando = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'ranking.js'), 'utf8')
    exigir(comando.includes('comporPergaminhoRanking'), 'comando sem o quadro')
    exigir(/catch \(errQuadro\)/.test(comando), 'comando sem fallback em texto')
  })

  console.log('')
  console.log(reprovadas === 0
    ? '✅ Todos os ' + total + ' testes de /ranking passaram.'
    : '❌ ' + reprovadas + ' de ' + total + ' falharam.')
  process.exitCode = reprovadas === 0 ? 0 : 1
}

main().catch((err) => { console.error('💥 erro fatal no teste:', err); process.exitCode = 1 })