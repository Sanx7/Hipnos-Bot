// ============================================================
// 🖌️ DESENHAR-PALAVRA — Pictionary só com texto (uso LIVRE)
// ============================================================
//   /desenharpalavra             → inicia uma rodada (ou mostra a ativa)
//   /desenharpalavra <categoria> → inicia filtrando pela categoria
//   /desenharpalavra desistir    → encerra revelando a resposta
//   (também: /pictionary)
//
// COMO FUNCIONA (Pictionary 100% em texto)
//   - 🎨 Um jogador é o DESCRITOR: recebe a palavra sorteada SÓ NO
//     PRIVADO (no PV dele) e tem que "desenhar" com PALAVRAS no grupo —
//     sem nunca escrever a palavra, nem parecidas;
//   - 💬 Os outros chutam em TEXTO LIVRE no grupo. Quem acertar primeiro
//     vence; o palpite do próprio descritor NÃO conta como chute (é dica);
//   - 🚫 Dica inválida: se a mensagem do descritor contiver a palavra
//     sorteada (ou a raiz dela), o bot invalida a dica e avisa no grupo;
//   - ⏳ ~3 minutos sem acerto → revela a palavra e encerra;
//   - 🔒 Um jogo ativo por grupo via registro COMPARTILHADO
//     (dados/jogos-ativos.js) — bloqueio cruzado com /velha, /anagrama,
//     /gartic, /quiz, /forca e /adivinha-emoji.
//
// 🗄️ Banco de palavras: dados/palavras-anagrama.js (MESMA lista do /anagrama,
//    /gartic e /forca) — nada de lista duplicada.
//
// 🧠 Tolerância de palpite: dados/comparacao-palavras.js (FONTE ÚNICA,
//    extraída do /adivinha-emoji) — aceita acento, maiúscula, artigo e
//    erro de digitação pequeno.
//
// 🛡️ Por que o /gartic e o /forca guardam `sock` nos dados: para o timer
//    de expiração conseguir avisar o grupo sem depender do listener.
// ============================================================

const { CATEGORIAS, sortearPalavra, normalizar: normalizarCategoria } = require('../../dados/palavras-anagrama')
const {
  TIPOS,
  rotuloDoTipo,
  registrarJogo,
  removerJogo,
  obterJogo,
  registrarOuvinteTexto
} = require('../../dados/jogos-ativos')
// 🧠 Comparação tolerante compartilhada (mesma do /adivinha-emoji)
const { acertou, soAlfaNum } = require('../../dados/comparacao-palavras')

const TIPO_JOGO = TIPOS.DESENHAR_PALAVRA
const DURACAO_PARTIDA_MS = 3 * 60 * 1000 // ⏳ ~3 minutos por rodada

// ─── ✉️ Mensagens (pt-BR, temática onírica) ───
const AVISO_FORA_GRUPO =
  '🖌️ *DESENHAR PALAVRA*\n\n' +
  'O jogo precisa de um grupo: é lá que o descritor dá as dicas e os outros chutam. ' +
  'Chame os amigos e rode `/desenharpalavra` no grupo.'

const AVISO_SEM_JOGO = '❌ Não tem nenhum desenho rolando neste grupo. Comece com `/desenharpalavra`!'

const AVISO_ERRO = '⛔ As sombras atrapalharam o desenho... Tente novamente em instantes.'

// ─── 🔎 A dica do descritor estragou a rodada? ───
// Checagem SIMPLES, conforme combinado: a mensagem é comparada com a
// palavra sorteada e com a RAIZ dela (sem a última letra), para o
// descritor não escapar só por escrever "gatos" em vez de "gato".
function raizDe (palavra) {
  const limpa = String(palavra || '').trim()
  return limpa.length > 4 ? limpa.slice(0, -1) : limpa
}

function dicaInvalida (texto, palavra) {
  const limpo = soAlfaNum(texto)
  const alvo = soAlfaNum(palavra)
  if (!limpo || !alvo) return false
  if (limpo.includes(alvo)) return true
  const raiz = soAlfaNum(raizDe(palavra))
  // A raiz só vale com 4+ letras (senão "sol" barraria "solteiro")
  return raiz.length >= 4 && limpo.includes(raiz)
}

// ─── 📋 Estado (ganchos p/ os testes offline) ───
let sortear = sortearPalavra
let duracaoPartidaMs = DURACAO_PARTIDA_MS
let agendar = (fn, ms) => setTimeout(fn, ms)
let limparTimer = (id) => clearTimeout(id)

// ─── 🔓 Encerra a rodada (acerto, timeout ou desistência) ───
function encerrarRodada (jid) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) return null
  const dados = jogo.dados || {}
  if (dados.timer) {
    limparTimer(dados.timer)
    dados.timer = null
  }
  removerJogo(jid, TIPO_JOGO)
  return dados
}

