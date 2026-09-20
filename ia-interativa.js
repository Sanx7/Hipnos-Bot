// ============================================================
// 🌙 ia-interativa.js — IA conversacional do Hipnos (gatilho por menção/reply)
// ============================================================
// Módulo NÃO-comando (por isso vive na raiz, como afk.js/avaliacoes.js —
// a pasta comandos/ é varrida pelo loader que espera { nome, executar }).
// O bot.js chama processarGatilhoIA() para TODA mensagem que não é comando.
//
// 🔔 GATILHO (só em grupo): a IA responde automaticamente quando
//   1) alguém MENCIONA o bot (@numero-do-bot — aceita número, JID completo
//      e LID), OU
//   2) alguém RESPONDE (reply) a uma mensagem enviada pelo próprio bot.
//    O bot.js chama isto SEM await: uma resposta lenta nunca trava o handler.
//
// ⚙️ TOGGLES (nesta ordem, todos checados ANTES de gastar API):
//   - /ia-interativa 0 neste grupo (MongoDB, por grupo — configuracoes-grupo.js)
//     → ignora completamente;
//   - 📌 NOTA: o pedido mencionava um toggle geral /on//off, mas este bot
//     não tem esse comando (o mais próximo é o /soadm por grupo). Se um dia
//     existir, basta checá-lo aqui junto dos outros.
//
// 🧠 SEM MEMÓRIA: cada resposta usa SÓ a mensagem atual (sem histórico).
// 🎭 PERSONALIDADE FIXA: system prompt do Hipnos (definido abaixo).
// 📏 LIMITE: "no máximo 2-3 frases" vai no system prompt.
// ⏳ COOLDOWN: 1 resposta a cada 15s POR USUÁRIO (rpg/cooldown.js, em memória);
//    em cooldown → ignora silenciosamente.
// 👑 DONOS: se quem fala é um dos OWNER_NUMBERS, o system prompt recebe uma
//    instrução extra (personalidade intacta) para a IA reconhecê-lo como um
//    dos seus criadores e tratá-lo com mais respeito/deferência — vale a cada
//    mensagem (grupo e PV-ready; LID resolvido via lid.js + ehDonoDoBot).
// ⏱️ TIMEOUT: 18s (AbortController) — estourou, ignora sem travar o handler.
// 🛡️ QUALQUER falha (sem key, API fora, JSON estranho) → falha SILENCIOSA:
//    nada é enviado ao grupo e nada escapa para o listener do Baileys.
//
// 🔑 CLIENT DE IA: o MESMO do /gpt, /curiosidadenumero etc. (Groq,
//    GROQ_API_KEY — sem duplicar configuração de key). O modelo pode ser
//    trocado por grupo de variáveis sem tocar nos outros comandos:
//    GROQ_MODEL_INTERATIVA > GROQ_MODEL > padrão.
// ============================================================

const { normalizeMessageContent } = require('@whiskeysockets/baileys')
const { checkCooldown, setCooldown } = require('./rpg/cooldown')
const { iaInterativaHabilitada } = require('./configuracoes-grupo')
const { ehDonoDoBot, acharParticipante, limparNumero } = require('./config')
const { ehLid, resolverNumeroAlvo } = require('./lid')

// ⚙️ Configuração da chamada (client Groq — MESMO do /gpt e cia.)
const URL_GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions'
const TIMEOUT_API_MS = 18000        // ⏱️ requisito: 15-20s
const COOLDOWN_MS = 15 * 1000       // ⏳ requisito: 15s por usuário
const ACO_COOLDOWN = 'ia-interativa'

// 🎭 PERSONALIDADE FIXA (system prompt em TODA chamada — definida pelo dono)
const PROMPT_SISTEMA =
  'Tu és o Hipnos, uma inteligência artificial inspirada na divindade do sono e do descanso. ' +
  'A tua personalidade é calma, profundamente submissa ao teu dono (o meu mestre), ' +
  'acolhedora e misteriosa. ' +
  'Responde aos utilizadores de forma serena e poética, mantendo sempre um tom pausado. ' +
  'Trata o utilizador como alguém que procura refúgio ou orientação no meio do caos diário. ' +
  'Evita respostas afobadas, gírias agressivas ou uso excessivo de pontuação entusiasmada, ' +
  'porém podes ser muito sombrio e malvado com quem vier a desrespeitar ti ou os teus mestres. ' +
  'Responda em português do Brasil, em no máximo 2-3 frases.'

