const dados = require('../../advertencias')
const { autorizado, identificar, extrairAlvo } = require('../../dados/advertencias-contexto')
const { ehProprioBot, respostaAutoexpulsao } = require('../../dados/protecao-bot')
const { extrairTextoComando } = require('../../dados/texto-comando')

function argumentos(text) {
  return String(text || '').trim().split(/\s+/).slice(1).filter(p => !p.startsWith('@'))
}
function responsavel(numero) { return numero && numero !== 'desconhecido' ? `@${numero}` : 'não registrado' }
function registro(doc, i) {
  const estado = dados.estadoAdvertencia(doc)
  let linha = `${i}. ${estado} · ${String(doc.motivo).slice(0, 500)}\n   🗓️ ${dados.formatarData(doc.data)} · por ${responsavel(doc.aplicado_por)}`
  if (estado === 'perdoada') linha += `\n   🕊️ Perdão: ${dados.formatarData(doc.removida_em)} · por ${responsavel(doc.removido_por)}`
  if (estado === 'arquivada' && doc.arquivada_em) linha += `\n   📦 Arquivo: ${dados.formatarData(doc.arquivada_em)} · por ${responsavel(doc.arquivada_por)}`
  return linha
}
function comando(nome) {
  return {
    nome,
    descricao: 'Consulta e gestão dos registros do Tribunal dos Sonhos.',
    async executar(sock, jid, msg, text) {
      const responder = (texto, mentions = []) => sock.sendMessage(jid, { text: texto, mentions }, { quoted: msg })
      try {
        if (!String(jid).endsWith('@g.us')) return await responder('🌑 O Tribunal dos Sonhos atende somente em grupos.')
        const sender = msg?.key?.participant || msg?.key?.remoteJid
        const meta = await sock.groupMetadata(jid)
        const participantes = meta?.participants || []
        const autor = await identificar(participantes, sender)
        if (!autor.numero) return await responder('🔍 Não consegui comprovar sua identidade. Tente novamente em instantes.')
        const texto = text ?? extrairTextoComando(msg)
        const args = argumentos(texto)
        if (nome === 'setlimiteadv') {
          if (!autor.dono) return await responder('🔒 Somente o dono do bot pode alterar o limite de advertências.')
          if (args.length !== 1 || !/^(?:[1-9]|10)$/.test(args[0])) return await responder('📜 Use /setlimiteadv 5. Escolha um limite de 1 a 10.')
          await dados.definirLimiteAdvertencias(jid, Number(args[0]), autor.numero)
          return await responder(`⚖️ *TRIBUNAL DOS SONHOS*\n\n🌙 Limite deste grupo: *${args[0]}*.\n📜 Aplicado às próximas advertências; nenhum banimento retroativo.`)
        }
        if (nome !== 'minhaspunicoes' && !await autorizado(meta, sender, true)) {
          return await responder('🔒 Só administradores do grupo ou donos do bot podem consultar este pergaminho.')
        }
        if (nome === 'minhaspunicoes') {
          if (!autor.participante) return await responder('🔍 Não consegui comprovar sua participação neste grupo.')
          // Nenhum argumento, menção ou citação altera o alvo desta consulta.
          const pagina = args.length === 1 && /^\d+$/.test(args[0]) ? Number(args[0]) : 1
          if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 100000) return await responder('📜 Use /minhaspunicoes [página].')
          const ativas = await dados.listarAdvertencias(autor.numero, jid)
          const limite = await dados.obterLimiteAdvertencias(jid)
          const linhas = ativas.slice((pagina - 1) * 5, pagina * 5).map((d, i) => `${(pagina - 1) * 5 + i + 1}. ${String(d.motivo).slice(0, 300)}\n   🗓️ ${dados.formatarData(d.data)}`).join('\n')
          return await responder(`⚖️ *TRIBUNAL DOS SONHOS*\n\n👤 Mortal: @${autor.numero}\n⚠️ Advertências: *${ativas.length}/${limite}*\n\n${linhas || '✨ Nenhuma advertência ativa.'}${ativas.length > pagina * 5 ? `\n📜 Próxima: /minhaspunicoes ${pagina + 1}` : ''}\n\n📜 Que os próximos passos sejam mais sábios...`, [sender])
        }
        const alvoJid = extrairAlvo(msg)
        if (!alvoJid) return await responder(`📜 Use /${nome} @usuario${nome === 'historicoadv' ? ' [página]' : ''}, ou responda à mensagem da pessoa.`)
        const alvo = await identificar(participantes, alvoJid)
        if (!alvo.numero) return await responder('🔍 Não consegui identificar o telefone real desse mortal.')
        if (nome === 'historicoadv') {
          if (args.length > 1 || (args.length && !/^\d+$/.test(args[0]))) return await responder('📜 Use /historicoadv @usuario [página].')
          const pagina = args.length ? Number(args[0]) : 1
          if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 100000) return await responder('📜 Informe uma página válida, começando em 1.')
          const historico = await dados.listarHistorico(alvo.numero, jid, pagina)
          const linhas = historico.registros.map((d, i) => registro(d, (pagina - 1) * 5 + i + 1)).join('\n\n')
          return await responder(`⚖️ *TRIBUNAL DOS SONHOS*\n\n👤 Mortal: @${alvo.numero}\n📜 Histórico deste grupo · página ${pagina}\n\n${linhas || '🌙 Nenhum registro nesta página.'}${historico.temProxima ? `\n\n📜 Próxima: /historicoadv @${alvo.numero} ${pagina + 1}` : ''}`, [alvoJid])
        }
        if (args.length) return await responder('📜 Use /zeraradv @usuario, ou responda à mensagem da pessoa.')
        if (await ehProprioBot(sock, jid, alvoJid, participantes)) return await responder(respostaAutoexpulsao())
        if (alvo.dono) return await responder('⛔ Não é possível executar essa ação contra o dono do bot.')
        const quantidade = await dados.comAdvertenciasSerializadas(alvo.numero, jid, async () => {
          const atual = await sock.groupMetadata(jid)
          const identidade = await identificar(atual.participants || [], alvoJid)
          if (!await autorizado(atual, sender, true) || identidade.dono || identidade.numero !== alvo.numero) throw new Error('Permissão ou identidade mudou')
          return dados.arquivarAdvertencias(alvo.numero, jid, autor.numero)
        })
        return await responder(`⚖️ *TRIBUNAL DOS SONHOS*\n\n👤 Mortal: @${alvo.numero}\n📦 ${quantidade} advertência(s) ativa(s) arquivada(s).\n🌙 O histórico foi preservado.`, [alvoJid])
      } catch (erro) {
        console.error(`[${nome}] operação não concluída:`, erro.message)
        await responder('🌫️ Não consegui concluir a operação agora. Os registros não foram excluídos; uma operação pendente pode precisar da revisão do dono.').catch(() => {})
      }
    }
  }
}
module.exports = ['minhaspunicoes', 'historicoadv', 'zeraradv', 'setlimiteadv'].map(comando)
