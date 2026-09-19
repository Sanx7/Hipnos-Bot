// ============================================================
// ⚙️ configuracoes-grupo.js — Configurações POR GRUPO (MongoDB)
// ============================================================
// Módulo responsável por TODA a lógica de persistência das configurações
// que valem POR GRUPO (hoje: o liga/desliga do /welcome). Segue
// EXATAMENTE o mesmo padrão de conexão já usado no resto do projeto
// (database.js, vip.js, sugestoes.js, avaliacoes.js, rpg/database.js):
//   - Collection dedicada: banco "whatsapp" (MONGODB_DB), collection
//     "configuracoesGrupo" (sobrescrevível via MONGODB_COLLECTION_CONFIG_GRUPO);
//   - SINGLETON: um único MongoClient criado uma vez no processo;
//   - PING DE SAÚDE a cada uso + reconexão automática se a conexão morreu;
//   - ERROS RUIDOSOS: falha de conexão é logada com causa provável e
//     RELANÇADA (o comando /welcome trata e avisa o admin).
//
// ESTRUTURA DO DOCUMENTO (collection "configuracoesGrupo"):
//   {
//     grupo_id:            "12036...@g.us",  // JID do grupo (único)
//     welcome:             true,             // /welcome ligado NESTE grupo?
//     banner_customizado:  <Buffer|Binary>,  // ⬅️ NOVO: imagem do banner do
//                                            //    grupo (/setbannerbv) — null
//                                            //    = usar o banner padrão local
//     banner_mime:         "image/jpeg",     // tipo da imagem guardada
//     legenda_customizada: "texto @nome ...",// ⬅️ NOVO: legenda do grupo
//                                            //    (/legendabv) — null = padrão
//     atualizado_em:       1700000000000     // última mudança (ms)
//   }
//
// ÍNDICE ÚNICO: { grupo_id: 1 } — 1 documento por grupo (nunca afeta outros).
//
// Funções exportadas:
//   - obterConfiguracoes(grupoId)      -> documento do grupo (ou null);
//   - definirWelcome(grupoId, ativo)   -> liga/desliga e devolve o documento;
//   - welcomeHabilitado(grupoId)       -> true/false (NUNCA lança; usado pelo
//                                         handler de entrada de membros);
//   - configuracaoPadrao(grupoId)      -> documento padrão (welcome: false).
//   - definirBanner(grupoId, buffer, mime)   -> salva o banner do grupo;
//   - removerBanner(grupoId)                 -> volta ao banner padrão;
//   - obterBanner(grupoId)                   -> {buffer, mime} | null (NUNCA lança);
//   - definirLegenda(grupoId, texto)         -> salva a legenda do grupo;
//   - removerLegenda(grupoId)                -> volta à legenda padrão;
//   - obterLegenda(grupoId)                  -> string | null (NUNCA lança).
// ============================================================

const { MongoClient } = require('mongodb')

// ⚙️ config.js carrega o .env da raiz para o process.env (mesmo padrão de
// vip.js / sugestoes.js / avaliacoes.js) — garante que MONGODB_URI exista
// mesmo se este módulo for importado antes do bot.js.
require('./config')

const NOME_BANCO = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO = process.env.MONGODB_COLLECTION_CONFIG_GRUPO || 'configuracoesGrupo'

// 🖼️ Limites de segurança para o banner customizado (/setbannerbv).
// O documento do MongoDB tem limite de 16 MB — 8 MB de imagem + o resto do
// documento fica com folga confortável.
const LIMITE_BYTES_BANNER = 8 * 1024 * 1024
// 📝 Limite da legenda customizada (/legendabv). O WhatsApp corta legendas
// longas; 900 caracteres mantém tudo visível com folga.
const LIMITE_CARACTERES_LEGENDA = 900

// Singleton do processo: sobrevive às reconexões do startBot() e às
// múltiplas chamadas de welcomeHabilitado/definirWelcome.
let clienteMongo = null
let colecaoCacheada = null
// 🧪 Modo teste (scripts/teste-welcome-mongo.js): usa a collection injetada
// pelo gancho __definirColecaoTeste e NÃO conecta ao MongoDB real.
let modoTeste = false

