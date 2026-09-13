// ============================================
// 🧪 teste-velha.js — Valida /velha + /jogar (jogo da velha 3x3)
// ============================================
// RODA OFFLINE: usa um sock mockado com sendMessage registrador e
// groupMetadata com participantes fake (o emissor chega como @lid e o rival
// também é mencionado como @lid — prova a resolução LID→número).
// Verifica:
//   - exports de velha e do reexport de /jogar;
//   - bloqueio fora de grupos;
//   - /velha sem menção / mesma pessoa / bot -> avisos;
//   - início de partida (tabuleiro + turno ❌ + mentions) e cancelamento;
//   - partida em curso: não permite iniciar outra;
//   - /jogar sem partida, número inválido, posição ocupada;
//   - só joga quem é a vez (fora da vez e forâneos bloqueados);
//   - vitória por linha e empate -> partida removida do Map.
// Uso: node scripts/teste-velha.js
// ============================================

const velha = require('../comandos/menu-brincadeiras/velha')
const jogar = require('../comandos/menu-brincadeiras/jogar')

// ─── JIDs de teste ───
const JID_GRUPO = '120363000000000000@g.us'
const JID_PRIVADO = '5555000000001@s.whatsapp.net'

// Emissor: o WhatsApp entrega o autor como LID (@lid)
const LID_EMISSOR = '987654321098765432@lid'
const NUM_EMISSOR = '5211999990001@s.whatsapp.net'
// Rival: mencionado também como LID
const LID_RIVAL = '111222333444555666@lid'
const NUM_RIVAL = '5211999990002@s.whatsapp.net'
// Bot (para o teste de desafio ao bot)
const JID_BOT = '5211999990000@s.whatsapp.net'
// Forâneo que não joga
const LID_EXTRA = '777888999000111222@lid'
const NUM_EXTRA = '5211999990003@s.whatsapp.net'

const PARTICIPANTES = [
  { id: LID_EMISSOR, phoneNumber: NUM_EMISSOR, admin: 'admin', pushName: 'Emissor' },
  { id: LID_RIVAL, phoneNumber: NUM_RIVAL, pushName: 'Rival' },
  { id: JID_BOT, phoneNumber: JID_BOT, pushName: 'Hipnos' },
  { id: LID_EXTRA, phoneNumber: NUM_EXTRA, pushName: 'Extra' }
]

function criarSock() {
  const enviadas = []
  return {
    enviadas,
    sock: {
      user: { id: JID_BOT },
      sendMessage: async (jid, conteudo) => {
        enviadas.push({ jid, conteudo })
        return { key: { id: `fake-${enviadas.length}` } }
      },
      groupMetadata: async () => ({ participants: PARTICIPANTES })
    }
  }
}

function criarMsg({ grupo = true, participante = LID_EMISSOR, texto = '/velha', mencionado = null } = {}, textoBruto = null) {
  const contextInfo = {}
  if (mencionado) contextInfo.mentionedJid = [mencionado]
  return {
    key: {
      remoteJid: grupo ? JID_GRUPO : JID_PRIVADO,
      fromMe: false,
      id: 'MSG',
      participant: grupo ? participante : undefined
    },
    message: { extendedTextMessage: { text: textoBruto ?? texto, contextInfo } }
  }
}

const ultimoTexto = (enviadas) => {
  const envio = [...enviadas].reverse().find((e) => e.conteudo?.text)
  return envio?.conteudo?.text || null
}

const ultimasMencoes = (enviadas) => {
  const envio = [...enviadas].reverse().find((e) => e.conteudo?.mentions)
  return envio?.conteudo?.mentions || []
}

