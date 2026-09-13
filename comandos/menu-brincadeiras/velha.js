// ============================================
// ❌⭕ VELHA — O Jogo da Velha de Hipnos
// ============================================
// /velha @user        -> inicia partida de 2 jogadores (quem chama + marcado)
// /velha cancelar     -> encerra a partida em curso do grupo
// /jogar [1-9]        -> marca uma posição (numeração tipo teclado numérico)
//
// Verifica vitória (linha/coluna/diagonal) ou empate a cada jogada,
// reenviando o tabuleiro atualizado. Só aceita jogada de quem é a vez.
//
// O estado de cada partida vive AQUI num Map por grupo (módulo compartilhado),
// para que /jogar (jogar.js) veja a MESMA partida — mesmo padrão de
// brincadeira.js -> menu-brincadeiras.js. Se o bot reiniciar, a memória se
// perde: aceitável para uma brincadeira entre sonhos.
// ============================================

const { limparNumero, acharParticipante } = require('../../config')

// ─── Numeração tipo teclado numérico (pad) ───
//   7 8 9
//   4 5 6
//   1 2 3
const PAD_PARA_INDICE = { 7: 0, 8: 1, 9: 2, 4: 3, 5: 4, 6: 5, 1: 6, 2: 7, 3: 8 }
const INDICE_PARA_PAD = [7, 8, 9, 4, 5, 6, 1, 2, 3]
const LEYENDA_PAD = '7 8 9\n4 5 6\n1 2 3'

// Combinações vencedoras (índices do tabuleiro linear 0-8)
const VITORIAS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // linhas
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // colunas
  [0, 4, 8], [2, 4, 6]             // diagonais
]

// ⚠️ Mensagens configuradas (pt-BR, temática onírica do bot)
const AVISO_FORA_GRUPO =
  '❌⭕ *JOGO DA VELHA*\n\n' +
  'Os tabuleiros do sonho só se desenham dentro de um grupo. Use este comando no grupo ' +
  'e desafie alguém: `/velha @rival`.'

const AVISO_SEM_RIVAL =
  '❌⭕ Para iniciar uma partida, marque seu rival: `/velha @usuario`\n' +
  '(ou responda a uma mensagem dele para desafiá-lo).'

const AVISO_MESMA_PESSOA =
  '❌⭕ Não dá para jogar contra si mesmo, mortal. Marque outro participante do grupo.'

const AVISO_BOT =
  '❌⭕ Hipnos não se enfrenta a si mesmo... Marque outro participante do grupo.'

const CONFIRMA_CANCEL =
  '❌⭕ Partida encerrada. Os tabuleiros voltam ao sonho... até que alguém os invoque de novo.'

const AVISO_SEM_PARTIDA =
  '❌⭕ Não há partida em curso neste grupo. Inicie uma com `/velha @rival`.'

const AVISO_FORA_PARTIDA =
  '❌⭕ Essa partida não é sua, curioso. Espere a próxima e desafie alguém com `/velha @rival`.'

const AVISO_NUMERO_INVALIDO =
  '❌⭕ Número inválido. Use `/jogar` com uma posição de 1 a 9 (teclado numérico):\n\n' +
  LEYENDA_PAD + '\n\nTabuleiro atual:\n'

const AVISO_ERRO =
  '❌⭕ As sombras confundiram o tabuleiro... Tente novamente.'

// ─── Estado das partidas em curso (por jid do grupo) ───
const partidas = new Map()

function tabuleiroNovo() {
  return Array(9).fill(null)
}

function EMOJI(marca) {
  return marca === 'X' ? '❌' : '⭕'
}

// Desenha o tabuleiro 3x3. Com `guia` as casas vazias mostram o número do
// pad (mensagem inicial); durante o jogo as vazias são ▫️.
function desenharTablero(tablero, { guia = false } = {}) {
  const linhas = []
  for (let f = 0; f < 3; f++) {
    const celulas = []
    for (let c = 0; c < 3; c++) {
      const idx = f * 3 + c
      const marca = tablero[idx]
      if (marca) celulas.push(EMOJI(marca))
      else if (guia) celulas.push(String(INDICE_PARA_PAD[idx]))
      else celulas.push('▫️')
    }
    linhas.push(celulas.join('  '))
  }
  return linhas.join('\n')
}

// Estado do tabuleiro: 'vitoria' | 'empate' | 'emcurso'
function verificarEstado(tablero) {
  for (const linha of VITORIAS) {
    const [a, b, c] = linha
    if (tablero[a] && tablero[a] === tablero[b] && tablero[a] === tablero[c]) {
      return { resultado: 'vitoria', vencedor: tablero[a], linha }
    }
  }
  if (tablero.every(Boolean)) return { resultado: 'empate', vencedor: null, linha: null }
  return { resultado: 'emcurso', vencedor: null, linha: null }
}