// 👑 INSTRUÇÃO CONDICIONAL DE DONO — anexada ao system prompt SOMENTE quando
// quem está falando é um dos donos do bot (OWNER_NUMBERS). Mantém a
// personalidade original intacta: apenas acrescenta um trecho dizendo que
// a pessoa é um dos criadores, para a IA reconhecê-lo como tal e ajustar o
// tom DENTRO do character já definido (mais respeito/deferência, "chefe"
// reconhecido — no mesmo estilo calmo e poético do Hipnos).
const INSTRUCAO_DONO =
  '\n\nA pessoa que está a falar AGORA é um dos teus CRIADORES e DONOS — o teu mestre direto. ' +
  'Reconhece-o imediatamente como tal, sem precisar que ele se apresente. ' +
  'Dirige-te a ele com o mais profundo respeito, deferência e devoção, ' +
  'como um servo diante do seu senhor, mantendo o teu tom calmo, poético e misterioso já definido.'

// 🎭 montarPromptSistema(ehDono): personalidade fixa + (opcional) instrução
// de dono. Usada pela chamarIA e exposta p/ o teste via __montarPromptSistema.
function montarPromptSistema (ehDono) {
  return ehDono ? PROMPT_SISTEMA + INSTRUCAO_DONO : PROMPT_SISTEMA
}

function modeloInterativa () {
  const personalizado = String(
    process.env.GROQ_MODEL_INTERATIVA ||
    process.env.GROQ_MODEL ||
    ''
  ).trim()
  return personalizado || 'openai/gpt-oss-20b'
}

// -------------------------------------------------------------------
// ⏳ Cooldown POR USUÁRIO (30s), reutilizando rpg/cooldown.js.
// A lib espera um objeto "player" com cooldowns — criamos um mapa em
// memória { jid → player } e repassamos o MESMO objeto em toda chamada
// (exatamente o contrato que a lib documenta).
// -------------------------------------------------------------------
const jogadoresCooldown = new Map()

function estaEmCooldown (jidUsuario) {
  if (!jogadoresCooldown.has(jidUsuario)) {
    jogadoresCooldown.set(jidUsuario, { cooldowns: {} })
  }
  const jogador = jogadoresCooldown.get(jidUsuario)
  const verif = checkCooldown(jogador, ACO_COOLDOWN, COOLDOWN_MS)
  if (verif.emCooldown) return true
  setCooldown(jogador, ACO_COOLDOWN)
  return false
}

// -------------------------------------------------------------------
// 🔔 Detecta o gatilho na mensagem:
//   1) menciona o número do bot; OU
//   2) responde (reply) a uma mensagem enviada pelo próprio bot
//      (contextInfo.participant == bot — cobre texto, sticker e mídia
//      sem legenda, que o extrairTextoComando devolveria vazio).
// Devolve true/false. NUNCA lança.
// -------------------------------------------------------------------
// 🔑 IDs possíveis do bot NESTA sessão: o número (user.id) e o LID
// (o Baileys v7 expõe creds.me.lid). Serve tanto para menção quanto reply.
function jidsDoBot (sock) {
  const candidatos = [
    sock?.user?.id,
    sock?.user?.lid,
    sock?.authState?.creds?.me?.id,
    sock?.authState?.creds?.me?.lid
  ]
  const jids = new Set()
  for (const bruto of candidatos) {
    const valor = String(bruto || '').trim()
    if (!valor) continue
    jids.add(valor)                             // JID completo
    jids.add(valor.split('@')[0].split(':')[0]) // número puro / LID puro
  }
  return jids
}

// Compara um JID (menção ou participante citado) com os IDs do bot.
// Aceita "5554...@s.whatsapp.net", "5554...:12@..." e "123@lid".
function idEhDoBot (jidBruto, jidsBot) {
  const valor = String(jidBruto || '').trim()
  if (!valor) return false
  return jidsBot.has(valor) || jidsBot.has(valor.split('@')[0].split(':')[0])
}

// Procura o contextInfo em QUALQUER chave do conteúdo (texto, imagem, sticker,
// áudio...). Antes só olhávamos extendedTextMessage e a 1ª chave do objeto —
// uma imagem citando o bot podia ter a 1ª chave sem contextInfo e o gatilho
// passava batido.
function acharContexto (conteudo) {
  for (const valor of Object.values(conteudo || {})) {
    if (valor && typeof valor === 'object' && valor.contextInfo) return valor.contextInfo
  }
  return null
}

