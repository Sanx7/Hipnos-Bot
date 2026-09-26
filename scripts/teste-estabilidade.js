// ============================================================
// 🧪 teste-estabilidade.js — Harness de testes para /perfil e /revelar
// ============================================================
// Valida, com sock mockado (sem conectar ao WhatsApp):
//   1. /perfil não vaza exceções em cenários hostis (sem foto, sem banco,
//      sem metadados, envio falhando, etc.)
//   2. /revelar detecta view-once em TODAS as embalagens do protocolo
//      (viewOnceMessage, viewOnceMessageV2, viewOnceMessageV2Extension,
//      ephemeralMessage, combos) e baixa/reenvia a mídia.
//
// O módulo @whiskeysockets/baileys é interceptado no require.cache: as
// funções de NORMALIZAÇÃO (normalizeMessageContent, getContentType) são as
// REAIS da lib; apenas o DOWNLOAD é simulado (stream de bytes de verdade,
// JPEG/MP4 gerados pelo próprio ffmpeg do projeto).
//
// 🔌 100% OFFLINE: o WhatsApp é mockado e o MongoDB é DESLIGADO já no topo
// (MONGODB_URI vazia). Sem isso o .env REAL da raiz era carregado pelo
// config.js, o /perfil abria conexão com o Atlas e o processo ficava
// pendurado para sempre depois do "🏁 Fim dos testes".
// 🐕 No fim roda um watchdog unref(): qualquer handle ainda aberto é
// denunciado com exit 1 — travamento nunca mais passa em silêncio.
// Uso:  node scripts/teste-estabilidade.js
// ============================================================

// ------------------------------------------------------------
// 🧪 AMBIENTE OFFLINE — precisa vir ANTES de qualquer require do projeto.
//
// ⚠️ CAUSA RAIZ (corrigida aqui) do processo que NÃO encerrava depois de
//    "🏁 Fim dos testes": o config.js carrega o .env da raiz e o
//    database.js acabava conectando DE VERDADE no MongoDB Atlas
//    (MONGODB_URI real). O driver do Mongo mantém a topologia aberta
//    (sockets TLS + monitor de heartbeat) e o event loop nunca drenava —
//    o script terminava, mas o Node só morria com Ctrl+C.
//
//    O config.js só aplica o .env em chaves AUSENTES de process.env
//    (`if (chave && !(chave in process.env))`), então definir as variáveis
//    AQUI (mesmo vazias, antes de requerer nada do projeto) impede o
//    override e mantém o harness realmente offline. Com isso o /ranking
//    devolve "banco indisponível" — que é justamente o cenário que os
//    testes querem cobrir; os avisos do [database] no console são
//    ESPERADOS.
// ------------------------------------------------------------
process.env.MONGODB_URI = ''       // desliga o banco do ranking (sem rede)
process.env.MONGO_URI_RPG = ''     // idem p/ o banco do RPG (se for puxado)
process.env.DB_PATH = require('path').join(
  require('os').tmpdir(),
  `hipnos-teste-${Date.now()}.db`  // resquício da era SQLite — mantido limpo
)

const path = require('path')
const fs = require('fs')
const os = require('os')
const { Readable } = require('stream')
const { execSync } = require('child_process')

const raiz = path.join(__dirname, '..')

// ------------------------------------------------------------
// Intercepta o Baileys ANTES de qualquer comando ser carregado.
// ⚠️ O pacote é ESM (carregado via require(esm)), então não há entrada
// convencional em require.cache para o subpath. Estratégia: carregar o real
// uma vez, clonar o namespace, trocar os downloads no clone e injetar o
// clone no require.cache da ENTRADA do pacote — o loader CJS consulta o
// cache antes do caminho require(esm), então os comandos recebem o clone.
// As funções de NORMALIZAÇÃO (normalizeMessageContent, getContentType,
// extractMessageContent) permanecem REAIS.
// ------------------------------------------------------------
const baileysReal = require('@whiskeysockets/baileys')
const baileysFake = Object.assign({}, baileysReal)

