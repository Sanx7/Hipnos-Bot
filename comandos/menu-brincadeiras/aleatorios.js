// ============================================================
// 🎲 ALEATORIOS — /sorte · /gay · /qi · /parecido · /crush
// ============================================================
// Brincadeiras de "oráculo" que SÓ usam Math.random() local — sem API
// externa, sem key, sem rede. Todo o resultado é TEXTO.
//
//   /sorte            → nível de sorte de hoje (0-100%), frase pela faixa
//   /gay [@pessoa]    → % de gay (sem menção, mede quem mandou)
//   /qi [@pessoa]     → QI de 40 a 200 (sem menção, mede quem mandou)
//   /parecido @pessoa → % de parecença entre quem mandou e o mencionado
//                       (aqui a menção é OBRIGATÓRIA — sem default)
//   /crush            → crush aleatório do dia entre os membros do grupo
//                       (via sock.groupMetadata, exclui quem mandou e o bot)
//
// 🔒 TRAVA DIÁRIA (MongoDB — collection "brincadeiraDiaria"):
//   Cada veredito é gravado UMA vez por dia numa chave composta:
//     { comando, grupo_id, autor_id, alvo_id, dia }
//   (o grupo entra na chave porque o /crush sorteia entre os membros DO
//   grupo — sem isso o mesmo usuário em dois grupos receberia um crush
//   "fantasma" que nem mora lá). O "dia" é o dia civil de
//   America/Sao_Paulo ("YYYY-MM-DD"), não UTC (o Render roda em UTC).
//   Rodar de novo no mesmo dia devolve EXATAMENTE o mesmo resultado.
//
//   ⚠️ Banco fora / sem MONGODB_URI → o comando NUNCA deixa de responder:
//   loga "⚠️ banco indisponível" e sorteia na hora, SEM trava diária.
//
// Índice único composto: idx_brincadeira_diaria_chave.
// 🧪 Gancho __definirColecaoTeste (mesmo padrão do configuracoes-grupo.js)
// permite testar 100% OFFLINE com uma collection fake.
// Uso LIVRE: qualquer pessoa pode chamar todos os comandos.
// ============================================================

const { MongoClient } = require('mongodb')
const { normalizeMessageContent } = require('@whiskeysockets/baileys')

// ⚙️ config.js carrega o .env da raiz p/ o process.env (mesmo padrão do
// configuracoes-grupo.js / vip.js / avaliacoes.js).
require('../../config')

const NOME_BANCO = process.env.MONGODB_DB || 'whatsapp'
const NOME_COLECAO =
  process.env.MONGODB_COLLECTION_BRINCADEIRA_DIARIA || 'brincadeiraDiaria'
const FUSO_DIA = 'America/Sao_Paulo'

// -------------------------------------------------------------------
// 🗄️ SINGLETON de conexão (mesmo padrão do configuracoes-grupo.js):
// um único MongoClient por processo, ping de saúde a cada uso e
// reconexão automática quando a conexão morre.
// -------------------------------------------------------------------
let clienteMongo = null
let colecaoCacheada = null
let modoTeste = false

async function obterColecaoBrincadeiras () {
  // 🧪 Modo teste: usa a collection fake, NUNCA toca em conexão real.
  if (modoTeste && colecaoCacheada) return colecaoCacheada

  // Conexão viva? Reusa. Morta? Descarta e reconecta.
  if (colecaoCacheada && clienteMongo) {
    try {
      await clienteMongo.db('admin').command({ ping: 1 })
      return colecaoCacheada
    } catch (erroPing) {
      console.error(
        '⚠️ [aleatorios] conexão anterior com o MongoDB morreu — reconectando:',
        erroPing?.message || erroPing
      )
      try { await clienteMongo.close() } catch (e) { /* já morta */ }
      clienteMongo = null
      colecaoCacheada = null
    }
  }

  const uri = process.env.MONGODB_URI
  if (!uri) {
    throw new Error('MONGODB_URI ausente — impossível conectar ao banco das brincadeiras')
  }

  console.log(`🎲 [aleatorios] conectando ao MongoDB (db: ${NOME_BANCO}, collection: ${NOME_COLECAO})...`)
  clienteMongo = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
  await clienteMongo.connect()
  await clienteMongo.db('admin').command({ ping: 1 })

  const colecao = clienteMongo.db(NOME_BANCO).collection(NOME_COLECAO)

  // 🔒 Índice único composto: 1 veredito por (comando, grupo, autor, alvo, dia)
  await colecao.createIndex(
    { comando: 1, grupo_id: 1, autor_id: 1, alvo_id: 1, dia: 1 },
    { unique: true, name: 'idx_brincadeira_diaria_chave' }
  )

  colecaoCacheada = colecao
  console.log('✅ [aleatorios] MongoDB conectado — as travas diárias persistem entre redeploys.')
  return colecao
}

