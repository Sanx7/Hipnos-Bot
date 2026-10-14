const { parseValor, transferirEntreJogadores, formatarReais } = require('../../rpg/economia')
const { resolverIdentidade } = require('../../rpg/identidade')
const { enviar, contexto, mensagemErro } = require('../../rpg/comandos')
module.exports = {
  nome: 'transferir', aliases: ['transf', 'pix'],
  descricao: 'Transfere dinheiro da carteira para outro jogador.',
  async executar(sock, jid, msg, texto) {
    const content = msg.message || {}
    const info = content.extendedTextMessage?.contextInfo || content[Object.keys(content)[0]]?.contextInfo || {}
    let alvo = info.mentionedJid?.[0] || info.participant
    const args = String(texto || '').trim().split(/\s+/).slice(1)
    if (!alvo) alvo = args.shift()
    else if (info.mentionedJid?.length && args.length === 2) args.shift()
    if (!alvo || args.length !== 1) return enviar(sock, jid, msg,
      '💸 *Como transferir:*\n/transferir @alguém <valor|todos>\nOu responda a uma mensagem com /transferir 100.\nTambém aceita telefone completo.')
    if (/^@\d{10,15}$/.test(alvo)) alvo = alvo.slice(1)
    const valor = parseValor(args[0])
    if (valor === null) return enviar(sock, jid, msg, '🚫 ' + mensagemErro('valor_invalido'))
    try {
      const ctx = await contexto(sock, jid, msg)
      const destino = await resolverIdentidade(alvo, ctx.participantes)
      const r = await transferirEntreJogadores(ctx.sender, alvo, valor, ctx)
      if (!r.ok) return enviar(sock, jid, msg, '⚠️ ' + mensagemErro(r.motivo))
      await enviar(sock, jid, msg, '💸 *TRANSFERÊNCIA CONCLUÍDA*' + (r.repetida ? ' (já processada)' : '') +
        '\n➡️ Enviado: ' + formatarReais(r.valor) + '\n👤 Para: @' + destino.numero +
        '\n👛 Sua carteira após a operação: ' + formatarReais(r.novoSaldoRemetente), [destino.canonico])
      // Uma repetição não envia novamente o aviso privado. Falha de entrega
      // não altera a movimentação. Entrega exactly-once não é garantida.
      if (!r.repetida) await enviar(sock, destino.canonico, undefined,
        '💸 *VOCÊ RECEBEU UMA TRANSFERÊNCIA!*\n💰 Valor: ' + formatarReais(r.valor) +
        '\n👤 De: @' + r.remetente.split('@')[0] +
        '\n👛 Carteira após a operação: ' + formatarReais(r.novoSaldoDestinatario), [r.remetente])
    } catch (err) { return enviar(sock, jid, msg, '⚠️ ' + mensagemErro(err)) }
  }
}
