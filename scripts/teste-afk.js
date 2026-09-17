// 🧪 TESTE DO MÓDULO afk.js — collection fake (padrão scripts/teste-*-mongo.js)
const { definirAfk, removerAfk, buscarAfk, buscarVariosAfk, formatarDuracao, MOTIVO_PADRAO } = require('../afk')

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

;(async () => {
  // 1) Ativação com motivo
  const doc = await definirAfk('5511999999999', 'Trabalhando')
  console.log('✅ ativação:', doc)
  // 2) Motivo padrão
  const doc2 = await definirAfk('5511888888888', '')
  console.log('✅ motivo padrão aplicado:', doc2.motivo === MOTIVO_PADRAO)
  // 3) Atualização (já estava AFK → sobrescreve motivo/desde)
  await new Promise((r) => setTimeout(r, 10))
  const doc3 = await definirAfk('5511999999999', 'Almoçando')
  console.log('✅ atualização:', doc3.motivo === 'Almoçando' && doc3.desde > doc.desde)
  // 4) Consulta múltipla ($in)
  const mapa = await buscarVariosAfk(['5511999999999', '5511888888888', '5511777777777'])
  console.log('✅ buscarVariosAfk size:', mapa.size === 2)
  // 5) Remoção (driver 6.x: findOneAndDelete devolve o doc direto)
  const removido = await removerAfk('5511999999999')
  console.log('✅ remoção:', removido.motivo === 'Almoçando')
  console.log('✅ após remover, buscarAfk → null:', (await buscarAfk('5511999999999')) === null)
  // 6) Formatação de tempo
  console.log('✅ formatarDuracao(5min):', formatarDuracao(5 * 60000) === '5 minutos')
  console.log('✅ formatarDuracao(2h10):', formatarDuracao(130 * 60000) === '2 horas e 10 minutos')
  console.log('✅ formatarDuracao(1d3h):', formatarDuracao(27 * 3600000) === '1 dia e 3 horas')
  console.log('✅ formatarDuracao(<1min):', formatarDuracao(3000) === 'menos de 1 minuto')
  console.log('✅ formatarDuracao(1h exato):', formatarDuracao(3600000) === '1 hora')

  // 7) COMANDO /afk de ponta a ponta (sock fake, sem rede)
  const comandoAfk = require('../comandos/afk')
  const enviados = []
  const sockFake = { async sendMessage(jid, conteudo) { enviados.push({ jid, conteudo }) } }
  const msgFake = { key: { remoteJid: '12036@g.us', participant: '5511999999999@s.whatsapp.net' }, pushName: 'João' }
  await comandoAfk.executar(sockFake, '12036@g.us', msgFake, '/afk Vou almoçar')
  console.log('✅ comando /afk com motivo:', enviados[0]?.conteudo?.text?.includes('Vou almoçar') === true)
  const docAposComando = await buscarAfk('5511999999999')
  console.log('✅ gravado no banco pelo comando:', docAposComando.motivo === 'Vou almoçar')
  await comandoAfk.executar(sockFake, '12036@g.us', msgFake, '/afk')
  const docAtualizado = await buscarAfk('5511999999999')
  console.log('✅ /afk sem motivo → padrão:', docAtualizado.motivo === MOTIVO_PADRAO)

  process.exit(0)
})().catch((err) => { console.error('❌ FALHA NO TESTE:', err); process.exit(1) })
