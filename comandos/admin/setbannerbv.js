// ============================================
// ️ SETBANNERBV — Banner personalizado das boas-vindas DESTE grupo
// ============================================
// Uso (dentro de um grupo, restrito a ADMIN do grupo ou DONO do bot — o
// MESMO critério do /welcome e do /soadm, via ehAutorizadoNoGrupo):
//
//   /setbannerbv            (respondendo/citando uma imagem)  → salva a imagem
//   /setbannerbv  (com a imagem enviada junto, como legenda)  → salva a imagem
//   /setbannerbv reset      → apaga o banner do grupo (volta ao padrão)
//   /setbannerbv            (sem imagem) → mostra as instruções
//
// A imagem é guardada no MongoDB (buffer) no MESMO documento de
// configurações do grupo (collection "configuracoesGrupo", 1 doc por
// grupo_id) — a persistência vive em configuracoes-grupo.js.
//
// Composição: a FOTO do novo membro é encaixada na MOLDURA DOURADA do banner
// (ver AREA_FOTO em boasvindas.js — hoje x: 550-786, y: 147-492 = 237x346 px,
// medidas na arte oficial dados/banners/padrao-boasvindas.png).
// Por isso o ideal é usar uma arte de 1344x768 com a moldura nesse lugar.
//
// ️ REGRA DE OURO: nenhuma lib nativa de imagem (sharp/libvips/canvas) é
// usada aqui — a validação da imagem usa a lib **jimp** (JavaScript puro,
// sem binding nativo).
// ============================================

const { Jimp } = require('jimp')
const { downloadMediaMessage } = require('@whiskeysockets/baileys')
const { definirBanner, removerBanner, LIMITE_BYTES_BANNER } = require('../../configuracoes-grupo')
const { ehAutorizadoNoGrupo, AREA_FOTO } = require('../../boasvindas')

// Palavras que disparam o reset (aceitas como 1º argumento)
const OPCOES_RESET = ['reset', 'padrao', 'padrão', 'remover', 'limpar', 'apagar', '0', 'off']

const MSG_SEM_PERMISSAO =
  '🌑 *Hipnos ignora sua petição...*\n\nApenas *administradores do grupo* (ou o dono do bot) podem definir o banner das boas-vindas.'

const MSG_FORA_DE_GRUPO =
  '🖼️ *Hipnos só veste os portais de um grupo.*\n\nUse este comando em um grupo para definir o banner das boas-vindas.'

// -------------------------------------------------------------------
// 🔎 localizarImagem(msg): procura a imagem enviada JUNTO com o comando ou
// a imagem RESPONDIDA (citada) — incluindo documentos com mime de imagem.
// Devolve { midia, mensagem, origem } ou null.
// -------------------------------------------------------------------
function localizarImagem(msg) {
  const conteudo = msg?.message
  const citada = conteudo?.extendedTextMessage?.contextInfo?.quotedMessage

  // 1) ️ Imagem enviada com o comando (legenda = "/setbannerbv ...")
  if (conteudo?.imageMessage) {
    return { midia: conteudo.imageMessage, mensagem: { key: msg.key, message: conteudo }, origem: 'enviada' }
  }
  // 2) 🖼️ Imagem RESPONDIDA
  if (citada?.imageMessage) {
    return { midia: citada.imageMessage, mensagem: { key: msg.key, message: citada }, origem: 'citada' }
  }
  // 3) 📄 Documento com mime de imagem (enviado junto ou respondido)
  if (conteudo?.documentMessage?.mimetype?.startsWith('image/')) {
    return { midia: conteudo.documentMessage, mensagem: { key: msg.key, message: conteudo }, origem: 'documento enviado' }
  }
  if (citada?.documentMessage?.mimetype?.startsWith('image/')) {
    return { midia: citada.documentMessage, mensagem: { key: msg.key, message: citada }, origem: 'documento citado' }
  }

  return null
}

// -------------------------------------------------------------------
// 🧪 bufferMimePadrao(buffer): adivinha o mime pelos "magic bytes" quando a
// mensagem não informa o tipo (fallback simples, sem lib externa).
// -------------------------------------------------------------------
function bufferMimePadrao(buffer) {
  if (buffer?.[0] === 0xff && buffer?.[1] === 0xd8) return 'image/jpeg'
  if (buffer?.[0] === 0x89 && buffer?.[1] === 0x50) return 'image/png'
  if (buffer?.[0] === 0x47 && buffer?.[1] === 0x49) return 'image/gif'
  if (buffer?.[8] === 0x57 && buffer?.[9] === 0x45) return 'image/webp'
  return 'image/png'
}

