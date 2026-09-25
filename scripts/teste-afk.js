// 🧪 TESTE DO MÓDULO afk.js + COMANDO /afk + BLOCO DE MENÇÕES (bot.js)
// Cobertura (100% offline, sem rede e sem Mongo real):
//   1-6) persistência (ativar/atualizar/buscar/remover/duração);
//   7) comando /afk de ponta a ponta (número real e @lid na ativação);
//   8) BLOCO DE MENÇÕES (réplica fiel do bot.js, usando resolverJidAfk):
//      menção por número real avisa, menção por @lid avisa (resolvendo
//      via metadados E via mapeamento), menção a quem não está AFK não
//      dispara nada, e o remetente AFK que volta a falar é removido.
// Rodar: node scripts/teste-afk.js
const { definirAfk, removerAfk, buscarAfk, buscarVariosAfk, resolverJidAfk, formatarDuracao, MOTIVO_PADRAO } = require('../afk')
const { __definirConsultaSessaoTeste } = require('../lid')

const armazenamento = new Map()
const fakeColecao = {
  async updateOne(filtro, atualizacao, opcoes) {
    const numero = filtro.numero
    const doc = armazenamento.get(numero) || {}
    Object.assign(doc, atualizacao.$set)
    armazenamento.set(numero, doc)
  },
  async findOneAndDelete(filtro) {
    const doc = armazenamento.get(filtro.numero)
    if (!doc) return null
    armazenamento.delete(filtro.numero)
    return { value: doc }
  },
  async findOne(filtro) {
    return armazenamento.get(filtro.numero) || null
  },
  find(filtro) {
    const lista = filtro.numero.$in.map((n) => armazenamento.get(n)).filter(Boolean)
    return { async toArray() { return lista } }
  }
}
require('../afk').__definirColecaoTeste(fakeColecao)

let total = 0
let falhas = 0
function checar(rotulo, condicao) {
  total++
  if (condicao) console.log('✅', rotulo)
  else { falhas++; console.log('❌', rotulo) }
}

// 🪪 LIDs de teste: um resolvível via METADADOS (phoneNumber), outro só via
// MAPEAMENTO da sessão (lid-mapping), e um ÓRFÃO (sem resolução).
const NUMERO_AFK = '5511999999999'
const LID_METADADOS = '175952680210489'
const LID_MAPEAMENTO = '1759000000001'
const NUMERO_MAPEAMENTO = '5511888888888'
const LID_ORFAO = '1759111111111'
const NUMERO_COMUM = '5511777777777'
__definirConsultaSessaoTeste(async (lid) => {
  if (lid === LID_MAPEAMENTO) return NUMERO_MAPEAMENTO
  return null
})
const participantesFake = [
  { id: `${LID_METADADOS}@lid`, admin: null, phoneNumber: `${NUMERO_AFK}@s.whatsapp.net` }
]

// ─── Réplica fiel do BLOCO AFK do bot.js (menções + volta do remetente) ───
// Usa resolverJidAfk + buscarVariosAfk + removerAfk, igual ao bot.js.
async function simularBlocoAfk({ remetente, mencionados = [], respondido = null, ehComandoAfk = false }) {
  const avisos = []
  const saidas = []
  const sockFake = { async sendMessage(jidDestino, conteudo) { avisos.push(conteudo?.text || '') } }
  const jidsBrutos = [
    ...mencionados,
    ...(!mencionados.length && respondido ? [respondido] : [])
  ].filter(Boolean)
  const numerosAlvo = []
  for (const jidAlvo of jidsBrutos) {
    const { numero } = await resolverJidAfk(participantesFake, jidAlvo)
    if (numero) numerosAlvo.push(numero)
  }
  const { numero: numeroRemetente } = await resolverJidAfk(participantesFake, remetente)
  const candidatos = [numeroRemetente, ...numerosAlvo].filter(Boolean)
  const afkMapa = await buscarVariosAfk(candidatos)
  const docRemetente = afkMapa.get(numeroRemetente)
  if (docRemetente && !ehComandoAfk) {
    await removerAfk(numeroRemetente)
    afkMapa.delete(numeroRemetente)
    saidas.push(`bem-vindo:${numeroRemetente}`)
  }
  for (const numeroAlvo of numerosAlvo) {
    const doc = afkMapa.get(numeroAlvo)
    if (!doc) continue
    const tempoAusente = formatarDuracao(Date.now() - (doc.desde || Date.now()))
    await sockFake.sendMessage('grupo@g.us', {
      text: `💤 @${numeroAlvo} está ausente: ${doc.motivo || MOTIVO_PADRAO}\n⏳ Há ${tempoAusente}.`,
      mentions: numerosAlvo.filter((n) => afkMapa.has(n)).map((n) => `${n}@s.whatsapp.net`)
    })
  }
  return { avisos, saidas }
}

