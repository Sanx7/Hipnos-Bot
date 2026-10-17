const reacoes = require('../../dados/reacoes-palavras')
const { autorizado } = require('../../dados/advertencias-contexto')
const { extrairTextoComando } = require('../../dados/texto-comando')
const { obterPrefixo } = require('../../prefixo')

function criarComandos(repositorio = reacoes.repositorio) {
  return ['emojiregistrar', 'emojiremover', 'emojilista'].map(nome => ({
    nome,
    descricao: { emojiregistrar: 'Cadastra ou atualiza uma reação automática por palavra no grupo.', emojiremover: 'Remove uma reação automática por palavra do grupo.', emojilista: 'Lista as reações automáticas deste grupo.' }[nome],
    async executar(sock, jid, msg, texto) {
      const responder = text => sock.sendMessage(jid, { text }, { quoted: msg })
      try {
        if (!/^\d+(?:-\d+)?@g\.us$/.test(String(jid))) return await responder('👥 Use este comando em um grupo.')
        if (nome !== 'emojilista') {
          const meta = await sock.groupMetadata(jid)
          if (!await autorizado(meta, msg?.key?.participant, true)) return await responder('🔒 Somente administradores do grupo e donos do Hipnos podem alterar as reações.')
        }
        const corpo = String(texto ?? extrairTextoComando(msg)).trim()
        if (corpo.length > 300) return await responder('⚠️ Entrada longa demais. Use um termo de até 60 caracteres e no máximo cinco palavras.')
        const args = corpo.split(/\s+/u).slice(1)
        if (nome === 'emojilista') {
          if (args.length) return await responder(`Use ${await obterPrefixo()}emojilista sem argumentos.`)
          const registros = await repositorio.obter(jid, true)
          return await responder(`😀 *Reações deste grupo (${registros.length}/${reacoes.MAX_REGISTROS})*\n\n${registros.map(r => `• ${r.termo} → ${r.emoji}`).join('\n') || 'Nenhuma reação cadastrada.'}`)
        }
        if (!args.length || (nome === 'emojiregistrar' && args.length < 2)) {
          const p = await obterPrefixo()
          return await responder(`Use ${p}${nome} <palavra ou nome>${nome === 'emojiregistrar' ? ' <emoji>' : ''}.\nExemplo: ${p}${nome} bom dia${nome === 'emojiregistrar' ? ' ☀️' : ''}`)
        }
        const emoji = nome === 'emojiregistrar' ? args.pop() : null
        const termo = reacoes.normalizarTermo(args.join(' '))
        if (emoji !== null) reacoes.validarEmoji(emoji)
        const resultado = emoji === null ? await repositorio.remover(jid, termo) : await repositorio.registrar(jid, termo, emoji)
        await responder(emoji !== null ? `✅ Reação cadastrada ou atualizada: ${termo} → ${emoji}` : resultado ? `✅ Reação removida: ${termo}` : 'ℹ️ Esse termo não está cadastrado neste grupo.')
      } catch (_) {
        console.warn('[emojis-palavras] Operação não concluída.')
        await responder('⚠️ Não consegui concluir. Confira as permissões e o MongoDB. Use um termo de 1–60 caracteres (até cinco palavras, letras/números, espaços, hífen ou apóstrofo) e um único emoji. Limite: 50 registros por grupo.').catch(() => {})
      }
    }
  }))
}

module.exports = criarComandos()
module.exports.criarComandos = criarComandos
