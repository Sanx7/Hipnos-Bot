// ============================================================
// ⏰ lembretes.js — Sistema de Lembretes (/lembrete) (MongoDB)
// ============================================================
// Módulo responsável por TODA a lógica de persistência E DE DISPARO dos
// lembretes ("/lembrete 2h Beber água"). Segue EXATAMENTE o mesmo padrão
// de conexão do resto do projeto (afk.js, database.js, vip.js):
//   - Collection dedicada: banco "whatsapp" (MONGODB_DB), collection
//     "lembretes" (sobrescrevível via MONGODB_COLLECTION_LEMBRETE);
//   - SINGLETON: um único MongoClient criado uma vez no processo;
//   - PING DE SAÚDE a cada uso + reconexão automática se a conexão morreu;
//   - ERROS RUIDOSOS: falha de conexão é logada com causa provável.
//
// ⚠️ POR QUE PERSISTIR NO MONGO (e não em memória/setTimeout)?
// O Render reinicia o processo a cada redeploy/restart (filesystem efêmero
// e memória zerada — o mesmo motivo que já derrubou o /welcome antigo e
// forçou a sessão do Baileys a ir para o Mongo). Um setTimeout em memória
// perderia TODOS os lembretes pendentes no redeploy. Com o Mongo, o
// agendador pode até estar dormindo: no próximo boot ele relê o banco,
// encontra o que venceu e entrega (ver verificarLembretes).
//
// ESTRUTURA DO DOCUMENTO (collection "lembretes"):
//   {
//     numero:     "5511999999999",  // APENAS dígitos (número REAL, sem LID)
//     grupo_id:   "12036...@g.us",  // grupo de origem ou null (criado no PV)
//     texto:      "Beber água",     // o que avisar
//     disparar_em: 1700000000000,   // quando avisar (timestamp ms, UTC)
//     enviado:    false,            // já foi entregue?
//     // — campos de apoio (fora do contrato mínimo, só p/ diagnóstico):
//     criado_em:  1700000000000,    // quando foi agendado
//     enviado_em: null,             // quando foi entregue (ms) | null
//     tentativas: 0,                // falhas de envio acumuladas
//     erro:       null              // última falha de envio (texto curto)
//   }
//
// ÍNDICES:
//   - { enviado: 1, disparar_em: 1 } — a consulta quente do agendador;
//   - { numero: 1, enviado: 1 }      — /meuslembretes e o limite por usuário.
//
// 🧹 RETENÇÃO: lembretes já enviados são apagados depois de 7 dias
// (limparAntigos), mantendo a collection pequena — a quota do Atlas free
// tier (512MB) é justamente o que NÃO pode ser estourada: a sessão do
// WhatsApp vive no mesmo cluster.
// ============================================================

const { MongoClient } = require('mongodb')

// ⚙️ config.js carrega o .env da raiz para o process.env (mesmo padrão de
// afk.js / vip.js / configuracoes-grupo.js) — garante que MONGODB_URI
// exista mesmo se este módulo for importado antes do bot.js.
const { limparNumero } = require('./config')
// 🪪 resolução LID→número real (PROOF-LID) usada por obterNumeroRemetente
const { resolverNumeroAlvo } = require('./lid')

const NOME_BANCO = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO = process.env.MONGODB_COLLECTION_LEMBRETE || 'lembretes'

// ⏱️ Ritmo do agendador (setInterval do bot) e limites de uso
const INTERVALO_VERIFICACAO_MS = 30000               // checa o Mongo a cada 30s
const LOTE_MAX = 50                                  // máx. de envios por rodada
const MAX_TENTATIVAS_ENVIO = 5                       // após isso, desiste (marca enviado + erro)
const MAX_POR_USUARIO = 10                           // lembretes ATIVOS por usuário
const MINIMO_MS = 60000                              // 1 minuto (a checagem roda a cada 30s)
const LIMITE_FUTURO_MS = 365 * 24 * 60 * 60 * 1000   // no máximo 1 ano à frente
const TEXTO_MAX = 300                                // textos maiores são truncados (com aviso)
const FUSO = 'America/Sao_Paulo'                     // horários absolutos (%HH:MM) são deste fuso
const RETENCAO_ENVIADOS_MS = 7 * 24 * 60 * 60 * 1000 // limpa enviados após 7 dias
const INTERVALO_LIMPEZA_MS = 6 * 60 * 60 * 1000      // roda a limpeza no máx. a cada 6h

