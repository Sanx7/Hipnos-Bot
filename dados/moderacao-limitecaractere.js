const config = require('./limitecaractere-config')
const { extrairTextoComando } = require('./texto-comando')
const { mensagemAtual, alvoSeguro } = require('./moderacao-contexto')
const { removerDoGrupoConfirmado } = require('../comandos/admin/ban')
const advertencias = require('../advertencias')
const adv = require('../comandos/admin/adv')
const { criarFila } = require('./moderacao-fila')
const MAX = 10000
let relogio = () => Date.now()
const fila = criarFila({ relogio: () => relogio(), max: MAX,
  saturada: () => console.warn('[limitecaractere] Limite de operações; fluxo preservado.'),
  falha: () => { console.warn('[limitecaractere] Operação incompleta; sem repetição de efeitos.'); return true } })
// Iteração por pontos de código, equivalente a Array.from(texto).length,
// sem alocar um array proporcional ao tamanho do texto. Não conta bytes.
function contarCaracteres(texto) { let total = 0; for (const _ of texto) total++; return total }
function aviso(limite, punicao, apagada) {
  return `🌙 *HIPNOS — O SILÊNCIO DOS DEUSES*\n\n📜 Mortal, até os pergaminhos do Olimpo possuem limites.\n\n⚠️ Sua mensagem ultrapassou o tamanho permitido neste reino.\n🔱 Limite: ${limite} caracteres.\n💀 Punição: ${punicao}.\n🗑️ Mensagem: ${apagada ? 'exclusão aceita' : 'exclusão não confirmada'}.\n\n🌑 Nem todos os discursos merecem atravessar os sonhos.`
}
async function tratar(sock, msg, total) {
  const { remoteJid: jid, participant: sender, id } = msg.key
  let cfg, alvo
  try {
    cfg = await config.obter(jid)
    if (!cfg.ativo || total <= cfg.limite) return false
    alvo = await alvoSeguro(sock, jid, sender)
  } catch (_) { console.warn('[limitecaractere] Configuração/identidade indisponível; fluxo preservado.'); return false }
  if (!alvo) return false
  if (!alvo.botAdmin) { console.warn('[limitecaractere] Hipnos sem administrador; nenhuma punição aplicada.'); return true }
  const validar = async () => {
    const atualConfig = await config.obter(jid)
    const atual = await alvoSeguro(sock, jid, sender)
    if (!atualConfig.ativo || atualConfig.acao !== cfg.acao || atualConfig.limite !== cfg.limite ||
        !atual || !atual.botAdmin || atual.numero !== alvo.numero || atual.participante.id !== alvo.participante.id) throw new Error('Punição não autorizada')
    return atual
  }
  if (!await config.reservar(jid, id)) return true
  await validar()
  const primeira = await config.cooldown(jid, alvo.numero, relogio())
  await validar()
  let apagada = false
  try { await sock.sendMessage(jid, { delete: { ...msg.key, fromMe: false } }); apagada = true }
  catch (_) { console.warn('[limitecaractere] Exclusão não confirmada.') }
  if (!primeira) return true
  if (cfg.acao === 'apagar') {
    await sock.sendMessage(jid, { text: aviso(cfg.limite, apagada ? 'Mensagem apagada' : 'Nenhuma; falha na exclusão', apagada) })
  } else if (cfg.acao === 'ban') {
    let confirmada = false
    try { await removerDoGrupoConfirmado(sock, jid, alvo.participante.id, { validar }); confirmada = true }
    catch (_) { console.warn('[limitecaractere] Remoção não confirmada.') }
    await sock.sendMessage(jid, { text: aviso(cfg.limite, confirmada ? 'Expulsão confirmada' : 'Expulsão não confirmada', apagada) })
  } else {
    await advertencias.comAdvertenciasSerializadas(alvo.numero, jid, async () => {
      const atual = await validar()
      if (!atual.autor) throw new Error('Hipnos não identificado')
      const resultado = await advertencias.criarAdvertencia({ numero: atual.numero, grupoId: jid,
        motivo: `Limite de caracteres: texto acima de ${cfg.limite}`, aplicadoPor: atual.autor })
      if (resultado.total >= resultado.limite) {
        await adv.aplicarBanAutomatico(sock, jid, msg, atual.participante.id, atual.numero, atual.autor, { limite: resultado.limite, validar })
      } else {
        await sock.sendMessage(jid, { text: aviso(cfg.limite, `Advertência (${resultado.total}/${resultado.limite})`, apagada) })
      }
    })
  }
  return true
}
async function processar(sock, msg, tipo = 'notify') {
  if (!mensagemAtual(msg, tipo, relogio())) return false
  const texto = extrairTextoComando(msg)
  if (!texto) return false
  const total = contarCaracteres(texto)
  return fila.processar(msg.key.remoteJid, msg.key.id, () => tratar(sock, msg, total))
}
async function processarLote(sock, mensagens = [], tipo, prioridade = new Set()) {
  const tratadas = new Set()
  for (const msg of mensagens) {
    const chave = `${msg?.key?.remoteJid}:${msg?.key?.id}`
    if (prioridade.has(chave)) continue
    try { if (await processar(sock, msg, tipo ?? 'desconhecido')) tratadas.add(chave) }
    catch (_) { console.warn('[limitecaractere] Evento inválido ignorado.') }
  }
  return tratadas
}
module.exports = { processar, processarLote, contarCaracteres, MAX,
  __limparTeste(agora) { fila.limparTeste(); relogio = agora || (() => Date.now()) },
  __tamanhoCacheTeste() { return fila.tamanho() } }