// -------------------------------------------------------------------
// Documento padrão de um grupo (welcome DESLIGADO por padrão).
// ⚠️ Retorna um objeto NOVO a cada chamada — nada de referência
// compartilhada entre grupos/execuções.
// -------------------------------------------------------------------
function configuracaoPadrao(grupoId) {
  return {
    grupo_id: String(grupoId || '').trim(),
    welcome: false,
    // 🖼️ Sem banner próprio → o handler usa comandos/dados/banners/padrao-boasvindas.png
    banner_customizado: null,
    banner_mime: null,
    // 📝 Sem legenda própria → o handler usa a LEGENDA_PADRAO de boasvindas.js
    legenda_customizada: null,
    atualizado_em: Date.now()
  }
}

// -------------------------------------------------------------------
// Obtém a collection de configurações dos grupos, conectando se
// necessário. Valida a conexão com ping antes de reusar e reconecta se a
// anterior morreu. Erros são logados com causa provável e RELANÇADOS.
// -------------------------------------------------------------------
async function obterColecaoConfiguracoes() {
  // No modo teste, devolve a collection injetada SEM tocar em rede.
  if (modoTeste && colecaoCacheada) return colecaoCacheada

  if (colecaoCacheada && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return colecaoCacheada
    } catch (erroPing) {
      console.error(
        '⚠️ [config-grupo] conexão anterior com o MongoDB morreu — reconectando:',
        erroPing?.message
      )
      try { await clienteMongo.close() } catch (e) { /* já morta */ }
      clienteMongo = null
      colecaoCacheada = null
    }
  }

  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 MONGODB_URI NÃO CONFIGURADA — as configurações por grupo (ex.: /welcome) ficam desativadas!')
    console.error('   Sem ela, o liga/desliga do /welcome não persiste entre redeploys.')
    console.error('   → No Render: Settings → Environment → variável MONGODB_URI')
    console.error('   → Local: adicione MONGODB_URI no arquivo .env da raiz')
    console.error('════════════════════════════════════════════════════════')
    throw new Error('MONGODB_URI ausente — impossível persistir as configurações por grupo')
  }

  try {
    console.log(`🗄️ [config-grupo] conectando ao MongoDB (db: ${NOME_BANCO}, collection: ${NOME_COLECAO})...`)
    clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
    await clienteMongo.connect()
    // Ping de verdade: valida credenciais + rede + whitelist de IP do Atlas
    await clienteMongo.db('admin').command({ ping: 1 })

    const colecao = clienteMongo.db(NOME_BANCO).collection(NOME_COLECAO)

    // Índice único por grupo: 1 documento por grupo_id (evita duplicados)
    await colecao.createIndex(
      { grupo_id: 1 },
      { unique: true, name: 'idx_config_grupo_id' }
    )

    colecaoCacheada = colecao
    console.log('✅ [config-grupo] MongoDB conectado — as configurações por grupo persistem entre redeploys.')
    return colecaoCacheada
  } catch (erro) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 FALHA AO CONECTAR AO MONGODB (configurações por grupo):', erro?.message)
    console.error('   Causas mais comuns:')
    console.error('   → MONGODB_URI com usuário/senha/cluster errados')
    console.error('   → IP não liberado no Atlas: Network Access → 0.0.0.0/0')
    console.error('     (o Render free usa IPs de saída dinâmicos)')
    console.error('   → Cluster pausado ou sem armazenamento no Atlas free tier')
    console.error('════════════════════════════════════════════════════════')
    try { await clienteMongo?.close() } catch (e) { /* nada a fechar */ }
    clienteMongo = null
    colecaoCacheada = null
    throw erro
  }
}

// -------------------------------------------------------------------
// obterConfiguracoes(grupoId): documento de configuração do grupo (ou
// null se o grupo ainda não tem nada salvo). Lança erro em falha de
// conexão — quem chama decide (o comando trata; o handler de entrada usa
// a versão segura welcomeHabilitado).
// -------------------------------------------------------------------
async function obterConfiguracoes(grupoIdBruto) {
  const grupoId = String(grupoIdBruto || '').trim()
  if (!grupoId) return null

  const colecao = await obterColecaoConfiguracoes()
  return colecao.findOne({ grupo_id: grupoId })
}