// ─── 🖌️ Inicia uma rodada (ou mostra a ativa) ───
async function iniciar (sock, jid, msg, autor, categoria) {
  if (!String(jid || '').endsWith('@g.us')) {
    return await sock.sendMessage(jid, { text: AVISO_FORA_GRUPO }, { quoted: msg })
  }

  const atual = obterJogo(jid)
  if (atual && atual.tipo === TIPO_JOGO) {
    const d = atual.dados || {}
    return await sock.sendMessage(jid, {
      text: '🖌️ *JÁ TEM UM DESENHO ROLANDO NESTE GRUPO!*\n\n' +
        `👤 Descritor: @${String(d.autor || '').split('@')[0]}\n` +
        `📂 Categoria: *${d.categoria}* (só ele sabe qual é)\n` +
        '⏳ Acelera o desenho — o tempo está correndo!'
    }, { quoted: msg })
  }

  const palavraObj = sortear(categoria)
  if (!palavraObj || !palavraObj.palavra) {
    return await sock.sendMessage(jid, {
      text: `❌ Não conheço essa categoria...\n\n📂 Categorias válidas: ${CATEGORIAS.join(', ')}`
    }, { quoted: msg })
  }

  // 🔒 Registra a rodada ANTES de qualquer envio (bloqueio cruzado real)
  const dados = {
    palavra: palavraObj.palavra,
    categoria: palavraObj.categoria,
    autor,
    inicio: Date.now(),
    duracaoMs: duracaoPartidaMs,
    timer: null,
    sock
  }
  const registro = registrarJogo(jid, TIPO_JOGO, dados)
  if (!registro.ok) {
    return await sock.sendMessage(jid, {
      text: `🔒 Já tem um *${rotuloDoTipo(registro.conflito?.tipo)}* rolando neste grupo. Termine (ou cancele) ele antes.`
    }, { quoted: msg })
  }

  dados.timer = agendar(() => aoExpirar(jid), dados.duracaoMs)
  console.log(`[desenharpalavra] 🖌️ nova rodada em ${jid}: ${palavraObj.palavra} (descritor ${autor})`)

  const minutos = Math.max(1, Math.round(dados.duracaoMs / 60000))

  // 🔐 A PALAVRA SÓ VAI NO PV DO DESCRITOR — nunca no grupo.
  await sock.sendMessage(autor, {
    text: `🖌️ *SUA PALAVRA (só você vê isso!)*\n\n` +
      `🔤 *${palavraObj.palavra}*\n` +
      `📂 Categoria: *${palavraObj.categoria}*\n\n` +
      '🎨 Desenhe com PALAVRAS no grupo — mas cuidado:\n' +
      '🚫 Não escreva a palavra (nem "quase" ela: variação também estraga a dica).\n' +
      `⏳ Você tem ${minutos} minutos antes de o tempo acabar.`
  }).catch((err) => console.error('[desenharpalavra] falha ao enviar a palavra no PV:', err?.message || err))

  // …e o grupo só recebe o aviso, SEM a palavra.
  return await sock.sendMessage(jid, {
    text: '🖌️ *COMEÇOU O DESENHO DA PALAVRA!* 🎨\n\n' +
      `👤 @${String(autor).split('@')[0]} é o *descritor* — recebeu a palavra no privado dele.\n` +
      `⏳ Tempo: ${minutos} minuto(s). Quem adivinhar primeiro ganha!\n\n` +
      '💬 Todos os outros: chute a palavra direto no chat (texto livre).'
  }, { quoted: msg })
}

// ─── ⏳ Expirou: revela a palavra e encerra sozinho ───
function aoExpirar (jid) {
  try {
    const dados = encerrarRodada(jid)
    if (!dados || !dados.sock) return
    console.log(`[desenharpalavra] ⌛ rodada expirada em ${jid} (palavra: ${dados.palavra})`)
    dados.sock.sendMessage(jid, {
      text: '⌛ *O TEMPO ACABOU!* Ninguém adivinhou dessa vez...\n\n' +
        `🔤 A palavra era: *${dados.palavra}* (${dados.categoria})\n\n` +
        '🌙 Digite `/desenharpalavra` para uma nova rodada!'
    }).catch(() => {})
  } catch (err) {
    console.error('[desenharpalavra] 💥 erro ao encerrar por tempo:', err?.stack || err)
  }
}

// ─── 🏳️ Desistência ───
async function desistir (sock, jid, msg) {
  const dados = encerrarRodada(jid)
  if (!dados) {
    return await sock.sendMessage(jid, { text: AVISO_SEM_JOGO }, { quoted: msg })
  }
  return await sock.sendMessage(jid, {
    text: `🏳️ Rodada encerrada. A palavra era: *${dados.palavra}* (${dados.categoria})\n\n` +
      '🌙 Digite `/desenharpalavra` para jogar de novo!'
  }, { quoted: msg })
}

