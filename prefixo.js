// ============================================================
// 🔤 prefixo.js — PREFIXO DINÂMICO dos comandos (FONTE ÚNICA)
// ============================================================
// Antes, o "/" vivia HARD-CODED no roteador do bot.js:
//
//   if (!text.startsWith('/')) { ...fluxo de texto livre... }
//   const nomeComando = text.slice(1).split(' ')[0].toLowerCase()
//
// Este módulo é o ÚNICO lugar do projeto que sabe qual caractere abre um
// comando. O bot.js (roteador) e qualquer comando que precise "tirar o
// prefixo do texto" (ex.: /renomear) leem daqui — assim trocar o prefixo
// vale para o bot INTEIRO, sem caça ao "/" solto pelo código.
//
// 📦 PERSISTÊNCIA (MongoDB) — o prefixo sobrevive a redeploy/restart:
//   - banco: MONGODB_DB (padrão "whatsapp")
//   - collection: MONGODB_COLLECTION_PREFIXO (padrão "prefixoComando")
//   - 1 documento só: { _id: "global", prefixo: "!", atualizado_em: 1699.. }
//   - mesmo padrão de conexão dos demais módulos (client único, ping de
//     saúde, reconexão) — configuracoes-grupo.js / vip.js / database.js.
//   Leitura NUNCA lança: sem Mongo o bot segue no PADRÃO "/" e o
//   /set-prefix avisa o dono quando ele tenta gravar.
//
// ⚡ CACHE EM MEMÓRIA (tempo real):
//   - o roteador pergunta o prefixo a CADA mensagem, mas só a 1ª leitura
//     vai ao Mongo; depois é memória (com janela de retentativa de 60s
//     quando a leitura falhou, para o bot se recuperar sozinho);
//   - ao trocar o prefixo, o cache muda NA HORA: a mensagem seguinte já
//     é roteada pelo prefixo novo, sem reiniciar o bot.
//
// 🛡️ REGRAS DE SEGURANÇA (por que não aceitamos qualquer caractere):
//   - precisa ser UM caractere;
//   - NÃO pode ser espaço, letra ou dígito: prefixo de letra roubaria as
//     mensagens normais do grupo (com "c", "casa" viraria comando) e o bot
//     pararia de ouvir texto livre / IA / palpites de jogo;
//   - a "/" legada continua aceita depois da troca
//     (ACEITAR_BARRA_LEGADA) para o grupo não perder o costume de "/perfil".
//
// 🧪 TESTES OFFLINE: __definirPrefixoTeste / __definirColecaoTeste /
// __limparCacheTeste (mesmo padrão de gancho do vip.js e do
// configuracoes-grupo.js) — nenhum teste precisa de Mongo nem de WhatsApp.
// ============================================================

const { MongoClient } = require('mongodb')

// ⚙️ config.js carrega o .env da raiz (mesmo padrão de vip.js /
// database.js / configuracoes-grupo.js) — garante MONGODB_URI disponível
// mesmo se este módulo for importado antes do bot.js.
require('./config')

const NOME_BANCO = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO = process.env.MONGODB_COLLECTION_PREFIXO || 'prefixoComando'
const ID_DOCUMENTO = 'global'

// ✨ Prefixo padrão (o "/" histórico) e a tolerância com ele após a troca.
const PREFIXO_PADRAO = '/'
const ACEITAR_BARRA_LEGADA = true

// ⏱️ Se a leitura do Mongo falhar, não insistimos a cada mensagem: só
// tentamos de novo depois desta janela (o /set-prefix grava direto e
// atualiza o cache, então o dono nunca fica preso).
const INTERVALO_RETENTAR_MS = 60 * 1000

// 🔤 Apelidos por NOME aceitos pelo /set-prefix (o dono pode digitar
// "exclamacao" em vez de "!" — e o comando também mostra a lista).
const APELIDOS = {
  slash: '/', barra: '/', padrao: '/',
  exclamacao: '!', exclama: '!', isso: '!',
  interrogacao: '?', pergunta: '?',
  ponto: '.', dot: '.',
  hifen: '-', traco: '-', menos: '-',
  mais: '+', igual: '=',
  cerquilha: '#', hashtag: '#',
  arroba: '@', at: '@',
  til: '~', underscore: '_', pipe: '|', asterisco: '*',
  doispontos: ':', pontoevirgula: ';', virgula: ','
}

