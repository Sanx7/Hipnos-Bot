// ============================================================
// 🧪 teste-insulto.js — Valida o /insulto (100% OFFLINE, sem rede)
// ============================================================
// Espelho do teste-elogio.js (mesmos contratos verificados):
//   - exports: nome, aliases, descrição e a lista de frases (~133 itens);
//   - lista sem duplicadas e sem pontuação final própria;
//   - formato exato: "😈 @{digitos}, {frase}.";
//   - o texto e o mentions[] usam o MESMO JID (senão o @ não renderiza);
//   - sem menção → o alvo é QUEM MANDOU;
//   - com menção (@número real) → o alvo é o mencionado;
//   - menção por LID → resolve p/ o número REAL via sock.groupMetadata;
//   - menção em legenda de imagem → também é detectada;
//   - erro de envio → aviso amigável, nada escapa pro listener.
// Uso: node scripts/teste-insulto.js
// ============================================================

const insulto = require('../comandos/menu-brincadeiras/insulto')

const JID_GRUPO = '120363000000000000@g.us'
const AUTOR = '5551111111111@s.whatsapp.net'
const ALVO = '5552222222222@s.whatsapp.net'
const ALVO_LID = '222222222222222222@lid'

function criarSock ({ participantes = [], falharEnvio = false, falharMetadados = false } = {}) {
  const enviadas = []
  return {
    enviadas,
    sock: {
      async sendMessage (jid, conteudo, opcoes) {
        if (falharEnvio) throw new Error('connection closed (simulado)')
        enviadas.push({ jid, conteudo, opcoes })
        return { key: { id: 'fake' } }
      },
      async groupMetadata (jid) {
        if (falharMetadados) throw new Error('metadata fora (simulado)')
        return { participants: participantes }
      }
    }
  }
}

function criarMsg ({ autor = AUTOR, mencionados = [], legenda = false } = {}) {
  const key = { remoteJid: JID_GRUPO, fromMe: false, id: 'MSG' }
  if (autor) key.participant = autor
  if (legenda) {
    return { key, pushName: 'Zoeiro', message: { imageMessage: { caption: '/insulto', contextInfo: { mentionedJid: mencionados } } } }
  }
  return { key, pushName: 'Zoeiro', message: { extendedTextMessage: { text: '/insulto', contextInfo: { mentionedJid: mencionados } } } }
}

const textoUnico = (enviadas) => {
  const textos = enviadas.map((e) => e.conteudo?.text).filter((t) => typeof t === 'string')
  if (textos.length !== 1) throw new Error(`esperava 1 mensagem, veio ${textos.length}`)
  return textos[0]
}

let reprovadas = 0
async function testar (nome, fn) {
  try {
    await fn()
    console.log('✅ ' + nome)
  } catch (err) {
    reprovadas += 1
    console.error('❌ ' + nome + ' →', err?.message || err)
  }
}

