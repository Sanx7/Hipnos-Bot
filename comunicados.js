// Estado efêmero de um único comunicado por processo. Não usa listas do MongoDB.
const { downloadMediaMessage, normalizeMessageContent } = require('@whiskeysockets/baileys')
const { obterNumeroDono } = require('./estado-bot')
const { removerPrefixo } = require('./prefixo')

const PRAZO_MS = 60000
const INTERVALO_MS = 5000
const LIMITE_BYTES = 8 * 1024 * 1024
const LIMITE_TEXTO = 3500
const formatar = texto => `🌙 *HIPNOS — COMUNICADO DO OLIMPO*\n\n🌑 _Uma mensagem ecoa pelos reinos dos sonhos..._\n\n${texto}\n\n💤 _— Hipnos, o Senhor dos Sonhos_`
class Aviso extends Error {}

function restricao(erro) {
  const codigo = Number(erro?.output?.statusCode || erro?.statusCode || erro?.status || erro?.response?.status || erro?.data?.code)
  const motivo = String(erro?.message || '')
  return [401, 403, 405, 406, 429, 440, 515].includes(codigo) ||
    /rate.?limit|rate.?overlimit|too many requests|spam|banned|blocked|forbidden|restricted|restriction|logged.?out|connection (?:closed|lost)|limita[çc][ãa]o|bloqueio/i.test(motivo)
}

async function obterGrupos(sock) {
  let dados
  try { dados = await sock.groupFetchAllParticipating() } catch (_) {
    throw new Aviso('❌ Não consegui obter os grupos atuais. Nenhum comunicado foi iniciado.')
  }
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    throw new Aviso('❌ A lista de grupos está indisponível. Tente novamente.')
  }
  return [...new Set(Object.values(dados).map(g => g?.id)
    .filter(id => typeof id === 'string' && /^\d+(?:-\d+)?@g\.us$/.test(id)))]
}

async function baixarImagem(jid, contexto, imagem) {
  if (Number(imagem.fileLength) > LIMITE_BYTES) throw new Aviso('📷 Use uma imagem de até 8 MB.')
  let stream
  let encerrado = false
  let timer
  try {
    const download = (async () => {
      stream = await downloadMediaMessage({
        key: { remoteJid: contexto.remoteJid || jid, id: contexto.stanzaId, participant: contexto.participant, fromMe: false },
        message: { imageMessage: imagem }
      }, 'stream', {})
      // A versão instalada não repassa AbortSignal ao fetch. Fecha também streams tardios.
      if (encerrado) { stream.destroy(); throw new Aviso('📷 O download da imagem expirou.') }
      const partes = []
      let tamanho = 0
      for await (const parte of stream) {
        const bytes = Buffer.from(parte)
        tamanho += bytes.length
        if (tamanho > LIMITE_BYTES) throw new Aviso('📷 Use uma imagem de até 8 MB.')
        partes.push(bytes)
      }
      if (!tamanho) throw new Aviso('📷 A imagem citada está vazia ou indisponível.')
      return Buffer.concat(partes)
    })()
    return await Promise.race([download, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Aviso('📷 O download da imagem expirou. Tente novamente.')), 30000)
    })])
  } catch (erro) {
    if (erro instanceof Aviso) throw erro
    throw new Aviso('📷 Não consegui baixar a imagem citada. Envie a imagem novamente e responda a ela.')
  } finally {
    encerrado = true
    clearTimeout(timer)
    stream?.destroy()
  }
}

