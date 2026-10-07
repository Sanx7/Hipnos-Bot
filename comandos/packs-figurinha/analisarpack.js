// ============================================================
// 🔎 ANALISARPACK — a mesa da moderação (só admin/dono do bot)
// ============================================================
// Sem argumento: lista os packs suspensos.
// Com nome: mostra a ficha completa (denúncias + prévia).
// Aqui o revisor enxerga o que o /museu esconde.
// ============================================================

const prefixoComandos = require('../../prefixo')
const { formatarNumero } = require('../../config')
const {
  buscarPackPorNome,
  listarPacksSuspensos,
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
  nome: 'analisarpack',
  descricao: 'Lista os packs suspensos ou mostra um para análise (moderação).',

  async executar(sock, jid, msg, texto) {
    try {
      let participantes = []
      if (String(jid || '').endsWith('@g.us')) {
        try {
          participantes = (await sock.groupMetadata(jid))?.participants || []
        } catch (errMeta) {
          console.error('[analisarpack] ⚠️ sem metadados do grupo:', errMeta?.message || errMeta)
        }
      }
      const remetente = msg.key?.participant || msg.key?.remoteJid || ''
      if (!ehRevisorJid(participantes, remetente)) {
        return await sock.sendMessage(jid, {
          text: '🛡️ Só a moderação (admin do grupo ou dono do bot) pode analisar packs.'
        }, { quoted: msg })
      }

      const nome = prefixoComandos.removerPrefixo(texto).split(' ').slice(1).join(' ').trim()

      if (!nome) {
        const suspensos = await listarPacksSuspensos()
        if (!suspensos.length) {
          return await sock.sendMessage(jid, {
            text: '✅ Nenhum pack suspenso — o museu está em paz. 💤'
          }, { quoted: msg })
        }
        const linhas = suspensos.map((pack) => `• 📦 *${pack.nome}* — ${pack.denuncias_qtd} denúncia(s), ${pack.figurinhas_qtd} fig(s)`)
        return await sock.sendMessage(jid, {
          text:
            `🔎 *Packs em análise* (${suspensos.length}):\n\n` +
            linhas.join('\n') +
            '\n\nVer um: /analisarpack <nome>\nReativar: /reativarpack <nome>\nApagar: /apagarpack <nome>'
        }, { quoted: msg })
      }

      const pack = await buscarPackPorNome(nome)
      if (!pack) {
        return await sock.sendMessage(jid, {
          text: `❌ Não achei nenhum pack chamado "${nome}".`
        }, { quoted: msg })
      }

      const denuncias = pack.denuncias.length
        ? pack.denuncias.map((d) => `– ${formatarNumero(d.autor)}: ${d.motivo}`).join('\n')
        : '_(sem denúncias)_'

      await sock.sendMessage(jid, {
        text:
          `🔎 *${pack.nome}* [${pack.status}] — ${pack.figurinhas_qtd}/30 figs\n` +
          (pack.descricao ? `_${pack.descricao}_\n` : '') +
          `\nDenúncias (${pack.denuncias_qtd}):\n${denuncias}\n` +
          '\nDecida: /reativarpack <nome> (zera as denúncias) ou /apagarpack <nome>.'
      }, { quoted: msg })

      for (const fig of pack.figurinhas.slice(0, PREVIA_ABRIR)) {
        const buffer = bufferDaFigurinha(fig)
        if (!buffer) continue
        await sock.sendMessage(jid, { sticker: buffer }).catch(() => {})
      }
    } catch (err) {
      console.error('[analisarpack] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '❌ Não consegui analisar agora — tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
