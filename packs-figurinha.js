// ============================================================
// 📦 packs-figurinha.js — NÚCLEO DO SISTEMA DE PACKS DE FIGURINHAS
// ============================================================
// Essa é a única base de dados do sistema. Tudo que o resto lê/escreve
// passa por aqui. Uso do MongoDB (coleção `packsFigurinha`) e não
// arquivos no repo: ver "DECISÃO DE ARMAZENAMENTO" no final deste arquivo.
//
// FORMATO DE DOCUMENTO:
//   {
//     id, nome, nome_key, descricao, dono, dono_nome, grupo_origem,
//     figurinhas: [{ url_ou_buffer_ref: Buffer, bytes, adicionada_em }],
//     figurinhas_qtd, criado_em, denuncias: [{ autor, motivo, data }],
//     denuncias_qtd, status
//   }
//
// FLUXO DE MODERAÇÃO (packs com 3 denúncias de PESSOAS DISTINTAS):
//   1) Quem denuncia → automático. O pack é deixado de aparecer no
//      /museu, /abrirpack e /usarpack PARA TODO MUNDO (admin/dono do
//      bot vê ele na /analisarpack), e não aceita novas figurinhas.
//   2) Revisor (admin/dono) → /analisarpack. Visualiza tudo (mesmo
//      com status suspenso) e decide:
//      • /reativarpack — volta pro /museu com denúncias zeradas
//        (pilha limpa, pé na areia, sem rastros);
//      • /apagarpack — destrói o doc do pack.
//   3) Se ninguém reagir, o pacote permanece suspenso para sempre.
//      Há também /apagarpack que o dono do pack pode usar (quer dizer:
//      irá sumir da enciclopédia), e /denunciarpack para registrar novas
//      denúncias (deixa claro que não pode pôr a "contagem" em 0 pelo
//      dono).
//
// ARMAZENAMENTO (DECISÃO): figurinhas guardam o Bytes do webp como
// Buffer puro dentro do document do Mongo (subtipo0). Isso evita
// estourar o repositório (assets/ versionado só cresce) e discos
// efêmeros no Render (arquivos em assets/ sumem a cada redeploy).
// Teto por figurinha: 1MB; teto por pack: 12MB (saída ~16MB do Mongo).
// Das 30 figurinhas, a maioria é estática (~10-50KB).
// ============================================================
const crypto = require('crypto')
const { MongoClient } = require('mongodb')
const { limparNumero, ehDonoDoBot } = require('./config')
const { resolverNumeroAlvo } = require('./lid')

const NOME_BANCO = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO = process.env.MONGODB_COLLECTION_PACKS_FIGURINHA || 'packsFigurinha'

// ─── LIMITES DE NEGÓCIO (documentados) ─────────────────-----
const LIMITE_NOME = 30
const LIMITE_DESCRICAO = 100
const LIMITE_PACKS_ATIVOS = 5 // por dono
const LIMITE_FIGURINHAS = 30 // por pack
const LIMITE_BYTES_FIGURINHA = 1024 * 1024 // 1MB por webp
const LIMITE_BYTES_PACK = 12 * 1024 * 1024 // 12MB por pack (doc Mongo < 16MB)
const LIMITE_DENUNCIAS_SUSPENSAO = 3 // de PESSOAS DISTINTAS
const TETO_ENVIO_USAR = 10 // figurinhas enviadas de uma vez em /usarpack
const PREVIA_ABRIR = 5 // figurinhas mostradas em /abrirpack
const ITENS_MUSEU = 10 // itens por página no /museu
const STATUS = { ATIVO: 'ativo', SUSPENSO: 'suspenso' }

// ============================================================
// 🗄️ CONEXÃO (padrão do projeto: singleton + ping + reconexão)
// ============================================================
require('./config')

let clienteMongo = null
let colecaoCacheada = null
let modoTeste = false

