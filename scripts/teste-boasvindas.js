// ============================================
// 🧪 teste-boasvindas.js — Valida o boasvindas.js (banner + legenda POR GRUPO)
// ============================================
// RODA 100% OFFLINE (sem WhatsApp, sem Mongo, sem rede):
//   - injeta dependências falsas no boasvindas.js pelo gancho
//     __definirDependenciasTeste (mesmo padrão do __definirColecaoTeste);
//   - usa um sock MOCK com sendMessage/groupMetadata (padrão do teste-delete.js);
//   - exercita a composição REAL com jimp sobre a arte oficial do projeto.
// Verifica:
//   - AREA_FOTO congelada com as coordenadas MEDIDAS na arte oficial;
//   - montarLegenda (@nome/@numero/@grupo/@quantidade, sem diferenciar caixa)
//     e o fallback para a LEGENDA_PADRAO quando o modelo é vazio;
//   - garantirMencao (sem @numero acrescenta a menção que notifica o membro);
//   - carregarBannerPadrao(): acha a arte OFICIAL primeiro (dados/banners),
//     com fallback para comandos/dados/banners, e cacheia por mtime;
//   - comporBanner(): a foto é colada NA MOLDURA e o resto da arte fica
//     intacto (comparação pixel a pixel no banner real);
//   - enviarBoasVindas(): envio com imagem + caption + menção, queda para
//     TEXTO quando não há banner/composição/envio e `false` quando nem o
//     texto sai (NUNCA lança);
//   - ehAutorizadoNoGrupo(): admin autorizado, membro comum não;
//   - estrutura dos comandos /setbannerbv, /legendabv, /resetbannerbv e
//     /resetlegendabv + recusas (privado/sem permissão).
// Uso: node scripts/teste-boasvindas.js
// ============================================

const fs = require('fs')
const path = require('path')
const { Jimp, JimpMime } = require('jimp')

const boasvindas = require('../boasvindas')
const { AREA_FOTO, LEGENDA_PADRAO, CAMINHOS_BANNER_PADRAO } = boasvindas

// Isola também os comandos que consultam configurações diretamente.
require('../configuracoes-grupo').__definirColecaoTeste({
  findOne: async () => null
})

const JID_GRUPO = '120363000000000000@g.us'
const JID_PRIVADO = '5555000000001@s.whatsapp.net'
const JID_ADMIN = '5555000000002@s.whatsapp.net'
const JID_MEMBRO = '5555000000003@s.whatsapp.net'
const JID_NOVO = '5555000000009@s.whatsapp.net'
const NUMERO_NOVO = '5555000000009'

const RAIZ = path.join(__dirname, '..')
const ARTE_OFICIAL = path.join(RAIZ, 'dados', 'banners', 'padrao-boasvindas.png')
const ARTE_ALTERNATIVA = path.join(RAIZ, 'comandos', 'dados', 'banners', 'padrao-boasvindas.png')
// ─── Mock do sock do Baileys ───
// sendMessage registra TUDO que saiu (jid + conteúdo + opções) e groupMetadata
// devolve os participantes informados — mesmo padrão do teste-delete.js.
function criarSock({ participants = [], erroMetadata = false } = {}) {
  const enviadas = []
  const sock = {
    enviadas,
    async groupMetadata() {
      if (erroMetadata) throw new Error('groupMetadata indisponível')
      return { participants, owner: JID_ADMIN, subject: 'Recinto de Teste' }
    },
    async sendMessage(jid, conteudo, extra) {
      enviadas.push({ jid, conteudo, extra })
      return { key: { id: `fake-${enviadas.length}` } }
    }
  }
  return { enviadas, sock }
}

const participantesPadrao = () => [
  { id: JID_ADMIN, admin: 'admin' },
  { id: JID_MEMBRO, admin: null }
]

// 📸 Foto sólida (magenta) — permite conferir a colagem PIXEL a PIXEL.
async function criarFotoMagenta(lado = 300) {
  const foto = new Jimp({ width: lado, height: lado, color: 0xff00ffff })
  return foto.getBuffer(JimpMime.png)
}

const lerPixel = (imagem, x, y) => {
  const n = imagem.getPixelColor(x, y)
  return { r: (n >>> 24) & 255, g: (n >>> 16) & 255, b: (n >>> 8) & 255 }
}

