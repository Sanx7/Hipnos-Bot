// ============================================================
// 🧪 teste-revelaraudio.js — Testes OFFLINE do /revelaraudio
// Download injetado (_injetarDownload) e checagem de VIP injetada
// (_injetarChecarVip) — sem WhatsApp e sem Mongo de verdade.
// Uso: node scripts/teste-revelaraudio.js
// ============================================================

const cmd = require('../comandos/admin/revelaraudio')
const T = cmd._test
const { getDonos } = require('../config')

const JID = '120363000000000000@g.us'
const AUDIO_FAKE = Buffer.from('OggS fake audio bytes')

// 👥 Cenário de grupo (metadados injetados): admin real, admin que chega
// como "@lid" (PROOF-LID), VIP e um mortal comum.
const DONO = getDonos()[0]
const JID_ADMIN = '5555000000001@s.whatsapp.net'
const JID_COMUM = '5555000000002@s.whatsapp.net'
const JID_VIP = '5555000000003@s.whatsapp.net'
const LID_ADMIN = '999888777@lid'
const PARTICIPANTES = [
  { id: JID_ADMIN, admin: 'admin' },
  { id: JID_COMUM },
  { id: JID_VIP },
  { id: LID_ADMIN, admin: 'superadmin', phoneNumber: '5555000000009@s.whatsapp.net' }
]
// 💠 Stub de VIP (nada de Mongo nos testes): só o JID_VIP é VIP.
const vipPadrao = async (alvo) => String(alvo || '').includes('5555000000003')

function audioViewOnce (ptt, mimetype) {
  return {
    viewOnceMessageV2: {
      message: {
        audioMessage: {
          url: 'https://fake/audio.ogg', mediaKey: 'fake', mimetype: mimetype || 'audio/ogg; codecs=opus',
          fileLength: '1234', seconds: 5, ptt: !!ptt, viewOnce: true
        }
      }
    }
  }
}
function fotoViewOnce () {
  return { viewOnceMessage: { message: { imageMessage: { url: 'https://fake/foto.jpg', viewOnce: true } } } }
}
function criarMsgComReply (quoted, participante) {
  return {
    key: { remoteJid: JID, fromMe: false, id: 'MSG1', participant: participante || JID_ADMIN },
    message: { extendedTextMessage: { text: '/revelaraudio', contextInfo: { quotedMessage: quoted } } }
  }
}
function criarSock () {
  const enviadas = []
  return {
    enviadas,
    sock: {
      groupMetadata: async () => ({ participants: PARTICIPANTES }),
      sendMessage: async (jid, conteudo, extra) => { enviadas.push({ jid, conteudo, extra }); return { key: { id: 'fake-' + enviadas.length } } }
    }
  }
}
const textosDe = (s) => s.enviadas.filter((e) => typeof e.conteudo?.text === 'string').map((e) => e.conteudo.text)
const audioDe = (s) => s.enviadas.find((e) => Buffer.isBuffer(e.conteudo?.audio))

