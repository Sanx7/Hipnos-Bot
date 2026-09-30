// ============================================
// 🕵️ teste-procurado.js — testes OFFLINE do /procurado
// ============================================
// Roda SEM WhatsApp e SEM MongoDB:
//   🗄️ database FAKE (buscarRanking trocado ANTES do require do comando,
//      que faz destructuring);
//   💠 vip FAKE (obterEstilosVip) — nenhum acesso ao Mongo real;
//   💬 sock mockado — só registra o que seria enviado (e a foto de perfil
//      sempre falha, para exercitar o caminho "sem foto");
//   🎨 a arte REAL roda (Jimp + a moldura do repositório) e o resultado é
//      conferido pixel a pixel: o círculo detectado, a cor do título e o
//      texto escrito no papel.
//
// Cobre: metadados do comando, grupo obrigatório, grupo sem mensagens,
// cartaz gerado (com/sem foto, com alcunha custom/padrão, líder que saiu),
// detecção do círculo (alfa e mancha clara), recorte circular da foto,
// texto longo cortado, título/nome/contagem/"desde" pintados, miniatura e
// o fallback em texto quando a arte falha.
// Uso: node scripts/teste-procurado.js
// ============================================

process.env.MONGODB_URI = ''

const { Jimp, JimpMime, loadFont } = require('jimp')
const { SANS_16_WHITE, SANS_32_WHITE } = require('jimp/fonts')

// 🗄️ database FAKE — instalado ANTES do require do comando (destructuring).
const database = require('../database')
let rankingFake = []
let rankingFalha = null
let limitePedido = 0
database.buscarRanking = async (_grupo, limite) => {
  if (rankingFalha) throw rankingFalha
  limitePedido = limite
  return rankingFake
}

// 💠 VIP FAKE: o mapa que cada teste montar (nome/cor/alcunha custom).
const vip = require('../vip')
let estilosFake = new Map()
let estilosFalha = null
vip.obterEstilosVip = async () => {
  if (estilosFalha) throw estilosFalha
  return estilosFake
}

const comando = require('../comandos/menu-utilitario/procurado')
const alcunhas = require('../dados/alcunhas')
const cartaz = require('../dados/cartaz-procurado')
const I = cartaz.__internos

const JID_GRUPO = '120363000000000001@g.us'
const JID_COMUM = '5511900000002'
const NUM_LIDER = '5511900000001'
const PARTICIPANTES = [
  { id: NUM_LIDER + '@s.whatsapp.net' },
  { id: JID_COMUM + '@s.whatsapp.net' }
]

let reprovadas = 0
let total = 0
async function testar (nome, fn) {
  total += 1
  try { await fn(); console.log('PASSOU: ' + nome) }
  catch (err) { reprovadas += 1; console.log('FALHOU: ' + nome + ' :: ' + (err?.message || err)) }
}
function exigir (cond, detalhe) { if (!cond) throw new Error(detalhe || 'condicao falsa') }

function criarSock (cfg) {
  const c = cfg || {}
  const enviadas = []
  const sock = {
    enviadas,
    groupMetadata: c.groupMetadata || (async () => ({ subject: 'Recinto de Teste', participants: PARTICIPANTES })),
    // Sem foto pública por padrão: é o caminho mais comum (privacidade).
    profilePictureUrl: async () => { throw Object.assign(new Error('item-not-found'), { statusCode: 404 }) },
    sendMessage: async (jid, conteudo, extra) => {
      enviadas.push({ jid, conteudo, extra })
      return { key: { id: 'fake-' + enviadas.length } }
    }
  }
  return { sock, enviadas }
}
const mensagem = () => ({ key: { remoteJid: JID_GRUPO, participant: JID_COMUM, id: 'p1' }, message: { conversation: '/procurado' } })
const textos = (enviadas) => enviadas.map((e) => e.conteudo?.text).filter((t) => typeof t === 'string')
const textoUnico = (enviadas) => textos(enviadas).join(' | ')
const imagemEnviada = (enviadas) => enviadas.find((e) => e.conteudo?.image)

