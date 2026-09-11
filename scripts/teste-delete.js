// ============================================
// 🧪 teste-delete.js — Valida o comando /delete (/d) com sock mockado
// ============================================
// NÃO conecta ao WhatsApp: o sock é substituído por um mock que registra
// as chamadas de sendMessage/groupMetadata. Verifica:
//   - bloqueios: fora de grupo, não-admin, bot sem admin, sem citação
//     e citação apontando para outro chat;
//   - fluxo feliz: 2 revogações com as chaves corretas e silêncio total;
//   - citação de mensagem do PRÓPRIO bot → chave com fromMe: true;
//   - falha de revogação → aviso amigável no chat.
// Uso: node scripts/teste-delete.js
// ============================================

const comandoDelete = require('../comandos/admin/delete')
const comandoAlias = require('../comandos/admin/d')

const JID_GRUPO = '120363000000000000@g.us'
const JID_PRIVADO = '5555000000001@s.whatsapp.net'
const JID_ADMIN = '5555000000002@s.whatsapp.net'
const JID_MEMBRO = '5555000000003@s.whatsapp.net'
const JID_AUTOR_CITADO = '5555000000004@s.whatsapp.net'
const JID_BOT = '5555000000009@s.whatsapp.net'

// ─── Mock do sock ───
function criarSock(opcoes = {}) {
  const enviadas = []
  return {
    enviadas,
    sock: {
      user: { id: `${JID_BOT.split('@')[0]}:5@s.whatsapp.net` },
      groupMetadata: async () => ({ participants: opcoes.participantes }),
      sendMessage: async (jid, conteudo, extra) => {
        if (opcoes.rejeitarDelete && conteudo?.delete) {
          throw new Error('(forbidden) sem permissão para revogar')
        }
        enviadas.push({ jid, conteudo, extra })
        return { key: { id: `fake-${enviadas.length}` } }
      }
    }
  }
}

// Participantes padrão: admin + membro comum + o BOT como admin do grupo
const participantesPadrao = () => [
  { id: JID_ADMIN, admin: 'admin' },
  { id: JID_MEMBRO, admin: null },
  { id: '13145550009@lid', admin: 'admin', phoneNumber: JID_BOT }
]

// ─── Mock de mensagem ───
function criarMsg({ grupo = true, autorAdmin = true, comCitada = true, autorCitado = JID_AUTOR_CITADO, remotoCitado = null } = {}) {
  const remetente = grupo ? (autorAdmin ? JID_ADMIN : JID_MEMBRO) : JID_PRIVADO
  const jid = grupo ? JID_GRUPO : JID_PRIVADO
  const contextInfo = comCitada
    ? {
        quotedMessage: { conversation: 'mensagem indesejada' },
        stanzaId: 'CITADA123',
        participant: autorCitado,
        remoteJid: remotoCitado || jid
      }
    : {}
  return {
    key: { remoteJid: jid, fromMe: false, id: 'COMANDO456', participant: grupo ? remetente : undefined },
    message: { extendedTextMessage: { text: '/delete', contextInfo } }
  }
}