// ─── 💬 Ouvinte de TEXTO LIVRE (gancho do bot.js via jogos-ativos.js) ───
// Toda mensagem do grupo SEM "/" cai aqui. Duas situações:
//
//   1) 👤 É o DESCRITOR → é uma DICA. Se a dica contém a palavra (ou a
//      raiz), a dica é INVALIDADA e o grupo é avisado — o descritor não
//      pode estragar o jogo. O palpite dele NUNCA conta como acerto.
//   2) 💬 É um JOGADOR → é um PALPITE. Só é consumido quando acerta
//      (senão o bot fica calado, para não poluir a brincadeira).
async function aoReceberMensagem (sock, jid, msg, texto) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) return false
  const dados = jogo.dados || {}
  const autor = msg.key?.participant || msg.key?.remoteJid || ''
  const limpo = String(texto || '').trim()
  if (!limpo) return false

  // 1) Dica do descritor
  if (autor === dados.autor) {
    if (!dicaInvalida(limpo, dados.palavra)) return false // dica boa: silêncio
    await sock.sendMessage(jid, {
      text: `🚫 *@${String(autor).split('@')[0]}, essa dica estragou o jogo!* 😅\n\n` +
        'Você não pode escrever (nem "quase" escrever) a palavra. Tente descrever com outras palavras!'
    }, { quoted: msg }).catch(() => {})
    return true
  }

  // 2) Palpite de um jogador
  if (!acertou(limpo, dados.palavra)) return false // errou: o bot não diz nada

  const minutos = Math.max(1, Math.round(((dados.duracaoMs || DURACAO_PARTIDA_MS) - (Date.now() - (dados.inicio || Date.now()))) / 60000))
  encerrarRodada(jid)
  console.log(`[desenharpalavra] 🏆 acerto em ${jid}: ${dados.palavra} por ${autor}`)

  await sock.sendMessage(jid, {
    text: `🏆 *ACERTOU!* @${String(autor).split('@')[0]} descobriu a palavra em ~${minutos} min(s)!\n\n` +
      `🔤 A palavra era: *${dados.palavra}* (${dados.categoria})\n` +
      `🎨 Desenho de: @${String(dados.autor || '').split('@')[0]}\n\n` +
      '🌙 Digite `/desenharpalavra` para uma nova rodada!',
    mentions: [autor]
  }, { quoted: msg }).catch(() => {})
  return true
}

// 💬 O ouvinte de texto livre é registrado UMA vez, no carregamento do módulo
registrarOuvinteTexto(TIPO_JOGO, aoReceberMensagem)

// ---- EXPORTAÇÃO PRINCIPAL (mesmo contrato do loader: nome + executar) ----
module.exports = {
  nome: 'desenharpalavra',
  aliases: ['pictionary'],
  descricao: 'Pictionary em texto: o descritor recebe a palavra no PV e os outros adivinham no chat (um jogo por grupo, ~3 minutos).',

  executar: async function (sock, jid, msg, texto) {
    try {
      const resto = String(texto || '').replace(/^\/\S+\s*/, '').trim()
      const normalizado = normalizarCategoria(resto).toLowerCase()
      if (normalizado === 'desistir' || normalizado === 'cancelar' || normalizado === 'parar') {
        return await desistir(sock, jid, msg)
      }
      const autor = msg.key?.participant || msg.key?.remoteJid
      const categoria = CATEGORIAS.find((c) => normalizarCategoria(c).toLowerCase() === normalizado) || null
      return await iniciar(sock, jid, msg, autor, categoria)
    } catch (err) {
      // 🛡️ Nada escapa para o socket
      console.error('[desenharpalavra] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, { text: AVISO_ERRO }, { quoted: msg }).catch(() => {})
    }
  },

  // Extras internos usados pelos testes offline
  TIPO_JOGO,
  DURACAO_PARTIDA_MS,
  raizDe,
  dicaInvalida,
  iniciar,
  aoExpirar,
  aoReceberMensagem,
  desistir,
  encerrarRodada,
  _injetarSorteio: (fn) => { sortear = fn || sortearPalavra },
  _definirDuracao: (ms) => { duracaoPartidaMs = Number(ms) > 0 ? Number(ms) : DURACAO_PARTIDA_MS },
  _injetarAgendador: (fnAgendar, fnLimpar) => {
    agendar = fnAgendar || ((fn, ms) => setTimeout(fn, ms))
    if (typeof fnLimpar === 'function') limparTimer = fnLimpar
  }
}