function definirRanking (itens) { rankingFake = itens; rankingFalha = null }
function definirEstilos (mapa) { estilosFake = mapa; estilosFalha = null }

// 🔎 Conta pixels EXATAMENTE de um hex numa região (prova que a cor foi
// pintada ali — só os pixels opacos dos glifos ficam com a cor cheia).
// ⚠️ Lê o bitmap.data DIRETO ([R,G,B,A]) porque o `getPixelColor` desta
// versão do Jimp é simétrico com um `setPixelColor` que grava [A,R,G,B] —
// comparar o inteiro dele com 0xRRGGBBAA daria contagem errada.
function contarCor (imagem, hex, x0, y0, x1, y1) {
  const n = parseInt(hex.replace('#', ''), 16)
  const alvo = [n >> 16, (n >> 8) & 0xff, n & 0xff]
  const d = imagem.bitmap.data
  const W = imagem.bitmap.width
  let total = 0
  for (let y = Math.max(0, y0); y < Math.min(imagem.bitmap.height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x += 1) {
      const j = (y * W + x) * 4
      if (d[j] === alvo[0] && d[j + 1] === alvo[1] && d[j + 2] === alvo[2]) total += 1
    }
  }
  return total
}

// 📸 Foto sintética para exercitar o recorte circular sem rede.
// ⚠️ AZUL DOMINANTE EM TODO O DISCO (b > r sempre): o teste prova que a foto
// entrou comparando o canal B com o R no centro do círculo. Um gradiente
// diagonal daria b < r bem no centro (onde o cover corta), e o teste passaria
// a falhar sem que houvesse bug no desenho.
async function fotoSintetica (w = 240, h = 240) {
  const foto = new Jimp({ width: w, height: h, color: 0x000000 })
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4
      const v = Math.round(((x + y) / (w + h)) * 120)
      foto.bitmap.data[i] = 20 + Math.round(v / 2) // R baixo
      foto.bitmap.data[i + 1] = 60 + Math.round(v / 2) // G médio
      foto.bitmap.data[i + 2] = 210 - Math.round(v / 2) // B alto
      foto.bitmap.data[i + 3] = 255
    }
  }
  return foto.getBuffer(JimpMime.png)
}

// ─── 🎨 Dados fixos do cartaz usado nos testes ───
const LIDER_TESTE = { usuario_id: NUM_LIDER, nome: 'João da Silva', total: 1287 }
const DADOS_CARTAZ = {
  nome: 'João da Silva',
  alcunha: 'Devorador de Deuses',
  total: 1287,
  palavra: 'mensagens',
  desde: '30/09/2026',
  rodape: 'Quem linger mais no chat, mais aparece aqui.'
}

// Um cartaz custa ~0,9s (leitura da moldura + 1,5M de pixels), então o
// resultado é calculado uma vez e reaproveitado pelos testes visuais.
let cacheCartaz = null
let cacheCartazComFoto = null
async function cartazDosTestes (comFoto) {
  if (comFoto) {
    if (!cacheCartazComFoto) {
      const buffer = await cartaz.comporCartazProcurado({ ...DADOS_CARTAZ, foto: await fotoSintetica() })
      cacheCartazComFoto = { buffer, imagem: await Jimp.read(buffer) }
    }
    return cacheCartazComFoto
  }
  if (!cacheCartaz) {
    const buffer = await cartaz.comporCartazProcurado(DADOS_CARTAZ)
    cacheCartaz = { buffer, imagem: await Jimp.read(buffer) }
  }
  return cacheCartaz
}

