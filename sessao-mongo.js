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
// 3) ⚠️ FIX DE INTEGRAÇÃO (vestirColecaoAuth): o mongo-baileys faz TODA
//    escrita como `$set: <o valor recebido>` (writeData → updateOne) — mas
//    o MongoDB exige OBJETO no $set. A Baileys grava 3 formas diferentes:
//
//    a) OBJETO puro (maioria): pre-key, app-state-sync-key/version,
//       sender-key-memory, sender-key (em alguns caminhos) → $set direto ok;
//
//    b) BUFFER CRU como valor (lib/Signal/libsignal.js):
//         linha 361: keys.set({ session: { [jid]: session.serialize() } })
//         linha 419: keys.set({ 'sender-key': { [id]: Buffer.from(...) } })
//       → $set: <Buffer> seria serializado como DOCUMENTO de índices
//         numéricos ("0","1","2"...), corrompendo os bytes. Fix: guardar os
//         bytes num campo dedicado (__rawBuffer__) e, na leitura, devolver
//         um Binary — que o conversor da própria mongo-baileys transforma
//         de volta no Buffer EXATO, byte a byte.
//
//    c) PRIMITIVO como valor (lib/Signal/lid-mapping.js:69-75):
//         keys.set({ 'lid-mapping': { [telefone]: lidUser,
//                                     [lidUser+'_reverse']: telefone } })
//       → valores são STRINGS puras (números de telefone ↔ LID), gravados
//         EM MASSA na sincronização logo após o QR. $set: "554184062975"
//         derruba o servidor com "Modifiers operate on fields but we found
//         type string instead" — e como la mongo-baileys engole o erro, o
//         mapeamento nunca persiste e a Baileys tenta gravar de novo a cada
//         evento: o LOOP infinito de erros pós-QR.
//
//    d) ARRAY como valor (lib/Socket/messages-send.js:253-262):
//         keys.set({ 'device-list': { [teléfono]: [dispositivo, ...] } })
//       → device-list guarda a lista de dispositivos vinculados como ARRAY
//         PURO de strings (["38", "0", ...]). $set: <array> também é inválido
//         (MongoServerError: "we found type array instead"). Na leitura o
//         Baileys espera o array original com .includes/.push/.filter
//         (lib/Signal/libsignal.js:215-225).
//
//    ✋ RESULTADO: tanto (c) como (d) — e null/undefined defensivo — são
//       guardados no MESMO campo dedicado (__rawValue__) e devolvidos PUROS
//       na leitura (strings/números/booleanos/arrays atravessam o conversor
//       da lib intactos).
//
// 4) ERROS RUIDOSOS: falha de conexão/autenticação com o Atlas é logada
//    com causa provável e RELANÇADA — o bot nunca fica travado em
//    silêncio (startBot().catch já imprime "Falha ao iniciar/reconectar").
// ============================================================

const { MongoClient } = require('mongodb')

// Campos dedicados (cada tipo de valor cru tem o seu):
const CHAVE_BUFFER_CRU = '__rawBuffer__' // valores Buffer (session/sender-key/identity-key)
const CHAVE_VALOR_CRU = '__rawValue__'   // valores primitivos (lid-mapping: strings) e arrays

// 🪵 LOG TEMPORÁRIO de diagnóstico: imprime o TIPO de cada valor antes de
// gravar. Deixe true na primeira conexão pós-migração; vire false (ou remova)
// quando o bot estiver estável, para não poluir o log do Render.
const LOG_ESCRITAS = true

// Descrição compacta do tipo do valor, para o log de diagnóstico
function descreverTipo(valor) {
  if (Buffer.isBuffer(valor)) return `Buffer(${valor.length} bytes)`
  if (valor === null) return 'null'
  if (Array.isArray(valor)) return `array(${valor.length})`
  return typeof valor
}

/**
 * Envolve a collection do MongoDB com os fixes de integração (itens 3a–3d
 * do cabeçalho: objeto → $set direto; Buffer → __rawBuffer__; primitivo,
 * array, null e undefined → __rawValue__). Mantém a MESMA superfície usada
 * pela mongo-baileys:
 * updateOne(filtro, {$set}, opcoes) / findOne(filtro) / deleteOne(filtro).
 */
function vestirColecaoAuth(colecao) {
  return {
    updateOne(filtro, update, opcoes) {
      const set = update && !Array.isArray(update) ? update.$set : undefined
      const chave = filtro && filtro._id

      // 🪵 Diagnóstico temporário: tipo de cada valor antes de gravar
      if (LOG_ESCRITAS) {
        console.log(`[sessao-mongo] ✍️ ${descreverTipo(set)} → ${chave}`)
      }

      if (Buffer.isBuffer(set)) {
        // (3b) VALOR CRU — Buffer: session/sender-key/identity-key. Os bytes
        // vão num campo dedicado; a leitura devolve Binary e a lib converte
        // de volta para el Buffer exato. (NÃO MEXER: já validado byte a byte)
        return colecao.updateOne(
          filtro,
          { $set: { [CHAVE_BUFFER_CRU]: set } },
          opcoes
        )
      }

      if (Array.isArray(set)) {
        // (3d) VALOR CRU — ARRAY: device-list guarda a lista de dispositivos
        // como array puro (["38", "0", ...]). `$set: <array>` é inválido no
        // MongoDB ("we found type array instead"). MESMO mecanismo do
        // primitivo: campo dedicado __rawValue__ + devolução pura na leitura
        // (o array original, com .includes/.push/.filter, como o Baileys espera).
        return colecao.updateOne(
          filtro,
          { $set: { [CHAVE_VALOR_CRU]: set } },
          opcoes
        )
      }

      if (set === null || typeof set !== 'object') {
        // (3c) VALOR CRU — primitivo (string/number/boolean) ou null/undefined:
        // lid-mapping grava telefone↔LID como STRING pura. $set direto com
        // primitivo é inválido no MongoDB ("Modifiers operate on fields").
        // Guardamos o valor num campo dedicado e devolvemos o primitivo puro
        // na leitura (o conversor da lib não altera primitivos).
        // ⚠️ DEFENSIVO: undefined não é BSON válido → normalizado a null.
        const valorAGuardar = set === undefined ? null : set
        if (set === undefined) {
          console.log(`[sessao-mongo] ⚠️ valor undefined para ${chave} — guardado como null (defensivo)`)
        }
        return colecao.updateOne(
          filtro,
          { $set: { [CHAVE_VALOR_CRU]: valorAGuardar } },
          opcoes
        )
      }

      // (3a) OBJETO puro — pre-key, app-state-sync-key/version,
      // sender-key-memory, creds, etc. → $set direto, como a lib espera.
      return colecao.updateOne(filtro, update, opcoes)
    },

    async findOne(filtro, opcoes) {
      const doc = await colecao.findOne(filtro, opcoes)
      if (doc && CHAVE_BUFFER_CRU in doc) {
        // Binary vindo do driver → convertBinaryToBuffer da lib retorna
        // el Buffer original (mesmo mecanismo do resto da sessão)
        return doc[CHAVE_BUFFER_CRU]
      }
      if (doc && CHAVE_VALOR_CRU in doc) {
        // VALOR CRU → devolvido PURO no formato original:
        //  - string/número/boolean do lid-mapping → atravessan intactos;
        //  - ARRAY do device-list → volta como array real (BSON array →
        //    Array JS), com .includes/.push/.filter disponíveis;
        //  - null/undefined normalizado → null (falsy, como espera la lib).
        return doc[CHAVE_VALOR_CRU]
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
