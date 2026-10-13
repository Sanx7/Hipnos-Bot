const { randomBytes, randomUUID, createHash } = require('node:crypto')
const { identificar, identidade } = require('./dados/identidade-participante')
const { ehProprioBot } = require('./dados/protecao-bot')
const { limparNumero } = require('./config')
const { removerDoGrupoConfirmado } = require('./comandos/admin/ban')
const seguro = require('./dados/socket-seguro')
const { criarRepositorio } = require('./dados/nuke-mongo')
const prefixos = require('./prefixo')
const estadoBot = require('./estado-bot')
const hash = valor => createHash('sha256').update(valor).digest('hex')
const PRAZO_MS = 60000
// Compartilhado entre comandos/instâncias no mesmo processo. O MongoDB arbitra
// instâncias em processos diferentes; uma reserva de chamada já admitida é em voo.
const ativos = new Map()

function criarNuke({ repositorio = criarRepositorio(), agora = Date.now,
  esperar = ms => new Promise(resolve => setTimeout(resolve, ms)),
  codigo = () => randomBytes(6).toString('hex'), disponivel = seguro.exclusivoDisponivel,
  remover = removerDoGrupoConfirmado } = {}) {
  function exigir(sock, controle) {
    if (!disponivel(sock)) throw new Error('Conexão ou sessão exclusiva perdida')
    if (controle?.cancelado) throw new Error('Cancelamento solicitado')
    if (controle?.desconectado) throw new Error('A conexão caiu durante a execução')
  }
  function validarIdentidades(meta) {
    if (!Array.isArray(meta?.participants) || !meta.participants.length) throw new Error('Grupo inacessível')
    const aliases = new Map()
    for (const p of meta.participants) {
      if (!/^\d+(?::\d+)?@(?:lid|s\.whatsapp\.net)$/.test(p?.id || '') ||
        (p.phoneNumber && !/^\d+(?::\d+)?@s\.whatsapp\.net$/.test(p.phoneNumber)) ||
        (p.lid && !/^\d+(?::\d+)?(?:@lid)?$/.test(p.lid)) ||
        (p.lid && identidade(p.id).startsWith('lid:') && identidade(p.id) !== identidade(`${String(p.lid).split('@')[0]}@lid`)) ||
        (p.phoneNumber && identidade(p.id).startsWith('pn:') && identidade(p.id) !== identidade(p.phoneNumber))) {
        throw new Error('Identidade JID/LID inconsistente; operação bloqueada')
      }
      for (const alias of [p.id, p.phoneNumber, p.lid && `${limparNumero(p.lid)}@lid`].filter(Boolean)) {
        const chave = identidade(alias)
        if (aliases.has(chave) && aliases.get(chave) !== p) throw new Error('Identidade JID/LID ambígua; operação bloqueada')
        aliases.set(chave, p)
      }
    }
  }
  async function simular(sock, grupo, sender, controle) {
    exigir(sock, controle)
    const meta = await sock.groupMetadata(grupo)
    exigir(sock, controle)
    validarIdentidades(meta)
    const autor = await identificar(meta.participants, sender)
    if (!autor.dono || !autor.admin || !autor.participante || !autor.numero) throw new Error('Somente o dono do bot, administrador deste grupo, pode autorizar')
    const membros = [], numeros = new Set()
    for (const p of meta.participants) {
      const pessoa = await identificar(meta.participants, p.id)
      if (!pessoa.numero || pessoa.participante !== p || numeros.has(pessoa.numero)) throw new Error('Identidade JID/LID ausente ou ambígua; operação bloqueada')
      numeros.add(pessoa.numero)
      const bot = await ehProprioBot(sock, grupo, p.id, meta.participants)
      membros.push({ jid: p.id, numero: pessoa.numero, admin: pessoa.admin,
        protegido: bot || pessoa.dono, bot,
        criador: p.admin === 'superadmin' })
    }
    if (!membros.some(p => p.bot && p.admin)) throw new Error('O bot precisa ser administrador')
    // Identificar o criador também pelo campo owner, sem comparar dígitos PN/LID.
    if (meta.owner) {
      const criador = await identificar(meta.participants, meta.owner)
      if (!criador.numero || !criador.participante) throw new Error('Criador do grupo não identificado')
      for (const p of membros) if (p.numero === criador.numero) p.criador = true
    }
    if (!membros.some(p => p.criador)) throw new Error('Criador do grupo não identificado; operação bloqueada')
    exigir(sock, controle)
    return { meta, membros, autor: autor.numero,
      assinatura: hash(JSON.stringify({ nome: meta.subject, membros: membros.map(p => [p.jid, p.numero, p.admin, p.protegido, p.criador]).sort() })) }
  }
  async function conferirResposta(resultado, alvo, participantes) {
    if (!Array.isArray(resultado) || resultado.length !== 1) return 'desconhecido'
    const retorno = resultado[0].jid
    if (!/^\d+(?::\d+)?@(?:lid|s\.whatsapp\.net)$/.test(retorno || '')) return 'desconhecido'
    const pessoa = await identificar(participantes, retorno)
    if (!pessoa.participante || pessoa.numero !== alvo.numero) return 'desconhecido'
    const status = String(resultado[0].status)
    if (status === '200') return 'confirmado'
    return /^[45]\d\d$/.test(status) && status !== '408' ? 'falha' : 'desconhecido'
  }
  function auditoria(doc, estado, contagem) {
    // Sem lista de participantes, nomes, códigos ou conteúdo de mensagens.
    return { operacao: doc.operacao, grupo: doc._id, data: doc.data,
      atualizadoEm: agora(), responsavel: doc.responsavel, estado,
      rebaixamentos: contagem.rebaixamentos, remocoes: contagem.remocoes,
      falhas: contagem.falhas, desconhecidos: contagem.desconhecidos || 0,
      concluidas: contagem.rebaixamentos + contagem.remocoes }
  }
  async function encerrarPendente(doc, estado) {
    const ok = await repositorio.alterar(doc._id, { operacao: doc.operacao, estado: 'pendente' },
      { estado, codigoHash: null, atualizadoEm: agora() })
    if (ok) await repositorio.registrar(auditoria(doc, estado, { rebaixamentos: 0, remocoes: 0, falhas: 0 }))
    return ok
  }
  async function executarOperacao(sock, grupo, sender, doc, plano, controle) {
    const contagem = { rebaixamentos: 0, remocoes: 0, falhas: 0, desconhecidos: 0 }
    let emVoo = false, iniciou = false
    let final = 'concluida', motivo = '', registroFalhou = false
    const conexao = evento => { if (evento.connection === 'close') controle.desconectado = true }
    sock.ev?.on('connection.update', conexao)
    const validar = async () => {
      exigir(sock, controle)
      const atual = await repositorio.ler(grupo)
      if (atual?.operacao === doc.operacao && atual.cancelar) controle.cancelado = true
      if (atual?.operacao !== doc.operacao || atual.estado !== 'executando' || atual.cancelar) throw new Error('Execução cancelada ou reserva perdida')
      if (atual.habilitado !== true) throw new Error('Nuke desativado neste grupo')
      const novo = await simular(sock, grupo, sender, controle)
      if (novo.autor !== doc.responsavel) throw new Error('Autorização do responsável perdida')
      if (!iniciou && novo.assinatura !== plano.assinatura) throw new Error('O grupo mudou antes da primeira operação; faça uma nova simulação')
      exigir(sock, controle)
      return novo
    }
    try {
      await repositorio.registrar(auditoria(doc, 'executando', contagem))
      // Lotes unitários: resultado atribuído a uma única identidade e intervalo
      // conservador entre chamadas. Não há retries de alterações incertas.
      // Proteções da simulação são permanentes durante esta execução: mudanças
      // posteriores de owner/superadmin nunca tornam o criador original um alvo.
      const alvos = plano.membros.filter(p => !p.protegido && !p.criador)
      for (const acao of ['demote', 'remove']) {
        for (const original of alvos) {
          if (acao === 'demote' && (!original.admin || original.criador)) continue
          const atual = await validar()
          const alvo = atual.membros.find(p => p.numero === original.numero && p.jid === original.jid)
          if (!alvo) continue // Já saiu. Não contar como remoção nossa.
          if (alvo.protegido) throw new Error('Alvo passou a ser protegido')
          if (acao === 'demote' && (!alvo.admin || alvo.criador)) continue
          // WhatsApp protege o criador: não tentar contornar esta restrição.
          if (acao === 'remove' && alvo.criador) continue
          let resultado, enviado = false, respostaRecebida = false, contexto = atual
          const despacho = Object.create(sock)
          despacho.groupParticipantsUpdate = async (jid, ids, operacao) => {
            // Esta é a última barreira, depois de todos os awaits do helper.
            contexto = await validar()
            const recente = contexto.membros.find(p => p.jid === alvo.jid && p.numero === alvo.numero)
            if (!recente || recente.protegido || recente.criador) throw new Error('Alvo não autorizado na revalidação')
            if (operacao === 'demote' && !recente.admin) throw new Error('Privilégios do alvo mudaram')
            const admitido = await repositorio.alterar(grupo,
              { operacao: doc.operacao, estado: 'executando', cancelar: false, emVoo: false, habilitado: true },
              { emVoo: true, atualizadoEm: agora() })
            if (!admitido) {
              await validar()
              throw new Error('Chamada não admitida pela reserva')
            }
            emVoo = true
            exigir(sock, controle)
            enviado = true
            iniciou = true
            const retorno = await sock.groupParticipantsUpdate(jid, ids, operacao)
            resultado = retorno
            respostaRecebida = true
            return retorno
          }
          let erroChamada
          try {
            if (acao === 'remove') await remover(despacho, grupo, alvo.jid, {
              antesRemover: async () => {
                const ultima = await validar()
                const p = ultima.membros.find(p => p.jid === alvo.jid && p.numero === alvo.numero)
                if (!p || p.protegido || p.criador) throw new Error('Alvo não autorizado na revalidação')
                exigir(sock, controle)
              }
            })
            else {
              exigir(sock, controle)
              await despacho.groupParticipantsUpdate(grupo, [alvo.jid], acao)
            }
          } catch (erro) { erroChamada = erro }
          if (!enviado) {
            // Uma barreira antes do envio não é uma operação falhada/desconhecida.
            emVoo = false
            throw erroChamada || new Error('Chamada não enviada')
          }
          const estadoResposta = respostaRecebida ? await conferirResposta(resultado, alvo, contexto.meta.participants) : 'desconhecido'
          if (estadoResposta === 'confirmado') contagem[acao === 'demote' ? 'rebaixamentos' : 'remocoes']++
          else if (estadoResposta === 'falha') contagem.falhas++
          else contagem.desconhecidos++
          // Resultado incerto mantém a reserva bloqueada; nunca repetir/assumir
          // que uma requisição desconhecida já terminou no servidor.
          emVoo = estadoResposta === 'desconhecido'
          await repositorio.registrar(auditoria(doc, 'executando', contagem))
          if (!await repositorio.alterar(grupo, { operacao: doc.operacao, estado: 'executando' },
            { emVoo, ...contagem, atualizadoEm: agora() })) throw new Error('Reserva perdida')
          if (emVoo) throw new Error('Resultado desconhecido; execução interrompida')
          if (erroChamada && seguro.falhaConexao(erroChamada)) throw erroChamada
          exigir(sock, controle)
          await esperar(1500)
        }
      }
      await validar()
    } catch (erro) {
      final = controle.cancelado ? 'cancelada' : 'interrompida'
      motivo = controle.cancelado ? 'Cancelamento solicitado' : 'Uma barreira de segurança ou persistência interrompeu a execução'
    } finally {
      try {
        await repositorio.registrar(auditoria(doc, final, contagem))
        if (!await repositorio.alterar(grupo, { operacao: doc.operacao, estado: 'executando' }, { estado: final, emVoo, ...contagem, atualizadoEm: agora() })) throw new Error('Reserva perdida')
      } catch (_) { registroFalhou = true }
      if (ativos.get(doc.operacao) === controle) ativos.delete(doc.operacao)
      sock.ev?.off('connection.update', conexao)
    }
    await sock.sendMessage(grupo, { text: `Nuke: ${final}.\nRebaixamentos confirmados: ${contagem.rebaixamentos}\nRemoções confirmadas: ${contagem.remocoes}\nFalhas confirmadas: ${contagem.falhas}\nResultados desconhecidos: ${contagem.desconhecidos}\nCriador, bot e donos protegidos preservados.${motivo ? `\n${motivo}.` : ''}${emVoo ? '\nResultado incerto: reserva bloqueada para revisão, sem repetição automática.' : ''}${registroFalhou ? '\nRegistro final indisponível; a reserva exige revisão antes de outra execução.' : ''}` }).catch(() => {})
  }
  return {
    nome: 'nuke', categoria: 'dono', descricao: 'Simula e confirma encerramento do grupo pelo dono administrador.',
    async executar(sock, grupo, msg, text = '') {
      const responder = texto => sock.sendMessage(grupo, { text: texto }, { quoted: msg })
      try {
        if (!grupo.endsWith('@g.us')) return await responder('Nuke funciona somente em grupos.')
        const sender = msg?.key?.participant
        const partes = text.trim().split(/\s+/).slice(1)
        const [acao, token] = partes
        if (['habilitar', 'desabilitar'].includes(acao) && partes.length === 1) {
          exigir(sock)
          const meta = await sock.groupMetadata(grupo)
          validarIdentidades(meta)
          const autor = await identificar(meta.participants, sender)
          if (!autor.dono || !autor.participante || !autor.numero) throw new Error('Somente o dono do bot pode configurar a trava do nuke')
          exigir(sock)
          const habilitado = acao === 'habilitar'
          await repositorio.configurar(grupo, habilitado, agora())
          if (!habilitado) {
            const doc = await repositorio.ler(grupo)
            const local = doc?.cancelar && ativos.get(doc.operacao)
            if (local) local.cancelado = true
            if (doc?.cancelar && doc.estado === 'pendente') await encerrarPendente(doc, 'cancelada')
          }
          return await responder(habilitado
            ? `Nuke habilitado somente neste grupo. Nenhuma alteração no WhatsApp foi realizada. Inicie a simulação com ${await prefixos.obterPrefixo()}nuke.`
            : 'Nuke desativado neste grupo. Confirmações anteriores foram invalidadas; operações já admitidas podem concluir.')
        }
        if (acao === 'cancelar' && partes.length === 1) {
          if (!await estadoBot.remetenteEhDono(sock, grupo, sender)) throw new Error('Somente o dono do bot pode cancelar')
          const responsavel = await estadoBot.obterNumeroDono(sock, grupo, sender)
          const doc = await repositorio.ler(grupo)
          if (!doc || doc.responsavel !== responsavel || !['pendente', 'executando'].includes(doc.estado)) return await responder('Nenhuma operação sua está pendente ou em execução.')
          const local = ativos.get(doc.operacao)
          if (local) local.cancelado = true
          // Arbitrar primeiro cancelar=true contra a confirmação/admissão. Não
          // filtrar pelo estado lido antes: confirmar pode tê-lo mudado.
          const ok = await repositorio.alterar(grupo, { operacao: doc.operacao, responsavel,
            estado: { $in: ['pendente', 'executando'] } }, { cancelar: true })
          if (!ok) throw new Error('Estado mudou; solicite cancelamento novamente')
          await encerrarPendente(doc, 'cancelada')
          return await responder('Cancelamento solicitado. Nenhuma nova chamada será admitida; uma operação já admitida pode concluir. O cancelamento não desfaz alterações.')
        }
        if (acao && (acao !== 'confirmar' || partes.length !== 2)) {
          const prefixo = await prefixos.obterPrefixo()
          return await responder(`Use ${prefixo}nuke habilitar, ${prefixo}nuke desabilitar, ${prefixo}nuke, ${prefixo}nuke confirmar <codigo> ou ${prefixo}nuke cancelar.`)
        }
        // Cancelar e configurar continuam acessíveis quando a trava está fechada.
        // Sem configuração válida ou sem MongoDB, não criar prévia nem executar.
        if ((await repositorio.ler(grupo))?.habilitado !== true) {
          if (!await estadoBot.remetenteEhDono(sock, grupo, sender)) throw new Error('Somente o dono do bot pode usar o nuke')
          return await responder(`Nuke desativado neste grupo. O dono pode habilitar com ${await prefixos.obterPrefixo()}nuke habilitar. Habilitar não executa remoções.`)
        }
        const plano = await simular(sock, grupo, sender)
        if (!acao) {
          const anterior = await repositorio.ler(grupo)
          if (anterior?.estado === 'pendente' && anterior.expiraEm <= agora()) await encerrarPendente(anterior, 'expirada')
          const token = codigo(), operacao = randomUUID()
          const doc = { _id: grupo, operacao, data: agora(), responsavel: plano.autor,
            estado: 'pendente', expiraEm: agora() + PRAZO_MS, codigoHash: hash(token),
            assinatura: plano.assinatura, cancelar: false, emVoo: false, rebaixamentos: 0, remocoes: 0, falhas: 0, desconhecidos: 0 }
          if (!await repositorio.reservar(doc, agora())) return await responder('Já existe uma operação neste grupo. Cancele a pendente ou aguarde a execução.')
          await repositorio.registrar(auditoria(doc, 'pendente', doc))
          const timer = setTimeout(() => {
            encerrarPendente(doc, 'expirada').catch(() => {})
          }, Math.max(0, doc.expiraEm - agora()))
          timer.unref()
          const prefixo = await prefixos.obterPrefixo()
          try {
            await responder(`SIMULAÇÃO OBRIGATÓRIA — nenhuma alteração realizada.\nGrupo: ${plano.meta.subject || '(sem nome)'}\nMembros: ${plano.membros.length}\nAdministradores: ${plano.membros.filter(p => p.admin).length}\nParticipantes afetados: ${plano.membros.filter(p => !p.protegido && !p.criador).length}\nCriador protegido, bot e donos preservados.\n\nAutorize com ${prefixo}nuke confirmar ${token} em 60 segundos.\nCancelar: ${prefixo}nuke cancelar`)
          } catch (erro) {
            await encerrarPendente(doc, 'cancelada')
            throw erro
          }
          return
        }
        const doc = await repositorio.ler(grupo)
        if (!doc || doc.estado !== 'pendente' || doc.responsavel !== plano.autor || doc.codigoHash !== hash(token)) throw new Error('Código inválido, consumido ou pertencente a outro responsável')
        if (agora() >= doc.expiraEm) {
          await encerrarPendente(doc, 'expirada')
          throw new Error('Confirmação expirada; faça uma nova simulação')
        }
        if (plano.assinatura !== doc.assinatura) {
          await encerrarPendente(doc, 'cancelada')
          throw new Error('O grupo mudou; faça uma nova simulação')
        }
        if (!await repositorio.alterar(grupo, { operacao: doc.operacao, estado: 'pendente', responsavel: plano.autor,
          codigoHash: hash(token), cancelar: false, habilitado: true, expiraEm: { $gt: agora() } }, { estado: 'executando', codigoHash: null })) throw new Error('Confirmação já consumida, cancelada, desativada ou expirada')
        // O update pode ter esperado o MongoDB até além do prazo. A comparação
        // do filtro foi criada antes desse await, portanto revalidar o relógio.
        if (agora() >= doc.expiraEm) {
          await repositorio.alterar(grupo, { operacao: doc.operacao, estado: 'executando' },
            { estado: 'expirada', codigoHash: null, atualizadoEm: agora() })
          await repositorio.registrar(auditoria(doc, 'expirada', doc))
          throw new Error('Confirmação expirada durante a reserva; faça uma nova simulação')
        }
        const controle = { cancelado: false }
        ativos.set(doc.operacao, controle)
        await executarOperacao(sock, grupo, sender, doc, plano, controle)
      } catch (erro) {
        // Erros do driver/metadata podem conter dados de conexão: não repassar.
        const mensagem = /^(Conexão ou sessão|A conexão caiu|Cancelamento solicitado|Grupo inacessível|Somente o dono|Identidade JID\/LID|Criador do grupo|O bot precisa|Código inválido|Confirmação |O grupo mudou|Estado mudou)/.test(erro.message)
          ? erro.message : 'Não foi possível validar ou registrar a operação com segurança'
        await responder(`Nuke bloqueado: ${mensagem}`).catch(() => {})
      }
    }
  }
}
module.exports = { criarNuke, PRAZO_MS }