// Singleton do processo: sobrevive às reconexões do startBot()
let clienteMongo = null
let colecaoCacheada = null
// 🧪 Modo teste (gancho __definirColecaoTeste): usa a collection injetada
// e NÃO conecta ao MongoDB real (mesmo padrão de afk.js/vip.js).
let modoTeste = false

// -------------------------------------------------------------------
// Obtém a collection de lembretes, conectando se necessário. Valida a
// conexão com ping antes de reusar e reconecta se a anterior morreu.
// Erros são logados com causa provável e RELANÇADOS (os comandos e o
// agendador tratam).
// -------------------------------------------------------------------
async function obterColecaoLembretes() {
  // 🧪 No modo teste, devolve a collection injetada SEM tocar em rede.
  if (modoTeste && colecaoCacheada) return colecaoCacheada

  if (colecaoCacheada && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return colecaoCacheada
    } catch (erroPing) {
      console.error(
        '⚠️ [lembretes] conexão anterior com o MongoDB morreu — reconectando:',
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
    console.error('💥 MONGODB_URI NÃO CONFIGURADA — o sistema de /lembrete ficará desativado!')
    console.error('   Sem ela, os lembretes não persistem entre redeploys.')
    console.error('   → No Render: Settings → Environment → variável MONGODB_URI')
    console.error('   → Local: adicione MONGODB_URI no arquivo .env da raiz')
    console.error('════════════════════════════════════════════════════════')
    throw new Error('MONGODB_URI ausente — impossível conectar aos lembretes')
  }

  try {
    console.log(`🗄️ [lembretes] conectando ao MongoDB (db: ${NOME_BANCO}, collection: ${NOME_COLECAO})...`)
    clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
    await clienteMongo.connect()
    await clienteMongo.db('admin').command({ ping: 1 })

    const colecao = clienteMongo.db(NOME_BANCO).collection(NOME_COLECAO)

    // Índice da consulta quente do agendador (vencidos pendentes)
    await colecao.createIndex(
      { enviado: 1, disparar_em: 1 },
      { name: 'idx_lembrete_vencidos' }
    )
    // Índice do /meuslembretes e da checagem de limite por usuário
    await colecao.createIndex(
      { numero: 1, enviado: 1 },
      { name: 'idx_lembrete_usuario' }
    )

    console.log('✅ [lembretes] conectado e índices garantidos.')
    colecaoCacheada = colecao
    return colecao
  } catch (erroConexao) {
    console.error('════════════════════════════════════════════════════════')
    console.error('💥 [lembretes] FALHA ao conectar no MongoDB:', erroConexao?.message)
    console.error('   Causas prováveis: URI errada, IP não liberado no Atlas')
    console.error('   (Network Access) ou cluster fora do ar.')
    console.error('════════════════════════════════════════════════════════')
    try { await clienteMongo?.close() } catch (e) { /* ignora */ }
    clienteMongo = null
    colecaoCacheada = null
    throw erroConexao
  }
}

// -------------------------------------------------------------------
// ⏱️ INTERPRETAÇÃO DE TEMPO — relativo ("10m", "2h", "1d", "1h30m") ou
// absoluto no mesmo dia ("20:30" → hoje, ou amanhã se já passou). Todos
// os horários absolutos são do fuso America/Sao_Paulo (FUSO).
// Devolve { timestamp, tipo } em caso de sucesso ou { erro: mensagem }
// já pronta em pt-BR. NUNCA lança.
// -------------------------------------------------------------------
const MENSAGEM_FORMATO =
  '⏰ *Não entendi esse tempo...*\n\n' +
  'Use:\n' +
  '• *Daqui a pouco*: `10m`, `2h`, `1d` (ou combinando, ex.: `1h30m`)\n' +
  '• *Horário exato*: `20:30` (hoje — ou amanhã, se já passou)\n\n' +
  '🗝️ Exemplo: `/lembrete 2h Beber água`'

// Regex das unidades aceitas. A ORDEM das alternativas importa: as formas
// longas vêm antes das curtas ("dias" antes de "d", "min" antes de "m").
const RE_UNIDADE = /(\d+)\s*(dias?|d|horas?|h|minutos?|min|m|segundos?|seg|s)/g

function unidadeParaMs(unidade) {
  const u = String(unidade || '').toLowerCase()
  if (u.startsWith('d')) return 24 * 60 * 60 * 1000
  if (u.startsWith('h')) return 60 * 60 * 1000
  if (u.startsWith('m')) return 60 * 1000
  if (u.startsWith('s')) return 1000
  return 0
}

// Partes de um instante NO FUSO do bot (ano/mês/dia/hora/minuto/segundo)
function partesEmFuso(instante, fuso = FUSO) {
  const formatador = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
  const partes = {}
  for (const parte of formatador.formatToParts(instante)) partes[parte.type] = parte.value
  return {
    ano: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    hora: Number(partes.hour),
    minuto: Number(partes.minute),
    segundo: Number(partes.second)
  }
}

// "20:30 de 20/09 no fuso do bot" → timestamp UTC (ms).
// Corrige o desvio do fuso sem depender de offset fixo (funciona mesmo se
// o horário de verão voltar a existir).
function timestampNoFuso(ano, mes, dia, hora, minuto, fuso = FUSO) {
  const palpite = Date.UTC(ano, mes - 1, dia, hora, minuto, 0, 0)
  const visto = partesEmFuso(new Date(palpite), fuso)
  const desvio =
    Date.UTC(visto.ano, visto.mes - 1, visto.dia, visto.hora, visto.minuto, 0, 0) - palpite
  return palpite - desvio
}

function interpretarQuando(entrada, agora = Date.now()) {
  const texto = String(entrada || '').trim().toLowerCase()
  if (!texto) return { erro: MENSAGEM_FORMATO }

  // ── 1) 🔢 RELATIVO: 10m / 2h / 1d / 1h30m (soma as unidades) ──
  if (!texto.includes(':')) {
    let total = 0
    let consumido = 0
    let casou = false
    let invalido = false
    RE_UNIDADE.lastIndex = 0
    let achado
    while ((achado = RE_UNIDADE.exec(texto)) !== null) {
      // Exige que o texto inteiro seja composto de pares número+unidade
      // (qualquer sobra — "2h amanhã", "abc2h" — é formato inválido)
      if (achado.index !== consumido) { invalido = true; break }
      consumido = achado.index + achado[0].length
      total += Number(achado[1]) * unidadeParaMs(achado[2])
      casou = true
    }

    if (casou && !invalido && consumido === texto.length) {
      if (total <= 0) return { erro: MENSAGEM_FORMATO }
      if (total < MINIMO_MS) {
        return {
          erro:
            '⏱️ *Tempo curto demais.*\n\nO mínimo é *1 minuto* (eu verifico os lembretes a cada 30 segundos).'
        }
      }
      if (total > LIMITE_FUTURO_MS) {
        return {
          erro: '📆 *Tempo longo demais.*\n\nO limite é *1 ano* à frente.'
        }
      }
      return { timestamp: agora + total, tipo: 'relativo', duracaoMs: total }
    }
  }

  // ── 2) 🕐 ABSOLUTO: 20:30 (ou 20h30) — hoje, ou amanhã se já passou ──
  const achadoHora = texto.match(/^(\d{1,2})[:h](\d{2})$/)
  if (achadoHora) {
    const hora = Number(achadoHora[1])
    const minuto = Number(achadoHora[2])
    if (hora > 23 || minuto > 59) return { erro: MENSAGEM_FORMATO }

    const hoje = partesEmFuso(new Date(agora))
    let timestamp = timestampNoFuso(hoje.ano, hoje.mes, hoje.dia, hora, minuto)

    // Margem de 5s: um horário "agora" é tratado como já passado (amanhã)
    if (timestamp <= agora + 5000) {
      timestamp += 24 * 60 * 60 * 1000
    }
    return { timestamp, tipo: 'absoluto', duracaoMs: timestamp - agora }
  }

  return { erro: MENSAGEM_FORMATO }
}

// -------------------------------------------------------------------
// 🖋️ FORMATAÇÃO — data/hora legível (fuso do bot) e "daqui a X"
// -------------------------------------------------------------------
function formatarDataHora(timestamp) {
  try {
    return new Date(timestamp).toLocaleString('pt-BR', {
      timeZone: FUSO,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch (err) {
    return new Date(timestamp).toISOString()
  }
}

// Duração em ms → texto curto ("2h 10min", "3d 4h", "45s")
function formatarDuracaoCurta(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000))
  const dias = Math.floor(total / 86400)
  const horas = Math.floor((total % 86400) / 3600)
  const minutos = Math.floor((total % 3600) / 60)
  const segundos = total % 60
  const partes = []
  if (dias) partes.push(`${dias}d`)
  if (horas) partes.push(`${horas}h`)
  if (minutos) partes.push(`${minutos}min`)
  if (!dias && !horas && !minutos && segundos) partes.push(`${segundos}s`)
  return partes.length ? partes.join(' ') : 'instantes'
}

// -------------------------------------------------------------------
// 🪪 IDENTIDADE — número REAL do remetente da mensagem (PROOF-LID).
// Mesmo padrão do /registrar: em grupo o remetente autêntico é
// msg.key.participant; no privado, o próprio chat. Se vier "@lid"
// (WhatsApp v7), resolve via lid.js (metadados do grupo → mapeamento
// da sessão). Devolve { numero: '5511...' } ou { numero: '' } quando
// não dá para resolver — o chamador avisa e pede retry (NUNCA gravamos
// LID cru como número, igual ao /darvip).
// -------------------------------------------------------------------
async function obterNumeroRemetente(sock, jid, msg) {
  const sender = msg?.key?.participant || msg?.key?.remoteJid || jid

  if (String(sender).endsWith('@lid')) {
    let participantes = null
    if (String(jid).endsWith('@g.us') && typeof sock?.groupMetadata === 'function') {
      try {
        participantes = (await sock.groupMetadata(jid)).participants
      } catch (err) {
        console.error('[lembretes] sem metadados do grupo p/ resolver @lid:', err?.message || err)
      }
    }
    const resolucao = await resolverNumeroAlvo(participantes, sender)
    if (resolucao.numero && resolucao.via !== null) {
      console.log(`[lembretes] 🪪 remetente resolvido de @lid p/ o número real ${resolucao.numero} via ${resolucao.via}`)
      return { numero: resolucao.numero, via: resolucao.via }
    }
    console.warn('[lembretes] 🪪 @lid do remetente não resolvível')
    return { numero: '', via: null }
  }

  const numero = String(sender).split('@')[0].split(':')[0].replace(/\D/g, '')
  return { numero, via: numero ? 'direto' : null }
}

// -------------------------------------------------------------------
// 💾 CRUD — todas as operações usam a collection "lembretes". Falhas de
// banco são RELANÇADAS (os comandos tratam com mensagem amigável e o
// agendador apenas loga — o bot nunca cai por causa de um lembrete).
// -------------------------------------------------------------------

// ➕ cria o lembrete e devolve o documento gravado (com _id)
async function criarLembrete({ numero, grupoId = null, texto, dispararEm, agora = Date.now() }) {
  const numeroLimpo = limparNumero(numero)
  if (!numeroLimpo) throw new Error('criarLembrete: numero inválido')
  const quando = Number(dispararEm)
  if (!Number.isFinite(quando)) throw new Error('criarLembrete: disparar_em inválido')

  // 🚫 LIMITE anti-spam: só MAX_POR_USUARIO lembretes ATIVOS por número.
  //    O /lembrete traduz o code LIMITE_ATINGIDO no aviso "📋 Você já
  //    tem N lembretes ativos..." (o cancelamento de um existente é a
  //    saída — /meuslembretes mostra os números p/ /cancelarlembrete).
  const ativos = await contarLembretesAtivos(numeroLimpo)
  if (ativos >= MAX_POR_USUARIO) {
    const erroLimite = new Error(`limite de ${MAX_POR_USUARIO} lembretes ativos atingido`)
    erroLimite.code = 'LIMITE_ATINGIDO'
    throw erroLimite
  }

  const documento = {
    numero: numeroLimpo,
    grupo_id: grupoId || null,
    texto: String(texto || '').slice(0, TEXTO_MAX),
    disparar_em: quando,
    enviado: false,
    criado_em: agora,
    enviado_em: null,
    tentativas: 0,
    erro: null
  }

  const colecao = await obterColecaoLembretes()
  const resultado = await colecao.insertOne(documento)
  return { ...documento, _id: resultado.insertedId }
}

// 🔢 quantos lembretes ATIVOS (ainda não enviados) o usuário tem
async function contarLembretesAtivos(numeroBruto) {
  const numero = limparNumero(numeroBruto)
  if (!numero) return 0
  const colecao = await obterColecaoLembretes()
  return colecao.countDocuments({ numero, enviado: false })
}

// 📋 lembretes ATIVOS do usuário, do que vence primeiro para o último
async function listarLembretesAtivos(numeroBruto, limite = MAX_POR_USUARIO) {
  const numero = limparNumero(numeroBruto)
  if (!numero) return []
  const colecao = await obterColecaoLembretes()
  return colecao
    .find({ numero, enviado: false })
    .sort({ disparar_em: 1 })
    .limit(limite)
    .toArray()
}

// ❌ CANCELAR — apaga um lembrete PENDENTE pelo MESMO índice exibido no
// /meuslembretes (1-based, ordem: disparo mais próximo primeiro). Usa a
// MESMA consulta (find+sort por disparar_em) da listagem, então o número
// que o usuário vê é exatamente o que ele cancela. A remoção é amarrada
// ao DONO e ao estado pendente ({ _id, numero, enviado: false }): só o
// próprio autor cancela e lembretes já entregues nunca são afetados.
// Devolve um resultado discriminated (padrão interpretarQuando):
//   { status: 'ok', cancelado, restantes }
//   { status: 'sem_numero' }            → remetente sem número resolvível
//   { status: 'sem_lembretes' }         → não há pendentes
//   { status: 'indice_invalido' }       → não é inteiro >= 1
//   { status: 'fora_da_faixa', total }  → índice além do último da lista
// Falha de banco é RELANÇADA (o comando avisa amigavelmente).
async function cancelarLembrete(numeroBruto, indice) {
  const numero = limparNumero(numeroBruto)
  if (!numero) return { status: 'sem_numero' }

  const posicao = Number(indice)
  if (!Number.isInteger(posicao) || posicao < 1) return { status: 'indice_invalido' }

  const pendentes = await listarLembretesAtivos(numero)
  if (!pendentes.length) return { status: 'sem_lembretes' }

  const alvo = pendentes[posicao - 1]
  if (!alvo) return { status: 'fora_da_faixa', total: pendentes.length }

  const colecao = await obterColecaoLembretes()
  await colecao.deleteOne({ _id: alvo._id, numero, enviado: false })
  return { status: 'ok', cancelado: alvo, restantes: pendentes.length - 1 }
}

// ⏳ lembretes VENCIDOS e ainda não enviados (a consulta do agendador)
async function buscarLembretesVencidos(agora = Date.now(), limite = LOTE_MAX) {
  const colecao = await obterColecaoLembretes()
  return colecao
    .find({ enviado: false, disparar_em: { $lte: agora } })
    .sort({ disparar_em: 1 })
    .limit(limite)
    .toArray()
}

// ✅ marca como entregue (só depois do sendMessage dar certo)
async function marcarEnviado(id, agora = Date.now()) {
  const colecao = await obterColecaoLembretes()
  await colecao.updateOne(
    { _id: id },
    { $set: { enviado: true, enviado_em: agora, erro: null } }
  )
}

// ⚠️ contabiliza a falha de envio. Depois de MAX_TENTATIVAS_ENVIO o
// lembrete é dado como perdido (marca enviado + guarda o motivo) para não
// ficar tentando para sempre num chat que sumiu.
async function registrarFalhaEnvio(doc, mensagemErro) {
  const colecao = await obterColecaoLembretes()
  const tentativas = Number(doc.tentativas || 0) + 1
  const desistiu = tentativas >= MAX_TENTATIVAS_ENVIO
  const atualizacao = {
    $set: {
      tentativas,
      erro: String(mensagemErro || 'falha no envio').slice(0, 200)
    }
  }
  if (desistiu) {
    atualizacao.$set.enviado = true
    atualizacao.$set.enviado_em = null
  }
  await colecao.updateOne({ _id: doc._id }, atualizacao)
  return { tentativas, desistiu }
}

// -------------------------------------------------------------------
// 📤 DISPARO — monta a mensagem e envia no GRUPO de origem (marcando o
// usuário) ou no PV dele, dependendo de onde o lembrete foi criado.
// -------------------------------------------------------------------
function destinoDoLembrete(doc) {
  const grupo = String((doc && doc.grupo_id) || '')
  if (grupo.endsWith('@g.us')) return { jid: grupo, ehGrupo: true }
  return { jid: `${doc.numero}@s.whatsapp.net`, ehGrupo: false }
}

function montarMensagemLembrete(doc, ehGrupo) {
  const agendadoPara = formatarDataHora(doc.disparar_em)
  return (
    '⏰ *LEMBRETE DO LIMBO* 🌙\n\n' +
    (ehGrupo ? `@${doc.numero}, você me pediu para lembrar:\n\n` : 'Você me pediu para lembrar:\n\n') +
    `📌 ${doc.texto}\n\n` +
    `_(agendado para ${agendadoPara})_`
  )
}

async function dispararLembrete(sock, doc) {
  const { jid, ehGrupo } = destinoDoLembrete(doc)
  const conteudo = { text: montarMensagemLembrete(doc, ehGrupo) }
  if (ehGrupo) conteudo.mentions = [`${doc.numero}@s.whatsapp.net`]
  return sock.sendMessage(jid, conteudo)
}

// -------------------------------------------------------------------
// 🧹 LIMPEZA — apaga lembretes JÁ ENTREGUES depois do período de retenção
// (mantém a collection pequena; a quota do cluster principal é o que não
// pode estourar, já que a sessão do WhatsApp vive nele).
// -------------------------------------------------------------------
async function limparAntigos(agora = Date.now()) {
  const limite = agora - RETENCAO_ENVIADOS_MS
  const colecao = await obterColecaoLembretes()
  const resultado = await colecao.deleteMany({
    enviado: true,
    criado_em: { $lt: limite }
  })
  return Number(resultado?.deletedCount || 0)
}

// -------------------------------------------------------------------
// 🔁 VERIFICAÇÃO — a ROTINA DO AGENDADOR: busca no Mongo os lembretes
// vencidos (disparar_em <= agora e enviado: false), entrega cada um e
// marca como enviado. Roda a cada INTERVALO_VERIFICACAO_MS (setInterval
// armado em iniciarAgendadorLembretes) e UMA VEZ no boot — é isso que
// entrega os lembretes que venceram enquanto o bot estava desligado.
//
// NUNCA lança: qualquer falha é logada e o bot segue normal. Quando o
// sendMessage falha (rede/chat), o lembrete NÃO é marcado como enviado —
// ele é retentado na próxima rodada, até MAX_TENTATIVAS_ENVIO.
//
// opcoes.sock  → socket explícito (usado nos testes)
// opcoes.agora → "agora" fixo (usado nos testes)
// -------------------------------------------------------------------
let verificando = false
let ultimaLimpeza = 0

async function verificarLembretes(opcoes = {}) {
  const agora = Number.isFinite(opcoes.agora) ? Number(opcoes.agora) : Date.now()
  const resultado = { verificados: 0, enviados: 0, falhas: 0, desistencias: 0, pulado: false }

  // 🚧 Mutex: se a rodada anterior ainda está entregando (API lenta), não
  // inicia outra — evita enviar o mesmo lembrete duas vezes.
  if (verificando) {
    resultado.pulado = true
    return resultado
  }
  verificando = true

  try {
    const sock =
      opcoes.sock ||
      (typeof obterSockAtual === 'function' ? obterSockAtual() : null)

    if (!sock) {
      console.log('⏰ [lembretes] sem socket do WhatsApp ainda — checagem adiada.')
      resultado.pulado = true
      return resultado
    }

    let vencidos = []
    try {
      vencidos = await buscarLembretesVencidos(agora)
    } catch (erroConsulta) {
      console.error(
        '⚠️ [lembretes] não consegui consultar o MongoDB (checagem adiada):',
        erroConsulta?.message || erroConsulta
      )
      resultado.erro = erroConsulta?.message || String(erroConsulta)
      return resultado
    }

    resultado.verificados = vencidos.length

    for (const doc of vencidos) {
      try {
        await dispararLembrete(sock, doc)
        await marcarEnviado(doc._id, agora)
        resultado.enviados += 1
        console.log(
          `⏰ [lembretes] entregue p/ ${doc.numero} (agendado p/ ${formatarDataHora(doc.disparar_em)})`
        )
      } catch (erroEnvio) {
        resultado.falhas += 1
        const info = await registrarFalhaEnvio(doc, erroEnvio?.message || erroEnvio).catch(() => null)
        if (info?.desistiu) resultado.desistencias += 1
        console.error(
          `⚠️ [lembretes] falha ao entregar o lembrete de ${doc.numero}:`,
          erroEnvio?.message || erroEnvio
        )
      }
    }

    // 🧹 limpeza de enviados antigos (no máximo a cada 6h)
    if (agora - ultimaLimpeza > INTERVALO_LIMPEZA_MS) {
      ultimaLimpeza = agora
      const apagados = await limparAntigos(agora).catch(() => 0)
      if (apagados) console.log(`🧹 [lembretes] ${apagados} lembrete(s) antigo(s) removido(s).`)
    }

    return resultado
  } finally {
    verificando = false
  }
}

// [[CONTINUA]]
// -------------------------------------------------------------------
// 🔌 SOCKET DO WHATSAPP — o agendador precisa de um socket VIVO para
// enviar. O bot.js registra o socket atual aqui (mesmo padrão do
// registrarSocketBoasVindas) e guardamos a referência MUTÁVEL: cada
// reconexão sobrescreve a anterior, sem recriar o intervalo.
// -------------------------------------------------------------------
let socketAtual = null

function obterSockAtual() {
  return socketAtual
}

// 📅 TIMER DO AGENDADOR (setInterval). Fica guardado para nunca existir
// mais de um rodando (reconexões chamam iniciarAgendadorLembretes de novo)
// e para o teste poder desligá-lo.
let temporizadorAgendador = null
let agendadorLigadoFlag = false

// 🧪 Timers INJETÁVEIS (só p/ teste) — por padrão, os reais do Node.
let definirIntervalo = setInterval
let cancelarIntervalo = clearInterval

function __definirTimersTeste(timers) {
  definirIntervalo = (timers && timers.setInterval) || setInterval
  cancelarIntervalo = (timers && timers.clearInterval) || clearInterval
}

// -------------------------------------------------------------------
// ▶️ iniciarAgendadorLembretes(sock): liga o agendador NO PROCESSO DO BOT.
//   1) registra/atualiza o socket atual do WhatsApp;
//   2) roda IMEDIATAMENTE uma verificação — é a "checagem no boot", que
//      entrega os lembretes vencidos enquanto o bot estava desligado;
//   3) arma o setInterval de 30s. Chamadas repetidas (reconexões) apenas
//      atualizam o socket: o timer NUNCA é duplicado.
// NUNCA lança: falha de banco/rede é logada e o bot segue normal.
// -------------------------------------------------------------------
async function iniciarAgendadorLembretes(sock) {
  if (sock) socketAtual = sock

  // 🔎 Checagem inicial (catch-up do que venceu com o bot offline)
  let resultadoBoot = null
  try {
    resultadoBoot = await verificarLembretes({ sock: socketAtual || undefined })
  } catch (erroBoot) {
    console.error('⚠️ [lembretes] falha na checagem inicial (o agendador segue):', erroBoot?.message || erroBoot)
  }
  if (resultadoBoot?.enviados) {
    console.log(`⏰ [lembretes] checagem inicial: ${resultadoBoot.enviados} lembrete(s) vencido(s) entregue(s).`)
  }

  if (temporizadorAgendador) return { jaAtivo: true, resultadoBoot }

  temporizadorAgendador = definirIntervalo(() => {
    verificarLembretes().catch((err) => {
      console.error('⚠️ [lembretes] erro no ciclo do agendador:', err?.message || err)
    })
  }, INTERVALO_VERIFICACAO_MS)

  // Não segura o processo vivo só por causa do timer (útil p/ scripts/testes)
  if (temporizadorAgendador && typeof temporizadorAgendador.unref === 'function') {
    temporizadorAgendador.unref()
  }

  agendadorLigadoFlag = true
  console.log(`⏰ [lembretes] agendador ativo (verificando o Mongo a cada ${INTERVALO_VERIFICACAO_MS / 1000}s).`)
  return { jaAtivo: false, resultadoBoot }
}

// ⏹️ desliga o agendador (processo encerrando / testes)
function pararAgendadorLembretes() {
  if (temporizadorAgendador) cancelarIntervalo(temporizadorAgendador)
  temporizadorAgendador = null
  agendadorLigadoFlag = false
}

function agendadorLigado() {
  return agendadorLigadoFlag
}

// -------------------------------------------------------------------
// 🧪 GANCHO DE TESTE (mesmo padrão do __definirColecaoTeste do afk.js):
// injeta uma collection fake e desativa a conexão real até o fim do
// processo. Passando `null`, o modo teste é desligado.
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
  // ⚙️ configuração/limites (úteis p/ os comandos e p/ os testes)
  NOME_BANCO,
  NOME_COLECAO,
  INTERVALO_VERIFICACAO_MS,
  MAX_POR_USUARIO,
  MINIMO_MS,
  LIMITE_FUTURO_MS,
  TEXTO_MAX,
  MAX_TENTATIVAS_ENVIO,
  FUSO,

  // ⏱️ tempo (puro)
  interpretarQuando,
  unidadeParaMs,
  formatarDataHora,
  formatarDuracaoCurta,

  // 💾 persistência + cancelamento por índice
  criarLembrete,
  cancelarLembrete,
  contarLembretesAtivos,
  listarLembretesAtivos,
  buscarLembretesVencidos,
  marcarEnviado,
  registrarFalhaEnvio,
  limparAntigos,
  obterNumeroRemetente,

  // 📤 disparo/agendador
  destinoDoLembrete,
  montarMensagemLembrete,
  dispararLembrete,
  verificarLembretes,
  iniciarAgendadorLembretes,
  pararAgendadorLembretes,
  agendadorLigado,

  // 🧪 ganchos de teste + aliases pedidos pelos comandos
  __definirColecaoTeste,
  __definirTimersTeste,
  interpretarTempo: interpretarQuando,
  agendarLembrete: criarLembrete,
  listarPendentes: listarLembretesAtivos,
  MAX_LEMBRETES_ATIVOS: MAX_POR_USUARIO,
  MAX_TEXTO: TEXTO_MAX
}