function criarSistema({ agora = Date.now, agendar = setTimeout, desagendar = clearTimeout } = {}) {
  let operacao = null
  let conclusao = Promise.resolve()

  function liberar(op) {
    desagendar(op.timer)
    op.acordar?.()
    op.imagem = null
    if (operacao === op) operacao = null
  }

  async function responder(sock, jid, msg, text) {
    try { await sock.sendMessage(jid, { text }, { quoted: msg }) } catch (_) {
      console.error('[comunicado] Não foi possível enviar a resposta ao dono.')
    }
  }

  async function enviar(sock, op) {
    let enviados = 0
    let falhas = 0
    let motivo = 'Concluído.'
    try {
      // Só alcança destinos da prévia que continuam participando. Não inclui novos grupos.
      const atuais = new Set(await obterGrupos(sock))
      const destinos = op.grupos.filter(id => atuais.has(id))
      for (let i = 0; i < destinos.length; i++) {
        if (op.parar) break
        try {
          const conteudo = op.imagem
            ? { image: op.imagem, mimetype: op.mime, caption: op.texto }
            : { text: op.texto }
          await sock.sendMessage(destinos[i], conteudo)
          enviados++
        } catch (erro) {
          falhas++
          if (restricao(erro)) {
            motivo = 'Interrompido por indicação de restrição ou perda da sessão; sem retentativas.'
            break
          }
        }
        if (i + 1 < destinos.length && !op.parar) {
          await new Promise(resolve => {
            const timer = agendar(resolve, INTERVALO_MS)
            op.acordar = () => { desagendar(timer); resolve() }
          })
          op.acordar = null
        }
      }
      if (op.parar) motivo = 'Interrompido pelo dono.'
    } catch (_) {
      motivo = 'Interrompido: não foi possível atualizar os grupos. Nenhum novo envio foi iniciado.'
    } finally {
      const relatorio = `🌙 *RELATÓRIO DO COMUNICADO*\n\n📨 Grupos encontrados: ${op.grupos.length}\n✅ Enviados: ${enviados}\n❌ Falhas: ${falhas}\n⏹️ Não enviados: ${op.grupos.length - enviados - falhas}\n\n${motivo}\n💤 Relatório encerrado nos reinos dos sonhos.`
      try { await responder(sock, op.jid, op.msg, relatorio) } finally { liberar(op) }
    }
  }

  async function executar(sock, jid, msg, text) {
    const grupo = String(jid).endsWith('@g.us')
    const sender = grupo ? msg?.key?.participant : msg?.key?.remoteJid
    if (jid !== msg?.key?.remoteJid || !/^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(sender || '')) return
    const dono = await obterNumeroDono(sock, jid, sender)
    if (!dono) return responder(sock, jid, msg, '👑 Somente o dono do bot pode utilizar comunicados globais.')
    const conteudo = normalizeMessageContent(msg.message) || {}
    const bruto = text ?? conteudo.conversation ?? conteudo.extendedTextMessage?.text ?? conteudo.imageMessage?.caption ?? ''
    // Remove apenas o comando e um separador; mantém o conteúdo do dono, inclusive quebras de linha.
    const direto = removerPrefixo(bruto).replace(/^\S+(?:\s)?/, '')
    const acao = direto.trim().toLowerCase()
    if (operacao?.fase === 'pendente' && agora() >= operacao.expira) liberar(operacao)

    if (acao === 'parar') {
      if (!operacao) return responder(sock, jid, msg, '💤 Não há comunicado em andamento.')
      const op = operacao
      op.parar = true
      op.acordar?.()
      if (op.fase === 'pendente') liberar(op)
      return responder(sock, jid, msg, '⏹️ Parada solicitada. Não serão iniciados novos envios; um envio já em curso pode terminar. Se o envio começou, o relatório parcial seguirá no chat de origem.')
    }
    if (acao === 'cancelar' || acao === 'confirmar') {
      const op = operacao
      if (!op || op.dono !== dono || op.jid !== jid || op.fase !== 'pendente') {
        return responder(sock, jid, msg, '💤 Não há prévia válida sua nesta conversa. A confirmação expira em 60 segundos e só pode ser usada uma vez.')
      }
      if (acao === 'cancelar') {
        liberar(op)
        return responder(sock, jid, msg, '⏹️ Prévia cancelada. Nenhum comunicado foi enviado.')
      }
      // Consome antes de qualquer await: concorrência e reutilização não iniciam outro envio.
      op.fase = 'enviando'
      desagendar(op.timer)
      await responder(sock, jid, msg, '📨 Comunicado confirmado. Iniciando o envio; use /comunicado parar para interromper.')
      // O listener fica livre para receber /parar. A tarefa trata as próprias falhas.
      conclusao = enviar(sock, op).catch(() => {
        console.error('[comunicado] Operação encerrada por falha interna.')
        liberar(op)
      })
      return
    }
    if (operacao) return responder(sock, jid, msg, '⏳ Já existe um comunicado em preparação ou envio. Cancele a prévia ou use /comunicado parar.')
    const op = { dono, jid, msg, fase: 'preparando', parar: false }
    operacao = op
    try {
      const contexto = conteudo.extendedTextMessage?.contextInfo || conteudo.imageMessage?.contextInfo || {}
      const citado = normalizeMessageContent(contexto.quotedMessage) || {}
      const imagem = citado.imageMessage
      const texto = direto.trim() ? direto : (citado.conversation ?? citado.extendedTextMessage?.text ?? imagem?.caption ?? '')
      if (!texto.trim() && !imagem) throw new Aviso('🌙 Use /comunicado <texto> ou responda a uma mensagem de texto ou imagem.')
      if (texto.length > LIMITE_TEXTO) throw new Aviso('📜 Use um comunicado com até 3500 caracteres; o conteúdo não será cortado.')
      op.texto = formatar(texto)
      op.grupos = await obterGrupos(sock)
      if (!op.grupos.length) throw new Aviso('💤 Nenhum grupo participante encontrado. Nenhum envio será iniciado.')
      if (op.parar) throw new Aviso('⏹️ Preparação interrompida. Nenhum comunicado foi enviado.')
      if (imagem) {
        op.imagem = await baixarImagem(jid, contexto, imagem)
        op.mime = imagem.mimetype || 'image/jpeg'
      }
      if (op.parar) throw new Aviso('⏹️ Preparação interrompida. Nenhum comunicado foi enviado.')
      const previa = `🌙 *PRÉVIA DO COMUNICADO*\n\n📨 Grupos encontrados: ${op.grupos.length}\n\n${op.texto}\n\nPara confirmar: /comunicado confirmar\nPara cancelar: /comunicado cancelar\nA confirmação expira após 60 segundos.`
      // Falha na prévia não deixa autorização pendente. Não copia contexto/menções da mensagem citada.
      await sock.sendMessage(jid, op.imagem ? { image: op.imagem, mimetype: op.mime, caption: previa } : { text: previa }, { quoted: msg })
      if (op.parar) { liberar(op); return }
      op.fase = 'pendente'
      op.expira = agora() + PRAZO_MS
      op.timer = agendar(() => { if (operacao === op && op.fase === 'pendente') liberar(op) }, PRAZO_MS)
      op.timer?.unref?.()
    } catch (erro) {
      liberar(op)
      await responder(sock, jid, msg, erro instanceof Aviso ? erro.message : '❌ Não consegui preparar a prévia. Nenhum comunicado foi enviado.')
    }
  }
  return { executar, aguardarConclusao: () => conclusao }
}

module.exports = { criarSistema, sistema: criarSistema() }
