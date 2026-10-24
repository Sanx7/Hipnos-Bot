const fs = require('node:fs/promises')
const path = require('node:path')
const estadoBot = require('../../estado-bot')

const emCurso = new Set()
const pessoa = jid => typeof jid === 'string' && /^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(jid)

module.exports = {
  nome: 'surpresa',
  aliases: [],
  categoria: 'dono',
  oculto: true,
  descricao: 'Comando reservado aos donos.',
  async executar(sock, jid, msg) {
    const sender = msg?.key?.participant || (!String(jid).endsWith('@g.us') && msg?.key?.remoteJid)
    if (!pessoa(sender) || msg?.key?.remoteJid !== jid) return
    let chave
    try {
      if (await estadoBot.remetenteEhDono(sock, jid, sender) !== true) return
      chave = `${jid}:${sender.replace(/:\d+@/, '@')}`
      if (emCurso.has(chave)) return
      emCurso.add(chave)
    } catch (_) {
      console.warn('[surpresa]', { evento: 'autorizacao_indisponivel' })
      return
    }
    try {
      const conteudo = require('../../dados/surpresa-conteudo')
      const arquivo = path.resolve(__dirname, '../../assets/surpresa/cartao.png')
      const imagem = await fs.readFile(arquivo)
      if (!imagem.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('MIDIA_INVALIDA')
      await sock.sendMessage(jid, { image: imagem, mimetype: 'image/png', caption: conteudo.abertura }, { quoted: msg })
      await sock.sendMessage(jid, { text: conteudo.carta }, { quoted: msg })
    } catch (_) {
      // Não repetir um envio cujo resultado pode ser incerto, nem imprimir conteúdo.
      console.warn('[surpresa]', { evento: 'execucao_indisponivel' })
    } finally {
      emCurso.delete(chave)
    }
  }
}
