// ============================================
// 🧪 teste-lembrete.js — Valida /lembrete, /meuslembretes e /cancelarlembrete
// ============================================
// RODA OFFLINE: injeta no lembretes.js uma collection fake em memória
// (via o gancho __definirColecaoTeste — mesmo padrão do teste-sugestao)
// que reproduz o contrato do driver MongoDB (insertOne/countDocuments/
// find+sort+limit/updateOne/deleteOne/deleteMany). O TEMPO é MOCKADO
// pelos parâmetros `agora` que o módulo aceita (interpretarQuando e
// verificarLembretes) — nenhum timer real esperando disparo. Verifica:
//   - exports dos 3 comandos + cancelarLembrete/obterNumeroRemetente;
//   - criação com formato RELATIVO (10m/1h30m) — módulo e comando;
//   - criação com horário ESPECÍFICO (20:30) — módulo e comando;
//   - disparo simulado (tempo mockado): antes de vencer NÃO envia,
//     na hora envia no destino certo (PV/grupo) e NÃO reenvia;
//   - listagem numerada do /meuslembretes (ordem: vence primeiro);
//   - cancelamento /cancelarlembrete N: some da lista, índice é
//     recalculado; 0/não numérico/fora da faixa/sem argumento → aviso
//     e NADA é apagado;
//   - limite de lembretes atingido (LIMITE_ATINGIDO → aviso no
//     /lembrete) e que cancelar um libra espaço de novo.
// Uso: node scripts/teste-lembrete.js
// ============================================

const lembrete = require('../comandos/menu-utilitario/lembrete')
const meuslembretes = require('../comandos/meuslembretes')
const cancelarlembrete = require('../comandos/menu-utilitario/cancelarlembrete')
const banco = require('../lembretes')

const JID = '120363000000000000@g.us'
const NUM = '5511999990001'

// ─── Collection fake em memória (contrato do driver MongoDB) ───
function criarColecaoFake () {
  const docs = []
  let seq = 0
  const igual = (doc, filtro) => Object.entries(filtro || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && ('$gte' in v || '$lte' in v || '$gt' in v || '$lt' in v)) {
      if ('$gte' in v && !(doc[k] >= v.$gte)) return false
      if ('$lte' in v && !(doc[k] <= v.$lte)) return false
      if ('$gt' in v && !(doc[k] > v.$gt)) return false
      if ('$lt' in v && !(doc[k] < v.$lt)) return false
      return true
    }
    return doc[k] === v
  })
  return {
    async createIndex () { return 'fake' },
    async insertOne (doc) {
      seq += 1
      const salvo = { ...doc, _id: `fakeid${String(seq).padStart(22, '0')}` }
      docs.push(salvo)
      return { insertedId: salvo._id }
    },
    async countDocuments (filtro) { return docs.filter((d) => igual(d, filtro)).length },
    async updateOne (filtro, update) {
      const alvo = docs.find((d) => igual(d, filtro))
      if (!alvo) return { matchedCount: 0 }
      Object.assign(alvo, update?.$set || {})
      return { matchedCount: 1 }
    },
    async deleteOne (filtro) {
      const i = docs.findIndex((d) => igual(d, filtro))
      if (i < 0) return { deletedCount: 0 }
      docs.splice(i, 1)
      return { deletedCount: 1 }
    },
    async deleteMany (filtro) {
      let n = 0
      for (let i = docs.length - 1; i >= 0; i--) {
        if (igual(docs[i], filtro)) { docs.splice(i, 1); n++ }
      }
      return { deletedCount: n }
    },
    find (filtro) {
      const base = docs.filter((d) => igual(d, filtro))
      return {
        sort (ordem) {
          const [[campo, dir]] = Object.entries(ordem)
          base.sort((a, b) => (a[campo] < b[campo] ? -1 : a[campo] > b[campo] ? 1 : 0) * dir)
          return {
            limit (n) { return { toArray: async () => base.slice(0, n) } }
          }
        }
      }
    }
  }
}

