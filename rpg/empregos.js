const db = require('./database')
const eco = require('./economia')
const { resolverIdentidade, erro } = require('./identidade')
const catalogo = require('./empregos-catalogo')
let agora = () => Date.now()
const { inteiro, consumirEnergia } = require('./energia')
const { diplomaComprovado } = require('./faculdade')
const { cursoDaCarreira } = require('./faculdades-catalogo')
function empregoAtual(p) {
  if (!p.emprego) return null
  const cargo = inteiro(p.cargo, 1)
  const candidatos = catalogo.CARREIRAS.filter(c => c.id === p.emprego ||
    c.cargos[0].nome === p.emprego || c.cargos.some(g => g.nome === p.emprego && g.numero === cargo))
  if (candidatos.length !== 1 || !candidatos[0].cargos[cargo - 1]) throw erro('emprego_legado_pendente')
  return { carreira: candidatos[0], cargo: candidatos[0].cargos[cargo - 1] }
}
async function requisitos(p, carreira, cargo, operacoes, session, canonico) {
  if (inteiro(p.xpTierTotal) < carreira.xpTotalMinimo) throw erro('progressao_insuficiente')
  if (cargo.exigeFaculdade) {
    const curso = cursoDaCarreira(carreira.id)
    if (!curso || !await diplomaComprovado(p, curso.id, operacoes, session, canonico, agora())) throw erro('faculdade_obrigatoria')
  }
}
async function acaoProfissional(jid, tipo, pedido, contexto) {
  let id, identidade, fingerprint
  try {
    identidade = await resolverIdentidade(jid, contexto?.participantes || [])
    id = eco.identidadeOperacao(contexto, identidade)
    fingerprint = eco.hash(JSON.stringify([tipo, identidade.canonico, pedido]))
  } catch (err) { return { ok: false, motivo: err.codigo || 'operacao_invalida' } }
  return eco.executarOperacaoAuditada({ remetente: identidade, id, fingerprint, tipo }, async (col, session, operacoes) => {
    const opcoes = { session }
    const p = await db.obterJogador(col, identidade, opcoes)
    if (!p) throw erro('jogador_ausente')
    if (!p.nome) throw erro('registro_obrigatorio')
    const tempo = agora()
    const xpTotal = inteiro(p.xpTierTotal), xpAtual = inteiro(p.xpTrabalho)
    const saldo = eco.centavos(p.carteira, true)
    eco.centavos(p.banco, true)
    let alteracoes, detalhe
    if (tipo === 'contratar') {
      const carreira = catalogo.carreiraPorId(pedido.id)
      if (!carreira) throw erro('carreira_invalida')
      await requisitos(p, carreira, carreira.cargos[0], operacoes, session, identidade.canonico)
      if (p.emprego === carreira.id || carreira.cargos.some(c => c.nome === p.emprego)) throw erro('ja_contratado')
      if (p.emprego && !pedido.confirmar) throw erro('confirmacao_troca')
      if (p.empregosAnteriores !== undefined && !Array.isArray(p.empregosAnteriores)) throw erro('progresso_incompativel')
      const historico = [...(p.empregosAnteriores || [])]
      if (p.emprego) historico.push({ emprego: p.emprego, cargo: p.cargo,
        xpTrabalho: xpAtual, encerradoEm: tempo })
      alteracoes = { emprego: carreira.id, cargo: 1, xpTrabalho: 0, empregosAnteriores: historico,
        energiaAtualizadaEm: p.energiaAtualizadaEm ?? tempo }
      detalhe = { carreira: carreira.id, cargo: carreira.cargos[0].nome }
    } else {
      const atual = empregoAtual(p)
      if (!atual) throw erro('sem_emprego')
      // Valida faculdade mesmo em fichas avançadas importadas, não só ao promover.
      await requisitos(p, atual.carreira, atual.cargo, operacoes, session, identidade.canonico)
      if (tipo === 'promocao') {
        const seguinte = atual.carreira.cargos[atual.cargo.numero]
        if (!seguinte) throw erro('sem_promocao')
        if (xpAtual < seguinte.xpMinimo) throw erro('xp_promocao_insuficiente')
        await requisitos(p, atual.carreira, seguinte, operacoes, session, identidade.canonico)
        alteracoes = { cargo: seguinte.numero }
        detalhe = { carreira: atual.carreira.id, cargo: seguinte.nome }
      } else if (tipo === 'trabalhar') {
        if (p.preso === true) throw erro('jogador_preso')
        if (p.cooldowns !== undefined && (!p.cooldowns || typeof p.cooldowns !== 'object' || Array.isArray(p.cooldowns))) throw erro('progresso_incompativel')
        const cooldowns = { ...(p.cooldowns || {}) }
        const ultimaJornada = cooldowns.trabalhar
        if (ultimaJornada !== undefined) {
          inteiro(ultimaJornada)
          if (tempo - ultimaJornada < catalogo.COOLDOWN_JORNADA_MS) throw erro('jornada_cooldown')
        }
        const gastoEnergia = consumirEnergia(p, catalogo.ENERGIA_POR_JORNADA, tempo, ultimaJornada)
        const salario = eco.centavos(atual.cargo.salario)
        if (saldo + salario > eco.MAX_CENTAVOS) throw erro('limite_financeiro')
        const xpTrabalho = inteiro(xpAtual + catalogo.XP_POR_JORNADA)
        const xpTierTotal = inteiro(xpTotal + catalogo.XP_POR_JORNADA)
        cooldowns.trabalhar = tempo
        alteracoes = { carteira: (saldo + salario) / 100, xpTrabalho, xpTierTotal,
          ...gastoEnergia,
          cooldowns }
        detalhe = { carreira: atual.carreira.id, cargo: atual.cargo.nome, salario: atual.cargo.salario,
          xpGanho: catalogo.XP_POR_JORNADA, energia: alteracoes.energia,
          proximaJornadaEm: tempo + catalogo.COOLDOWN_JORNADA_MS }
      } else throw erro('operacao_invalida')
    }
    const r = await col.updateOne({ _id: p._id, jid: p.jid }, { $set: alteracoes }, opcoes)
    if (r.matchedCount !== 1 || r.modifiedCount !== 1) throw erro('progresso_incompativel')
    const atualizado = await col.findOne({ _id: p._id }, opcoes)
    if (!atualizado) throw erro('jogador_ausente')
    return { resultado: { ok: true, transacional: true, ...detalhe,
      saldoCarteira: atualizado.carteira, xpTrabalho: atualizado.xpTrabalho,
      xpTierTotal: atualizado.xpTierTotal,
      nivelProfissional: catalogo.nivelProfissional(inteiro(atualizado.xpTierTotal)) },
    auditoria: { antes: { carteira: p.carteira, banco: p.banco, emprego: p.emprego,
      cargo: p.cargo, xpTrabalho: p.xpTrabalho, xpTierTotal: p.xpTierTotal,
      energia: p.energia, cooldowns: p.cooldowns },
    depois: { carteira: atualizado.carteira, banco: atualizado.banco, emprego: atualizado.emprego,
      cargo: atualizado.cargo, xpTrabalho: atualizado.xpTrabalho,
      xpTierTotal: atualizado.xpTierTotal, energia: atualizado.energia, cooldowns: atualizado.cooldowns } } }
  })
}
const contratar = (jid, id, confirmar, ctx) => acaoProfissional(jid, 'contratar', { id, confirmar: confirmar === true }, ctx)
const promover = (jid, ctx) => acaoProfissional(jid, 'promocao', {}, ctx)
const trabalhar = (jid, ctx) => acaoProfissional(jid, 'trabalhar', {}, ctx)
function __definirRelogioTeste(fn) { agora = fn || (() => Date.now()) }
module.exports = { contratar, promover, trabalhar, empregoAtual, __definirRelogioTeste }