async function obterColecaoPacks() {
  if (modoTeste && colecaoCacheada) return colecaoCacheada

  if (colecaoCacheada && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return colecaoCacheada
    } catch (erroPing) {
      console.error(
        '⚠️ [packs] conexão anterior com o MongoDB morreu — reconectando:',
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
    console.error('💥 MONGODB_URI NÃO CONFIGURADA — o sistema de packs ficará desativado!')
    console.error('   → No Render: Settings → Environment → variável MONGODB_URI')
    console.error('   → Local: adicione MONGODB_URI no arquivo .env da raiz')
    console.error('════════════════════════════════════════════════════════')
    throw new Error('MONGODB_URI ausente — impossível acessar os packs')
  }

  try {
    console.log(`🗄️ [packs] conectando ao MongoDB (db: ${NOME_BANCO}, collection: ${NOME_COLECAO})...`)
    clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
    await clienteMongo.connect()
    await clienteMongo.db('admin').command({ ping: 1 })

    const colecao = clienteMongo.db(NOME_BANCO).collection(NOME_COLECAO)
    await colecao.createIndex({ nome_key: 1 }, { unique: true, name: 'idx_packs_nome_key' })
    await colecao.createIndex({ dono: 1, status: 1 }, { name: 'idx_packs_dono_status' })
    await colecao.createIndex({ status: 1, criado_em: -1 }, { name: 'idx_packs_status_criado' })

    colecaoCacheada = colecao
    console.log('✅ [packs] MongoDB conectado — os packs persistem entre redeploys.')
    return colecaoCacheada
  } catch (erro) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 FALHA AO CONECTAR AO MONGODB (PACKS):', erro?.message)
    console.error('   → MONGODB_URI com usuário/senha/cluster errados')
    console.error('   → IP não liberado no Atlas: Network Access → 0.0.0.0/0')
    console.error('   → Cluster pausado ou sem armazenamento no Atlas free tier')
    console.error('════════════════════════════════════════════════════════')
    try { await clienteMongo?.close() } catch (e) { /* nada a fechar */ }
    clienteMongo = null
    colecaoCacheada = null
    throw erro
  }
}


// ============================================================
// 🧹 NORMALIZAÇÃO + VALIDAÇÃO (puro — testável sem Mongo)
// ============================================================

