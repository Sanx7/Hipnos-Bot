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
  campos_protegidos: 'Esta atualização contém campos protegidos.',
  registro_obrigatorio: 'Registre seu personagem com /registrar <nome> <M ou F> antes de escolher uma carreira.',
  carreira_invalida: 'Carreira inválida. Consulte /empregos.',
  progressao_insuficiente: 'Você ainda não tem o XP profissional total necessário para esta carreira.',
  faculdade_obrigatoria: 'Este cargo exige o diploma comprovado do curso correspondente. Consulte /faculdades; outros cursos não substituem esse diploma.',
  academico_incompativel: 'Seu histórico acadêmico precisa de revisão. Os dados foram preservados, sem conversões ou diplomas retroativos.',
  curso_invalido: 'Curso inexistente. Consulte /faculdades e use /matricular <id ou nome>.',
  matricula_existente: 'Você já tem uma matrícula, ativa ou trancada. Conclua esse curso antes de iniciar outro.',
  diploma_existente: 'Você já concluiu esse curso. O diploma é permanente e não será emitido novamente.',
  sem_matricula: 'Você não tem matrícula atual. Consulte /faculdades e use /matricular <curso>.',
  estado_matricula: 'A matrícula já está nesse estado. Consulte /faculdade.',
  matricula_trancada: 'Sua matrícula está trancada. Use /retomar para continuar sem perder progresso.',
  estudo_cooldown: 'Aguarde uma hora entre sessões de estudo. Trancar e retomar não reinicia esse prazo.',
  emprego_legado_pendente: 'Seu emprego antigo não pôde ser associado com segurança ao catálogo. Os dados foram preservados para revisão.',
  progresso_incompativel: 'Os dados profissionais precisam de revisão. Nenhum saldo ou progresso foi convertido.',
  confirmacao_troca: 'Você já tem um emprego. Para trocar explicitamente, use /carreira <id> confirmar. O emprego anterior será preservado no histórico.',
  ja_contratado: 'Você já está nessa carreira. Consulte /carreira.',
  sem_emprego: 'Escolha uma carreira com /carreira <id>. Consulte /empregos.',
  sem_promocao: 'Esta carreira não tem outra promoção interna.',
  xp_promocao_insuficiente: 'Ainda falta XP da carreira atual para a próxima promoção. Consulte /carreira.',
  jornada_cooldown: 'Você já cumpriu uma jornada. Aguarde uma hora entre jornadas; trocar de carreira não libera outra jornada.',
  energia_insuficiente: 'Você precisa de 10 pontos de energia para essa atividade. A recuperação é de 1 ponto a cada 6 minutos.',
  energia_sem_referencia: 'Seu emprego antigo está com energia insuficiente e sem uma referência de recuperação. Os dados foram preservados para revisão.',
  jogador_preso: 'Seu personagem está preso e não pode cumprir esta jornada.'
}
function mensagemErro(err) {
  return ERROS[typeof err === 'string' ? err : err?.codigo] || 'O RPG está indisponível no momento. Seus dados não foram convertidos ou mesclados.'
}
function comPrefixo(texto) {
  return texto.replace(/\/(registrar|ficha|carteira|depositar|sacar|transferir|testrpg|empregos|carreira|trabalhar|faculdades|matricular|estudar|faculdade|diplomas|trancar|retomar)\b/g,
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
