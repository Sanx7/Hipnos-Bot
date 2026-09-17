// ============================================================
// 🎲 rpg/database.js — Persistência do RPG "vida real" no MongoDB
// ============================================================
// Módulo de acesso a dados da Fase 0 do sistema de RPG.
// Segue EXATAMENTE o mesmo padrão de conexão já usado no resto do
// projeto (sessao-mongo.js e database.js):
//   - SINGLETON: um único MongoClient criado uma vez no processo
//   - PING DE SAÚDE a cada uso + reconexão automática se a conexão
//     anterior morreu
//   - ERROS RUIDOSOS: falha de conexão/autenticação é logada com causa
//     provável e RELANÇADA — o bot nunca fica travado em silêncio
//
// Collection dedicada: banco "whatsapp" (MONGODB_DB, mesmo do ranking),
// collection "rpgPlayers" (sobrescrevível via MONGODB_COLLECTION_RPG).
//
// 🪪 REGRA DE IDENTIDADE DOS JOGADORES (LID) — NÃO ESQUECER NAS PRÓXIMAS
// FASES! O WhatsApp v7 às vezes entrega o remetente como "@lid"
// (ex.: "175952680210489@lid") em vez do número real. Gravar o LID como
// jid do jogador quebra QUALQUER base indexada por telefone (é o MESMO
// bug que o /darvip já teve com os VIPs). Portanto:
//   - TODO jogador é identificado pelo NÚMERO REAL (só dígitos);
//   - getPlayer()/savePlayer() resolvem @lid → número AUTOMATICAMENTE via
//     lid.js (mapeamento "lid-mapping" da sessão Mongo, com cache) — é a
//     rede de segurança p/ comandos futuros que esquecerem de resolver;
//   - os comandos (registrar/ficha/testrpg...) resolvem ANTES com os
//     METADADOS do grupo (mais forte — cobre mapeamento não sincronizado),
//     mesmo padrão do /darvip (comandos/menu-vip/darvip.js);
//   - corrigirJogadoresComLid() varre a collection e corrige/mescla
//     registros legados gravados com @lid (rodada pelo
//     scripts/migrar-rpg-lid.js — mesma ideia do migrar-vip-lid.js).
// Se um comando futuro da Fase 2+ precisar do jid do jogador, use
// getPlayer() normalmente — ele já devolve o doc chaveado pelo número
// real. NUNCA grave o jid cru de msg.key direto no banco.
// ============================================================

const { MongoClient } = require('mongodb')
// 🪪 Resolução LID→número real REUTILIZADA do lid.js (nada de lógica nova
// paralela — o mesmo módulo que conserta os VIPs).
const { resolverNumeroAlvo, resolverLidParaTelefone } = require('../lid')

const NOME_BANCO = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO = process.env.MONGODB_COLLECTION_RPG || 'rpgPlayers'

// Singleton do processo: sobrevive a reconexões do startBot() e a
// múltiplas chamadas de getPlayer/savePlayer
let clienteMongo = null
let colecaoCacheada = null
// 🧪 Modo teste (scripts/teste-rpg-fase1.js): usa a collection injetada
// pelo gancho __definirColecaoTeste e NÃO conecta ao MongoDB real.
// Mesmo padrão de vip.js / configuracoes-grupo.js / afk.js.
let modoTeste = false

// ⚠️ IMPORTANTE: valores padrão c/ referência
// (objetos/arrays) NÃO podem ser compartilhados entre chamadas.
// A função cria um objeto novo a cada getPlayer().
function criarJogadorPadrao(jid) {
  return {
    jid: String(jid || ''),
    nome: null,
    genero: null,       // "M" ou "F", definido no /registrar
    idade: 18,
    carteira: 0,
    banco: 0,
    emprego: null,
    cargo: 1,
    xpTrabalho: 0,       // XP do cargo atual, reseta ao trocar de emprego
    xpTierTotal: 0,      // XP acumulado de todos os empregos, nunca reseta
    empregosAnteriores: [],
    casado: null,
    filhos: [],
    casas: [],           // array de chaves de imóveis possuídos (acumulativo)
    carros: [],           // array de chaves de carros possuídos (máx 5, validado depois)
    fama: 0,
    fome: 100,
    energia: 100,
    preso: false,
    inventario: [],
    cooldowns: {},
    criadoEm: Date.now()
  }
}

