// ============================================================
// 🗄️ sessao-mongo.js — Persistência da sessão do WhatsApp no MongoDB
// ============================================================
// O Render (plano free) tem sistema de arquivos EFÊMERO: a pasta ./auth
// (useMultiFileAuthState) sumia a cada redeploy/restart, forçando novo
// QR Code. A sessão agora vive no MongoDB Atlas e sobrevive a restarts.
//
// Por que este módulo existe (e não chamamos a lib direto no bot.js):
//
// 1) SINGLETON: o bot.js reinvoca startBot() a cada reconexão do Baileys.
//    Conectar um MongoClient novo a cada chamada vazaria conexões. Aqui a
//    conexão é criada UMA vez, revalidada com ping a cada uso e refeita
//    se tiver morrido.
//
// 2) PING DE SAÚDE: serverSelectionTimeoutMS só cobre o handshake inicial.
//    Sem o ping explícito, URI errada/IP não liberado no Atlas poderia
//    passar despercebido até a primeira escrita.
//
// 3) ⚠️ FIX DE INTEGRAÇÃO (vestirColecaoAuth): a Baileys grava ALGUMAS
//    chaves de sessão com valor BUFFER CRU — lib/Signal/libsignal.js:
//      linha 361: keys.set({ session: { [jid]: session.serialize() } })
//      linha 419: keys.set({ 'sender-key': { [id]: Buffer.from(...) } })
//    O mongo-baileys faz writeData com `$set: <o valor>` — e um Buffer
//    cru na posição de $set é serializado pelo driver como DOCUMENTO de
//    chaves numéricas ("0","1","2"...), CORROMPENDO os bytes. Na leitura,
//    a sessão voltaria como objeto estragado em vez de Buffer.
//    O wrapper detecta $set com Buffer cru, guarda os bytes num campo
//    dedicado e, na leitura, devolve um Binary — que o conversor da
//    própria mongo-baileys (convertBinaryToBuffer) transforma de volta
//    no Buffer EXATO, byte a byte.
//
// 4) ERROS RUIDOSOS: falha de conexão/autenticação com o Atlas é logada
//    com causa provável e RELANÇADA — o bot nunca fica travado em
//    silêncio (startBot().catch já imprime "Falha ao iniciar/reconectar").
// ============================================================

const { MongoClient } = require('mongodb')

// Campo dedicado usado apenas para valores de chave que são Buffer cru
const CHAVE_BUFFER_CRU = '__rawBuffer__'

/**
 * Envolve a collection do MongoDB com o fix de Buffer cru (item 3 acima).
 * Mantém a MESMA superfície usada pela mongo-baileys:
 * updateOne(filtro, {$set}, opcoes) / findOne(filtro) / deleteOne(filtro).
 */
function vestirColecaoAuth(colecao) {
  return {
    updateOne(filtro, update, opcoes) {
      if (
        update &&
        !Array.isArray(update) &&
        Buffer.isBuffer(update.$set)
      ) {
        // Valor CRU (ex.: session/sender-key da Baileys): bytes puros num
        // campo dedicado — na leitura, devolvemos o Binary e a lib converte
        // de volta para o Buffer exato.
        return colecao.updateOne(
          filtro,
          { $set: { [CHAVE_BUFFER_CRU]: update.$set } },
          opcoes
        )
      }
      return colecao.updateOne(filtro, update, opcoes)
    },

    async findOne(filtro, opcoes) {
      const doc = await colecao.findOne(filtro, opcoes)
      if (doc && CHAVE_BUFFER_CRU in doc) {
        // Binary vindo do driver → convertBinaryToBuffer da lib retorna
        // o Buffer original (mesmo mecanismo do resto da sessão)
        return doc[CHAVE_BUFFER_CRU]
      }
      return doc
    },

    deleteOne(filtro, opcoes) {
      return colecao.deleteOne(filtro, opcoes)
    }
  }
}

// Singleton do processo: sobrevive às reinvoções de startBot()
let clienteMongo = null
let colecaoCacheada = null

/**
 * Conecta ao MongoDB (uma única vez) e devolve a collection de sessão
 * JÁ VESTIDA com o fix de Buffer cru. Revalida a conexão com ping a cada
 * chamada e reconecta sozinha se a conexão anterior tiver morrido.
 * Erros são logados com causa provável e RELANÇADOS.
 */
async function obterColecaoAuth() {
  // Conexão já existente? Confere a saúde antes de reusar
  if (colecaoCacheada && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return colecaoCacheada
    } catch (erroPing) {
      console.error(
        '⚠️ [sessao-mongo] conexão anterior com o MongoDB morreu — reconectando:',
        erroPing?.message
      )
      try { await clienteMongo.close() } catch (e) { /* já morta */ }
      clienteMongo = null
      colecaoCacheada = null
    }
  }

  const uri = process.env.MONGODB_URI
  if (!uri) {
    // 💥 Falha RUIDOSA e imediata: sem URI não há como persistir a sessão
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 MONGODB_URI NÃO CONFIGURADA — a sessão do WhatsApp não pode ser salva!')
    console.error('   Sem ela, a cada restart do Render o bot pedirá um NOVO QR CODE.')
    console.error('   → No Render: Settings → Environment → variável MONGODB_URI')
    console.error('   → Local: adicione MONGODB_URI no arquivo .env da raiz')
    console.error('   Ex.: mongodb+srv://usuario:senha@cluster0.xxxxx.mongodb.net/?retryWrites=true')
    console.error('════════════════════════════════════════════════════════')
    throw new Error('MONGODB_URI ausente — impossível carregar/persistir a sessão do WhatsApp')
  }

  // Nomes do banco/collection com defaults conforme a migração
  // (sobrescrevíveis sem código, só com variável de ambiente)
  const nomeBanco = process.env.MONGODB_DB || 'whatsapp'
  const nomeColecao = process.env.MONGODB_COLLECTION || 'authState'

  try {
    console.log(`🗄️ [sessao-mongo] conectando ao MongoDB (db: ${nomeBanco}, collection: ${nomeColecao})...`)
    clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
    await clienteMongo.connect()
    // Ping de verdade: valida credenciais + rede + whitelist de IP do Atlas
    await clienteMongo.db('admin').command({ ping: 1 })
    colecaoCacheada = vestirColecaoAuth(
      clienteMongo.db(nomeBanco).collection(nomeColecao)
    )
    console.log('✅ [sessao-mongo] MongoDB conectado — a sessão agora sobrevive a restarts.')
    return colecaoCacheada
  } catch (erro) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 FALHA AO CONECTAR AO MONGODB (sessão de autenticação):', erro?.message)
    console.error('   Causas mais comuns:')
    console.error('   → MONGODB_URI com usuário/senha/cluster errados')
    console.error('   → IP não liberado no Atlas: Network Access → 0.0.0.0/0')
    console.error('     (o Render free usa IPs de saída dinâmicos)')
    console.error('   → Cluster pausado ou sem armazenamento no Atlas free tier')
    console.error('   O bot NÃO consegue restaurar a sessão até isso ser resolvido.')
    console.error('════════════════════════════════════════════════════════')
    try { await clienteMongo?.close() } catch (e) { /* nada a fechar */ }
    clienteMongo = null
    colecaoCacheada = null
    throw erro // propaga: startBot().catch loga "Falha ao iniciar/reconectar"
  }
}

module.exports = { obterColecaoAuth, vestirColecaoAuth }
