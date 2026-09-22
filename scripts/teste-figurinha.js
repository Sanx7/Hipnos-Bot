// ============================================
// 🧪 TESTE OFFLINE do /figurinha (sem WhatsApp, sem rede)
// ============================================
// Gera as mídias de teste com o ffmpeg EMBUTIDO do projeto (nada de
// downloads) e roda o comando de ponta a ponta com um `sock` fake,
// interceptando `downloadContentFromMessage` por um stub.
//
// Cobre:
//   PARTE 1 — captura da mídia (o bug do "só reply" não pode existir aqui):
//     imagem citada (reply), imagem DIRETA na legenda, prioridade da direta,
//     mídia encapsulada (view-once/temporária) e ausência de imagem;
//   PARTE 2 — pipeline real do encaixe (ffmpeg):
//     quadrada (sem padding), retrato (padding LATERAL transparente),
//     paisagem (padding TOPO/BASE transparente), vídeo → webp animado,
//     EXIF do pack injetado (mesmo método do /s) e limpeza dos temporários;
//   PARTE 3 — erros/limites amigáveis:
//     mídia vazia e arquivo acima de 25 MB.
//
// Uso (na raiz do projeto):  node scripts/teste-figurinha.js
// ============================================

const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const { extrairTextoComando } = require('../dados/texto-comando')
const { extrairFramesAnimados } = require('../comandos/menu-fig/webp-animado')
// 🔀 O /s (modo CROP) é carregado aqui SÓ para o teste de PRECEDÊNCIA de
// aliases: os dois comandos irmãos não podem anunciar o mesmo apelido.
// ⚠️ Nome `comandoS` de propósito: dentro do main() existe uma variável local
// `sticker` (o sticker enviado em cada cenário) que sombrearia este require.
const comandoS = require('../comandos/menu-fig/sticker')

const LADO = 512
const GRUPO = '12036@g.us'
const AUTOR = '5511999999999@s.whatsapp.net'

const binFfmpeg = (() => {
  try {
    return require('@ffmpeg-installer/ffmpeg').path
  } catch (err) {
    return 'ffmpeg'
  }
})()

const rodar = (args, timeoutMs = 120000) => new Promise((resolver, rejeitar) => {
  execFile(binFfmpeg, args, { windowsHide: true, timeout: timeoutMs }, (erro, saida, errSaida) => {
    if (erro) rejeitar(Object.assign(erro, { saida: (errSaida || '').toString().trim() }))
    else resolver((saida || '') + (errSaida || ''))
  })
})

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-figurinha-'))

// ── 📥 Stub do download da Baileys (nada de rede) ──
// `modoFalha = true` interrompe logo após a captura (testa qual nó seria
// baixado); `bufferAtual` é o conteúdo entregue no fluxo normal.
const downloads = []
let modoFalha = false
let bufferAtual = null
const baixarMidiaTeste = async (no, tipo) => {
  downloads.push({ tipo, no })
  if (modoFalha) throw new Error('Interrupção controlada do teste de captura')
  return {
    async *[Symbol.asyncIterator]() {
      if (bufferAtual && bufferAtual.length) yield bufferAtual
    }
  }
}

// ── 📦 Carrega o comando com o stub injetado (mesma técnica do
//    teste-sticker-captura.js: a Baileys pode expor namespace imutável) ──
const baileys = require('@whiskeysockets/baileys')
const caminhoComando = require.resolve('../comandos/menu-fig/figurinha')
const requireComando = createRequire(caminhoComando)
const moduloComando = { exports: {} }
const carregar = vm.runInThisContext(
  '(function(require, module, exports, __filename, __dirname) {\n' + fs.readFileSync(caminhoComando, 'utf8') + '\n})',
  { filename: caminhoComando }
)
carregar(nome => nome === '@whiskeysockets/baileys'
  ? { ...baileys, downloadContentFromMessage: baixarMidiaTeste }
  : requireComando(nome), moduloComando, moduloComando.exports, caminhoComando, path.dirname(caminhoComando))
const figurinha = moduloComando.exports

