const { participantesDoContexto } = require('./identidade')
const { prefixoSincrono } = require('../prefixo')
const ERROS = {
  identidade_invalida: 'Não consegui validar a identidade do participante.',
  identidade_nao_comprovada: 'Não consegui comprovar a associação entre LID e telefone. Nenhum cadastro novo foi aberto.',
  identidade_ambigua: 'A identidade está ambígua. A operação foi bloqueada para revisão.',
  cadastros_ambiguos: 'Há fichas conflitantes para essa identidade. Os dados foram preservados; é necessária revisão.',
  legados_pendentes: 'Há registros LID antigos que precisam de diagnóstico antes de abrir novas contas.',
  saldo_incompativel: 'O saldo ou valor não é compatível com centavos e limites seguros. Nenhuma conversão foi feita.',
  limite_financeiro: 'A operação excede o limite financeiro seguro.',
  transacao_indisponivel: 'Este MongoDB não oferece transações disponíveis para o RPG. A movimentação foi recusada.',
  resultado_pendente: 'Não foi possível confirmar o resultado financeiro. Não repita com outra mensagem: consulte seus saldos e peça revisão da operação.',
  operacao_conflitante: 'Esta mensagem já está associada a outra operação. Nenhuma nova movimentação foi feita.',
  operacao_invalida: 'A mensagem não tem identificação suficiente para uma operação financeira segura.',
  saldo_insuficiente: 'Saldo insuficiente na conta de origem.',
  concorrencia_recusada: 'Esta operação foi recusada por conflito com outra movimentação. Nenhum saldo foi movimentado por esta mensagem.',
  mesmo_jogador: 'Você não pode transferir dinheiro para si mesmo.',
  jogador_ausente: 'Não encontrei o jogador para concluir a operação.',
  valor_invalido: 'Valor inválido. Use um valor positivo com até duas casas decimais.',
  campos_protegidos: 'Esta atualização contém campos protegidos.'
}
function mensagemErro(err) {
  return ERROS[typeof err === 'string' ? err : err?.codigo] || 'O RPG está indisponível no momento. Seus dados não foram convertidos ou mesclados.'
}
function comPrefixo(texto) {
  return texto.replace(/\/(registrar|ficha|carteira|depositar|sacar|transferir|testrpg)\b/g,
    (_, nome) => prefixoSincrono() + nome)
}
async function enviar(sock, jid, msg, texto, mentions) {
  try {
    await sock.sendMessage(jid, { text: comPrefixo(texto), ...(mentions ? { mentions } : {}) },
      msg ? { quoted: msg } : undefined)
    return true
  } catch { console.warn('[rpg] confirmação não entregue'); return false }
}
async function contexto(sock, jid, msg) {
  return { sender: msg.key?.participant || msg.key?.remoteJid, chat: jid,
    mensagem: msg.key?.id, participantes: await participantesDoContexto(sock, jid) }
}
function comandoMovimento(nome, aliases) {
  const { parseValor, moverSaldo, formatarReais } = require('./economia')
  return {
    nome, aliases, descricao: nome === 'depositar' ? 'Deposita dinheiro da carteira no banco.' : 'Saca dinheiro do banco para a carteira.',
    async executar(sock, jid, msg, texto) {
      const args = String(texto || '').trim().split(/\s+/).slice(1)
      if (args.length !== 1) return enviar(sock, jid, msg, '💰 *Como usar:*\n/' + nome + ' <valor|todos>\nEx.: /' + nome + ' 1.234,56')
      const valor = parseValor(args[0])
      if (valor === null) return enviar(sock, jid, msg, '🚫 ' + mensagemErro('valor_invalido'))
      try {
        const ctx = await contexto(sock, jid, msg)
        const r = await moverSaldo(ctx.sender, valor, nome, ctx)
        if (!r.ok) return enviar(sock, jid, msg, '⚠️ ' + mensagemErro(r.motivo))
        return enviar(sock, jid, msg, (nome === 'depositar' ? '🏦 *DEPÓSITO CONFIRMADO*' : '💵 *SAQUE CONFIRMADO*') +
          (r.repetida ? ' (já processado)' : '') + '\n💰 Valor: ' + formatarReais(r.valor) +
          '\n👛 Carteira após a operação: ' + formatarReais(r.saldoCarteira) +
          '\n🏦 Banco após a operação: ' + formatarReais(r.saldoBanco))
      } catch (err) { return enviar(sock, jid, msg, '⚠️ ' + mensagemErro(err)) }
    }
  }
}
module.exports = { enviar, contexto, mensagemErro, comPrefixo, comandoMovimento }