// Singleton do processo (mesma estratégia dos demais módulos do projeto).
let clienteMongo = null
let colecaoCacheada = null
// 🧪 Modo teste (scripts/teste-prefixo.js): collection injetada, zero rede.
let modoTeste = false

// ⚡ CACHE: null = ainda não lemos o Mongo; string = valor em uso.
let cache = null
// 0 = nunca falhou; timestamp da última falha (controla a retentativa).
let ultimoErroEm = 0
// Promise da leitura em voo — evita rajada de consultas no 1º boot.
let leituraEmVoo = null

// -------------------------------------------------------------------
// 🧹 VALIDAÇÃO / NORMALIZAÇÃO (puro — não toca em banco nem em cache)
// -------------------------------------------------------------------

// É um caractere seguro? (não espaço, não letra, não dígito)
function ehSimboloSeguro(caractere) {
  return (
    typeof caractere === 'string' &&
    caractere.length === 1 &&
    !/\s/.test(caractere) &&
    !/[0-9A-Za-zÀ-ÖØ-öø-ÿ]/.test(caractere)
  )
}

// validarPrefixo(entrada) → { ok, prefixo, motivo }
//   { ok: true,  prefixo: "!", motivo: "" }
//   { ok: false, prefixo: null, motivo: "vazio"|"longo"|"espaco"|"invalido" }
// O motivo é traduzido para uma frase amigável pelo comando /set-prefix.
function validarPrefixo(entrada) {
  const bruto = String(entrada == null ? '' : entrada).trim()

  if (!bruto) return { ok: false, prefixo: null, motivo: 'vazio' }

  // Apelido por nome ("exclamacao" → "!", "slash" → "/")
  const apelido = APELIDOS[bruto.toLowerCase()]
  if (apelido) return { ok: true, prefixo: apelido, motivo: '' }

  if (/\s/.test(bruto)) return { ok: false, prefixo: null, motivo: 'espaco' }
  if (bruto.length > 1) return { ok: false, prefixo: null, motivo: 'longo' }
  if (ehSimboloSeguro(bruto)) return { ok: true, prefixo: bruto, motivo: '' }

  return { ok: false, prefixo: null, motivo: 'invalido' }
}

// Prefixos que o roteador aceita NESTE instante: o configurado (primeiro)
// e, se habilitado, a barra legada "/" (o grupo não perde o costume).
function prefixosAceitos(prefixoAtual = cache || PREFIXO_PADRAO) {
  const atual = prefixoAtual || PREFIXO_PADRAO
  if (atual === PREFIXO_PADRAO) return [PREFIXO_PADRAO]
  return ACEITAR_BARRA_LEGADA ? [atual, PREFIXO_PADRAO] : [atual]
}

// -------------------------------------------------------------------
// 🗄️ COLEÇÃO (MongoDB) — usada só por carregarPrefixo/definirPrefixo
// -------------------------------------------------------------------
async function obterColecao() {
  // Modo teste: collection injetada, sem tocar em rede.
  if (modoTeste && colecaoCacheada) return colecaoCacheada

  if (colecaoCacheada && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return colecaoCacheada
    } catch (erroPing) {
      console.error('⚠️ [prefixo] conexão anterior com o MongoDB morreu — reconectando:', erroPing?.message)
      try { await clienteMongo.close() } catch (e) { /* já morta */ }
      clienteMongo = null
      colecaoCacheada = null
    }
  }

  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 MONGODB_URI NÃO CONFIGURADA — o prefixo dos comandos não persiste!')
    console.error('   Sem ela, o bot reinicia sempre no "/" (o /set-prefix avisa o dono).')
    console.error('   → No Render: Settings → Environment → variável MONGODB_URI')
    console.error('   → Local: adicione MONGODB_URI no arquivo .env da raiz')
    console.error('════════════════════════════════════════════════════════')
    throw new Error('MONGODB_URI ausente — impossível salvar o prefixo dos comandos')
  }

  try {
    console.log(`🗄️ [prefixo] conectando ao MongoDB (db: ${NOME_BANCO}, collection: ${NOME_COLECAO})...`)
    clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
    await clienteMongo.connect()
    await clienteMongo.db('admin').command({ ping: 1 })

    colecaoCacheada = clienteMongo.db(NOME_BANCO).collection(NOME_COLECAO)
    // Índice único no _id (garante UM documento global, sem duplicata).
    await colecaoCacheada.createIndex({ _id: 1 }, { unique: true, name: 'idx_prefixo_global' })
    console.log('✅ [prefixo] MongoDB conectado — o prefixo dos comandos persiste entre redeploys.')
    return colecaoCacheada
  } catch (erro) {
    clienteMongo = null
    colecaoCacheada = null
    throw erro
  }
}

