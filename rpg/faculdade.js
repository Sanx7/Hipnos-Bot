const db = require('./database')
const eco = require('./economia')
const { resolverIdentidade, erro } = require('./identidade')
const cat = require('./faculdades-catalogo')
const { inteiro, consumirEnergia } = require('./energia')
let agora = () => Date.now()
function objeto(v) { return v && typeof v === 'object' && !Array.isArray(v) }
function dadosAcademicos(p) {
  if (p.academico === undefined) return { versao: 1, matricula: null, diplomas: [], historico: [] }
  const a = p.academico
  if (!objeto(a) || a.versao !== 1 || !Array.isArray(a.diplomas) || !Array.isArray(a.historico)) throw erro('academico_incompativel')
  const cursos = new Set()
  for (const d of a.diplomas) {
    if (!objeto(d) || !cat.cursoPorId(d.cursoId) || typeof d.id !== 'string' || d.id !== d.comprovacaoId ||
        !/^[a-f0-9]{64}$/.test(d.id) || !Number.isSafeInteger(d.concluidaEm) || d.concluidaEm <= 0 || cursos.has(d.cursoId)) throw erro('academico_incompativel')
    cursos.add(d.cursoId)
  }
  if (a.matricula !== null) {
    const m = a.matricula, c = cat.cursoPorId(m?.cursoId)
    if (!objeto(m) || !c || !/^[a-f0-9]{64}$/.test(m.id) || !['ativa', 'trancada'].includes(m.status) ||
        !Number.isSafeInteger(m.totalSessoes) || m.totalSessoes < 1 ||
        !Number.isSafeInteger(m.sessoesConcluidas) || m.sessoesConcluidas < 0 || m.sessoesConcluidas >= m.totalSessoes ||
        !Number.isSafeInteger(m.matriculadaEm) || m.matriculadaEm <= 0 || cursos.has(m.cursoId)) throw erro('academico_incompativel')
  }
  return { ...a, diplomas: [...a.diplomas], historico: [...a.historico], matricula: a.matricula ? { ...a.matricula } : null }
}
async function diplomaComprovado(p, cursoId, operacoes, session, canonico, tempo = agora()) {
  const a = dadosAcademicos(p)
  const d = a.diplomas.find(d => d.cursoId === cursoId && d.concluidaEm <= tempo)
  if (!d || !operacoes) return false
  const registro = await operacoes.findOne({ _id: d.comprovacaoId }, { session })
  const emitido = registro?.resultado?.diploma
  return registro?.estado === 'concluida' && registro.tipo === 'estudar' && registro.remetente === canonico &&
    registro.resultado?.ok === true && emitido?.id === d.id && emitido.cursoId === cursoId && emitido.concluidaEm === d.concluidaEm
}
async function executar(jid, tipo, pedido, contexto) {
  let identidade, id
  try {
    identidade = await resolverIdentidade(jid, contexto?.participantes || [])
    id = eco.identidadeOperacao(contexto, identidade)
  } catch (err) { return { ok: false, motivo: err.codigo || 'operacao_invalida' } }
  const fingerprint = eco.hash(JSON.stringify([tipo, identidade.canonico, pedido]))
  return eco.executarOperacaoAuditada({ remetente: identidade, id, fingerprint, tipo }, async (col, session, operacoes) => {
    const opcoes = { session }, p = await db.obterJogador(col, identidade, opcoes)
    if (!p?.nome) throw erro('registro_obrigatorio')
    const a = dadosAcademicos(p), tempo = agora()
    let alteracoes = {}, diploma = null
    if (tipo === 'matricular') {
      const c = cat.cursoPorId(pedido.cursoId)
      if (!c) throw erro('curso_invalido')
      if (a.matricula) throw erro('matricula_existente')
      if (a.diplomas.some(d => d.cursoId === c.id)) throw erro('diploma_existente')
      a.matricula = { id, cursoId: c.id, totalSessoes: c.sessoes, sessoesConcluidas: 0, status: 'ativa', matriculadaEm: tempo }
      if (p.energiaAtualizadaEm === undefined) {
        if (inteiro(p.energia, 100) > 100) throw erro('progresso_incompativel')
        alteracoes.energiaAtualizadaEm = tempo
      }
    } else {
      const m = a.matricula
      if (!m) throw erro('sem_matricula')
      const origem = await operacoes.findOne({ _id: m.id }, opcoes)
      const emitida = origem?.resultado?.matricula
      if (origem?.estado !== 'concluida' || origem.tipo !== 'matricular' || origem.remetente !== identidade.canonico ||
          origem.resultado?.ok !== true || emitida?.id !== m.id || emitida.cursoId !== m.cursoId ||
          emitida.totalSessoes !== m.totalSessoes || emitida.matriculadaEm !== m.matriculadaEm || m.matriculadaEm > tempo) throw erro('academico_incompativel')
      if (tipo === 'trancar' || tipo === 'retomar') {
        const esperado = tipo === 'trancar' ? 'ativa' : 'trancada'
        if (m.status !== esperado) throw erro('estado_matricula')
        m.status = tipo === 'trancar' ? 'trancada' : 'ativa'
        a.historico.push({ tipo, cursoId: m.cursoId, matriculaId: m.id, em: tempo, operacaoId: id })
      } else if (tipo === 'estudar') {
        if (m.status !== 'ativa') throw erro('matricula_trancada')
        if (p.cooldowns !== undefined && !objeto(p.cooldowns)) throw erro('academico_incompativel')
        const cooldowns = { ...(p.cooldowns || {}) }, ultima = cooldowns.estudar
        if (ultima !== undefined && tempo - inteiro(ultima) < cat.COOLDOWN_ESTUDO_MS) throw erro('estudo_cooldown')
        alteracoes = consumirEnergia(p, cat.ENERGIA_ESTUDO, tempo, ultima ?? p.cooldowns?.trabalhar)
        cooldowns.estudar = tempo
        alteracoes.cooldowns = cooldowns
        m.sessoesConcluidas++
        if (m.sessoesConcluidas === m.totalSessoes) {
          diploma = { id, cursoId: m.cursoId, concluidaEm: tempo, comprovacaoId: id }
          a.diplomas.push(diploma)
          a.historico.push({ ...m, status: 'concluida', concluidaEm: tempo, diplomaId: id })
          a.matricula = null
        }
      } else throw erro('operacao_invalida')
    }
    // Atualiza apenas o bloco acadêmico, energia e cooldowns; saldos e outros campos não são gravados.
    alteracoes.academico = a
    const r = await col.updateOne({ _id: p._id, jid: p.jid }, { $set: alteracoes }, opcoes)
    if (r.matchedCount !== 1 || r.modifiedCount !== 1) throw erro('academico_incompativel')
    const resumo = q => ({ carteira: q.carteira, banco: q.banco, academico: q.academico,
      energia: q.energia, energiaAtualizadaEm: q.energiaAtualizadaEm, cooldowns: q.cooldowns })
    return { resultado: { ok: true, tipo, matricula: a.matricula, diploma, quantidadeDiplomas: a.diplomas.length,
      energia: alteracoes.energia ?? p.energia }, auditoria: { antes: resumo(p), depois: resumo({ ...p, ...alteracoes }) } }
  })
}
const matricular = (jid, cursoId, ctx) => executar(jid, 'matricular', { cursoId }, ctx)
const estudar = (jid, ctx) => executar(jid, 'estudar', {}, ctx)
const trancar = (jid, ctx) => executar(jid, 'trancar', {}, ctx)
const retomar = (jid, ctx) => executar(jid, 'retomar', {}, ctx)
function __definirRelogioTeste(fn) { agora = fn || (() => Date.now()) }
module.exports = { matricular, estudar, trancar, retomar, dadosAcademicos, diplomaComprovado, __definirRelogioTeste }
