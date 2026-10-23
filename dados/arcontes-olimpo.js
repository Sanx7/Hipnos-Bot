const { createHash, randomUUID } = require('node:crypto')
const { identificar, extrairAlvo } = require('./advertencias-contexto')
const { ehProprioBot, respostaAutoexpulsao } = require('./protecao-bot')
const seguro = require('./socket-seguro')
const { removerDoGrupoConfirmado } = require('../comandos/admin/ban')
const { criarRepositorio } = require('./arcontes-olimpo-mongo')
const { criarApresentacaoHistorico, textoSeguro, AJUDA } = require('./arcontes-historico-ui')
// Compartilhado por todos os serviços deste processo: não revisar uma chamada ainda em voo.
const instancia = randomUUID(), ativas = new Set()
function negar(texto) { throw Object.assign(new Error('ARCONTES_BLOQUEADO'), { resposta: texto }) }
const INCOMPLETA = 'Operação não concluída ou não confirmada. Não houve nova tentativa automática; solicite revisão ao dono.'

function criarServico(repo = criarRepositorio(), { disponivel = seguro.exclusivoDisponivel, agora = Date.now } = {}) {
  const cooldown = new Map()
  const apresentacao = criarApresentacaoHistorico({ agora })
  function exigir(sock) {
    if (!disponivel(sock)) negar('Conexão ou exclusividade da sessão indisponível. Nenhuma nova remoção autorizada.')
  }
  async function adquirir(grupo, token, operacao) {
    ativas.add(token)
    try {
      const ok = await repo.travar(grupo, token, operacao, instancia)
      if (!ok) ativas.delete(token)
      return ok
    } catch (erro) { ativas.delete(token); throw erro }
  }
  async function contexto(sock, grupo, sender, permitirDonoAusente = false) {
    const meta = await sock.groupMetadata(grupo)
    if (!Array.isArray(meta?.participants)) negar('Não foi possível comprovar os participantes do grupo.')
    const autor = await identificar(meta.participants, sender)
    if (!autor.numero || (!autor.participante && !(permitirDonoAusente && autor.dono))) negar('Identidade ou participação do responsável não comprovada.')
    const criador = meta.owner ? await identificar(meta.participants, meta.owner) : null
    if (meta.owner && !criador?.numero) negar('Identidade do proprietário do grupo não comprovada.')
    return { meta, autor, admin: autor.admin || criador?.numero === autor.numero, criador }
  }
  async function gestor(sock, grupo, sender, permitirDonoAusente = false) {
    const c = await contexto(sock, grupo, sender, permitirDonoAusente)
    if (!c.admin && !c.autor.dono) negar('Apenas administradores reais do grupo e o dono do Hipnos podem usar este comando.')
    return c
  }
  const gestorHistorico = (sock, grupo, sender) => gestor(sock, grupo, sender, true)
  async function alvoComum(sock, grupo, jid, c) {
    if (await ehProprioBot(sock, grupo, jid, c.meta.participants)) negar(respostaAutoexpulsao())
    const alvo = await identificar(c.meta.participants, jid)
    if (!alvo.numero || !alvo.participante) negar('Alvo não identificado ou não presente no grupo.')
    if (alvo.admin || alvo.dono || c.criador?.numero === alvo.numero) negar('Administradores e donos são protegidos.')
    return alvo
  }
  async function autorizarKick(sock, grupo, sender, alvoJid) {
    const c = await contexto(sock, grupo, sender)
    const alvo = await alvoComum(sock, grupo, alvoJid, c)
    if (alvo.numero === c.autor.numero) negar('Você não pode se remover.')
    if (!c.admin) {
      // Dono sem ADM não ganha autorização nova por meio da patente.
      if (c.autor.dono || !await repo.ativo(grupo, c.autor.numero)) negar('Apenas administradores ou Arcontes deste grupo podem usar /kick.')
      if (await repo.ativo(grupo, alvo.numero)) negar('Arcontes não podem remover outros Arcontes.')
    }
    let botAdmin = false
    for (const p of c.meta.participants.filter(p => ['admin', 'superadmin'].includes(p.admin))) {
      if (await ehProprioBot(sock, grupo, p.id, c.meta.participants)) { botAdmin = true; break }
    }
    if (!botAdmin) negar('O bot precisa ser administrador do grupo para remover participantes.')
    return { ...c, alvo, funcao: c.admin ? (c.autor.dono ? 'dono' : 'administrador') : 'arconte' }
  }
  async function podeKickRestrito(sock, grupo, sender) {
    try {
      exigir(sock)
      const c = await contexto(sock, grupo, sender)
      return !c.autor.dono && !c.admin && await repo.ativo(grupo, c.autor.numero)
    } catch (_) { return false }
  }
  function chave(grupo, numero, msg, privado = false) {
    const origemValida = privado ? /^\d+(?::\d+)?@(?:lid|s\.whatsapp\.net)$/.test(msg?.key?.remoteJid || '') :
      msg?.key?.remoteJid === grupo && Boolean(msg.key.participant)
    if (!msg?.key?.id || !origemValida || msg.key.fromMe) negar('Mensagem sem identificação segura; operação recusada.')
    return createHash('sha256').update(JSON.stringify([grupo, numero, msg.key.id])).digest('hex')
  }
  async function conferir(resultado, alvo, participantes) {
    if (!Array.isArray(resultado) || resultado.length !== 1) return 'incerta'
    const retorno = resultado[0]
    if (!/^\d+(?::\d+)?@(?:lid|s\.whatsapp\.net)$/.test(retorno?.jid || '')) return 'incerta'
    const pessoa = await identificar(participantes, retorno.jid)
    if (!pessoa.participante || pessoa.numero !== alvo.numero) return 'incerta'
    if (String(retorno.status) === '200') return 'confirmada'
    return ['400', '401', '403', '404', '405', '406', '409', '410', '429'].includes(String(retorno.status)) ? 'recusada' : 'incerta'
  }
  function motivoDe(texto) {
    return String(texto || '').trim().split(/\s+/).slice(1).filter(p => !/^@\S+$/.test(p))
      .join(' ').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500) || null
  }
  async function kick(sock, grupo, msg, texto, responder) {
    const sender = msg?.key?.participant, alvoJid = extrairAlvo(msg)
    if (!alvoJid) negar('Marque uma pessoa ou responda à mensagem dela para usar /kick.')
    let c = await contexto(sock, grupo, sender)
    // Mantém a resposta de proteção do bot sem depender do MongoDB.
    await alvoComum(sock, grupo, alvoJid, c)
    exigir(sock)
    c = await autorizarKick(sock, grupo, sender, alvoJid)
    const id = chave(grupo, c.autor.numero, msg), token = randomUUID(), ck = `${grupo}:${c.autor.numero}`
    for (const [key, expira] of cooldown) if (expira <= agora()) cooldown.delete(key)
    if (cooldown.has(ck)) negar('Aguarde alguns segundos antes de usar novamente.')
    if (!await repo.reservar({ _id: id, grupo, tipo: 'kick', responsavel: c.autor.numero,
      responsavelTipo: c.funcao, alvo: c.alvo.numero, motivo: motivoDe(texto) })) {
      return responder('Esta mensagem já foi registrada. Nenhuma remoção será repetida.')
    }
    if (!await adquirir(grupo, token, id)) {
      await repo.concluir(id, 'bloqueada')
      negar('Há outra operação ou resultado incerto neste grupo. Nenhuma remoção foi iniciada.')
    }
    let enviado = false, retorno, estado = 'cancelada', persistido = false, atual = c
    try {
      const validar = async () => {
        exigir(sock)
        if (!await repo.travaValida(grupo, token)) negar('Reserva da operação perdida.')
        const recente = await autorizarKick(sock, grupo, sender, alvoJid)
        if (recente.autor.numero !== c.autor.numero || recente.alvo.numero !== c.alvo.numero ||
            recente.alvo.participante.id !== c.alvo.participante.id) negar('A identidade mudou antes da remoção.')
        exigir(sock)
        atual = recente
      }
      // A última validação acontece dentro do despacho, após os awaits do helper.
      const despacho = Object.create(sock)
      despacho.groupParticipantsUpdate = async (...args) => {
        await validar()
        await repo.enviando(id, atual.funcao)
        const funcaoRegistrada = atual.funcao
        await validar()
        if (atual.funcao !== funcaoRegistrada) negar('Permissões mudaram antes da remoção. Use uma nova mensagem.')
        exigir(sock)
        enviado = true
        cooldown.set(ck, agora() + 4000)
        retorno = await sock.groupParticipantsUpdate(...args)
        return retorno
      }
      try { await removerDoGrupoConfirmado(despacho, grupo, c.alvo.participante.id) }
      catch (_) { /* Só a resposta observada decide o resultado; não imprimir erros brutos. */ }
      estado = enviado ? await conferir(retorno, c.alvo, atual.meta.participants) : 'cancelada'
      await repo.concluir(id, estado)
      persistido = true
    } finally {
      // Escrita incerta ou remoção inconclusiva mantém a trava, inclusive após reinício.
      try { if (persistido && estado !== 'incerta') await repo.soltar(grupo, token) }
      finally { ativas.delete(token) }
    }
    if (estado !== 'confirmada') return responder(INCOMPLETA)
    return responder('Participante removido. Expulsão confirmada e registrada no histórico.')
  }
  async function patente(acao, sock, grupo, msg, responder) {
    const sender = msg?.key?.participant, c = await gestor(sock, grupo, sender), jid = extrairAlvo(msg)
    if (!jid) negar('Marque uma pessoa ou responda à mensagem dela.')
    const alvo = acao === 'arconte' ? await alvoComum(sock, grupo, jid, c) : await identificar(c.meta.participants, jid)
    if (!alvo.numero || (acao === 'arconte' && !alvo.participante)) negar('Alvo não identificado ou não presente no grupo.')
    exigir(sock)
    const id = chave(grupo, c.autor.numero, msg), token = randomUUID()
    if (!await repo.reservar({ _id: id, tipo: acao, grupo, responsavel: c.autor.numero, alvo: alvo.numero })) {
      return responder('Esta mensagem já foi registrada. Use uma nova mensagem para outra alteração.')
    }
    if (!await adquirir(grupo, token, id)) {
      await repo.concluir(id, 'bloqueada')
      negar('Há outra operação ou resultado incerto neste grupo. Patente não alterada.')
    }
    let seguroSoltar = false, escreveu = false
    try {
      const recente = await gestor(sock, grupo, sender)
      const pessoa = acao === 'arconte' ? await alvoComum(sock, grupo, jid, recente) : await identificar(recente.meta.participants, jid)
      if ((acao === 'arconte' && !pessoa.participante) || pessoa.numero !== alvo.numero || recente.autor.numero !== c.autor.numero) negar('Identidade mudou durante a operação.')
      if (!await repo.travaValida(grupo, token)) negar('Reserva da operação perdida.')
      exigir(sock)
      escreveu = true
      await repo.definir(grupo, alvo.numero, acao === 'arconte', c.autor.numero, id)
      await repo.concluir(id, 'concluida')
      seguroSoltar = true
    } catch (erro) {
      if (!escreveu) { await repo.concluir(id, 'cancelada'); seguroSoltar = true }
      throw erro
    } finally {
      try { if (seguroSoltar) await repo.soltar(grupo, token) }
      finally { ativas.delete(token) }
    }
    return responder(acao === 'arconte' ? 'Arconte nomeado somente neste grupo.' : 'Patente removida. O histórico foi preservado.')
  }
  async function resolver(sock, grupo, sender, msg, args, privado) {
    const [operacao, confirmacao, ...partes] = args
    const motivo = partes.join(' ').trim()
    if (!/^[a-f0-9]{64}$/.test(operacao || '') || confirmacao !== 'CONFIRMO' || motivo.length < 10 || motivo.length > 500 ||
        /[\u0000-\u001f\u007f]/.test(motivo)) negar('Use resolver referência CONFIRMO motivo de revisão (10 a 500 caracteres).')
    exigir(sock)
    const autor = await gestorHistorico(sock, grupo, sender)
    const controle = await repo.controle(grupo), op = await repo.operacao(grupo, operacao)
    if (!op || !controle?.ocupado || controle.operacao !== operacao || !controle.token || !controle.instancia) {
      negar('Nenhuma trava vinculada a essa expulsão. Controle antigo sem vínculo seguro não pode ser liberado por este comando.')
    }
    if (ativas.has(controle.token)) negar('Operação ainda em execução neste processo. Aguarde seu término; não é seguro liberar agora.')
    const id = chave(grupo, autor.autor.numero, msg, privado)
    ativas.add(controle.token)
    try {
      const recente = await gestorHistorico(sock, grupo, sender)
      if (recente.autor.numero !== autor.autor.numero) negar('Identidade do revisor mudou.')
      exigir(sock)
      if (!await repo.reservar({ _id: id, tipo: 'revisao', grupo, operacao,
        tokenControle: controle.token, revisaoAnterior: controle.revisaoId || null,
        responsavel: autor.autor.numero, responsavelTipo: recente.autor.dono ? 'dono' : 'administrador',
        estadoOperacao: op.estado, alvo: op.alvo, motivo })) {
        negar('Esta mensagem de revisão já foi registrada. Consulte a operação; ela não será reaplicada.')
      }
      // Congela o token antigo antes de auditar/liberar. Um despacho atrasado perde a reserva.
      await repo.bloquearRevisao(controle, id)
      await repo.registrarRevisao(id, 'autorizada')
      const final = await gestorHistorico(sock, grupo, sender)
      if (final.autor.numero !== autor.autor.numero) negar('Identidade do revisor mudou.')
      exigir(sock)
      await repo.liberarRevisada(grupo, controle.token, operacao, id)
      await repo.registrarRevisao(id, 'liberada')
      return `Trava liberada após revisão explícita. Revisão registrada na auditoria.\nO estado original (${textoSeguro(op.estado)}) foi preservado. Nenhuma expulsão foi repetida ou confirmada pela revisão.`
    } finally { ativas.delete(controle.token) }
  }
  async function consultarHistorico(sock, origem, msg, texto, responder) {
    const entrada = String(texto).trim().replace(/^\S+\s*/, '')
    const privado = !origem.endsWith('@g.us')
    const sender = privado ? origem : msg?.key?.participant
    if (msg?.key?.remoteJid !== origem || msg.key.fromMe) negar('Origem da consulta não comprovada.')
    if (privado && !/^\d+(?::\d+)?@(?:lid|s\.whatsapp\.net)$/.test(origem)) negar('Origem da consulta não comprovada.')
    const invocacao = String(texto).trim().split(/\s+/)[0]
    const base = /^[^\s]{1,8}historicoarconte$/i.test(invocacao) && textoSeguro(invocacao) === invocacao ? invocacao : '/historicoarconte'
    const selecionarGrupo = /^grupo(?:\s|$)/i.test(entrada)
    if (privado && !selecionarGrupo) negar(`No privado, use o nome do grupo. ${AJUDA}`)
    const selecionado = selecionarGrupo ? await apresentacao.selecionar(sock, entrada.replace(/^grupo\s*/i, ''),
      grupo => gestorHistorico(sock, grupo, sender)) : { grupo: origem, args: entrada.split(/\s+/).filter(Boolean) }
    if (selecionado.escolhas) {
      const opcoes = []
      let destinatario, vistaOpcoes
      for (const [indice, escolha] of selecionado.escolhas.entries()) {
        const recente = await gestorHistorico(sock, escolha.grupo, sender)
        if (recente.autor.numero !== escolha.c.autor.numero || (destinatario && destinatario !== recente.autor.numero)) negar('Identidade do solicitante mudou durante a consulta.')
        destinatario = recente.autor.numero
        const v = apresentacao.vista(sock, escolha.grupo, recente)
        vistaOpcoes ||= v
        opcoes.push(`${indice + 1}. ${v.nomeGrupo} — ${recente.meta.participants.length} participantes\nConsultar: ${base} grupo ${v.grupoRef}`)
      }
      for (const parte of vistaOpcoes.montar('🔎 *GRUPOS HOMÔNIMOS*', null, ['Escolha um dos grupos autorizados com o mesmo nome:', ...opcoes])) {
        for (const escolha of selecionado.escolhas) {
          const atual = await gestorHistorico(sock, escolha.grupo, sender)
          if (atual.autor.numero !== destinatario) negar('Identidade do solicitante mudou durante a consulta.')
        }
        await sock.sendMessage(`${destinatario}@s.whatsapp.net`, { text: parte })
      }
      if (!privado) return responder('Opções dos grupos enviadas no privado.')
      return
    }
    const { grupo, args } = selecionado
    const solicitante = selecionado.c || await gestorHistorico(sock, grupo, sender)
    const vista = apresentacao.vista(sock, grupo, solicitante)
    const comandoPrivado = await vista.comando(base, selecionado)
    const atalhos = `⚖️ *Operações pendentes:* ${comandoPrivado} pendentes\n📚 *Auditoria:* ${comandoPrivado} revisoes`
    let titulo, paginaAtual, blocos, rodape = atalhos
    if (args[0] === 'resolver') {
      args[1] = vista.operacao(args[1])
      titulo = '⚖️ *REVISÃO DA OPERAÇÃO*'
      blocos = [await resolver(sock, grupo, sender, msg, args.slice(1), privado)]
    } else if (args[0] === 'pendentes' && args.length === 1) {
      const controle = await repo.controle(grupo)
      const op = controle?.ocupado && controle.operacao ? await repo.operacao(grupo, controle.operacao) : null
      titulo = '⚖️ *OPERAÇÕES PENDENTES*'
      blocos = [!controle?.ocupado ? 'Grupo sem trava ativa.' : op ?
        `${await vista.resumo(op)}\n\n${ativas.has(controle.token) ? 'Chamada ainda em execução; liberação recusada.' : 'Trava aguardando revisão autorizada.'}\n` +
        `Consulte ${comandoPrivado} operacao ${vista.refOperacao(op._id)}\nApós revisar: ${comandoPrivado} resolver ${vista.refOperacao(op._id)} CONFIRMO motivo_da_revisão\n` +
        'A ausência do participante não comprova expulsão. A liberação preserva o resultado original.' :
        'Trava sem vínculo seguro com uma expulsão (ou referente a patente). Liberação recusada; exige análise específica, sem apagar registros.']
    } else if (args[0] === 'operacao' && args.length === 2) {
      const op = await repo.operacao(grupo, vista.operacao(args[1]))
      if (!op) negar('Expulsão não encontrada neste grupo.')
      const revisoes = await repo.revisoes(grupo, op._id)
      titulo = '🔎 *DETALHES DA OPERAÇÃO*'
      blocos = [await vista.resumo(op), '📚 *Revisões permanentes* (até 20 mais recentes):',
        ...(revisoes.length ? await Promise.all(revisoes.map(r => vista.revisao(r))) : ['Nenhuma revisão.'])]
    } else if (args[0] === 'revisoes' && args.length <= 2 && (!args[1] || /^[1-9]\d{0,3}$/.test(args[1]))) {
      const pagina = Number(args[1] || 1), revisoes = await repo.listarRevisoes(grupo, pagina)
      titulo = '📚 *AUDITORIA DE REVISÕES*'; paginaAtual = pagina
      blocos = revisoes.length ? await Promise.all(revisoes.map(r => vista.revisao(r, true))) : ['Nenhuma revisão.']
      rodape = `🔮 *Próxima página:* ${comandoPrivado} revisoes ${pagina + 1}\n${atalhos}`
    } else {
      if (args.length > 1 || (args[0] && !/^[1-9]\d{0,3}$/.test(args[0]))) {
        negar(AJUDA)
      }
      const pagina = Number(args[0] || 1), lista = await repo.historico(grupo, pagina)
      titulo = '⚔️ *EXPULSÕES CONFIRMADAS*'; paginaAtual = pagina
      blocos = lista.length ? await Promise.all(lista.map(p => vista.expulsao(p))) : ['Nenhuma expulsão confirmada nesta página.']
      rodape = `🔮 *Próxima página:* ${comandoPrivado} ${pagina + 1}\n${atalhos}`
    }
    for (const parte of vista.montar(titulo, paginaAtual, blocos, rodape)) {
      // Também revalida cada parte de uma resposta longa. Nunca enviar ao grupo.
      const recente = await gestorHistorico(sock, grupo, sender)
      if (recente.autor.numero !== solicitante.autor.numero) negar('Identidade do solicitante mudou durante a consulta.')
      await sock.sendMessage(`${recente.autor.numero}@s.whatsapp.net`, { text: parte })
    }
    if (!privado) return responder('Consulta do histórico enviada no privado.')
  }
  async function executar(acao, sock, grupo, msg, texto = '') {
    // Não citar comandos de histórico: o texto original pode conter IDs internos.
    const responder = text => acao === 'historicoarconte' ? sock.sendMessage(grupo, { text: textoSeguro(text, INCOMPLETA, 2000) }) : sock.sendMessage(grupo, { text }, { quoted: msg })
    try {
      if (acao === 'historicoarconte') return await consultarHistorico(sock, grupo, msg, texto, responder)
      if (!String(grupo).endsWith('@g.us')) negar('Este comando funciona somente em grupos.')
      if (acao === 'kick') return await kick(sock, grupo, msg, texto, responder)
      if (['arconte', 'removerarconte'].includes(acao)) return await patente(acao, sock, grupo, msg, responder)
      await gestor(sock, grupo, msg?.key?.participant)
      if (acao === 'listaarcontes') {
        const lista = await repo.listar(grupo)
        await gestor(sock, grupo, msg?.key?.participant)
        return await responder(lista.length ? `Arcontes deste grupo (até 100):\n${lista.map(p => p.numero).join('\n')}` : 'Nenhum Arconte nomeado neste grupo.')
      }
      negar('Comando desconhecido.')
    } catch (erro) {
      console.warn('[arcontes] Operação bloqueada ou incompleta; sem repetição automática.')
      return responder(erro?.resposta || INCOMPLETA).catch(() => {})
    }
  }
  return { executar, podeKickRestrito }
}
let servico = criarServico()
module.exports = { criarServico, executar: (...args) => servico.executar(...args),
  podeKickRestrito: (...args) => servico.podeKickRestrito(...args),
  __definirServicoTeste(novo) { servico = novo || criarServico() } }