async function main () {
  let reprovadas = 0
  const testar = async (nome, fn) => {
    T._injetarDownload(null)
    T._injetarChecarVip(vipPadrao)
    try { await fn(); console.log(`✅ ${nome}`) } catch (err) { reprovadas += 1; console.log(`❌ ${nome}:`, err?.message || err) }
  }

  await testar('exports: nome/aliases/executar', async () => {
    if (cmd.nome !== 'revelaraudio') throw new Error('nome errado')
    if (typeof cmd.executar !== 'function') throw new Error('sem executar')
    if (!cmd.aliases.includes('revelarpv') || !cmd.aliases.includes('audiorevelado')) throw new Error('aliases incompletos')
    if (!cmd.descricao) throw new Error('sem descricao')
  })

  await testar('reply a áudio view-once ptt:true → reenvia com ptt:true', async () => {
    T._injetarDownload(async () => AUDIO_FAKE)
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsgComReply(audioViewOnce(true)), '/revelaraudio')
    const a = audioDe({ enviadas })
    if (!a) throw new Error('áudio não reenviado; textos: ' + textosDe({ enviadas }).join(' | '))
    if (a.conteudo.ptt !== true) throw new Error('ptt deveria ser true, veio ' + a.conteudo.ptt)
    if (!/ogg/.test(a.conteudo.mimetype)) throw new Error('mimetype errado: ' + a.conteudo.mimetype)
    if (!Buffer.isBuffer(a.conteudo.audio) || a.conteudo.audio.length === 0) throw new Error('buffer vazio')
  })

  await testar('reply a áudio view-once ptt:false → reenvia com ptt:false', async () => {
    T._injetarDownload(async () => AUDIO_FAKE)
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsgComReply(audioViewOnce(false, 'audio/mp4')), '/revelaraudio')
    const a = audioDe({ enviadas })
    if (!a) throw new Error('áudio não reenviado')
    if (a.conteudo.ptt !== false) throw new Error('ptt deveria ser false, veio ' + a.conteudo.ptt)
    if (a.conteudo.mimetype !== 'audio/mp4') throw new Error('mimetype não preservado: ' + a.conteudo.mimetype)
  })

  await testar('sem reply → aviso de uso', async () => {
    const { sock, enviadas } = criarSock()
    const semReply = {
      key: { remoteJid: JID, fromMe: false, id: 'M', participant: JID_ADMIN },
      message: { conversation: '/revelaraudio' }
    }
    await cmd.executar(sock, JID, semReply, '/revelaraudio')
    const t = textosDe({ enviadas }).join('\n')
    if (!/visualização única/i.test(t)) throw new Error('aviso inesperado: ' + t)
    if (audioDe({ enviadas })) throw new Error('reenviou áudio sem reply')
  })

  await testar('reply a texto comum → aviso de não-áudio', async () => {
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsgComReply({ conversation: 'oi gente' }), '/revelaraudio')
    const t = textosDe({ enviadas }).join('\n')
    if (!/nenhum áudio/i.test(t)) throw new Error('aviso inesperado: ' + t)
    if (audioDe({ enviadas })) throw new Error('reenviou áudio de texto comum')
  })

  await testar('reply a foto view-once → recusa (escopo do /revelar)', async () => {
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsgComReply(fotoViewOnce()), '/revelaraudio')
    const t = textosDe({ enviadas }).join('\n')
    if (!/revelar/.test(t)) throw new Error('deveria apontar para o /revelar: ' + t)
    if (audioDe({ enviadas })) throw new Error('reenviou foto como áudio')
  })

  await testar('falha de download genérica → aviso sem quebrar', async () => {
    T._injetarDownload(async () => { throw new Error('rede fora') })
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsgComReply(audioViewOnce(true)), '/revelaraudio')
    const t = textosDe({ enviadas }).join('\n')
    if (!/feitiço falhou/i.test(t)) throw new Error('aviso inesperado: ' + t)
    if (audioDe({ enviadas })) throw new Error('reenviou áudio após falha')
  })

  await testar('chave expirada (404) → aviso de expirado', async () => {
    T._injetarDownload(async () => { const e = new Error('media gone'); e.response = { status: 410 }; throw e })
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsgComReply(audioViewOnce(true)), '/revelaraudio')
    const t = textosDe({ enviadas }).join('\n')
    if (!/expirou/i.test(t)) throw new Error('aviso inesperado: ' + t)
  })

  // ── 🔐 Permissão: VIP, admin do grupo ou dono do bot ──
  await testar('permissão: VIP pode revelar', async () => {
    T._injetarDownload(async () => AUDIO_FAKE)
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsgComReply(audioViewOnce(true), JID_VIP), '/revelaraudio')
    if (!audioDe({ enviadas })) throw new Error('VIP deveria revelar; textos: ' + textosDe({ enviadas }).join(' | '))
  })

  await testar('permissão: ADMIN do grupo pode revelar', async () => {
    T._injetarDownload(async () => AUDIO_FAKE)
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsgComReply(audioViewOnce(true), JID_ADMIN), '/revelaraudio')
    if (!audioDe({ enviadas })) throw new Error('admin deveria revelar; textos: ' + textosDe({ enviadas }).join(' | '))
  })

  await testar('permissão: ADMIN que chega como @lid pode revelar (PROOF-LID)', async () => {
    T._injetarDownload(async () => AUDIO_FAKE)
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsgComReply(audioViewOnce(true), LID_ADMIN), '/revelaraudio')
    if (!audioDe({ enviadas })) throw new Error('admin @lid deveria revelar; textos: ' + textosDe({ enviadas }).join(' | '))
  })

  await testar('permissão: DONO do bot pode revelar', async () => {
    T._injetarDownload(async () => AUDIO_FAKE)
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsgComReply(audioViewOnce(true), `${DONO}@s.whatsapp.net`), '/revelaraudio')
    if (!audioDe({ enviadas })) throw new Error('dono deveria revelar; textos: ' + textosDe({ enviadas }).join(' | '))
  })

  await testar('permissão: usuário comum é recusado SEM baixar mídia', async () => {
    let baixou = false
    T._injetarDownload(async () => { baixou = true; return AUDIO_FAKE })
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsgComReply(audioViewOnce(true), JID_COMUM), '/revelaraudio')
    const t = textosDe({ enviadas }).join('\n')
    if (baixou) throw new Error('não deveria nem tentar baixar a mídia do recusado')
    if (audioDe({ enviadas })) throw new Error('reenviou áudio sem permissão')
    if (!/exclusivo/i.test(t) || !/VIP/i.test(t)) throw new Error('aviso de recusa inesperado: ' + t)
    if (!/menu-vip/.test(t)) throw new Error('aviso deveria apontar o /menu-vip: ' + t)
  })

  await testar('permissão: falha ao consultar VIP → recusa segura (sem download)', async () => {
    let baixou = false
    T._injetarDownload(async () => { baixou = true; return AUDIO_FAKE })
    T._injetarChecarVip(async () => { throw new Error('mongo fora') })
    const { sock, enviadas } = criarSock()
    await cmd.executar(sock, JID, criarMsgComReply(audioViewOnce(true), JID_COMUM), '/revelaraudio')
    if (baixou) throw new Error('não deveria baixar mídia com a checagem de VIP quebrada')
    if (audioDe({ enviadas })) throw new Error('liberou acesso com a checagem quebrada')
    if (!/exclusivo/i.test(textosDe({ enviadas }).join('\n'))) throw new Error('deveria recusar: ' + textosDe({ enviadas }).join(' | '))
  })

  await testar('permissão: sem MONGODB_URI a checagem real de VIP não trava (guarda)', async () => {
    const urlOriginal = process.env.MONGODB_URI
    delete process.env.MONGODB_URI
    try {
      T._injetarChecarVip(null) // volta para a checagem REAL (guarda de infra)
      const { sock, enviadas } = criarSock()
      const inicio = Date.now()
      await cmd.executar(sock, JID, criarMsgComReply(audioViewOnce(true), JID_COMUM), '/revelaraudio')
      if (Date.now() - inicio > 2000) throw new Error('demorou demais — a guarda de infra não atuou')
      if (audioDe({ enviadas })) throw new Error('não deveria liberar sem VIP')
      if (!/exclusivo/i.test(textosDe({ enviadas }).join('\n'))) throw new Error('deveria recusar')
    } finally {
      if (urlOriginal !== undefined) process.env.MONGODB_URI = urlOriginal
    }
  })

  await testar('permissão: metadados do grupo falham mas dono do bot segue liberado', async () => {
    T._injetarDownload(async () => AUDIO_FAKE)
    const enviadas = []
    const sock = {
      groupMetadata: async () => { throw new Error('sem conexão') },
      sendMessage: async (jid, conteudo, extra) => { enviadas.push({ jid, conteudo, extra }); return { key: { id: 'x' } } }
    }
    await cmd.executar(sock, JID, criarMsgComReply(audioViewOnce(true), `${DONO}@s.whatsapp.net`), '/revelaraudio')
    if (!audioDe({ enviadas })) throw new Error('dono deveria seguir liberado (fallback OWNER_NUMBERS)')
  })

  await testar('sock quebrado nunca lança', async () => {
    T._injetarDownload(async () => AUDIO_FAKE)
    let escapou = false
    try { await cmd.executar({ sendMessage: async () => { throw new Error('rede fora') } }, JID, criarMsgComReply(audioViewOnce(true)), '/revelaraudio') } catch (e) { escapou = true }
    if (escapou) throw new Error('o erro escapou do executar')
  })

  T._injetarDownload(null)
  T._injetarChecarVip(null)
  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
