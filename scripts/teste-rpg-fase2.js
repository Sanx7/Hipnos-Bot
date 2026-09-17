// 🧪 TESTE DA FASE 2 DO RPG — economia (/carteira, /depositar, /sacar, /transferir)
// 100% offline (sem rede), mesmo padrão de scripts/teste-rpg-fase1.js e
// scripts/teste-afk.js: injeta uma collection FAKE via __definirColecaoTeste
// e roda os comandos de ponta a ponta com um sock fake.
const { __definirColecaoTeste } = require('../rpg/database')
const { __definirConsultaSessaoTeste } = require('../lid')
const { formatarReais, parseValor, transferirEntreJogadores } = require('../rpg/economia')

// ── Collection fake: cobre APENAS o que o RPG usa hoje ──
//   findOne({ jid })                          (getPlayer)
//   updateOne({ jid }, { $setOnInsert })      (getPlayer — upsert)
//   updateOne({ jid, campo: { $gte } }, $inc) (moverSaldo / transferência)
const armazenamento = new Map()

function casa(doc, filtro) {
  if (!doc) return false
  for (const [campo, condicao] of Object.entries(filtro)) {
    if (condicao && typeof condicao === 'object' && '$gte' in condicao) {
      if (!(Number(doc[campo]) >= Number(condicao.$gte))) return false
    } else if (doc[campo] !== condicao) return false
  }
  return true
}
const acharPorFiltro = (filtro) => [...armazenamento.values()].find((d) => casa(d, filtro)) || null
const arredondar = (n) => Math.round((Number(n) || 0) * 100) / 100

// 💥 Injeção de falha p/ provar a COMPENSAÇÃO da transferência: ligado, o
// próximo DÉBITO (carteira negativa) devolve modifiedCount 0 — exatamente o
// que aconteceria numa corrida em que o saldo acabasse entre a leitura e a
// escrita. O crédito feito antes dele tem de ser REVERTIDO.
let falharProximoDebito = false

const fakeColecao = {
  async findOne(filtro) {
    const doc = acharPorFiltro(filtro)
    return doc ? { ...doc } : null
  },
  async find() {
    return { async toArray() { return [...armazenamento.values()] } }
  },
  async updateOne(filtro, atualizacao) {
    const doc = acharPorFiltro(filtro)
    if (doc) {
      if (falharProximoDebito && atualizacao?.$inc && Number(atualizacao.$inc.carteira) < 0) {
        falharProximoDebito = false
        return { matchedCount: 0, modifiedCount: 0 }
      }
      if (atualizacao?.$set) Object.assign(doc, atualizacao.$set)
      if (atualizacao?.$setOnInsert) {
        for (const [k, v] of Object.entries(atualizacao.$setOnInsert)) if (!(k in doc)) doc[k] = v
      }
      if (atualizacao?.$inc) {
        for (const [k, v] of Object.entries(atualizacao.$inc)) doc[k] = arredondar((Number(doc[k]) || 0) + v)
      }
      return { matchedCount: 1, modifiedCount: 1 }
    }
    // Upsert do getPlayer (jogador ainda não existe)
    if (filtro.jid && (atualizacao?.$setOnInsert || atualizacao?.$set)) {
      const novo = { ...(atualizacao.$setOnInsert || {}), ...(atualizacao.$set || {}), jid: filtro.jid }
      armazenamento.set(filtro.jid, novo)
      return { matchedCount: 0, modifiedCount: 1, upsertedCount: 1 }
    }
    return { matchedCount: 0, modifiedCount: 0 }
  }
}

__definirColecaoTeste(fakeColecao)
// Sem mapeamento LID na sessão (a resolução por metadados continua valendo)
__definirConsultaSessaoTeste(async () => null)

const { executar: carteira, aliases: aliasesCarteira } = require('../comandos/rpg/carteira')
const { executar: depositar } = require('../comandos/rpg/depositar')
const { executar: sacar } = require('../comandos/rpg/sacar')
const { executar: transferir, aliases: aliasesTransferir } = require('../comandos/rpg/transferir')

const GRUPO = '12036@g.us'
const enviados = []
const sockFake = {
  async sendMessage(jid, conteudo) {
    enviados.push({ jid, texto: conteudo?.text || '', mentions: conteudo?.mentions })
    return {}
  },
  // Metadados usados p/ resolver menção "@lid" (mesma estratégia do /darvip)
  async groupMetadata() {
    return {
      participants: [
        { id: '111111@lid', phoneNumber: '5511977776666@s.whatsapp.net' },
        { id: '5511977776666@s.whatsapp.net' }
      ]
    }
  }
}
const msgDe = (sender, contextInfo) => ({
  key: { remoteJid: GRUPO, participant: sender },
  message: { extendedTextMessage: { text: 'x', ...(contextInfo ? { contextInfo } : {}) } },
  pushName: 'Teste'
})

function semear(numero, valorCarteira, valorBanco) {
  const jid = numero.includes('@') ? numero : `${numero}@s.whatsapp.net`
  armazenamento.set(jid, {
    jid, nome: null, genero: null, carteira: valorCarteira, banco: valorBanco,
    fama: 0, fome: 100, energia: 100
  })
  return jid
}
const saldosDe = (jid) => {
  const d = armazenamento.get(jid)
  return d ? { carteira: d.carteira, banco: d.banco } : null
}

let ok = 0
let falhou = 0
function checar(rotulo, condicao) {
  if (condicao) { ok += 1; console.log('✅', rotulo) } else { falhou += 1; console.log('❌', rotulo) }
}
const ultimo = () => enviados.at(-1)

;(async () => {
  // ══════════ 1) /carteira (unificado: carteira + banco + total) ══════════
  const A = semear('5511911112222', 1234.5, 500)
  const msgA = msgDe(A)

  await carteira(sockFake, GRUPO, msgA)
  const txtCarteira = ultimo().texto
  checar('/carteira mostra a CARTEIRA formatada (R$ 1.234,50)', txtCarteira.includes(formatarReais(1234.5)))
  checar('/carteira mostra o BANCO formatado (R$ 500,00)', txtCarteira.includes(formatarReais(500)))
  checar('/carteira mostra o TOTAL somado (R$ 1.734,50)', txtCarteira.includes(formatarReais(1734.5)))
  checar('/carteira → /banco e /saldo são aliases do MESMO comando', aliasesCarteira.includes('banco') && aliasesCarteira.includes('saldo'))

  // ══════════ 2) /depositar — carteira → banco ══════════
  await depositar(sockFake, GRUPO, msgA, '/depositar 100')
  checar('depositar 100 → carteira 1134,50', saldosDe(A).carteira === 1134.5)
  checar('depositar 100 → banco 600', saldosDe(A).banco === 600)
  checar('depositar 100 → confirmação com valor formatado', ultimo().texto.includes(formatarReais(100)))

  const B = semear('5511933334444', 2000, 0)
  const msgB = msgDe(B)
  await depositar(sockFake, GRUPO, msgB, '/depositar 1.234,56')
  checar('depositar 1.234,56 (formato BR) → carteira 765,44', saldosDe(B).carteira === 765.44)
  checar('depositar 1.234,56 (formato BR) → banco 1234,56', saldosDe(B).banco === 1234.56)

  await depositar(sockFake, GRUPO, msgB, '/depositar abc')
  checar('depositar "abc" → valor inválido', ultimo().texto.includes('Valor inválido'))
  await depositar(sockFake, GRUPO, msgB, '/depositar 0')
  checar('depositar 0 → valor inválido', ultimo().texto.includes('Valor inválido'))
  await depositar(sockFake, GRUPO, msgB, '/depositar -50')
  checar('depositar -50 → valor inválido', ultimo().texto.includes('Valor inválido'))
  await depositar(sockFake, GRUPO, msgB, '/depositar')
  checar('depositar sem argumento → mensagem de uso', ultimo().texto.includes('Como depositar'))
  await depositar(sockFake, GRUPO, msgB, '/depositar 999999')
  checar('depositar acima do saldo → saldo insuficiente', ultimo().texto.includes('Saldo insuficiente'))
  checar('depositar acima do saldo → NADA foi movido', saldosDe(B).carteira === 765.44 && saldosDe(B).banco === 1234.56)

  await depositar(sockFake, GRUPO, msgB, '/depositar todos')
  checar('depositar todos → carteira zerada', saldosDe(B).carteira === 0)
  checar('depositar todos → banco com o total (2000)', saldosDe(B).banco === 2000)
  await depositar(sockFake, GRUPO, msgB, '/depositar tudo')
  checar('depositar tudo com carteira vazia → aviso de carteira vazia', ultimo().texto.includes('carteira está vazia'))

  // ═════════ 3) /sacar — banco → carteira ═════════
  await sacar(sockFake, GRUPO, msgB, '/sacar 100')
  checar('sacar 100 → banco 1900', saldosDe(B).banco === 1900)
  checar('sacar 100 → carteira 100', saldosDe(B).carteira === 100)
  await sacar(sockFake, GRUPO, msgB, '/sacar todos')
  checar('sacar todos → banco zerado', saldosDe(B).banco === 0)
  checar('sacar todos → carteira com o total (2000)', saldosDe(B).carteira === 2000)
  await sacar(sockFake, GRUPO, msgB, '/sacar 50')
  checar('sacar sem saldo no banco → saldo insuficiente', ultimo().texto.includes('Saldo insuficiente no banco'))
  await sacar(sockFake, GRUPO, msgB, '/sacar abc')
  checar('sacar "abc" → valor inválido', ultimo().texto.includes('Valor inválido'))
  await sacar(sockFake, GRUPO, msgB, '/sacar')
  checar('sacar sem argumento → mensagem de uso', ultimo().texto.includes('Como sacar'))

  // ═════════ 4) /transferir — carteira → carteira ═════════
  const DESTINO = '5511966665555@s.whatsapp.net'
  armazenamento.get(A).carteira = 1000
  armazenamento.get(A).banco = 0

  // 4.1 Menção direta (contextInfo.mentionedJid) — alvo que NUNCA usou o RPG
  await transferir(sockFake, GRUPO, msgDe(A, { mentionedJid: [DESTINO] }), '/transferir @alvo 250')
  checar('transferir 250 p/ menção → remetente 750', saldosDe(A).carteira === 750)
  checar('transferir → alvo criado automaticamente com 250', saldosDe(DESTINO)?.carteira === 250)
  checar('transferir → confirmação com valor formatado', ultimo().texto.includes(formatarReais(250)))
  checar('transferir → aviso enviado ao destinatário (best-effort)', enviados.at(-2).jid === GRUPO && ultimo().jid === DESTINO && ultimo().texto.includes('VOCÊ RECEBEU'))
  checar('transferir → aliases /transf e /pix registrados', aliasesTransferir.includes('transf') && aliasesTransferir.includes('pix'))

  // 4.2 Transferir para si mesmo
  await transferir(sockFake, GRUPO, msgDe(A, { mentionedJid: [A] }), '/transferir @eu 10')
  checar('transferir para si mesmo → recusado', ultimo().texto.includes('não pode transferir dinheiro para si mesmo'))
  checar('transferir para si mesmo → saldo intacto', saldosDe(A).carteira === 750)

  // 4.3 Valor inválido e saldo insuficiente
  await transferir(sockFake, GRUPO, msgDe(A, { mentionedJid: [DESTINO] }), '/transferir @x abc')
  checar('transferir "abc" → valor inválido', ultimo().texto.includes('Valor inválido'))
  await transferir(sockFake, GRUPO, msgDe(A, { mentionedJid: [DESTINO] }), '/transferir @x 999999999')
  checar('transferir acima do saldo → saldo insuficiente', ultimo().texto.includes('Saldo insuficiente na carteira'))
  checar('transferir acima do saldo → NADA foi movido', saldosDe(A).carteira === 750 && saldosDe(DESTINO).carteira === 250)

  // 4.4 Sem alvo nenhum → mensagem de uso
  await transferir(sockFake, GRUPO, msgA, '/transferir')
  checar('transferir sem alvo → mensagem de uso', ultimo().texto.includes('Como transferir'))

  // 4.5 Número digitado (sem menção) — alvo novo criado automaticamente
  await transferir(sockFake, GRUPO, msgA, '/transferir 5511988887777 100')
  checar('transferir p/ número digitado → remetente 650', saldosDe(A).carteira === 650)
  checar('transferir p/ número digitado → alvo criado com 100', saldosDe('5511988887777@s.whatsapp.net')?.carteira === 100)

  // 4.6 Respondendo (reply) — contextInfo.participant
  const ALVO_REPLY = '5511955554444@s.whatsapp.net'
  await transferir(sockFake, GRUPO, msgDe(A, { participant: ALVO_REPLY }), '/transferir 50')
  checar('transferir respondendo → alvo creditado com 50', saldosDe(ALVO_REPLY)?.carteira === 50)
  checar('transferir respondendo → remetente 600', saldosDe(A).carteira === 600)

  // 4.7 "todos" envia o saldo INTEIRO da carteira
  await transferir(sockFake, GRUPO, msgDe(A, { mentionedJid: [DESTINO] }), '/transferir @x todos')
  checar('transferir todos → carteira zerada', saldosDe(A).carteira === 0)
  checar('transferir todos → alvo com 850 (250 + 600)', saldosDe(DESTINO).carteira === 850)

  // 4.8 Menção "@lid" resolvida pelos METADADOS do grupo (lid.js)
  armazenamento.get(A).carteira = 500
  await transferir(sockFake, GRUPO, msgDe(A, { mentionedJid: ['111111@lid'] }), '/transferir @111111 300')
  checar('transferir p/ @lid → número REAL creditado (metadados)', saldosDe('5511977776666@s.whatsapp.net')?.carteira === 300)
  checar('transferir p/ @lid → NADA gravado no jid @lid', armazenamento.get('111111@lid') === undefined)
  checar('transferir p/ @lid → remetente 200', saldosDe(A).carteira === 200)

  // 4.9 Menção "@lid" NÃO resolvível → recusa (nunca grava LID)
  await transferir(sockFake, GRUPO, msgDe(A, { mentionedJid: ['222222@lid'] }), '/transferir @222222 100')
  checar('transferir p/ @lid irresolvível → recusado com aviso claro', ultimo().texto.includes('Não consegui identificar o número real'))
  checar('transferir p/ @lid irresolvível → nada gravado e saldo intacto', armazenamento.get('222222@lid') === undefined && saldosDe(A).carteira === 200)

  // 4.10 💥 COMPENSAÇÃO: débito falha (corrida) depois do crédito → crédito revertido
  armazenamento.get(A).carteira = 300
  falharProximoDebito = true
  await transferir(sockFake, GRUPO, msgDe(A, { mentionedJid: [DESTINO] }), '/transferir @x 100')
  checar('corrida no débito → transferência RECUSADA', ultimo().texto.includes('Saldo insuficiente na carteira'))
  checar('corrida no débito → crédito do alvo REVERTIDO (850)', saldosDe(DESTINO).carteira === 850)
  checar('corrida no débito → remetente intacto (300)', saldosDe(A).carteira === 300)

  // ═════════ 5) Helpers de economia (unidade) ═════════
  checar('formatarReais(1234.56) em padrão BR', /^R\$\s?1\.234,56$/.test(formatarReais(1234.56)))
  checar('formatarReais(0) → R$ 0,00', /^R\$\s?0,00$/.test(formatarReais(0)))
  checar('formatarReais usa espaço COMUM (sem U+00A0 do Intl)', !/\u00a0/.test(formatarReais(1234.56)) && formatarReais(1234.56).includes('R$ 1.234,56'))
  checar('formatarReais(undefined) não quebra', /^R\$\s?0,00$/.test(formatarReais(undefined)))
  checar('parseValor("todos") e ("TUDO") → todos', parseValor('todos') === 'todos' && parseValor('TUDO') === 'todos')
  checar('parseValor("1.234,56") → 1234.56', parseValor('1.234,56') === 1234.56)
  checar('parseValor("1234.56") → 1234.56', parseValor('1234.56') === 1234.56)
  checar('parseValor inválidos → null', parseValor('abc') === null && parseValor('0') === null && parseValor('-5') === null && parseValor('') === null)

  // ═════════ 6) Formato de export + erro de infra não derruba o bot ═════════
  checar('os 4 comandos expõem executar() async', [carteira, depositar, sacar, transferir].every((m) => typeof m === 'function'))
  checar('nomes/aliases sem colisão entre os comandos novos', aliasesCarteira.every((a) => !aliasesTransferir.includes(a)))

  // Banco fora do ar: getPlayer lança → o comando avisa e NÃO derruba
  falharProximoDebito = false
  __definirColecaoTeste({ async findOne() { throw new Error('Mongo fora do ar') }, async updateOne() { throw new Error('Mongo fora do ar') } })
  await carteira(sockFake, GRUPO, msgA)
  checar('erro de Mongo em /carteira → mensagem amigável (sem crash)', ultimo().texto.includes('Não consegui abrir seu cofre'))
  await depositar(sockFake, GRUPO, msgA, '/depositar 10')
  checar('erro de Mongo em /depositar → mensagem amigável (sem crash)', ultimo().texto.includes('Não consegui registrar seu depósito'))
  __definirColecaoTeste(fakeColecao) // restaura p/ os testes seguintes

  // Transferência sem sessão (modo teste → TRANSACAO_INDISPONIVEL) já
  // exercitou o fallback compensatório nos itens acima; aqui garantimos que
  // a função devolve motivo (e não lança) quando o saldo não bate.
  const semSaldo = await transferirEntreJogadores('5511900001111', DESTINO, 999)
  checar('transferirEntreJogadores sem saldo → { ok:false, saldo_insuficiente }', semSaldo.ok === false && semSaldo.motivo === 'saldo_insuficiente')

  console.log(`\n📊 Resultado: ${ok} ✅ | ${falhou} ❌`)
  process.exit(falhou ? 1 : 0)
})().catch((err) => { console.error('❌ FALHA NO TESTE:', err); process.exit(1) })