// -------------------------------------------------------------------
// 📖 LEITURA (com cache; NUNCA lança — degrada para o padrão "/")
// -------------------------------------------------------------------
async function carregarPrefixo() {
  // Cache válido: só reconsulta quando a ÚLTIMA tentativa falhou E a janela
  // de retentativa (60s) já passou. Assim uma queda do Mongo vira 1 erro em
  // log — não uma consulta por mensagem — e o bot se recupera sozinho.
  if (cache !== null) {
    const dentroDaJanela =
      ultimoErroEm !== 0 && (Date.now() - ultimoErroEm) < INTERVALO_RETENTAR_MS
    return cache // degradado, sem I/O até a janela passar
  }

  // Uma leitura por vez (evita rajada de consultas no 1º boot).
  if (leituraEmVoo) return leituraEmVoo

  leituraEmVoo = (async () => {
    try {
      const colecao = await obterColecao()
      const doc = await colecao.findOne({ _id: ID_DOCUMENTO })
      const validado = validarPrefixo(doc?.prefixo)
      cache = validado.ok ? validado.prefixo : PREFIXO_PADRAO
      ultimoErroEm = 0
      return cache
    } catch (erro) {
      // Degradação segura: sem Mongo (ou com Mongo fora) o bot continua no
      // "/" e o /set-prefix avisa o dono quando ele tentar gravar.
      console.error('⚠️ [prefixo] falha ao ler o prefixo (seguindo no padrão "/") :', erro?.message || erro)
      cache = PREFIXO_PADRAO
      ultimoErroEm = Date.now()
      return cache
    } finally {
      leituraEmVoo = null
    }
  })()

  return leituraEmVoo
}

// obterPrefixo() → Promise<string> — o que o roteador chama a cada
// mensagem (cache; a 1ª vez vai ao Mongo). NUNCA lança.
function obterPrefixo() {
  return carregarPrefixo()
}

// prefixoSincrono() → string — leitura instantânea do CACHE (sem I/O).
// Usada em textos (menus, mensagens de erro) que não querem esperar o
// Mongo; devolve o padrão enquanto a 1ª leitura não terminou.
function prefixoSincrono() {
  return cache || PREFIXO_PADRAO
}

// -------------------------------------------------------------------
// ✍️ ESCRITA (/set-prefix) — grava no Mongo e atualiza o cache na HORA
// -------------------------------------------------------------------
// definirPrefixo(entrada) → { ok, prefixo, anterior, inalterado, motivo }
//   motivo (quando !ok): "vazio" | "longo" | "espaco" | "invalido" | "banco"
async function definirPrefixo(entrada) {
  const validado = validarPrefixo(entrada)
  if (!validado.ok) {
    const atual = prefixoSincrono()
    return { ok: false, prefixo: atual, anterior: atual, inalterado: false, motivo: validado.motivo }
  }

  // Garante que sabemos o valor ANTERIOR (lê do Mongo se ainda não leu) —
  // só para a mensagem de confirmação e para o log.
  const anterior = await carregarPrefixo()

  if (validado.prefixo === anterior) {
    return { ok: true, prefixo: anterior, anterior, inalterado: true, motivo: '' }
  }

  try {
    const colecao = await obterColecao()
    await colecao.updateOne(
      { _id: ID_DOCUMENTO },
      { $set: { prefixo: validado.prefixo, atualizado_em: Date.now() } },
      { upsert: true }
    )
    // ⚡ Tempo real: o cache muda AGORA — a próxima mensagem já é roteada
    // pelo prefixo novo, sem reiniciar o bot.
    cache = validado.prefixo
    ultimoErroEm = 0
    console.log(`🔤 [prefixo] prefixo dos comandos alterado: "${anterior}" → "${validado.prefixo}"`)
    return { ok: true, prefixo: validado.prefixo, anterior, inalterado: false, motivo: '' }
  } catch (erro) {
    console.error('❌ [prefixo] falha ao gravar o prefixo:', erro?.message || erro)
    return { ok: false, prefixo: anterior, anterior, inalterado: false, motivo: 'banco', erro }
  }
}

