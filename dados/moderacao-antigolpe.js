const config = require('./antigolpe-config')
const { analisar, NOMES } = require('./deteccao-golpes')
const { mensagemAtual, alvoSeguro } = require('./moderacao-contexto')
const { criarFila } = require('./moderacao-fila')
const { extrairTextoComando } = require('./texto-comando')
const { ehProprioBot } = require('./protecao-bot')
const advertencias = require('../advertencias')
const adv = require('../comandos/admin/adv')
let relogio = () => Date.now()
const fila = criarFila({ relogio: () => relogio(),
  saturada: () => console.warn('[antigolpe] Limite de operações; fluxo preservado.'),
  falha: () => { console.warn('[antigolpe] Evento inválido; fluxo preservado.'); return false } })
function resumo(risco, acao) {
  return `🌙 *HIPNOS — VIGILÂNCIA DO OLIMPO*\n\n⚠️ Mensagem suspeita: possível tentativa de fraude.\n🔱 Sinais: ${risco.categorias.map(s => NOMES[s]).join('; ')}.\n📜 Risco: ${risco.risco === 'alto' ? 'Alto' : 'Médio'}.\n🛡️ Ação: ${acao}.\n\n🌑 Nem toda promessa dourada vem dos deuses. Revise o contexto antes de concluir.`
}
async function alertar(sock, jid, risco, acao) {
  const ps = (await sock.groupMetadata(jid))?.participants || [], admins = []
  for (const p of ps.filter(p => ['admin', 'superadmin'].includes(p.admin))) {
    if (!await ehProprioBot(sock, jid, p.id, ps)) admins.push(p.id)
  }
  if (!admins.length) { console.warn('[antigolpe] Nenhum administrador humano identificado para o alerta.'); return }
  // Sem quote, autor, texto original, códigos, URLs ou dados financeiros.
  await sock.sendMessage(jid, { text: resumo(risco, acao), mentions: admins, contextInfo: { mentionedJid: admins } })
}
async function tratar(sock, msg) {
  const { remoteJid: jid, participant: sender, id } = msg.key
  let bloqueada = false
  try {
    const cfg = await config.obter(jid)
    if (!cfg.ativo) return false
    const risco = analisar(extrairTextoComando(msg), cfg.sensibilidade, cfg.excecoes)
    if (risco.risco === 'baixo') return false
    const alvo = await alvoSeguro(sock, jid, sender)
    if (!alvo) return false
    const punir = risco.risco === 'alto' && cfg.modo !== 'alerta' && alvo.botAdmin
    const validar = async () => {
      const c = await config.obter(jid), atual = await alvoSeguro(sock, jid, sender)
      if (!c.ativo || c.modo !== cfg.modo || c.sensibilidade !== cfg.sensibilidade || JSON.stringify(c.excecoes) !== JSON.stringify(cfg.excecoes) ||
          !atual || atual.numero !== alvo.numero || atual.participante.id !== alvo.participante.id || (punir && !atual.botAdmin)) throw new Error('Ação não autorizada')
      return atual
    }
    await validar()
    const reserva = await config.reservar(jid, id, punir)
    if (!reserva.nova) return reserva.bloqueada
    const primeira = await config.cooldown(jid, alvo.numero, relogio())
    await validar()
    if (!punir) {
      if (primeira) await alertar(sock, jid, risco, alvo.botAdmin || cfg.modo === 'alerta' || risco.risco === 'medio'
        ? 'Revisão dos administradores solicitada; nenhuma punição' : 'Sem punição; Hipnos não tem administrador')
      return false
    }
    bloqueada = true
    let apagada = false
    try { await sock.sendMessage(jid, { delete: { ...msg.key, fromMe: false } }); apagada = true }
    catch (_) { console.warn('[antigolpe] Exclusão não confirmada.') }
    if (!primeira) return true
    const exclusao = apagada ? 'Exclusão aceita' : 'Exclusão não confirmada'
    if (cfg.modo === 'apagar') await alertar(sock, jid, risco, exclusao)
    else await advertencias.comAdvertenciasSerializadas(alvo.numero, jid, async () => {
      const atual = await validar()
      if (!atual.autor) throw new Error('Hipnos não identificado')
      const resultado = await advertencias.criarAdvertencia({ numero: atual.numero, grupoId: jid,
        motivo: `Possível fraude: ${risco.categorias.map(s => NOMES[s]).join('; ')}`, aplicadoPor: atual.autor })
      if (resultado.total >= resultado.limite) {
        await adv.aplicarBanAutomatico(sock, jid, { key: msg.key }, atual.participante.id, atual.numero, atual.autor, {
          limite: resultado.limite, validar,
          responderResultado: ({ confirmado, pendencia }) => alertar(sock, jid, risco,
            `${exclusao}; advertência aplicada; ${confirmado ? 'expulsão confirmada' : 'expulsão não confirmada'}${pendencia ? '; registro pendente de revisão' : ''}`)
        })
      } else await alertar(sock, jid, risco, `${exclusao}; advertência aplicada (${resultado.total}/${resultado.limite})`)
    })
    return true
  } catch (_) {
    console.warn('[antigolpe] Configuração, identidade ou operação indisponível; sem repetição de efeitos.')
    // Alerta nunca bloqueia o roteador, mesmo se seu envio falhar.
    return bloqueada
  }
}
async function processar(sock, msg, tipo = 'notify') {
  if (!mensagemAtual(msg, tipo, relogio()) || !extrairTextoComando(msg)) return false
  return fila.processar(msg.key.remoteJid, msg.key.id, () => tratar(sock, msg))
}
async function processarLote(sock, mensagens = [], tipo, prioridade = new Set()) {
  const tratadas = new Set()
  for (const msg of mensagens) {
    const chave = `${msg?.key?.remoteJid}:${msg?.key?.id}`
    if (prioridade.has(chave)) continue
    try { if (await processar(sock, msg, tipo ?? 'desconhecido')) tratadas.add(chave) }
    catch (_) { console.warn('[antigolpe] Evento inválido ignorado.') }
  }
  return tratadas
}
module.exports = { processar, processarLote, __limparTeste(agora) { fila.limparTeste(); relogio = agora || (() => Date.now()) }, __tamanhoCacheTeste() { return fila.tamanho() } }