// 🧪 GANCHO DE TESTE (mesmo padrão do __definirColecaoTeste do
// configuracoes-grupo.js): injeta uma collection fake e desativa a conexão
// real até o fim do processo. `null` desliga o modo teste.
function __definirColecaoTeste (colecao) {
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

// -------------------------------------------------------------------
// 🔒 obterResultadoFixo({...}): o coração da trava diária.
//   1) Procura o documento da chave composta;
//   2) achou → devolve o valor GRAVADO (mesmo resultado o dia inteiro);
//   3) não achou → chama sortear() (pode ser async — o /crush usa),
//      grava com upsert e devolve o valor novo;
//   4) QUALQUER falha de banco → loga e devolve o valor sorteado SEM
//      gravar (o comando responde normalmente, só perde a trava).
// NUNCA lança.
// -------------------------------------------------------------------
async function obterResultadoFixo ({ comando, grupoId, autorId, alvoId, sortear }) {
  const dia = diaDeHoje()
  const filtro = {
    comando,
    grupo_id: grupoId,
    autor_id: autorId,
    alvo_id: alvoId || '',
    dia
  }
  const quem = `${comando} ${autorId}${alvoId ? ` → ${alvoId}` : ''}`

  try {
    const colecao = await obterColecaoBrincadeiras()

    const existente = await colecao.findOne(filtro)
    if (existente) {
      console.log(`🔒 [aleatorios] ${quem} — veredito de hoje (${dia}) já estava gravado; repetindo.`)
      return { valor: existente.valor, extra: existente.extra ?? null, gravado: true }
    }

    const sorteado = await sortear()
    const valor = sorteado?.valor ?? null
    const extra = sorteado?.extra ?? null

    // "Sem candidatos" (ex.: /crush num grupo que só tem o autor e o bot)
    // NÃO grava — se o grupo ganhar membros ainda hoje, vale a pena sortear.
    if (!sorteado?.naoGravar) {
      await colecao.updateOne(
        filtro,
        { $set: { valor, extra, criado_em: Date.now() } },
        { upsert: true }
      )
      console.log(`🎲 [aleatorios] ${quem} — veredito novo sorteado e gravado p/ hoje (${dia}).`)
    }

    return { valor, extra, gravado: false }
  } catch (erroBanco) {
    console.error('⚠️ [aleatorios] banco indisponível — sorteando SEM trava diária:', erroBanco?.message || erroBanco)
    const sorteado = await sortear()
    return { valor: sorteado?.valor ?? null, extra: sorteado?.extra ?? null, gravado: false, bancoFora: true }
  }
}

// -------------------------------------------------------------------
// 🧰 Helpers de JID / tempo / sorteio (mesmos padrões do sorteio.js,
// casal.js e perfil.js)
// -------------------------------------------------------------------

// Remove apenas o sufixo de dispositivo (:N), mantendo o domínio ORIGINAL
// do JID — nunca converte @lid em @s.whatsapp.net (número falso).
function normalizarJid (id) {
  const bruto = String(id || '')
  const [usuario, servidor] = bruto.split('@')
  if (!usuario || !servidor) return ''
  return `${usuario.split(':')[0]}@${servidor}`
}

// Extrai apenas os dígitos de um JID (p/ comparar ids e montar o "@numero"
// do texto — texto e mentions[] sempre com o MESMO JID).
function apenasDigitos (jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

// 🗓️ Dia corrente de America/Sao_Paulo ("YYYY-MM-DD") — a trava é por dia
// civil brasileiro, não por UTC (o Render roda em UTC e viraria o dia cedo).
function diaDeHoje (quando = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_DIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(quando)
}

// 🎯 Número inteiro aleatório INCLUSIVO [minimo, maximo] — Math.random() puro.
function numeroAleatorio (minimo, maximo) {
  return Math.floor(Math.random() * (maximo - minimo + 1)) + minimo
}

// 📜 Frase aleatória de uma lista.
function sortearFrase (lista) {
  return lista[Math.floor(Math.random() * lista.length)]
}

// 📌 Frase DETERMINÍSTICA pelo valor sorteado — como o veredito do dia é
// fixo, a frase também tem que ser (a mesma % sempre conta a mesma história).
function frasePorValor (lista, valor) {
  if (!Array.isArray(lista) || lista.length === 0) return ''
  return lista[Math.abs(Number(valor) || 0) % lista.length]
}

// 👤 Quem mandou o comando: em grupo é msg.key.participant; no privado o
// próprio chat (mesmo padrão do perfil.js).
function autorJidDaMensagem (msg, jid) {
  return normalizarJid(msg?.key?.participant || jid || '')
}

// 👉 Primeiro JID @mencionado na mensagem (normalizado) ou null
// (mesmo caminho do perfil.js: normalizeMessageContent + contextInfo).
function alvoMencionado (msg) {
  const conteudo = normalizeMessageContent(msg?.message) || {}
  const bruto = conteudo.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || null
  return bruto ? normalizarJid(bruto) : null
}

// JID real e mencionável de um participante do grupo — prefere `phoneNumber`
// (número real) quando o WhatsApp entrega o participante como LID
// (cópia do jidMencionavel do casal.js).
function jidMencionavel (participante) {
  const bruto = participante?.phoneNumber || participante?.id || ''
  const [usuario, servidor] = String(bruto).split('@')
  if (!usuario || !servidor) return ''
  return `${usuario.split(':')[0]}@${servidor}`
}

// ───── (continua: frases, faixas e comandos) ─────

// ═══════════════════════════════════════════════════════════════════
// 📜 FRASES E FAIXAS DE CADA COMANDO (todas na temática do Limbo)
// ═══════════════════════════════════════════════════════════════════

// 🍀 /sorte — faixas de 0-20 (azar), 21-50 (neutro), 51-80 (sorte) e 81-100
const FAIXAS_SORTE = [
  {
    min: 0, max: 20, rotulo: 'azar',
    frases: [
      'As sombras conspiraram contra você hoje...',
      'O limbo tropeçou no seu nome hoje...',
      'Hoje até o espelho te devolve um olhar desconfiado...',
      'Morfeu roubou seu travesseiro da sorte...'
    ]
  },
  {
    min: 21, max: 50, rotulo: 'neutro',
    frases: [
      'O destino segue em silêncio... nem pra cima, nem pra baixo.',
      'Um dia comum nas névoas do limbo — guarde energia.',
      'A roda do destino gira devagar para você hoje.',
      'Nem brilho, nem sombra: apenas calmaria.'
    ]
  },
  {
    min: 51, max: 80, rotulo: 'sorte',
    frases: [
      'Os ventos do sonho sopram a seu favor!',
      'As portas do limbo se abrem mais fácil pra você hoje!',
      'Boas energias rondam seu travesseiro — aproveite!',
      'O subconsciente está apostando em você hoje!'
    ]
  },
  {
    min: 81, max: 100, rotulo: 'sorte extrema',
    frases: [
      'O DESTINO INTEIRO está do seu lado hoje! 🌟',
      'Hipnos te escolheu como favorito do dia! ✨',
      'Sorte lendária! Até os sonhos te aplaudem! 🌙✨',
      'A roda da fortuna PAROU no seu nome! 🎰✨'
    ]
  }
]

// 🏳️‍🌈 /gay — frase única com o % embutido
const FRASES_GAY = [
  '🏳️‍🌈 {nome} está {valor}% gay hoje — e o arco-íris aprova!',
  '🌈 As sombras mediram: {nome} está {valor}% gay!',
  '💜 O limbo revela: {nome} está {valor}% gay — vista com orgulho!',
  '🎊 {nome} está {valor}% gay (o limbo nunca mente... quase nunca) 🏳️‍🌈'
]

// 🧠 /qi — faixas: <70 zoeira, 70-130 normal, >160 gênio
const FRASE_QI_BAIXO = [
  '🧠 O QI de {nome} deu {valor}... Os neurônios estão de folga hoje 😅',
  '🧠 {nome} marcou {valor} de QI — o limbo sugere mais sono e menos zoeira 😴',
  '🧠 QI de {nome}: {valor}. Até as sombras ficaram preocupadas 😬'
]
const FRASE_QI_NORMAL = [
  '🧠 {nome} tem {valor} de QI — equilíbrio digno de um sonhador. 🌙',
  '🧠 O limbo mediu {valor} de QI em {nome} — dentro da média dos mortais.',
  '🧠 QI de {nome}: {valor}. Nada que um bom sonho não afine. 😌'
]
const FRASE_QI_GENIO = [
  '🧠 {valor} de QI! {nome} é um GÊNIO reconhecido pelo limbo! 🌟',
  '🧠 {nome} marcou {valor} — até Einstein tira o chapéu (se tivesse)! 🎩',
  '🧠 QI {valor} para {nome}! As sombras pediram autógrafo ✍️✨'
]
const FAIXAS_QI = [
  { min: 0, max: 69, frases: FRASE_QI_BAIXO },
  { min: 70, max: 130, frases: FRASE_QI_NORMAL },
  { min: 131, max: 160, frases: FRASE_QI_NORMAL },
  { min: 161, max: 200, frases: FRASE_QI_GENIO }
]

// 💞 /parecido — frase única com o % embutido
const FRASES_PARECIDO = [
  '🪞 {a} e {b} são {valor}% parecidos — o limbo jura que são primos de sonho!',
  '✨ Parecença entre {a} e {b}: {valor}%. O espelho do limbo não mente!',
  '😴 O subconsciente comparou {a} e {b}: {valor}% de parecença!',
  '🔮 {a} e {b} dividem {valor}% da mesma alma onírica!'
]

// 💘 /crush — frases que anunciam o escolhido
const FRASES_CRUSH = [
  '💘 O limbo espionageou seus sonhos: o crush de {nome} hoje é @{alvo}!',
  '🌙 As sombras viram quem te tira do sério: @{alvo} é o crush de {nome} hoje!',
  '🔮 Segredo revelado: {nome} sonhou com @{alvo} esta noite... 💞',
  '❤️‍🔥 O coração de {nome} escolheu @{alvo} — veredito das sombras para hoje!'
]

// 🚫 Aviso do /crush fora de grupo / sem candidatos
const AVISO_CRUSH_FORA_GRUPO =
  '💘 O crush mora nos grupos. Chame o /crush dentro de um recinto com mais gente.'
const AVISO_CRUSH_SEM_ALMAS =
  '💘 Nenhuma outra alma neste recinto para ser seu crush do dia... Tente amanhã (ou convide gente).'

// ═══════════════════════════════════════════════════════════════════
// 🏭 FÁBRICA: mesmo núcleo p/ /sorte · /gay · /qi · /parecido
//   - sorteia o número (Math.random()),
//   - guarda no banco pela chave diária (mesmo veredito o dia todo),
//   - escolhe a frase pela faixa e responde.
// `alvoObrigatorio`: exige menção (sem default de "mirar em si mesmo").
// `montarFrase` recebe { nome, nomeExibicao, numeroAutor, numeroAlvo,
//   valor, faixa, frases } e devolve o texto final (cada comando customiza).
// ═══════════════════════════════════════════════════════════════════
function criarComandoPorcentagem ({ nome, descricao, avisoMencao, minimo, maximo, faixas, frases, montarFrase, alvoObrigatorio = false, mencionarAmbos = false }) {
  return {
    nome,
    descricao,

    async executar (sock, jid, msg, texto) {
      try {
        const autorId = autorJidDaMensagem(msg, jid)
        const numeroAutor = apenasDigitos(autorId)

        // 👉 Alvo: @mencionado OU o próprio autor (default), conforme o comando
        const mencionado = alvoMencionado(msg)
        if (alvoObrigatorio && !mencionado) {
          return await sock.sendMessage(jid, { text: avisoMencao }, { quoted: msg })
        }
        const alvoJid = mencionado || autorId
        const numeroAlvo = apenasDigitos(alvoJid)

        // 📛 Nome de exibição: o mencionado aparece como "@numero"; o próprio
        // autor usa o pushName (mais simpático no /sorte e no /gay sem menção).
        const ehOMesmo = numeroAlvo === numeroAutor
        const nomeExibicao = ehOMesmo && msg.pushName
          ? msg.pushName
          : `@${numeroAlvo}`

        // 🔒 Veredito fixo do dia (chave: comando + grupo + autor + alvo)
        const { valor, extra } = await obterResultadoFixo({
          comando: nome,
          grupoId: jid,
          autorId,
          alvoId: mencionado || '',
          sortear: async () => {
            const numero = numeroAleatorio(minimo, maximo)
            const faixa = faixas.find((f) => numero >= f.min && numero <= f.max) || faixas[faixas.length - 1]
            return { valor: numero, extra: faixa }
          }
        })

        // 📜 Frase final (a faixa guardada no banco vem no `extra`; sem ela —
        // veredito antigo — derivamos a faixa PELO VALOR; nunca quebra).
        const faixa = extra ||
          faixas.find((f) => valor >= f.min && valor <= f.max) ||
          faixas[faixas.length - 1]
        const mensagem = montarFrase({
          nome,
          nomeExibicao,
          numeroAutor,
          numeroAlvo,
          valor,
          faixa,
          frases
        })

        return await sock.sendMessage(jid, {
          text: mensagem,
          // O alvo sempre entra; no /parecido o autor também (aparece citado).
          mentions: mencionarAmbos
            ? [...new Set([normalizarJid(alvoJid), normalizarJid(autorId)])]
            : [normalizarJid(alvoJid)]
        }, { quoted: msg })
      } catch (err) {
        console.error(`[${nome}] 💥 erro capturado (o bot segue vivo):`, err?.stack || err)
        return await sock.sendMessage(jid, {
          text: '⛔ O oráculo das brincadeiras cochilou... Tente novamente em instantes.'
        }, { quoted: msg }).catch(() => {})
      }
    }
  }
}

// 🍀 /sorte — veredito fixo POR USUÁRIO por dia (alvo: o próprio autor)
const comandoSorte = criarComandoPorcentagem({
  nome: 'sorte',
  descricao: 'Revela seu nível de sorte de hoje (0-100%) — o mesmo veredito o dia inteiro.',
  minimo: 0,
  maximo: 100,
  faixas: FAIXAS_SORTE,
  montarFrase: ({ nomeExibicao, valor, faixa }) =>
    `🍀 *SORTE DE HOJE* 🍀\n\n` +
    `${frasePorValor(faixa.frases, valor)}\n\n` +
    `🌙 ${nomeExibicao}, seu nível de sorte hoje é: *${valor}%* (${faixa.rotulo}).\n\n` +
    `💤 *(o veredito do limbo vale até a meia-noite — depois, novo sorteio)*`
})

// 🏳️‍🌈 /gay — sem menção, mede quem mandou; trava diária POR PAR (autor+alvo)
const comandoGay = criarComandoPorcentagem({
  nome: 'gay',
  descricao: 'Revela quantos % de gay uma pessoa está hoje (ex: /gay @fulano).',
  minimo: 0,
  maximo: 100,
  faixas: [{ min: 0, max: 100 }],
  frases: FRASES_GAY,
  montarFrase: ({ nomeExibicao, valor, frases }) =>
    frasePorValor(frases, valor).replace('{nome}', nomeExibicao).replace('{valor}', valor)
})

// 🧠 /qi — sem menção, mede quem mandou; trava diária POR PAR (autor+alvo)
const comandoQi = criarComandoPorcentagem({
  nome: 'qi',
  descricao: 'Revela o QI (40-200) de uma pessoa (ex: /qi @fulano).',
  minimo: 40,
  maximo: 200,
  faixas: FAIXAS_QI,
  montarFrase: ({ nomeExibicao, valor, faixa }) =>
    frasePorValor(faixa.frases, valor).replace('{nome}', nomeExibicao).replace('{valor}', valor)
})

// 🪞 /parecido — menção OBRIGATÓRIA (não tem default "mirar em si mesmo");
// trava diária POR PAR (quem perguntou + quem foi mencionado)
const comandoParecido = criarComandoPorcentagem({
  nome: 'parecido',
  descricao: 'Mede a parecença (0-100%) entre você e a pessoa marcada (ex: /parecido @fulano).',
  avisoMencao:
    '🪞 *O espelho do limbo precisa de duas almas...*\n\n' +
    'Marque alguém para medir a parecença.\n\n' +
    '🗝️ Exemplo: `/parecido @fulano`',
  minimo: 0,
  maximo: 100,
  faixas: [{ min: 0, max: 100 }],
  frases: FRASES_PARECIDO,
  alvoObrigatorio: true,
  mencionarAmbos: true,
  montarFrase: ({ numeroAutor, numeroAlvo, valor, frases }) =>
    frasePorValor(frases, valor)
      .replace('{a}', `@${numeroAutor}`)
      .replace('{b}', `@${numeroAlvo}`)
      .replace('{valor}', valor)
})

// ═══════════════════════════════════════════════════════════════════
// 💘 /crush — crush aleatório do dia entre os membros do grupo
//    (sock.groupMetadata), excluindo quem mandou e o próprio bot.
//    Trava diária POR USUÁRIO (chave: comando + grupo + autor).
// ═══════════════════════════════════════════════════════════════════
const comandoCrush = {
  nome: 'crush',
  descricao: 'Sorteia (1x por dia) qual membro do grupo é o seu crush secreto.',

  async executar (sock, jid, msg) {
    try {
      // 1) 💘 Só em grupo (o crush mora entre os membros do recinto)
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, { text: AVISO_CRUSH_FORA_GRUPO }, { quoted: msg })
      }

      const autorId = autorJidDaMensagem(msg, jid)
      const numeroAutor = apenasDigitos(autorId)

      // 2) 👥 Membros reais do grupo (prefere phoneNumber — resolve LID),
      //    deduplicados por dígitos, SEM quem mandou e SEM o bot.
      const metadados = await sock.groupMetadata(jid)
      const numeroDoBot = apenasDigitos(sock.user?.id)
      const vistos = new Set()
      const candidatos = []
      for (const participante of (metadados?.participants || [])) {
        const jidMembro = jidMencionavel(participante)
        if (!jidMembro) continue
        const digitos = apenasDigitos(jidMembro)
        if (!digitos || vistos.has(digitos)) continue
        if (digitos === numeroAutor) continue
        if (numeroDoBot && digitos === numeroDoBot) continue
        vistos.add(digitos)
        candidatos.push(jidMembro)
      }

      if (candidatos.length === 0) {
        return await sock.sendMessage(jid, { text: AVISO_CRUSH_SEM_ALMAS }, { quoted: msg })
      }

      // 3) 🔒 Veredito fixo do dia (chave: comando + grupo + autor;
      //    alvo_id = "grupo" — o crush não depende de menção)
      const { valor: crushJid, gravado } = await obterResultadoFixo({
        comando: 'crush',
        grupoId: jid,
        autorId,
        alvoId: 'grupo',
        sortear: async () => ({ valor: sortearFrase(candidatos) })
      })

      if (!crushJid) {
        return await sock.sendMessage(jid, { text: AVISO_CRUSH_SEM_ALMAS }, { quoted: msg })
      }

      const numeroCrush = apenasDigitos(crushJid)
      const nomeAutor = msg.pushName || numeroAutor || 'sonhador'
      const mensagem = sortearFrase(FRASES_CRUSH)
        .replace('{nome}', nomeAutor)
        .replace('{alvo}', numeroCrush)

      // 4) ✉️ Resposta (texto e mentions[] com o MESMO JID do crush)
      console.log(`[crush] 💘 crush de ${numeroAutor}: @${numeroCrush}${gravado ? ' (veredito de hoje já gravado)' : ''}`)
      return await sock.sendMessage(jid, {
        text: mensagem,
        mentions: [normalizarJid(crushJid)]
      }, { quoted: msg })
    } catch (err) {
      console.error('[crush] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      return await sock.sendMessage(jid, {
        text: '⛔ O cupido do limbo dormiu no ponto... Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}

// 📦 O loader do bot.js aceita ARRAY: um arquivo, cinco comandos.
// 🧪 O gancho de teste fica anexado ao array (arrays são objetos — o
// loader continua iterando os 5 comandos normalmente).
module.exports = [
  comandoSorte,
  comandoGay,
  comandoQi,
  comandoParecido,
  comandoCrush
]
module.exports.__definirColecaoTeste = __definirColecaoTeste