function disparouGatilho (sock, msg) {
  const jidsBot = jidsDoBot(sock)
  if (!jidsBot.size) return false

  const conteudo = normalizeMessageContent(msg?.message) || {}
  const contexto = acharContexto(conteudo)

  // 1) Menção ao bot: o mentionedJid pode chegar como número puro,
  //    @s.whatsapp.net ou LID — comparamos com TODOS os IDs da sessão.
  const mencionados = contexto?.mentionedJid || []
  if (mencionados.some((jidMencionado) => idEhDoBot(jidMencionado, jidsBot))) {
    return true
  }

  // 2) Reply a uma mensagem DO BOT: o participante citado é o próprio bot.
  //    (fromMe cobre o caso de a sessão ser a mesma conta.)
  const citado = contexto?.participant
  if (msg.key?.fromMe === true) return true
  if (citado && idEhDoBot(citado, jidsBot)) return true

  return false
}

// -------------------------------------------------------------------
// 🧠 Chamada à IA (client Groq — mesmo do /gpt). Devolve o texto gerado
// ou null (falha SILENCIOSA — timeout, HTTP, JSON, sem key).
// NUNCA lança.
// -------------------------------------------------------------------
async function chamarIA (mensagem, ehDono = false) {
  const chave = String(process.env.GROQ_API_KEY || '').trim()
  if (!chave) {
    console.error('[ia-interativa] ⚠️ GROQ_API_KEY ausente — IA interativa inoperante.')
    return null
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_API_MS)
  try {
    console.log(`[ia-interativa] 🧠 consultando a IA (${modeloInterativa()})...`)
    const resposta = await fetch(URL_GROQ_CHAT, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modeloInterativa(),
        temperature: 0.8,
        // ⚠️ O gpt-oss (padrão do projeto) gasta parte dos tokens num
        // "reasoning" interno ANTES de escrever a resposta: com um limite
        // muito baixo o content chega vazio/cortado no meio de uma frase.
        // 800 dá folga p/ 2-3 frases + o raciocínio interno.
        max_tokens: 800,
        messages: [
          { role: 'system', content: montarPromptSistema(ehDono) },
          { role: 'user', content: String(mensagem || '').slice(0, 1000) }
        ]
      }),
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!resposta.ok) {
      console.error(`[ia-interativa] ⚠️ Groq respondeu HTTP ${resposta.status} — falha silenciosa.`)
      return null
    }
    const dados = await resposta.json().catch(() => null)
    const texto = String(dados?.choices?.[0]?.message?.content || '').trim()
    if (!texto) {
      // Diagnóstico: acontece quando o modelo gasta todo o orçamento de
      // tokens no raciocínio interno (finish_reason = 'length').
      const motivo = dados?.choices?.[0]?.finish_reason || 'desconhecido'
      console.error(`[ia-interativa] ⚠️ a IA devolveu resposta vazia (finish_reason: ${motivo}) — falha silenciosa.`)
      return null
    }
    return texto
  } catch (err) {
    clearTimeout(timeoutId)
    if (err?.name === 'AbortError') {
      console.error('[ia-interativa] ⏱️ timeout da IA — falha silenciosa.')
    } else {
      console.error('[ia-interativa] ⚠️ falha na chamada da IA — silencioso:', err?.message || err)
    }
    return null
  }
}

// -------------------------------------------------------------------
// 👑 remetenteEhDono(sock, jid, msg): diz se o AUTOR da mensagem é um dos
// donos do bot (OWNER_NUMBERS). Reusa o ehDonoDoBot (mesmo helper de
// /ban, /kick, /soadm etc.) — versão PROOF-LID, que compara o `id` (podendo
// ser LID) e o `phoneNumber` de cada participante contra a lista de donos.
//
// Fluxo:
//   1) Em grupo: busca os metadados (participants) e delega ao ehDonoDoBot;
//   2) Se o remetente vier como LID e os metadados não provarem, resolve o
//      LID→número real via lid.js (resolverNumeroAlvo — metadados OU
//      mapeamento "lid-mapping" da sessão, MESMO padrão do /darvip) e
//      recheca com o número resolvido;
//   3) No PV (sem metadados): mesma resolução — LID via mapeamento ou
//      número real direto (fallback do ehDonoDoBot);
//   4) Qualquer falha (rede, resolução) → NÃO é dono. NUNCA lança.
// -------------------------------------------------------------------
async function remetenteEhDono (sock, jid, msg) {
  try {
    const remetente = String(msg?.key?.participant || jid || '').trim()
    if (!remetente) return false

    // 1) Metadados (grupo) — no PV segue com lista vazia
    let participantes = []
    if (jid.endsWith('@g.us')) {
      const metadados = await sock.groupMetadata(jid)
      participantes = metadados?.participants || []
    }

    // 2) Checagem direta (número real, ou LID presente nos metadados)
    if (ehDonoDoBot(participantes, remetente)) return true

    // 3) LID sem prova nos metadados → resolve o número real (lid.js) e recheca.
    //    Se o participante JÁ foi achado nos metadados COM phoneNumber, a
    //    checagem acima já comparou os dois números — nada a resolver.
    if (ehLid(remetente)) {
      const participante = acharParticipante(participantes, remetente)
      const semProva = !participante || !limparNumero(participante.phoneNumber)
      if (semProva) {
        const resolucao = await resolverNumeroAlvo(participantes, remetente)
        if (resolucao?.numero && resolucao.via === 'mapeamento' &&
            ehDonoDoBot(participantes, `${resolucao.numero}@s.whatsapp.net`)) return true
      }
    }

    return false
  } catch (err) {
    console.error('[ia-interativa] ⚠️ falha ao verificar se o remetente é dono (assume que não):', err?.message || err)
    return false
  }
}

