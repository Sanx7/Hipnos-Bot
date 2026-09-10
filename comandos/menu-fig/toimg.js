// ============================================
// 🖼️ TOIMG — Figurinha → Imagem (uso LIVRE)
// ============================================
// Converte a figurinha citada em imagem JPG e devolve no chat.
//   - sticker ESTÁTICO: ffmpeg decodifica o webp direto;
//   - sticker ANIMADO: extrai o 1º frame (anim_dump) e converte — a imagem
//     sai estática e o usuário é avisado.
// Pipeline seguro: processos FILHOS (execFile, args em array — sem shell
// injection), temporários em os.tmpdir() (disco efêmero do Render) e
// limpeza garantida no finally. Causa raiz do bug antigo: a webp-converter
// v2.3.3 virou promise-only e injetava o callback na linha de comando.
// ============================================

const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { webpParaJpg, webpEhAnimado } = require('./webp-animado')

// ⛔ Limite da figurinha (evita estourar RAM/disco do Render free)
const LIMITE_BYTES = 25 * 1024 * 1024

/** Apaga temporário com retry (EPERM/EBUSY no Windows). NUNCA lança. */
function apagarComRetry(caminho, tentativas = 3) {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms))
  return (async () => {
    for (let i = 0; i < tentativas; i++) {
      try {
        if (!fs.existsSync(caminho)) return
        fs.unlinkSync(caminho)
        return
      } catch (err) {
        if (i < tentativas - 1) await espera(150)
        else console.error('⚠️ toimg: falha ao apagar', caminho, err?.message)
      }
    }
  })()
}

module.exports = {
  nome: 'toimg',
  descricao: 'Transforma uma figurinha (estática ou animada) em imagem.',

  async executar(sock, jid, msg, texto) {
    let caminhoWebp = null
    let caminhoJpg = null

    try {
      // 1) Exige uma figurinha citada
      const cotada = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      const stickerMessage = cotada?.stickerMessage

      if (!stickerMessage) {
        return await sock.sendMessage(jid, {
          text: '🖼️ *Falta a figurinha...*\n\nResponda (marque) uma figurinha com `/toimg` para que eu a transforme em imagem.'
        }, { quoted: msg })
      }

      // 2) ⏳ Sinaliza processamento
      await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {})

      // 3) 📥 Baixa o webp da figurinha (com limite de tamanho)
      const stream = await downloadContentFromMessage(stickerMessage, 'image')
      let buffer = Buffer.from([])
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk])
        if (buffer.length > LIMITE_BYTES) {
          throw new Error('A figurinha excede o limite de 25MB suportado.')
        }
      }
      if (buffer.length === 0) {
        throw new Error('A figurinha foi baixada vazia (0 bytes).')
      }

      // 4) 🗑️ Temporários no os.tmpdir() (/tmp no Render — disco efêmero)
      const idUnico = `toimg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
      caminhoWebp = path.join(os.tmpdir(), `${idUnico}.webp`)
      caminhoJpg = path.join(os.tmpdir(), `${idUnico}.jpg`)
      fs.writeFileSync(caminhoWebp, buffer)

      const ehAnimado = webpEhAnimado(buffer)
      console.log(`[toimg] 🎛️ convertendo webp (${ehAnimado ? 'ANIMADO' : 'estático'}, ${buffer.length} bytes)...`)

      // 5) 🌉 Conversão via ponte ffmpeg/anim_dump (processo filho, sem shell)
      const resultado = await webpParaJpg(caminhoWebp, caminhoJpg)
      console.log(`[toimg] ✅ JPG pronto: ${fs.statSync(caminhoJpg).size} bytes`)

      // 6) 📤 Envia a imagem citando a figurinha original
      await sock.sendMessage(jid, {
        image: fs.readFileSync(caminhoJpg),
        caption: resultado.animado
          ? '🔮 Aqui está sua imagem trazida do limbo! (a figurinha era animada — enviei o 1º frame)'
          : '🔮 Aqui está sua imagem trazida do limbo!'
      }, { quoted: msg })

      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {})
      console.log('[toimg] ✅ imagem enviada com sucesso')

    } catch (err) {
      // 🛡️ Nada escapa pro socket: loga o erro REAL e avisa com calma
      console.error('[toimg] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      if (err?.mensagemExecutavel) {
        console.error('[toimg] 📎 stderr do conversor:', err.mensagemExecutavel)
      }
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {})
      await sock.sendMessage(jid, {
        text: '❌ Não consegui converter essa figurinha agora — o feitiço falhou, mas Hipnos segue de pé. Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    } finally {
      // 🧹 Limpeza SEMPRE — nunca acumula lixo no disco efêmero
      for (const caminho of [caminhoWebp, caminhoJpg]) {
        if (caminho) await apagarComRetry(caminho)
      }
    }
  }
}
