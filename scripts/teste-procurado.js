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
// texto longo cortado, escada de tamanho do NOME, título dentro da faixa e
// centralizado, rodapé legível, linha "última mensagem" (quando o ranking
// tem carimbo de tempo e quando não tem), formatação da data no fuso de São
// Paulo, miniatura e o fallback em texto quando a arte falha.
// Uso: node scripts/teste-procurado.js
// ============================================

process.env.MONGODB_URI = ''

const { Jimp, JimpMime, loadFont } = require('jimp')
const { SANS_32_WHITE, SANS_64_WHITE } = require('jimp/fonts')

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

// 📏 As FAIXAS de uma cor na região (cada faixa = uma linha de texto).
// Separa por linhas com mais de `tolerancia` px SEM a cor no meio: o valor é
// generoso de propósito (o espaço entre palavras de uma mesma linha tem ~20 px
// e não pode virar "linha nova"), mas menor que o respiro entre as linhas do
// miolo (≈ 44 px), que é o que separa uma linha da outra.
function faixasDeCor (imagem, hex, x0, y0, x1, y1, tolerancia = 25) {
  const n = parseInt(hex.replace('#', ''), 16)
  const alvo = [n >> 16, (n >> 8) & 0xff, n & 0xff]
  const d = imagem.bitmap.data
  const W = imagem.bitmap.width
  const achadas = []
  let atual = null
  for (let y = Math.max(0, y0); y < Math.min(imagem.bitmap.height, y1); y += 1) {
    let minX = Infinity
    let maxX = -Infinity
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x += 1) {
      const j = (y * W + x) * 4
      if (d[j] === alvo[0] && d[j + 1] === alvo[1] && d[j + 2] === alvo[2]) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
    if (maxX < minX) continue // linha sem a cor
    if (atual && y - atual.y1 <= tolerancia) {
      atual.y1 = y
      atual.x0 = Math.min(atual.x0, minX)
      atual.x1 = Math.max(atual.x1, maxX)
    } else {
      atual = { y0: y, y1: y, x0: minX, x1: maxX }
      achadas.push(atual)
    }
  }
  return achadas.map((f) => ({
    x0: f.x0, x1: f.x1, y0: f.y0, y1: f.y1,
    altura: f.y1 - f.y0 + 1,
    largura: f.x1 - f.x0 + 1
  }))
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

// 📏 Bandas de uma cor que têm pelo menos `minimo` pixels NA MESMA LINHA
// (o filete tem 484 px de uma vez; o granulado da moldura tem 1). É o que
// separa o filete de verdade do barulho de fundo da moldura — a tolerância de
// linhas do `faixasDeCor` não daria conta do losango e dos pixels soltos.
// Uma linha fora do mínimo CORTA a banda (o losango fica de fora).
function faixasRobustas (imagem, hex, x0, y0, x1, y1, minimo) {
  const n = parseInt(hex.replace('#', ''), 16)
  const alvo = [n >> 16, (n >> 8) & 0xff, n & 0xff]
  const d = imagem.bitmap.data
  const W = imagem.bitmap.width
  const bandas = []
  let atual = null
  for (let y = Math.max(0, y0); y < Math.min(imagem.bitmap.height, y1); y += 1) {
    let minX = Infinity
    let maxX = -Infinity
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x += 1) {
      const j = (y * W + x) * 4
      if (d[j] === alvo[0] && d[j + 1] === alvo[1] && d[j + 2] === alvo[2]) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
    const larga = maxX - minX + 1
    if (larga < minimo) {
      if (atual) { bandas.push(atual); atual = null }
      continue
    }
    if (!atual) atual = { y0: y, y1: y, x0: minX, x1: maxX }
    else { atual.y1 = y; atual.x0 = Math.min(atual.x0, minX); atual.x1 = Math.max(atual.x1, maxX) }
  }
  if (atual) bandas.push(atual)
  return bandas.map((b) => ({
    x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1,
    altura: b.y1 - b.y0 + 1,
    largura: b.x1 - b.x0 + 1
  }))
}

// 📐 Altura de tinta da linha que o `escolher` devolveu (tamanho real na tela).
function alturaDaTintaDe (escolhido) {
  return I.alturaDaTinta(escolhido.font, escolhido.texto, 0, escolhido.escala)
}

// ─── 🎨 Dados fixos do cartaz usado nos testes ───
const LIDER_TESTE = { usuario_id: NUM_LIDER, nome: 'João da Silva', total: 1287 }
// 📅 Carimbo de tempo fixo (2026-01-01 12:00 UTC = 09:00 em São Paulo) para
// os testes da data: a data só é previsível se o fuso estiver certo.
const CARIMBO_1 = Date.parse('2026-01-01T12:00:00Z')
const CARIMBO_ANTIGO = Date.parse('2025-12-31T12:00:00Z')
const DATA_1 = '01/01/2026'
const DATA_ANTIGA = '31/12/2025'
const DADOS_CARTAZ = {
  nome: 'João da Silva',
  alcunha: 'Devorador de Deuses',
  total: 1287,
  palavra: 'mensagens',
  desde: '30/09/2026',
  ultimaMensagem: '30/09/2026',
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

  await testar('composição: NOME, ALCUNHA, CONTAGEM e rodapé no miolo de papel', async () => {
    const { imagem } = await cartazDosTestes(false)
    const t = cartaz.CAIXA_TEXTO
    // Tinta do nome (#2b1d10) e da alcunha (vermelho escuro) no miolo.
    const nome = contarCor(imagem, I.TINTA, t.x, t.y, t.x + t.largura, t.y + 300)
    const alcunha = contarCor(imagem, I.FITA, t.x, t.y, t.x + t.largura, t.y + 300)
    exigir(nome > 300, 'o nome não foi pintado (' + nome + ' px)')
    exigir(alcunha > 100, 'a alcunha não foi pintada (' + alcunha + ' px)')
    // Tinta suave (#5c452c) só nos FILETES agora. A DATA e o rodapé NÃO podem
    // mais usar essa cor: era ela que sumia no papel envelhecido.
    const suave = contarCor(imagem, I.TINTA_SUAVE, t.x, t.y, t.x + t.largura, t.y + t.altura)
    exigir(suave > 100, 'os filetes não foram pintados (' + suave + ' px)')
    // 🔇 Regressão de um bug SILENCIOSO: os dois filetes desapareciam porque o
    // cursor do layout é fracionário (gap = sobra / nº de linhas) e um índice
    // fracionário em TypedArray é ignorado sem erro nenhum. Aqui exigimos as
    // DUAS linhas de filete, com 3 px de altura e mais de 400 px de largura.
    const filetes = faixasRobustas(imagem, I.TINTA_SUAVE, t.x, t.y, t.x + t.largura, I.FUNDO_MIOLO, 400)
    exigir(filetes.length === 2, 'esperava 2 filetes, achei ' + filetes.length + ': ' + JSON.stringify(filetes))
    for (const f of filetes) {
      exigir(f.altura === 3, 'o filete não tem 3 px de espessura: ' + f.altura)
      exigir(f.largura > 400, 'o filete saiu curto demais: ' + f.largura)
      exigir(f.x0 >= t.x + 150 && f.x1 <= t.x + t.largura - 150, 'o filete saiu da margem: ' + JSON.stringify(f))
    }
  })

  await testar('composição: o TÍTULO fica DENTRO da faixa escura e centralizado', async () => {
    const { imagem } = await cartazDosTestes(false)
    const cx = Math.round(imagem.bitmap.width / 2)
    const t = cartaz.CAIXA_TITULO
    // O ouro do título (#d9a520) — o filete da faixa usa OURO (#c9a227), então
    // a cor separa o texto do ornamento.
    const faixas = faixasDeCor(imagem, '#d9a520', t.x, t.y, t.x + t.largura, t.y + t.altura)
    exigir(faixas.length === 1, 'o título não virou uma linha só: ' + faixas.length + ' faixa(s)')
    const r = faixas[0]
    exigir(r.y0 >= t.y && r.y1 < t.y + t.altura, 'o título vazou da faixa: ' + JSON.stringify(r))
    exigir(r.x0 >= t.x && r.x1 <= t.x + t.largura, 'o título estourou a largura da faixa: ' + JSON.stringify(r))
    const meio = (r.x0 + r.x1) / 2
    exigir(Math.abs(meio - cx) <= 2, 'o título não está centralizado (meio ' + meio + ', centro ' + cx + ')')
    // A 1,5× o título é bem maior do que a fonte de 64 px crua.
    exigir(r.altura >= 60, 'o título continua pequeno (' + r.altura + ' px de tinta)')
  })

  await testar('composição: o NOME é a maior linha do miolo e cabe na caixa', async () => {
    const { imagem } = await cartazDosTestes(false)
    const t = cartaz.CAIXA_TEXTO
    const faixas = faixasDeCor(imagem, I.TINTA, t.x, t.y, t.x + t.largura, I.FUNDO_MIOLO)
    exigir(faixas.length >= 4, 'faltaram linhas de tinta no miolo: ' + faixas.length)
    const nome = faixas[0]
    // O nome vem no topo da escada (1,5×) — 72 px de tinta contra os ~30 px
    // das linhas de baixo. Era essa a queixa: nome miúdo, cartaz vazio.
    exigir(nome.altura >= 60, 'o nome continua pequeno: ' + nome.altura + ' px de tinta')
    // A primeira linha de tinta começa logo abaixo do respiro do círculo (a
    // folga de 2 px cobre a borda suavizada da amostragem em escala).
    exigir(nome.y0 <= t.y + I.TOPO_MIOLO + 4, 'o nome não começa colado no respiro do círculo: ' + nome.y0)
    exigir(nome.x0 >= t.x && nome.x1 <= t.x + t.largura, 'o nome estourou a caixa: ' + JSON.stringify(nome))
    // Respiro uniforme: nenhuma das linhas encosta na outra.
    for (let i = 1; i < faixas.length; i += 1) {
      const folga = faixas[i].y0 - faixas[i - 1].y1 - 1
      exigir(folga >= 20, 'as linhas se colaram (folga de ' + folga + ' px antes da ' + (i + 1) + 'ª)')
    }
  })

  await testar('composição: a linha "última mensagem" SÓ existe com a data do ranking', async () => {
    const t = cartaz.CAIXA_TEXTO
    const comData = faixasDeCor(
      (await cartazDosTestes(false)).imagem, I.TINTA, t.x, t.y, t.x + t.largura, I.FUNDO_MIOLO
    )
    const semData = faixasDeCor(
      await Jimp.read(await cartaz.comporCartazProcurado({ ...DADOS_CARTAZ, ultimaMensagem: null })),
      I.TINTA, t.x, t.y, t.x + t.largura, I.FUNDO_MIOLO
    )
    // Com a data são 5 linhas de tinta (nome, alcunha, contagem, última, rodapé);
    // sem ela, uma a menos. A contagem de faixas é a prova de que a linha
    // entra e sai junto com o dado — sem depender de ler glifo a glifo.
    exigir(comData.length === semData.length + 1,
      'a linha da última mensagem não entrou/saiu: ' + comData.length + ' com / ' + semData.length + ' sem')
    // Com a data, a penúltima linha (antes do rodapé) é a da última mensagem.
    exigir(comData[comData.length - 2].altura >= 20, 'a linha da última mensagem saiu pequena demais')
  })

  await testar('composição: o RODAPÉ é tinta escura e legível (não é a tinta lavada)', async () => {
    const t = cartaz.CAIXA_TEXTO
    const { imagem } = await cartazDosTestes(false)
    const ultima = faixasDeCor(imagem, I.TINTA, t.x, t.y, t.x + t.largura, I.FUNDO_MIOLO)
    const rodape = ultima[ultima.length - 1]
    // A tinta antiga do rodapé (#5c452c a 16 px) sumia no papel envelhecido:
    // 15 px de tinta e contraste ~2,7. Agora é TINTA cheia com 25 px.
    exigir(rodape.altura >= 20, 'o rodapé continua pequeno: ' + rodape.altura + ' px de tinta')
    const tintaCheia = contarCor(imagem, I.TINTA, t.x, rodape.y0 - 2, t.x + t.largura, rodape.y1 + 2)
    const suaveNoRodape = contarCor(imagem, I.TINTA_SUAVE, t.x, rodape.y0 - 2, t.x + t.largura, rodape.y1 + 2)
    exigir(tintaCheia > 600, 'o rodapé não está na tinta escura (' + tintaCheia + ' px)')
    // Tolerância de 10 px: a moldura tem granulado e um pixel dela pode cair
    // por acaso exatamente na cor da tinta lavada.
    exigir(suaveNoRodape <= 10, 'o rodapé ainda usa a tinta lavada (' + suaveNoRodape + ' px)')
    exigir(rodape.y1 <= I.FUNDO_MIOLO, 'o rodapé desceu sobre o ornamento: ' + rodape.y1)
    // E o miolo inteiro fica acima da moldura de baixo: abaixo disso, o pixel
    // tem que ser a moldura INTACTA (nada de tinta vazando na decoração).
    const moldura = await Jimp.read(cartaz.CAMINHO_MOLDURA)
    const px = (img, x, y) => { const i = (y * img.bitmap.width + x) * 4; return img.bitmap.data.slice(i, i + 3).join(',') }
    for (const y of [I.FUNDO_MIOLO + 1, I.FUNDO_MIOLO + 25, 1445, 1500]) {
      for (const x of [130, 511, 890]) {
        exigir(px(moldura, x, y) === px(imagem, x, y), 'a moldura foi alterada em (' + x + ',' + y + ')')
      }
    }
  })

  await testar('escolher: o maior que cabe inteiro vence; ninguém cabe vira reticências', async () => {
    const f64 = await loadFont(SANS_64_WHITE)
    const f32 = await loadFont(SANS_32_WHITE)
    // A MESMA escada que o `desenharTexto` monta.
    const candidatos = I.ESCADARIA_NOME.map((escala) => ({ font: f64, escala }))
      .concat([{ font: f32, escala: 1.4 }, { font: f32, escala: 1.2 }])
    const largura = cartaz.CAIXA_TEXTO.largura
    const conferir = (rotulo, nome) => {
      const escolhido = I.escolher(candidatos, nome, largura)
      exigir(escolhido, 'nada foi escolhido para ' + rotulo)
      exigir(I.medir(escolhido.font, escolhido.texto, escolhido.escala) <= largura,
        rotulo + ' estourou a caixa: ' + I.medir(escolhido.font, escolhido.texto, escolhido.escala))
      exigir(alturaDaTintaDe(escolhido) >= 25, rotulo + ' saiu pequeno demais')
      return escolhido
    }
    const curto = conferir('nome curto', 'João da Silva')
    exigir(curto.escala === 1.5 && !curto.cortado, 'o nome curto deveria ficar no topo da escada: ' + curto.escala)
    // Nome de 26 letras: cabe INTEIRO num degrau menor — vale mais que meio
    // nome gigante com reticências.
    const medio = conferir('nome de 26 letras', 'Maria Fernanda de Oliveira')
    exigir(!medio.cortado, 'o nome de 26 letras foi cortado à toa: ' + medio.texto)
    // Ninguém cabe: o maior que ainda mostra MIN_VISIVEL_NOME letras.
    const enorme = conferir('nome gigante', 'Ana Beatriz Cavalcanti do Nascimento Albuquerque de Jesus')
    exigir(enorme.cortado, 'o nome gigante não foi cortado: ' + enorme.texto)
    exigir(enorme.texto.endsWith('...'), 'sem reticências: ' + enorme.texto)
    exigir(enorme.texto.replace(/\.\.\.$/, '').length >= I.MIN_VISIVEL_NOME,
      'o corte escondeu o nome: ' + enorme.texto)
    exigir(I.escolher(candidatos, '', largura) === null, 'texto vazio não devolve escolha')
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

  await testar('comando: o CARTAZ recebe a data real da ÚLTIMA MENSAGEM do líder', async () => {
    definirRanking([{ usuario_id: NUM_LIDER, nome: 'Fulano', total: 1287, ultimaMensagem: CARIMBO_1 }])
    definirEstilos(new Map())
    await comCartazFalso(async (dados) => {
      const { sock } = criarSock()
      await comando.executar(sock, JID_GRUPO, mensagem())
      const d = dados()
      exigir(d.ultimaMensagem === DATA_1, 'a data da última mensagem não é a do ranking: ' + d.ultimaMensagem)
      // O "desde" continua no payload (o comando usa no fallback em texto),
      // mas o cartaz não desenha mais essa linha.
      exigir(/^\d{2}\/\d{2}\/\d{4}$/.test(d.desde), 'data "desde" mal formatada: ' + d.desde)
    })
  })

  await testar('comando: ranking SEM carimbo de tempo manda null (cartaz sai sem a linha)', async () => {
    // Documento antigo: o `ultimaMensagem` não existe no banco.
    definirRanking([{ usuario_id: NUM_LIDER, nome: 'Fulano', total: 1287 }])
    definirEstilos(new Map())
    await comCartazFalso(async (dados) => {
      const { sock } = criarSock()
      await comando.executar(sock, JID_GRUPO, mensagem())
      const d = dados()
      exigir(d.ultimaMensagem === null, 'inventou uma data sem carimbo de tempo: ' + d.ultimaMensagem)
    })
  })

  await testar('dataDaUltimaMensagem: data no fuso de São Paulo (e null sem carimbo)', async () => {
    const f = comando.__internos.dataDaUltimaMensagem
    exigir(f(CARIMBO_1) === DATA_1, 'não formatou a data: ' + f(CARIMBO_1))
    exigir(f(CARIMBO_ANTIGO) === DATA_ANTIGA, 'virou o dia errado: ' + f(CARIMBO_ANTIGO))
    // 02:00 UTC do dia 2 AINDA é o dia 1 em São Paulo (UTC-3): sem o fuso,
    // o cartaz mostraria a data de amanhã para quem mandou de madrugada.
    const madrugada = Date.parse('2026-01-02T02:00:00Z')
    exigir(f(madrugada) === DATA_1, 'ignorou o fuso de São Paulo: ' + f(madrugada))
    for (const ruim of [0, null, undefined, NaN, 'ontem', -5, {}]) {
      exigir(f(ruim) === null, 'aceitou um carimbo inválido (' + JSON.stringify(ruim) + '): ' + f(ruim))
    }
  })

  await testar('respostaEmTexto (fallback): a última mensagem só sai com data', async () => {
    const r = comando.__internos.respostaEmTexto
    const base = { nome: 'A', alcunha: 'B', total: 1, palavra: 'mensagem', desde: '30/09/2026', saiu: false }
    const comData = r({ ...base, ultimaMensagem: DATA_1 })
    exigir(comData.includes('última mensagem: ' + DATA_1), 'fallback sem a data: ' + comData)
    const semData = r({ ...base, ultimaMensagem: null })
    exigir(!semData.includes('última mensagem'), 'fallback inventou a data: ' + semData)
    exigir(/no topo desde: \d{2}\/\d{2}\/\d{4}/.test(semData), 'fallback perdeu o "desde": ' + semData)
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
      // A mesma pessoa em dois documentos: a data válida é a MAIS NOVA entre
      // os dois (é o que o `agruparPorNumero` promete).
      { usuario_id: LID_LIDER, nome: 'Nome do Banco', total: 900, ultimaMensagem: CARIMBO_ANTIGO },
      { usuario_id: TELEFONE_LIDER, nome: 'Nome do Banco', total: 387, ultimaMensagem: CARIMBO_1 }
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
      exigir(d.ultimaMensagem === DATA_1, 'não valeu a data mais nova dos dois documentos: ' + d.ultimaMensagem)
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




