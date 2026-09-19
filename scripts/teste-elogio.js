// ============================================
// 🧪 teste-elogio.js — Valida o /elogio (100% OFFLINE, sem rede)
// ============================================
// Verifica:
//   - exports: nome, aliases, descrição e a lista de frases (30-40 itens);
//   - formato exato da resposta: "✨ @{digitos}, {frase}.";
//   - o texto e o mentions[] usam o MESMO JID (senão o @ não renderiza);
//   - sem menção → o alvo é QUEM MANDOU (autor da mensagem);
//   - com menção (@número real) → o alvo é o mencionado;
//   - menção por LID → resolve p/ o número REAL via sock.groupMetadata
//     (e, se os metadados falharem, segue com o LID sem quebrar);
//   - menção em legenda de imagem → também é detectada;
//   - sufixo de dispositivo (:12@) é removido da menção;
//   - erro no envio → aviso amigável, nada escapa pro listener;
//   - todas as frases terminam em minúscula/letra e não têm ponto final.
// Uso: node scripts/teste-elogio.js
// ============================================

const elogio = require('../comandos/menu-brincadeiras/elogio')

const JID_GRUPO = '120363000000000000@g.us'
const JID_PRIVADO = '5551111111111@s.whatsapp.net'

const AUTOR = '5551111111111@s.whatsapp.net'
const AUTOR_LID = '111111111111111111@lid'
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
    return {
      key,
      pushName: 'Sonhador',
      message: {
        imageMessage: { caption: '/elogio', contextInfo: { mentionedJid: mencionados } }
      }
    }
  }
  return {
    key,
    pushName: 'Sonhador',
    message: {
      extendedTextMessage: {
        text: '/elogio',
        contextInfo: { mentionedJid: mencionados }
      }
    }
  }
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
  // ───── 1) Exports e lista de frases ─────
  await testar('exports: nome, aliases e descrição', async () => {
    if (elogio.nome !== 'elogio') throw new Error('nome inesperado: ' + elogio.nome)
    for (const a of ['elogiar', 'elogios']) {
      if (!elogio.aliases?.includes(a)) throw new Error(`alias ausente: ${a}`)
    }
    if (!elogio.descricao) throw new Error('sem descrição')
    if (typeof elogio.executar !== 'function') throw new Error('sem executar()')
  })

  await testar('lista de elogios: entre 30 e 40 frases, sem ponto final', async () => {
    const lista = elogio.__frases
    if (!Array.isArray(lista)) throw new Error('__frases não é array')
    if (lista.length < 30 || lista.length > 40) throw new Error(`lista com ${lista.length} frases (esperado 30-40)`)
    const unicas = new Set(lista)
    if (unicas.size !== lista.length) throw new Error('há frases duplicadas')
    for (const frase of lista) {
      if (typeof frase !== 'string' || !frase.trim()) throw new Error('frase vazia na lista')
      if (/[.!?]$/.test(frase.trim())) throw new Error(`frase com pontuação final própria: "${frase}"`)
    }
  })

  // ───── 2) Formato e alvo ─────
  await testar('formato: "✨ @{digitos}, {frase}." com o MESMO JID no mentions[]', async () => {
    const { sock, enviadas } = criarSock()
    await elogio.executar(sock, JID_GRUPO, criarMsg({ autor: AUTOR }), '/elogio')
    const texto = textoUnico(enviadas)
    const match = texto.match(/^✨ @(\d+), (.+)\.$/)
    if (!match) throw new Error('formato fora do padrão: ' + texto)
    const [, digitos, frase] = match
    if (!elogio.__frases.includes(frase)) throw new Error('a frase não veio da lista: ' + frase)
    if (enviadas[0].conteudo.mentions?.[0] !== `${digitos}@s.whatsapp.net`) {
      throw new Error('mentions[] não casa com o @ do texto: ' + JSON.stringify(enviadas[0].conteudo.mentions))
    }
    if (enviadas[0].jid !== JID_GRUPO) throw new Error('respondeu no chat errado')
    if (!enviadas[0].opcoes?.quoted) throw new Error('a resposta não citou (quoted) a mensagem')
  })

  await testar('sem menção → elogia QUEM MANDOU (autor)', async () => {
    const { sock, enviadas } = criarSock()
    await elogio.executar(sock, JID_GRUPO, criarMsg({ autor: AUTOR }), '/elogio')
    const texto = textoUnico(enviadas)
    if (!texto.startsWith(`✨ @${AUTOR.split('@')[0]}, `)) {
      throw new Error('não mirou no autor: ' + texto)
    }
  })

  await testar('com menção → elogia o MENCIONADO (não o autor)', async () => {
    const { sock, enviadas } = criarSock()
    await elogio.executar(sock, JID_GRUPO, criarMsg({ autor: AUTOR, mencionados: [ALVO] }), '/elogio @alvo')
    const texto = textoUnico(enviadas)
    if (!texto.startsWith(`✨ @${ALVO.split('@')[0]}, `)) {
      throw new Error('não mirou no mencionado: ' + texto)
    }
    if (enviadas[0].conteudo.mentions[0] !== ALVO) throw new Error('mentions[] errado')
  })

  await testar('menção em LEGENDA de imagem → também é detectada', async () => {
    const { sock, enviadas } = criarSock()
    await elogio.executar(sock, JID_GRUPO, criarMsg({ autor: AUTOR, mencionados: [ALVO], legenda: true }), '/elogio')
    const texto = textoUnico(enviadas)
    if (!texto.startsWith(`✨ @${ALVO.split('@')[0]}, `)) throw new Error('não pegou a menção da legenda: ' + texto)
  })

  await testar('sufixo de dispositivo :12@ é removido da menção', async () => {
    const { sock, enviadas } = criarSock()
    await elogio.executar(sock, JID_GRUPO, criarMsg({ autor: AUTOR, mencionados: [`${ALVO.split('@')[0]}:12@s.whatsapp.net`] }), '/elogio')
    const texto = textoUnico(enviadas)
    if (!texto.startsWith(`✨ @${ALVO.split('@')[0]}, `)) throw new Error('não normalizou o sufixo: ' + texto)
    if (enviadas[0].conteudo.mentions[0] !== ALVO) throw new Error('mentions[] manteve o :12')
  })

  // ───── 3) LID ─────
  await testar('menção por LID → resolve p/ o número REAL via metadados do grupo', async () => {
    const { sock, enviadas } = criarSock({
      participantes: [
        { id: ALVO_LID, phoneNumber: ALVO, admin: null },
        { id: AUTOR_LID, phoneNumber: AUTOR, admin: 'admin' }
      ]
    })
    await elogio.executar(sock, JID_GRUPO, criarMsg({ autor: AUTOR_LID, mencionados: [ALVO_LID] }), '/elogio')
    const texto = textoUnico(enviadas)
    if (!texto.startsWith(`✨ @${ALVO.split('@')[0]}, `)) {
      throw new Error('não resolveu o LID p/ o número real: ' + texto)
    }
    if (enviadas[0].conteudo.mentions[0] !== ALVO) throw new Error('mentions[] ainda com LID')
  })

  await testar('autor por LID sem menção → resolve p/ o número real', async () => {
    const { sock, enviadas } = criarSock({
      participantes: [{ id: AUTOR_LID, phoneNumber: AUTOR, admin: null }]
    })
    await elogio.executar(sock, JID_GRUPO, criarMsg({ autor: AUTOR_LID }), '/elogio')
    const texto = textoUnico(enviadas)
    if (!texto.startsWith(`✨ @${AUTOR.split('@')[0]}, `)) throw new Error('não resolveu o autor LID: ' + texto)
  })

  await testar('metadados falharam → segue com o LID do autor (sem quebrar)', async () => {
    const { sock, enviadas } = criarSock({ falharMetadados: true })
    await elogio.executar(sock, JID_GRUPO, criarMsg({ autor: AUTOR_LID }), '/elogio')
    const texto = textoUnico(enviadas)
    if (!texto.startsWith(`✨ @${AUTOR_LID.split('@')[0]}, `)) throw new Error('não usou o LID como fallback: ' + texto)
    if (enviadas[0].conteudo.mentions[0] !== AUTOR_LID) throw new Error('mentions[] deveria conter o LID')
  })

  await testar('no privado (sem grupo) → elogia o próprio chat', async () => {
    const { sock, enviadas } = criarSock()
    await elogio.executar(sock, JID_PRIVADO, { key: { remoteJid: JID_PRIVADO, fromMe: false, id: 'P' }, message: { conversation: '/elogio' } }, '/elogio')
    const texto = textoUnico(enviadas)
    if (!texto.startsWith(`✨ @${JID_PRIVADO.split('@')[0]}, `)) throw new Error('errou o alvo no privado: ' + texto)
  })

  // ───── 4) Erros ─────
  await testar('falha no envio → aviso amigável, sem escapar pro listener', async () => {
    const { sock } = criarSock({ falharEnvio: true })
    let lancou = false
    try {
      await elogio.executar(sock, JID_GRUPO, criarMsg(), '/elogio')
    } catch (err) {
      lancou = true
    }
    if (lancou) throw new Error('o erro de envio escapou (deveria ser capturado)')
  })

  await testar('sorteio: 40 rodadas, sempre uma frase da lista (e variado)', async () => {
    const { sock, enviadas } = criarSock()
    for (let i = 0; i < 40; i++) {
      await elogio.executar(sock, JID_GRUPO, criarMsg(), '/elogio')
    }
    const vistas = new Set()
    for (const envio of enviadas) {
      const match = String(envio.conteudo.text).match(/^✨ @\d+, (.+)\.$/)
      if (!match) throw new Error('formato quebrou em alguma rodada: ' + envio.conteudo.text)
      if (!elogio.__frases.includes(match[1])) throw new Error('frase fora da lista: ' + match[1])
      vistas.add(match[1])
    }
    if (vistas.size < 5) throw new Error(`sorteio pouco variado (${vistas.size} frases distintas em 40 rodadas)`)
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