// -------------------------------------------------------------------
// definirWelcome(grupoId, ativo): liga (true) ou desliga (false) o
// sistema de boas-vindas NESTE grupo (upsert por grupo_id — nunca toca
// nos outros grupos). Devolve o documento gravado.
// Lança erro em falha de conexão (o /welcome avisa o admin).
// -------------------------------------------------------------------
async function definirWelcome(grupoIdBruto, ativo) {
  const grupoId = String(grupoIdBruto || '').trim()
  if (!grupoId) return null

  const colecao = await obterColecaoConfiguracoes()
  const documento = {
    grupo_id: grupoId,
    welcome: Boolean(ativo),
    atualizado_em: Date.now()
  }

  await colecao.updateOne(
    { grupo_id: grupoId },
    { $set: documento },
    { upsert: true }
  )

  return documento
}

// -------------------------------------------------------------------
// 🤖 IA INTERATIVA — mesmo padrão do welcome: 1/0 POR GRUPO, na MESMA
// collection ("configuracoesGrupo"), campo `ia_interativa`.
// -------------------------------------------------------------------
async function definirIaInterativa(grupoIdBruto, ativo) {
  const grupoId = String(grupoIdBruto || '').trim()
  if (!grupoId) return null

  const colecao = await obterColecaoConfiguracoes()
  const documento = {
    grupo_id: grupoId,
    ia_interativa: Boolean(ativo),
    atualizado_em: Date.now()
  }

  await colecao.updateOne(
    { grupo_id: grupoId },
    { $set: documento },
    { upsert: true }
  )

  console.log(`🤖 [config-grupo] IA interativa ${ativo ? 'LIGADA' : 'DESLIGADA'} p/ ${grupoId}`)
  return documento
}

// iaInterativaHabilitada(grupoId): devolve true/false (NUNCA lança —
// falha de banco assume DESLIGADO, para a IA nunca falar sem permissão).
async function iaInterativaHabilitada(grupoIdBruto) {
  const grupoId = String(grupoIdBruto || '').trim()
  if (!grupoId) return false

  try {
    const config = await obterConfiguracoes(grupoId)
    return config?.ia_interativa === true
  } catch (erro) {
    console.error(
      '⚠️ [config-grupo] falha ao consultar a IA interativa — assumindo DESLIGADO:',
      erro?.message
    )
    return false
  }
}

// -------------------------------------------------------------------
// welcomeHabilitado(grupoId): ✅ FUNÇÃO PÚBLICA usada pelo handler de
// entrada de novos membros (evento group-participants.update).
//   true  = o /welcome está LIGADO neste grupo;
//   false = desligado / grupo sem registro / banco indisponível.
// NUNCA lança: em falha de consulta loga o motivo e assume DESLIGADO
// (fail-safe: melhor não saudar do que derrubar o listener do Baileys).
// -------------------------------------------------------------------
async function welcomeHabilitado(grupoIdBruto) {
  const grupoId = String(grupoIdBruto || '').trim()
  if (!grupoId) return false

  try {
    const config = await obterConfiguracoes(grupoId)
    return config?.welcome === true
  } catch (erro) {
    console.error(
      '⚠️ [config-grupo] falha ao consultar o /welcome — assumindo DESLIGADO:',
      erro?.message
    )
    return false
  }
}

// -------------------------------------------------------------------
//  normalizarBuffer(valor): converte o que o driver do MongoDB devolve
// para um Buffer de verdade. O driver retorna documentos BSON "Binary"
// (que têm `.buffer` como Uint8Array) em vez de Buffer — sem isto, a
// imagem salva chegaria corrompida ao Jimp. Aceita também Buffer e
// Uint8Array (o caso da collection fake dos testes). Devolve null se não
// for possível converter.
// -------------------------------------------------------------------
function normalizarBuffer(valor) {
  if (!valor) return null
  if (Buffer.isBuffer(valor)) return valor
  if (valor instanceof Uint8Array) return Buffer.from(valor)
  // bson.Binary → { _bsontype: 'Binary', buffer: Uint8Array }
  if (valor.buffer instanceof Uint8Array) return Buffer.from(valor.buffer)
  if (typeof valor.value === 'function') {
    const interno = valor.value()
    if (Buffer.isBuffer(interno)) return interno
    if (interno instanceof Uint8Array) return Buffer.from(interno)
  }
  return null
}

