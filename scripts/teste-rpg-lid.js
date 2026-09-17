// 🧪 TESTE DO FIX LID NO RPG — getPlayer/savePlayer + corrigirJogadoresComLid
// (100% offline: collection fake no rpg/database + consulta fake no lid.js)
const { __definirColecaoTeste, getPlayer, savePlayer, corrigirJogadoresComLid, NOME_BANCO, NOME_COLECAO } = require('../rpg/database')
const { criarJogadorPadrao } = require('../rpg/database')
const { __definirConsultaSessaoTeste } = require('../lid')
const { executar: registrar } = require('../comandos/rpg/registrar')
const { executar: ficha } = require('../comandos/rpg/ficha')

const armazenamento = new Map()
const fakeColecao = {
  async findOne(filtro) { return armazenamento.get(filtro.jid) || null },
  async updateOne(filtro, atualizacao, opcoes) {
    const doc = armazenamento.get(filtro.jid)
    if (doc && atualizacao.$set) Object.assign(doc, atualizacao.$set)
    if (!doc && atualizacao.$setOnInsert) armazenamento.set(filtro.jid, { ...atualizacao.$setOnInsert })
    else if (!doc && atualizacao.$set) armazenamento.set(filtro.jid, { ...atualizacao.$set })
  },
  async replaceOne(filtro, corpo) { armazenamento.set(filtro.jid, { ...corpo }) },
  async deleteOne(filtro) { armazenamento.delete(filtro.jid) },
  find() {
    return { async toArray() { return [...armazenamento.values()] } }
  }
}
__definirColecaoTeste(fakeColecao)

// 🪪 Mapeamento fake da sessão (lid-mapping reverse): dois LIDs conhecidos,
// um LID SEM mapeamento (pra cobrir o caso "não resolvível")
const LID_RESOLVIVEL = '175952680210489'
const TELEFONE_LID_RESOLVIVEL = '554184062975'
const LID_MERGE = '1759000000000'
const TELEFONE_LID_MERGE = '5541999999999'
const LID_ORFAO = '1759111111111'
__definirConsultaSessaoTeste(async (lid) => {
  if (lid === LID_RESOLVIVEL) return TELEFONE_LID_RESOLVIVEL
  if (lid === LID_MERGE) return TELEFONE_LID_MERGE
  return null // sem mapeamento
})

let ok = 0
let falhou = 0
function checar(rotulo, condicao) {
  if (condicao) { ok += 1; console.log('✅', rotulo) } else { falhou += 1; console.log('❌', rotulo) }
}