// ─── Suíte ───
async function main() {
  let reprovadas = 0

  const testar = async (nome, fn) => {
    try {
      await fn()
      console.log(`✅ ${nome}`)
    } catch (err) {
      reprovadas += 1
      console.log(`❌ ${nome}:`, err?.message || err?.stack || err)
    }
  }

  const contarDeletes = (enviadas) => enviadas.filter((e) => e.conteudo?.delete).length
  const contarTextos = (enviadas) => enviadas.filter((e) => e.conteudo?.text).length
  const textoUnico = (enviadas) => {
    const textos = enviadas.filter((e) => e.conteudo?.text)
    return textos.length === 1 ? textos[0].conteudo.text : null
  }

  // ─── Alias /d reexporta o mesmo comando ───
  await testar('alias /d reexporta nome, descricao e executar do /delete', async () => {
    if (comandoAlias.nome !== 'd') throw new Error(`nome do alias: ${comandoAlias.nome}`)
    if (comandoAlias.executar !== comandoDelete.executar) throw new Error('executar do alias difere do delete')
    if (comandoAlias.descricao !== comandoDelete.descricao) throw new Error('descricao do alias difere do delete')
  })

  // 1) Fora de grupo → aviso e NENHUMA revogação
  await testar('bloqueia uso fora de grupos', async () => {
    const { sock, enviadas } = criarSock({ participantes: participantesPadrao() })
    await comandoDelete.executar(sock, JID_PRIVADO, criarMsg({ grupo: false }))
    if (contarDeletes(enviadas) !== 0) throw new Error('tentou revogar fora de grupo')
    const texto = textoUnico(enviadas)
    if (!texto || !/grupos/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  // 2) Não-admin → aviso e NENHUMA revogação
  await testar('bloqueia uso por não-admin', async () => {
    const { sock, enviadas } = criarSock({ participantes: participantesPadrao() })
    await comandoDelete.executar(sock, JID_GRUPO, criarMsg({ autorAdmin: false }))
    if (contarDeletes(enviadas) !== 0) throw new Error('não-admin apagou mensagem')
    const texto = textoUnico(enviadas)
    if (!texto || !/administradores/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  // 4) Sem mensagem citada → instruções de uso
  await testar('pede para responder à mensagem quando não há citação', async () => {
    const { sock, enviadas } = criarSock({ participantes: participantesPadrao() })
    await comandoDelete.executar(sock, JID_GRUPO, criarMsg({ comCitada: false }))
    if (contarDeletes(enviadas) !== 0) throw new Error('revogou sem mensagem citada')
    const texto = textoUnico(enviadas)
    if (!texto || !/responda/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  // 3) Bot sem admin no grupo → aviso específico e NENHUMA revogação
  await testar('exige que o bot seja administrador do grupo', async () => {
    const semBotAdmin = [
      { id: JID_ADMIN, admin: 'admin' },
      { id: JID_MEMBRO, admin: null },
      { id: '13145550009@lid', admin: null, phoneNumber: JID_BOT }
    ]
    const { sock, enviadas } = criarSock({ participantes: semBotAdmin })
    await comandoDelete.executar(sock, JID_GRUPO, criarMsg())
    if (contarDeletes(enviadas) !== 0) throw new Error('revogou mesmo sem o bot ser admin')
    const texto = textoUnico(enviadas)
    if (!texto || !/Hipnos precisa ser administrador/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  // 5) Citação de OUTRO chat (ex.: status) → recusa
  await testar('recusa citação apontando para outro chat', async () => {
    const { sock, enviadas } = criarSock({ participantes: participantesPadrao() })
    await comandoDelete.executar(sock, JID_GRUPO, criarMsg({ remotoCitado: 'status@broadcast' }))
    if (contarDeletes(enviadas) !== 0) throw new Error('revogou citação de outro chat')
    const texto = textoUnico(enviadas)
    if (!texto || !/não pertence/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  // 6) Fluxo feliz → 2 revogações com as chaves corretas e silêncio total
  await testar('apaga a mensagem citada E o comando, em silêncio', async () => {
    const { sock, enviadas } = criarSock({ participantes: participantesPadrao() })
    await comandoDelete.executar(sock, JID_GRUPO, criarMsg())
    if (enviadas.length !== 2) throw new Error(`esperava 2 revogações, houve ${enviadas.length}`)
    if (contarTextos(enviadas) !== 0) throw new Error('enviou texto no fluxo de sucesso (deveria ficar em silêncio)')

    const [deletadaCitada, deletadoComando] = enviadas.map((e) => e.conteudo.delete)

    // Chave da mensagem citada: de terceiros → fromMe false + participant
    if (deletadaCitada.id !== 'CITADA123') throw new Error(`id da citada: ${deletadaCitada.id}`)
    if (deletadaCitada.fromMe !== false) throw new Error('fromMe da citada deveria ser false')
    if (deletadaCitada.participant !== JID_AUTOR_CITADO) throw new Error(`participant da citada: ${deletadaCitada.participant}`)
    if (deletadaCitada.remoteJid !== JID_GRUPO) throw new Error(`remoteJid da citada: ${deletadaCitada.remoteJid}`)

    // Chave da própria mensagem do comando
    if (deletadoComando.id !== 'COMANDO456') throw new Error(`id do comando: ${deletadoComando.id}`)
    if (deletadoComando.fromMe !== false) throw new Error('fromMe do comando deveria ser false')
    if (deletadoComando.participant !== JID_ADMIN) throw new Error(`participant do comando: ${deletadoComando.participant}`)
    if (deletadoComando.remoteJid !== JID_GRUPO) throw new Error(`remoteJid do comando: ${deletadoComando.remoteJid}`)
  })

  // 7) Mensagem citada é do PRÓPRIO bot → chave com fromMe: true (sem participant)
  await testar('apaga mensagem do próprio bot com fromMe: true', async () => {
    const { sock, enviadas } = criarSock({ participantes: participantesPadrao() })
    await comandoDelete.executar(sock, JID_GRUPO, criarMsg({ autorCitado: JID_BOT }))
    const [deletadaCitada] = enviadas.map((e) => e.conteudo.delete)
    if (deletadaCitada.fromMe !== true) throw new Error('fromMe deveria ser true para mensagem do bot')
    if ('participant' in deletadaCitada) throw new Error('participant não deveria existir na chave do bot')
    if (deletadaCitada.id !== 'CITADA123') throw new Error(`id da citada: ${deletadaCitada.id}`)
  })

  // 8) Falha na revogação → aviso amigável (sem estourar erro)
  await testar('avisa amigavelmente quando a revogação falha', async () => {
    const { sock, enviadas } = criarSock({ participantes: participantesPadrao(), rejeitarDelete: true })
    await comandoDelete.executar(sock, JID_GRUPO, criarMsg())
    if (enviadas.length !== 1) throw new Error(`esperava 1 aviso, houve ${enviadas.length}`)
    const texto = textoUnico(enviadas)
    if (!texto || !/não consegui/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()