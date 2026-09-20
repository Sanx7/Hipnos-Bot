// ============================================================
// 🎲 rpg/database.js — Persistência do RPG "vida real" no MongoDB
// ============================================================
// Módulo de acesso a dados do RPG (Fase 0 = base do jogador; Fase 1 =
// identidade; Fase 2 = economia — ver a nota 💰 no fim deste cabeçalho).
//
// 🏝️⚠️ CLUSTER MONGODB DEDICADO DO RPG — LEIA ANTES DE MEXER:
// O RPG NÃO usa a MONGODB_URI do resto do bot. Ele conecta num cluster
// Atlas SEPARADO, via rpg/conexao-mongo.js, com a variável MONGO_URI_RPG.
// ❓ POR QUÊ: isolar o crescimento dos dados do RPG da quota de 512MB do
//    cluster principal — lá vivem a sessão do WhatsApp (Baileys), ranking,
//    VIPs, afk, advertências, lembretes e histórico de IA, e a sessão NÃO
//    pode ficar sem espaço (sem ela o bot cai e precisa reescanear o QR).
// Padrões mantidos (idênticos aos do database.js/sessao-mongo.js):
//   - SINGLETON: um único MongoClient criado uma vez no processo
//   - PING DE SAÚDE a cada uso + reconexão automática se a conexão
//     anterior morreu
//   - ERROS RUIDOSOS: falha de conexão/autenticação é logada com causa
//     provável e RELANÇADA — o bot nunca fica travado em silêncio
//
// Collection dos jogadores (no cluster do RPG): banco "whatsapp"
// (MONGODB_DB_RPG → MONGODB_DB → "whatsapp") e collection "rpgPlayers"
// (sobrescrevível via MONGODB_COLLECTION_RPG).
//
// 🧭 FASE 3 EM DIANTE (empregos, mercado, habitação, roubo...): TODA
//    collection nova do RPG DEVE ser obtida por rpg/conexao-mongo.js
//    (obterColecaoRpg(nome)) — NUNCA pela conexão principal do bot.
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
//
// 💰 FASE 2+ (economia): NUNCA mova dinheiro com "getPlayer → altera o
// objeto → savePlayer" — duas chamadas simultâneas perderiam uma das
// operações. Use os helpers de rpg/economia.js:
//   - moverSaldo(jid, valor, 'depositar'|'sacar')  → 1 update atômico
//     ($inc duplo + filtro $gte no MESMO documento);
//   - transferirEntreJogadores(a, b, valor)        → usa a
//     executarTransacao() abaixo (transação real com ROLLBACK) e, se o
//     deployment não suportar transação, plano compensatório próprio.
// Qualquer operação futura que toque DOIS jogadores (roubo/assalto da
// Fase 7, casamento, empregos de patrão...) deve usar executarTransacao().
// ============================================================

// 🗄️ Conexão DEDICADA do RPG (cluster separado — veja a nota no cabeçalho).
// Toda a lógica de conexão (URI MONGO_URI_RPG, ping, reconexão, índices)
// vive lá; este módulo só consome.
const conexao = require('./conexao-mongo')
// 🪪 Resolução LID→número real REUTILIZADA do lid.js (nada de lógica nova
// paralela — o mesmo módulo que conserta os VIPs). O lid.js continua
// consultando a SESSÃO do WhatsApp no cluster PRINCIPAL (metadados do
// grupo / lid-mapping) — só os DADOS do RPG é que moram no cluster novo.
const { resolverNumeroAlvo, resolverLidParaTelefone } = require('../lid')

// 🏷️ Nomes reutilizados do módulo de conexão (fonte única — os mesmos que
// o migrador e o smoke test enxergam):
const NOME_BANCO = conexao.NOME_BANCO
const NOME_COLECAO = conexao.NOME_COLECAO_PADRAO