// -------------------------------------------------------------------
// Obtém a collection de jogadores do RPG, conectando se necessário.
// Valida a conexão com ping antes de reusar e reconecta se morreu.
// Erros são logados com causa provável e RELANÇADOS.
// -------------------------------------------------------------------
async function obterColecaoRpg() {
  // 🧪 No modo teste, devolve a collection injetada SEM tocar em rede.
  if (modoTeste && colecaoCacheada) return colecaoCacheada

  if (colecaoCacheada && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return colecaoCacheada
    } catch (erroPing) {
      console.error(
        '⚠️ [rpg] conexão anterior com o MongoDB morreu — reconectando:',
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
    console.error('💥 MONGODB_URI NÃO CONFIGURADA — o sistema de RPG ficará desativado!')
    console.error('   Sem ela, os dados dos jogadores não persistem entre redeploys.')
    console.error('   → No Render: Settings → Environment → variável MONGODB_URI')
    console.error('   → Local: adicione MONGODB_URI no arquivo .env da raiz')
    console.error('════════════════════════════════════════════════════════')
    throw new Error('MONGODB_URI ausente — impossível conectar ao RPG')
  }

  try {
    console.log(`🗄️ [rpg] conectando ao MongoDB (db: ${NOME_BANCO}, collection: ${NOME_COLECAO})...`)
    clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
    await clienteMongo.connect()
    await clienteMongo.db('admin').command({ ping: 1 })

    const colecao = clienteMongo.db(NOME_BANCO).collection(NOME_COLECAO)

    // Índice único por jid: 1 jogador por número (evita duplicados)
    await colecao.createIndex(
      { jid: 1 },
      { unique: true, name: 'idx_rpg_jid' }
    )

    colecaoCacheada = colecao
    console.log('✅ [rpg] MongoDB conectado — dados dos jogadores persistem entre redeploys.')
    return colecaoCacheada
  } catch (erro) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 FALHA AO CONECTAR AO MONGODB (RPG):', erro?.message)
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
// 🪪 resolverJidJogador(jidBruto): resolve um jid "@lid" para o número
// real REUTILIZANDO o lid.js (resolverNumeroAlvo — ordem: jid direto →
// metadados → mapeamento da sessão). Aqui, SEM metadados do grupo
// (participants = null), a resolução usa o mapeamento "lid-mapping"
// gravado pela Baileys na sessão Mongo (com cache em memória).
//   - jid de número real  → devolvido igual (caminho 'direto', zero custo)
//   - @lid com mapeamento → número real (log de rastreio)
//   - @lid sem mapeamento → LID cru (rede de segurança; os comandos
//     resolvem com metadados ANTES de chamar getPlayer/savePlayer)
// NUNCA lança — a falha de resolução não pode derrubar o comando.
// -------------------------------------------------------------------
async function resolverJidJogador(jidBruto) {
  const jid = String(jidBruto || '').trim()
  // JID de número real (ou vazio): nada a resolver
  if (!jid || !jid.endsWith('@lid')) return jid
  try {
    const resolucao = await resolverNumeroAlvo(null, jid)
    if (resolucao.numero && resolucao.via === 'mapeamento') {
      console.log(`[rpg] 🪪 jid do jogador resolvido de @lid p/ o número real ${resolucao.numero} (mapeamento da sessão)`)
      return resolucao.numero
    }
    console.warn(`[rpg] ⚠️ jid ${jid} veio como @lid SEM mapeamento resolvível — usando o LID cru (rode scripts/migrar-rpg-lid.js quando o mapeamento sincronizar)`)
    return jid
  } catch (erro) {
    console.warn('[rpg] ⚠️ falha ao resolver @lid (seguindo com o jid cru):', erro?.message || erro)
    return jid
  }
}

// -------------------------------------------------------------------
// getPlayer(jid): busca o jogador pelo JID. Se não existir, CRIA
// automaticamente com os valores padrão da Fase 0.
// 🪪 O jid informado pode ser "@lid" — é resolvido para o número real
// ANTES da consulta (ver REGRA DE IDENTIDADE no cabeçalho do arquivo).
// Retorna o documento COMPLETO (já com o jid resolvido).
// Lança erro em caso de falha de conexão (o comando trata).
// -------------------------------------------------------------------
async function getPlayer(jid) {
  const colecao = await obterColecaoRpg()
  const jidLimpo = await resolverJidJogador(jid)

  let jogador = await colecao.findOne({ jid: jidLimpo })
  if (!jogador) {
    const novo = criarJogadorPadrao(jidLimpo)
    // upsert com $setOnInsert: se outro processo criar ao mesmo tempo,
    // o insert não sobrescreve o que já existe
    await colecao.updateOne(
      { jid: jidLimpo },
      { $setOnInsert: novo },
      { upsert: true }
    )
    jogador = await colecao.findOne({ jid: jidLimpo })
  }

  return jogador
}

// -------------------------------------------------------------------
// savePlayer(jid, data): salva/atualiza o jogador (upsert por jid).
// O documento é sobrescrito (upsert) com os dados informados.
// 🪪 O jid informado pode ser "@lid" — é resolvido para o número real
// ANTES de gravar (ver REGRA DE IDENTIDADE no cabeçalho do arquivo).
// -------------------------------------------------------------------
async function savePlayer(jid, data) {
  const colecao = await obterColecaoRpg()
  const jidLimpo = await resolverJidJogador(jid)

  const jogadorGravado = {
    jid: jidLimpo,
    ...(data || {})
  }

  await colecao.updateOne(
    { jid: jidLimpo },
    { $set: jogadorGravado },
    { upsert: true }
  )

  // Substitui o jid do objeto retornado pelo limpo (defensivo)
  if (jogadorGravado.jid !== jidLimpo) jogadorGravado.jid = jidLimpo
  return jogadorGravado
}

// -------------------------------------------------------------------
// Utilitário: merge defensivo de um objeto parcial sobre o jogador.
// Usa o getPlayer (que garante os padrões) e preenche apenas os campos
// fornecidos. Evita deletar campos acidentalmente.
// -------------------------------------------------------------------
async function mergeAtualizacao(jid, dadosParciais) {
  const jogador = await getPlayer(jid)
  if (!dadosParciais || typeof dadosParciais !== 'object') return jogador
  return { ...jogador, ...dadosParciais }
}

// -------------------------------------------------------------------
// 🪪 corrigirJogadoresComLid(): correção PONTUAL dos registros do RPG
// gravados com "@lid" no lugar do número real (mesmo padrão do
// corrigirVipsComLid do vip.js). Para cada registro com jid @lid:
//   - resolve o número real pelo mapeamento da sessão (lid.js);
//   - SEM duplicata → atualiza o campo jid pro número real;
//   - COM duplicata (o bug já criou o jogador duas vezes) → MESCLA os
//     dois documentos (mesclarJogadores abaixo) e APAGA o registro-LID.
// Roda no scripts/migrar-rpg-lid.js. É IDEMPOTENTE.
// NUNCA lança erro por registro — registra e continua.
// -------------------------------------------------------------------
async function corrigirJogadoresComLid() {
  const colecao = await obterColecaoRpg()
  const registros = await colecao.find({}).toArray()

  let corrigidos = 0
  let mesclados = 0
  let naoResolviveis = 0

  for (const registro of registros) {
    // Só registros cujo jid é @lid (números reais passam direto)
    if (!registro.jid || !String(registro.jid).endsWith('@lid')) continue
    try {
      const lid = String(registro.jid).split('@')[0]
      const telefoneReal = await resolverLidParaTelefone(lid)
      if (!telefoneReal || telefoneReal === lid) {
        naoResolviveis += 1
        console.warn(`[rpg] 🪪 LID ${registro.jid} sem mapeamento resolvível — registro mantido (rode de novo quando a sessão sincronizar)`)
        continue
      }

      const existente = await colecao.findOne({ jid: telefoneReal })
      if (existente) {
        // 🔀 Mescla: prefere os dados mais completos dos dois documentos
        const mesclado = mesclarJogadores(existente, registro)
        // replaceOne mantém o _id do doc EXISTENTE (o corpo NÃO pode
        // carregar o _id do registro-LID — campo imutável do Mongo)
        const { _id, ...corpoSemId } = mesclado
        await colecao.replaceOne({ jid: telefoneReal }, corpoSemId)
        await colecao.deleteOne({ jid: registro.jid })
        mesclados += 1
        console.log(`[rpg] 🪪 duplicata mesclada: LID ${registro.jid} → ${telefoneReal} (doc do número real preservado)`)
      } else {
        // ✏️ Correção in-place: troca o LID pelo número real
        await colecao.updateOne(
          { jid: registro.jid },
          { $set: { jid: telefoneReal } }
        )
        console.log(`[rpg] 🪪 registro corrigido: LID ${registro.jid} → ${telefoneReal}`)
      }
      corrigidos += 1
    } catch (erroRegistro) {
      console.error(`[rpg] ⚠️ falha ao corrigir o registro ${registro.jid} (seguindo):`, erroRegistro?.message || erroRegistro)
    }
  }

  return { corrigidos, mesclados, naoResolviveis, total: registros.length }
}
// -------------------------------------------------------------------
// 🔀 mesclarJogadores(docNumeroReal, docLid): união dos dados dos dois
// registros do MESMO jogador (criado em dobro pelo bug). Critério —
// "o mais completo ganha":
//   - Identidade (nome/genero/idade/emprego/casado): o doc do LID
//     preenche quando o doc real ainda está com valor padrão/null
//   - Recursos (carteira, banco, fama, fome, energia, XP, cargo): o
//     MAIOR dos dois — nada de "perder" progresso no merge
//   - Arrays (inventário, casas, carros, filhos, empregos): UNIÃO sem
//     duplicados
//   - cooldowns: objeto fundido, mantendo o timestamp mais recente
//   - Flags (preso): verdadeiro se em qualquer um
//   - criadoEm: o MENOR dos dois (o início real da conta)
//   - O documento BASE é sempre o do número real (jid correto)
// -------------------------------------------------------------------
function mesclarJogadores(docReal, docLid) {
  const base = { ...docReal }
  const outro = { ...docLid }
  delete base._id
  delete outro._id

  const maximo = (a, b) => Math.max(Number(a) || 0, Number(b) || 0)
  const uniArray = (a, b) => {
    const lista = Array.isArray(a) ? a.slice() : []
    for (const item of (Array.isArray(b) ? b : [])) {
      if (!lista.includes(item)) lista.push(item)
    }
    return lista
  }

  // Identidade: preencher o que o real não tem
  if (!base.nome && outro.nome) base.nome = outro.nome
  if (!base.genero && outro.genero) base.genero = outro.genero
  if (outro.idade && base.idade === criarJogadorPadrao('x').idade) base.idade = outro.idade
  if (!base.emprego && outro.emprego) base.emprego = outro.emprego
  if (!base.casado && outro.casado) base.casado = outro.casado

  // Recursos: maior dos dois
  base.carteira = maximo(base.carteira, outro.carteira)
  base.banco = maximo(base.banco, outro.banco)
  base.fama = maximo(base.fama, outro.fama)
  base.fome = maximo(base.fome, outro.fome)
  base.energia = maximo(base.energia, outro.energia)
  base.xpTrabalho = maximo(base.xpTrabalho, outro.xpTrabalho)
  base.xpTierTotal = maximo(base.xpTierTotal, outro.xpTierTotal)
  if ((Number(outro.cargo) || 1) > (Number(base.cargo) || 1)) base.cargo = outro.cargo

  // Coleções: união
  base.empregosAnteriores = uniArray(base.empregosAnteriores, outro.empregosAnteriores)
  base.filhos = uniArray(base.filhos, outro.filhos)
  base.casas = uniArray(base.casas, outro.casas)
  base.carros = uniArray(base.carros, outro.carros)
  base.inventario = uniArray(base.inventario, outro.inventario)

  // Flags / cooldowns
  base.preso = Boolean(base.preso) || Boolean(outro.preso)
  const cooldownsBase = (base.cooldowns && typeof base.cooldowns === 'object') ? base.cooldowns : {}
  const cooldownsOutro = (outro.cooldowns && typeof outro.cooldowns === 'object') ? outro.cooldowns : {}
  base.cooldowns = { ...cooldownsBase }
  for (const acao of Object.keys(cooldownsOutro)) {
    if (typeof cooldownsOutro[acao] === 'number' && cooldownsOutro[acao] > (base.cooldowns[acao] || 0)) {
      base.cooldowns[acao] = cooldownsOutro[acao]
    }
  }

  // Início real da conta
  const criados = [base.criadoEm, outro.criadoEm].filter((v) => typeof v === 'number')
  if (criados.length) base.criadoEm = Math.min(...criados)

  return base
}



// -------------------------------------------------------------------
// 🧪 GANCHO DE TESTE (mesmo padrão dos demais módulos): injeta uma
// collection fake e desativa a conexão real até o fim do processo.
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
  getPlayer,
  savePlayer,
  mergeAtualizacao,
  obterColecaoRpg,
  criarJogadorPadrao,
  resolverJidJogador,
  corrigirJogadoresComLid,
  NOME_BANCO,
  NOME_COLECAO,
  __definirColecaoTeste
}