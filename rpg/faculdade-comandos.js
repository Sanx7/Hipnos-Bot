const db = require('./database')
const fac = require('./faculdade')
const cat = require('./faculdades-catalogo')
const empregos = require('./empregos-catalogo')
const { enviar, contexto, mensagemErro } = require('./comandos')
function linhasAcademicas(p) {
  const a = fac.dadosAcademicos(p), m = a.matricula
  return '\n🎓 Escolaridade: ' + (a.diplomas.length ? 'Graduação concluída' : 'Sem graduação comprovada') +
    '\n📜 Diplomas: ' + a.diplomas.length +
    (m ? '\n📚 Curso: ' + cat.cursoPorId(m.cursoId).nome + ' • ' + m.status + ' • ' + m.sessoesConcluidas + '/' + m.totalSessoes + ' sessões' : '') +
    (p.escolaridade?.faculdade ? '\nℹ️ Registro acadêmico antigo preservado; sem conversão automática em diploma.' : '')
}
function criarComando(nome) {
  return { nome, descricao: 'Faculdade gratuita do RPG: ' + nome + '.',
    async executar(sock, jid, msg, texto) {
      const args = String(texto || '').trim().split(/\s+/).slice(1)
      if (nome === 'matricular' ? !args.length : args.length) return enviar(sock, jid, msg, nome === 'matricular' ? 'Uso: /matricular <id ou nome do curso>. Consulte /faculdades.' : 'Uso: /' + nome)
      try {
        if (nome === 'faculdades') {
          const cursos = cat.CURSOS.map(c => '🎓 ' + c.nome + ' — ' + c.sessoes + ' sessões\nID: ' + c.id + '\nProfissões: ' +
            c.carreiras.flatMap(id => empregos.carreiraPorId(id).cargos.filter(g => g.exigeFaculdade).map(g => g.nome)).join(', '))
          return enviar(sock, jid, msg, '🏛️ *FACULDADES GRATUITAS*\nSem matrícula, mensalidade, material ou diploma pagos.\n1 sessão por hora • 10 de energia por sessão.\nDurações fictícias para o jogo.\n\n' + cursos.join('\n\n') + '\n\nUse /matricular <curso>. Carreiras de nível 3 continuam exigindo 1.500 XP profissional.')
        }
        const ctx = await contexto(sock, jid, msg)
        if (nome === 'faculdade' || nome === 'diplomas') {
          const p = await db.getPlayer(ctx.sender, ctx.participantes), a = fac.dadosAcademicos(p)
          if (nome === 'diplomas') return enviar(sock, jid, msg, '📜 *SEUS DIPLOMAS*\n' +
            (a.diplomas.length ? a.diplomas.map(d => cat.cursoPorId(d.cursoId).nome + ' • ' + new Date(d.concluidaEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })).join('\n') : 'Nenhum diploma conquistado. Consulte /faculdades.'))
          const m = a.matricula
          let previsao = ''
          if (m) {
            const restantes = m.totalSessoes - m.sessoesConcluidas
            const espera = Math.max(0, (p.cooldowns?.estudar ?? 0) + cat.COOLDOWN_ESTUDO_MS - Date.now())
            previsao = '\nSessões restantes: ' + restantes + '\n' + (m.status === 'trancada' ? 'Previsão suspensa até /retomar.' :
              'Tempo mínimo até concluir: ' + Math.ceil((espera + (restantes - 1) * cat.COOLDOWN_ESTUDO_MS) / 60000) + ' minutos, com energia e estudo pontual.')
          }
          return enviar(sock, jid, msg, '🏛️ *SUA FACULDADE*' + linhasAcademicas(p) + previsao + '\nUse /estudar • /trancar • /retomar • /diplomas.')
        }
        let r
        if (nome === 'matricular') {
          const curso = cat.resolverCurso(args.join(' '))
          if (!curso) return enviar(sock, jid, msg, mensagemErro('curso_invalido'))
          r = await fac.matricular(ctx.sender, curso.id, ctx)
        } else r = await fac[nome](ctx.sender, ctx)
        if (!r.ok) return enviar(sock, jid, msg, r.motivo === 'resultado_pendente' ?
          '⚠️ Resultado acadêmico pendente. Não repita com outra mensagem; consulte /faculdade e peça revisão da operação.' : mensagemErro(r.motivo))
        const detalhe = r.diploma ? '🎓 Graduação concluída: ' + cat.cursoPorId(r.diploma.cursoId).nome + '. Diploma permanente emitido!' :
          cat.cursoPorId(r.matricula.cursoId).nome + ' • ' + r.matricula.status + ' • ' + r.matricula.sessoesConcluidas + '/' + r.matricula.totalSessoes + ' sessões.'
        return enviar(sock, jid, msg, '🏛️ *FACULDADE*\n' + detalhe + '\nNenhum dinheiro foi cobrado.' +
          (nome === 'estudar' ? '\nEnergia após a sessão: ' + r.energia : '') + (r.repetida ? '\nMensagem já processada; nenhum progresso foi repetido.' : ''))
      } catch (err) { return enviar(sock, jid, msg, mensagemErro(err)) }
    }
  }
}
module.exports = { criarComando, linhasAcademicas }
