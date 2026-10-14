const { createHash } = require('crypto')
const db = require('./database')
const { resolverIdentidade, erro } = require('./identidade')
// Os documentos continuam em reais/Number. Nenhuma conversão do acervo.
// Cálculos em centavos só aceitam representações equivalentes a centavos.
const MAX_CENTAVOS = 100000000000 // R$ 1 bilhão por saldo/operação.
function centavos(valor, aceitarZero = false) {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) throw erro('saldo_incompativel')
  const escalado = valor * 100
  const inteiro = Math.round(escalado)
  if (!Number.isSafeInteger(inteiro) || inteiro > MAX_CENTAVOS ||
      Math.abs(escalado - inteiro) > Math.max(1e-9, Math.abs(escalado) * Number.EPSILON * 4) ||
      (!aceitarZero && inteiro === 0)) throw erro('saldo_incompativel')
  return inteiro
}
function formatarReais(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(Number(valor ?? 0)).replace(/\u00a0/g, ' ')
}
function parseValor(token) {
  const texto = String(token ?? '').trim().toLowerCase()
  if (texto === 'todos' || texto === 'tudo') return 'todos'
  let normalizado
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(texto)) normalizado = texto.replace(/\./g, '').replace(',', '.')
  else if (/^\d+(?:[.,]\d{1,2})?$/.test(texto)) normalizado = texto.replace(',', '.')
  else return null // "1.234", expoente, hexadecimal e >2 casas são ambíguos.
  const valor = Number(normalizado)
  try { centavos(valor); return valor } catch { return null }
}
class ErroTransferencia extends Error {
  constructor(motivo) { super(motivo); this.codigo = motivo; this.motivo = motivo }
}
function hash(valor) { return createHash('sha256').update(valor).digest('hex') }
function identidadeOperacao(contexto, remetente) {
  if (!contexto || typeof contexto.chat !== 'string' ||
      !/^\d+@(g\.us|s\.whatsapp\.net|lid)$/.test(contexto.chat) ||
      typeof contexto.mensagem !== 'string' || !contexto.mensagem || contexto.mensagem.length > 200) throw erro('operacao_invalida')
  // Privado PN/LID do mesmo autor normaliza o chat, mas nunca equipara
  // arbitrariamente dois grupos ou autores diferentes.
  const chat = contexto.chat.endsWith('@g.us') ? contexto.chat : remetente.canonico
  return hash(JSON.stringify([chat, remetente.canonico, contexto.mensagem]))
}
function retornoRegistro(registro, fingerprint) {
  if (!registro || registro.fingerprint !== fingerprint) return { ok: false, motivo: 'operacao_conflitante' }
  if (registro.estado === 'concluida') return { ...registro.resultado, repetida: true }
  if (registro.estado === 'recusada') return { ok: false, motivo: registro.motivo, repetida: true }
  return { ok: false, motivo: 'resultado_pendente', repetida: true }
}
async function executarOperacaoAuditada(meta, aplicar) {
  const { remetente, destino = remetente, id, fingerprint, tipo, valorSolicitado = null } = meta
  try {
    return await db.usarContextoRpg(async ctx => {
      // Reserva persistente FORA da transação. Se o processo morrer antes do
      // commit, repetir a mensagem apenas consulta; não reexecuta a operação.
      const leitura = { readPreference: 'primary', readConcern: { level: 'majority' } }
      const antigo = await ctx.operacoes.findOne({ _id: id }, leitura)
      if (antigo) return retornoRegistro(antigo, fingerprint)
      try {
        const reserva = await ctx.operacoes.insertOne({ _id: id, fingerprint, estado: 'pendente',
          tipo, remetente: remetente.canonico, destinatario: destino.canonico,
          valorSolicitado, criadoEm: Date.now() },
        { writeConcern: { w: 'majority', wtimeout: 15000 } })
        if (!reserva.acknowledged) return { ok: false, motivo: 'resultado_pendente' }
      } catch (err) {
        // Duplicate ou timeout da reserva: jamais presumir que é nossa.
        const registro = await ctx.operacoes.findOne({ _id: id }, leitura).catch(() => null)
        return registro ? retornoRegistro(registro, fingerprint) : { ok: false, motivo: 'resultado_pendente' }
      }
      try {
        const tx = await db.executarTransacaoNoContexto(ctx, async (colecao, session, operacoes) => {
          const execucao = await aplicar(colecao, session, operacoes)
          const resultado = execucao.resultado
          if (!resultado || resultado.ok !== true) throw erro('operacao_invalida')
          const { antes, depois } = execucao.auditoria || {}
          if (!antes || !depois) throw erro('operacao_invalida')
          const finalizacao = await operacoes.updateOne({ _id: id, fingerprint, estado: 'pendente' },
            { $set: { estado: 'concluida', resultado, concluidoEm: Date.now(),
              antes, depois } }, { session })
          if (finalizacao.modifiedCount !== 1) throw erro('operacao_conflitante')
          return resultado
        })
        return tx.retorno
      } catch (err) {
        if (err.codigo === 'resultado_pendente' || !err.codigo) {
          // Commit pode ter acontecido. Só um registro concluído é evidência.
          const registro = await ctx.operacoes.findOne({ _id: id }, leitura).catch(() => null)
          return registro ? retornoRegistro(registro, fingerprint) : { ok: false, motivo: 'resultado_pendente' }
        }
        // Erro conhecido antes de enviar commit; não existe sucesso oculto.
        const r = await ctx.operacoes.updateOne({ _id: id, fingerprint, estado: 'pendente' },
          { $set: { estado: 'recusada', motivo: err.codigo, concluidoEm: Date.now() } },
          { writeConcern: { w: 'majority', wtimeout: 15000 } })
        if (r.modifiedCount !== 1) return { ok: false, motivo: 'resultado_pendente' }
        return { ok: false, motivo: err.codigo }
      }
    })
  } catch (err) {
    return { ok: false, motivo: err.codigo === 'transacao_indisponivel' ? err.codigo : 'resultado_pendente' }
  }
}
async function executarFinanceira(tipo, a, b, valor, contexto) {
  let remetente, destino, id, fingerprint
  try {
    if (!['transferir', 'depositar', 'sacar'].includes(tipo)) throw erro('direcao_invalida')
    if (valor !== 'todos') centavos(valor)
    remetente = await resolverIdentidade(a, contexto?.participantes || [])
    destino = b ? await resolverIdentidade(b, contexto?.participantes || []) : remetente
    if (tipo === 'transferir' && remetente.canonico === destino.canonico) throw erro('mesmo_jogador')
    id = identidadeOperacao(contexto, remetente)
    fingerprint = hash(JSON.stringify([tipo, remetente.canonico, destino.canonico, valor]))
  } catch (err) { return { ok: false, motivo: err.codigo || 'valor_invalido' } }
  return executarOperacaoAuditada({ remetente, destino, id, fingerprint, tipo, valorSolicitado: valor },
    async (colecao, session) => {
          const opcoes = { session }
          const jogador = await db.obterJogador(colecao, remetente, opcoes)
          const alvo = tipo === 'transferir' ? await db.obterJogador(colecao, destino, opcoes) : jogador
          if (!jogador || !alvo) throw erro('jogador_ausente')
          if (tipo === 'transferir' && jogador._id.toString() === alvo._id.toString()) throw erro('mesmo_jogador')
          const carteira = centavos(jogador.carteira, true)
          const banco = centavos(jogador.banco, true)
          const origem = tipo === 'sacar' ? banco : carteira
          const quantia = valor === 'todos' ? origem : centavos(valor)
          if (!quantia || origem < quantia) throw erro('saldo_insuficiente')
          const novaCarteira = carteira + (tipo === 'sacar' ? quantia : -quantia)
          const novoBanco = banco + (tipo === 'depositar' ? quantia : tipo === 'sacar' ? -quantia : 0)
          let alvoCarteira
          if (tipo === 'transferir') {
            alvoCarteira = centavos(alvo.carteira, true) + quantia
            centavos(alvo.banco, true)
          }
          if ([novaCarteira, novoBanco, alvoCarteira ?? 0].some(n => n < 0 || n > MAX_CENTAVOS)) throw erro('limite_financeiro')
          // Crédito seguido de débito apenas DENTRO de transação real.
          if (tipo === 'transferir') {
            const credito = await colecao.updateOne({ _id: alvo._id, jid: alvo.jid,
              carteira: alvo.carteira }, { $set: { carteira: alvoCarteira / 100 } }, opcoes)
            if (credito.matchedCount !== 1 || credito.modifiedCount !== 1) throw erro('jogador_ausente')
          }
          const debito = await colecao.updateOne({ _id: jogador._id, jid: jogador.jid,
            carteira: jogador.carteira, banco: jogador.banco },
          { $set: { carteira: novaCarteira / 100, banco: novoBanco / 100 } }, opcoes)
          if (debito.matchedCount !== 1 || debito.modifiedCount !== 1) throw erro('saldo_insuficiente')
          // Releitura real na sessão, preservando todos os outros campos.
          const atualizado = await colecao.findOne({ _id: jogador._id }, opcoes)
          const alvoAtualizado = tipo === 'transferir' ? await colecao.findOne({ _id: alvo._id }, opcoes) : atualizado
          if (!atualizado || !alvoAtualizado) throw erro('jogador_ausente')
          const resultado = { ok: true, transacional: true, valor: quantia / 100,
            remetente: remetente.canonico, destinatario: destino.canonico,
            saldoCarteira: atualizado.carteira, saldoBanco: atualizado.banco,
            novoSaldoRemetente: atualizado.carteira,
            novoSaldoDestinatario: alvoAtualizado.carteira }
          return { resultado, auditoria: {
            antes: { carteira: jogador.carteira, banco: jogador.banco, destinatario: alvo.carteira },
            depois: { carteira: atualizado.carteira, banco: atualizado.banco, destinatario: alvoAtualizado.carteira }
          } }
    })
}
async function moverSaldo(jid, valor, direcao, contexto) {
  return executarFinanceira(direcao, jid, null, valor, contexto)
}
async function transferirEntreJogadores(a, b, valor, contexto) {
  return executarFinanceira('transferir', a, b, valor, contexto)
}
module.exports = { formatarReais, parseValor, centavos, MAX_CENTAVOS,
  ErroTransferencia, moverSaldo, transferirEntreJogadores,
  executarOperacaoAuditada, identidadeOperacao, hash }