async function main() {
  let reprovadas = 0
  const testar = async (nome, fn) => {
    try {
      await fn()
      console.log(`✅ ${nome}`)
    } catch (err) {
      reprovadas += 1
      console.log(`❌ ${nome}:`, err?.message || err)
    }
  }

  const limpar = () => { velha.partidas.clear() }

  await testar('exports de /velha e de /jogar', async () => {
    if (velha.nome !== 'velha') throw new Error(`nome velha: ${velha.nome}`)
    if (JSON.stringify(velha.aliases) !== JSON.stringify(['jogovelha', 'tictactoe'])) {
      throw new Error(`aliases velha: ${JSON.stringify(velha.aliases)}`)
    }
    if (typeof velha.executar !== 'function') throw new Error('velha.executar não é função')
    if (typeof (velha.jogar || velha.jugar) !== 'function') throw new Error('jugar não exposta por velha.js')
    if (jogar.nome !== 'jogar') throw new Error(`nome jogar: ${jogar.nome}`)
    if (!Array.isArray(jogar.aliases) || !jogar.aliases.includes('marcar')) {
      throw new Error(`aliases jogar: ${JSON.stringify(jogar.aliases)}`)
    }
    if (jogar.executar !== (velha.jogar || velha.jugar)) throw new Error('jogar.executar não reusa velha.jogar')
  })

  await testar('fora de grupo: /velha e /jogar avisam', async () => {
    limpar()
    const { sock, enviadas } = criarSock()
    await velha.executar(sock, JID_PRIVADO, criarMsg({ grupo: false }), '/velha')
    if (!/grupo/.test(ultimoTexto(enviadas))) throw new Error('velha não avisa sobre grupo')
    await jogar.executar(sock, JID_PRIVADO, criarMsg({ grupo: false, texto: '/jogar 5' }), '/jogar 5')
    if (!/grupo/.test(ultimoTexto(enviadas))) throw new Error('jogar não avisa sobre grupo')
  })

  await testar('/velha sem menção: pede rival', async () => {
    limpar()
    const { sock, enviadas } = criarSock()
    await velha.executar(sock, JID_GRUPO, criarMsg({ texto: '/velha' }), '/velha')
    const texto = ultimoTexto(enviadas)
    if (!texto || !/marque seu rival/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
    if (velha.partidas.size) throw new Error('não deveria haver partida registrada')
  })

  await testar('/velha contra si mesmo: bloqueado', async () => {
    limpar()
    const { sock, enviadas } = criarSock()
    await velha.executar(sock, JID_GRUPO, criarMsg({ texto: '/velha', mencionado: LID_EMISSOR }), '/velha')
    if (!/si mesmo/i.test(ultimoTexto(enviadas))) throw new Error('não bloqueou mesma pessoa')
  })

  await testar('/velha contra o bot: bloqueado', async () => {
    limpar()
    const { sock, enviadas } = criarSock()
    await velha.executar(sock, JID_GRUPO, criarMsg({ texto: '/velha', mencionado: JID_BOT }), '/velha')
    if (!/Hipnos/i.test(ultimoTexto(enviadas))) throw new Error('não bloqueou menção ao bot')
  })

  await testar('partida não autoriza jogar fora da vez nem forâneo', async () => {
    limpar()
    const { sock, enviadas } = criarSock()
    await velha.executar(sock, JID_GRUPO, criarMsg({ texto: '/velha', mencionado: LID_RIVAL }), '/velha')

    // ❌ esperado: O joga antes da vez -> bloqueado
    await jogar.executar(
      sock, JID_GRUPO,
      criarMsg({ participante: LID_RIVAL, texto: '/jogar 4' }), '/jogar 4'
    )
    if (!/sua vez/i.test(ultimoTexto(enviadas))) {
      throw new Error('não bloqueou jogada fora da vez')
    }
    if (velha.partidas.get(JID_GRUPO).tabuleiro[velha.PAD_PARA_INDICE[4]]) {
      throw new Error('posição ocupada por jogada fora da vez')
    }

    // ❌ esperado: forâneo tenta jogar -> bloqueado
    await jogar.executar(
      sock, JID_GRUPO,
      criarMsg({ participante: LID_EXTRA, texto: '/jogar 4' }), '/jogar 4'
    )
    if (!/não é sua/.test(ultimoTexto(enviadas))) {
      throw new Error('não bloqueou forâneo')
    }
  })

  await testar('/velha @rival inicia: tabuleiro, turno ❌ e mentions', async () => {
    limpar()
    const { sock, enviadas } = criarSock()
    await velha.executar(sock, JID_GRUPO, criarMsg({ texto: '/velha', mencionado: LID_RIVAL }), '/velha')
    const texto = ultimoTexto(enviadas)
    if (!texto || !/JOGO DA VELHA/i.test(texto)) throw new Error('título ausente')
    if (!texto || !/7 8 9/.test(texto)) throw new Error(`legenda numérica ausente: ${texto}`)
    if (!texto || !/❌/.test(texto)) throw new Error('tabuleiro inicial sem ❌ do turno')
    if (!texto || !/@5211999990001/.test(texto)) throw new Error('emissor não marcado como ❌')
    // A menção ao rival deve ser o JID resolvido (número real, não LID)
    if (!ultimasMencoes(enviadas).includes(NUM_RIVAL)) {
      throw new Error(`rival esperado em mentions: ${ultimasMencoes(enviadas)}`)
    }
    const partida = velha.partidas.get(JID_GRUPO)
    if (!partida) throw new Error('partida não registrada')
    if (partida.turno !== 'X') throw new Error(`turno inicial: ${partida.turno}`)
  })

  await testar('vitória: X ocupa a linha de cima e a partida é removida', async () => {
    limpar()
    const { sock, enviadas } = criarSock()
    await velha.executar(sock, JID_GRUPO, criarMsg({ texto: '/velha', mencionado: LID_RIVAL }), '/velha')
    // ❌ esperado: posição ocupada bloqueada antes da vitória
    await jogar.executar(sock, JID_GRUPO, criarMsg({ texto: '/jogar 7' }), '/jogar 7')
    await jogar.executar(
      sock, JID_GRUPO,
      criarMsg({ participante: LID_RIVAL, texto: '/jogar 7' }), '/jogar 7'
    )
    if (!/já está marcada/.test(ultimoTexto(enviadas))) {
      throw new Error('não bloqueou posição ocupada')
    }
    await jogar.executar(
      sock, JID_GRUPO,
      criarMsg({ participante: LID_RIVAL, texto: '/jogar 4' }), '/jogar 4'
    )
    if (!/vez de @5211999990001/.test(ultimoTexto(enviadas))) {
      throw new Error('não anunciou a vez de X após jogada de O')
    }
    await jogar.executar(sock, JID_GRUPO, criarMsg({ texto: '/jogar 8' }), '/jogar 8')
    await jogar.executar(
      sock, JID_GRUPO,
      criarMsg({ participante: LID_RIVAL, texto: '/jogar 5' }), '/jogar 5'
    )
    await jogar.executar(sock, JID_GRUPO, criarMsg({ texto: '/jogar 9' }), '/jogar 9')
    const texto = ultimoTexto(enviadas)
    if (!texto || !/Vence @5211999990001 \(❌\)/.test(texto)) {
      throw new Error(`mensagem de vitória inesperada: ${texto}`)
    }
    if (!ultimasMencoes(enviadas).includes(NUM_EMISSOR)) {
      throw new Error('vencedor ausente em mentions')
    }
    if (velha.partidas.get(JID_GRUPO)) throw new Error('partida não foi removida após a vitória')
  })

  await testar('empate: tabuleiro cheio sem vencedor e partida removida', async () => {
    limpar()
    const { sock, enviadas } = criarSock()
    await velha.executar(sock, JID_GRUPO, criarMsg({ texto: '/velha', mencionado: LID_RIVAL }), '/velha')
    // Sequência que preenche o tabuleiro sem vencedores: X=8, O=4, X=7, O=2, X=6, O=9, X=3, O=5, X=1
    const ordem = [
      { p: null, txt: '/jogar 8' },
      { p: LID_RIVAL, txt: '/jogar 4' },
      { p: null, txt: '/jogar 7' },
      { p: LID_RIVAL, txt: '/jogar 2' },
      { p: null, txt: '/jogar 6' },
      { p: LID_RIVAL, txt: '/jogar 9' },
      { p: null, txt: '/jogar 3' },
      { p: LID_RIVAL, txt: '/jogar 5' },
      { p: null, txt: '/jogar 1' }
    ]
    for (const jogada of ordem) {
      await jogar.executar(
        sock, JID_GRUPO,
        criarMsg(jogada.p ? { participante: jogada.p, texto: jogada.txt } : { texto: jogada.txt }, jogada.txt),
        jogada.txt
      )
    }
    const texto = ultimoTexto(enviadas)
    if (!texto || !/Empate/.test(texto)) throw new Error(`mensagem de empate ausente: ${texto}`)
    if (!texto || !/\u{274C}|\u{2B55}/u.test(texto)) throw new Error('tabuleiro final ausente no empate')
    if (velha.partidas.get(JID_GRUPO)) throw new Error('partida não foi removida após o empate')
  })

  await testar('partida em curso: novo /velha mostra o tabuleiro, /velha cancelar anula', async () => {
    limpar()
    const { sock, enviadas } = criarSock()
    await velha.executar(sock, JID_GRUPO, criarMsg({ texto: '/velha', mencionado: LID_RIVAL }), '/velha')
    await velha.executar(sock, JID_GRUPO, criarMsg({ texto: '/velha', mencionado: LID_RIVAL }), '/velha')
    if (!/partida em curso/i.test(ultimoTexto(enviadas))) {
      throw new Error('não avisou partida em curso')
    }
    if (velha.partidas.size !== 1) throw new Error('partida original foi substituída')
    await velha.executar(sock, JID_GRUPO, criarMsg({ texto: '/velha cancelar' }), '/velha cancelar')
    if (!/encerrada/i.test(ultimoTexto(enviadas))) throw new Error('não confirmou cancelamento')
    if (velha.partidas.size !== 0) throw new Error('partida não foi cancelada')
  })

  await testar('/jogar sem partida e com número inválido: avisos', async () => {
    limpar()
    const { sock, enviadas } = criarSock()
    await jogar.executar(sock, JID_GRUPO, criarMsg({ texto: '/jogar 5' }), '/jogar 5')
    if (!/Não há partida/.test(ultimoTexto(enviadas))) throw new Error('não avisou ausência de partida')
    await velha.executar(sock, JID_GRUPO, criarMsg({ texto: '/velha', mencionado: LID_RIVAL }), '/velha')
    await jogar.executar(sock, JID_GRUPO, criarMsg({ texto: '/jogar 12' }), '/jogar 12')
    const texto = ultimoTexto(enviadas)
    if (!texto || !/Número inválido/i.test(texto)) throw new Error(`número inválido não avisado: ${texto}`)
    if (!/7 8 9/.test(texto)) throw new Error('legenda numérica ausente no aviso de número inválido')
  })

  await testar('núcleo do jogo: linhas, colunas, diagonais e tabuleiro de guia', async () => {
    const T = (pad) => pad.map((n) => velha.PAD_PARA_INDICE[n])
    const vitoria = (pad) => {
      const tabuleiro = Array(9).fill(null)
      for (const i of T(pad)) tabuleiro[i] = 'X'
      return velha.verificarEstado(tabuleiro)
    }
    if (vitoria([7, 8, 9]).resultado !== 'vitoria') throw new Error('linha de cima não vence')
    if (vitoria([4, 5, 6]).vencedor !== 'X') throw new Error('linha do meio sem vencedor X')
    if (vitoria([7, 4, 1]).linha.length !== 3) throw new Error('coluna da esquerda não vence')
    if (vitoria([3, 2, 1]).resultado !== 'vitoria') throw new Error('linha de baixo não vence')
    if (vitoria([7, 5, 3]).resultado !== 'vitoria') throw new Error('diagonal não vence')
    if (vitoria([9, 5, 1]).resultado !== 'vitoria') throw new Error('antidiagonal não vence')
    const quase = ['X', 'X', null, 'O', 'O', null, null, null, null]
    if (velha.verificarEstado(quase).resultado !== 'emcurso') {
      throw new Error('jogo incompleto deveria estar em curso')
    }
    if (!/7  8  9/.test((velha.desenharTabuleiro || velha.desenharTablero)(Array(9).fill(null), { guia: true }))) {
      throw new Error('tabuleiro guia sem números do pad')
    }
    if (!/▫️/.test((velha.desenharTabuleiro || velha.desenharTablero)(Array(9).fill(null)))) {
      throw new Error('tabuleiro de jogo sem ▫️')
    }
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()