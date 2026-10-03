// ============================================
// PARTE 1/2 — extrair revoke + reenviar
// ============================================
// Detecta o "apagar para todos" (protocolMessage REVOKE), busca a mensagem
// original no cache-mensagens.js e reenvia no mesmo grupo. Sem cache =
// silencioso (bot reiniciou, expirou). So grupos. Nunca lanca.
const cacheMensagens = require('./cache-mensagens')
const historicoApagadas = require('./historico-apagadas')

function extrairIdRevogado(msg) {
  try {
    const conteudo = msg?.message || {}
    let proto = conteudo.protocolMessage || null
    if (!proto) {
      try {
        const { normalizeMessageContent } = require('@whiskeysockets/baileys')
        const aberto = normalizeMessageContent(conteudo) || {}
        proto = aberto.protocolMessage || null
      } catch (e) {}
    }
    if (!proto) return null
    const tipo = Number(proto.type)
    // Baileys: ProtocolMessageType.REVOKE = 0 (algumas versoes usam string)
    const ehRevoke = tipo === 0 || proto.type === 'REVOKE'
    if (!ehRevoke) return null
    const id = proto.key?.id || proto.keyId || null
    return id ? String(id) : null
  } catch (e) {
    return null
  }
}

function nomeExibicao(entrada) {
  if (entrada.autorNome) return entrada.autorNome
  const digitos = String(entrada.autorJid || '').split('@')[0].replace(/\D/g, '')
  return digitos ? `+${digitos}` : 'alguém'
}

// ─── tratarRevogacao(sock, msg, jid): reenvia se houver cache ───
// Devolve 'reenviado' | 'sem-cache' | 'ignorado'. NUNCA lanca.
async function tratarRevogacao(sock, msg, jid) {
  try {
    if (!String(jid || '').endsWith('@g.us')) return 'ignorado'
    const idRevogado = extrairIdRevogado(msg)
    if (!idRevogado) return 'ignorado'
    const entrada = cacheMensagens.buscar(idRevogado)
    if (!entrada) return 'sem-cache'
    cacheMensagens.remover(idRevogado)

    const mencao = entrada.autorJid || ''
    const autor = nomeExibicao(entrada)
    const cabecalho = `🗑️ *Mensagem apagada por @${mencao.split('@')[0] || autor}*`
    const mentions = mencao ? [mencao] : []

    // Registra no historico do dia (SEM buffer — so metadado + texto/legenda)
    try {
      await historicoApagadas.registrarApagada({
        grupo: String(jid),
        autor: mencao,
        autorNome: autor,
        tipo: entrada.tipo,
        texto: entrada.texto || ''
      })
    } catch (e) {}

    // Texto: reenvia citado na notificacao
    if (entrada.tipo === 'texto') {
      await sock.sendMessage(String(jid), {
        text: `${cabecalho}\n\n💬 ${entrada.texto}`,
        mentions
      }).catch(() => {})
      return 'reenviado'
    }

    // Midia grande demais: metadado + aviso (buffer nunca coube na memoria)
    if (entrada.grandeDemais || (!entrada.buffer && entrada.tipo !== 'figurinha')) {
      const rotulo = entrada.tipo === 'imagem' ? 'uma imagem'
        : entrada.tipo === 'video' ? 'um vídeo'
        : entrada.tipo === 'audio' ? 'um áudio' : 'uma mídia'
      await sock.sendMessage(String(jid), {
        text: `${cabecalho}\n\n📎 ${autor} apagou ${rotulo}, mas ela era grande demais pra recuperar (~5MB+).`,
        mentions
      }).catch(() => {})
      return 'reenviado'
    }

    // Midia com buffer: reenvia com a legenda original
    const legenda = `${cabecalho}${entrada.texto ? `\n\n📝 ${entrada.texto}` : ''}`
    if (entrada.tipo === 'imagem' && entrada.buffer) {
      await sock.sendMessage(String(jid), {
        image: entrada.buffer, caption: legenda, mentions
      }).catch(() => {})
      return 'reenviado'
    }
    if (entrada.tipo === 'video' && entrada.buffer) {
      await sock.sendMessage(String(jid), {
        video: entrada.buffer, caption: legenda, mentions
      }).catch(() => {})
      return 'reenviado'
    }
    if (entrada.tipo === 'audio' && entrada.buffer) {
      await sock.sendMessage(String(jid), {
        audio: entrada.buffer, mimetype: entrada.mime || 'audio/ogg; codecs=opus', ptt: true, mentions
      }).catch(() => {})
      await sock.sendMessage(String(jid), {
        text: `${cabecalho}${entrada.texto ? `\n\n📝 ${entrada.texto}` : ''}`,
        mentions
      }).catch(() => {})
      return 'reenviado'
    }
    if (entrada.tipo === 'documento' && entrada.buffer) {
      await sock.sendMessage(String(jid), {
        document: entrada.buffer,
        mimetype: entrada.mime || 'application/octet-stream',
        fileName: 'arquivo',
        caption: legenda, mentions
      }).catch(() => {})
      return 'reenviado'
    }

    // Figurinha/outros: sem buffer util — avisa o tipo
    await sock.sendMessage(String(jid), {
      text: `${cabecalho}\n\n📎 ${autor} apagou ${entrada.tipo === 'figurinha' ? 'uma figurinha' : 'uma mídia'}.`,
      mentions
    }).catch(() => {})
    return 'reenviado'
  } catch (e) {
    console.error('[apagadas] reenvio falhou (silencioso):', e?.message || e)
    return 'ignorado'
  }
}

module.exports = { extrairIdRevogado, tratarRevogacao, nomeExibicao }