// ─── Sock/msg fake (registrador de envios) ───
function criarSock () {
  const enviadas = []
  return {
    enviadas,
    sock: {
      async sendMessage (jid, conteudo, opcoes) {
        enviadas.push({ jid, conteudo, opcoes })
        return { key: { id: `fake-${enviadas.length}` } }
      },
      async groupMetadata () { return { subject: 'Grupo Teste', participants: [] } }
    }
  }
}

const msgDe = (texto) => ({
  key: { remoteJid: JID, fromMe: false, id: 'MSG', participant: `${NUM}@s.whatsapp.net` },
  pushName: 'Autor',
  message: { extendedTextMessage: { text: texto, contextInfo: {} } }
})

const textoUnico = (enviadas) => {
  const t = enviadas.map((e) => e.conteudo?.text).filter((x) => typeof x === 'string')
  if (t.length !== 1) throw new Error(`esperava 1 mensagem, veio ${t.length}`)
  return t[0]
}

let reprovadas = 0
async function testar (nome, fn) {
  try {
    await fn()
    console.log('✅ ' + nome)
  } catch (err) {
    reprovadas += 1
    console.error('❌ ' + nome + ' →', err?.message || err)
  }
}

async function main () {
  banco.__definirColecaoTeste(criarColecaoFake())

  // ═══════════════ 1) Exports ═══════════════
  await testar('exports: /lembrete, /meuslembretes e /cancelarlembrete', () => {
    if (lembrete.nome !== 'lembrete') throw new Error('nome do /lembrete errado')
    if (typeof lembrete.executar !== 'function') throw new Error('/lembrete sem executar')
    if (meuslembretes.nome !== 'meuslembretes') throw new Error('nome do /meuslembretes errado')
    if (typeof meuslembretes.executar !== 'function') throw new Error('/meuslembretes sem executar')
    if (cancelarlembrete.nome !== 'cancelarlembrete') throw new Error('nome do /cancelarlembrete errado')
    if (cancelarlembrete.categoria !== 'utilitario') throw new Error('categoria deveria ser utilitario')
    if (!(cancelarlembrete.aliases || []).includes('cancelalembrete')) throw new Error('alias cancelalembrete ausente')
    if (typeof cancelarlembrete.executar !== 'function') throw new Error('/cancelarlembrete sem executar')
    if (typeof banco.cancelarLembrete !== 'function') throw new Error('banco.cancelarLembrete ausente')
    if (typeof banco.obterNumeroRemetente !== 'function') throw new Error('banco.obterNumeroRemetente ausente')
  })

  // ═══════════════ 2) Criação — formato RELATIVO ═══════════════
  await testar('módulo: interpretarQuando("10m") → relativo ~10min', () => {
    const agora = Date.now()
    const r = banco.interpretarQuando('10m', agora)
    if (r.erro) throw new Error('não deveria dar erro: ' + r.erro)
    if (r.tipo !== 'relativo') throw new Error('tipo deveria ser relativo: ' + r.tipo)
    if (Math.abs(r.timestamp - (agora + 10 * 60000)) > 1000) throw new Error('timestamp fora dos 10min')
    const combinado = banco.interpretarQuando('1h30m', agora)
    if (combinado.erro) throw new Error('1h30m deveria ser válido')
    if (combinado.duracaoMs !== 90 * 60000) throw new Error('1h30m ≠ 90min: ' + combinado.duracaoMs)
    if (!banco.interpretarQuando('agora mesmo', agora).erro) throw new Error('texto livre deveria dar erro')
  })

  await testar('comando /lembrete 10m … agenda e confirma (relativo)', async () => {
    const { sock, enviadas } = criarSock()
    const antes = Date.now()
    await lembrete.executar(sock, JID, msgDe('/lembrete 10m Beber água agora'), '/lembrete 10m Beber água agora')
    const texto = textoUnico(enviadas)
    if (!/Lembrete agendado/i.test(texto)) throw new Error('sem confirmação: ' + texto)
    if (!/Beber água agora/.test(texto)) throw new Error('sem o texto do lembrete: ' + texto)
    const pendentes = await banco.listarPendentes(NUM)
    const doc = pendentes.find((d) => d.texto === 'Beber água agora')
    if (!doc) throw new Error('nada foi gravado no banco')
    if (Math.abs(doc.disparar_em - (antes + 10 * 60000)) > 5000) throw new Error('disparar_em fora dos ~10min')
    if (doc.enviado !== false) throw new Error('deveria nascer pendente')
  })

  // ═══════════════ 3) Criação — horário ESPECÍFICO ═══════════════
  await testar('módulo: interpretarQuando("20:30") → absoluto (hoje/amanhã)', () => {
    // 12:00 UTC → 09:00 em SP (UTC-3): 20:30 ainda NÃO passou → hoje
    const meioDia = Date.UTC(2026, 0, 15, 12, 0, 0)
    const r = banco.interpretarQuando('20:30', meioDia)
    if (r.erro) throw new Error('não deveria dar erro: ' + r.erro)
    if (r.tipo !== 'absoluto') throw new Error('tipo deveria ser absoluto: ' + r.tipo)
    const horaSP = new Date(r.timestamp)
      .toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
    if (horaSP.replace('24:', '00:') !== '20:30') throw new Error('deveria ser 20:30 em SP, veio ' + horaSP)
    if (r.timestamp <= meioDia) throw new Error('deveria ser no futuro')
    if (r.timestamp - meioDia > 24 * 3600000) throw new Error('hoje: não deveria pular 1 dia')

    // 23:45 UTC = 20:45 em SP (UTC-3): 20:30 já passou → amanhã
    const depois = Date.UTC(2026, 0, 15, 23, 45, 0)
    const amanha = banco.interpretarQuando('20:30', depois)
    if (amanha.erro) throw new Error('não deveria dar erro depois das 20:30')
    if (amanha.timestamp - depois < 20 * 3600000) throw new Error('20:30 passado deveria virar amanhã')
    if (!banco.interpretarQuando('25:99', meioDia).erro) throw new Error('hora inválida deveria dar erro')
  })

  await testar('comando /lembrete 20:30 … agenda e confirma (absoluto)', async () => {
    const { sock, enviadas } = criarSock()
    await lembrete.executar(sock, JID, msgDe('/lembrete 20:30 Reunião do Limbo'), '/lembrete 20:30 Reunião do Limbo')
    const texto = textoUnico(enviadas)
    if (!/Lembrete agendado/i.test(texto)) throw new Error('sem confirmação: ' + texto)
    if (!/20:30/.test(texto)) throw new Error('confirmação sem o horário: ' + texto)
    const pendentes = await banco.listarPendentes(NUM)
    if (!pendentes.some((d) => d.texto === 'Reunião do Limbo')) throw new Error('não gravou o lembrete das 20:30')
  })

  // ═══════════════ 4) Disparo simulado (tempo mockado) ═══════════════
  await testar('disparo: antes de vencer NÃO envia (agora mockado)', async () => {
    banco.__definirColecaoTeste(criarColecaoFake())
    const { sock, enviadas } = criarSock()
    const base = Date.now()
    await banco.criarLembrete({ numero: NUM, texto: 'Disparo adiado', dispararEm: base + 10 * 60000, agora: base })
    const r = await banco.verificarLembretes({ sock, agora: base + 5 * 60000 })
    if (r.enviados !== 0) throw new Error('não deveria enviar antes do vencimento: ' + JSON.stringify(r))
    if (enviadas.length !== 0) throw new Error('nenhuma mensagem deveria sair')
  })

  await testar('disparo: na hora certa envia no PV e NÃO reenvia depois', async () => {
    const { sock, enviadas } = criarSock()
    const base = Date.now()
    await banco.criarLembrete({ numero: NUM, texto: 'Hora do café', dispararEm: base + 60000, agora: base })
    const r = await banco.verificarLembretes({ sock, agora: base + 61000 })
    if (r.enviados !== 1) throw new Error('deveria entregar exatamente 1: ' + JSON.stringify(r))
    if (enviadas.length !== 1) throw new Error('deveria sair 1 mensagem, saiu ' + enviadas.length)
    const envio = enviadas[0]
    if (envio.jid !== `${NUM}@s.whatsapp.net`) throw new Error('destino errado (PV): ' + envio.jid)
    if (!/LEMBRETE DO LIMBO/.test(envio.conteudo.text)) throw new Error('sem cabeçalho: ' + envio.conteudo.text)
    if (!/Hora do café/.test(envio.conteudo.text)) throw new Error('sem o texto do lembrete')
    const pendentes = await banco.listarPendentes(NUM)
    if (pendentes.some((d) => d.texto === 'Hora do café')) throw new Error('deveria sair da lista de pendentes')
    const r2 = await banco.verificarLembretes({ sock, agora: base + 120000 })
    if (r2.enviados !== 0) throw new Error('NÃO deveria reenviar o que já saiu: ' + JSON.stringify(r2))
    if (enviadas.length !== 1) throw new Error('saiu mensagem duplicada: ' + enviadas.length)
  })

  await testar('disparo: lembrete de GRUPO vai pro grupo de origem com menção', async () => {
    const { sock, enviadas } = criarSock()
    const base = Date.now()
    await banco.criarLembrete({ numero: NUM, grupoId: JID, texto: 'Acorde cedo', dispararEm: base + 1000, agora: base })
    const r = await banco.verificarLembretes({ sock, agora: base + 2000 })
    if (r.enviados !== 1) throw new Error('deveria entregar 1 no grupo: ' + JSON.stringify(r))
    const envio = enviadas[0]
    if (envio.jid !== JID) throw new Error('destino errado (grupo): ' + envio.jid)
    if (!Array.isArray(envio.conteudo.mentions) || !envio.conteudo.mentions.includes(`${NUM}@s.whatsapp.net`)) {
      throw new Error('faltou a menção do autor no grupo')
    }
  })

  // ═══════════════ 5) Listagem ═══════════════
  await testar('listagem: /meuslembretes numerado e ordenado (vence primeiro)', async () => {
    banco.__definirColecaoTeste(criarColecaoFake())
    const base = Date.now()
    // criados fora de ordem de propósito: a listagem tem que ordenar
    await banco.criarLembrete({ numero: NUM, texto: 'MAIS LONGE', dispararEm: base + 3 * 3600000, agora: base })
    await banco.criarLembrete({ numero: NUM, texto: 'MAIS PERTO', dispararEm: base + 60000, agora: base })
    await banco.criarLembrete({ numero: NUM, texto: 'NO MEIO', dispararEm: base + 3600000, agora: base })

    const { sock, enviadas } = criarSock()
    await meuslembretes.executar(sock, JID, msgDe('/meuslembretes'))
    const texto = textoUnico(enviadas)
    if (!/SEUS LEMBRETES PENDENTES\* \(3\/10\)/.test(texto)) throw new Error('cabeçalho errado: ' + texto.split('\n')[0])
    const iPerto = texto.indexOf('MAIS PERTO')
    const iMeio = texto.indexOf('NO MEIO')
    const iLonge = texto.indexOf('MAIS LONGE')
    if (iPerto < 0 || iMeio < 0 || iLonge < 0) throw new Error('faltou item na listagem')
    if (!(iPerto < iMeio && iMeio < iLonge)) throw new Error('ordem errada (esperado: perto, meio, longe)')
    if (!/1\./.test(texto) || !/2\./.test(texto) || !/3\./.test(texto)) throw new Error('faltam os números dos índices')
  })

  await testar('listagem vazia → aviso amigável', async () => {
    banco.__definirColecaoTeste(criarColecaoFake())
    const { sock, enviadas } = criarSock()
    await meuslembretes.executar(sock, JID, msgDe('/meuslembretes'))
    const texto = textoUnico(enviadas)
    if (!/Nenhum lembrete pendente/i.test(texto)) throw new Error('sem aviso de lista vazia: ' + texto)
  })

  // ═══════════════ 6) Cancelamento ═══════════════
  await testar('/cancelarlembrete 2 remove o item da posição 2 e recalcula índices', async () => {
    banco.__definirColecaoTeste(criarColecaoFake())
    const base = Date.now()
    await banco.criarLembrete({ numero: NUM, texto: 'UM', dispararEm: base + 60000, agora: base })
    await banco.criarLembrete({ numero: NUM, texto: 'DOIS', dispararEm: base + 3600000, agora: base })
    await banco.criarLembrete({ numero: NUM, texto: 'TRÊS', dispararEm: base + 7200000, agora: base })

    const { sock, enviadas } = criarSock()
    await cancelarlembrete.executar(sock, JID, msgDe('/cancelarlembrete 2'), '/cancelarlembrete 2')
    const texto = textoUnico(enviadas)
    if (!/cancelado/i.test(texto)) throw new Error('sem confirmação: ' + texto)
    if (!/DOIS/.test(texto)) throw new Error('confirmação sem o texto do item cancelado: ' + texto)

    const restantes = await banco.listarPendentes(NUM)
    if (restantes.length !== 2) throw new Error('deveriam restar 2, restaram ' + restantes.length)
    if (restantes.some((d) => d.texto === 'DOIS')) throw new Error('o item 2 não foi removido')
    if (restantes[0].texto !== 'UM' || restantes[1].texto !== 'TRÊS') throw new Error('a ordem dos restantes mudou')

    // Índices recalculam: agora o 2 é TRÊS (não UM)
    const { sock: s2, enviadas: e2 } = criarSock()
    await cancelarlembrete.executar(s2, JID, msgDe('/cancelarlembrete 2'), '/cancelarlembrete 2')
    if (!/TRÊS/.test(textoUnico(e2))) throw new Error('índice não recalculou após o 1º cancelamento')
    const ultimo = await banco.listarPendentes(NUM)
    if (ultimo.length !== 1 || ultimo[0].texto !== 'UM') throw new Error('sobrou o lembrete errado')
  })

  await testar('/cancelarlembrete: 0 / não numérico / fora da faixa / sem argumento → aviso', async () => {
    banco.__definirColecaoTeste(criarColecaoFake())
    const base = Date.now()
    await banco.criarLembrete({ numero: NUM, texto: 'ÚNICO', dispararEm: base + 60000, agora: base })

    // índice 0
    let { sock, enviadas } = criarSock()
    await cancelarlembrete.executar(sock, JID, msgDe('/cancelarlembrete 0'), '/cancelarlembrete 0')
    let texto = textoUnico(enviadas)
    if (!/começa em 1/.test(texto)) throw new Error('índice 0 deveria avisar que começa em 1: ' + texto)

    // não numérico
    ;({ sock, enviadas } = criarSock())
    await cancelarlembrete.executar(sock, JID, msgDe('/cancelarlembrete dois'), '/cancelarlembrete dois')
    texto = textoUnico(enviadas)
    if (!/número da lista/.test(texto)) throw new Error('valor não numérico deveria cair no uso: ' + texto)

    // fora da faixa (só existe 1)
    ;({ sock, enviadas } = criarSock())
    await cancelarlembrete.executar(sock, JID, msgDe('/cancelarlembrete 7'), '/cancelarlembrete 7')
    texto = textoUnico(enviadas)
    if (!/não existe o lembrete nº 7/i.test(texto)) throw new Error('fora da faixa sem dizer o nº: ' + texto)
    if (!/apenas \*1\*/.test(texto)) throw new Error('aviso sem o total da lista: ' + texto)

    // sem argumento
    ;({ sock, enviadas } = criarSock())
    await cancelarlembrete.executar(sock, JID, msgDe('/cancelarlembrete'), '/cancelarlembrete')
    texto = textoUnico(enviadas)
    if (!/cancelarlembrete <número>/.test(texto)) throw new Error('sem argumento deveria mostrar o uso: ' + texto)

    // nada foi apagado em nenhum dos casos acima
    const pendentes = await banco.listarPendentes(NUM)
    if (pendentes.length !== 1 || pendentes[0].texto !== 'ÚNICO') throw new Error('um cancelamento inválido apagou algo!')
  })

  await testar('/cancelarlembrete sem lembretes → aviso de lista vazia', async () => {
    banco.__definirColecaoTeste(criarColecaoFake())
    const { sock, enviadas } = criarSock()
    await cancelarlembrete.executar(sock, JID, msgDe('/cancelarlembrete 1'), '/cancelarlembrete 1')
    const texto = textoUnico(enviadas)
    if (!/não tem lembretes pendentes/i.test(texto)) throw new Error('sem aviso de lista vazia: ' + texto)
  })

  // ═══════════════ 7) Limite de lembretes atingido ═══════════════
  await testar(`limite: ${banco.MAX_LEMBRETES_ATIVOS} ativos → o ${banco.MAX_LEMBRETES_ATIVOS + 1}º é recusado com aviso`, async () => {
    banco.__definirColecaoTeste(criarColecaoFake())
    const base = Date.now()
    for (let i = 1; i <= banco.MAX_LEMBRETES_ATIVOS; i++) {
      await banco.criarLembrete({ numero: NUM, texto: `Lembrete ${i}`, dispararEm: base + i * 60000, agora: base })
    }

    // 11º via módulo → code LIMITE_ATINGIDO (é o que o comando trata)
    let codigo = null
    try {
      await banco.criarLembrete({ numero: NUM, texto: 'O demais', dispararEm: base + 99 * 60000, agora: base })
    } catch (err) {
      codigo = err?.code || null
    }
    if (codigo !== 'LIMITE_ATINGIDO') throw new Error('esperava code LIMITE_ATINGIDO, veio: ' + codigo)

    // 11º via comando /lembrete → aviso amigável, sem lançar
    const { sock, enviadas } = criarSock()
    let lancou = false
    try {
      await lembrete.executar(sock, JID, msgDe('/lembrete 5h Tentar de novo'), '/lembrete 5h Tentar de novo')
    } catch (err) {
      lancou = true
    }
    if (lancou) throw new Error('o /lembrete lançou em cima do limite (deveria avisar)')
    const texto = textoUnico(enviadas)
    if (!/já tem 10 lembretes ativos/i.test(texto)) throw new Error('sem aviso de limite: ' + texto)
    if (!/meuslembretes/.test(texto)) throw new Error('aviso sem a dica do /meuslembretes: ' + texto)

    const pendentes = await banco.listarPendentes(NUM)
    if (pendentes.length !== banco.MAX_LEMBRETES_ATIVOS) {
      throw new Error(`deveriam ficar ${banco.MAX_LEMBRETES_ATIVOS}, ficaram ${pendentes.length}`)
    }
    if (pendentes.some((d) => d.texto === 'Tentar de novo')) throw new Error('o recusado não deveria estar no banco')

    // Cancelar UM → libra espaço pro próximo agendamento
    const { sock: s2, enviadas: e2 } = criarSock()
    await cancelarlembrete.executar(s2, JID, msgDe('/cancelarlembrete 1'), '/cancelarlembrete 1')
    if (!/cancelado/i.test(textoUnico(e2))) throw new Error('o cancelamento p/ liberar espaço falhou')

    const { sock: s3, enviadas: e3 } = criarSock()
    await lembrete.executar(s3, JID, msgDe('/lembrete 5h Agora cabe'), '/lembrete 5h Agora cabe')
    if (!/Lembrete agendado/i.test(textoUnico(e3))) throw new Error('cancelar deveria liberar espaço p/ novo agendamento')
    const finais = await banco.listarPendentes(NUM)
    if (finais.length !== banco.MAX_LEMBRETES_ATIVOS) throw new Error('deveria voltar a 10 ativos, ficou ' + finais.length)
    if (!finais.some((d) => d.texto === 'Agora cabe')) throw new Error('o novo lembrete não entrou')
  })

  // ─── limpeza ───
  banco.__definirColecaoTeste(null)

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('💥 Falha inesperada no teste:', err)
  process.exit(1)
})