function normalizarNomeKey(nome) {
  return String(nome || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function validarNome(nome) {
  const limpo = String(nome || '').trim().replace(/\s+/g, ' ')
  if (!limpo) return { ok: false, motivo: 'dê um nome ao pack (ex.: /criarpack Memes do limbo).' }
  if (limpo.length > LIMITE_NOME) return { ok: false, motivo: `nome longo demais: ${limpo.length}/${LIMITE_NOME} caracteres.` }
  if (limpo.length < 2) return { ok: false, motivo: 'nome curto demais: use ao menos 2 letras.' }
  return { ok: true, nome: limpo, nome_key: normalizarNomeKey(limpo) }
}

function validarDescricao(descricao) {
  const limpa = String(descricao || '').trim().replace(/\s+/g, ' ')
  if (limpa.length > LIMITE_DESCRICAO) return { ok: false, motivo: `descrição longa demais: ${limpa.length}/${LIMITE_DESCRICAO} caracteres.` }
  return { ok: true, descricao: limpa }
}

function gerarIdPack() {
  if (crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function somarBytesPack(pack) {
  return (pack?.figurinhas || []).reduce((total, fig) => total + (Number(fig?.bytes) || 0), 0)
}

function hidratarPack(doc) {
  if (!doc) return null
  const figurinhas = Array.isArray(doc.figurinhas) ? doc.figurinhas : []
  const denuncias = Array.isArray(doc.denuncias) ? doc.denuncias : []
  return {
    ...doc,
    figurinhas,
    figurinhas_qtd: doc.figurinhas_qtd ?? figurinhas.length,
    denuncias,
    denuncias_qtd: doc.denuncias_qtd ?? denuncias.length,
    status: doc.status === STATUS.SUSPENSO ? STATUS.SUSPENSO : STATUS.ATIVO
  }
}

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


// ============================================================
// 📦 OPERAÇÕES DO NÚCLEO — criar + buscar + listar
// ============================================================

async function criarPack({ nome, descricao, dono, dono_nome, grupo_origem }) {
  const nomeLimpo = validarNome(nome)
  if (!nomeLimpo.ok) return { ok: false, motivo: nomeLimpo.motivo }
  const descricaoLimpa = validarDescricao(descricao)
  if (!descricaoLimpa.ok) return { ok: false, motivo: descricaoLimpa.motivo }

  const numeroDono = limparNumero(dono)
  if (!numeroDono) return { ok: false, motivo: 'não consegui identificar seu número.' }

  const colecao = await obterColecaoPacks()

  const jaExiste = await colecao.findOne({ nome_key: nomeLimpo.nome_key })
  if (jaExiste) return { ok: false, motivo: `já existe um pack chamado "${jaExiste.nome}". Escolha outro nome.` }

  const ativosDoDono = await colecao.countDocuments({ dono: numeroDono, status: STATUS.ATIVO })
  if (ativosDoDono >= LIMITE_PACKS_ATIVOS) {
    return { ok: false, motivo: `você já tem ${ativosDoDono}/${LIMITE_PACKS_ATIVOS} packs ativos. Apague um antes de criar outro.` }
  }

  const agora = Date.now()
  const doc = {
    id: gerarIdPack(),
    nome: nomeLimpo.nome,
    nome_key: nomeLimpo.nome_key,
    descricao: descricaoLimpa.descricao,
    dono: numeroDono,
    dono_nome: String(dono_nome || '').trim().slice(0, 60),
    grupo_origem: String(grupo_origem || ''),
    figurinhas: [],
    figurinhas_qtd: 0,
    criado_em: agora,
    denuncias: [],
    denuncias_qtd: 0,
    status: STATUS.ATIVO
  }
  await colecao.insertOne(doc)
  return { ok: true, pack: hidratarPack(doc) }
}

async function buscarPackPorNome(nome) {
  const chave = normalizarNomeKey(nome)
  if (!chave) return null
  const colecao = await obterColecaoPacks()
  return hidratarPack(await colecao.findOne({ nome_key: chave }))
}

async function listarPacksMuseu(pagina = 1) {
  const colecao = await obterColecaoPacks()
  const total = await colecao.countDocuments({ status: STATUS.ATIVO })
  const totalPaginas = Math.max(1, Math.ceil(total / ITENS_MUSEU))
  const paginaSegura = Math.min(Math.max(1, Number(pagina) || 1), totalPaginas)
  const docs = await colecao.find({ status: STATUS.ATIVO })
    .sort({ figurinhas_qtd: -1, criado_em: -1 })
    .skip((paginaSegura - 1) * ITENS_MUSEU)
    .limit(ITENS_MUSEU)
    .toArray()
  return { packs: docs.map(hidratarPack), pagina: paginaSegura, totalPaginas, total }
}

async function listarPacksSuspensos() {
  const colecao = await obterColecaoPacks()
  const docs = await colecao.find({ status: STATUS.SUSPENSO })
    .sort({ denuncias_qtd: -1, criado_em: -1 })
    .toArray()
  return docs.map(hidratarPack)
}


// ============================================================
// 🚨 MODERAÇÃO — denunciar / reativar / apagar
// ============================================================

async function denunciarPack(nomePack, autor, motivo) {
  const chave = normalizarNomeKey(nomePack)
  if (!chave) return { ok: false, motivo: 'diga o nome do pack a denunciar.' }
  const numeroAutor = limparNumero(autor)
  if (!numeroAutor) return { ok: false, motivo: 'não consegui identificar seu número.' }

  const colecao = await obterColecaoPacks()
  const pack = hidratarPack(await colecao.findOne({ nome_key: chave }))
  if (!pack) return { ok: false, motivo: `não achei nenhum pack chamado "${String(nomePack).trim()}".` }
  if (pack.dono === numeroAutor && !ehDonoDoBot([], numeroAutor)) {
    return { ok: false, motivo: 'você é o dono do pack — peça a um amigo para avaliar, ou apague com /apagarpack.' }
  }
  if (pack.denuncias.some((d) => limparNumero(d.autor) === numeroAutor)) {
    return { ok: false, motivo: 'você já denunciou este pack — cada pessoa conta uma vez.' }
  }

  const denuncias = [...pack.denuncias, {
    autor: numeroAutor,
    motivo: String(motivo || '').trim().slice(0, 200) || 'sem motivo informado',
    data: Date.now()
  }]
  const suspendeuAgora = denuncias.length >= LIMITE_DENUNCIAS_SUSPENSAO && pack.status === STATUS.ATIVO

  await colecao.updateOne(
    { nome_key: chave },
    { $set: { denuncias, denuncias_qtd: denuncias.length, ...(suspendeuAgora ? { status: STATUS.SUSPENSO } : {}) } }
  )
  return { ok: true, pack: pack.nome, denuncias: denuncias.length, suspenso: suspendeuAgora || pack.status === STATUS.SUSPENSO }
}

async function reativarPack(nomePack) {
  const chave = normalizarNomeKey(nomePack)
  if (!chave) return { ok: false, motivo: 'diga o nome do pack a reativar.' }
  const colecao = await obterColecaoPacks()
  const pack = hidratarPack(await colecao.findOne({ nome_key: chave }))
  if (!pack) return { ok: false, motivo: `não achei nenhum pack chamado "${String(nomePack).trim()}".` }
  if (pack.status !== STATUS.SUSPENSO) return { ok: false, motivo: `o pack "${pack.nome}" já está ativo.` }
  await colecao.updateOne(
    { nome_key: chave },
    { $set: { status: STATUS.ATIVO, denuncias: [], denuncias_qtd: 0 } }
  )
  return { ok: true, pack: pack.nome }
}

async function apagarPack(nomePack, solicitante, opts = {}) {
  const forcarAdmin = Boolean(opts.forcarAdmin)
  const chave = normalizarNomeKey(nomePack)
  if (!chave) return { ok: false, motivo: 'diga o nome do pack a apagar.' }
  const numero = limparNumero(solicitante)
  if (!numero) return { ok: false, motivo: 'não consegui identificar seu número.' }

  const colecao = await obterColecaoPacks()
  const pack = hidratarPack(await colecao.findOne({ nome_key: chave }))
  if (!pack) return { ok: false, motivo: `não achei nenhum pack chamado "${String(nomePack).trim()}".` }

  const ehDonoPack = pack.dono === numero
  if (!ehDonoPack && !forcarAdmin) {
    return { ok: false, motivo: `só o dono do pack "${pack.nome}" (ou a moderação) pode apagá-lo.` }
  }

  await colecao.deleteOne({ nome_key: chave })
  return { ok: true, pack: pack.nome }
}






// ============================================================
// 🖼️ ADICIONAR FIGURINHA (travas de tamanho + quantidade)
// ============================================================

async function adicionarFigurinha(nomePack, bufferWebp) {
  const chave = normalizarNomeKey(nomePack)
  if (!chave) return { ok: false, motivo: 'diga o nome do pack (ex.: responda a figurinha com /addfig Memes do limbo).' }
  if (!Buffer.isBuffer(bufferWebp) || !bufferWebp.length) {
    return { ok: false, motivo: 'a figurinha chegou vazia — tente de novo.' }
  }
  if (bufferWebp.length > LIMITE_BYTES_FIGURINHA) {
    return { ok: false, motivo: `figurinha pesada demais (${Math.round(bufferWebp.length / 1024)}KB): o teto por figurinha é 1MB.` }
  }

  const colecao = await obterColecaoPacks()
  const pack = hidratarPack(await colecao.findOne({ nome_key: chave }))
  if (!pack) return { ok: false, motivo: `não achei nenhum pack chamado "${String(nomePack).trim()}".` }
  if (pack.status !== STATUS.ATIVO) return { ok: false, motivo: `o pack "${pack.nome}" está suspenso para análise e não aceita figurinhas novas.` }
  if (pack.figurinhas.length >= LIMITE_FIGURINHAS) {
    return { ok: false, motivo: `o pack "${pack.nome}" já tem ${LIMITE_FIGURINHAS}/${LIMITE_FIGURINHAS} figurinhas.` }
  }
  if (somarBytesPack(pack) + bufferWebp.length > LIMITE_BYTES_PACK) {
    return { ok: false, motivo: `o pack "${pack.nome}" estourou o teto de 12MB. Crie um pack novo para as próximas.` }
  }

  await colecao.updateOne(
    { nome_key: chave },
    {
      $push: { figurinhas: { url_ou_buffer_ref: bufferWebp, bytes: bufferWebp.length, adicionada_em: Date.now() } },
      $set: { figurinhas_qtd: pack.figurinhas.length + 1 }
    }
  )
  return { ok: true, pack: pack.nome, total: pack.figurinhas.length + 1 }
}


// 👁️ VISIBILIDADE + EXPORTS
// ============================================================

function podeVerPack(pack, opts = {}) {
  if (!pack) return false
  if (pack.status === STATUS.ATIVO) return true
  return Boolean(opts.ehRevisor)
}

function ehRevisorJid(participants, jid) {
  const { ehAdminDoGrupo } = require('./config')
  return ehDonoDoBot(participants, jid) || ehAdminDoGrupo(participants, jid)
}

module.exports = {
  NOME_BANCO,
  NOME_COLECAO,
  LIMITE_NOME,
  LIMITE_DESCRICAO,
  LIMITE_PACKS_ATIVOS,
  LIMITE_FIGURINHAS,
  LIMITE_BYTES_FIGURINHA,
  LIMITE_BYTES_PACK,
  LIMITE_DENUNCIAS_SUSPENSAO,
  TETO_ENVIO_USAR,
  PREVIA_ABRIR,
  ITENS_MUSEU,
  STATUS,
  obterColecaoPacks,
  normalizarNomeKey,
  validarNome,
  validarDescricao,
  gerarIdPack,
  somarBytesPack,
  hidratarPack,
  criarPack,
  buscarPackPorNome,
  listarPacksMuseu,
  listarPacksSuspensos,
  adicionarFigurinha,
  denunciarPack,
  reativarPack,
  apagarPack,
  podeVerPack,
  ehRevisorJid,
  __definirColecaoTeste
}