// ============================================================
// 🧪 teste-ranking-registro.js — o /ranking gravando pelo NÚMERO REAL
// ============================================================
// Cobre os 3 papéis do ranking-registro.js (gravação, resolução e agrupamento)
// 100% offline: o `registrarMensagem` do database.js e o `resolverNumeroAlvo`/
// `resolverNumeroDeDigitos` do lid.js são trocados por dublês no próprio objeto
// de módulo (mesmo truque de teste-corvip.js).
//
// ⚠️ MONGODB_URI é zerada no TOPO (antes de qualquer require do projeto): o
// config.js carrega o .env da raiz e, sem isso, o harness pegaria o Atlas real.
//
// Cobre: LID com mapeamento → grava pelo telefone; LID sem mapeamento → grava
// pelo LID e MARCA o campo `lid`; telefone direto → sem `extras`; falha da
// resolução → não lança e grava o bruto; falha do banco → não lança; NUNCA
// consulta metadado de grupo; agrupamento soma LID+telefone da mesma pessoa,
// ordena por total e junta os `ids`.
// Uso: node scripts/teste-ranking-registro.js
// ============================================================

process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''

const database = require('../database')
const lid = require('../lid')
const registro = require('../ranking-registro')

const LID = '175952680210489'
const NUMERO = '554184062975'
const GRUPO = '120363000000000001@g.us'

let reprovadas = 0
async function testar (nome, fn) {
  try {
    await fn()
    console.log('PASSOU: ' + nome)
  } catch (err) {
    reprovadas += 1
    console.log('FALHOU: ' + nome + ' :: ' + (err?.message || err))
  }
}
function exigir (cond, detalhe) { if (!cond) throw new Error(detalhe || 'condicao falsa') }

// ─── 🎭 Dublês: o que o módulo gravou e que "metadados" foram pedidos ───
let registros = []
let chamadasDeMeta = 0
let mapaDaSessao = new Map()
let falharResolucao = false
let falharBanco = false

database.registrarMensagem = async (...args) => {
  if (falharBanco) throw new Error('banco fora do ar')
  registros.push(args)
  return true
}
// 🎭 Dublês FIÉIS ao lid.js de verdade:
//   resolverNumeroAlvo      → decide pelo sufixo: sem @lid é via 'direto'; com
//                            @lid vai aos metadados e DEPOIS ao mapeamento.
//   resolverNumeroDeDigitos → decide pelos DÍGITOS (o banco já guardou só eles):
//                           participantAchado? usa o phoneNumber; senão tenta o
//                            mapeamento da sessão; senão devolve os dígitos.
// ⚠️ `chamadasDeMeta` conta participante USADO na resolução: se o
// registrarComNumeroReal passar a mandar participantes, este dublê acusa (um
// metadado por mensagem seria um IQ de rede em CADA mensagem recebida).
function resolverFake (participantes, alvoBruto, porJid) {
  if (falharResolucao) throw new Error('resolução quebrada')
  const texto = String(alvoBruto || '').trim()
  const digitos = database.normalizarId(texto)

  // 1) Participante da lista (o lid.js casa pelo `id` normalizado)
  if (Array.isArray(participantes)) {
    for (const p of participantes) {
      if (database.normalizarId(p?.id) !== digitos) continue
      chamadasDeMeta += 1
      const telefone = database.normalizarId(p?.phoneNumber)
      return telefone ? { numero: telefone, via: 'metadados' } : { numero: digitos, via: 'direto' }
    }
  }

  // 2) Jid que não é @lid já é o número real (só no caminho por JID)
  if (porJid && !texto.endsWith('@lid')) return { numero: digitos, via: 'direto' }

  // 3) Mapeamento da sessão fake
  const telefone = mapaDaSessao.get(digitos)
  return telefone ? { numero: telefone, via: 'mapeamento' } : { numero: digitos, via: null }
}

lid.resolverNumeroAlvo = (participantes, jidBruto) => resolverFake(participantes, jidBruto, true)
lid.resolverNumeroDeDigitos = (participantes, idBruto) => resolverFake(participantes, idBruto, false)

function limparDubles () {
  registros = []
  chamadasDeMeta = 0
  mapaDaSessao = new Map()
  falharResolucao = false
  falharBanco = false
}