// Mídia falsa devolvida pelo download simulado (mutável por cenário)
let bytesMidiaFalsa = Buffer.from([])
let erroDownloadSimulado = null

const { Readable: ReadableReal } = require('stream')
const downloadFalso = async () => {
  if (erroDownloadSimulado) throw erroDownloadSimulado
  return ReadableReal.from([bytesMidiaFalsa])
}

// Réplica fiel do downloadMediaMessage real: extrai o conteúdo, normaliza
// (desembrulha view-once/ephemeral/edited), acha o nó de mídia e baixa.
baileysFake.downloadContentFromMessage = downloadFalso
baileysFake.downloadMediaMessage = async (message, tipo = 'buffer', options) => {
  const mContent = baileysReal.extractMessageContent(message.message)
  if (!mContent) throw new Error('No message present')
  const contentType = baileysReal.getContentType(mContent)
  const mediaType = contentType?.replace('Message', '')
  const media = mContent[contentType]
  if (!media || typeof media !== 'object' || (!('url' in media) && !('thumbnailDirectPath' in media))) {
    const e = new Error(`"${contentType}" não é mensagem de mídia`)
    e.status = 404
    throw e
  }
  const stream = await downloadFalso(media, mediaType, options)
  if (tipo === 'buffer') {
    const partes = []
    for await (const chunk of stream) partes.push(chunk)
    return Buffer.concat(partes)
  }
  return stream
}

const caminhoEntradaBaileys = require.resolve('@whiskeysockets/baileys')
require.cache[caminhoEntradaBaileys] = {
  id: caminhoEntradaBaileys,
  filename: caminhoEntradaBaileys,
  loaded: true,
  exports: baileysFake
}

// Sanidade: qualquer require posterior do pacote TEM que receber o clone
if (require('@whiskeysockets/baileys').downloadContentFromMessage !== downloadFalso) {
  throw new Error('Falha ao interceptar o Baileys no require.cache')
}

// ------------------------------------------------------------
// Mídia real (JPEG/MP4 minúsculos) gerada pelo ffmpeg do projeto
// ------------------------------------------------------------
const pastaTestes = fs.mkdtempSync(path.join(os.tmpdir(), 'hipnos-midia-'))
const binarioFfmpeg = require('@ffmpeg-installer/ffmpeg').path
const caminhoJpg = path.join(pastaTestes, 'amostra.jpg')
const caminhoMp4 = path.join(pastaTestes, 'amostra.mp4')

let ffmpegOk = true
try {
  execSync(`"${binarioFfmpeg}" -y -nostdin -f lavfi -i testsrc=size=64x64 -frames:v 1 "${caminhoJpg}"`, { stdio: 'ignore' })
  execSync(`"${binarioFfmpeg}" -y -nostdin -f lavfi -i testsrc=duration=0.5:size=128x128:rate=10 -pix_fmt yuv420p "${caminhoMp4}"`, { stdio: 'ignore' })
} catch (err) {
  ffmpegOk = false
  console.log('⚠️  ffmpeg não conseguiu gerar mídia de amostra:', err.message)
}

const jpegAmostra = ffmpegOk ? fs.readFileSync(caminhoJpg) : Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const mp4Amostra = ffmpegOk ? fs.readFileSync(caminhoMp4) : null

// ------------------------------------------------------------
// Mocks
// ------------------------------------------------------------
function criarSockMock(opcoes = {}) {
  const enviadas = []
  const sock = {
    enviadas,
    async sendMessage(jid, conteudo, extra) {
      enviadas.push({ jid, conteudo, extra })
      if (opcoes.falharTodoEnvio) throw new Error('envio simulado falhou')
      return { key: { id: 'mock' } }
    },
    async groupMetadata() {
      if (opcoes.erroMetadata) throw new Error('metadata-indisponivel')
      return {
        subject: 'Recinto de Teste',
        participants: opcoes.participants || []
      }
    },
    async profilePictureUrl() {
      if (opcoes.erroFoto) {
        const e = new Error('item-not-found')
        e.statusCode = 404
        throw e
      }
      return opcoes.fotoUrl || 'https://fake.cdn/foto.jpg'
    }
  }
  return sock
}

