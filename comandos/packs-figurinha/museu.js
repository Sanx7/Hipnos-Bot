// ============================================================
// 🏛️ MUSEU — vitrine paginada dos packs ativos
// ============================================================
// Uso: /museu [página]
// Só lista packs ATIVOS: suspensos somem daqui até a moderação
// decidir (/analisarpack).
// ============================================================

const prefixoComandos = require('../../prefixo')
const { listarPacksMuseu } = require('../../packs-figurinha')

module.exports = {
  nome: 'museu',
  descricao: 'Mostra a vitrine de packs de figurinhas.',

  async executar(sock, jid, msg, texto) {
    try {
      const argumentos = prefixoComandos.removerPrefixo(texto).split(' ').slice(1).join(' ').trim()
      const pagina = Number.parseInt(argumentos, 10) || 1

      const { packs, pagina: paginaAtual, totalPaginas, total } = await listarPacksMuseu(pagina)

      if (!total) {
        return await sock.sendMessage(jid, {
          text: '🏛️ *O museu ainda está vazio...*\n\nCrie o primeiro com /criarpack <nome> | <descrição>. 💤'
        }, { quoted: msg })
      }

      const linhas = packs.map((pack, indice) => {
        const numero = (paginaAtual - 1) * packs.length + indice + 1
        const descricao = pack.descricao ? `\n   _${pack.descricao}_` : ''
        return `${numero}. 📦 *${pack.nome}* (${pack.figurinhas_qtd}/30)${descricao}`
      })

      await sock.sendMessage(jid, {
        text:
          `🏛️ *Museu de packs* — página ${paginaAtual}/${totalPaginas} (${total} no total)\n\n` +
          linhas.join('\n\n') +
          '\n\n' +
          '🔍 Ver um pack: /abrirpack <nome>\n' +
          '📥 Usar um pack: /usarpack <nome>' +
          (totalPaginas > 1 ? `\n📄 Próxima página: /museu ${Math.min(totalPaginas, paginaAtual + 1)}` : '')
      }, { quoted: msg })
    } catch (err) {
      console.error('[museu] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '❌ Não consegui abrir o museu agora — tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