async function main () {
  console.log('Teste offline do /procurado (cartaz em imagem)')

  // ─── 📜 Metadados do comando ───
  await testar('exports: nome, aliases, descrição, categoria e executar', async () => {
    exigir(comando.nome === 'procurado', 'nome errado')
    exigir(Array.isArray(comando.aliases) && comando.aliases.includes('maisativo'), 'faltou alias')
    exigir(comando.aliases.includes('wanted') && comando.aliases.includes('lider'), 'faltou alias')
    exigir(typeof comando.descricao === 'string' && comando.descricao.length > 0, 'sem descrição')
    exigir(comando.categoria === 'utilitario', 'categoria errada')
    exigir(typeof comando.executar === 'function', 'sem executar')
  })

  // ─── 🔍 A detecção do círculo ───
  await testar('detectarCirculo: acha o círculo da moldura real sem coordenada fixa', async () => {
    const moldura = await Jimp.read(cartaz.CAMINHO_MOLDURA)
    exigir(moldura.bitmap.width === 1024 && moldura.bitmap.height === 1536, 'moldura com tamanho inesperado')
    const c = cartaz.detectarCirculo(moldura)
    exigir(c, 'não detectou o círculo')
    // Valores medidos pixel a pixel no arquivo do repositório.
    exigir(c.cx > 480 && c.cx < 545, 'centro X fora do esperado: ' + c.cx)
    exigir(c.cy > 570 && c.cy < 625, 'centro Y fora do esperado: ' + c.cy)
    exigir(c.raio > 225 && c.raio < 260, 'raio fora do esperado: ' + c.raio)
    exigir(c.x0 >= 0 && c.y0 >= 0, 'box com origem negativa')
    exigir(c.x1 < 1024 && c.y1 < 1536, 'box estourou a imagem')
    exigir(c.raio <= Math.floor(Math.max(c.largura, c.altura) / 2), 'raio inconsistente com o box')
  })

  await testar('detectarCirculo: usa o canal ALFA quando a moldura tem furo transparente', async () => {
    // 🧪 PNG SINTÉTICO RGBA: fundo escuro + disco TRANSPARENTE. Serve para
    // provar o caminho do alfa, que a moldura do repositório (RGB, sem
    // alfa) não exercita.
    const m = new Jimp({ width: 200, height: 200, color: 0x202020ff })
    for (let y = 40; y < 160; y += 1) {
      for (let x = 30; x < 170; x += 1) {
        const dx = x - 100
        const dy = y - 100
        if (dx * dx + dy * dy <= 60 * 60) m.setPixelColor(0x00000000, x, y)
      }
    }
    const c = cartaz.detectarCirculo(m)
    exigir(c, 'não achou o furo transparente')
    exigir(c.cx === 100 && c.cy === 100, 'centro errado: ' + JSON.stringify(c))
    exigir(Math.abs(c.raio - 61) <= 2, 'raio errado (esperado ~61): ' + c.raio)
  })

  await testar('detectarCirculo: devolve null quando não há buraco (moldura toda chapada)', async () => {
    const chapada = new Jimp({ width: 120, height: 120, color: 0x303030ff })
    exigir(cartaz.detectarCirculo(chapada) === null, 'devolveu círculo numa imagem sem buraco')
  })

  // ─── 🎨 A composição ───
  await testar('comporCartazProcurado: devolve um PNG do tamanho da moldura', async () => {
    const { buffer, imagem } = await cartazDosTestes(false)
    exigir(Buffer.isBuffer(buffer) && buffer.length > 1000, 'buffer PNG inválido')
    exigir(imagem.bitmap.width === 1024 && imagem.bitmap.height === 1536, 'tamanho errado')
    exigir(buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG', 'não é um PNG')
  })

  await testar('composição: o TÍTULO_CARTAZ é pintado na faixa escura de cima', async () => {
    const { imagem } = await cartazDosTestes(false)
    const cx = Math.round(imagem.bitmap.width / 2)
    const t = cartaz.CAIXA_TITULO
    // Os pixels dourados do título (OURO_TITULO) dentro da faixa escura.
    const n = contarCor(imagem, '#d9a520', cx - 260, t.y, cx + 260, t.y + t.altura)
    exigir(n > 200, 'o título não foi pintado na faixa (' + n + ' px)')
  })

  await testar('composição: NOME, ALCUNHA, CONTAGEM e "desde" no miolo de papel', async () => {
    const { imagem } = await cartazDosTestes(false)
    const t = cartaz.CAIXA_TEXTO
    // Tinta do nome (#2b1d10) e da alcunha (#8f2d1e) no miolo de papel.
    const nome = contarCor(imagem, I.TINTA, t.x, t.y, t.x + t.largura, t.y + 300)
    const alcunha = contarCor(imagem, I.FITA, t.x, t.y, t.x + t.largura, t.y + 300)
    exigir(nome > 300, 'o nome não foi pintado (' + nome + ' px)')
    exigir(alcunha > 100, 'a alcunha não foi pintada (' + alcunha + ' px)')
    // Tinta suave (#5c452c) = "desde" e rodapé, mais abaixo no papel.
    const suave = contarCor(imagem, I.TINTA_SUAVE, t.x, t.y + 300, t.x + t.largura, t.y + t.altura)
    exigir(suave > 100, 'o "desde"/rodapé não foi pintado (' + suave + ' px)')
  })

  await testar('composição: sem foto, o disco vira o círculo dourado (não fica branco)', async () => {
    const { imagem } = await cartazDosTestes(false)
    const moldura = await Jimp.read(cartaz.CAMINHO_MOLDURA)
    const c = cartaz.detectarCirculo(moldura)
    const px = (img, x, y) => { const i = (y * img.bitmap.width + x) * 4; return img.bitmap.data.slice(i, i + 3).join(',') }
    exigir(px(moldura, c.cx, c.cy) !== px(imagem, c.cx, c.cy), 'o disco ficou igual à moldura (não foi pintado)')
    const dourado = contarCor(imagem, I.OURO, c.cx - c.raio, c.cy - c.raio, c.cx + c.raio, c.cy + c.raio)
    exigir(dourado > 200, 'o anel dourado não foi desenhado (' + dourado + ' px)')
  })

  await testar('composição: a FOTO entra recortada em disco dentro do círculo', async () => {
    const { imagem } = await cartazDosTestes(true)
    const moldura = await Jimp.read(cartaz.CAMINHO_MOLDURA)
    const c = cartaz.detectarCirculo(moldura)
    const px = (img, x, y) => { const i = (y * img.bitmap.width + x) * 4; return [img.bitmap.data[i], img.bitmap.data[i + 1], img.bitmap.data[i + 2]] }
    const [r, , b] = px(imagem, c.cx, c.cy)
    // A foto sintética é AZUL (b >> r em todo o disco). O branco chapado da
    // moldura daria r = b = 255.
    exigir(b > r + 20, 'a foto não apareceu no centro (b deve >> r): ' + [r, b].join(','))
    // ⚠️ Fora do disco a moldura tem que continuar INTACTA: o recorte é
    // circular, não um quadrado colado no meio.
    const foraX = c.cx + c.raio + 12
    const [mr, mg, mb] = px(moldura, foraX, c.cy)
    const [fr, fg, fb] = px(imagem, foraX, c.cy)
    exigir(mr === fr && mg === fg && mb === fb, 'a moldura foi alterada FORA do círculo')
  })

  await testar('composição: nome absurdamente longo é cortado com reticências', async () => {
    const fonte = await loadFont(SANS_32_WHITE)
    const largura = cartaz.CAIXA_TEXTO.largura
    const enorme = 'Nome Gigante Que Nunca Vai Caber No Miolo Do Cartaz De Jeito Nenhum Mesmo Nem Com Corte'
    const imagem = await Jimp.read(await cartaz.comporCartazProcurado({ ...DADOS_CARTAZ, nome: enorme }))
    const pintado = contarCor(imagem, I.TINTA, cartaz.CAIXA_TEXTO.x, cartaz.CAIXA_TEXTO.y,
      cartaz.CAIXA_TEXTO.x + largura, cartaz.CAIXA_TEXTO.y + 200)
    exigir(pintado > 100, 'o nome cortado não foi pintado')
    const cortado = I.cortarParaCaber(fonte, enorme, largura)
    exigir(cortado.endsWith('...'), 'o corte não adicionou reticências: ' + cortado)
    exigir(I.medir(fonte, cortado) <= largura, 'o texto cortado ainda excede a caixa')
  })

  await testar('composição: emoji e caractere sem glifo não quebram o desenho', async () => {
    const buffer = await cartaz.comporCartazProcurado({
      ...DADOS_CARTAZ,
      nome: 'Sr. Emoji \u{1F680} 火',
      alcunha: 'Açaí \u{1F95D}'
    })
    const imagem = await Jimp.read(buffer)
    exigir(Buffer.isBuffer(buffer) && buffer.length > 1000, 'o cartaz quebrou com texto exótico')
    const t = cartaz.CAIXA_TEXTO
    exigir(contarCor(imagem, I.TINTA, t.x, t.y, t.x + t.largura, t.y + 200) > 50, 'o nome não foi pintado')
  })

  await testar('composição: a MESMA entrada gera sempre a MESMA imagem', async () => {
    const a = await cartaz.comporCartazProcurado(DADOS_CARTAZ)
    const b = await cartaz.comporCartazProcurado(DADOS_CARTAZ)
    exigir(Buffer.compare(a, b) === 0, 'duas composições iguais deram PNGs diferentes (Math.random no caminho?)')
  })

  await testar('composição: foto corrompida cai no disco dourado sem lançar', async () => {
    const imagem = await Jimp.read(await cartaz.comporCartazProcurado({ ...DADOS_CARTAZ, foto: Buffer.from('isso nao e uma imagem') }))
    const moldura = await Jimp.read(cartaz.CAMINHO_MOLDURA)
    const c = cartaz.detectarCirculo(moldura)
    const px = (img, x, y) => { const i = (y * img.bitmap.width + x) * 4; return img.bitmap.data.slice(i, i + 3).join(',') }
    exigir(px(moldura, c.cx, c.cy) !== px(imagem, c.cx, c.cy), 'o disco não foi pintado após a foto falhar')
  })

  await testar('miniaturaDoCartaz: devolve base64 de JPEG 64×64', async () => {
    const { buffer } = await cartazDosTestes(false)
    const base64 = await cartaz.miniaturaDoCartaz(buffer)
    exigir(typeof base64 === 'string' && base64.length > 100, 'miniatura vazia')
    const bytes = Buffer.from(base64, 'base64')
    exigir(bytes[0] === 0xff && bytes[1] === 0xd8, 'não é um JPEG')
    const img = await Jimp.read(bytes)
    exigir(img.bitmap.width === 64 && img.bitmap.height === 64, 'tamanho da miniatura errado')
  })

  // ─── 💬 O comando /procurado ───
  await testar('comando: fora de grupo avisa e não gera cartaz', async () => {
    definirRanking([LIDER_TESTE])
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_COMUM, { key: { remoteJid: JID_COMUM, id: 'z' } })
    const texto = textoUnico(enviadas)
    exigir(texto.includes('só funciona em grupos'), 'não avisou que é só em grupo: ' + texto)
    exigir(!imagemEnviada(enviadas), 'mandou imagem fora de grupo')
  })

  await testar('comando: grupo sem mensagens registradas avisa (sem cartaz)', async () => {
    definirRanking([])
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem())
    const texto = textoUnico(enviadas)
    exigir(texto.includes('silêncio') || texto.includes('Ninguém'), 'não avisou grupo vazio: ' + texto)
    exigir(!imagemEnviada(enviadas), 'mandou cartaz sem líder')
  })

  await testar('comando: envia o CARTAZ em imagem com legenda e miniatura', async () => {
    definirRanking([LIDER_TESTE])
    definirEstilos(new Map())
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem())
    const img = imagemEnviada(enviadas)
    exigir(img, 'não enviou imagem')
    exigir(Buffer.isBuffer(img.conteudo.image), 'a imagem não é um Buffer')
    exigir(img.conteudo.image[0] === 0x89, 'a imagem não é um PNG')
    exigir(typeof img.conteudo.jpegThumbnail === 'string', 'sem miniatura (jpegThumbnail)')
    exigir(img.conteudo.caption.includes('João da Silva'), 'legenda sem o nome: ' + img.conteudo.caption)
  })

  // 🔬 Injeta um gerador de cartaz leve para os testes que só olham os
  // DADOS passados ao desenho (sem pagar ~1s de Jimp por cenário).
  async function comCartazFalso (fn) {
    let recebidos = null
    comando._injetarCartaz(async (dados) => { recebidos = dados; return Buffer.from([0x89, 80, 78, 71]) })
    comando._injetarMiniatura(async () => 'b64')
    try { await fn(() => recebidos) } finally { comando._restaurarCartaz() }
  }

  await testar('comando: usa a alcunha e o nome CUSTOM do VIP quando existem', async () => {
    definirRanking([LIDER_TESTE])
    definirEstilos(new Map([[NUM_LIDER, { nome: 'NomeDoVip', alcunha: 'Punho de Zeus', cor: '' }]]))
    await comCartazFalso(async (dados) => {
      const { sock, enviadas } = criarSock()
      await comando.executar(sock, JID_GRUPO, mensagem())
      exigir(imagemEnviada(enviadas), 'não enviou imagem')
      const d = dados()
      exigir(d.alcunha === 'Punho de Zeus', 'não usou a alcunha custom: ' + d.alcunha)
      exigir(d.nome === 'NomeDoVip', 'não usou o nome custom: ' + d.nome)
      exigir(d.total === 1287, 'contagem errada: ' + d.total)
      exigir(d.palavra === 'mensagens', 'plural errado: ' + d.palavra)
      exigir(/^\d{2}\/\d{2}\/\d{4}$/.test(d.desde), 'data "desde" mal formatada: ' + d.desde)
    })
  })

  await testar('comando: SEM alcunha custom usa a PADRÃO do número (qualquer pessoa)', async () => {
    definirRanking([LIDER_TESTE])
    definirEstilos(new Map([[NUM_LIDER, { nome: 'João', cor: '' }]])) // VIP sem alcunha
    await comCartazFalso(async (dados) => {
      const { sock } = criarSock()
      await comando.executar(sock, JID_GRUPO, mensagem())
      exigir(dados().alcunha === alcunhas.alcunhaPadrao(NUM_LIDER), 'não usou a padrão: ' + dados().alcunha)
    })
  })

  await testar('comando: 1 mensagem usa o singular "mensagem"', async () => {
    definirRanking([{ usuario_id: NUM_LIDER, nome: 'Solitário', total: 1 }])
    definirEstilos(new Map())
    await comCartazFalso(async (dados) => {
      const { sock } = criarSock()
      await comando.executar(sock, JID_GRUPO, mensagem())
      exigir(dados().palavra === 'mensagem', 'plural errado: ' + dados().palavra)
    })
  })

  await testar('comando: banco de VIPs quebrado NÃO derruba o cartaz', async () => {
    definirRanking([LIDER_TESTE])
    estilosFalha = new Error('mongo em chamas')
    try {
      await comCartazFalso(async (dados) => {
        const { sock, enviadas } = criarSock()
        await comando.executar(sock, JID_GRUPO, mensagem())
        exigir(imagemEnviada(enviadas), 'a falha do banco de VIP derrubou o cartaz')
        exigir(dados().alcunha === alcunhas.alcunhaPadrao(NUM_LIDER), 'não caiu na alcunha padrão')
      })
    } finally {
      estilosFalha = null
    }
  })

  await testar('comando: quando a ARTE falha, responde o fallback em TEXTO', async () => {
    definirRanking([LIDER_TESTE])
    definirEstilos(new Map([[NUM_LIDER, { nome: 'NomeDoVip', alcunha: 'Punho de Zeus', cor: '' }]]))
    comando._injetarCartaz(async () => { throw new Error('moldura ausente') })
    try {
      const { sock, enviadas } = criarSock()
      await comando.executar(sock, JID_GRUPO, mensagem())
      const texto = textoUnico(enviadas)
      exigir(!imagemEnviada(enviadas), 'enviou imagem apesar da falha da arte')
      exigir(texto.includes('PROCURADO'), 'fallback sem o título: ' + texto)
      exigir(texto.includes('NomeDoVip'), 'fallback sem o nome: ' + texto)
      exigir(texto.includes('Punho de Zeus'), 'fallback sem a alcunha: ' + texto)
      exigir(texto.includes('1287'), 'fallback sem a contagem: ' + texto)
      exigir(/no topo desde: \d{2}\/\d{2}\/\d{4}/.test(texto), 'fallback sem a data: ' + texto)
    } finally {
      comando._restaurarCartaz()
    }
  })

  await testar('comando: quando o RANKING falha, avisa sem quebrar', async () => {
    rankingFalha = new Error('mongo caiu')
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem())
    rankingFalha = null
    const texto = textoUnico(enviadas)
    exigir(texto.includes('confundiram'), 'não avisou o erro do ranking: ' + texto)
    exigir(!imagemEnviada(enviadas), 'mandou imagem com o ranking quebrado')
  })

  await testar('comando: líder que SAIU do grupo é marcado na legenda', async () => {
    definirRanking([LIDER_TESTE])
    definirEstilos(new Map())
    const { sock, enviadas } = criarSock({
      groupMetadata: async () => ({ subject: 'Recinto', participants: [{ id: JID_COMUM + '@s.whatsapp.net' }] })
    })
    await comCartazFalso(async () => {
      await comando.executar(sock, JID_GRUPO, mensagem())
      const img = imagemEnviada(enviadas)
      exigir(img.conteudo.caption.includes('saiu do grupo'), 'legenda não marcou a saída: ' + img.conteudo.caption)
    })
  })

  await testar('comando: sem metadados do grupo NÃO marca "saiu" (rede não pune)', async () => {
    definirRanking([LIDER_TESTE])
    definirEstilos(new Map())
    const { sock, enviadas } = criarSock({ groupMetadata: async () => { throw new Error('sem rede') } })
    await comCartazFalso(async () => {
      await comando.executar(sock, JID_GRUPO, mensagem())
      const img = imagemEnviada(enviadas)
      exigir(!img.conteudo.caption.includes('saiu do grupo'), 'marcou "saiu" só por falta de rede')
    })
  })
  await testar('comando: sem metadados do grupo NÃO marca "saiu" (rede não pune)', async () => {
    definirRanking([LIDER_TESTE])
    definirEstilos(new Map())
    const { sock, enviadas } = criarSock({ groupMetadata: async () => { throw new Error('sem rede') } })
    await comCartazFalso(async () => {
      await comando.executar(sock, JID_GRUPO, mensagem())
      const img = imagemEnviada(enviadas)
      exigir(!img.conteudo.caption.includes('saiu do grupo'), 'marcou "saiu" só por falta de rede')
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // 🪪 A MESMA PESSOA EM DOIS DOCUMENTOS (LID + telefone) — enquanto o banco
  // não é migrado (scripts/migrar-ranking-lid.js), o líder pode ter um
  // documento sob o LID e outro sob o telefone. O /procurado precisa
  // AGRUPAR (mesma pessoa, contagem somada) e usar o NÚMERO REAL para o VIP.
  // ═══════════════════════════════════════════════════════════════════
  const LID_LIDER = '175952680210489'
  const TELEFONE_LIDER = '554184062975'
  const PARTICIPANTES_LID = [{ id: LID_LIDER + '@lid', phoneNumber: TELEFONE_LIDER + '@s.whatsapp.net' }]

  await testar('LID: LID + telefone da MESMA pessoa viram UM cartaz com a SOMA', async () => {
    definirRanking([
      { usuario_id: LID_LIDER, nome: 'Nome do Banco', total: 900 },
      { usuario_id: TELEFONE_LIDER, nome: 'Nome do Banco', total: 387 }
    ])
    definirEstilos(new Map([[TELEFONE_LIDER, { nome: 'NomeDoVip', alcunha: 'Punho de Zeus', cor: '' }]]))
    await comCartazFalso(async (dados) => {
      const { sock, enviadas } = criarSock({
        groupMetadata: async () => ({ subject: 'Recinto LID', participants: PARTICIPANTES_LID })
      })
      await comando.executar(sock, JID_GRUPO, mensagem())
      const img = imagemEnviada(enviadas)
      exigir(img, 'não enviou imagem')
      const d = dados()
      exigir(d.total === 1287, 'os totais não foram somados: ' + d.total)
      exigir(d.nome === 'NomeDoVip', 'o VIP do número real não foi usado: ' + d.nome)
      exigir(d.alcunha === 'Punho de Zeus', 'não usou a alcunha custom: ' + d.alcunha)
      exigir(!img.conteudo.caption.includes('saiu do grupo'), 'marcou "saiu" para quem está no grupo')
    })
  })

  await testar('LID: o ranking é buscado com o limite de AGRUPAMENTO, não com 1', async () => {
    definirRanking([LIDER_TESTE])
    definirEstilos(new Map())
    await comCartazFalso(async () => {
      const { sock } = criarSock()
      await comando.executar(sock, JID_GRUPO, mensagem())
      exigir(limitePedido > 1, 'o /procurado pediu só ' + limitePedido + ' linha(s) e perderia o documento do telefone')
    })
  })

  await testar('metadados do grupo são lidos UMA vez (nada de consulta por linha)', async () => {
    definirRanking([
      { usuario_id: LID_LIDER, nome: 'A', total: 10 },
      { usuario_id: TELEFONE_LIDER, nome: 'A', total: 5 },
      { usuario_id: '5511999990000', nome: 'B', total: 1 }
    ])
    definirEstilos(new Map())
    let chamadas = 0
    await comCartazFalso(async () => {
      const { sock } = criarSock({
        groupMetadata: async () => { chamadas += 1; return { subject: 'Recinto LID', participants: PARTICIPANTES_LID } }
      })
      await comando.executar(sock, JID_GRUPO, mensagem())
    })
    exigir(chamadas === 1, 'os metadados foram lidos ' + chamadas + ' vez(es)')
  })

  await testar('banco de VIPs é consultado pelo NÚMERO REAL do líder agrupado', async () => {
    definirRanking([{ usuario_id: LID_LIDER, nome: 'Fulano', total: 1287 }])
    definirEstilos(new Map())
    const pedidos = []
    vip.obterEstilosVip = async (numeros) => { pedidos.push([...(numeros || [])]); return new Map() }
    try {
      await comCartazFalso(async () => {
        const { sock } = criarSock({
          groupMetadata: async () => ({ subject: 'Recinto LID', participants: PARTICIPANTES_LID })
        })
        await comando.executar(sock, JID_GRUPO, mensagem())
      })
    } finally {
      vip.obterEstilosVip = async () => estilosFake
    }
    const pedido = pedidos[pedidos.length - 1] || []
    exigir(pedido.includes(TELEFONE_LIDER), 'não consultou o VIP pelo número real: ' + JSON.stringify(pedido))
    exigir(!pedido.includes(LID_LIDER), 'consultou o VIP pelo LID cru: ' + JSON.stringify(pedido))
  })


  console.log('')
  console.log(reprovadas === 0
    ? '✅ Todos os ' + total + ' testes de /procurado passaram.'
    : '❌ ' + reprovadas + ' de ' + total + ' falharam.')
  process.exitCode = reprovadas === 0 ? 0 : 1
}

main().catch((err) => { console.error('💥 erro fatal no teste:', err); process.exitCode = 1 })




