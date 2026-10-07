// ============================================================
// 📥 USARPACK — despeja as figurinhas de um pack no chat
// ============================================================
// Uso: /usarpack <nome do pack>
// Envia até 10 de uma vez (teto do núcleo) para não inundar o
// grupo. Packs suspensos não abrem para ninguém (só a moderação
// vê pelo /analisarpack).
// ============================================================

const prefixoComandos = require('../../prefixo')
const {
  buscarPackPorNome,
  podeVerPack,
  ehRevisorJid,
  TETO_ENVIO_USAR
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
  nome: 'usarpack',
  descricao: 'Despeja as figurinhas de um pack no chat.',

  async executar(sock, jid, msg, texto) {
    try {
      const nome = prefixoComandos.removerPrefixo(texto).split(' ').slice(1).join(' ').trim()
      if (!nome) {
        return await sock.sendMessage(jid, {
          text: '📥 *Usar pack*\n\nUso: /usarpack <nome do pack>\nEx.: /usarpack Memes do limbo'
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
          console.error('[usarpack] ⚠️ sem metadados do grupo:', errMeta?.message || errMeta)
        }
      }
      const remetente = msg.key?.participant || msg.key?.remoteJid || ''
      const ehRevisor = ehRevisorJid(participantes, remetente)

      if (!podeVerPack(pack, { ehRevisor })) {
        return await sock.sendMessage(jid, {
          text: `⏳ O pack "${pack.nome}" está em análise pela moderação e não pode ser usado por enquanto.`
        }, { quoted: msg })
      }

      if (!pack.figurinhas.length) {
        return await sock.sendMessage(jid, {
          text: `📦 O pack "${pack.nome}" ainda está vazio.`
        }, { quoted: msg })
      }

      const lote = pack.figurinhas.slice(0, TETO_ENVIO_USAR)
      await sock.sendMessage(jid, {
        text: `📥 *${pack.nome}* — despejando ${lote.length} de ${pack.figurinhas_qtd}:`
      }, { quoted: msg })

      for (const fig of lote) {
        const buffer = bufferDaFigurinha(fig)
        if (!buffer) continue
        await sock.sendMessage(jid, { sticker: buffer }).catch(() => {})
      }
    } catch (err) {
      console.error('[usarpack] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '❌ Não consegui despejar o pack agora — tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
