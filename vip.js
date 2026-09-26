// ============================================
// 💠 vip.js — Sistema de Membros VIP (MongoDB, com expiração automática)
// ============================================
// Módulo responsável por TODA a lógica de VIPs do bot. Migrado de SQLite
// (mensagens.db/better-sqlite3) para MongoDB — MESMO padrão de conexão do
// database.js (ranking) e do rpg/database.js:
//   - Collection dedicada: banco "whatsapp" (MONGODB_DB), collection "vips"
//     (sobrescrevível via MONGODB_COLLECTION_VIPS);
//   - SINGLETON: um único MongoClient criado uma vez no processo;
//   - PING DE SAÚDE a cada uso + reconexão automática se a conexão morreu;
//   - ERROS RUIDOSOS: falha de conexão é logada com causa provável e
//     RELANÇADA (os comandos /darvip e /listavip tratam).
//
// Funções (todas assíncronas desde a migração):
//   1. adicionarVip(numero, dias) — outorga VIP por N dias (SOMANDO os dias
//      se o alvo já for VIP ativo; se já expirou, recomeça um novo período);
//   2. listarVipsAtivos() — VIPs vigentes ordenados pela expiração mais
//      próxima, removendo os expirados do banco (limpeza automática);
//   3. isVip(numero) — verificação reutilizável p/ qualquer comando que
//      queira restringir a VIPs (apaga o registro se já venceu). Aceita
//      JID "@lid" (resolve o número real pelo mapeamento da sessão);
//   4. corrigirVipsComLid() — correção pontual dos registros gravados com
//      LID no lugar do número real (usada pelo /listavip e pelo script
//      scripts/migrar-vip-lid.js);
//   5. limparExpirados() — remove do banco os VIPs vencidos.
//   6. limparNomeCustom/validarNomeCustom(nome) — sanitização e validação do
//      nome customizado do campo `nomeCustom` (2-20 caracteres, sem
//      quebra de linha nem caracteres invisíveis);
//   7. definirNomeCustom/removerNomeCustom(numero, nome) — gravam/apagam o
//      `nomeCustom` no documento do VIP ativo (usados pelo /nomecustom);
//   8. obterNomeCustom(numero) — nome custom do VIP ativo (ou null), usado
//      pelo /perfil; obterNomesCustom(numeros) — mapa numero→nome dos VIPs
//      ativos numa única consulta, usado pelo /ranking.
//   9. validarCorVip/definirCorVip/removerCorVip — campo `corVip` do MESMO
//      documento: o VIP escolhe UM emoji (validado com a lib `emoji-regex`,
//      já no projeto via emoji-mixer) que aparece ao lado do nome no
//      /ranking. SUGESTOES_COR_VIP alimenta o `/corvip lista`;
//      obterCorVip/obterCoresVip/obterEstilosVip leem o campo sem nunca lançar
//      (obterEstilosVip devolve nome E cor numa consulta só — é o do /ranking).
//  10. validarAssinatura/definirAssinatura/removerAssinatura — campo
//      `assinatura`: marca d'água de até ASSINATURA_MAX (15) caracteres, sem
//      emoji, que o /s e o /figurinha gravam na figurinha via ffmpeg;
//      obterAssinatura(numero) devolve null (sem lançar) quando não há.
//  11. validarTemaVip/definirTemaVip/removerTemaVip — campo `temaVip`: nome
//      do esquema de cor (padrao/neon/pastel/escuro/dourado, catálogo no
//      temas-vip.js) que o /temavip aplica nos cards (fundo/texto/destaque);
//      obterTemaVip(numero) devolve null (sem lançar) quando não há tema.
//
// NÃO existe VIP vitalício: todo registro tem `expira_em` obrigatório
// (sempre uma data futura calculada a partir dos dias concedidos).
//
// ESTRUTURA DO DOCUMENTO (collection "vips"):
//   {
//     numero:       "5511999999999",   // apenas dígitos (único)
//     adicionado_em: 1700000000000,    // 1ª outorga (ms)
//     expira_em:     1700864000000,    // quando o VIP acaba (ms)
//     nomeCustom:    "MeuNomeVip"      // OPCIONAL (/nomecustom) — nome que o
//                                      // bot exibe no /perfil e no /ranking
//     corVip:        "🔥"              // OPCIONAL (/corvip) — 1 emoji que
//                                      // aparece antes do nome no /ranking
//     assinatura:    "@joaovip"         // OPCIONAL (/assinatura) — marca
//                                      // d'água nas figurinhas do /s
//     temaVip:       "neon"            // OPCIONAL (/temavip) — esquema de
//                                      // cor dos cards (catálogo temas-vip)
//   }
// ============================================

const { MongoClient } = require('mongodb')
const { limparNumero } = require('./config')
// 🪪 Resolução LID→telefone (mapeamento gravado pela Baileys na sessão) —
// usada pelo isVip (checagem "é VIP?" robusta p/ remetentes que chegam
// como "@lid") e pela correção pontual corrigirVipsComLid().
const { resolverLidParaTelefone } = require('./lid')
// 🎨 Catálogo dos esquemas de cor dos cards (/temavip): puro dados + helpers
// de hex, sem dependências — ESTE módulo requer o catálogo (nunca o inverso,
// então não há ciclo). Usado pela validação do campo `temaVip`.
const temasVip = require('./temas-vip')