// Cache da collection — usado no MODO TESTE p/ guardar a fake injetada.
// (Fora do teste, ping/reconexão/índices ficam em rpg/conexao-mongo.js.)
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
// Obtém a collection de jogadores do RPG NO CLUSTER DEDICADO (delega a
// conexão/ping/reconexão/índices ao rpg/conexao-mongo.js — MONGO_URI_RPG).
// No modo teste, devolve a collection injetada SEM tocar em rede.
// Erros de conexão são logados com causa provável (no módulo de conexão)
// e RELANÇADOS.
// -------------------------------------------------------------------
async function obterColecaoRpg() {
  // 🧪 No modo teste, devolve a collection injetada SEM tocar em rede.
  if (modoTeste && colecaoCacheada) return colecaoCacheada

  // 🏝️ Cluster DEDICADO do RPG (rpg/conexao-mongo.js): resolve URI
  // MONGO_URI_RPG, faz ping, reconecta se morreu e garante o índice
  // único idx_rpg_jid — o MESMO contrato que existia aqui antes.
  colecaoCacheada = await conexao.obterColecaoRpg()
  return colecaoCacheada
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
// 💱 executarTransacao(fn): executa `fn(colecao, sessao)` dentro de uma
// TRANSAÇÃO multi-documento do MongoDB (usada p/ /transferir e futuras
// operações de 2 jogadores — roubo da Fase 7).
//   - Suportado (Atlas/replica set) → { transacional: true, retorno }
//     (o retorno é o valor devolvido por `fn`; falha de negócio dentro
//     de `fn` lança e o withTransaction faz ROLLBACK automático)
//   - Deployment sem suporte (standalone) → { transacional: false }
//     (o chamador usa seu plano compensatório próprio)
//   - Sem cliente ativo (modo teste) → lança erro com
//     codigo = 'TRANSACAO_INDISPONIVEL' (o chamador faz o fallback)
// Erros reais (rede/abort) são RELANÇADOS — o comando trata.
// -------------------------------------------------------------------
function transacaoNaoSuportada(err) {
  const msg = String(err?.message || '')
  return (
    err?.code === 40515 ||
    /Transaction numbers are only allowed/i.test(msg) ||
    /transactions are not supported/i.test(msg) ||
    /not supported on standalone/i.test(msg) ||
    /requires a replica set/i.test(msg)
  )
}

async function executarTransacao(fn) {
  // 🏝️ Cliente do CLUSTER DEDICADO do RPG (null no modo teste / conexão
  // ainda não aberta → o chamador usa o fallback compensatório)
  const cliente = conexao.clienteRpg()
  if (!cliente) {
    const erro = new Error('Transação indisponível: sem cliente Mongo ativo (modo teste)')
    erro.codigo = 'TRANSACAO_INDISPONIVEL'
    throw erro
  }
  const sessao = cliente.startSession()
  try {
    let retorno
    await sessao.withTransaction(async () => {
      const colecao = await obterColecaoRpg()
      retorno = await fn(colecao, sessao)
    })
    return { transacional: true, retorno }
  } catch (err) {
    if (transacaoNaoSuportada(err)) return { transacional: false }
    throw err
  } finally {
    try { await sessao.endSession() } catch (e) { /* sessão já encerrada */ }
  }
}

// -------------------------------------------------------------------
// 🧪 GANCHO DE TESTE (mesmo padrão dos demais módulos): injeta uma
// collection fake e desativa a conexão real até o fim do processo.
// Passando `null`, o modo teste é desligado e o módulo volta a exigir
// MONGO_URI_RPG (útil p/ provar que o erro sem URI é ruidoso).
// -------------------------------------------------------------------
function __definirColecaoTeste(colecao) {
  if (colecao) {
    colecaoCacheada = colecao
    modoTeste = true
  } else {
    colecaoCacheada = null
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
  executarTransacao,
  NOME_BANCO,
  NOME_COLECAO,
  __definirColecaoTeste
}