// -------------------------------------------------------------------
// 📐 Ajuda exibida quando não há imagem para salvar
// -------------------------------------------------------------------
function textoDeAjuda() {
  return [
    '🖼️ *PORTAL DO BANNER*',
    '',
    'Envie a imagem do banner *com este comando na legenda* ou *responda* uma imagem com */setbannerbv*:',
    '',
    '• /setbannerbv (respondendo a uma imagem)',
    '• /setbannerbv (com a imagem na legenda do comando)',
    '• /setbannerbv reset — volta ao banner padrão',
    '',
    `📐 Área da foto do novo membro (a moldura): x ${AREA_FOTO.x}-${AREA_FOTO.x + AREA_FOTO.w}, y ${AREA_FOTO.y}-${AREA_FOTO.y + AREA_FOTO.h} (${AREA_FOTO.w}x${AREA_FOTO.h} px).`,
    ' O ideal é uma arte de *1344x768* com a moldura nesse lugar (igual ao banner padrão).'
  ].join('\n')
}
module.exports = {
  nome: 'setbannerbv',
  aliases: ['bannerbv'],
  descricao: 'Define o banner personalizado das boas-vindas deste grupo (apenas administradores).',

  async executar(sock, jid, msg, text) {
    try {
      // 1) 🚪 Só dentro de grupos
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, { text: MSG_FORA_DE_GRUPO }, { quoted: msg })
      }

      const sender = msg.key.participant || msg.key.remoteJid

      // 2) 🔒 Autorização — MESMO critério do /welcome e do /soadm
      const { autorizado } = await ehAutorizadoNoGrupo(sock, jid, sender)
      if (!autorizado) {
        return await sock.sendMessage(jid, { text: MSG_SEM_PERMISSAO }, { quoted: msg })
      }

      // 3) ♻️ Reset (volta ao banner padrão do bot)
      const opcao = String(text || '').split(' ').slice(1)[0]?.trim().toLowerCase() || ''
      if (OPCOES_RESET.includes(opcao)) {
        const tinhaBanner = await removerBanner(jid)
        return await sock.sendMessage(jid, {
          text: tinhaBanner
            ? '♻️ *BANNER RESTAURADO*\n\nO banner próprio deste grupo foi apagado. As boas-vindas voltam a usar o *banner padrão*. 🌙'
            : '⚠️ Este grupo *não tinha* banner personalizado. Nada mudou (o padrão segue em uso).'
        }, { quoted: msg })
      }

      // 4) 🖼️ Precisa de uma imagem (enviada junto OU respondida)
      const alvo = localizarImagem(msg)
      if (!alvo) {
        return await sock.sendMessage(jid, { text: textoDeAjuda() }, { quoted: msg })
      }

      console.log(`[setbannerbv] 📥 baixando a imagem (${alvo.origem}) de ${jid}...`)
      const buffer = await downloadMediaMessage(alvo.mensagem, 'buffer', {})

      if (!buffer || buffer.length === 0) {
        return await sock.sendMessage(jid, {
          text: '⚠️ Não consegui baixar essa imagem (ela pode ter expirado). Envie ou responda de novo.'
        }, { quoted: msg })
      }
      if (buffer.length > LIMITE_BYTES_BANNER) {
        return await sock.sendMessage(jid, {
          text: `⚠️ Imagem grande demais (${(buffer.length / 1024 / 1024).toFixed(1)} MB). O limite é ${LIMITE_BYTES_BANNER / 1024 / 1024} MB — envie uma versão mais leve.`
        }, { quoted: msg })
      }
      console.log(`[setbannerbv] ✅ download ok (${buffer.length} bytes) — validando com jimp...`)

      // 5) 🧪 Valida a imagem com jimp (JS puro — nada de lib nativa)
      const imagem = await Jimp.read(buffer)
      const largura = imagem.bitmap.width
      const altura = imagem.bitmap.height

      // 6) 🗄️ Salva no MongoDB (associada a ESTE grupo_id)
      const mime = alvo.midia?.mimetype || bufferMimePadrao(buffer)
      await definirBanner(jid, buffer, mime)
      console.log(`[setbannerbv] ✅ banner salvo em ${jid} (${largura}x${altura}, ${mime})`)

      // 7) ✅ Confirma (com os avisos pertinentes)
      const avisos = []
      if (largura < 1000 || altura < 600) {
        avisos.push(`⚠️ Resolução baixa (${largura}x${altura}) — o padrão é 1344x768; a imagem pode ficar esticada/serrilhada.`)
      }
      avisos.push(`📐 A foto do membro será encaixada na moldura x ${AREA_FOTO.x}-${AREA_FOTO.x + AREA_FOTO.w}, y ${AREA_FOTO.y}-${AREA_FOTO.y + AREA_FOTO.h}.`)

      return await sock.sendMessage(jid, {
        text: [
          '🖼️ *BANNER DAS BOAS-VINDAS ATUALIZADO* ✅',
          '',
          `🖼️ Imagem: ${largura}x${altura} px (${(buffer.length / 1024).toFixed(0)} KB, ${alvo.origem}).`,
          '💾 Salvo no banco para *este grupo*.',
          '',
          ...avisos,
          '',
          '♻️ Para voltar ao padrão: */setbannerbv reset*'
        ].join('\n')
      }, { quoted: msg })

    } catch (err) {
      console.error('[setbannerbv] 💥 erro:', err?.stack || err)

      // Mensagens específicas (imagem inválida / banco fora) sem vazar stack
      const detalhe = String(err?.message || '')
      if (detalhe.includes('MONGODB_URI') || detalhe.includes('MongoDB') || detalhe.includes('grupo_id')) {
        return await sock.sendMessage(jid, {
          text: '⛔ O *banco de dados* está indisponível agora — o banner NÃO foi salvo. Tente novamente em instantes.'
        }, { quoted: msg }).catch(() => {})
      }
      if (detalhe.includes('limite') || detalhe.includes('vazio')) {
        return await sock.sendMessage(jid, { text: `⚠️ ${detalhe}` }, { quoted: msg }).catch(() => {})
      }

      return await sock.sendMessage(jid, {
        text: '⛔ As sombras não conseguiram gravar esse banner... A imagem é válida? Tente novamente.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}