// ─── Identidade (padrão PROOF-LID do resto do bot) ───
// Uma mesma pessoa pode chegar como LID (@lid) ou número real
// (@s.whatsapp.net), às vezes com sufixo de dispositivo (:N). Guardamos
// TODAS as formas em dígitos (id, phoneNumber e jid bruto) e comparamos
// por interseção.
function formasDe(...jids) {
  const set = new Set()
  for (const jid of jids) {
    const digitos = limparNumero(jid)
    if (digitos) set.add(digitos)
  }
  return set
}

function ehMesmaPessoa(formas, ...jids) {
  return jids.some((jid) => {
    const digitos = limparNumero(jid)
    return digitos && formas.has(digitos)
  })
}

// JID padrão para mentions[]: prefere phoneNumber (número real) e mantém
// o domínio ORIGINAL, sem sufixo :N — ainda que o remetente chegue como LID.
function jidMencaoavel(participante, jidBruto) {
  const bruto = participante?.phoneNumber || participante?.id || jidBruto || ''
  const [usuario, servidor] = String(bruto).split('@')
  if (!usuario || !servidor) return ''
  return `${usuario.split(':')[0]}@${servidor}`
}

// Identidade canônica de um jogador, resolvendo LID -> número pelos metadados.
function resolverJogador(participantes, jidBruto) {
  const jid = jidBruto || ''
  const participante = acharParticipante(participantes, jid)
  return {
    formas: formasDe(jid, participante?.id, participante?.phoneNumber),
    jidMencao: jidMencaoavel(participante, jid),
    numero: limparNumero(participante?.phoneNumber || participante?.id || jid)
  }
}

function mencoesPara(jid) {
  return jid ? [jid] : undefined
}

// ─── /velha: iniciar partida ───
async function iniciarPartida(sock, jid, msg, texto) {
  try {
    // O tabuleiro só existe dentro dos grupos
    if (!jid.endsWith('@g.us')) {
      return await sock.sendMessage(jid, { text: AVISO_FORA_GRUPO }, { quoted: msg })
    }

    // /velha cancelar -> encerra a partida em curso
    if (/^\/velha\s+cancel/i.test(String(texto || ''))) {
      partidas.delete(jid)
      return await sock.sendMessage(jid, { text: CONFIRMA_CANCEL }, { quoted: msg })
    }

    const metadados = await sock.groupMetadata(jid)
    const participantes = metadados?.participants || []

    const remetente = msg.key?.participant || msg.key?.remoteJid || ''
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo
    const alvo = contextInfo?.mentionedJid?.[0] || contextInfo?.participant || ''

    if (!alvo) {
      return await sock.sendMessage(jid, { text: AVISO_SEM_RIVAL }, { quoted: msg })
    }

    // Quem chama = ❌; o marcado = ⭕
    const jogador1 = resolverJogador(participantes, remetente)
    const jogador2 = resolverJogador(participantes, alvo)

    // Contra si mesmo?
    if (ehMesmaPessoa(jogador1.formas, alvo)) {
      return await sock.sendMessage(jid, { text: AVISO_MESMA_PESSOA }, { quoted: msg })
    }

    // Contra o próprio bot? (no WhatsApp dá para marcar o Hipnos)
    const numeroBot = limparNumero(sock.user?.id)
    if (numeroBot && jogador2.formas.has(numeroBot)) {
      return await sock.sendMessage(jid, { text: AVISO_BOT }, { quoted: msg })
    }

    // Já há partida em curso -> mostra o tabuleiro e de quem é a vez
    const existente = partidas.get(jid)
    if (existente) {
      const vezDe = existente.jogadores[existente.turno]
      const textoExistente =
        '❌⭕ *JOGO DA VELHA* ❌⭕\n\n' +
        'Já há uma partida em curso neste grupo.\n\n' +
        `${desenharTablero(existente.tabuleiro)}\n\n` +
        `É a vez de @${vezDe.numero} (${EMOJI(existente.turno)}) — use /jogar <nº>.\n` +
        'Para encerrar: `/velha cancelar`'
      return await sock.sendMessage(jid, {
        text: textoExistente,
        mentions: mencoesPara(vezDe.jidMencao)
      }, { quoted: msg })
    }

    // Cria e guarda a partida
    const partida = {
      tabuleiro: tabuleiroNovo(),
      turno: 'X',
      jogadores: {
        X: jogador1,
        O: jogador2
      }
    }
    partidas.set(jid, partida)

    const textoInicio =
      '❌⭕ *JOGO DA VELHA* ❌⭕\n\n' +
      `Desafio sonhado: @${jogador1.numero} (❌) contra @${jogador2.numero} (⭕).\n\n` +
      `🕹️ Posições (teclado numérico):\n${LEYENDA_PAD}\n\n` +
      `${desenharTablero(partida.tabuleiro, { guia: true })}\n\n` +
      `Começa @${jogador1.numero} (❌) — marque com /jogar <nº>.`

    return await sock.sendMessage(jid, {
      text: textoInicio,
      mentions: [jogador1.jidMencao, jogador2.jidMencao].filter(Boolean)
    }, { quoted: msg })
  } catch (err) {
    console.error('Erro no comando velha (início):', err)
    await sock.sendMessage(jid, { text: AVISO_ERRO }, { quoted: msg }).catch(() => {})
  }
}