async function main () {
  console.log('Teste offline do ranking-registro.js (gravação pelo número real)')

  await testar('exports: limite de agrupamento, gravação, resolução e agrupamento', async () => {
    exigir(registro.LIMITE_BUSCA_AGRUPAMENTO === 40, 'limite de busca inesperado: ' + registro.LIMITE_BUSCA_AGRUPAMENTO)
    exigir(registro.LIMITE_BUSCA_AGRUPAMENTO > 10, 'o limite precisa ser maior que o top exibido')
    exigir(typeof registro.registrarComNumeroReal === 'function', 'sem registrarComNumeroReal')
    exigir(typeof registro.resolverNumeros === 'function', 'sem resolverNumeros')
    exigir(typeof registro.agruparPorNumero === 'function', 'sem agruparPorNumero')
  })

  await testar('LID com mapeamento: grava pelo NÚMERO REAL e não marca o campo lid', async () => {
    limparDubles()
    mapaDaSessao.set(LID, NUMERO)
    await registro.registrarComNumeroReal(GRUPO, LID + '@lid', 'João')

    exigir(registros.length === 1, 'deveria ter gravado 1 vez: ' + registros.length)
    const [grupo, usuario, nome, extras] = registros[0]
    exigir(grupo === GRUPO, 'grupo errado: ' + grupo)
    exigir(usuario === NUMERO, 'não gravou pelo número real: ' + usuario)
    exigir(nome === 'João', 'nome não repassado: ' + nome)
    exigir(!extras || !extras.lid, 'não deveria marcar lid quando resolveu: ' + JSON.stringify(extras))
  })

  await testar('LID SEM mapeamento: grava pelo LID e MARCA o campo lid (migrável depois)', async () => {
    limparDubles()
    await registro.registrarComNumeroReal(GRUPO, LID + '@lid', 'Maria')

    const [, usuario, , extras] = registros[0]
    exigir(usuario === LID, 'deveria manter o LID: ' + usuario)
    exigir(extras && extras.lid === LID, 'faltou o campo auxiliar lid: ' + JSON.stringify(extras))
  })

  await testar('telefone direto: grava pelo número e sem extras', async () => {
    limparDubles()
    await registro.registrarComNumeroReal(GRUPO, NUMERO + '@s.whatsapp.net', 'Ana')

    const [, usuario, , extras] = registros[0]
    exigir(usuario === NUMERO, 'não gravou pelo número: ' + usuario)
    exigir(!extras || !extras.lid, 'não deveria marcar lid num telefone direto')
  })

  await testar('resolução quebrada: NÃO lança e grava o identificador bruto', async () => {
    limparDubles()
    falharResolucao = true
    await registro.registrarComNumeroReal(GRUPO, LID + '@lid', 'Zé')
    falharResolucao = false

    exigir(registros.length === 1, 'deveria ter gravado apesar da falha: ' + registros.length)
    const [, usuario, , extras] = registros[0]
    exigir(usuario === LID, 'não preservou o bruto: ' + usuario)
    exigir(extras && extras.lid === LID, 'mesmo falhando, o lid precisa ficar marcado')
  })

  await testar('banco fora do ar: NÃO lança (o fluxo do bot não pode parar)', async () => {
    limparDubles()
    falharBanco = true
    const resposta = await registro.registrarComNumeroReal(GRUPO, NUMERO + '@s.whatsapp.net', 'Beto')
    falharBanco = false
    exigir(resposta === null, 'deveria devolver null em falha, não levantar: ' + JSON.stringify(resposta))
  })

  await testar('nunca consulta METADADOS de grupo (seria um IQ por mensagem)', async () => {
    limparDubles()
    mapaDaSessao.set(LID, NUMERO)
    await registro.registrarComNumeroReal(GRUPO, LID + '@lid', 'João')
    await registro.registrarComNumeroReal(GRUPO, NUMERO + '@s.whatsapp.net', 'João')
    exigir(chamadasDeMeta === 0, 'consultou metadados ' + chamadasDeMeta + ' vez(es)')
  })

  await testar('resolverNumeros: idCru → número real, desconhecido fica como veio', async () => {
    limparDubles()
    mapaDaSessao.set(LID, NUMERO)
    const mapa = await registro.resolverNumeros([], [LID, NUMERO, '5511999990000', ''])
    exigir(mapa.get(LID) === NUMERO, 'LID não resolveu: ' + mapa.get(LID))
    exigir(mapa.get(NUMERO) === NUMERO, 'telefone foi alterado: ' + mapa.get(NUMERO))
    exigir(mapa.get('5511999990000') === '5511999990000', 'inventou número: ' + mapa.get('5511999990000'))
    exigir(!mapa.has(''), 'id vazio entrou no mapa')
    exigir(chamadasDeMeta === 0, 'resolverNumeros pediu metadados')
  })

  await testar('resolverNumeros com participantes: usa a lista e não a sessão', async () => {
    limparDubles()
    const participantes = [{ id: LID + '@lid', phoneNumber: NUMERO + '@s.whatsapp.net' }]
    const mapa = await registro.resolverNumeros(participantes, [LID])
    exigir(mapa.get(LID) === NUMERO, 'não resolveu pelo participante: ' + mapa.get(LID))
    exigir(chamadasDeMeta === 1, 'a lista de participantes deveria ter sido usada 1 vez: ' + chamadasDeMeta)
  })

  await testar('resolverNumeros com a resolução quebrada: devolve o id cru e não lança', async () => {
    limparDubles()
    falharResolucao = true
    const mapa = await registro.resolverNumeros([], [LID])
    falharResolucao = false
    exigir(mapa.get(LID) === LID, 'não preservou o id cru: ' + mapa.get(LID))
  })

  await testar('agruparPorNumero: a MESMA pessoa (LID + telefone) vira 1 linha com a SOMA', async () => {
    const numeros = new Map([[LID, NUMERO]])
    const itens = [
      { usuario_id: LID, nome: 'Nome Antigo', total: 7, ultimaMensagem: 100 },
      { usuario_id: NUMERO, nome: 'Nome Novo', total: 5, ultimaMensagem: 900 }
    ]
    const grupos = registro.agruparPorNumero(itens, numeros)

    exigir(grupos.length === 1, 'a pessoa foi duplicada: ' + grupos.length)
    exigir(grupos[0].usuario_id === NUMERO, 'a chave deveria ser o número resolvido: ' + grupos[0].usuario_id)
    exigir(grupos[0].total === 12, 'total não somado: ' + grupos[0].total)
    exigir(grupos[0].nome === 'Nome Novo', 'o nome do registro mais novo não valeu: ' + grupos[0].nome)
    exigir(grupos[0].ultimaMensagem === 900, 'ultimaMensagem errada: ' + grupos[0].ultimaMensagem)
    exigir(grupos[0].ids.length === 2 && grupos[0].ids.includes(LID) && grupos[0].ids.includes(NUMERO),
      'os ids da pessoa não foram guardados: ' + JSON.stringify(grupos[0].ids))
  })

  await testar('agruparPorNumero: ordena do MAIOR total para o menor', async () => {
    const grupos = registro.agruparPorNumero([
      { usuario_id: '5511000000001', nome: 'C', total: 3 },
      { usuario_id: '5511000000002', nome: 'A', total: 30 },
      { usuario_id: '5511000000003', nome: 'B', total: 10 }
    ], new Map())
    exigir(grupos.map((g) => g.total).join(',') === '30,10,3', 'ordem errada: ' + grupos.map((g) => g.total).join(','))
  })

  await testar('agruparPorNumero: sem mapa de resolução agrupa pelo próprio id cru', async () => {
    const grupos = registro.agruparPorNumero([{ usuario_id: LID, nome: 'X', total: 4 }], new Map())
    exigir(grupos.length === 1 && grupos[0].usuario_id === LID, 'não preservou o id cru: ' + JSON.stringify(grupos))
  })

  await testar('agruparPorNumero: entradas inválidas não quebram (nada/vazio/sem id)', async () => {
    const grupos = registro.agruparPorNumero([null, undefined, {}, { usuario_id: '' }, { usuario_id: '5511', total: '7' }], new Map())
    exigir(grupos.length === 1, 'sobrou lixo no agrupamento: ' + JSON.stringify(grupos))
    exigir(grupos[0].total === 7, 'total textual virou NaN: ' + grupos[0].total)
  })

  console.log(reprovadas === 0 ? 'TODOS PASSARAM' : reprovadas + ' FALHARAM')
  process.exit(reprovadas === 0 ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })

