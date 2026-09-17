// ============================================================
// 💰 rpg/economia.js — Helpers de economia do RPG (Fase 2)
// ============================================================
// Utilitários compartilhados por /carteira, /depositar, /sacar e
// /transferir (e pelo futuro sistema de roubo da Fase 7):
//   - formatarReais(valor)        → "R$ 1.234,56" (padrão brasileiro);
//   - parseValor(token)           → número > 0 | 'todos' | null;
//   - transferirEntreJogadores()  → movimenta carteira de 2 jogadores
//     com segurança: tenta TRANSAÇÃO MongoDB real (rpg/database.js —
//     Atlas/replica set) e, se o deployment não suportar (standalone),
//     cai num plano COMPENSATÓRIO atômico: credita o destinatário,
//     debita o remetente com CONDIÇÃO de saldo ($gte) e, se o débito
//     falhar, REVERTE o crédito — nunca debita sem creditar (ou o
//     contrário) na medida do possível.
//   - moverSaldo()                → /depositar e /sacar: move carteira
//     ↔ banco com $inc DUPLO no MESMO documento (atômico por documento)
//     e CONDIÇÃO de saldo no filtro ($gte) — é impossível deixar saldo
//     negativo, mesmo com dois comandos disparados juntos.
// NÃO toca em LID: getPlayer/savePlayer já resolvem (Fase 1) — os
// comandos da Fase 2 passam o jid cru e o módulo de dados normaliza.
// ============================================================

// 🧷 Persistência: MESMO módulo das Fases 0/1. getPlayer() lê/cria o
// jogador e JÁ resolve @lid → número real (REGRA DE IDENTIDADE no
// cabeçalho do rpg/database.js) — os comandos não se preocupam com isso.
const { getPlayer, obterColecaoRpg, executarTransacao } = require('./database')

// 🧾 Formata dinheiro em padrão brasileiro: R$ 1.234,56
// ⚠️ O Intl insere um espaço NÃO-QUEBRÁVEL (U+00A0) entre "R$" e o número —
// normalizamos para espaço comum: mantém a exibição idêntica no WhatsApp e
// evita que comparações/buscas simples (includes('R$ 0')) falhem de surpresa.
function formatarReais(valor) {
  const numero = Math.round((Number(valor) || 0) * 100) / 100
  return numero.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).replace(/\u00a0/g, ' ')
}

// -------------------------------------------------------------------
// ✂️ parseValor(token): interpreta o argumento de valor dos comandos.
//   'todos' / 'tudo'  → a STRING 'todos' (o comando decide pelo saldo)
//   '50', '1.234,56', '1234.56' → número positivo (2 casas, arredondado)
//   qualquer outra coisa (abc, -5, 0, vazio) → null (valor inválido)
// -------------------------------------------------------------------
function parseValor(token) {
  const bruto = String(token || '').trim().toLowerCase()
  if (bruto === 'todos' || bruto === 'tudo') return 'todos'

  // Aceita formatos BR: "1.234,56" → remove pontos de milhar → "1234,56" → vírgula vira ponto
  const normalizado = bruto.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  const numero = Number(normalizado)
  if (!Number.isFinite(numero) || numero <= 0) return null
  return Math.round(numero * 100) / 100
}

// 🚫 Erro de negócio da transferência (não é falha de infra): carrega o
// motivo p/ o comando montar a mensagem amigável certa.
class ErroTransferencia extends Error {
  constructor(motivo) {
    super('ErroTransferencia: ' + motivo)
    this.name = 'ErroTransferencia'
    this.motivo = motivo // 'saldo_insuficiente' | 'jogador_ausente' | ...
  }
}

// -------------------------------------------------------------------
// 🏦 moverSaldo(jid, valor, direcao): /depositar (carteira → banco) e
// /sacar (banco → carteira) do MESMO jogador.
//   direcao: 'depositar' | 'sacar'
// Decisão de implementação: UMA única escrita no Mongo (nada de ler,
// calcular e gravar em duas etapas). O filtro exige saldo suficiente na
// origem ($gte) e o $inc move os dois campos JUNTOS — como o update é
// atômico POR DOCUMENTO, um segundo comando simultâneo simplesmente não
// casa o filtro e falha com 'saldo_insuficiente'. Assim é impossível
// criar dinheiro (ou deixar saldo negativo) por corrida.
// Retorno:
//   { ok: true,  valor, saldoCarteira, saldoBanco }
//   { ok: false, motivo } (valor_invalido | saldo_insuficiente | direcao_invalida)
// Lança apenas em falha de infra (rede/banco) — o comando trata.
// -------------------------------------------------------------------
async function moverSaldo(jid, valor, direcao) {
  if (direcao !== 'depositar' && direcao !== 'sacar') return { ok: false, motivo: 'direcao_invalida' }
  if (!Number.isFinite(valor) || valor <= 0) return { ok: false, motivo: 'valor_invalido' }

  // 🔎 getPlayer lê/cria o jogador e devolve o jid CANÔNICO (número real —
  // o @lid já foi resolvido lá dentro). É ele que vai no filtro.
  const jogador = await getPlayer(jid)
  const depositar = direcao === 'depositar'
  const campoOrigem = depositar ? 'carteira' : 'banco'
  const saldoOrigem = Math.round((Number(jogador[campoOrigem]) || 0) * 100) / 100

  // Validação amigável ANTES da escrita (a condição no filtro ainda protege
  // contra corrida depois dela)
  if (saldoOrigem < valor) {
    return { ok: false, motivo: 'saldo_insuficiente', origem: campoOrigem, saldoOrigem }
  }

  const colecao = await obterColecaoRpg()
  const resultado = await colecao.updateOne(
    { jid: jogador.jid, [campoOrigem]: { $gte: valor } },
    { $inc: depositar ? { carteira: -valor, banco: valor } : { banco: -valor, carteira: valor } }
  )

  if ((resultado?.modifiedCount ?? 0) !== 1) {
    // Corrida: o saldo mudou entre a leitura e a escrita
    return { ok: false, motivo: 'saldo_insuficiente', origem: campoOrigem, saldoOrigem }
  }

  const delta = depositar ? -valor : valor
  return {
    ok: true,
    valor,
    direcao,
    saldoCarteira: Math.round(((Number(jogador.carteira) || 0) + delta) * 100) / 100,
    saldoBanco: Math.round(((Number(jogador.banco) || 0) - delta) * 100) / 100
  }
}

// -------------------------------------------------------------------
// 💸 transferirEntreJogadores(jidRemetente, jidDestinatario, valor):
// move `valor` da CARTEIRA do remetente p/ a CARTEIRA do destinatário
// (dinheiro no BANCO fica protegido — intencional p/ o roubo da Fase 7).
//
// Fluxo de segurança (dupla camada):
//   1) Transação MongoDB real (executarTransacao): crédito + débito
//      condicional dentro de uma sessão; qualquer falha → ROLLBACK
//      total (nada é escrito pela metade);
//   2) Sem suporte a transação (standalone/modo teste) → plano
//      compensatório: crédito do destinatário ($inc, atômico por doc),
//      débito do remetente com CONDIÇÃO de saldo (filter $gte —
//      atômico), e se o débito não casar o crédito é REVERTIDO.
// Retorno:
//   { ok: true,  novoSaldoRemetente, novoSaldoDestinatario, transacional }
//   { ok: false, motivo }  (mesmo_jogador | valor_invalido |
//                           saldo_insuficiente | jogador_ausente)
// Lança apenas em falha de infra (rede/banco) — o comando trata.
// -------------------------------------------------------------------
async function transferirEntreJogadores(jidRemetente, jidDestinatario, valor) {
  // 0) Validações de negócio ANTES de qualquer escrita
  const remetente = await getPlayer(jidRemetente)
  const destinatario = await getPlayer(jidDestinatario)

  if (!remetente || !destinatario) return { ok: false, motivo: 'jogador_ausente' }
  if (remetente.jid === destinatario.jid) return { ok: false, motivo: 'mesmo_jogador' }
  if (!Number.isFinite(valor) || valor <= 0) return { ok: false, motivo: 'valor_invalido' }
  if (Number(remetente.carteira || 0) < valor) return { ok: false, motivo: 'saldo_insuficiente' }

  // 💡 Saldos exibidos são calculados (as escritas são condicionais e
  // derivadas desses mesmos valores — em corrida extrema a mensagem pode
  // divergir 1 centavo da leitura posterior, mas o BANCO fica consistente)
  const aplicar = async (colecao, sessao) => {
    const opcoes = sessao ? { session: sessao } : undefined
    // 1) Credita o destinatário ($inc é atômico por documento)
    await colecao.updateOne({ jid: destinatario.jid }, { $inc: { carteira: valor } }, opcoes)
    // 2) Debita o remetente SÓ se ainda tiver saldo (condição no filtro)
    const debito = await colecao.updateOne(
      { jid: remetente.jid, carteira: { $gte: valor } },
      { $inc: { carteira: -valor } },
      opcoes
    )
    if ((debito?.modifiedCount ?? 0) !== 1) {
      // Sem transação: compensa o crédito já aplicado
      if (!sessao) {
        await colecao.updateOne({ jid: destinatario.jid }, { $inc: { carteira: -valor } })
      }
      // Com transação: lança → withTransaction faz ROLLBACK do crédito
      throw new ErroTransferencia('saldo_insuficiente')
    }
    return {
      novoSaldoRemetente: Math.round((Number(remetente.carteira || 0) - valor) * 100) / 100,
      novoSaldoDestinatario: Math.round((Number(destinatario.carteira || 0) + valor) * 100) / 100
    }
  }

  // 1ª tentativa: transação real (rollback automático em falha de negócio)
  try {
    const tx = await executarTransacao((colecao, sessao) => aplicar(colecao, sessao))
    if (tx && tx.transacional) {
      return { ok: true, ...tx.retorno, transacional: true }
    }
  } catch (err) {
    if (err instanceof ErroTransferencia) return { ok: false, motivo: err.motivo }
    if (!err || err.codigo !== 'TRANSACAO_INDISPONIVEL') throw err
    // deployment não suporta transação → fallback compensatório abaixo
  }

  // 2) Fallback: aplicar sem sessão (com compensação manual)
  const colecao = await obterColecaoRpg()
  try {
    const retorno = await aplicar(colecao, null)
    return { ok: true, ...retorno, transacional: false }
  } catch (err) {
    // Falha de negócio no fallback: o crédito aplicado já foi REVERTIDO
    // dentro do `aplicar` (compensação) — devolvemos o motivo amigável em
    // vez de deixar a exceção subir pro comando.
    if (err instanceof ErroTransferencia) return { ok: false, motivo: err.motivo }
    throw err
  }
}

module.exports = { formatarReais, parseValor, ErroTransferencia, moverSaldo, transferirEntreJogadores }