// ─── /jogar: marcar uma posição ───
async function jogar(sock, jid, msg, texto) {
  try {
    if (!jid.endsWith('@g.us')) {
      return await sock.sendMessage(jid, { text: AVISO_FORA_GRUPO }, { quoted: msg })
    }

    const partida = partidas.get(jid)
    if (!partida) {
      return await sock.sendMessage(jid, { text: AVISO_SEM_PARTIDA }, { quoted: msg })
    }

    // Extrai o número: "/jogar 5" -> "5"
    const posicionBruto = String(texto || '').replace(/^\s*\/\S+\s*/, '').trim()
    const posicion = /^[1-9]$/.test(posicionBruto) ? posicionBruto : null
    const indice = posicion === null ? null : PAD_PARA_INDICE[String(posicion)]

    if (indice === null) {
      return await sock.sendMessage(jid, {
        text: AVISO_NUMERO_INVALIDO + desenharTablero(partida.tabuleiro)
      }, { quoted: msg })
    }

    // Quem joga? (resolve LID -> número pelos metadados)
    const metadados = await sock.groupMetadata(jid)
    const participantes = metadados?.participants || []
    const remetente = msg.key?.participant || msg.key?.remoteJid || ''

    // Está na partida?
    const esX = ehMesmaPessoa(partida.jogadores.X.formas, remetente)
    const esO = ehMesmaPessoa(partida.jogadores.O.formas, remetente)
    if (!esX && !esO) {
      return await sock.sendMessage(jid, { text: AVISO_FORA_PARTIDA }, { quoted: msg })
    }

    const marca = esX ? 'X' : 'O'

    // É a vez desse jogador?
    if (marca !== partida.turno) {
      const vezDe = partida.jogadores[partida.turno]
      return await sock.sendMessage(jid, {
        text: `⏳ Calma, mortal... Ainda não é a sua vez. É a vez de @${vezDe.numero} (${EMOJI(partida.turno)}).`,
        mentions: mencoesPara(vezDe.jidMencao)
      }, { quoted: msg })
    }

    // Casa livre?
    if (partida.tabuleiro[indice]) {
      return await sock.sendMessage(jid, {
        text: `❌⭕ Essa casa já está marcada. Escolha outra:\n\n${desenharTablero(partida.tabuleiro)}`
      }, { quoted: msg })
    }

    // Marca e confere o resultado
    partida.tabuleiro[indice] = partida.turno
    const estado = verificarEstado(partida.tabuleiro)
    const marcador = partida.jogadores[partida.turno]
    const tabuleiroDesenhado = desenharTablero(partida.tabuleiro)

    if (estado.resultado === 'vitoria') {
      partidas.delete(jid)
      const textoFinal =
        '❌⭕ *JOGO DA VELHA* ❌⭕\n\n' +
        `${tabuleiroDesenhado}\n\n` +
        `🏆 Vence @${marcador.numero} (${EMOJI(estado.vencedor)})! O destino onírico dobrou o tabuleiro a seu favor. 🌙`
      return await sock.sendMessage(jid, {
        text: textoFinal,
        mentions: mencoesPara(marcador.jidMencao)
      }, { quoted: msg })
    }

    if (estado.resultado === 'empate') {
      partidas.delete(jid)
      const textoFinal =
        '❌⭕ *JOGO DA VELHA* ❌⭕\n\n' +
        `${tabuleiroDesenhado}\n\n` +
        '🤝 Empate... Os sonhos se cancelam um ao outro. Ninguém leva o troféu. 🌑\n' +
        'Para a revanche: `/velha @rival`'
      return await sock.sendMessage(jid, { text: textoFinal }, { quoted: msg })
    }

    // O jogo segue: troca a vez
    partida.turno = partida.turno === 'X' ? 'O' : 'X'
    const proximo = partida.jogadores[partida.turno]
    const textoTurno =
      '❌⭕ *JOGO DA VELHA* ❌⭕\n\n' +
      `${tabuleiroDesenhado}\n\n` +
      `⏳ É a vez de @${proximo.numero} (${EMOJI(partida.turno)}) — /jogar <nº>.`

    return await sock.sendMessage(jid, {
      text: textoTurno,
      mentions: mencoesPara(proximo.jidMencao)
    }, { quoted: msg })
  } catch (err) {
    console.error('Erro no comando jogar:', err)
    await sock.sendMessage(jid, { text: AVISO_ERRO }, { quoted: msg }).catch(() => {})
  }
}

module.exports = {
  nome: 'velha',
  aliases: ['jogovelha', 'tictactoe'],
  descricao: 'Inicia uma partida de jogo da velha 3x3 contra quem você marcar.',
  executar: iniciarPartida,
  // Extras internos usados por /jogar (jogar.js) e pelos testes
  jogar,
  jugar: jogar, // alias de compatibilidade
  partidas,
  verificarEstado,
  desenharTablero,
  desenharTabuleiro: desenharTablero, // alias pt-BR
  PAD_PARA_INDICE,
  LEYENDA_PAD
}