async function main () {
  console.log('🧪 /insulto — testes offline\n')

  await testar('exports: nome, aliases, descrição e lista', async () => {
    if (insulto.nome !== 'insulto') throw new Error('nome: ' + insulto.nome)
    for (const a of ['insultar', 'zoeira']) {
      if (!insulto.aliases?.includes(a)) throw new Error('alias ausente: ' + a)
    }
    if (!insulto.descricao) throw new Error('sem descrição')
    if (typeof insulto.executar !== 'function') throw new Error('sem executar()')
  })

  await testar('lista: 133 frases no total, únicas e sem ponto final', async () => {
    const lista = insulto.__frases
    if (!Array.isArray(lista)) throw new Error('__frases não é array')
    if (lista.length < 130 || lista.length > 140) throw new Error(`lista com ${lista.length} (esperado ~133)`)
    if (new Set(lista).size !== lista.length) throw new Error('há frases duplicadas')
    for (const frase of lista) {
      if (typeof frase !== 'string' || !frase.trim()) throw new Error('frase vazia')
      if (/[.!?]$/.test(frase.trim())) throw new Error('frase com pontuação final: ' + frase)
    }
  })

  await testar('formato: "😈 @{digitos}, {frase}." com o MESMO JID no mentions[]', async () => {
    const { sock, enviadas } = criarSock()
    await insulto.executar(sock, JID_GRUPO, criarMsg())
    const texto = textoUnico(enviadas)
    const match = texto.match(/^😈 @(\d+), (.+)\.$/)
    if (!match) throw new Error('formato fora do padrão: ' + texto)
    const [, digitos, frase] = match
    if (!insulto.__frases.includes(frase)) throw new Error('frase fora da lista: ' + frase)
    if (enviadas[0].conteudo.mentions?.[0] !== `${digitos}@s.whatsapp.net`) {
      throw new Error('mentions[] não bate com o @ do texto')
    }
  })

  await testar('sem menção: o alvo é QUEM MANDOU', async () => {
    const { sock, enviadas } = criarSock()
    await insulto.executar(sock, JID_GRUPO, criarMsg({ mencionados: [] }))
    if (!textoUnico(enviadas).includes('@5551111111111')) throw new Error('não zoeou o autor')
  })

  await testar('com menção: o alvo é o MENCIONADO', async () => {
    const { sock, enviadas } = criarSock()
    await insulto.executar(sock, JID_GRUPO, criarMsg({ mencionados: [ALVO] }))
    if (!textoUnico(enviadas).includes('@5552222222222')) throw new Error('não zoeu o mencionado')
  })

  await testar('menção por LID: resolve para o número REAL', async () => {
    const participantes = [{ id: ALVO_LID, phoneNumber: ALVO }]
    const { sock, enviadas } = criarSock({ participantes })
    await insulto.executar(sock, JID_GRUPO, criarMsg({ mencionados: [ALVO_LID] }))
    if (!textoUnico(enviadas).includes('@5552222222222')) throw new Error('LID não virou número real')
    if (enviadas[0].conteudo.mentions?.[0] !== ALVO) throw new Error('mentions[] não recebeu o número real')
  })

  await testar('metadados fora: segue com o LID e não quebra', async () => {
    const { sock, enviadas } = criarSock({ falharMetadados: true })
    await insulto.executar(sock, JID_GRUPO, criarMsg({ mencionados: [ALVO_LID] }))
    if (!textoUnico(enviadas).includes('@')) throw new Error('sem menção no texto')
  })

  await testar('menção em legenda de imagem também é detectada', async () => {
    const { sock, enviadas } = criarSock()
    await insulto.executar(sock, JID_GRUPO, criarMsg({ mencionados: [ALVO], legenda: true }))
    if (!textoUnico(enviadas).includes('@5552222222222')) throw new Error('legenda não foi lida')
  })

  await testar('sufixo de dispositivo (:12) é removido', async () => {
    const { sock, enviadas } = criarSock()
    await insulto.executar(sock, JID_GRUPO, criarMsg({ mencionados: ['5552222222222:12@s.whatsapp.net'] }))
    if (!textoUnico(enviadas).includes('@5552222222222,')) throw new Error('sufixo :12 não foi removido')
  })

  await testar('erro no envio: aviso amigável, nada escapa', async () => {
    const { sock } = criarSock({ falharEnvio: true })
    await insulto.executar(sock, JID_GRUPO, criarMsg())
    // se lançar aqui, o teste falha sozinho
  })

  await testar('sorteio: sempre sai frase da lista (e é variado)', async () => {
    const vistas = new Set()
    for (let i = 0; i < 40; i++) {
      const { sock, enviadas } = criarSock()
      await insulto.executar(sock, JID_GRUPO, criarMsg())
      const m = textoUnico(enviadas).match(/^😈 @\d+, (.+)\.$/)
      if (!m) throw new Error('formato quebrado')
      if (!insulto.__frases.includes(m[1])) throw new Error('frase fora da lista: ' + m[1])
      vistas.add(m[1])
    }
    if (vistas.size < 5) throw new Error(`sorteio pouco variado (${vistas.size} em 40 rodadas)`)
  })

  console.log(`\n${reprovadas === 0 ? '🎉 Todos os testes passaram.' : '💥 ' + reprovadas + ' teste(s) falharam.'}\n`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('💥 erro fatal:', err)
  process.exit(1)
})