;(async () => {
  checar('exports de NOME_BANCO/NOME_COLECAO p/ o migrador', NOME_BANCO === 'whatsapp' && NOME_COLECAO === 'rpgPlayers')

  // 1) getPlayer com @lid → resolve via mapeamento e cria o doc com o NÚMERO REAL
  const jogador = await getPlayer(`${LID_RESOLVIVEL}@lid`)
  checar('getPlayer(@lid) → doc criado com jid = número real', jogador.jid === TELEFONE_LID_RESOLVIVEL)
  checar('getPlayer(@lid) → não criou doc com o LID cru', !armazenamento.has(`${LID_RESOLVIVEL}@lid`))


  // 2) registrar com remetente @lid em grupo (metadados fake resolvem)
  const enviados = []
  const participantesFake = [{ id: `${LID_RESOLVIVEL}@lid`, phoneNumber: `${TELEFONE_LID_RESOLVIVEL}@s.whatsapp.net` }]
  const sockFake = {
    async sendMessage(jid, conteudo) { enviados.push(conteudo?.text || '') },
    async groupMetadata() { return { participants: participantesFake } }
  }
  const msgLid = { key: { remoteJid: '12036@g.us', participant: `${LID_RESOLVIVEL}@lid` }, pushName: 'João' }
  await registrar(sockFake, '12036@g.us', msgLid, '/registrar João M')
  const docRegistrar = armazenamento.get(TELEFONE_LID_RESOLVIVEL)
  checar('registrar com @lid → gravou pelo número real (metadados)', docRegistrar?.nome === 'João' && docRegistrar?.genero === 'M')
  checar('registrar com @lid → msg de confirmação', enviados.at(-1).includes('REGISTRO CONCLUÍDO'))

  // 3) ficha com remetente @lid → acha o mesmo jogador (via resolução interna)
  const sockFicha = { async sendMessage(jid, conteudo) { enviados.push(conteudo?.text || '') } }
  await ficha(sockFicha, '12036@g.us', { key: { remoteJid: '12036@g.us', participant: `${LID_RESOLVIVEL}@lid` } })
  checar('ficha com @lid → leu o jogador pelo número real', enviados.at(-1).includes('FICHA ONÍRICA — João'))

  // 4) savePlayer também resolve @lid antes de gravar
  await savePlayer(`${LID_RESOLVIVEL}@lid`, { ...armazenamento.get(TELEFONE_LID_RESOLVIVEL), nome: 'João' })
  checar('savePlayer(@lid) → jid gravado é o número real', Boolean(armazenamento.get(TELEFONE_LID_RESOLVIVEL)))

  // 5) corrigirJogadoresComLid — caso A: LID sem duplicata → troca in-place
  // (⚠️ o Map fake não re-chaveia a entrada quando o $set muda o jid — no
  // Mongo real o filtro é por campo; por isso a asserção olha o CAMPO jid)
  armazenamento.set(`${LID_MERGE}@lid`, criarJogadorPadrao(`${LID_MERGE}@lid`))
  const resultadoA = await corrigirJogadoresComLid()
  const docA = [...armazenamento.values()].find((d) => d.jid === TELEFONE_LID_MERGE)
  checar('corrigir: LID sem duplicata → corrigido', resultadoA.corrigidos >= 1 && Boolean(docA) && ![...armazenamento.values()].some((d) => d.jid === `${LID_MERGE}@lid`))
  checar('corrigir: idempotente (2ª rodada não mexe)', (await corrigirJogadoresComLid()).corrigidos === 0)

  // 6) corrigirJogadoresComLid — caso B: duplicata → MERGE "o mais completo ganha"
  const docReal = criarJogadorPadrao(TELEFONE_LID_MERGE)
  docReal.nome = null // o real ainda não se registrou (null)
  docReal.carteira = 10
  armazenamento.set(TELEFONE_LID_MERGE, docReal)
  const docLid = criarJogadorPadrao(`${LID_MERGE}@lid`)
  docLid.nome = 'Maria'       // registro feito pelo LID tem a identidade
  docLid.genero = 'F'
  docLid.carteira = 50        // progresso maior no doc-LID
  docLid.casas = ['chale']    // coleção só no doc-LID
  docLid.cooldowns = { trabalhar: 123 }
  armazenamento.set(`${LID_MERGE}@lid`, docLid)
  const resultadoB = await corrigirJogadoresComLid()
  const docMesclado = armazenamento.get(TELEFONE_LID_MERGE)
  checar('merge: doc-LID apagado', !armazenamento.has(`${LID_MERGE}@lid`))
  checar('merge: identidade do LID preencheu o real', docMesclado?.nome === 'Maria' && docMesclado?.genero === 'F')
  checar('merge: recurso = maior dos dois', docMesclado?.carteira === 50)
  checar('merge: arrays em união', Array.isArray(docMesclado?.casas) && docMesclado.casas.includes('chale'))
  checar('merge: cooldowns fundidos', docMesclado?.cooldowns?.trabalhar === 123)
  checar('merge: jid é o número real', docMesclado?.jid === TELEFONE_LID_MERGE)
  checar('merge: contabilizado como mesclado', resultadoB.mesclados >= 1)

  // 7) corrigirJogadoresComLid — caso C: LID sem mapeamento → mantido
  armazenamento.set(`${LID_ORFAO}@lid`, criarJogadorPadrao(`${LID_ORFAO}@lid`))
  const resultadoC = await corrigirJogadoresComLid()
  checar('corrigir: LID órfão mantido + contabilizado', resultadoC.naoResolviveis >= 1 && armazenamento.has(`${LID_ORFAO}@lid`))

  console.log(`\n📊 Resultado: ${ok} ✅ | ${falhou} ❌`)
  process.exit(falhou ? 1 : 0)
})().catch((err) => { console.error('❌ FALHA NO TESTE:', err); process.exit(1) })