function mensagemGrupo(texto, opcoes = {}) {
  const corpo = opcoes.mencao
    ? { extendedTextMessage: { text: texto, contextInfo: { mentionedJid: opcoes.mencao } } }
    : { conversation: texto }
  return {
    key: {
      remoteJid: opcoes.dm ? '5511912345678@s.whatsapp.net' : '120363021888888888@g.us',
      participant: opcoes.autor || '5511977776666@s.whatsapp.net',
      id: 'MSG' + Math.random().toString(36).slice(2, 8),
      fromMe: false
    },
    pushName: opcoes.pushName,
    message: corpo
  }
}

// ------------------------------------------------------------
// Cenários — /perfil
// ------------------------------------------------------------
async function testarPerfil() {
  console.log('\n========== 👤 /perfil ==========')
  const perfil = require(path.join(raiz, 'comandos', 'perfil.js'))
  const participantes = [
    { id: '5511977776666@s.whatsapp.net', admin: null },
    { id: '177060848861240@lid', phoneNumber: '5511977776666@s.whatsapp.net', admin: 'superadmin' }
  ]

  // ✅ O /perfil SEMPRE responde com IMAGEM: a foto real quando existe ou o
  // avatar padrão embutido (comandos/dados/avatar-perfil.jpg); o card vai na
  // LEGENDA da imagem. Texto puro só aparece como fallback quando o envio da
  // imagem falha (ver comandos/perfil.js, etapas 10 e 14).
  // ⚠️ Por isso os cenários "sem foto" esperam 'imagem': eles esperavam
  // 'texto' da época em que o comando caía para um card de texto (commit
  // 7308318); a reescrita do /perfil (commit bc5db1f) passou a usar o avatar
  // padrão justamente para NÃO depender de foto e o teste não acompanhou.
  const casos = [
    { nome: 'autor com foto e pushName', sock: criarSockMock({ participants: participantes }), msg: mensagemGrupo('/perfil', { pushName: 'Yuri' }), esperado: 'imagem' },
    { nome: 'sem foto (404 do WhatsApp) → avatar padrão', sock: criarSockMock({ erroFoto: true, participants: participantes }), msg: mensagemGrupo('/perfil', { pushName: 'Yuri' }), esperado: 'imagem' },
    { nome: 'mencionando outra pessoa', sock: criarSockMock({ participants: participantes }), msg: mensagemGrupo('/perfil', { mencao: ['5511988887777@s.whatsapp.net'] }), esperado: 'imagem' },
    { nome: 'no privado (DM), sem foto pública → avatar padrão', sock: criarSockMock({ erroFoto: true }), msg: mensagemGrupo('/perfil', { dm: true, pushName: 'Yuri' }), esperado: 'imagem' },
    { nome: 'groupMetadata falhando, sem foto → avatar padrão', sock: criarSockMock({ erroMetadata: true, erroFoto: true }), msg: mensagemGrupo('/perfil', { pushName: 'Yuri' }), esperado: 'imagem' },
    { nome: 'profilePictureUrl falhando (erro genérico) → avatar padrão', sock: criarSockMock({ erroFoto: 'generico', participants: participantes }), msg: mensagemGrupo('/perfil'), esperado: 'imagem' },
    { nome: 'TODO envio falhando (não pode vazar exceção)', sock: criarSockMock({ falharTodoEnvio: true, participants: participantes }), msg: mensagemGrupo('/perfil'), esperado: 'sem crash' }
  ]

  for (const caso of casos) {
    if (caso.sock.erroFoto === 'generico') {
      caso.sock.profilePictureUrl = async () => { throw new Error('boom interno') }
    }
    try {
      await perfil.executar(caso.sock, caso.msg.key.remoteJid, caso.msg)
      // Classifica as respostas: 'imagem' (card na legenda), 'texto'
      // (fallback puro / aviso de erro) ou 'outro'.
      const tipos = caso.sock.enviadas.map((e) => {
        if (e.conteudo.image) return 'imagem'
        if (e.conteudo.text) return 'texto'
        return 'outro'
      })
      // Toda imagem enviada TEM que carregar o card do perfil na legenda —
      // impede um "✅" falso de imagem vazia/sem legenda. O marcador é o campo
      // do card (`🪪 *Nome:* ...`), que é estável em texto puro.
      const cardOk = caso.sock.enviadas.every(
        (e) =>
          !e.conteudo.image ||
          (typeof e.conteudo.caption === 'string' && e.conteudo.caption.includes('*Nome:*'))
      )
      const ok = (caso.esperado === 'sem crash' ? true : tipos.includes(caso.esperado)) && cardOk
      console.log(`${ok ? '✅' : '❌'} ${caso.nome} → respostas: [${tipos.join(', ') || 'nenhuma'}]${cardOk ? '' : ' | ⚠️ imagem SEM o card na legenda'}`)
    } catch (err) {
      console.log(`❌ ${caso.nome} → CRASH: ${err.message}`)
    }
  }
}