// ── 🧾 Contadores ──
let ok = 0
let falhou = 0
function checar(rotulo, condicao, detalhe) {
  if (condicao) { ok += 1; console.log('✅', rotulo) } else {
    falhou += 1
    console.log('❌', rotulo, detalhe === undefined ? '' : `→ ${detalhe}`)
  }
}
// ── 🖼️ Geração das mídias de teste (ffmpeg embutido — nada de rede) ──
// `metade` pinta METADE da imagem com outra cor (topo/base no retrato,
// esquerda/direita na paisagem) para provar que NADA foi cortado.
async function gerarImagem (nome, size, cor, { metade, corMetade } = {}) {
  const destino = path.join(tmp, nome)
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${cor}:s=${size}`]
  if (metade) {
    const [largura, altura] = size.split('x').map(Number)
    const caixa = largura >= altura
      ? `drawbox=x=${largura / 2}:y=0:w=${largura / 2}:h=${altura}:color=${corMetade}:t=fill`
      : `drawbox=x=0:y=${altura / 2}:w=${largura}:h=${altura / 2}:color=${corMetade}:t=fill`
    args.push('-vf', caixa)
  }
  args.push('-frames:v', '1', destino)
  await rodar(args)
  return { nome, caminho: destino, buffer: fs.readFileSync(destino) }
}

async function gerarVideo (nome, size, cor, duracao = 2) {
  const destino = path.join(tmp, nome)
  await rodar(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', `color=c=${cor}:s=${size}:d=${duracao}:r=30`, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', destino])
  return { nome, caminho: destino, buffer: fs.readFileSync(destino) }
}

// ── 🔎 Leitura dos pixels do webp ENVIADO ──
// Estático: o ffmpeg 4.2 embutido decodifica webp estático direto p/ RGBA.
// Animado:  o ffmpeg NÃO decodifica webp animado (limitação documentada em
//           webp-animado.js) → extrai os frames com o anim_dump da libwebp,
//           exatamente como o módulo do projeto faz.
function montarLeitor (dados) {
  const px = (x, y) => {
    const i = (y * LADO + x) * 4
    return { r: dados[i], g: dados[i + 1], b: dados[i + 2], a: dados[i + 3] }
  }
  return {
    px,
    ehTransparente: (x, y) => px(x, y).a === 0,
    ehOpaco: (x, y) => px(x, y).a > 200
  }
}

async function pixelsDeWebpEstatico (buffer, rotulo) {
  const caminho = path.join(tmp, `pix-${rotulo}.webp`)
  const rgba = path.join(tmp, `pix-${rotulo}.rgba`)
  fs.writeFileSync(caminho, buffer)
  await rodar(['-y', '-hide_banner', '-loglevel', 'error', '-i', caminho, '-pix_fmt', 'rgba', '-f', 'rawvideo', rgba])
  const dados = fs.readFileSync(rgba)
  if (dados.length !== LADO * LADO * 4) throw new Error(`webp não saiu ${LADO}x${LADO} (${dados.length} bytes RGBA)`)
  return montarLeitor(dados)
}

async function pixelsDoPrimeiroFrameAnimado (buffer, rotulo) {
  const caminho = path.join(tmp, `anim-${rotulo}.webp`)
  fs.writeFileSync(caminho, buffer)
  const frames = await extrairFramesAnimados(caminho, path.join(tmp, `frames-${rotulo}`), 'f_')
  const rgba = path.join(tmp, `anim-${rotulo}.rgba`)
  await rodar(['-y', '-hide_banner', '-loglevel', 'error', '-i', frames.primeiro, '-pix_fmt', 'rgba', '-f', 'rawvideo', rgba])
  const dados = fs.readFileSync(rgba)
  return { ...montarLeitor(dados), quantidadeFrames: frames.quantidade }
}

// 🎨 Comparações tolerantes (a conversão p/ yuv/VP8 mexe nos canais)
const ehVermelho = (p) => p.r > 150 && p.g < 110 && p.b < 110
const ehVerde = (p) => p.g > 150 && p.r < 110 && p.b < 110

function contarTemporarios () {
  return fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('figurinha-')).length
}

// ── 📨 Sock fake: registra o que o comando envia ──
let enviados = []
const sockFake = {
  async sendMessage (jid, conteudo) {
    enviados.push({ jid, conteudo, texto: conteudo?.text || '', sticker: conteudo?.sticker || null })
    return {}
  }
}
const ultimo = () => enviados.at(-1)

// 🎬 O nó é de vídeo? A legenda/quote precisam usar o CAMPO certo da
// mensagem (imageMessage × videoMessage) — senão o comando enxerga o tipo
// errado e cai no caminho de imagem.
const ehNoDeVideo = (no) => /^video\//i.test(String(no?.mimetype || '')) || typeof no?.seconds === 'number'
const campoDoNo = (no) => (ehNoDeVideo(no) ? 'videoMessage' : 'imageMessage')

const msgDireta = (no, caption = '/figurinha') => ({ [campoDoNo(no)]: { ...no, caption } })
const msgCitando = (no, caption = '/figurinha') => ({
  extendedTextMessage: { text: caption, contextInfo: { quotedMessage: { [campoDoNo(no)]: { ...no } } } }
})

// 🔎 O download recebido é do nó CERTO? Compara o marcador `mediaKey` de
// cada cenário (a legenda é anexada ao nó ao entrar na mensagem, então
// identidade de objeto não serve como prova).
const baixou = (r, tipo, marcador) =>
  r.envios.length === 1 && r.envios[0].tipo === tipo && r.envios[0].no?.mediaKey === marcador

// Roda o comando com um conteúdo e devolve o que foi baixado/enviado
async function rodarComando (conteudo) {
  enviados = []
  downloads.length = 0
  const msg = { key: { remoteJid: GRUPO, participant: AUTOR }, message: conteudo, pushName: 'Teste' }
  await figurinha.executar(sockFake, GRUPO, msg, extrairTextoComando(msg))
  return { mensagens: enviados, envios: downloads }
}

// ── 🐣 Preparação das mídias (uma vez só) ──
// 🎨 Cores com HEX EXPLÍCITO: o `green` do ffmpeg é o verde ESCURO 0x008000
// (canal G = 127), que não passa nos limiares de comparação de cor abaixo.
const COR_A = '0xff0000' // vermelho puro
const COR_B = '0x00ff00' // verde puro

async function prepararMidias () {
  return {
    quadrada: await gerarImagem('quadrada.jpg', '512x512', COR_A),
    retrato: await gerarImagem('retrato.jpg', '300x600', COR_A, { metade: true, corMetade: COR_B }),
    paisagem: await gerarImagem('paisagem.jpg', '600x300', COR_A, { metade: true, corMetade: COR_B }),
    videoRetrato: await gerarVideo('video-retrato.mp4', '300x600', COR_A)
  }
}

// ============================================
// 🏃 MAIN — PARTE 1: captura da mídia (sem conversão)
// ============================================
async function main () {
  console.log('🧪 TESTE /figurinha — encaixe 512×512 com fundo transparente\n')
  const midias = await prepararMidias()

  // ── Presença no loader/registro ──
  checar('nome do comando é "figurinha"', figurinha.nome === 'figurinha')
  checar('aliases do /figurinha são exatamente ["fig"]',
    JSON.stringify(figurinha.aliases) === JSON.stringify(['fig']),
    JSON.stringify(figurinha.aliases))
  checar('alias /fig registrado', (figurinha.aliases || []).includes('fig'))
  checar('o /figurinha NÃO anuncia mais figcompleta/figurinha como apelido',
    !(figurinha.aliases || []).includes('figcompleta') && !(figurinha.aliases || []).includes('figurinha'))
  checar('o filtro de imagem é o do requisito (decrease + pad transparente)',
    figurinha.FILTRO_IMAGEM.includes('force_original_aspect_ratio=decrease') &&
    figurinha.FILTRO_IMAGEM.includes(`pad=${LADO}:${LADO}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`) &&
    !/crop/.test(figurinha.FILTRO_IMAGEM),
    figurinha.FILTRO_IMAGEM)
  checar('o filtro de vídeo mantém a proporção (sem crop)',
    !/crop/.test(figurinha.filtroVideo(12)), figurinha.filtroVideo(12))

  // ── Captura: só o caminho da mídia (a conversão é interrompida de propósito) ──
  modoFalha = true
  bufferAtual = null

  // 🔑 Cada nó leva um `mediaKey` ÚNICO: é ele que prova QUAL mídia foi
  // baixada (a legenda é anexada ao nó ao entrar na mensagem, então
  // identidade de objeto NÃO serve como prova — ver helper `baixou`).
  const foto = { mediaKey: 'foto', mimetype: 'image/jpeg' }
  const video = { mediaKey: 'video', mimetype: 'video/mp4', seconds: 3 }
  const fotoRespondendoVideo = { mediaKey: 'foto-direta', mimetype: 'image/jpeg' }

  let r = await rodarComando(msgCitando(foto))
  checar('imagem CITADA (reply) é capturada',
    baixou(r, 'image', 'foto'), JSON.stringify(r.envios))

  r = await rodarComando(msgDireta(foto))
  checar('imagem DIRETA na legenda é capturada (bug do /s não se repete)',
    baixou(r, 'image', 'foto'), JSON.stringify(r.envios))

  r = await rodarComando(msgDireta(video))
  checar('vídeo DIRETO na legenda é capturado',
    baixou(r, 'video', 'video'), JSON.stringify(r.envios))

  r = await rodarComando({ extendedTextMessage: { text: '/figurinha', contextInfo: { quotedMessage: { videoMessage: video } } } })
  checar('vídeo CITADO (reply) é capturado',
    baixou(r, 'video', 'video'), JSON.stringify(r.envios))

  const fotoQueCitaVideo = { ...fotoRespondendoVideo, contextInfo: { quotedMessage: { videoMessage: video } } }
  r = await rodarComando({ imageMessage: { ...fotoQueCitaVideo, caption: '/figurinha' } })
  checar('mídia DIRETA vence a citada (prioridade da legenda)',
    baixou(r, 'image', 'foto-direta'), JSON.stringify(r.envios))

  r = await rodarComando({ extendedTextMessage: { text: '/figurinha', contextInfo: { quotedMessage: { viewOnceMessageV2: { message: { imageMessage: foto } } } } } })
  checar('imagem citada ENCAPSULADA (view-once) é capturada', r.envios.length === 1 && r.envios[0].tipo === 'image')

  r = await rodarComando({ ephemeralMessage: { message: { imageMessage: { ...foto, caption: '/figurinha' } } } })
  checar('imagem em mensagem TEMPORÁRIA é capturada', r.envios.length === 1 && r.envios[0].tipo === 'image')

  r = await rodarComando({ conversation: '/figurinha' })
  checar('sem imagem alguma: orienta legenda e reply sem baixar mídia',
    r.envios.length === 0 && r.mensagens.length === 1 &&
    /legenda/.test(ultimo()?.texto) && /Responda/.test(ultimo()?.texto))
  checar('sem imagem alguma: menciona o fundo transparente (é o diferencial do comando)',
    /transparente/i.test(ultimo()?.texto))

  r = await rodarComando({ extendedTextMessage: { text: '/figurinha', contextInfo: { quotedMessage: { conversation: 'oi' } } } })
  checar('reply de TEXTO (sem mídia) → mesma orientação amigável',
    r.envios.length === 0 && /Nenhuma mídia|Não vejo nenhuma mídia/.test(ultimo()?.texto))



  // ============================================
  // 🏃 PARTE 2 — pipeline REAL do encaixe (ffmpeg em processo filho)
  // ============================================
  modoFalha = false
  const rotulo = (m) => r.mensagens.find((x) => x.sticker)

  // ── (a) imagem QUADRADA: não sobra espaço, logo NENHUM padding ──
  bufferAtual = midias.quadrada.buffer
  r = await rodarComando(msgDireta(foto))
  let sticker = rotulo(r)
  checar('quadrada: envia uma figurinha (webp)', Boolean(sticker?.sticker), JSON.stringify(r.mensagens.map((m) => m.texto)))
  checar('quadrada: envia o aviso de progresso antes do sticker',
    r.mensagens.length === 2 && /Encaixando/.test(r.mensagens[0].texto))
  let px = await pixelsDeWebpEstatico(sticker.sticker, 'quadrada')
  checar('quadrada: a imagem ocupa o quadrado inteiro (canto é a COR, opaca)',
    px.ehOpaco(0, 0) && ehVermelho(px.px(0, 0)), JSON.stringify(px.px(0, 0)))
  checar('quadrada: nenhuma faixa transparente (sem padding necessário)',
    px.ehOpaco(255, 0) && px.ehOpaco(0, 255) && px.ehOpaco(LADO - 1, LADO - 1))

  // ── (b) imagem RETRATO (300×600): encaixa na ALTURA → sobra LATERAL ──
  bufferAtual = midias.retrato.buffer
  r = await rodarComando(msgDireta(foto))
  sticker = rotulo(r)
  px = await pixelsDeWebpEstatico(sticker.sticker, 'retrato')
  checar('retrato: laterais ficam TRANSPARENTES (padding lateral)',
    px.ehTransparente(0, 0) && px.ehTransparente(0, 256) && px.ehTransparente(LADO - 1, 256),
    `${JSON.stringify(px.px(0, 256))} | ${JSON.stringify(px.px(LADO - 1, 256))}`)
  checar('retrato: a imagem INTEIRA sobreviveu — topo (vermelho) e base (verde) presentes',
    ehVermelho(px.px(256, 12)) && ehVerde(px.px(256, LADO - 12)),
    `topo=${JSON.stringify(px.px(256, 12))} base=${JSON.stringify(px.px(256, LADO - 12))}`)
  checar('retrato: nenhuma metade foi cortada (opaca acima e abaixo da linha do meio)',
    px.ehOpaco(256, 200) && ehVermelho(px.px(256, 200)) &&
    px.ehOpaco(256, 320) && ehVerde(px.px(256, 320)),
    `acima=${JSON.stringify(px.px(256, 200))} abaixo=${JSON.stringify(px.px(256, 320))}`)

  // ── (c) imagem PAISAGEM (600×300): encaixa na LARGURA → sobra TOPO/BASE ──
  bufferAtual = midias.paisagem.buffer
  r = await rodarComando(msgCitando(foto)) // 🖼️ caminho do REPLY, p/ variar
  sticker = rotulo(r)
  px = await pixelsDeWebpEstatico(sticker.sticker, 'paisagem')
  checar('paisagem (via reply): topo/base ficam TRANSPARENTES (padding vertical)',
    px.ehTransparente(256, 0) && px.ehTransparente(256, LADO - 1) && px.ehTransparente(0, 0),
    `${JSON.stringify(px.px(256, 0))} | ${JSON.stringify(px.px(256, LADO - 1))}`)
  checar('paisagem (via reply): a imagem INTEIRA sobreviveu — esquerda (vermelha) e direita (verde)',
    ehVermelho(px.px(12, 256)) && ehVerde(px.px(LADO - 12, 256)),
    `esq=${JSON.stringify(px.px(12, 256))} dir=${JSON.stringify(px.px(LADO - 12, 256))}`)

  // ── (d) metadados do pack (mesmo método do /s) ──
  checar('metadados do pack injetados no webp (EXIF do wa-sticker-formatter)',
    sticker.sticker.includes(Buffer.from('sticker-pack-name')),
    `sem chunk EXIF (${sticker.sticker.length} bytes)`)
  checar('metadados preservam o webp válido (RIFF/WEBP intactos)',
    sticker.sticker.subarray(0, 4).toString('ascii') === 'RIFF' &&
    sticker.sticker.subarray(8, 12).toString('ascii') === 'WEBP')

  // ── (e) VÍDEO → figurinha ANIMADA com o MESMO encaixe transparente ──
  bufferAtual = midias.videoRetrato.buffer
  r = await rodarComando(msgDireta({ ...video, seconds: 2 }))
  sticker = rotulo(r)
  checar('vídeo: envia figurinha ANIMADA (chunks ANMF)',
    Boolean(sticker?.sticker) && sticker.sticker.includes(Buffer.from('ANMF')))
  checar('vídeo: webp animado traz o canal alfa (chunk ALPH)',
    sticker.sticker.includes(Buffer.from('ALPH')))
  let anim = null
  let erroAnim = null
  try {
    anim = await pixelsDoPrimeiroFrameAnimado(sticker.sticker, 'video')
  } catch (err) {
    erroAnim = err
  }
  checar('vídeo: 1º frame com padding lateral TRANSPARENTE (alfa sobreviveu)',
    Boolean(anim) && anim.quantidadeFrames > 1 && anim.ehTransparente(0, 256) && anim.ehOpaco(256, 256),
    erroAnim ? `não consegui inspecionar: ${erroAnim.message}` : JSON.stringify(anim?.px(0, 256)))

  // ── (f) limpeza dos temporários (padrão apagarComRetry) ──
  checar('nenhum temporário do comando ficou para trás em os.tmpdir()', contarTemporarios() === 0,
    `${contarTemporarios()} arquivo(s) com prefixo figurinha-`)

  // ============================================
  // 🏃 PARTE 3 — erros/limites amigáveis
  // ============================================
  bufferAtual = Buffer.alloc(0)
  r = await rodarComando(msgDireta(foto))
  checar('mídia vazia (0 bytes) → aviso amigável, sem figurinha',
    !rotulo(r) && /corrompido|formato|Não consegui ler/.test(ultimo()?.texto), ultimo()?.texto)

  bufferAtual = Buffer.alloc(26 * 1024 * 1024)
  r = await rodarComando(msgDireta(foto))
  checar('arquivo acima de 25 MB → aviso de "arquivo grande demais", sem figurinha',
    !rotulo(r) && /Arquivo grande demais/.test(ultimo()?.texto), ultimo()?.texto)

  bufferAtual = midias.retrato.buffer
  r = await rodarComando(msgDireta({ ...video, seconds: 11 }))
  checar('vídeo acima de 10s → aviso de limite, sem baixar/converter',
    r.envios.length === 0 && !rotulo(r) && /Limite de 10 segundos/.test(ultimo()?.texto), ultimo()?.texto)

  checar('nenhum temporário vazou após os cenários de erro', contarTemporarios() === 0)

  // ============================================
  // 🔀 PARTE 4 — aliases e PRECEDÊNCIA no registro (mesma regra do loader)
  // ============================================
  // Réplica fiel da varredura do bot.js/teste-loader.js: `nome` é sempre
  // registrado e cada apelido só entra se ainda estiver LIVRE. A pasta
  // menu-fig é varrida em ordem alfabética, então figurinha.js (f) entra
  // antes de sticker.js (s) — mas isso não decide mais nada, porque cada
  // apelido passou a pertencer a um único comando.
  const registro = new Map()
  const registrar = (comando) => {
    registro.set(comando.nome, comando)
    for (const apelido of comando.aliases || []) {
      if (!registro.has(apelido)) registro.set(apelido, comando)
    }
  }
  registrar(figurinha)
  registrar(comandoS)

  checar('aliases do /s são exatamente ["sticker", "stiker", "sticker2"]',
    JSON.stringify(comandoS.aliases) === JSON.stringify(['sticker', 'stiker', 'sticker2']),
    JSON.stringify(comandoS.aliases))
  checar('o /s NÃO anuncia mais /fig nem /figurinha como apelido',
    !(comandoS.aliases || []).includes('fig') && !(comandoS.aliases || []).includes('figurinha'))
  checar('nenhum apelido é disputado pelos dois comandos',
    (figurinha.aliases || []).every((a) => !(comandoS.aliases || []).includes(a)))

  console.log('\n📋 Log de precedência (apelido → comando):')
  for (const entrada of ['s', 'sticker', 'stiker', 'sticker2', 'figurinha', 'fig']) {
    console.log(`   /${entrada} → /${registro.get(entrada)?.nome || '(não registrado)'}`)
  }
  for (const apelido of ['s', 'sticker', 'stiker', 'sticker2']) {
    checar(`precedência: /${apelido} → comando /s`, registro.get(apelido)?.nome === 's')
  }
  for (const apelido of ['figurinha', 'fig']) {
    checar(`precedência: /${apelido} → comando /figurinha`, registro.get(apelido)?.nome === 'figurinha')
  }

  // ── Resultado ──
  console.log(`\nResultado: ${ok} aprovados; ${falhou} falhas.`)
  process.exitCode = falhou ? 1 : 0
}

main()
  .catch((err) => {
    console.error('💥 Falha inesperada no teste:', err?.saida || err?.stack || err)
    process.exitCode = 1
  })
  .finally(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (err) { /* ignora */ }
  })



