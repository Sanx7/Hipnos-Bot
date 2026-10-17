const { DISABLE_CANVAS } = require('../config')

if (DISABLE_CANVAS) console.warn('[compatibilidade] DISABLE_CANVAS=true: recursos que exigem Canvas temporariamente indisponíveis.')

// Mantém nomes, aliases e metadados; no modo normal nem altera o executar.
function limitarComandosCanvas(comandos, nomes) {
  if (!DISABLE_CANVAS) return
  for (const comando of comandos) {
    if (!nomes.includes(comando.nome)) continue
    comando.executar = async (sock, jid, msg) => sock.sendMessage(jid, {
      text: '⚠️ Este recurso está temporariamente indisponível neste servidor porque DISABLE_CANVAS=true. Ele exige a biblioteca nativa Canvas.'
    }, { quoted: msg })
  }
}

module.exports = { DISABLE_CANVAS, limitarComandosCanvas }