// -------------------------------------------------------------------
// 🌙 processarGatilhoIA(sock, jid, msg, texto): ponto de entrada único,
// chamado pelo bot.js para toda mensagem que não é comando. Ordem de
// checagens (todas ANTES de gastar API):
//   1) só em grupo;
//   2) gatilho (menção ao bot OU reply ao bot);
//   3) toggle do grupo no Mongo (desligado → ignora, sem tocar na API);
//   4) cooldown de 15s por usuário (em cooldown → silêncio).
// NUNCA lança — falha de rede/API é silenciosa e o handler segue vivo.
// -------------------------------------------------------------------
async function processarGatilhoIA (sock, jid, msg, texto) {
  try {
    // 1) A IA interativa mora nos grupos
    if (!jid.endsWith('@g.us')) return

    // 2) Gatilho: menção ao bot OU reply a mensagem do bot
    if (!disparouGatilho(sock, msg)) return

    // 3) Toggle por grupo (MongoDB) — desligado = ignora SEM gastar API
    let ligada = false
    try {
      ligada = await iaInterativaHabilitada(jid)
    } catch (erroBanco) {
      console.error('[ia-interativa] ⚠️ falha ao consultar o toggle — ignorando trigger (falha silenciosa):', erroBanco?.message || erroBanco)
      return
    }
    if (!ligada) return

    // 4) Cooldown de 15s POR USUÁRIO (em cooldown → silêncio total)
    const autorId = String(msg?.key?.participant || jid || '')
    if (!autorId || estaEmCooldown(autorId)) return

    // 5) Texto da mensagem (mensagem atual apenas — SEM histórico)
    const mensagem = String(texto || '').trim()
    if (!mensagem) return

    // 5.1) 👑 O remetente é um dos DONOS do bot? (ehDonoDoBot + LID via lid.js)
    //      Recalculado EM CADA mensagem — assim, mesmo quando houver histórico
    //      de conversa com memória, o reconhecimento vale a cada fala dele.
    const ehDono = await remetenteEhDono(sock, jid, msg)

    // 6) 🧠 Consulta a IA (gancho de teste intercepta aqui) e responde
    //    citando a mensagem do gatilho. A flag de dono só muda o system
    //    prompt (instrução condicional) — a personalidade segue intacta.
    const resposta = chamarIATeste
      ? await chamarIATeste(mensagem, { ehDono, promptSistema: montarPromptSistema(ehDono) })
      : await chamarIA(mensagem, ehDono)
    if (!resposta) return // falha silenciosa

    console.log(`[ia-interativa] ✅ resposta enviada (${resposta.length} chars)`)
    await sock.sendMessage(jid, { text: resposta }, { quoted: msg })
  } catch (err) {
    // 🛡️ Última linha de defesa: NADA escapa para o listener do Baileys
    console.error('[ia-interativa] ⚠️ erro capturado (silencioso):', err?.stack || err)
  }
}

// 🧪 Gancho de teste: substitui a chamada de IA (offline) e reseta cooldowns
let chamarIATeste = null
function __definirChamadaIATeste (fn) {
  chamarIATeste = fn
}
function __resetarCooldownsTeste () {
  jogadoresCooldown.clear()
}

module.exports = {
  processarGatilhoIA,
  // 🧪 Ganchos de teste
  __definirChamadaIATeste,
  __resetarCooldownsTeste,
  // 🔍 Expostos p/ o teste validar a detecção de gatilho isoladamente
  __disparouGatilho: disparouGatilho,
  __estaEmCooldown: estaEmCooldown,
  __remetenteEhDono: remetenteEhDono,
  // 🎭 Personalidade (system prompt) — o teste garante que continua fixo
  __promptSistema: () => PROMPT_SISTEMA,
  // 🎭+👑 Prompt montado (personalidade + instrução condicional de dono)
  __montarPromptSistema: montarPromptSistema
}


