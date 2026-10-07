// ============================================================
// 🔍 ABRIRPACK — mostra a ficha + prévia de um pack
// ============================================================
// Uso: /abrirpack <nome do pack>
// Packs suspensos só abrem para a moderação (admin/dono do bot),
// que os analisa pelo /analisarpack.
// ============================================================

const prefixoComandos = require('../../prefixo')
const { resolverNumeroAlvo } = require('../../lid')
const {
  buscarPackPorNome,
  podeVerPack,
  ehRevisorJid,
  PREVIA_ABRIR
} = require('../../packs-figurinha')

// O Mongo devolve o Buffer como Binary — cobre os formatos.
function bufferDaFigurinha(fig) {
  const valor = fig?.url_ou_buffer_ref
  if (!valor) return null
  if (Buffer.isBuffer(valor)) return valor
  if (valor instanceof Uint8Array) return Buffer.from(valor)
  if (Buffer.isBuffer(valor?.buffer)) return valor.buffer
  if (valor?.buffer instanceof Uint8Array) return Buffer.from(valor.buffer)
  if (typeof valor?.value === 'function') {
    try {
      const dentro = valor.value()
      if (Buffer.isBuffer(dentro)) return dentro
      if (dentro instanceof Uint8Array) return Buffer.from(dentro)
    } catch (err) { /* cai no null abaixo */ }
  }
  return null
}

module.exports = {
  nome: 'abrirpack',
  descricao: 'Mostra a ficha e uma prévia de um pack.',

  async executar(sock, jid, msg, texto) {
    try {
      const nome = prefixoComandos.removerPrefixo(texto).split(' ').slice(1).join(' ').trim()
      if (!nome) {
        return await sock.sendMessage(jid, {
          text: '🔍 *Abrir pack*\n\nUso: /abrirpack <nome do pack>\nEx.: /abrirpack Memes do limbo'
        }, { quoted: msg })
      }

      const pack = await buscarPackPorNome(nome)
      if (!pack) {
        return await sock.sendMessage(jid, {
          text: `❌ Não achei nenhum pack chamado "${nome}". Veja a vitrine com /museu.`
        }, { quoted: msg })
      }

      let participantes = []
      if (String(jid || '').endsWith('@g.us')) {
        try {
          participantes = (await sock.groupMetadata(jid))?.participants || []
        } catch (errMeta) {
          console.error('[abrirpack] ⚠️ sem metadados do grupo:', errMeta?.message || errMeta)
        }
      }
      const remetente = msg.key?.participant || msg.key?.remoteJid || ''
      const ehRevisor = ehRevisorJid(participantes, remetente)

      if (!podeVerPack(pack, { ehRevisor })) {
        return await sock.sendMessage(jid, {
          text: `⏳ O pack "${pack.nome}" está em análise pela moderação e não pode ser aberto por enquanto.`
        }, { quoted: msg })
      }

      if (!pack.figurinhas.length) {
        return await sock.sendMessage(jid, {
          text: `📦 *${pack.nome}*\nAinda não tem figurinhas — seja o primeiro com /addfig ${pack.nome} (respondendo a uma figurinha).`
        }, { quoted: msg })
      }

      const dono = pack.dono_nome ? ` por ${pack.dono_nome}` : ''
      await sock.sendMessage(jid, {
        text:
          `📦 *${pack.nome}* (${pack.figurinhas_qtd}/30)${dono}\n` +
          (pack.descricao ? `_${pack.descricao}_\n` : '') +
          `\nPrévia das ${Math.min(PREVIA_ABRIR, pack.figurinhas.length)} primeiras — pegue todas com /usarpack ${pack.nome}:`
      }, { quoted: msg })

      for (const fig of pack.figurinhas.slice(0, PREVIA_ABRIR)) {
        const buffer = bufferDaFigurinha(fig)
        if (!buffer) continue
        await sock.sendMessage(jid, { sticker: buffer }).catch(() => {})
      }
    } catch (err) {
      console.error('[abrirpack] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '❌ Não consegui abrir o pack agora — tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
