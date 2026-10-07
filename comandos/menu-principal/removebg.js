// REMOVEBG_API_KEY: configurar no .env ou no painel Environment do Render.
// API oficial: https://www.remove.bg/api — nunca registrar chave/corpo de erro.
require('../../config')
const { downloadMediaMessage, normalizeMessageContent } = require('@whiskeysockets/baileys')
const { resolverNumeroAlvo, ehLid } = require('../../lid')
const { gerarJpegThumbnail } = require('../menu-fig/webp-animado')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const URL_API = 'https://api.remove.bg/v1.0/removebg'
const TIMEOUT_MS = 15000
const LIMITE_BYTES = 12 * 1024 * 1024
class Aviso extends Error {}

async function lerBuffer(resposta) {
  if (Number(resposta.headers.get('content-length')) > LIMITE_BYTES) throw new Aviso('📷 A imagem é muito grande. Use uma imagem de até 12 MB.')
  const buffer = Buffer.from(await resposta.arrayBuffer())
  if (!buffer.length || buffer.length > LIMITE_BYTES) throw new Aviso('📷 A imagem está vazia ou é muito grande. Use uma imagem de até 12 MB.')
  return buffer
}

async function removerFundo(buffer, mimetype, chave) {
  const formulario = new FormData()
  formulario.append('image_file', new Blob([buffer], { type: mimetype }), 'imagem')
  // Preview permite usar a cota gratuita; PNG mantém a transparência.
  formulario.append('size', 'preview')
  formulario.append('format', 'png')
  const resposta = await fetch(URL_API, {
    method: 'POST', headers: { 'X-Api-Key': chave }, body: formulario,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (resposta.status === 402) throw new Aviso('💤 Limite mensal de remoção de fundo atingido. Tente novamente no próximo mês.')
  if ([401, 403].includes(resposta.status)) throw new Aviso('🔑 A chave de remoção de fundo foi recusada. Peça ao dono para conferir a configuração.')
  if ([400, 413, 415, 422].includes(resposta.status)) throw new Aviso('📷 Não consegui processar essa imagem. Tente uma foto válida com o objeto ou pessoa bem visível.')
  if (resposta.status === 429) throw new Aviso('⏳ Muitas solicitações de remoção de fundo. Tente novamente em instantes.')
  if (!resposta.ok) throw new Aviso('⚠️ O serviço de remoção de fundo está indisponível. Tente novamente em instantes.')
  const png = await lerBuffer(resposta)
  const assinatura = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (!resposta.headers.get('content-type')?.toLowerCase().startsWith('image/png') || !png.subarray(0, 8).equals(assinatura)) {
    throw new Aviso('⚠️ O serviço não retornou uma imagem PNG válida. Tente novamente em instantes.')
  }
  return png
}

module.exports = {
  nome: 'removebg',
  categoria: 'principal',
  descricao: 'Remove o fundo de uma imagem citada ou da foto de perfil (sua ou de um membro mencionado).',
  async executar(sock, jid, msg) {
    let pasta = null
    try {
      const chave = (process.env.REMOVEBG_API_KEY || '').trim()
      if (!chave) throw new Aviso('🔑 Remoção de fundo ainda não configurada. Peça ao dono para configurar REMOVEBG_API_KEY.')
      const conteudo = normalizeMessageContent(msg.message) || {}
      const contexto = conteudo.extendedTextMessage?.contextInfo || conteudo[Object.keys(conteudo)[0]]?.contextInfo || {}
      const original = normalizeMessageContent(contexto.quotedMessage) || {}
      let imagem
      let mime
      if (original.imageMessage) {
        mime = original.imageMessage.mimetype || 'image/jpeg'
        imagem = await downloadMediaMessage({
          key: { remoteJid: contexto.remoteJid || jid, id: contexto.stanzaId, participant: contexto.participant, fromMe: false },
          message: contexto.quotedMessage
        }, 'buffer', {})
      } else {
        let alvo = contexto.mentionedJid?.[0] || msg.key.participant || msg.key.remoteJid
        if (ehLid(alvo)) {
          let participantes = []
          if (String(jid).endsWith('@g.us')) {
            try { participantes = (await sock.groupMetadata(jid))?.participants || [] } catch (_) { /* tenta sessão */ }
          }
          const resolucao = await resolverNumeroAlvo(participantes, alvo)
          if (resolucao.via && resolucao.numero) alvo = `${resolucao.numero}@s.whatsapp.net`
        }
        let url
        try { url = await sock.profilePictureUrl(alvo, 'image') } catch (_) { /* foto privada ou ausente */ }
        if (!url) throw new Aviso('📷 Não consegui acessar a foto de perfil. Responda a uma imagem com /removebg ou mencione alguém com foto disponível.')
        const resposta = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
        if (!resposta.ok) throw new Aviso('📷 Não consegui baixar a foto de perfil. Tente responder a uma imagem.')
        mime = resposta.headers.get('content-type')?.split(';')[0] || ''
        if (!mime.startsWith('image/')) throw new Aviso('📷 A foto de perfil não retornou uma imagem válida.')
        imagem = await lerBuffer(resposta)
      }
      if (!Buffer.isBuffer(imagem) || !imagem.length || imagem.length > LIMITE_BYTES) throw new Aviso('📷 Use uma imagem válida de até 12 MB.')
      const png = await removerFundo(imagem, mime, chave)
      pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'hipnos-removebg-'))
      const arquivo = path.join(pasta, 'resultado.png')
      await fs.writeFile(arquivo, png)
      // Helper real: ffmpeg em processo filho, sem sharp/libvips. O fallback
      // JPEG também é enviado pronto se o ffmpeg não estiver disponível.
      const mini = await gerarJpegThumbnail(arquivo, pasta, 'removebg')
      await sock.sendMessage(jid, {
        image: png, mimetype: 'image/png', jpegThumbnail: Buffer.from(mini.base64, 'base64')
      }, { quoted: msg })
    } catch (erro) {
      const timeout = erro?.name === 'TimeoutError' || erro?.name === 'AbortError' || erro?.code === 'ETIMEDOUT'
      await sock.sendMessage(jid, {
        text: timeout ? '⏳ A remoção de fundo demorou demais. Tente novamente.'
          : erro instanceof Aviso ? erro.message : '❌ Não consegui remover o fundo dessa imagem. Tente novamente com outra foto.'
      }, { quoted: msg }).catch(() => {})
    } finally {
      // Diretório exclusivo criado por mkdtemp; remove PNG e JPEG do preview.
      if (pasta) await fs.rm(pasta, { recursive: true, force: true }).catch(() => {})
    }
  }
}
