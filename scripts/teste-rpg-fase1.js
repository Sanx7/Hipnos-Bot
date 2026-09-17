// 🧪 TESTE DA FASE 1 DO RPG — registrar + ficha (collection fake, sem rede)
// Mesmo padrão de scripts/teste-afk.js: injeta a collection fake via
// __definirColecaoTeste e valida os comandos de ponta a ponta com sock fake.
const { __definirColecaoTeste } = require('../rpg/database')
const { criarJogadorPadrao } = require('../rpg/database')

const armazenamento = new Map()
const fakeColecao = {
  async findOne(filtro) {
    return armazenamento.get(filtro.jid) || null
  },
  async updateOne(filtro, atualizacao, opcoes) {
    const doc = armazenamento.get(filtro.jid)
    if (doc && atualizacao.$set) Object.assign(doc, atualizacao.$set)
    if (!doc && atualizacao.$setOnInsert) armazenamento.set(filtro.jid, { ...atualizacao.$setOnInsert })
    else if (!doc && atualizacao.$set) armazenamento.set(filtro.jid, { ...atualizacao.$set })
  }
}
__definirColecaoTeste(fakeColecao)

const { executar: registrar } = require('../comandos/rpg/registrar')
const { executar: ficha } = require('../comandos/rpg/ficha')

const enviados = []
const sockFake = {
  async sendMessage(jid, conteudo) { enviados.push(conteudo?.text || '') }
}
const msgPara = (senderJid) => ({ key: { remoteJid: '12036@g.us', participant: senderJid }, pushName: 'Teste' })

let ok = 0
let falhou = 0
function checar(rotulo, condicao) {
  if (condicao) { ok += 1; console.log('✅', rotulo) } else { falhou += 1; console.log('❌', rotulo) }
}

;(async () => {
  const remetente = '5511999999999@s.whatsapp.net'
  const msg = msgPara(remetente)

  // 1) Registro válido M
  await registrar(sockFake, '12036@g.us', msg, '/registrar João M')
  const jogador1 = armazenamento.get(remetente)
  checar('registrar João M → nome gravado', jogador1?.nome === 'João')
  checar('registrar João M → genero gravado M', jogador1?.genero === 'M')
  checar('registrar João M → msg "Bem-vindo ao RPG"', enviados.at(-1).includes('Bem-vindo ao RPG, *João*'))

  // 2) Registro válido F com nome composto
  await registrar(sockFake, '12036@g.us', msg, '/registrar Maria Silva F')
  const jogador2 = armazenamento.get(remetente)
  checar('registrar Maria Silva F → nome composto', jogador2?.nome === 'Maria Silva')
  checar('registrar Maria Silva F → genero F', jogador2?.genero === 'F')
  checar('registrar F (re-registro) → msg "Bem-vinda de volta"', enviados.at(-1).includes('Bem-vinda de volta'))

  // 3) Gênero por extenso (masculino/feminino)
  await registrar(sockFake, '12036@g.us', msg, '/registrar Joao Pedro masculino')
  checar('gênero "masculino" → M', armazenamento.get(remetente)?.genero === 'M')
  await registrar(sockFake, '12036@g.us', msg, '/registrar Ana feminino')
  checar('gênero "feminino" → F', armazenamento.get(remetente)?.genero === 'F')

  // 4) Re-registro = atualização livre com aviso
  await registrar(sockFake, '12036@g.us', msg, '/registrar Novo Nome M')
  checar('re-registro → nome trocado', armazenamento.get(remetente)?.nome === 'Novo Nome')
  checar('re-registro → msg de ATUALIZADO', enviados.at(-1).includes('ATUALIZADO'))

  // 5) Validações de erro
  await registrar(sockFake, '12036@g.us', msg, '/registrar J M')
  checar('nome curto (1 char) → erro', enviados.at(-1).includes('limites'))
  const nomeLongo = 'N'.repeat(21)
  await registrar(sockFake, '12036@g.us', msg, `/registrar ${nomeLongo} M`)
  checar('nome longo (21 chars) → erro', enviados.at(-1).includes('limites'))
  await registrar(sockFake, '12036@g.us', msg, '/registrar Joao X')
  checar('gênero inválido → erro', enviados.at(-1).includes('Gênero inválido'))
  await registrar(sockFake, '12036@g.us', msg, '/registrar')
  checar('sem argumentos → mensagem de uso', enviados.at(-1).includes('Como se registrar'))

  // 6) /ficha de jogador registrado
  await registrar(sockFake, '12036@g.us', msg, '/registrar Helena F')
  await ficha(sockFake, '12036@g.us', msg)
  const fichaRegistrada = enviados.at(-1)
  checar('ficha registrada → título com nome', fichaRegistrada.includes('FICHA ONÍRICA — Helena'))
  checar('ficha registrada → sem emprego', fichaRegistrada.includes('sem emprego'))
  checar('ficha registrada → valores default', fichaRegistrada.includes('R$ 0') && fichaRegistrada.includes('18 anos'))
  checar('ficha registrada → barras de status', fichaRegistrada.includes('🟩'))

  // 7) /ficha de jogador NÃO registrado → ficha provisória + convite
  const remetente2 = '5511888888888@s.whatsapp.net'
  await ficha(sockFake, '12036@g.us', msgPara(remetente2))
  const fichaProvisoria = enviados.at(-1)
  checar('ficha sem registro → ficha provisória', fichaProvisoria.includes('FICHA PROVISÓRIA'))
  checar('ficha sem registro → convite ao /registrar', fichaProvisoria.includes('/registrar'))
  checar('ficha sem registro → jogador auto-criado com padrão', armazenamento.get(remetente2)?.idade === criarJogadorPadrao('x').idade)

  console.log(`\n📊 Resultado: ${ok} ✅ | ${falhou} ❌`)
  process.exit(falhou ? 1 : 0)
})().catch((err) => { console.error('❌ FALHA NO TESTE:', err); process.exit(1) })
