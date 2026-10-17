const reacoes = require('../../dados/reacoes-palavras')
const { autorizado, identificar } = require('../../dados/advertencias-contexto')
const { identidade } = require('../../dados/identidade-participante')
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
        let autor
        if (nome !== 'emojilista') {
          const meta = await sock.groupMetadata(jid)
          const sender = msg?.key?.participant
          const pessoa = await identificar(meta?.participants || [], sender)
          if (!pessoa.participante && !pessoa.dono) return await responder('🔒 Não consegui comprovar sua identidade como membro deste grupo.')
          const ids = new Set()
          const p = pessoa.participante
          if (pessoa.numero) {
            const provaPN = await identificar(meta?.participants || [], `${pessoa.numero}@s.whatsapp.net`)
            if ((p && provaPN.participante === p) || (!p && provaPN.dono && provaPN.numero === pessoa.numero)) ids.add(`pn:${pessoa.numero}`)
          }
          // Só aceita aliases comprovados do mesmo participante; nunca iguala
          // os dígitos de um telefone aos de um LID.
          for (const alias of [sender, p?.id, p?.phoneNumber, p?.lid && `${String(p.lid).split('@')[0]}@lid`]) {
            if (!identidade(alias)) continue
            const prova = await identificar(meta?.participants || [], alias)
            if ((p && prova.participante === p && prova.numero === pessoa.numero) || (!p && prova.dono && prova.numero === pessoa.numero)) ids.add(identidade(alias))
          }
          autor = { identidades: [...ids], privilegiado: ids.has(`pn:${pessoa.numero}`) && await autorizado(meta, sender, true) }
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
        const resultado = emoji === null ? await repositorio.remover(jid, termo, autor) : await repositorio.registrar(jid, termo, emoji, autor)
        await responder(emoji !== null ? `✅ Reação cadastrada ou atualizada: ${termo} → ${emoji}` : resultado ? `✅ Reação removida: ${termo}` : 'ℹ️ Esse termo não está cadastrado neste grupo.')
      } catch (erro) {
        if (erro?.code === 'REACAO_NAO_AUTORIZADA') return await responder('🔒 Somente quem criou este registro, um administrador do grupo ou um dono do Hipnos pode atualizar ou remover. Registros antigos sem criador são restritos a administradores e donos.').catch(() => {})
        console.warn('[emojis-palavras] Operação não concluída.')
        await responder('⚠️ Não consegui concluir. Confira as permissões e o MongoDB. Use um termo de 1–60 caracteres (até cinco palavras, letras/números, espaços, hífen ou apóstrofo) e um único emoji. Limite: 50 registros por grupo.').catch(() => {})
      }
    }
  }))
}

module.exports = criarComandos()
module.exports.criarComandos = criarComandos
