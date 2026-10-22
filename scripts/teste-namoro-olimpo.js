// Offline: sem sockets, credenciais reais, MongoDB ou alterações de .env.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
process.env.OWNER_NUMBERS = '00010000001'
require('node:net').Socket.prototype.connect = function () { throw new Error('REDE_PROIBIDA') }
const assert = require('node:assert/strict')
const criarColecao = require('./helpers/colecao-casamento-fake')
const { criarRepositorio, preparar } = require('../dados/casamento-olimpo-mongo')
const sistema = require('../dados/casamento-olimpo')
const lid = require('../lid')
const prefixo = require('../prefixo')
const A = '00010000001', B = '00010000002', C = '00010000003'
const G = '100@g.us', H = '200@g.us', pn = n => `${n}@s.whatsapp.net`
let seq = 0, total = 0
async function contexto() {
  const col = criarColecao(); await preparar(col)
  const repo = criarRepositorio(async () => col), servico = sistema.criarServico(repo)
  const c = { col, repo, servico, participantes: [A, B, C].map(n => ({ id: pn(n) })), respostas: [] }
  c.sock = { groupMetadata: async () => {
    if (c.falharMeta) throw new Error('SINTETICO')
    return { participants: c.participantes }
  }, sendMessage: async (jid, resposta) => { c.respostas.push(resposta); return { key: { id: 'offline' } } } }
  c.msg = (autor = A, alvo, grupo = G, id = `namoro-${++seq}`) => ({ key: {
    id, remoteJid: grupo, participant: grupo.endsWith('@g.us') ? (autor.includes('@') ? autor : pn(autor)) : undefined
  }, message: { extendedTextMessage: { contextInfo: { mentionedJid: alvo ? [alvo.includes('@') ? alvo : pn(alvo)] : [] } } } })
  c.run = (acao, autor = A, alvo, grupo = G, msg, texto) => servico.executar(acao, c.sock, grupo, msg || c.msg(autor, alvo, grupo), texto)
  c.doc = () => col.docs.find(d => d.tipo === 'uniao' && d.bloqueiaParticipantes)
  c.namorar = async () => { await c.run('namorar', A, B); await c.run('aceitarnamoro', B) }
  c.casar = async () => { await c.run('casar', A, B); await c.run('aceitar', B) }
  c.ajustar = (data, autor = A, msg) => c.run('ajustardatacasamento', autor, null, G, msg, `!ajustardatacasamento ${data}`)
  return c
}
async function teste(nome, fn) { await fn(); total++; console.log('OK:', nome) }
const recusa = (p, codigo) => assert.rejects(p, e => e.codigo === codigo)
async function main() {
  prefixo.__definirPrefixoTeste('!')
  lid.__definirConsultaSessaoTeste(async () => null)
  await teste('pedido de namoro tem 5 minutos, menção e comandos específicos', async () => {
    const c = await contexto(), resposta = await c.run('namorar', A, B)
    assert.match(resposta.text, /!aceitarnamoro/); assert.match(resposta.text, /!recusarnamoro/)
    assert.equal(+c.doc().expiraEm - +c.doc().criadoEm, 300000)
    assert.equal(c.doc().modalidade, 'namoro')
  })
  await teste('aceite registra relógio do banco e consulta persiste após reinício', async () => {
    const c = await contexto(); await c.namorar()
    const inicio = +c.doc().namoradoEm; c.col.agora = new Date(inicio + 3 * 86400000)
    const novo = sistema.criarServico(criarRepositorio(async () => c.col))
    const resposta = await novo.executar('namoro', c.sock, H, c.msg(A, null, H))
    assert.match(resposta.text, /3 dias completos/); assert.match(resposta.text, /21\/10\/2026/)
    assert.equal(+c.doc().namoradoEm, inicio)
  })
  for (const acao of ['aceitarnamoro', 'recusarnamoro']) {
    await teste(`${acao}: somente destinatário no grupo original`, async () => {
      const c = await contexto(); await c.run('namorar', A, B)
      for (const autor of [A, C]) await recusa(c.run(acao, autor), 'semPedido')
      await recusa(c.run(acao, B, null, H), 'semPedido')
      await recusa(c.run(acao, B, null, pn(B)), 'grupo')
    })
  }
  await teste('namoro recusa autor próprio, alvo desconhecido e LID sem prova', async () => {
    const c = await contexto()
    await recusa(c.run('namorar', A, A), 'proprio')
    await recusa(c.run('namorar', A, '00099999999'), 'membro')
    await recusa(c.run('namorar', '777@lid', B), 'identidade')
    c.falharMeta = true; await recusa(c.run('namorar', A, B), 'metadados')
  })
  await teste('recusa de namoro libera a reserva e mantém o documento', async () => {
    const c = await contexto(); await c.run('namorar', A, B); await c.run('recusarnamoro', B)
    assert.equal(c.col.docs.find(d => d.tipo === 'uniao').estado, 'recusado')
    await c.run('casar', A, C); assert.equal(c.doc().destinatario, C)
  })
  await teste('namoro expira exatamente no limite sem timer', async () => {
    const c = await contexto(); await c.run('namorar', A, B); c.col.agora = new Date(c.doc().expiraEm)
    await recusa(c.run('aceitarnamoro', B), 'semPedido')
    assert.equal(c.col.docs[0].estado, 'expirado'); assert.equal(c.col.docs[0].bloqueiaParticipantes, false)
  })
  await teste('replay de namoro não renova prazo nem recria namoro terminado', async () => {
    const c = await contexto(), msg = c.msg(A, B); await c.run('namorar', A, B, G, msg)
    const prazo = +c.doc().expiraEm; c.col.agora = new Date(+c.col.agora + 1000)
    await c.run('namorar', A, B, G, msg); assert.equal(+c.doc().expiraEm, prazo)
    await c.run('aceitarnamoro', B); await c.run('terminar', A)
    await c.run('namorar', A, B, G, msg); assert.equal(c.doc(), undefined)
  })
  await teste('casamento antigo sem modalidade é preservado e bloqueia namoro', async () => {
    const c = await contexto(); await c.casar(); delete c.doc().modalidade
    const original = structuredClone(c.doc())
    await recusa(c.run('namorar', A, B), 'ocupado'); await recusa(c.run('namorar', C, B), 'ocupado')
    assert.match((await c.run('casamento')).text, /CASAMENTO/); assert.deepEqual(c.doc(), original)
  })
  await teste('namoro bloqueia outros parceiros em ambos os lados e outros grupos', async () => {
    const c = await contexto(); await c.namorar()
    for (const [autor, alvo] of [[A, C], [C, A], [B, C], [C, B]]) {
      for (const acao of ['namorar', 'casar']) await recusa(c.run(acao, autor, alvo, H), 'ocupado')
    }
    await recusa(c.run('namorar', A, B), 'ocupado')
  })
  await teste('conversão aceita mantém reserva e histórico convertido no mesmo documento', async () => {
    const c = await contexto(); await c.namorar()
    const id = c.doc()._id, criado = +c.doc().criadoEm, inicio = +c.doc().namoradoEm
    c.col.agora = new Date(+c.col.agora + 7 * 86400000)
    await c.run('casar', B, A, H); await c.run('aceitar', A, null, H)
    assert.equal(c.doc()._id, id); assert.equal(+c.doc().criadoEm, criado)
    assert.equal(c.doc().modalidade, 'casamento'); assert.equal(c.doc().namoroAnterior.estado, 'convertido')
    assert.equal(+c.doc().namoroAnterior.iniciadoEm, inicio); assert.equal(+c.doc().casadoEm, +c.col.agora)
    assert.equal(c.col.docs.filter(d => d.tipo === 'uniao').length, 1)
    assert.match((await c.run('casamento')).text, /7 dias completos/)
    assert.equal(await c.repo.consultar(A, 'namoro'), null)
  })
  await teste('recusa de conversão mantém namoro e datas, permite novo pedido', async () => {
    const c = await contexto(); await c.namorar(); const inicio = +c.doc().namoradoEm
    await c.run('casar', A, B); await c.run('recusar', B)
    assert.equal(c.doc().modalidade, 'namoro'); assert.equal(c.doc().estado, 'ativo'); assert.equal(+c.doc().namoradoEm, inicio)
    await c.run('casar', B, A); assert.equal(c.doc().pedidoCasamento.estado, 'pendente')
  })
  await teste('expiração de conversão mantém namoro e registra histórico expirado', async () => {
    const c = await contexto(); await c.namorar(); await c.run('casar', A, B)
    c.col.agora = new Date(c.doc().pedidoCasamento.expiraEm)
    await recusa(c.run('aceitar', B), 'semPedido')
    assert.equal(c.doc().modalidade, 'namoro'); assert.equal(c.doc().estado, 'ativo')
    assert.equal(Object.values(c.doc().pedidosCasamento)[0].estado, 'expirado')
    await c.run('casar', A, B); await c.run('aceitar', B); assert.equal(c.doc().modalidade, 'casamento')
  })
  await teste('comandos de namoro não decidem casamento e vice-versa', async () => {
    const c = await contexto(); await c.run('namorar', A, B)
    await recusa(c.run('aceitar', B), 'semPedido'); await c.run('aceitarnamoro', B)
    await recusa(c.run('divorciar', A), 'semUniao')
    await c.run('casar', A, B); await recusa(c.run('aceitarnamoro', B), 'semPedido')
    await c.run('aceitar', B); await recusa(c.run('terminar', A), 'semUniao')
  })
  await teste('término unilateral no privado conserva histórico e cancela conversão', async () => {
    const c = await contexto(); await c.namorar(); await c.run('casar', A, B)
    const original = +c.doc().namoradoEm
    await c.run('terminar', B, null, pn(B)); const doc = c.col.docs.find(d => d.tipo === 'uniao')
    assert.equal(doc.estado, 'terminado'); assert.equal(+doc.namoradoEm, original)
    assert.equal(doc.pedidoCasamento.estado, 'cancelado'); assert.equal(doc.bloqueiaParticipantes, false)
    await recusa(c.run('aceitar', B), 'semPedido')
    await c.run('namorar', A, C)
  })
  await teste('terceiro não encerra namoro', async () => {
    const c = await contexto(); await c.namorar(); await recusa(c.run('terminar', C), 'semUniao')
    assert.equal(c.doc().estado, 'ativo')
  })
  await teste('recibos antigos não aceitam conversão futura no mesmo namoro', async () => {
    const c = await contexto(); await c.namorar(); await c.run('casar', A, B)
    const aceite = c.msg(B); await c.run('aceitar', B, null, G, aceite)
    const casado = +c.doc().casadoEm; await c.run('aceitar', B, null, G, aceite)
    assert.equal(+c.doc().casadoEm, casado)
    await c.run('divorciar', A); await c.namorar(); await c.run('casar', A, B)
    await c.run('aceitar', B, null, G, aceite)
    assert.equal(c.doc().modalidade, 'namoro'); assert.equal(c.doc().pedidoCasamento.estado, 'pendente')
  })
  await teste('recusa repetida não recusa outro pedido de conversão', async () => {
    const c = await contexto(); await c.namorar(); await c.run('casar', A, B)
    const msg = c.msg(B); await c.run('recusar', B, null, G, msg); await c.run('casar', A, B)
    await c.run('recusar', B, null, G, msg); assert.equal(c.doc().pedidoCasamento.estado, 'pendente')
  })
  await teste('replay de pedido convertido após término não cria casamento direto', async () => {
    const c = await contexto(); await c.namorar(); const msg = c.msg(A, B)
    await c.run('casar', A, B, G, msg); await c.run('terminar', A)
    await c.run('casar', A, B, G, msg); assert.equal(c.doc(), undefined)
  })
  await teste('exclusividade global em corrida entre namoro e casamento', async () => {
    for (let i = 0; i < 12; i++) {
      const c = await contexto()
      const outro = sistema.criarServico(criarRepositorio(async () => c.col))
      const resultados = await Promise.allSettled([c.run('namorar', A, B), outro.executar('casar', c.sock, H, c.msg(C, A, H))])
      assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1)
      assert.equal(c.col.docs.filter(d => d.bloqueiaParticipantes).length, 1)
    }
  })
  await teste('dois pedidos de conversão simultâneos têm um vencedor', async () => {
    const c = await contexto(); await c.namorar()
    const resultados = await Promise.allSettled([c.run('casar', A, B), c.run('casar', B, A, H)])
    assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1)
    assert.deepEqual(Object.values(c.doc().pedidosCasamento).map(p => p.estado).sort(), ['pendente', 'rejeitado_conflito'])
  })
  for (const rival of ['recusar', 'terminar']) {
    await teste(`aceite contra ${rival} preserva uma transição válida`, async () => {
      const c = await contexto(); await c.namorar(); await c.run('casar', A, B)
      await Promise.allSettled([c.run('aceitar', B), c.run(rival, rival === 'terminar' ? A : B)])
      const doc = c.col.docs.find(d => d.tipo === 'uniao')
      assert.ok((doc.modalidade === 'casamento' && doc.bloqueiaParticipantes) || doc.modalidade === 'namoro')
      if (doc.modalidade === 'casamento') assert.equal(doc.pedidoCasamento.estado, 'aceito')
      assert.equal(c.col.docs.filter(d => d.bloqueiaParticipantes).length, doc.bloqueiaParticipantes ? 1 : 0)
    })
  }
  await teste('prazo revalidado atomicamente na finalização da conversão', async () => {
    const c = await contexto(); await c.namorar(); await c.run('casar', A, B)
    const transicionar = c.repo.transicionar
    c.repo.transicionar = async (...args) => { c.col.agora = new Date(c.doc().pedidoCasamento.expiraEm); return transicionar(...args) }
    await recusa(c.run('aceitar', B), 'mudou'); assert.equal(c.doc().modalidade, 'namoro')
  })
  for (const etapa of ['pedido', 'aceite', 'recusa', 'termino']) {
    await teste(`falha parcial após ${etapa} não libera reserva indevida`, async () => {
      const c = await contexto(); await c.namorar()
      if (etapa !== 'pedido') await c.run('casar', A, B)
      const acao = { pedido: 'casar', aceite: 'aceitar', recusa: 'recusar', termino: 'terminar' }[etapa]
      const msg = c.msg(acao === 'aceitar' || acao === 'recusar' ? B : A, acao === 'casar' ? B : undefined)
      c.col.falharAposEscrever = true
      await assert.rejects(c.run(acao, acao === 'aceitar' || acao === 'recusar' ? B : A, null, G, msg))
      c.col.falharAposEscrever = false
      await c.run(acao, acao === 'aceitar' || acao === 'recusar' ? B : A, null, G, msg)
      assert.ok(c.col.docs.filter(d => d.bloqueiaParticipantes).length <= 1)
      const d = c.col.docs.find(d => d.tipo === 'uniao')
      assert.equal(d.estado, etapa === 'termino' ? 'terminado' : 'ativo')
    })
  }
  for (const acao of ['aceitar', 'recusar', 'terminar']) {
    await teste(`resposta perdida após transição atômica de ${acao} é reconciliada`, async () => {
      const c = await contexto(); await c.namorar(); await c.run('casar', A, B)
      const original = c.col.updateOne.bind(c.col)
      let perdeu = false
      c.col.updateOne = async (f, u, o) => {
        const r = await original(f, u, o)
        if (!perdeu && f._id === c.col.docs.find(d => d.tipo === 'uniao')._id && Array.isArray(u)) {
          perdeu = true; throw new Error('RESPOSTA_PERDIDA')
        }
        return r
      }
      const autor = acao === 'terminar' ? A : B, msg = c.msg(autor)
      await assert.rejects(c.run(acao, autor, null, G, msg))
      const salvo = structuredClone(c.col.docs.find(d => d.tipo === 'uniao'))
      assert.equal(perdeu, true)
      await c.run(acao, autor, null, G, msg)
      assert.deepEqual(c.col.docs.find(d => d.tipo === 'uniao'), salvo)
    })
  }
  await teste('falha antes da gravação da conversão preserva namoro e reserva', async () => {
    const c = await contexto(); await c.namorar(); await c.run('casar', A, B)
    const original = c.repo.transicionar
    c.repo.transicionar = async () => { throw new Error('GRAVACAO_INDISPONIVEL') }
    await assert.rejects(c.run('aceitar', B))
    assert.equal(c.doc().modalidade, 'namoro'); assert.equal(c.doc().bloqueiaParticipantes, true)
    c.repo.transicionar = original; await c.run('aceitar', B)
    assert.equal(c.doc().modalidade, 'casamento')
  })
  await teste('recibo de conversão sem pedido concluído não alcança namoro posterior', async () => {
    const c = await contexto(); await c.namorar(); const msg = c.msg(A, B)
    c.col.falharAposEscrever = true
    await assert.rejects(c.run('casar', A, B, G, msg))
    c.col.falharAposEscrever = false
    await c.run('terminar', A); await c.namorar()
    await recusa(c.run('casar', A, B, G, msg), 'ocupado')
    assert.equal(c.doc().pedidoCasamento, undefined)
  })
  await teste('conversão sem confirmação de escrita nunca anuncia sucesso', async () => {
    const c = await contexto(); await c.namorar(); await c.run('casar', A, B)
    const original = c.repo.transicionar
    c.repo.transicionar = async (...args) => {
      c.col.semConfirmacao = true
      try { return await original(...args) } finally { c.col.semConfirmacao = false }
    }
    const msg = c.msg(B)
    await assert.rejects(c.run('aceitar', B, null, G, msg))
    const data = +c.doc().casadoEm
    await c.run('aceitar', B, null, G, msg); assert.equal(+c.doc().casadoEm, data)
  })
  await teste('conversão revalida presença e LID sem reutilizar autorização antiga', async () => {
    const c = await contexto(); await c.namorar(); await c.run('casar', A, B)
    c.participantes = c.participantes.filter(p => p.id !== pn(A))
    await recusa(c.run('aceitar', B), 'membro'); assert.equal(c.doc().modalidade, 'namoro')
  })
  await teste('replay de aceite sem pedido não decide uma conversão posterior', async () => {
    const c = await contexto(); await c.namorar(); const msg = c.msg(B)
    await recusa(c.run('aceitar', B, null, G, msg), 'semPedido')
    await c.run('casar', A, B)
    await recusa(c.run('aceitar', B, null, G, msg), 'semPedido')
    assert.equal(c.doc().pedidoCasamento.estado, 'pendente')
  })
  await teste('replay de término não encerra namoro posterior', async () => {
    const c = await contexto(); await c.namorar(); const msg = c.msg(A)
    await c.run('terminar', A, null, G, msg); await c.namorar()
    await c.run('terminar', A, null, G, msg)
    assert.equal(c.doc().estado, 'ativo'); assert.equal(c.doc().modalidade, 'namoro')
  })
  await teste('datas históricas alteram somente o casamento do dono e preservam originais', async () => {
    const c = await contexto(); await c.casar()
    const inicio = +c.doc().casadoEm, criado = +c.doc().criadoEm
    await c.ajustar('10/02/2020')
    assert.equal(+c.doc().casadoEm, inicio); assert.equal(+c.doc().criadoEm, criado)
    assert.match((await c.run('casamento')).text, /10\/02\/2020/)
    assert.equal(Object.values(c.doc().ajustesInicio)[0].ajustadoPor, A)
    const novo = sistema.criarServico(criarRepositorio(async () => c.col))
    assert.match((await novo.executar('casamento', c.sock, G, c.msg(A))).text, /10\/02\/2020/)
  })
  await teste('não dono, sem casamento e LID não comprovado não ajustam datas', async () => {
    const c = await contexto(); await recusa(c.ajustar('10/02/2020'), 'semUniao')
    await c.casar(); await recusa(c.ajustar('10/02/2020', B), 'dono')
    const msg = c.msg(`${A}@lid`); await recusa(c.ajustar('10/02/2020', A, msg), 'identidade')
    assert.equal(c.doc().inicioRelacionamentoEm, undefined)
  })
  await teste('dono LID comprovado pode ajustar e LID ambíguo falha fechado', async () => {
    const c = await contexto(); await c.casar()
    c.participantes[0] = { id: '777@lid', phoneNumber: pn(A) }
    await c.ajustar('29/02/2024', A, c.msg('777@lid'))
    assert.match((await c.run('casamento', '777@lid')).text, /29\/02\/2024/)
    c.participantes.push({ id: '777@lid', phoneNumber: pn(C) })
    await recusa(c.ajustar('01/01/2020', A, c.msg('777@lid')), 'identidade')
  })
  for (const data of ['31/02/2020', '29/02/2023', '1/01/2020', '01/13/2020', '01/01/1899', '01/01/2099', '01/01/2020 extra']) {
    await teste(`data inválida/futura recusada: ${data}`, async () => {
      const c = await contexto(); await c.casar(); await recusa(c.ajustar(data), 'data')
      assert.equal(c.doc().inicioRelacionamentoEm, undefined)
    })
  }
  await teste('replay de ajuste não sobrescreve ajuste posterior nem outro casamento', async () => {
    const c = await contexto(); await c.casar(); const msg = c.msg(A)
    await c.ajustar('01/01/2020', A, msg); await c.ajustar('02/02/2021')
    await c.ajustar('01/01/2020', A, msg)
    assert.match((await c.run('casamento')).text, /02\/02\/2021/)
    await c.run('divorciar'); await c.casar()
    await recusa(c.ajustar('01/01/2020', A, msg), 'mudou')
    assert.equal(c.doc().inicioRelacionamentoEm, undefined)
  })
  await teste('ajuste de data com resposta perdida é idempotente e não atinge outro casal', async () => {
    const c = await contexto(); await c.casar()
    const original = c.repo.ajustarInicio
    c.repo.ajustarInicio = async (...args) => {
      const r = await original(...args); throw new Error(`RESPOSTA_PERDIDA_${Boolean(r)}`)
    }
    const msg = c.msg(A); await assert.rejects(c.ajustar('03/03/2020', A, msg))
    c.repo.ajustarInicio = original
    const salvo = structuredClone(c.doc()); await c.ajustar('03/03/2020', A, msg)
    assert.deepEqual(c.doc(), salvo)
    await c.run('divorciar', A); await c.run('casar', B, C); await c.run('aceitar', C)
    await recusa(c.ajustar('03/03/2020'), 'semUniao')
    assert.equal(c.doc().inicioRelacionamentoEm, undefined)
  })
  await teste('casamento convertido exibe namoro anterior e data histórica sem alterar datas', async () => {
    const c = await contexto(); await c.namorar(); c.col.agora = new Date(+c.col.agora + 2 * 86400000)
    await c.run('casar', A, B); await c.run('aceitar', B)
    const namoro = structuredClone(c.doc().namoroAnterior), casamento = +c.doc().casadoEm
    await c.ajustar('01/01/2020')
    const texto = (await c.run('casamento')).text
    assert.match(texto, /Namoro anterior/); assert.match(texto, /2 dias completos/); assert.match(texto, /01\/01\/2020/)
    assert.deepEqual(c.doc().namoroAnterior, namoro); assert.equal(+c.doc().casadoEm, casamento)
  })
  await teste('somente os seis comandos novos são registrados sem mudanças no roteador', async () => {
    for (const nome of ['namorar', 'aceitarnamoro', 'recusarnamoro', 'namoro', 'terminar']) {
      assert.equal(require('../comandos/menu-brincadeiras/' + nome).nome, nome)
    }
    assert.equal(require('../comandos/menu-dono/ajustardatacasamento').nome, 'ajustardatacasamento')
  })
  for (const decisao of ['recusa', 'expiracao']) {
    await teste(`regressão: término não sobrescreve ${decisao} concorrente`, async () => {
      const c = await contexto(); await c.namorar(); await c.run('casar', A, B)
      const original = c.repo.transicionar; let intercalado = false, historico
      c.repo.transicionar = async (id, filtro, valores) => {
        if (valores.estado === 'terminado' && !intercalado) {
          intercalado = true
          if (decisao === 'recusa') await c.run('recusar', B)
          else { c.col.agora = new Date(c.doc().pedidoCasamento.expiraEm); await c.repo.expirar([A, B]) }
          historico = structuredClone(c.doc().pedidosCasamento)
        }
        return original(id, filtro, valores)
      }
      const msg = c.msg(A)
      await recusa(c.run('terminar', A, null, G, msg), 'mudou')
      assert.equal(c.doc().estado, 'ativo'); assert.deepEqual(c.doc().pedidosCasamento, historico)
      await c.run('terminar', A, null, G, msg)
      const encerrado = c.col.docs.find(d => d.tipo === 'uniao')
      assert.equal(encerrado.estado, 'terminado'); assert.deepEqual(encerrado.pedidosCasamento, historico)
      assert.equal(encerrado.pedidoCasamento.estado, decisao === 'recusa' ? 'recusado' : 'expirado')
    })
  }
  await teste('regressão: ajuste futuro rejeitado continua rejeitado no replay em outro dia', async () => {
    const c = await contexto(); await c.casar(); const msg = c.msg(A)
    await recusa(c.ajustar('22/10/2026', A, msg), 'data')
    const rejeicao = structuredClone(c.doc().ajustesInicio)
    assert.equal(Object.values(rejeicao)[0].resultado, 'rejeitado_data_futura')
    c.col.agora = new Date(+c.col.agora + 86400000)
    await recusa(c.ajustar('22/10/2026', A, msg), 'data')
    assert.equal(c.doc().inicioRelacionamentoEm, undefined); assert.deepEqual(c.doc().ajustesInicio, rejeicao)
    await c.ajustar('22/10/2026')
    assert.match((await c.run('casamento')).text, /22\/10\/2026/)
  })
  await teste('regressão: rejeição futura não altera data válida nem desfaz ajuste posterior', async () => {
    const c = await contexto(); await c.casar(); await c.ajustar('01/01/2020')
    const msg = c.msg(A); await recusa(c.ajustar('22/10/2026', A, msg), 'data')
    assert.match((await c.run('casamento')).text, /01\/01\/2020/)
    c.col.agora = new Date(+c.col.agora + 86400000); await c.ajustar('02/02/2021')
    await recusa(c.ajustar('22/10/2026', A, msg), 'data')
    assert.match((await c.run('casamento')).text, /02\/02\/2021/)
  })
  await teste('regressão: ajuste antigo sem campo resultado continua idempotente', async () => {
    const c = await contexto(); await c.casar(); const msg = c.msg(A)
    await c.ajustar('01/01/2020', A, msg)
    delete Object.values(c.doc().ajustesInicio)[0].resultado
    await c.ajustar('02/02/2021'); await c.ajustar('01/01/2020', A, msg)
    assert.match((await c.run('casamento')).text, /02\/02\/2021/)
  })
  for (const modo of ['antes', 'depois', 'semConfirmacao']) {
    await teste(`regressão: transporte de ajuste ${modo} da escrita não inventa resultado`, async () => {
      const c = await contexto(); await c.casar()
      const original = c.col.updateOne.bind(c.col); let atingiu = false
      c.col.updateOne = async (f, u, o) => {
        const ajuste = Object.keys(u?.[0]?.$set || {}).some(k => k.startsWith('ajustesInicio.'))
        if (!ajuste || atingiu) return original(f, u, o)
        atingiu = true
        if (modo === 'antes') throw new Error('TRANSPORTE_INDISPONIVEL')
        const r = await original(f, u, o)
        if (modo === 'depois') throw new Error('RESPOSTA_PERDIDA')
        return { ...r, acknowledged: false }
      }
      const msg = c.msg(A)
      await assert.rejects(c.ajustar('22/10/2026', A, msg), e => !e.codigo)
      assert.equal(atingiu, true)
      if (modo === 'antes') assert.equal(c.doc().ajustesInicio, undefined)
      else assert.equal(Object.values(c.doc().ajustesInicio)[0].resultado, 'rejeitado_data_futura')
      c.col.agora = new Date(+c.col.agora + 86400000)
      if (modo === 'antes') await c.ajustar('22/10/2026', A, msg)
      else await recusa(c.ajustar('22/10/2026', A, msg), 'data')
    })
  }
  await teste('regressão: conflito definitivo não cria pedido no replay após recusa do concorrente', async () => {
    const c = await contexto(); await c.namorar(); await c.run('casar', A, B)
    const msg = c.msg(B, A), ativo = structuredClone(c.doc().pedidoCasamento)
    await recusa(c.run('casar', B, A, G, msg), 'ocupado')
    assert.deepEqual(c.doc().pedidoCasamento, ativo)
    await c.run('recusar', B)
    const historico = structuredClone(c.doc().pedidosCasamento)
    await recusa(c.run('casar', B, A, G, msg), 'ocupado')
    assert.deepEqual(c.doc().pedidosCasamento, historico); assert.equal(c.doc().pedidoCasamento.estado, 'recusado')
    await c.run('casar', B, A); await c.run('aceitar', A)
    assert.equal(c.doc().modalidade, 'casamento')
  })
  for (const modo of ['antes', 'depois', 'semConfirmacao']) {
    await teste(`regressão: transporte de conversão ${modo} da decisão preserva incerteza`, async () => {
      const c = await contexto(); await c.namorar(); await c.run('casar', A, B)
      const original = c.col.updateOne.bind(c.col); let atingiu = false
      c.col.updateOne = async (f, u, o) => {
        const decisao = Object.keys(u?.[0]?.$set || {}).some(k => k.startsWith('pedidosCasamento.') && !k.endsWith('.estado'))
        if (!decisao || atingiu) return original(f, u, o)
        atingiu = true
        if (modo === 'antes') throw new Error('TRANSPORTE_INDISPONIVEL')
        const r = await original(f, u, o)
        if (modo === 'depois') throw new Error('RESPOSTA_PERDIDA')
        return { ...r, acknowledged: false }
      }
      const msg = c.msg(B, A)
      await assert.rejects(c.run('casar', B, A, G, msg), e => !e.codigo)
      assert.equal(atingiu, true)
      assert.equal(Object.values(c.doc().pedidosCasamento).filter(p => p.estado === 'rejeitado_conflito').length, modo === 'antes' ? 0 : 1)
      await c.run('recusar', B)
      if (modo === 'antes') await c.run('casar', B, A, G, msg)
      else await recusa(c.run('casar', B, A, G, msg), 'ocupado')
    })
  }
  await teste('regressão: duplicatas concorrentes congelam uma única rejeição por conflito', async () => {
    const c = await contexto(); await c.namorar(); await c.run('casar', A, B); const msg = c.msg(B, A)
    const resultados = await Promise.allSettled(Array.from({ length: 8 }, () => c.run('casar', B, A, G, msg)))
    assert.equal(resultados.filter(r => r.status === 'rejected' && r.reason.codigo === 'ocupado').length, 8)
    assert.equal(Object.values(c.doc().pedidosCasamento).filter(p => p.estado === 'rejeitado_conflito').length, 1)
    await c.run('recusar', B); await recusa(c.run('casar', B, A, G, msg), 'ocupado')
  })
  await teste('regressão: consulta de conversão filtra participantes e mantém os índices existentes', async () => {
    const c = await contexto(); await c.namorar(); await c.run('casar', A, B)
    const original = c.col.findOne; const filtros = []
    c.col.findOne = async q => { if (q['pedidoCasamento.destinatario']) filtros.push(structuredClone(q)); return original(q) }
    await c.run('aceitar', B)
    assert.equal(filtros.length, 1); assert.equal(filtros[0].participantes, B)
    assert.equal(filtros[0].bloqueiaParticipantes, true); assert.equal(filtros[0].modalidade, 'namoro')
    assert.equal(c.col.indices.length, 2); assert.equal(c.col.indices[0].unique, true)
    assert.deepEqual(c.col.indices[0].key, { participantes: 1 })
  })
  console.log(`\n${total} cenários de namoro/conversão/data passaram (offline).`)
}
main().catch(e => { console.error(e); process.exitCode = 1 })