// -------------------------------------------------------------------
// 🖼️ definirBanner(grupoId, buffer, mime): salva o banner PRÓPRIO do grupo
// (comando /setbannerbv) no MESMO documento de configurações do grupo.
// Upsert por grupo_id — nunca toca nos outros grupos.
// Lança erro em falha de conexão ou imagem inválida (o comando trata e
// avisa o admin com uma mensagem clara).
// -------------------------------------------------------------------
async function definirBanner(grupoIdBruto, buffer, mime) {
  const grupoId = String(grupoIdBruto || '').trim()
  if (!grupoId) throw new Error('grupo_id ausente — impossível salvar o banner')
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('banner vazio/inválido — nada foi salvo')
  }
  if (buffer.length > LIMITE_BYTES_BANNER) {
    throw new Error(
      `banner grande demais (${(buffer.length / 1024 / 1024).toFixed(1)} MB) — o limite é ${LIMITE_BYTES_BANNER / 1024 / 1024} MB`
    )
  }

  const colecao = await obterColecaoConfiguracoes()
  const documento = {
    grupo_id: grupoId,
    banner_customizado: buffer,
    banner_mime: String(mime || 'image/png'),
    atualizado_em: Date.now()
  }

  await colecao.updateOne(
    { grupo_id: grupoId },
    { $set: documento },
    { upsert: true }
  )

  console.log(`🖼️ [config-grupo] banner customizado salvo p/ ${grupoId} (${buffer.length} bytes, ${documento.banner_mime})`)
  return documento
}

// -------------------------------------------------------------------
// ♻️ removerBanner(grupoId): apaga o banner próprio do grupo — o handler
// volta a usar o banner padrão (comandos/dados/banners/padrao-boasvindas.png).
// Devolve true se havia algo para remover. Lança apenas em falha de conexão.
// -------------------------------------------------------------------
async function removerBanner(grupoIdBruto) {
  const grupoId = String(grupoIdBruto || '').trim()
  if (!grupoId) return false

  const colecao = await obterColecaoConfiguracoes()
  const anterior = await colecao.findOne({ grupo_id: grupoId })
  const tinhaBanner = Boolean(normalizarBuffer(anterior?.banner_customizado)?.length)

  await colecao.updateOne(
    { grupo_id: grupoId },
    { $set: { banner_customizado: null, banner_mime: null, atualizado_em: Date.now() } },
    { upsert: true }
  )

  console.log(`️ [config-grupo] banner de ${grupoId} restaurado para o padrão (tinha customizado: ${tinhaBanner})`)
  return tinhaBanner
}

// -------------------------------------------------------------------
// 🖼️ obterBanner(grupoId): devolve { buffer, mime } do banner PRÓPRIO do
// grupo, ou null quando o grupo não tem banner salvo.
// NUNCA lança (mesma filosofia de welcomeHabilitado): em falha de banco
// loga o motivo e devolve null → o handler cai no banner padrão local,
// mantendo as boas-vindas funcionando.
// -------------------------------------------------------------------
async function obterBanner(grupoIdBruto) {
  const grupoId = String(grupoIdBruto || '').trim()
  if (!grupoId) return null

  try {
    const config = await obterConfiguracoes(grupoId)
    const buffer = normalizarBuffer(config?.banner_customizado)
    if (!buffer || buffer.length === 0) return null
    return { buffer, mime: config?.banner_mime || 'image/png' }
  } catch (erro) {
    console.error(
      '⚠️ [config-grupo] falha ao buscar o banner do grupo — usando o banner PADRÃO:',
      erro?.message
    )
    return null
  }
}
// -------------------------------------------------------------------
// 📝 definirLegenda(grupoId, texto): salva a legenda PERSONALIZADA do grupo
// (comando /legendabv). Aceita os placeholders @nome, @numero, @grupo e
// @quantidade — eles são substituídos na hora do envio (boasvindas.js).
// Upsert por grupo_id. Lança em falha de conexão/legenda inválida.
// -------------------------------------------------------------------
async function definirLegenda(grupoIdBruto, texto) {
  const grupoId = String(grupoIdBruto || '').trim()
  if (!grupoId) throw new Error('grupo_id ausente — impossível salvar a legenda')

  const legenda = String(texto ?? '').trim()
  if (!legenda) throw new Error('legenda vazia — nada foi salvo')
  if (legenda.length > LIMITE_CARACTERES_LEGENDA) {
    throw new Error(
      `legenda longa demais (${legenda.length} caracteres) — o limite é ${LIMITE_CARACTERES_LEGENDA}`
    )
  }

  const colecao = await obterColecaoConfiguracoes()
  const documento = {
    grupo_id: grupoId,
    legenda_customizada: legenda,
    atualizado_em: Date.now()
  }

  await colecao.updateOne(
    { grupo_id: grupoId },
    { $set: documento },
    { upsert: true }
  )

  console.log(`📝 [config-grupo] legenda customizada salva p/ ${grupoId} (${legenda.length} caracteres)`)
  return documento
}