const DIA_EM_MS = 24 * 60 * 60 * 1000
// Teto de segurança p/ os dias concedidos (10 anos): evita gravar valores absurdos.
const DIAS_MAX = 3650

const NOME_BANCO = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO = process.env.MONGODB_COLLECTION_VIPS || 'vips'

// Singleton do processo: sobrevive às reconexões do startBot()
let clienteMongo = null
let colecaoCacheada = null
// 🧪 Modo teste (scripts/teste-vip-mongo.js): usa a collection injetada
// pelo gancho __definirColecaoTeste e NÃO conecta ao MongoDB real.
let modoTeste = false

// -------------------------------------------------------------------
// Obtém a collection de VIPs, conectando se necessário. Valida a conexão
// com ping antes de reusar e reconecta se a anterior morreu. Erros são
// logados com causa provável e RELANÇADOS.
// -------------------------------------------------------------------
async function obterColecaoVips() {
  // 🧪 No modo teste, devolve a collection injetada SEM tocar em rede.
  if (modoTeste && colecaoCacheada) return colecaoCacheada

  if (colecaoCacheada && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return colecaoCacheada
    } catch (erroPing) {
      console.error(
        '⚠️ [vip] conexão anterior com o MongoDB morreu — reconectando:',
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
    console.error('💥 MONGODB_URI NÃO CONFIGURADA — o sistema de VIP ficará desativado!')
    console.error('   Sem ela, os VIPs não persistem entre redeploys.')
    console.error('   → No Render: Settings → Environment → variável MONGODB_URI')
    console.error('   → Local: adicione MONGODB_URI no arquivo .env da raiz')
    console.error('════════════════════════════════════════════════════════')
    throw new Error('MONGODB_URI ausente — impossível acessar os VIPs')
  }

  try {
    console.log(`🗄️ [vip] conectando ao MongoDB (db: ${NOME_BANCO}, collection: ${NOME_COLECAO})...`)
    clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
    await clienteMongo.connect()
    await clienteMongo.db('admin').command({ ping: 1 })

    const colecao = clienteMongo.db(NOME_BANCO).collection(NOME_COLECAO)

    // Índice único: 1 registro por número | Índice acelera as limpezas por expiração
    await colecao.createIndex(
      { numero: 1 },
      { unique: true, name: 'idx_vips_numero' }
    )
    await colecao.createIndex(
      { expira_em: 1 },
      { name: 'idx_vips_expira_em' }
    )

    colecaoCacheada = colecao
    console.log('✅ [vip] MongoDB conectado — VIPs persistem entre redeploys.')
    return colecaoCacheada
  } catch (erro) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 FALHA AO CONECTAR AO MONGODB (VIPs):', erro?.message)
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
// 🧹 Remove do banco todos os VIPs cuja expiração já passou.
// Retorna quantos registros foram removidos.
// -------------------------------------------------------------------
async function limparExpirados() {
  const colecao = await obterColecaoVips()
  const resultado = await colecao.deleteMany({ expira_em: { $lte: Date.now() } })
  return resultado.deletedCount || 0
}

// -------------------------------------------------------------------
// 👑 Outorga `dias` de VIP ao número informado (JID cru ou só dígitos).
// Regra de soma:
//   - Já é VIP ATIVO  -> expira_em = expiração atual + dias (SOMA)
//   - Nunca foi / EXPIROU -> novo período a partir de AGORA
// Retorno: { numero, expiraEm, somando, dias } | null (dados inválidos)
// -------------------------------------------------------------------
async function adicionarVip(numeroBruto, dias) {
  const numero = limparNumero(numeroBruto)
  const diasNum = Math.floor(Number(dias))
  if (!numero || !Number.isFinite(diasNum) || diasNum < 1 || diasNum > DIAS_MAX) {
    return null
  }

  const colecao = await obterColecaoVips()
  const agora = Date.now()

  const existente = await colecao.findOne({ numero })
  const somando = Boolean(existente && existente.expira_em > agora)
  const expiraEm = (somando ? existente.expira_em : agora) + diasNum * DIA_EM_MS

  await colecao.updateOne(
    { numero },
    {
      $set: {
        numero,
        // Somando: preserva a data da 1ª outorga | Expirado: recomeça (nova data)
        adicionado_em: somando ? existente.adicionado_em : agora,
        expira_em: expiraEm
      }
    },
    { upsert: true }
  )

  return { numero, expiraEm, somando, dias: diasNum }
}

// -------------------------------------------------------------------
// 📜 Lista TODOS os VIPs ATIVOS, ordenados pela expiração MAIS PRÓXIMA.
// Antes de montar a lista, remove automaticamente os já expirados.
// Retorno: [ { numero, adicionado_em, expira_em }, ... ]
// -------------------------------------------------------------------
async function listarVipsAtivos() {
  await limparExpirados()
  const colecao = await obterColecaoVips()
  return colecao
    .find({}, { projection: { _id: 0, numero: 1, adicionado_em: 1, expira_em: 1 } })
    .sort({ expira_em: 1 })
    .toArray()
}

// -------------------------------------------------------------------
// 🪪 corrigirVipsComLid(): correção PONTUAL dos registros gravados com o
// LID (ex.: "175952680210489") no lugar do número real. Para cada registro
// que tiver mapeamento na sessão (lid-mapping reverse, gravado pela
// Baileys), troca o LID pelo telefone real. Se o número real já tiver
// registro próprio, os dois são MESCLADOS (menor adicionado_em + maior
// expira_em) e o registro-LID é apagado. Roda no /listavip (auto-correção)
// e no scripts/migrar-vip-lid.js (migração manual). NUNCA lança.
// -------------------------------------------------------------------
async function corrigirVipsComLid() {
  const colecao = await obterColecaoVips()
  const registros = await colecao
    .find({}, { projection: { _id: 0, numero: 1, adicionado_em: 1, expira_em: 1 } })
    .toArray()

  let corrigidos = 0
  for (const registro of registros) {
    const telefoneReal = await resolverLidParaTelefone(registro.numero)
    if (!telefoneReal || telefoneReal === registro.numero) continue

    const existente = await colecao.findOne({ numero: telefoneReal })
    if (existente) {
      // 🔀 Mescla: mantém o 1º outorgado e a expiração MAIS LONGE dos dois
      await colecao.updateOne(
        { numero: telefoneReal },
        {
          $set: {
            numero: telefoneReal,
            adicionado_em: existente.adicionado_em ?? registro.adicionado_em,
            expira_em: Math.max(existente.expira_em || 0, registro.expira_em || 0)
          }
        }
      )
      await colecao.deleteOne({ numero: registro.numero })
    } else {
      // ✏️ Correção in-place: troca o LID pelo número real no mesmo registro
      await colecao.updateOne(
        { numero: registro.numero },
        { $set: { numero: telefoneReal } }
      )
    }
    corrigidos += 1
    console.log(`[vip] 🪪 registro corrigido: LID ${registro.numero} → ${telefoneReal}`)
  }

  return { corrigidos, total: registros.length }
}

// -------------------------------------------------------------------
// ✅ Verificação reutilizável (aceita JID cru ou só dígitos):
//   true  = existe registro E a expiração ainda não passou
//   false = não é VIP — e, se o registro já venceu, ele é APAGADO
//           do banco na hora (auto-limpeza).
// 🪪 Aceita também JID "@lid": se não houver registro pelo LID, resolve
// o número real pelo mapeamento da sessão (lid-mapping) e reconsulta —
// sem isso, comandos restritos a VIP (ex.: o futuro /s) falhariam para
// quem chega como "@lid" em grupos com LID habilitado.
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// 🔎 buscarRegistroVipAtivo(numeroBruto): procura o registro de VIP ATIVO
// do número e devolve { colecao, registro } (ou null). É a FONTE ÚNICA das
// leituras do sistema — usada pelo isVip e por toda a API do nome custom:
//   - aceita JID cru, "@lid" ou só dígitos (limparNumero);
//   - 🪪 caminho LID: sem registro pelo LID cru, resolve o número real pelo
//     mapeamento da sessão (lid-mapping) e reconsulta;
//   - 🧹 VIP vencido é APAGADO do banco na hora (auto-limpeza) e conta
//     como inexistente.
// -------------------------------------------------------------------
async function buscarRegistroVipAtivo(numeroBruto) {
  const numero = limparNumero(numeroBruto)
  if (!numero) return null

  const colecao = await obterColecaoVips()
  let registro = await colecao.findOne({ numero })

  // 🪪 Caminho LID: o bruto é "@lid" e não há registro pelo LID cru
  if (!registro && String(numeroBruto || '').endsWith('@lid')) {
    const telefoneReal = await resolverLidParaTelefone(numero)
    if (telefoneReal && telefoneReal !== numero) {
      registro = await colecao.findOne({ numero: telefoneReal })
    }
  }

  if (!registro) return null

  if (registro.expira_em <= Date.now()) {
    // 🧹 VIP vencido deixa de ocupar lugar no banco
    await colecao.deleteOne({ numero: registro.numero })
    return null
  }

  return { colecao, registro }
}

// -------------------------------------------------------------------
// ✅ isVip(numero): true SOMENTE quando existe registro e a expiração não
// passou. Toda a mecânica (LID + auto-limpeza) está em buscarRegistroVipAtivo.
// -------------------------------------------------------------------
async function isVip(numeroBruto) {
  return Boolean(await buscarRegistroVipAtivo(numeroBruto))
}

// -------------------------------------------------------------------
// 🏷️ NOME CUSTOMIZADO (campo `nomeCustom` do documento do VIP)
// -------------------------------------------------------------------
// O /nomecustom (comandos/menu-vip/nomecustom.js — EXCLUSIVO VIP) deixa a
// pessoa escolher o nome que o bot exibe nas respostas dela. O nome mora no
// MESMO documento de VIP deste módulo (collection "vips"), no campo
// `nomeCustom`, gravado com o LID já resolvido p/ o número real (mesma
// resolução do /darvip). Sem VIP ativo não existe nome custom: o registro
// vencido é apagado pelo buscarRegistroVipAtivo (auto-limpeza) e o nome vai
// embora junto.
//
// Onde o bot usa hoje: /perfil (nome do card) e /ranking (nome da lista).
// As LEITURAS (obterNomeCustom/obterNomesCustom) NUNCA lançam e devolvem
// null/vazio sem MONGODB_URI — assim os comandos públicos caem no nome
// padrão em vez de estourar (o isVip continua RUIDOSO, como sempre foi).
// -------------------------------------------------------------------
const NOME_CUSTOM_MIN = 2
const NOME_CUSTOM_MAX = 20

// 🧼 Invisíveis que quebram a formatação das mensagens: controles C0/C1
// (inclui \n, \r e \t — é o "sem quebra de linha" do /nomecustom), espaços
// e marcas zero-width, marcas bidirecionais e o hífen suave. O ZWJ (\u200D)
// fica DE FORA de propósito: ele faz parte de emojis compostos (🧑‍🚀).
const CARACTERES_INVISIVEIS =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u200B\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/g

// 🧼 limparNomeCustom(nome): tira os invisíveis, transforma espaços repetidos
// em um só e apara as pontas. NÃO julga tamanho (quem julga é a validação).
function limparNomeCustom(nomeBruto) {
  return String(nomeBruto ?? '')
    .normalize('NFC')
    .replace(CARACTERES_INVISIVEIS, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ✅ validarNomeCustom(nome): { ok: true, nome, tamanho } ou
//    { ok: false, motivo: 'vazio' | 'curto' | 'longo', nome, tamanho? }
// O tamanho é contado em PONTOS DE CÓDIGO ([...nome].length), então um emoji
// conta como ele mesmo (e não como os 2+ caracteres que o compõem).
function validarNomeCustom(nomeBruto) {
  const nome = limparNomeCustom(nomeBruto)
  if (!nome) return { ok: false, motivo: 'vazio', nome: '' }
  const tamanho = [...nome].length
  if (tamanho < NOME_CUSTOM_MIN) return { ok: false, motivo: 'curto', nome, tamanho }
  if (tamanho > NOME_CUSTOM_MAX) return { ok: false, motivo: 'longo', nome, tamanho }
  return { ok: true, nome, tamanho }
}

// -------------------------------------------------------------------
// ✍️ definirCampoDeVipAtivo(numeroBruto, campo, valor): $set de um campo do
// documento do VIP ATIVO (com o LID já resolvido p/ o número real). É a base
// compartilhada pelo nome custom e pela cor VIP.
// Devolve { ok: true, numero, valor } ou { ok: false, motivo }:
//   'sem-vip' → não é VIP ativo (expirado/inexistente) | 'infra' → desligado
//   'falha'   → erro inesperado do banco (logado).
// -------------------------------------------------------------------
async function definirCampoDeVipAtivo(numeroBruto, campo, valor) {
  if (!modoTeste && !process.env.MONGODB_URI) return { ok: false, motivo: 'infra' }

  try {
    const alvo = await buscarRegistroVipAtivo(numeroBruto)
    if (!alvo) return { ok: false, motivo: 'sem-vip' }

    await alvo.colecao.updateOne(
      { numero: alvo.registro.numero },
      { $set: { [campo]: valor } }
    )
    return { ok: true, numero: alvo.registro.numero, valor }
  } catch (err) {
    console.error(`⚠️ [vip] falha ao gravar o campo ${campo}:`, err?.message || err)
    return { ok: false, motivo: 'falha' }
  }
}

// -------------------------------------------------------------------
// 🧹 removerCampoDeVipAtivo(numeroBruto, campo, normalizar): $unset de um
// campo do VIP ativo (a pessoa volta ao padrão). `normalizar` decide se o
// valor gravado contava como "definido" (o nome custom usa a própria limpeza;
// a cor usa um trim simples).
// Devolve { ok: true, tinha, numero } ou { ok: false, motivo }.
// -------------------------------------------------------------------
async function removerCampoDeVipAtivo(numeroBruto, campo, normalizar = (valor) => Boolean(valor)) {
  if (!modoTeste && !process.env.MONGODB_URI) return { ok: false, motivo: 'infra' }

  try {
    const alvo = await buscarRegistroVipAtivo(numeroBruto)
    if (!alvo) return { ok: false, motivo: 'sem-vip' }

    const tinha = Boolean(normalizar(alvo.registro[campo]))
    await alvo.colecao.updateOne(
      { numero: alvo.registro.numero },
      { $unset: { [campo]: '' } }
    )
    return { ok: true, tinha, numero: alvo.registro.numero }
  } catch (err) {
    console.error(`⚠️ [vip] falha ao remover o campo ${campo}:`, err?.message || err)
    return { ok: false, motivo: 'falha' }
  }
}

// -------------------------------------------------------------------
// 🏷️ definirNomeCustom(numeroBruto, nome): grava o `nomeCustom` no documento
// do VIP ATIVO (LID resolvido p/ o número real antes de gravar).
// Devolve { ok: true, nome } ou { ok: false, motivo } com motivo:
//   'vazio' | 'curto' | 'longo' → nome inválido (nada foi gravado);
//   'sem-vip'                   → não é VIP ativo (expirado/inexistente);
//   'infra'                     → sistema de VIP desligado (sem MONGODB_URI);
//   'falha'                     → erro inesperado do banco (logado).
// -------------------------------------------------------------------
async function definirNomeCustom(numeroBruto, nomeBruto) {
  const validacao = validarNomeCustom(nomeBruto)
  if (!validacao.ok) return validacao

  const resultado = await definirCampoDeVipAtivo(numeroBruto, 'nomeCustom', validacao.nome)
  if (!resultado.ok) return resultado
  console.log(`[vip] 🏷️ nome custom definido p/ ${resultado.numero}: "${validacao.nome}"`)
  return { ok: true, nome: validacao.nome }
}

// -------------------------------------------------------------------
// 🎨 COR VIP (campo `corVip` do MESMO documento de VIP) — comando /corvip
// -------------------------------------------------------------------
// O VIP escolhe UM emoji que o bot mostra ao lado do nome dela no /ranking.
// A validação usa a lib `emoji-regex` (ESM, já no projeto como dependência
// do emoji-mixer — mesmo carregamento sob demanda e em cache do /emojimix).
// O regex conta uma SEQUÊNCIA como um emoji só: 🧑‍🚀, 🇧🇷, 1️⃣ e 👨‍👩‍👧
// valem 1 (e não 3, 2 ou 4).
//
// Motivos de recusa: 'vazio' (só espaços) | 'sem-emoji' (texto comum),
// 'varios' (2+ emojis) | 'mistura' (emoji + texto) | 'infra' (lib fora).
// -------------------------------------------------------------------
let regexEmojiCache = null
async function criarRegexEmoji() {
  if (!regexEmojiCache) {
    const modulo = await import('emoji-regex')
    const criar = modulo.default || modulo
    regexEmojiCache = criar()
  }
  return regexEmojiCache
}

// 🎨 Normalizador do campo `corVip` (o emoji já veio validado na escrita;
// aqui só apara espaços, para uma leitura defensiva).
function normalizarCorVip(valor) {
  return typeof valor === 'string' ? valor.trim() : ''
}

// 📋 Sugestões mostradas pelo `/corvip lista` (curtas e temáticas do recinto)
const SUGESTOES_COR_VIP = ['🔥', '💎', '👑', '🌙', '⚡', '🦋', '🐺', '👻', '🌹', '🍀']

// ✅ validarCorVip(texto): { ok: true, emoji } | { ok: false, motivo }
async function validarCorVip(textoBruto) {
  const texto = String(textoBruto ?? '').trim()
  if (!texto) return { ok: false, motivo: 'vazio' }

  let regex
  try {
    regex = await criarRegexEmoji()
  } catch (err) {
    console.error('⚠️ [vip] falha ao carregar o emoji-regex:', err?.message || err)
    return { ok: false, motivo: 'infra' }
  }

  const encontrados = texto.match(regex) || []
  if (encontrados.length === 0) return { ok: false, motivo: 'sem-emoji' }
  if (encontrados.length > 1) return { ok: false, motivo: 'varios', quantidade: encontrados.length }

  // Sobrou algo além do emoji? (ex.: "🔥 Fulano") → mistura é recusada.
  const resto = texto.split(encontrados[0]).join('').trim()
  if (resto) return { ok: false, motivo: 'mistura' }

  return { ok: true, emoji: encontrados[0] }
}

// ✍️ definirCorVip(numeroBruto, texto): grava o `corVip` (1 emoji) no documento
// do VIP ATIVO. Motivos: os da validação + 'sem-vip' | 'infra' | 'falha'.
async function definirCorVip(numeroBruto, textoBruto) {
  const validacao = await validarCorVip(textoBruto)
  if (!validacao.ok) return validacao

  const resultado = await definirCampoDeVipAtivo(numeroBruto, 'corVip', validacao.emoji)
  if (!resultado.ok) return resultado
  console.log(`[vip] 🎨 cor VIP definida p/ ${resultado.numero}: ${validacao.emoji}`)
  return { ok: true, emoji: validacao.emoji }
}

// 🧹 removerCorVip(numeroBruto): apaga a cor — a pessoa volta ao emoji padrão
// (o nome no /ranking segue como está). Devolve { ok: true, tinha } ou
// { ok: false, motivo: 'sem-vip' | 'infra' | 'falha' }.
async function removerCorVip(numeroBruto) {
  const resultado = await removerCampoDeVipAtivo(numeroBruto, 'corVip', normalizarCorVip)
  if (resultado.ok) console.log(`[vip] 🧹 cor VIP removida de ${resultado.numero}`)
  return resultado
}

// -------------------------------------------------------------------
// ✍️ ASSINATURA (campo `assinatura` do MESMO documento de VIP) — /assinatura
// -------------------------------------------------------------------
// Marca d'água curta que o VIP manda gravar nas figurinhas que cria com o
// /s e o /figurinha (canto inferior direito, fonte pequena com contorno).
// Onde vive: campo `assinatura` do documento de VIP — nada de collection nova.
//
// Regras (o /assinatura traduz cada motivo em mensagem):
//   - até ASSINATURA_MAX (15) caracteres: a figurinha é 512×512 e não sobra
//     espaço visual para mais que isso;
//   - sem quebra de linha nem caracteres de controle/zero-width (o mesmo
//     saneamento do nome custom);
//   - SEM EMOJI: o drawtext do ffmpeg escreve com uma fonte TTF comum e um
//     emoji sai como quadradinho/bolha vazia (verificado no ffmpeg embutido).
// Motivos de recusa: 'vazio' | 'longo' | 'emoji' (e, na gravação, os mesmos
// 'sem-vip' | 'infra' | 'falha' dos outros campos).
// -------------------------------------------------------------------
const ASSINATURA_MAX = 15

// 🧼 Normalizador do campo `assinatura`: sem controle/invisível, sem espaço
// duplicado, sem pontas. Não julga tamanho (quem julga é validarAssinatura).
function normalizarAssinatura(textoBruto) {
  return String(textoBruto ?? '')
    .normalize('NFC')
    .replace(CARACTERES_INVISIVEIS, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ✅ validarAssinatura(texto): { ok: true, assinatura } | { ok: false, motivo }
async function validarAssinatura(textoBruto) {
  const assinatura = normalizarAssinatura(textoBruto)
  if (!assinatura) return { ok: false, motivo: 'vazio' }

  const tamanho = [...assinatura].length
  if (tamanho > ASSINATURA_MAX) {
    return { ok: false, motivo: 'longo', assinatura, tamanho }
  }

  // 🚫 Emoji não renderiza na fonte do drawtext (fica tofu/bolha vazia)
  try {
    const regex = await criarRegexEmoji()
    if ((assinatura.match(regex) || []).length > 0) {
      return { ok: false, motivo: 'emoji', assinatura, tamanho }
    }
  } catch (err) {
    // Falha da lib NÃO bloqueia: a validação de tamanho já passou e o
    // drawtext ignora o que não souber desenhar.
    console.error('⚠️ [vip] falha ao checar emoji na assinatura:', err?.message || err)
  }

  return { ok: true, assinatura, tamanho }
}

// ✍️ definirAssinatura(numeroBruto, texto): grava `assinatura` no documento do
// VIP ATIVO (LID resolvido p/ o número real, como os outros campos).
async function definirAssinatura(numeroBruto, textoBruto) {
  const validacao = await validarAssinatura(textoBruto)
  if (!validacao.ok) return validacao

  const resultado = await definirCampoDeVipAtivo(numeroBruto, 'assinatura', validacao.assinatura)
  if (!resultado.ok) return resultado
  console.log(`[vip] ✍️ assinatura definida p/ ${resultado.numero}: "${validacao.assinatura}"`)
  return { ok: true, assinatura: validacao.assinatura }
}

// 🧹 removerAssinatura(numeroBruto): apaga a assinatura (a figurinha volta a
// sair sem marca d'água). { ok: true, tinha } | { ok: false, motivo }.
async function removerAssinatura(numeroBruto) {
  const resultado = await removerCampoDeVipAtivo(numeroBruto, 'assinatura', normalizarAssinatura)
  if (resultado.ok) console.log(`[vip] 🧹 assinatura removida de ${resultado.numero}`)
  return resultado
}

// -------------------------------------------------------------------
// 🎨 TEMA VIP (campo `temaVip` do MESMO documento de VIP) — /temavip
// -------------------------------------------------------------------
// Nome do esquema de cor que os geradores de card aplicam nas cores de
// fundo/texto/destaque (/perfil e os cards de par do /ship e /kiss).
// O catálogo de temas e as paletas moram no temas-vip.js (puro dados);
// aqui só validamos o NOME e gravamos/lemos o campo no documento.
//
// Regras (o /temavip traduz cada motivo em mensagem):
//   - o nome precisa existir no catálogo (sem tema a lista é curta e fixa:
//     padrao, neon, pastel, escuro, dourado);
//   - "padrao" é um tema como outro qualquer (o card sai com as cores de
//     sempre); o tema DE VERDADE sai de campo com `/temavip remover`.
// Motivos de recusa: 'vazio' | 'desconhecido' (e, na gravação, os mesmos
// 'sem-vip' | 'infra' | 'falha' dos outros campos).
// -------------------------------------------------------------------

// 🧼 Normalizador do campo `temaVip`: minúsculas e sem acento, para que
// "Neon", "NEON" e "neón" caiam no mesmo tema do catálogo.
function normalizarTemaVip(textoBruto) {
  return temasVip.normalizarNomeTema(textoBruto)
}

// ✅ validarTemaVip(texto): { ok: true, tema } | { ok: false, motivo, opcoes? }
// Síncrona de propósito (catálogo em memória — igual ao validarNomeCustom).
function validarTemaVip(textoBruto) {
  const tema = normalizarTemaVip(textoBruto)
  if (!tema) return { ok: false, motivo: 'vazio' }
  if (!temasVip.temaExiste(tema)) {
    return { ok: false, motivo: 'desconhecido', tema, opcoes: temasVip.listarNomes() }
  }
  return { ok: true, tema }
}

// 🎨 definirTemaVip(numeroBruto, texto): grava `temaVip` no documento do
// VIP ATIVO (LID resolvido p/ o número real, como os outros campos).
async function definirTemaVip(numeroBruto, textoBruto) {
  const validacao = validarTemaVip(textoBruto)
  if (!validacao.ok) return validacao

  const resultado = await definirCampoDeVipAtivo(numeroBruto, 'temaVip', validacao.tema)
  if (!resultado.ok) return resultado
  console.log(`[vip] 🎨 tema VIP definido p/ ${resultado.numero}: ${validacao.tema}`)
  return { ok: true, tema: validacao.tema }
}

// 🧹 removerTemaVip(numeroBruto): apaga o tema (os cards voltam às cores
// fixas de hoje). { ok: true, tinha } | { ok: false, motivo }.
async function removerTemaVip(numeroBruto) {
  const resultado = await removerCampoDeVipAtivo(numeroBruto, 'temaVip', normalizarTemaVip)
  if (resultado.ok) console.log(`[vip] 🧹 tema VIP removido de ${resultado.numero}`)
  return resultado
}

// 🎨 obterTemaVip(numeroBruto): tema do VIP ATIVO (ou null). NUNCA lança —
// é usada pelo /perfil e pelos cards de par, que NUNCA podem quebrar por
// causa de um tema (sem banco, VIP sem tema ou registro vencido = null,
// e o card sai exatamente como hoje).
async function obterTemaVip(numeroBruto) {
  try {
    const lido = await lerCamposDeVipAtivo(numeroBruto, { temaVip: normalizarTemaVip })
    return lido?.temaVip || null
  } catch (err) {
    console.error('⚠️ [vip] falha ao ler o tema VIP:', err?.message || err)
    return null
  }
}

// -------------------------------------------------------------------
// 📖 Leitura dos campos de "estilo" do VIP ATIVO (nome/cor/assinatura).
// NUNCA lança: devolve null/mapa vazio quando o banco está fora, para os
// comandos públicos (/perfil, /ranking, /s, /figurinha) caírem no padrão
// em vez de estourar.
// -------------------------------------------------------------------
// lerCamposDeVipAtivo(numero, normalizadores) → { numero, campo… } do VIP
// ativo (cada campo já normalizado; o que não existir fica null) ou null.
async function lerCamposDeVipAtivo(numeroBruto, normalizadores) {
  if (!modoTeste && !process.env.MONGODB_URI) return null

  const alvo = await buscarRegistroVipAtivo(numeroBruto)
  if (!alvo) return null

  const saida = { numero: alvo.registro.numero }
  for (const [campo, normalizar] of Object.entries(normalizadores)) {
    saida[campo] = normalizar(alvo.registro[campo]) || null
  }
  return saida
}

// lerCamposDeVipsAtivos(numeros, normalizadores) → Map numero → { campo… }
// numa ÚNICA consulta ($in). VIPs vencidos são ignorados (o registro já
// foi limpo pelo buscarRegistroVipAtivo em outras leituras; aqui só filtramos).
async function lerCamposDeVipsAtivos(numeros, normalizadores) {
  const mapa = new Map()
  const lista = [...new Set((numeros || []).map(limparNumero).filter(Boolean))]
  if (!lista.length) return mapa
  if (!modoTeste && !process.env.MONGODB_URI) return mapa

  try {
    const colecao = await obterColecaoVips()
    const documentos = await colecao.find({ numero: { $in: lista } }).toArray()
    const agora = Date.now()
    for (const documento of documentos) {
      if (!documento || Number(documento.expira_em) <= agora) continue
      const saida = { numero: limparNumero(documento.numero) }
      let temAlgo = false
      for (const [campo, normalizar] of Object.entries(normalizadores)) {
        const valor = normalizar(documento[campo]) || null
        saida[campo] = valor
        if (valor) temAlgo = true
      }
      if (temAlgo) mapa.set(saida.numero, saida)
    }
  } catch (err) {
    console.error('⚠️ [vip] falha ao ler os campos de estilo dos VIPs:', err?.message || err)
  }
  return mapa
}

// 🏷️ obterNomeCustom(numeroBruto): nome custom do VIP ATIVO (ou null quando
// não é VIP / não definiu). NUNCA lança — o /perfil é comando público.
// -------------------------------------------------------------------
async function obterNomeCustom(numeroBruto) {
  try {
    const lido = await lerCamposDeVipAtivo(numeroBruto, { nomeCustom: limparNomeCustom })
    return lido?.nomeCustom || null
  } catch (err) {
    console.error('⚠️ [vip] falha ao ler o nome custom:', err?.message || err)
    return null
  }
}

// 🎨 obterCorVip(numeroBruto): cor/emoji do VIP ATIVO (ou null). NUNCA lança.
async function obterCorVip(numeroBruto) {
  try {
    const lido = await lerCamposDeVipAtivo(numeroBruto, { corVip: normalizarCorVip })
    return lido?.corVip || null
  } catch (err) {
    console.error('⚠️ [vip] falha ao ler a cor VIP:', err?.message || err)
    return null
  }
}

// ✍️ obterAssinatura(numeroBruto): assinatura do VIP ATIVO (ou null). NUNCA
// lança — é usada pelo /s e pelo /figurinha, que NUNCA podem quebrar por causa
// de uma assinatura (sem banco, VIP sem assinatura ou registro vencido = null,
// e a figurinha sai exatamente como hoje).
async function obterAssinatura(numeroBruto) {
  try {
    const lido = await lerCamposDeVipAtivo(numeroBruto, { assinatura: normalizarAssinatura })
    return lido?.assinatura || null
  } catch (err) {
    console.error('⚠️ [vip] falha ao ler a assinatura:', err?.message || err)
    return null
  }
}

// 🏷️ obterNomesCustom(numeros): mapa numero → nomeCustom dos VIPs ATIVOS
// entre `numeros`, numa ÚNICA consulta. NUNCA lança.
// -------------------------------------------------------------------
async function obterNomesCustom(numeros) {
  const mapa = new Map()
  for (const [numero, item] of await lerCamposDeVipsAtivos(numeros, { nomeCustom: limparNomeCustom })) {
    if (item.nomeCustom) mapa.set(numero, item.nomeCustom)
  }
  return mapa
}

// 🎨 obterCoresVip(numeros): mapa numero → cor dos VIPs ATIVOS. NUNCA lança.
async function obterCoresVip(numeros) {
  const mapa = new Map()
  for (const [numero, item] of await lerCamposDeVipsAtivos(numeros, { corVip: normalizarCorVip })) {
    if (item.corVip) mapa.set(numero, item.corVip)
  }
  return mapa
}

// ✨ obterEstilosVip(numeros): mapa numero → { nome, cor } numa consulta SÓ
// (é o que o /ranking usa: nome custom + cor juntos, sem 2 idas ao banco).
async function obterEstilosVip(numeros) {
  const mapa = new Map()
  const lidos = await lerCamposDeVipsAtivos(numeros, {
    nomeCustom: limparNomeCustom,
    corVip: normalizarCorVip
  })
  for (const [numero, item] of lidos) {
    mapa.set(numero, { nome: item.nomeCustom, cor: item.corVip })
  }
  return mapa
}

// -------------------------------------------------------------------
// 🏷️ removerNomeCustom(numeroBruto): apaga o `nomeCustom` do documento do VIP
// ativo — a pessoa volta a aparecer com o nome padrão do WhatsApp.
// Devolve { ok: true, tinhaNome } ou { ok: false, motivo: 'sem-vip' | 'infra' | 'falha' }.
// -------------------------------------------------------------------
async function removerNomeCustom(numeroBruto) {
  // `limparNomeCustom` no normalizador: um nome só com invisíveis não conta
  // como definido (mesma semântica de quando o /nomecustom grava).
  const resultado = await removerCampoDeVipAtivo(numeroBruto, 'nomeCustom', limparNomeCustom)
  if (!resultado.ok) return resultado
  console.log(`[vip] 🧹 nome custom removido de ${resultado.numero}`)
  return { ok: true, tinhaNome: resultado.tinha }
}

// -------------------------------------------------------------------
// 🗓️ Formata um timestamp como "dd/mm/aaaa às HH:MM" (horário local)
// -------------------------------------------------------------------
function formatarData(timestamp) {
  const d = new Date(timestamp)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const aaaa = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const minuto = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${aaaa} às ${hh}:${minuto}`
}

// -------------------------------------------------------------------
// 🧪 GANCHO DE TESTE (usado por scripts/teste-vip-mongo.js): injeta uma
// collection fake e desativa a conexão real até o fim do processo.
// Passando `null`, o modo teste é desligado e o módulo volta a exigir
// MONGODB_URI (útil p/ provar que o erro sem URI é ruidoso, não silencioso).
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
  adicionarVip,
  listarVipsAtivos,
  isVip,
  limparNomeCustom,
  validarNomeCustom,
  definirNomeCustom,
  obterNomeCustom,
  obterNomesCustom,
  removerNomeCustom,
  validarCorVip,
  definirCorVip,
  obterCorVip,
  obterCoresVip,
  obterEstilosVip,
  removerCorVip,
  validarAssinatura,
  definirAssinatura,
  obterAssinatura,
  removerAssinatura,
  validarTemaVip,
  definirTemaVip,
  obterTemaVip,
  removerTemaVip,
  ASSINATURA_MAX,
  SUGESTOES_COR_VIP,
  NOME_CUSTOM_MIN,
  NOME_CUSTOM_MAX,
  corrigirVipsComLid,
  limparExpirados,
  formatarData,
  DIAS_MAX,
  DIA_EM_MS,
  NOME_BANCO,
  NOME_COLECAO,
  __definirColecaoTeste
}