const diferenca = (a, b) =>
  Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)

// ============================================================
//  SUÍTE
// ============================================================
async function main() {
  let aprovadas = 0
  let reprovadas = 0

  const testar = async (nome, fn) => {
    try {
      await fn()
      aprovadas += 1
      console.log(`✅ ${nome}`)
    } catch (err) {
      reprovadas += 1
      console.log(`❌ ${nome}:`, err?.message || err)
    }
  }

  // ───── 1) Constantes ─────
  await testar('AREA_FOTO: coordenadas medidas na arte oficial (550,147 237x346)', async () => {
    const esperado = { x: 550, y: 147, w: 237, h: 346 }
    for (const chave of ['x', 'y', 'w', 'h']) {
      if (AREA_FOTO[chave] !== esperado[chave]) {
        throw new Error(`AREA_FOTO.${chave} = ${AREA_FOTO[chave]} (esperado ${esperado[chave]})`)
      }
    }
    if (!Object.isFrozen(AREA_FOTO)) throw new Error('AREA_FOTO deveria ser congelada')
  })

  await testar('PLACEHOLDERS: os 4 suportados, na ordem documentada', async () => {
    const esperado = ['@nome', '@numero', '@grupo', '@quantidade']
    const atual = boasvindas.PLACEHOLDERS || []
    if (atual.join(',') !== esperado.join(',')) throw new Error(`placeholders: ${atual.join(',')}`)
  })

  // ───── 2) Legenda (placeholders) ─────
  await testar('montarLegenda: substitui os 4 placeholders (e ignora a CAIXA)', async () => {
    const modelo = 'Salve @nome (@numero) | grupo @grupo | membros @quantidade'
    const texto = boasvindas.montarLegenda(modelo, {
      nome: 'Yuri',
      numero: NUMERO_NOVO,
      grupo: 'Recinto',
      quantidade: 7
    })
    const esperado = `Salve Yuri (${NUMERO_NOVO}) | grupo Recinto | membros 7`
    if (texto !== esperado) throw new Error(`veio: ${texto}`)

    const maiusculo = boasvindas.montarLegenda('Ei @NOME, @Grupo!', {
      nome: 'Ana',
      grupo: 'Vale'
    })
    if (maiusculo !== 'Ei Ana, Vale!') throw new Error(`versão em maiúsculas: ${maiusculo}`)
  })

  await testar('montarLegenda: modelo vazio/inválido cai na LEGENDA_PADRAO', async () => {
    for (const modelo of [undefined, null, '', '   ']) {
      const texto = boasvindas.montarLegenda(modelo, { nome: 'Yuri', numero: NUMERO_NOVO, grupo: 'G', quantidade: 3 })
      if (!texto.includes('Yuri') || texto.includes('@nome')) {
        throw new Error(`fallback inesperado p/ modelo ${JSON.stringify(modelo)}: ${texto}`)
      }
    }
    // A padrão tem "sono profundo" — âncora em ASCII p/ não depender de emoji
    const textoPadrao = boasvindas.montarLegenda(LEGENDA_PADRAO, { nome: 'Yuri', numero: NUMERO_NOVO, grupo: 'G', quantidade: 3 })
    if (!textoPadrao.includes('sono profundo')) throw new Error(`LEGENDA_PADRAO inesperada: ${textoPadrao}`)
  })

  // ───── 3) Menção (garantia de notificação) ─────
  await testar('garantirMencao: sem @numero acrescenta a menção; com, mantém', async () => {
    const semMencao = 'Bem-vindo aos Campos Elísios!'
    const comMencao = boasvindas.garantirMencao(semMencao, NUMERO_NOVO)
    if (!comMencao.includes(`@${NUMERO_NOVO}`)) throw new Error(`não acrescentou a menção: ${comMencao}`)
    if (!comMencao.startsWith(semMencao)) throw new Error('a legenda original deveria ser preservada')

    const jaTinha = `Olá @${NUMERO_NOVO}!`
    if (boasvindas.garantirMencao(jaTinha, NUMERO_NOVO) !== jaTinha) {
      throw new Error('não deveria duplicar a menção')
    }
  })

  // ───── 4) Banner padrão (arte oficial no disco) ─────
  await testar('CAMINHOS_BANNER_PADRAO: arte OFICIAL primeiro, alternativa depois', async () => {
    const lista = Array.from(CAMINHOS_BANNER_PADRAO || [])
    if (lista.length < 2) throw new Error(`esperava 2 caminhos, veio ${lista.length}`)
    if (lista[0] !== ARTE_OFICIAL) throw new Error(`1º caminho: ${lista[0]}`)
    if (lista[1] !== ARTE_ALTERNATIVA) throw new Error(`2º caminho: ${lista[1]}`)
    if (boasvindas.CAMINHO_BANNER_PADRAO !== lista[0]) {
      throw new Error('CAMINHO_BANNER_PADRAO deveria apontar para a arte oficial')
    }
  })

  await testar('carregarBannerPadrao: lê a arte OFICIAL do disco e cacheia', async () => {
    if (!fs.existsSync(ARTE_OFICIAL)) throw new Error(`arte oficial ausente: ${ARTE_OFICIAL}`)
    const esperado = fs.readFileSync(ARTE_OFICIAL)
    const lido = boasvindas.carregarBannerPadrao()
    if (!Buffer.isBuffer(lido) || lido.length === 0) throw new Error('não devolveu Buffer')
    if (Buffer.compare(lido, esperado) !== 0) throw new Error('o Buffer não é igual ao arquivo oficial')
    // 2ª chamada: cache (mesmo objeto, sem reler o disco)
    if (boasvindas.carregarBannerPadrao() !== lido) throw new Error('deveria devolver o Buffer em cache')
  })

  // ───── 5) Composição REAL com jimp ─────
  await testar('comporBanner: cola a foto NA MOLDURA e preserva o resto da arte', async () => {
    const arte = boasvindas.carregarBannerPadrao()
    const foto = await criarFotoMagenta(300)
    const composta = await boasvindas.comporBanner(arte, foto)

    if (composta.mime !== JimpMime.jpeg) throw new Error(`mime: ${composta.mime}`)
    if (composta.largura !== 1344 || composta.altura !== 768) {
      throw new Error(`tamanho final: ${composta.largura}x${composta.altura}`)
    }
    if (!composta.buffer?.length) throw new Error('buffer final vazio')
    if (typeof composta.jpegThumbnail !== 'string' || composta.jpegThumbnail.length < 100) {
      throw new Error('jpegThumbnail ausente (faria a Baileys processar a imagem nativamente)')
    }

    const original = await Jimp.read(arte)
    const resultado = await Jimp.read(composta.buffer)

    // 🎯 Dentro da moldura: magenta (com tolerância do JPEG)
    const dentro = lerPixel(resultado, AREA_FOTO.x + Math.floor(AREA_FOTO.w / 2), AREA_FOTO.y + Math.floor(AREA_FOTO.h / 2))
    if (diferenca(dentro, { r: 255, g: 0, b: 255 }) > 90) {
      throw new Error(`centro da moldura deveria ser magenta, veio rgb(${dentro.r},${dentro.g},${dentro.b})`)
    }

    // 🖼️ Fora da moldura (à esquerda do ouro): pixel ORIGINAL intacto
    const pontoForaX = AREA_FOTO.x - 40
    const pontoForaY = AREA_FOTO.y + Math.floor(AREA_FOTO.h / 2)
    const foraOriginal = lerPixel(original, pontoForaX, pontoForaY)
    const foraResultado = lerPixel(resultado, pontoForaX, pontoForaY)
    if (diferenca(foraOriginal, foraResultado) > 30) {
      throw new Error(
        `a arte fora da moldura foi alterada: rgb(${foraOriginal.r},${foraOriginal.g},${foraOriginal.b}) → rgb(${foraResultado.r},${foraResultado.g},${foraResultado.b})`
      )
    }
  })

  // ───── 6) enviarBoasVindas (orquestrador chamado pelo bot.js) ─────
  const legendaCustom = 'Saudações, @nome! Você é o membro @quantidade de @grupo. (@numero)'

  // Dependências falsas: legenda customizada + banner informado + foto fixa e
  // a composição REAL do jimp (assim o caminho de imagem é exercitado de fato).
  const dependenciasComBanner = (arte, foto) => ({
    obterLegenda: async () => legendaCustom,
    obterBannerDoGrupo: async () => ({ buffer: arte, mime: JimpMime.png, origem: 'customizado' }),
    obterFotoMembro: async () => ({ buffer: foto, origem: 'foto' }),
    comporBanner: boasvindas.comporBanner
  })

  await testar('enviarBoasVindas: envia IMAGEM + caption + menção (caminho completo)', async () => {
    const arte = boasvindas.carregarBannerPadrao()
    const foto = await criarFotoMagenta(300)
    boasvindas.__definirDependenciasTeste(dependenciasComBanner(arte, foto))

    const { enviadas, sock } = criarSock()
    const ok = await boasvindas.enviarBoasVindas(sock, {
      grupoId: JID_GRUPO,
      participanteId: JID_NOVO,
      nome: 'Yuri',
      nomeGrupo: 'Recinto de Teste',
      totalMembros: 42
    })

    if (ok !== true) throw new Error('deveria devolver true')
    if (enviadas.length !== 1) throw new Error(`esperava 1 envio, houve ${enviadas.length}`)

    const { jid, conteudo } = enviadas[0]
    if (jid !== JID_GRUPO) throw new Error(`jid inesperado: ${jid}`)
    if (!Buffer.isBuffer(conteudo.image)) throw new Error('deveria enviar uma imagem (Buffer)')
    if (conteudo.text) throw new Error('não deveria mandar texto quando manda imagem')
    if (!Array.isArray(conteudo.mentions) || !conteudo.mentions.includes(JID_NOVO)) {
      throw new Error(`mentions inesperadas: ${JSON.stringify(conteudo.mentions)}`)
    }
    if (typeof conteudo.jpegThumbnail !== 'string' || !conteudo.jpegThumbnail.length) {
      throw new Error('a jpegThumbnail deveria ir pronta (evita processamento nativo)')
    }

    const caption = conteudo.caption || ''
    for (const trecho of ['Yuri', '42', 'Recinto de Teste', `@${NUMERO_NOVO}`]) {
      if (!caption.includes(trecho)) throw new Error(`caption sem "${trecho}": ${caption}`)
    }
  })

  await testar('enviarBoasVindas: sem BANNER cai para TEXTO (mesma legenda)', async () => {
    const foto = await criarFotoMagenta(300)
    boasvindas.__definirDependenciasTeste({
      obterLegenda: async () => legendaCustom,
      obterBannerDoGrupo: async () => null,
      obterFotoMembro: async () => ({ buffer: foto, origem: 'foto' }),
      comporBanner: boasvindas.comporBanner
    })
    const { enviadas, sock } = criarSock()
    const ok = await boasvindas.enviarBoasVindas(sock, {
      grupoId: JID_GRUPO,
      participanteId: JID_NOVO,
      nome: 'Yuri',
      nomeGrupo: 'Recinto de Teste',
      totalMembros: 42
    })
    if (ok !== true) throw new Error('deveria devolver true (fallback de texto)')
    if (enviadas.length !== 1) throw new Error(`esperava 1 envio, houve ${enviadas.length}`)
    const { conteudo } = enviadas[0]
    if (conteudo.image) throw new Error('nao deveria mandar imagem sem banner')
    if (!conteudo.text?.includes('Yuri')) throw new Error(`texto inesperado: ${conteudo.text}`)
    if (!Array.isArray(conteudo.mentions) || !conteudo.mentions.includes(JID_NOVO)) {
      throw new Error('a mencao deveria ir mesmo no fallback de texto')
    }
  })

  await testar('enviarBoasVindas: COMPOSICAO quebrada cai para TEXTO (nunca lanca)', async () => {
    const arte = boasvindas.carregarBannerPadrao()
    const foto = await criarFotoMagenta(300)
    boasvindas.__definirDependenciasTeste({
      obterLegenda: async () => legendaCustom,
      obterBannerDoGrupo: async () => ({ buffer: arte, mime: JimpMime.png, origem: 'customizado' }),
      obterFotoMembro: async () => ({ buffer: foto, origem: 'foto' }),
      comporBanner: async () => { throw new Error('jimp indisponivel (simulado)') }
    })
    const { enviadas, sock } = criarSock()
    const ok = await boasvindas.enviarBoasVindas(sock, {
      grupoId: JID_GRUPO,
      participanteId: JID_NOVO,
      nome: 'Yuri',
      nomeGrupo: 'Recinto de Teste',
      totalMembros: 42
    })
    if (ok !== true) throw new Error('deveria devolver true (fallback de texto)')
    if (enviadas.length !== 1) throw new Error(`esperava 1 envio, houve ${enviadas.length}`)
    if (!enviadas[0].conteudo.text) throw new Error('o fallback deveria ser TEXTO puro')
  })

  await testar('enviarBoasVindas: imagem falha 2x por CONEXÃO, tenta o TEXTO', async () => {
    const arte = boasvindas.carregarBannerPadrao()
    const foto = await criarFotoMagenta(300)
    boasvindas.__definirDependenciasTeste(dependenciasComBanner(arte, foto))
    const { enviadas, sock } = criarSock()
    let tentativasImagem = 0
    const original = sock.sendMessage
    sock.sendMessage = async (jid, conteudo, extra) => {
      if (conteudo.image) {
        tentativasImagem += 1
        throw new Error('Connection Closed')
      }
      return original(jid, conteudo, extra)
    }
    const ok = await boasvindas.enviarBoasVindas(sock, {
      grupoId: JID_GRUPO,
      participanteId: JID_NOVO,
      nome: 'Yuri',
      nomeGrupo: 'Recinto de Teste',
      totalMembros: 42
    })
    if (ok !== true) throw new Error('deveria devolver true (texto de reserva)')
    // 1 tentativa inicial + 1 tentativa extra (única) na imagem...
    if (tentativasImagem !== 2) {
      throw new Error(`a imagem deveria ter 2 tentativas, houve ${tentativasImagem}`)
    }
    // ...e depois o fallback de TEXTO (1 envio bem-sucedido).
    if (enviadas.length !== 1) throw new Error(`esperava 1 texto, houve ${enviadas.length}`)
    if (!enviadas[0].conteudo.text?.includes('Yuri')) throw new Error('texto de reserva errado')
  })

  await testar('enviarBoasVindas: nem o TEXTO sai, devolve false', async () => {
    boasvindas.__definirDependenciasTeste({
      obterLegenda: async () => legendaCustom,
      obterBannerDoGrupo: async () => null,
      obterFotoMembro: async () => ({ buffer: null, origem: null }),
      comporBanner: boasvindas.comporBanner
    })
    const { sock } = criarSock()
    sock.sendMessage = async () => { throw new Error('WhatsApp fora do ar (simulado)') }
    const ok = await boasvindas.enviarBoasVindas(sock, {
      grupoId: JID_GRUPO,
      participanteId: JID_NOVO,
      nome: 'Yuri'
    })
    if (ok !== false) throw new Error('deveria devolver false')
  })

  await testar('enviarBoasVindas: chamada INVALIDA, false sem enviar', async () => {
    const { enviadas, sock } = criarSock()
    if (await boasvindas.enviarBoasVindas(null, { grupoId: JID_GRUPO, participanteId: JID_NOVO }) !== false) {
      throw new Error('sock ausente deveria dar false')
    }
    if (await boasvindas.enviarBoasVindas(sock, { grupoId: '', participanteId: JID_NOVO }) !== false) {
      throw new Error('grupo ausente deveria dar false')
    }
    if (await boasvindas.enviarBoasVindas(sock, { grupoId: JID_GRUPO, participanteId: '' }) !== false) {
      throw new Error('membro ausente deveria dar false')
    }
    if (enviadas.length !== 0) throw new Error('nada deveria ter sido enviado')
  })

  // ───── 7) Autorizacao (mesmo criterio do /soadm e do /welcome) ─────
  await testar('ehAutorizadoNoGrupo: ADMIN autorizado, membro comum nao', async () => {
    const { sock } = criarSock({ participants: participantesPadrao() })
    const admin = await boasvindas.ehAutorizadoNoGrupo(sock, JID_GRUPO, JID_ADMIN)
    if (!admin.autorizado) throw new Error('o admin deveria ser autorizado')
    const membro = await boasvindas.ehAutorizadoNoGrupo(sock, JID_GRUPO, JID_MEMBRO)
    if (membro.autorizado) throw new Error('o membro comum NAO deveria ser autorizado')
  })

  await testar('ehAutorizadoNoGrupo: metadata quebrada LANCA (comando avisa)', async () => {
    const { sock } = criarSock({ erroMetadata: true })
    let estourou = false
    try {
      await boasvindas.ehAutorizadoNoGrupo(sock, JID_GRUPO, JID_ADMIN)
    } catch (err) {
      estourou = true
      if (!/groupmetadata/i.test(err?.message || '')) throw err
    }
    if (!estourou) throw new Error('deveria lancar quando os metadados falham')
  })

  // ───── 8) Comandos bv: estrutura + recusas + ajudas ─────
  const comandoSetBanner = require('../comandos/admin/setbannerbv')
  const comandoLegenda = require('../comandos/admin/legendabv')
  const comandoResetBanner = require('../comandos/admin/resetbannerbv')
  const comandoResetLegenda = require('../comandos/admin/resetlegendabv')

  const criarMsgComando = ({ grupo = true, autor = JID_ADMIN } = {}) => ({
    key: {
      remoteJid: grupo ? JID_GRUPO : JID_PRIVADO,
      fromMe: false,
      id: 'COMANDO123',
      participant: grupo ? autor : undefined
    },
    message: { conversation: '/comando' }
  })

  const textoUnico = (enviadas) => {
    const textos = enviadas.filter((e) => e.conteudo?.text)
    return textos.length === 1 ? textos[0].conteudo.text : null
  }

  await testar('comandos bv: estrutura (nomes, aliases, executar)', async () => {
    const esperados = [
      [comandoSetBanner, 'setbannerbv'],
      [comandoLegenda, 'legendabv'],
      [comandoResetBanner, 'resetbannerbv'],
      [comandoResetLegenda, 'resetlegendabv']
    ]
    for (const [comando, nome] of esperados) {
      if (comando.nome !== nome) throw new Error(`nome inesperado: ${comando.nome}`)
      if (typeof comando.executar !== 'function') throw new Error(`/${nome}: sem executar`)
      if (!comando.descricao) throw new Error(`/${nome}: sem descricao`)
    }
    if (!comandoResetBanner.aliases?.includes('delbannerbv')) throw new Error('alias delbannerbv ausente')
    if (!comandoResetLegenda.aliases?.includes('dellegendabv')) throw new Error('alias dellegendabv ausente')
  })

  await testar('comandos bv: fora de GRUPO recusam com aviso', async () => {
    const casos = [
      [comandoSetBanner, []],
      [comandoLegenda, ['texto']],
      [comandoResetBanner, []],
      [comandoResetLegenda, []]
    ]
    for (const [comando, extras] of casos) {
      const { enviadas, sock } = criarSock()
      await comando.executar(sock, JID_PRIVADO, criarMsgComando({ grupo: false }), ...extras)
      const texto = textoUnico(enviadas)
      if (!texto || !/grupo/i.test(texto)) throw new Error(`/${comando.nome}: ${texto}`)
    }
  })

  await testar('comandos bv: membro COMUM e recusado', async () => {
    const casos = [
      [comandoSetBanner, []],
      [comandoLegenda, ['texto']],
      [comandoResetBanner, []],
      [comandoResetLegenda, []]
    ]
    for (const [comando, extras] of casos) {
      const { enviadas, sock } = criarSock({ participants: participantesPadrao() })
      await comando.executar(sock, JID_GRUPO, criarMsgComando({ autor: JID_MEMBRO }), ...extras)
      const texto = textoUnico(enviadas)
      if (!texto || !/administradores/i.test(texto)) throw new Error(`/${comando.nome}: ${texto}`)
    }
  })

  await testar('/setbannerbv sem imagem: mostra as INSTRUCOES', async () => {
    const { enviadas, sock } = criarSock({ participants: participantesPadrao() })
    await comandoSetBanner.executar(sock, JID_GRUPO, criarMsgComando())
    const texto = textoUnico(enviadas)
    if (!texto || !/setbannerbv/i.test(texto)) throw new Error(`instrucoes: ${texto}`)
  })

  await testar('/legendabv sem texto: mostra a legenda ATUAL', async () => {
    boasvindas.__definirDependenciasTeste({ obterLegenda: async () => LEGENDA_PADRAO })
    const { enviadas, sock } = criarSock({ participants: participantesPadrao() })
    await comandoLegenda.executar(sock, JID_GRUPO, criarMsgComando(), '/legendabv')
    const texto = textoUnico(enviadas)
    if (!texto || !/sono profundo/i.test(texto)) throw new Error(`status: ${texto}`)
  })

  // ───── Reenvio por queda de conexão (sem rede) ─────
  const { EventEmitter } = require('events')
  const criarSocketConexao = (aberto = false) => ({
    ev: new EventEmitter(),
    ws: { isOpen: aberto }
  })

  await testar('reenvio: boas-vindas pendente sai pelo NOVO socket na tentativa extra', async () => {
    const antigo = criarSocketConexao()
    const novo = criarSocketConexao()
    const enviadas = []
    let tentativasAntigo = 0
    antigo.sendMessage = async () => {
      tentativasAntigo++
      throw new Error('Connection Closed')
    }
    novo.sendMessage = async (jid, conteudo) => {
      if (!novo.ws.isOpen) throw new Error('tentou enviar antes da abertura')
      enviadas.push({ jid, conteudo })
    }
    boasvindas.registrarSocketBoasVindas(antigo)
    boasvindas.__definirDependenciasTeste({
      obterLegenda: async () => 'Olá @numero',
      obterBannerDoGrupo: async () => ({ buffer: Buffer.from('banner'), origem: 'teste' }),
      obterFotoMembro: async () => ({ buffer: Buffer.from('foto'), origem: 'foto' }),
      comporBanner: async () => ({ buffer: Buffer.from('imagem'), jpegThumbnail: Buffer.from('miniatura') })
    })
    try {
      const envio = boasvindas.enviarBoasVindas(antigo, {
        grupoId: JID_GRUPO, participanteId: JID_NOVO, nomeGrupo: 'Teste'
      })
      // 1ª tentativa falha na hora; o reenvio aguarda o atraso fixo (2s).
      await new Promise(resolve => setImmediate(resolve))
      // O bot recria o socket durante a espera — a tentativa extra deve
      // sair pelo socket novo (obterSocketEnvio), não pelo antigo morto.
      boasvindas.registrarSocketBoasVindas(novo)
      novo.ws.isOpen = true
      if (await envio !== true) throw new Error('boas-vindas não saiu')
      if (tentativasAntigo !== 1 || enviadas.length !== 1) throw new Error('socket incorreto ou envio duplicado')
      const { jid, conteudo } = enviadas[0]
      if (jid !== JID_GRUPO || conteudo.image.toString() !== 'imagem' ||
          conteudo.caption !== boasvindas.garantirMencao(
            boasvindas.montarLegenda('Olá @numero', { numero: NUMERO_NOVO }), NUMERO_NOVO
          ) || conteudo.mentions[0] !== JID_NOVO) {
        throw new Error('imagem, legenda ou menção alterada no reenvio')
      }
    } finally {
      boasvindas.__definirDependenciasTeste()
    }
  })

  await testar('reenvio: DUAS falhas por conexão esgotam tentativas e preservam fallback', async () => {
    boasvindas.__definirDependenciasTeste({
      obterLegenda: async () => 'Olá @numero',
      obterBannerDoGrupo: async () => ({ buffer: Buffer.from('banner'), origem: 'teste' }),
      obterFotoMembro: async () => ({ buffer: Buffer.from('foto'), origem: 'foto' }),
      comporBanner: async () => ({ buffer: Buffer.from('imagem'), largura: 1, altura: 1 })
    })
    try {
      for (const falharTexto of [false, true]) {
        const sock = criarSocketConexao(true)
        let imagens = 0
        let textos = 0
        sock.sendMessage = async (jid, conteudo) => {
          if (conteudo.image) imagens++
          else textos++
          if (conteudo.image || falharTexto) throw new Error('Connection Closed')
        }
        const resultado = await boasvindas.enviarBoasVindas(sock, {
          grupoId: JID_GRUPO, participanteId: JID_NOVO
        })
        // 1 tentativa inicial + 1 extra na imagem; o texto de reserva só
        // repete (2x) quando ele próprio também sofre queda de conexão.
        if (resultado !== !falharTexto || imagens !== 2 || textos !== (falharTexto ? 2 : 1)) {
          throw new Error('limite de tentativas ou fallback alterado')
        }
      }
    } finally {
      boasvindas.__definirDependenciasTeste()
    }
  })

  console.log(reprovadas === 0 ? '\nTodos os testes passaram.' : `\n${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