;(async () => {
  // 1) Ativação com motivo
  const doc = await definirAfk('5511999999999', 'Trabalhando')
  checar('ativação grava motivo', doc?.motivo === 'Trabalhando')
  // 2) Motivo padrão
  const doc2 = await definirAfk('5511888888888', '')
  checar('motivo padrão aplicado', doc2.motivo === MOTIVO_PADRAO)
  // 3) Atualização (já estava AFK → sobrescreve motivo/desde)
  await new Promise((r) => setTimeout(r, 10))
  const doc3 = await definirAfk('5511999999999', 'Almoçando')
  checar('atualização sobrescreve motivo/desde', doc3.motivo === 'Almoçando' && doc3.desde > doc.desde)
  // 4) Consulta múltipla ($in)
  const mapa = await buscarVariosAfk(['5511999999999', '5511888888888', '5511777777777'])
  checar('buscarVariosAfk acha os 2 AFKs', mapa.size === 2)
  // 5) Remoção (driver 6.x: findOneAndDelete devolve o doc direto)
  const removido = await removerAfk('5511999999999')
  checar('remoção devolve o doc', removido?.motivo === 'Almoçando')
  checar('após remover, buscarAfk → null', (await buscarAfk('5511999999999')) === null)
  // 6) Formatação de tempo
  checar('formatarDuracao(5min)', formatarDuracao(5 * 60000) === '5 minutos')
  checar('formatarDuracao(2h10)', formatarDuracao(130 * 60000) === '2 horas e 10 minutos')
  checar('formatarDuracao(1d3h)', formatarDuracao(27 * 3600000) === '1 dia e 3 horas')
  checar('formatarDuracao(<1min)', formatarDuracao(3000) === 'menos de 1 minuto')
  checar('formatarDuracao(1h exato)', formatarDuracao(3600000) === '1 hora')

  // 7) COMANDO /afk de ponta a ponta (sock fake, sem rede)
  const comandoAfk = require('../comandos/afk')
  const enviados = []
  const sockFake = {
    async sendMessage(jid, conteudo) { enviados.push({ jid, conteudo }) },
    async groupMetadata() { return { participants: participantesFake } }
  }
  const msgFake = { key: { remoteJid: '12036@g.us', participant: '5511999999999@s.whatsapp.net' }, pushName: 'João' }
  await comandoAfk.executar(sockFake, '12036@g.us', msgFake, '/afk Vou almoçar')
  checar('comando /afk com motivo confirma', enviados[0]?.conteudo?.text?.includes('Vou almoçar') === true)
  const docAposComando = await buscarAfk('5511999999999')
  checar('gravado no banco pelo comando', docAposComando?.motivo === 'Vou almoçar')
  await comandoAfk.executar(sockFake, '12036@g.us', msgFake, '/afk')
  const docAtualizado = await buscarAfk('5511999999999')
  checar('/afk sem motivo → padrão', docAtualizado?.motivo === MOTIVO_PADRAO)

  // 7b) ATIVAÇÃO via @lid (caminho inverso): remetente @lid resolve para o
  // número real ANTES de gravar (não guarda o LID cru).
  await removerAfk(NUMERO_AFK)
  const msgLid = { key: { remoteJid: '12036@g.us', participant: `${LID_METADADOS}@lid` }, pushName: 'João' }
  await comandoAfk.executar(sockFake, '12036@g.us', msgLid, '/afk Reunião')
  const docLid = await buscarAfk(NUMERO_AFK)
  checar('ativar /afk via @lid grava pelo número real', docLid?.motivo === 'Reunião')
  checar('ativar /afk via @lid não grava o LID cru', (await buscarAfk(LID_METADADOS)) === null)

  // 8) BLOCO DE MENÇÕES — ativar AFK e checar os 4 cenários exigidos
  await definirAfk(NUMERO_AFK, 'Foco total')
  await definirAfk(NUMERO_MAPEAMENTO, 'No dentista')

  // 8a) menção por número normal detecta e avisa
  const r1 = await simularBlocoAfk({
    remetente: `${NUMERO_COMUM}@s.whatsapp.net`,
    mencionados: [`${NUMERO_AFK}@s.whatsapp.net`]
  })
  checar('menção por número normal detecta e avisa', r1.avisos.length === 1 && r1.avisos[0].includes(`@${NUMERO_AFK}`) && r1.avisos[0].includes('Foco total'))

  // 8b) menção por @lid (metadados) detecta e avisa
  const r2 = await simularBlocoAfk({
    remetente: `${NUMERO_COMUM}@s.whatsapp.net`,
    mencionados: [`${LID_METADADOS}@lid`]
  })
  checar('menção por @lid (metadados) detecta e avisa', r2.avisos.length === 1 && r2.avisos[0].includes(`@${NUMERO_AFK}`))

  // 8b2) menção por @lid (mapeamento) detecta e avisa
  const r2b = await simularBlocoAfk({
    remetente: `${NUMERO_COMUM}@s.whatsapp.net`,
    mencionados: [`${LID_MAPEAMENTO}@lid`]
  })
  checar('menção por @lid (mapeamento) detecta e avisa', r2b.avisos.length === 1 && r2b.avisos[0].includes(`@${NUMERO_MAPEAMENTO}`))

  // 8c) menção a alguém que NÃO está AFK não dispara nada
  const r3 = await simularBlocoAfk({
    remetente: `${NUMERO_COMUM}@s.whatsapp.net`,
    mencionados: [`${NUMERO_COMUM}@s.whatsapp.net`]
  })
  checar('menção a quem não está AFK não dispara nada', r3.avisos.length === 0)
  const r3b = await simularBlocoAfk({
    remetente: `${NUMERO_COMUM}@s.whatsapp.net`,
    mencionados: [`${LID_ORFAO}@lid`]
  })
  checar('menção @lid órfã (sem AFK) não dispara nada', r3b.avisos.length === 0)

  // 8d) desativar AFK ao voltar a falar (remetente AFK manda msg comum)
  const r4 = await simularBlocoAfk({ remetente: `${NUMERO_AFK}@s.whatsapp.net` })
  checar('remetente AFK que volta a falar é removido', r4.saidas.includes(`bem-vindo:${NUMERO_AFK}`) && r4.avisos.length === 0)
  checar('após voltar, buscarAfk → null', (await buscarAfk(NUMERO_AFK)) === null)

  // 8d2) volta a falar via @lid também remove (remetente resolvido)
  const r4b = await simularBlocoAfk({ remetente: `${LID_MAPEAMENTO}@lid` })
  checar('remetente @lid que volta a falar é removido', r4b.saidas.includes(`bem-vindo:${NUMERO_MAPEAMENTO}`))
  checar('após volta via @lid, buscarAfk → null', (await buscarAfk(NUMERO_MAPEAMENTO)) === null)

  console.log(`\n📊 Resultado: ${total - falhas}/${total} testes passaram`)
  __definirConsultaSessaoTeste(null)
  process.exit(falhas ? 1 : 0)
})().catch((err) => { console.error('❌ FALHA NO TESTE:', err); process.exit(1) })