function mensagemRevelar(quotedMessage, opcoes = {}) {
  return {
    key: {
      remoteJid: '120363021888888888@g.us',
      participant: '5511977776666@s.whatsapp.net',
      id: 'MSG' + Math.random().toString(36).slice(2, 8),
      fromMe: false
    },
    pushName: 'Yuri',
    message: {
      extendedTextMessage: {
        text: '/revelar',
        contextInfo: {
          stanzaId: 'STA1',
          participant: '5511988887777@s.whatsapp.net',
          quotedMessage,
          ...(opcoes.extra || {})
        }
      }
    }
  }
}

function noMidia(tipo, extra = {}) {
  return {
    url: 'https://mmg.whatsapp.net/v/t62.7118-24/fake.enc',
    mimetype: tipo === 'image' ? 'image/jpeg' : 'video/mp4',
    mediaKey: 'chave-fake==',
    fileLength: '12345',
    height: 100,
    width: 100,
    ...extra
  }
}

async function testarRevelar() {
  console.log('\n========== 👁️‍🗨️ /revelar ==========')
  const revelar = require(path.join(raiz, 'comandos', 'admin', 'revelar.js'))
  const corrigido = fs
    .readFileSync(path.join(raiz, 'comandos', 'admin', 'revelar.js'), 'utf8')
    .includes('downloadMediaMessage')

  const jid = '120363021888888888@g.us'
  const casos = [
    {
      nome: 'controle: viewOnceMessageV2 (imagem)',
      msg: mensagemRevelar({ viewOnceMessageV2: { message: { imageMessage: noMidia('image') } } }),
      bytes: () => jpegAmostra,
      esperadoCorrigido: 'imagem',
      esperadoAtual: 'imagem'
    },
    {
      nome: 'controle: viewOnceMessage v1 (imagem)',
      msg: mensagemRevelar({ viewOnceMessage: { message: { imageMessage: noMidia('image') } } }),
      bytes: () => jpegAmostra,
      esperadoCorrigido: 'imagem',
      esperadoAtual: 'imagem'
    },
    {
      nome: 'BUG: view-once V2 embrulhada em ephemeralMessage (vídeo)',
      msg: mensagemRevelar({ ephemeralMessage: { message: { viewOnceMessageV2: { message: { videoMessage: noMidia('video') } } } } }),
      bytes: () => mp4Amostra,
      esperadoCorrigido: 'vídeo',
      esperadoAtual: 'texto de erro'
    },
    {
      nome: 'BUG: viewOnceMessageV2Extension (nova embalagem do protocolo)',
      msg: mensagemRevelar({ viewOnceMessageV2Extension: { message: { imageMessage: noMidia('image') } } }),
      bytes: () => jpegAmostra,
      esperadoCorrigido: 'imagem',
      esperadoAtual: 'texto de erro'
    },
    {
      nome: 'BUG: quoted malformado (message: null) — não pode estourar TypeError',
      msg: mensagemRevelar({ viewOnceMessageV2: { message: null } }),
      bytes: () => jpegAmostra,
      esperadoCorrigido: 'texto de erro',
      esperadoAtual: 'texto de erro'
    },
    {
      nome: 'controle: quoted sem mídia (texto)',
      msg: mensagemRevelar({ conversation: 'oi' }),
      bytes: () => jpegAmostra,
      esperadoCorrigido: 'texto de erro',
      esperadoAtual: 'texto de erro'
    },
    {
      nome: 'mídia sumida/expirada (download falha) — erro amigável',
      msg: mensagemRevelar({ viewOnceMessageV2: { message: { imageMessage: noMidia('image') } } }),
      bytes: () => jpegAmostra,
      erroDownload: Object.assign(new Error('410 gone'), { status: 410 }),
      esperadoCorrigido: 'texto de erro',
      esperadoAtual: 'texto de erro'
    },
    {
      nome: 'mídia vazia (0 bytes) — erro amigável',
      msg: mensagemRevelar({ viewOnceMessageV2: { message: { imageMessage: noMidia('image') } } }),
      bytes: () => Buffer.from([]),
      esperadoCorrigido: 'texto de erro',
      esperadoAtual: 'texto de erro'
    },
    {
      nome: 'TODO envio falhando (não pode vazar exceção)',
      msg: mensagemRevelar({ viewOnceMessageV2: { message: { imageMessage: noMidia('image') } } }),
      bytes: () => jpegAmostra,
      falharTodoEnvio: true,
      esperadoCorrigido: 'sem crash',
      esperadoAtual: 'sem crash'
    }
  ]

  const pastaTemp = path.join(raiz, 'comandos', 'dados', 'temp')

  // FIXTURE: garante a pasta temporária LIMPA antes dos cenários — resíduos
  // de execuções anteriores (ou do teste EBUSY) não podem sujar o resultado.
  if (fs.existsSync(pastaTemp)) {
    for (const f of fs.readdirSync(pastaTemp)) {
      if (f.startsWith('in_') || f.startsWith('out_') || f.startsWith('thumb_')) {
        try { fs.unlinkSync(path.join(pastaTemp, f)) } catch (e) { /* melhor esforço */ }
      }
    }
  }

  for (const caso of casos) {
    bytesMidiaFalsa = caso.bytes()
    erroDownloadSimulado = caso.erroDownload || null
    const sock = criarSockMock({ falharTodoEnvio: caso.falharTodoEnvio })
    try {
      await revelar.executar(sock, jid, caso.msg)
      const tipos = sock.enviadas.map((e) => (e.conteudo.react ? 'react' : e.conteudo.image ? 'imagem' : e.conteudo.video ? 'vídeo' : 'texto de erro'))
      const esperado = corrigido ? caso.esperadoCorrigido : caso.esperadoAtual
      const ok = esperado === 'sem crash' ? true : tipos.includes(esperado)
      const residuos = fs.existsSync(pastaTemp)
        ? fs.readdirSync(pastaTemp).filter((f) => f.startsWith('in_') || f.startsWith('out_'))
        : []
      const limpo = residuos.length === 0
      console.log(`${ok && limpo ? '✅' : '❌'} ${caso.nome} → respostas: [${tipos.join(', ') || 'nenhuma'}]${limpo ? '' : ` | ⚠️ temporários órfãos: ${residuos.join(', ')}`}`)
    } catch (err) {
      console.log(`❌ ${caso.nome} → CRASH (vazou do comando): ${err.message}`)
    }
  }

  // Teste extra: fs.unlinkSync lançando EPERM/EBUSY não pode vazar do finally
  console.log('\n— proteção extra: unlinkSync falhando (EPERM/EBUSY do Windows) —')
  const unlinkOriginal = fs.unlinkSync
  fs.unlinkSync = () => { throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }) }
  bytesMidiaFalsa = jpegAmostra
  erroDownloadSimulado = null
  const sock = criarSockMock()
  try {
    await revelar.executar(sock, jid, mensagemRevelar({ viewOnceMessageV2: { message: { imageMessage: noMidia('image') } } }))
    console.log(`✅ unlinkSync com EBUSY não derrubou o comando (respostas: ${sock.enviadas.length})`)
  } catch (err) {
    console.log(`❌ unlinkSync com EBUSY VAZOU do comando: ${err.message}`)
  } finally {
    fs.unlinkSync = unlinkOriginal
    // Best-effort: remove o que o teste EBUSY deixou (esperado, por design)
    try {
      for (const f of fs.readdirSync(pastaTemp)) {
        if (f.startsWith('in_') || f.startsWith('out_') || f.startsWith('thumb_')) fs.unlinkSync(path.join(pastaTemp, f))
      }
    } catch (e) { /* melhor esforço */ }
  }
}