// -------------------------------------------------------------------
// ♻️ removerLegenda(grupoId): apaga a legenda própria do grupo — o handler
// volta a usar a LEGENDA_PADRAO (boasvindas.js).
// Devolve true se havia algo para remover. Lança apenas em falha de conexão.
// -------------------------------------------------------------------
async function removerLegenda(grupoIdBruto) {
  const grupoId = String(grupoIdBruto || '').trim()
  if (!grupoId) return false

  const colecao = await obterColecaoConfiguracoes()
  const anterior = await colecao.findOne({ grupo_id: grupoId })
  const tinhaLegenda = Boolean(String(anterior?.legenda_customizada || '').trim())

  await colecao.updateOne(
    { grupo_id: grupoId },
    { $set: { legenda_customizada: null, atualizado_em: Date.now() } },
    { upsert: true }
  )

  console.log(`️ [config-grupo] legenda de ${grupoId} restaurada para o padrão (tinha customizada: ${tinhaLegenda})`)
  return tinhaLegenda
}

// -------------------------------------------------------------------
// 📝 obterLegenda(grupoId): devolve a legenda PERSONALIZADA do grupo (com os
// placeholders ainda crus) ou null quando não há nenhuma salva.
// NUNCA lança: em falha de banco loga e devolve null → o handler usa a
// legenda padrão (as boas-vindas nunca deixam de acontecer por causa disso).
// -------------------------------------------------------------------
async function obterLegenda(grupoIdBruto) {
  const grupoId = String(grupoIdBruto || '').trim()
  if (!grupoId) return null

  try {
    const config = await obterConfiguracoes(grupoId)
    const legenda = String(config?.legenda_customizada || '').trim()
    return legenda || null
  } catch (erro) {
    console.error(
      '⚠️ [config-grupo] falha ao buscar a legenda do grupo — usando a legenda PADRÃO:',
      erro?.message
    )
    return null
  }
}

// -------------------------------------------------------------------
// 🧪 GANCHO DE TESTE (usado por scripts/teste-welcome-mongo.js): injeta
// uma collection fake e desativa a conexão real até o fim do processo.
// Passando `null`, o modo teste é desligado e o módulo volta a exigir
// MONGODB_URI (útil p/ provar que o erro sem URI é ruidoso).
// -------------------------------------------------------------------
function __definirColecaoTeste(colecao) {
  if (colecao) {
    colecaoCacheada = colecao
    clienteMongo = null
    modoTeste = true
  } else {
    colecaoCacheada = null
    clienteMongo = null
    modoTeste = false
  }
}

module.exports = {
  obterConfiguracoes,
  definirWelcome,
  welcomeHabilitado,
  configuracaoPadrao,
  // 🤖 IA interativa por grupo (mesma collection do /welcome)
  definirIaInterativa,
  iaInterativaHabilitada,
  // 🖼️ Banner personalizado por grupo (/setbannerbv e handler de entrada)
  definirBanner,
  removerBanner,
  obterBanner,
  // 📝 Legenda personalizada por grupo (/legendabv e handler de entrada)
  definirLegenda,
  removerLegenda,
  obterLegenda,
  // 🧪 Limites (usados pelos comandos p/ avisar o admin ANTES de gravar)
  LIMITE_BYTES_BANNER,
  LIMITE_CARACTERES_LEGENDA,
  NOME_BANCO,
  NOME_COLECAO,
  __definirColecaoTeste
}