// resetarPrefixo() → volta ao "/" (mesma assinatura de definirPrefixo).
function resetarPrefixo() {
  return definirPrefixo(PREFIXO_PADRAO)
}

// -------------------------------------------------------------------
// 🔎 ROTEAMENTO (puro — o bot.js chama isso a cada mensagem)
// -------------------------------------------------------------------
// removerPrefixo(texto) → texto SEM o prefixo (ou o próprio texto, se não
// tiver prefixo). Substitui o antigo `text.slice(1)` fixo, que assumia "/"
// e 1 caractere. Usado pelo /renomear para ler os argumentos.
function removerPrefixo(texto, prefixoAtual = prefixoSincrono()) {
  const bruto = String(texto == null ? '' : texto)
  for (const p of prefixosAceitos(prefixoAtual)) {
    if (bruto.startsWith(p)) return bruto.slice(p.length)
  }
  return bruto
}

// resolverNomeComando(texto) → nome do comando em minúsculas, ou:
//   - null → a mensagem NÃO é comando (não começa com prefixo aceito) —
//           o roteador manda pro fluxo de texto livre (jogos/IA);
//   - ''   → é o prefixo sozinho, sem nome (ex.: "/" ou "!") — o
//           roteador ignora em silêncio (não vira texto livre).
function resolverNomeComando(texto, prefixoAtual = prefixoSincrono()) {
  const bruto = String(texto == null ? '' : texto)
  for (const p of prefixosAceitos(prefixoAtual)) {
    if (bruto.startsWith(p)) {
      return bruto.slice(p.length).split(/\s+/)[0].toLowerCase()
    }
  }
  return null
}

// ehComando(texto) → true quando a mensagem abre com um prefixo aceito.
function ehComando(texto, prefixoAtual = prefixoSincrono()) {
  const bruto = String(texto == null ? '' : texto)
  return prefixosAceitos(prefixoAtual).some((p) => bruto.startsWith(p))
}

// -------------------------------------------------------------------
// 🧪 GANCHOS DE TESTE (não afetam a produção; mesmo padrão do vip.js)
// -------------------------------------------------------------------
// Injeta um prefixo fixo, sem Mongo (testes offline do /set-prefix e do
// roteador). `null` volta ao modo real (lê do Mongo).
function __definirPrefixoTeste(p) {
  if (typeof p === 'string' && p.length > 0) {
    const validado = validarPrefixo(p)
    cache = validado.ok ? validado.prefixo : PREFIXO_PADRAO
  } else {
    cache = null
  }
  ultimoErroEm = 0
  leituraEmVoo = null
}

// Injeta uma collection FAKE (mesmo contrato mínimo do driver MongoDB
// usado nos outros testes do projeto: findOne + updateOne com $set/upsert).
function __definirColecaoTeste(colecao) {
  if (colecao) {
    colecaoCacheada = colecao
    modoTeste = true
  } else {
    colecaoCacheada = null
    modoTeste = false
    cache = null
    ultimoErroEm = 0
  }
  leituraEmVoo = null
}

// Zera o cache (o próximo obterPrefixo() volta a ler do Mongo).
function __limparCacheTeste() {
  cache = null
  ultimoErroEm = 0
  leituraEmVoo = null
}

module.exports = {
  PREFIXO_PADRAO,
  ACEITAR_BARRA_LEGADA,
  NOME_BANCO,
  NOME_COLECAO,
  ID_DOCUMENTO,
  APELIDOS,
  validarPrefixo,
  prefixosAceitos,
  obterPrefixo,
  prefixoSincrono,
  definirPrefixo,
  resetarPrefixo,
  removerPrefixo,
  resolverNomeComando,
  ehComando,
  // 🧪
  __definirPrefixoTeste,
  __definirColecaoTeste,
  __limparCacheTeste
}