// ------------------------------------------------------------
// 🐕 Watchdog anti-travamento de handles
// ------------------------------------------------------------
// Converte "processo pendurado" (script termina e o Node nunca sai) em uma
// falha VISÍVEL: se depois de terminar ainda existir handle aberto, ele é
// listado e o processo sai com código 1 em vez de ficar preso até um Ctrl+C.
// O timer é unref() — ele NÃO segura o event loop por si só, então em uma
// execução saudável ele nunca dispara (o processo encerra normalmente).
// ⚠️ No Node moderno os TIMERS ref'd NÃO aparecem em _getActiveHandles()
// (foi um setTimeout sem clearTimeout que travava o processo de verdade), por
// isso também imprimimos process.getActiveResourcesInfo().
// ------------------------------------------------------------
function armarWatchdogDeHandles(ms = 3000) {
  const vigilante = setTimeout(() => {
    const handles = typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : []
    console.error(`\n⚠️  O harness terminou, mas o processo continua vivo: ${handles.length} handle(s) pendurado(s).`)
    for (const h of handles) {
      let interno = null
      try { interno = h && h._handle && h._handle.constructor && h._handle.constructor.name } catch (e) {}
      const detalhes = [
        h && h.constructor ? h.constructor.name : typeof h,
        interno ? `handle=${interno}` : null,
        h && h._handle && h._handle.fd !== undefined ? `fd=${h._handle.fd}` : null,
        h === process.stdout ? 'é o MEU stdout' : null,
        h === process.stderr ? 'é o MEU stderr' : null,
        h === process.stdin ? 'é o MEU stdin' : null,
        h && h.remoteAddress ? `remoto=${h.remoteAddress}` : null,
        h && h.path ? `path=${h.path}` : null
      ].filter(Boolean)
      console.error(`   - ${detalhes.join(' | ')}`)
    }
    try {
      console.error(`   recursos do loop: ${JSON.stringify(process.getActiveResourcesInfo())}`)
    } catch (e) { /* API indisponível nesta versão */ }
    console.error('   Causas prováveis: conexão aberta (Mongo/HTTP) ou timer sem clearTimeout/unref.')
    process.exit(1)
  }, ms)
  if (typeof vigilante.unref === 'function') vigilante.unref()
  return vigilante
}

// ------------------------------------------------------------
// Execução
// ------------------------------------------------------------
;(async () => {
  console.log('🧪 Harness de estabilidade do Hipnos-Bot')
  console.log(`   Baileys: ${require(path.join(raiz, 'node_modules', '@whiskeysockets', 'baileys', 'package.json')).version}`)
  console.log(`   Mídia de amostra: JPEG ${jpegAmostra.length} bytes | MP4 ${mp4Amostra ? mp4Amostra.length : 'N/D'} bytes`)
  console.log(`   MongoDB: desligado (offline) — MONGODB_URI=${JSON.stringify(process.env.MONGODB_URI)}`)
  await testarPerfil()
  await testarRevelar()
  console.log('\n🏁 Fim dos testes')
  // Se algo ficou aberto, o watchdog avisa e derruba o processo com erro.
  armarWatchdogDeHandles()
})().catch((err) => {
  console.error('💥 Falha no harness:', err)
  process.exitCode = 1
})
