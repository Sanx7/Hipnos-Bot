// Testes offline: nenhuma conexão real ao MongoDB ou ao WhatsApp.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { OWNER_NUMBERS } = require('../config')
const lid = require('../lid')
const estado = require('../estado-bot')
const comandos = require('../comandos/menu-dono/on-off')

let documento = null
let falharLeitura = false
let falharEscrita = false
let escritas = 0
let leituras = 0
const colecao = {
  async findOne(filtro) {
    assert.deepEqual(filtro, { _id: 'global' })
    leituras++
    if (falharLeitura) throw new Error('indisponível')
    return documento && { ...documento }
  },
  async updateOne(filtro, atualizacao, opcoes) {
    assert.deepEqual(filtro, { _id: 'global' })
    assert.equal(opcoes.upsert, true)
    if (falharEscrita) throw new Error('indisponível')
    escritas++
    documento = { ...filtro, ...atualizacao.$set }
  }
}
const dono = '5511999990000'
const comum = '5511888880000'
const grupo = '123@g.us'
const donosOriginais = [...OWNER_NUMBERS]
OWNER_NUMBERS.push(dono)
lid.__definirConsultaSessaoTeste(async () => null)
const sock = {
  user: { id: '5511666660000@s.whatsapp.net', lid: '66666@lid' },
  envios: [],
  async groupMetadata() {
    return { participants: [
      { id: '12345@lid', phoneNumber: `${dono}@s.whatsapp.net` },
      { id: '67890@lid', phoneNumber: `${comum}@s.whatsapp.net`, admin: 'admin' },
      { id: '66666@lid', phoneNumber: '5511666660000@s.whatsapp.net', admin: 'admin' }
    ] }
  },
  async sendMessage(jid, conteudo) { this.envios.push({ jid, ...conteudo }) }
}
const msg = sender => ({ key: { remoteJid: grupo, participant: sender } })
let passou = 0
async function teste(nome, executar) {
  await executar()
  passou++
  console.log(`✅ ${nome}`)
}

async function main() {
  estado.__definirColecaoTeste(colecao)
  await teste('sem documento: ligado por padrão', async () => assert.equal(await estado.obterLigado(), true))
  await teste('off persiste boolean e timestamp', async () => {
    await comandos.find(c => c.nome === 'off').executar(sock, grupo, msg(`${dono}@s.whatsapp.net`))
    assert.equal(documento.ligado, false)
    assert.equal(typeof documento.atualizado_em, 'number')
    assert.match(sock.envios.at(-1).text, /manutenção/)
  })
  await teste('off bloqueia membro no grupo e privado', async () => {
    assert.equal(await estado.permitirMensagem(sock, grupo, `${comum}@s.whatsapp.net`), false)
    assert.equal(await estado.permitirMensagem(sock, `${comum}@s.whatsapp.net`, `${comum}@s.whatsapp.net`), false)
  })
  await teste('off mantém dono no grupo e privado', async () => {
    assert.equal(await estado.permitirMensagem(sock, grupo, `${dono}@s.whatsapp.net`), true)
    assert.equal(await estado.permitirMensagem(sock, `${dono}@s.whatsapp.net`, `${dono}@s.whatsapp.net`), true)
  })
  await teste('LID: dono permitido, admin comum bloqueado', async () => {
    assert.equal(await estado.permitirMensagem(sock, grupo, '12345@lid'), true)
    assert.equal(await estado.permitirMensagem(sock, grupo, '67890@lid'), false)
  })
  await teste('LID cru igual ao telefone do dono não autoriza', async () => {
    assert.equal(await estado.permitirMensagem(sock, grupo, `${dono}@lid`), false)
  })
  await teste('LID privado resolvido pela sessão', async () => {
    lid.__definirConsultaSessaoTeste(async id => id === '98765' ? dono : null)
    assert.equal(await estado.permitirMensagem(sock, '98765@lid', '98765@lid'), true)
  })
  await teste('falha de metadata sem mapeamento não libera', async () => {
    const quebrado = { groupMetadata: async () => { throw new Error('metadata') } }
    assert.equal(await estado.permitirMensagem(quebrado, grupo, '11111@lid'), false)
  })
  await teste('não-dono não consegue executar on nem off diretamente', async () => {
    const antes = escritas
    for (const comando of comandos) await comando.executar(sock, grupo, msg(`${comum}@s.whatsapp.net`))
    assert.equal(escritas, antes)
    assert.match(sock.envios.at(-1).text, /Só o dono/)
  })
  await teste('reinício do cache recupera off do Mongo', async () => {
    estado.__definirColecaoTeste(colecao)
    assert.equal(await estado.obterLigado(), false)
  })
  await teste('dono por LID usa on e libera imediatamente', async () => {
    await comandos.find(c => c.nome === 'on').executar(sock, grupo, msg('12345@lid'))
    assert.equal(documento.ligado, true)
    assert.equal(await estado.permitirMensagem(sock, grupo, `${comum}@s.whatsapp.net`), true)
  })
  await teste('falha ao gravar off mantém estado anterior e avisa', async () => {
    falharEscrita = true
    await comandos.find(c => c.nome === 'off').executar(sock, grupo, msg(`${dono}@s.whatsapp.net`))
    assert.equal(await estado.obterLigado(), true)
    assert.equal(documento.ligado, true)
    assert.match(sock.envios.at(-1).text, /Nenhuma alteração foi confirmada/)
    falharEscrita = false
  })
  await teste('falha inicial de leitura bloqueia comum, preserva dono e limita retentativas', async () => {
    estado.__definirColecaoTeste(colecao)
    falharLeitura = true
    const antes = leituras
    assert.equal(await estado.permitirMensagem(sock, grupo, `${comum}@s.whatsapp.net`), false)
    assert.equal(await estado.permitirMensagem(sock, grupo, `${dono}@s.whatsapp.net`), true)
    assert.equal(leituras, antes + 1)
    falharLeitura = false
    const relogio = Date.now
    Date.now = () => relogio() + 61000
    try { assert.equal(await estado.obterLigado(), true) } finally { Date.now = relogio }
  })
  await teste('documento inválido não libera uso geral', async () => {
    documento = { _id: 'global', ligado: 'false' }
    estado.__definirColecaoTeste(colecao)
    assert.equal(await estado.obterLigado(), false)
    await estado.definirLigado(false)
  })
  await teste('leitura antiga não sobrescreve alteração confirmada', async () => {
    let liberar
    estado.__definirColecaoTeste({
      findOne: () => new Promise(resolve => { liberar = resolve }),
      updateOne: colecao.updateOne
    })
    const lendo = estado.obterLigado()
    await Promise.resolve()
    await estado.definirLigado(false)
    liberar({ ligado: true })
    assert.equal(await lendo, false)
    assert.equal(await estado.obterLigado(), false)
    estado.__definirColecaoTeste(colecao)
  })
  await teste('ON salvo é recuperado depois de reinício e cache válido evita consultas', async () => {
    await estado.definirLigado(true)
    estado.__definirColecaoTeste(colecao)
    assert.equal(await estado.obterLigado(), true)
    const antes = leituras
    falharLeitura = true
    for (let i = 0; i < 5; i++) assert.equal(await estado.obterLigado(), true)
    assert.equal(leituras, antes)
    falharLeitura = false
    await estado.definirLigado(false)
  })
  // Executa o listener COMPLETO de produção com dependências offline.
  // Assim regressões de posicionamento da barreira quebram estes testes.
  function criarHandler() {
    const fonte = fs.readFileSync(require.resolve('../bot'), 'utf8')
    const inicio = fonte.indexOf("sock.ev.on('messages.upsert', async ({ messages, type }) => {")
    const fim = fonte.indexOf("sock.ev.on('connection.update'", inicio)
    assert.ok(inicio >= 0 && fim > inicio)
    const ouvintes = new Map()
    const exclusoes = []
    const eventos = []
    const polls = []
    const respostasPrefixo = []
    const imagensTotag = []
    const downloadsTotag = []
    const protecoes = {}
    const mapaAfk = new Map()
    const mutados = new Map()
    const registro = new Map([['mute', { mutedUsers: mutados }]])
    require('../dados/antilinkhard-config').__definirColecoesTeste({ config: require('./helpers/colecao-figurinhas-fake')(), eventos: require('./helpers/colecao-figurinhas-fake')(), travas: require('./helpers/colecao-figurinhas-fake')() })
    require('../dados/moderacao-antilinkhard').__limparCacheTeste()
    const floodFake = require('./helpers/colecao-figurinhas-fake')
    require('../dados/antiflood-config').__definirColecoesTeste({ config: floodFake(), eventos: floodFake(), cooldowns: floodFake() })
    require('../dados/moderacao-antiflood').__limparTeste()
    const antiflood = require('../comandos/admin/antiflood')
    registro.set('antiflood', { executar: async (...args) => { eventos.push('comando:antiflood'); return antiflood.executar(...args) } })
    // Mock apenas do download usado pelo comando real; demais módulos usam o Baileys real.
    const entradaBaileys = require.resolve('@whiskeysockets/baileys')
    const baileysReal = require('@whiskeysockets/baileys')
    const cacheBaileys = require.cache[entradaBaileys]
    let totag
    try {
      require.cache[entradaBaileys] = { exports: { ...baileysReal, downloadMediaMessage: async (...args) => {
        downloadsTotag.push(args)
        return Buffer.from('imagem-totag-offline')
      } } }
      totag = require('../comandos/admin/totag')
    } finally { require.cache[entradaBaileys] = cacheBaileys }
    for (const nome of [totag.nome, ...totag.aliases]) {
      registro.set(nome, { executar: async (...args) => {
        eventos.push('comando:totag')
        return totag.executar(...args)
      } })
    }
    const limparChat = require('../comandos/menu-dono/limpar-chat')
    const regrasFigurinhas = require('../dados/figurinhas-regras')
    const moderacaoFigurinhas = require('../dados/moderacao-figurinhas')
    const colecaoFake = require('./helpers/colecao-figurinhas-fake')
    regrasFigurinhas.__definirColecoesTeste({ regras: colecaoFake(), ocorrencias: colecaoFake() })
    moderacaoFigurinhas.__definirDownloadTeste(async () => require('node:stream').Readable.from([Buffer.from('figurinha-off')]))
    for (const cmd of require('../comandos/admin/figurinhas-moderacao')) {
      registro.set(cmd.nome, { executar: async (...args) => {
        eventos.push(`comando:${cmd.nome}`)
        return cmd.executar(...args)
      } })
    }
    for (const cmd of [require('../comandos/admin/adv'), require('../comandos/admin/remadv'), require('../comandos/admin/advs'), ...require('../comandos/admin/advertencias-consultas')]) {
      for (const nome of [cmd.nome, ...(cmd.aliases || [])]) registro.set(nome, { executar: async (...args) => {
        eventos.push(`comando:${cmd.nome}`)
        return cmd.executar(...args)
      } })
    }
    const antilinkhard = require('../comandos/admin/antilinkhard')
    for (const nome of [antilinkhard.nome, ...antilinkhard.aliases]) registro.set(nome, { executar: async (...args) => { eventos.push('comando:antilinkhard'); return antilinkhard.executar(...args) } })
    registro.set('limpar-chat', { executar: async (...args) => {
      eventos.push('comando:limpar-chat')
      return limparChat.executar(...args)
    } })
    let sequencia = 0
    for (const nome of ['menu', 'ping', 'vip', 'ban', 'on', 'off', 'forca', 'rankativo', 'inativos']) {
      registro.set(nome, { executar: async () => eventos.push(`comando:${nome}`) })
    }
    const sairGrupo = require('../comandos/menu-dono/sairgrupo')
    const setPrefix = require('../comandos/menu-dono/set-prefix')
    for (const nome of [setPrefix.nome, ...setPrefix.aliases]) {
      registro.set(nome, { executar: async (...args) => {
        eventos.push('comando:set-prefix')
        return setPrefix.executar(...args)
      } })
    }
    for (const cmd of [require('../comandos/menu-brincadeiras/enquete')[0], require('../comandos/admin/enquete-admin')[0]]) {
      for (const nome of [cmd.nome, ...cmd.aliases]) {
        registro.set(nome, { executar: async (...args) => {
          eventos.push(`comando:${cmd.nome}`)
          return cmd.executar(...args)
        } })
      }
    }
    const comunicado = require('../comandos/menu-dono/comunicado')
    for (const nome of [comunicado.nome, ...comunicado.aliases]) {
      registro.set(nome, { executar: async (...args) => {
        eventos.push('comando:comunicado')
        return comunicado.executar(...args)
      } })
    }
    require('../prefixo').__definirPrefixoTeste('/')
    for (const nome of [sairGrupo.nome, ...sairGrupo.aliases]) {
      registro.set(nome, { executar: async (...args) => {
        eventos.push('comando:sairgrupo')
        return sairGrupo.executar(...args)
      } })
    }
    const contexto = {
      sock: { ...sock, ev: { on(evento, fn) {
        if (!ouvintes.has(evento)) ouvintes.set(evento, [])
        ouvintes.get(evento).push(fn)
      } },
        async groupFetchAllParticipating() { return { [grupo]: { id: grupo } } },
        async groupLeave(jid) { assert.equal(jid, grupo); eventos.push('saida-grupo') },
        async sendMessage(jid, conteudo) {
          if (conteudo.text?.includes('Meu prefixo atual é:')) respostasPrefixo.push({ jid, texto: conteudo.text })
          if (conteudo.poll) polls.push(conteudo.poll)
          if (conteudo.image && conteudo.contextInfo?.mentionedJid) imagensTotag.push(conteudo)
          eventos.push(conteudo.delete ? 'delete' : 'resposta')
          if (conteudo.delete) {
            exclusoes.push(conteudo.delete)
            for (const fn of ouvintes.get('messages.update') || []) fn([{
              key: conteudo.delete,
              update: { message: null, messageStubType: require('@whiskeysockets/baileys').WAMessageStubType.REVOKE }
            }])
          }
          const mensagemPoll = conteudo.poll ? await require('./helpers/enquete-nativa-fake').mensagemEnviada(jid, conteudo) : null
          return { key: { remoteJid: jid, fromMe: true, id: `manutencao-${++sequencia}` }, ...(mensagemPoll ? { message: mensagemPoll.message } : {}) }
        }
      },
      estadoBot: estado,
      respostaPrefixo: require('../dados/resposta-prefixo'),
      moderacaoFigurinhas,
      moderacaoAntiflood: require('../dados/moderacao-antiflood'),
      moderacaoAntilinkHard: require('../dados/moderacao-antilinkhard'),
      temLinkBasico: require('../dados/deteccao-links').temLinkBasico,
      console,
      path: require('node:path'),
      __dirname: require('node:path').dirname(require.resolve('../bot')),
      fs: { existsSync: () => true, readFileSync: () => JSON.stringify(protecoes) },
      configAtiva: (configs, a, b, jid) => configs[a]?.includes(jid) || configs[b]?.includes(jid),
      OWNER_NUMBERS, limparNumero: require('../config').limparNumero,
      ehRemetenteEhDono: estado.remetenteEhDono,
      ehDonoDoBot: require('../config').ehDonoDoBot,
      ehAdminDoGrupo: require('../config').ehAdminDoGrupo,
      AVISAR_BLOQUEIO: false,
      antiApagadaHabilitada: async () => true,
      tratarRevogacao: async () => { eventos.push('revogacao'); return null },
      rankingRegistro: { registrarComNumeroReal: async () => { eventos.push('ranking') } },
      capturaDiaria: { capturarMensagem: () => eventos.push('jornal') },
      cacheMensagens: { capturarMensagem: async () => { eventos.push('cache') } },
      extrairTextoComando: require('../dados/texto-comando').extrairTextoComando,
      comandos: registro,
      resolverJidAfk: async (_, jid) => ({ numero: require('../config').limparNumero(jid), via: 'direto' }),
      buscarVariosAfk: async () => { eventos.push('afk'); return mapaAfk },
      removerAfk: async () => eventos.push('afk-removido'),
      formatarDuracao: () => '1 minuto', MOTIVO_PADRAO: 'ausente',
      prefixoComandos: require('../prefixo'),
      processarMensagemLivre: async (...args) => {
        eventos.push('jogo')
        const jogos = require('../dados/jogos-ativos')
        return ['enquete', 'enquete-admin'].includes(jogos.tipoAtivo(args[1])) ? jogos.processarMensagemLivre(...args) : false
      },
      processarGatilhoIA: async () => eventos.push('ia')
    }
    require('../dados/mensagens-enviadas').acompanharSocket(contexto.sock)
    vm.runInNewContext(fonte.slice(inicio, fim), contexto)
    return { eventos, exclusoes, protecoes, mapaAfk, mutados, polls, imagensTotag, downloadsTotag, respostasPrefixo, sock: contexto.sock, async enviar(texto, sender = `${comum}@s.whatsapp.net`, conteudo, fromMe = false, jidDestino = grupo) {
      eventos.length = 0
      const mensagem = msg(sender)
      mensagem.key.remoteJid = jidDestino
      if (!jidDestino.endsWith('@g.us')) delete mensagem.key.participant
      const lote = { type: 'notify', messages: [{ ...mensagem, messageTimestamp: Math.floor(Date.now()/1000), key: { ...mensagem.key, id: `recebida-${++sequencia}`, fromMe }, message: conteudo || { conversation: texto } }] }
      for (const fn of ouvintes.get('messages.upsert') || []) await fn(lote)
      await Promise.resolve()
    } }
  }
  const fluxo = criarHandler()
  await teste('OFF: moderação de figurinhas real funciona; ADM bloqueado e dono gerencia regras', async () => {
    const regras = require('../dados/figurinhas-regras')
    const hash = require('node:crypto').createHash('sha256').update('figurinha-off').digest('hex')
    await regras.cadastrar(grupo, hash, 'del', dono)
    await estado.definirLigado(false)
    await fluxo.enviar('', `${comum}@s.whatsapp.net`, { stickerMessage: {} })
    assert.ok(fluxo.eventos.includes('delete'), 'proteção antes do gate OFF')
    const quoted = nome => ({ extendedTextMessage: { text: `/${nome}`, contextInfo: {
      quotedMessage: { stickerMessage: {} }, stanzaId: 'figurinha-off-original', participant: `${comum}@s.whatsapp.net`
    } } })
    for (const cmd of ['figban', 'figadv', 'figdel', 'delfigban', 'delfigadv', 'delfigdel', 'figlistanegra']) {
      await fluxo.enviar(`/${cmd}`, '67890@lid', quoted(cmd))
      assert.ok(!fluxo.eventos.some(e => e.startsWith('comando:') || e === 'resposta'))
    }
    await fluxo.enviar('/figban', '12345@lid', quoted('figban'))
    assert.ok(fluxo.eventos.includes('comando:figban'))
    assert.equal(await regras.consultar(grupo, hash), 'ban')
    await regras.remover(grupo, hash, 'ban')
  })
  await teste('ON + ADM limpa mensagens de terceiros; OFF bloqueia ADM e permite dono', async () => {
    await estado.definirLigado(true)
    await fluxo.enviar('mensagem de terceiro')
    const quantidadeAntes = fluxo.exclusoes.length
    await fluxo.enviar('/limpar-chat 1', '67890@lid')
    assert.equal(fluxo.exclusoes.length, quantidadeAntes + 1)
    assert.equal(fluxo.exclusoes.at(-1).fromMe, false)
    assert.equal(fluxo.exclusoes.at(-1).participant, `${comum}@s.whatsapp.net`)
    await estado.definirLigado(false)
    await fluxo.enviar('outra mensagem durante OFF')
    const antesOff = fluxo.exclusoes.length
    await fluxo.enviar('/limpar-chat 1', '67890@lid')
    assert.equal(fluxo.exclusoes.length, antesOff)
    await fluxo.enviar('/limpar-chat 1', '12345@lid')
    assert.equal(fluxo.exclusoes.length, antesOff + 1)
    assert.equal(fluxo.exclusoes.at(-1).fromMe, false)
  })
  await teste('OFF: sairgrupo real exige dono e confirmação, incluindo aliases', async () => {
    const sairGrupo = require('../comandos/menu-dono/sairgrupo')
    await estado.definirLigado(false)
    for (const nome of [sairGrupo.nome, ...sairGrupo.aliases]) {
      sairGrupo.__limparConfirmacoesTeste()
      for (const sender of [`${comum}@s.whatsapp.net`, '67890@lid']) {
        await fluxo.enviar(`/${nome}`, sender)
        assert.ok(!fluxo.eventos.includes('comando:sairgrupo'))
      }
      await fluxo.enviar(`/${nome}`, '12345@lid')
      assert.ok(fluxo.eventos.includes('comando:sairgrupo'))
      assert.ok(!fluxo.eventos.includes('saida-grupo'))
      await fluxo.enviar(`/${nome} confirmar`, '12345@lid')
      assert.ok(fluxo.eventos.includes('saida-grupo'))
      await fluxo.enviar(`/${nome} confirmar`, '12345@lid')
      assert.ok(!fluxo.eventos.includes('saida-grupo'))
    }
    sairGrupo.__limparConfirmacoesTeste()
  })
  await teste('Mensagens do bot não alimentam o contador existente', async () => {
    await fluxo.enviar('/rankativo', `${comum}@s.whatsapp.net`, undefined, true)
    assert.ok(!fluxo.eventos.includes('ranking'))
    assert.ok(!fluxo.eventos.includes('comando:rankativo'))
  })
  await teste('Novos comandos respeitam ON/OFF no handler de produção', async () => {
    for (const nome of ['rankativo', 'inativos']) {
      await estado.definirLigado(false)
      for (const sender of [`${comum}@s.whatsapp.net`, '67890@lid']) {
        await fluxo.enviar(`/${nome}`, sender)
        assert.ok(!fluxo.eventos.includes(`comando:${nome}`))
      }
      await fluxo.enviar(`/${nome}`, '12345@lid')
      assert.ok(fluxo.eventos.includes(`comando:${nome}`))
      await estado.definirLigado(true)
      await fluxo.enviar(`/${nome}`)
      assert.ok(fluxo.eventos.includes(`comando:${nome}`))
    }
    await estado.definirLigado(false)
  })
  await teste('OFF: comandos reais de advertência e aliases bloqueiam ADM e permitem dono no roteador', async () => {
    const dados = require('../advertencias')
    dados.__definirColecaoTeste(require('./helpers/colecao-figurinhas-fake')())
    await estado.definirLigado(false)
    for (const nome of ['adv', 'advertir', 'warn', 'remadv', 'removeradv', 'perdoaradv', 'advs', 'advertencias', 'warns', 'minhaspunicoes', 'historicoadv', 'zeraradv', 'setlimiteadv']) {
      await fluxo.enviar(`/${nome}`, '67890@lid')
      assert.ok(!fluxo.eventos.some(e => e.startsWith('comando:')))
      await fluxo.enviar(`/${nome}`, '12345@lid')
      assert.ok(fluxo.eventos.some(e => e.startsWith('comando:')))
    }
    await fluxo.enviar('/setlimiteadv 5', '12345@lid')
    assert.equal(await dados.obterLimiteAdvertencias(grupo), 5)
    await estado.definirLigado(true)
    await fluxo.enviar('/minhaspunicoes', `${comum}@s.whatsapp.net`)
    assert.ok(fluxo.eventos.includes('comando:minhaspunicoes'))
    await estado.definirLigado(false)
  })
  await teste('ON + ADM: limpar-chat real apaga 10 mensagens via handler', async () => {
    await estado.definirLigado(true)
    for (let i = 0; i < 10; i++) await fluxo.sock.sendMessage(grupo, { text: 'teste' })
    await fluxo.enviar('/limpar-chat 10', '67890@lid')
    assert.ok(fluxo.eventos.includes('comando:limpar-chat'))
    assert.equal(fluxo.eventos.filter(e => e === 'delete').length, 10)
    await estado.definirLigado(false)
  })
  await teste('OFF + ADM: limpar-chat bloqueado antes de executar', async () => {
    for (let i = 0; i < 10; i++) await fluxo.sock.sendMessage(grupo, { text: 'teste' })
    await fluxo.enviar('/limpar-chat 10', '67890@lid')
    assert.ok(!fluxo.eventos.includes('comando:limpar-chat'))
    assert.ok(!fluxo.eventos.includes('delete'))
  })
  await teste('OFF + dono: limpar-chat real continua permitido', async () => {
    await fluxo.enviar('/limpar-chat 10', '12345@lid')
    assert.ok(fluxo.eventos.includes('comando:limpar-chat'))
    assert.equal(fluxo.eventos.filter(e => e === 'delete').length, 10)
  })
  await teste('OFF bloqueia menu, comum, VIP, ADM e comando de jogo sem resposta', async () => {
    for (const comando of ['menu', 'ping', 'vip', 'ban', 'forca']) {
      await fluxo.enviar(`/${comando}`)
      assert.ok(!fluxo.eventos.some(e => e.startsWith('comando:') || e === 'resposta'))
      assert.ok(fluxo.eventos.includes('ranking'))
    }
  })
  await teste('OFF bloqueia jogada livre e IA', async () => {
    await fluxo.enviar('pular')
    assert.ok(!fluxo.eventos.includes('jogo'))
    assert.ok(!fluxo.eventos.includes('ia'))
  })
  await teste('OFF permite ao dono menu, comum, on e off', async () => {
    for (const comando of ['menu', 'ping', 'on', 'off']) {
      await fluxo.enviar(`/${comando}`, `${dono}@s.whatsapp.net`)
      assert.ok(fluxo.eventos.includes(`comando:${comando}`))
    }
  })
  await teste('ON: prefixo isolado responde uma vez, após moderação e antes de jogos/IA', async () => {
    await estado.definirLigado(true)
    const cooldowns = require('../dados/cooldowns')
    fluxo.protecoes.onlyAdmin = [grupo]
    try {
      for (const palavra of ['prefixo', 'PREFIXO', ' Prefixo ', 'PrEfIxO']) {
        cooldowns.limpar()
        const antes = fluxo.respostasPrefixo.length
        await fluxo.enviar(palavra)
        assert.equal(fluxo.respostasPrefixo.length, antes + 1)
        assert.ok(!fluxo.eventos.includes('jogo'))
        assert.ok(!fluxo.eventos.includes('ia'))
        for (const evento of ['revogacao', 'ranking', 'jornal', 'cache']) assert.ok(fluxo.eventos.includes(evento), evento)
      }
    } finally { delete fluxo.protecoes.onlyAdmin; cooldowns.limpar(); await estado.definirLigado(false) }
  })
  await teste('ON: frases não acionam prefixo e continuam nos jogos/IA', async () => {
    await estado.definirLigado(true)
    const antes = fluxo.respostasPrefixo.length
    for (const frase of ['qual é o prefixo?', 'me fala o prefixo', 'prefixos']) {
      await fluxo.enviar(frase)
      assert.equal(fluxo.respostasPrefixo.length, antes)
      assert.ok(fluxo.eventos.includes('jogo')); assert.ok(fluxo.eventos.includes('ia'))
    }
    await estado.definirLigado(false)
  })
  await teste('ON: consulta funciona no privado e cooldown é por conversa', async () => {
    await estado.definirLigado(true)
    const cooldowns = require('../dados/cooldowns')
    cooldowns.limpar()
    const antes = fluxo.respostasPrefixo.length
    await fluxo.enviar('prefixo')
    await fluxo.enviar('PREFIXO', '67890@lid')
    assert.equal(fluxo.respostasPrefixo.length, antes + 1)
    assert.ok(!fluxo.eventos.includes('jogo')); assert.ok(!fluxo.eventos.includes('ia'))
    await fluxo.enviar('prefixo', `${comum}@s.whatsapp.net`, undefined, false, `${comum}@s.whatsapp.net`)
    assert.equal(fluxo.respostasPrefixo.length, antes + 2)
    assert.equal(fluxo.respostasPrefixo.at(-1).jid, `${comum}@s.whatsapp.net`)
    cooldowns.limpar(); await estado.definirLigado(false)
  })
  await teste('prefixo global alterado por set-prefix real aparece na consulta e no roteador', async () => {
    const prefixo = require('../prefixo')
    const cooldowns = require('../dados/cooldowns')
    let documento = { prefixo: '/' }, escritas = 0
    prefixo.__definirColecaoTeste({
      findOne: async () => documento,
      updateOne: async (_, atualizacao) => { documento = atualizacao.$set; escritas++ }
    })
    await estado.definirLigado(true)
    try {
      await fluxo.enviar('/set-prefix !', `${dono}@s.whatsapp.net`)
      assert.ok(fluxo.eventos.includes('comando:set-prefix'))
      cooldowns.limpar()
      await fluxo.enviar('prefixo')
      assert.match(fluxo.respostasPrefixo.at(-1).texto, /Use !menu/)
      await fluxo.enviar('!menu')
      assert.ok(fluxo.eventos.includes('comando:menu'))
      await fluxo.enviar('/prefixo', `${dono}@s.whatsapp.net`)
      assert.ok(fluxo.eventos.includes('comando:set-prefix'), 'alias existente preservado')
      assert.equal(escritas, 1)
    } finally {
      cooldowns.limpar(); prefixo.__definirColecaoTeste(null); prefixo.__definirPrefixoTeste('/')
      await estado.definirLigado(false)
    }
  })
  await teste('OFF: consulta bloqueada para comum, ADM e VIP em grupo e privado', async () => {
    await estado.definirLigado(false)
    const antes = fluxo.respostasPrefixo.length
    for (const sender of [`${comum}@s.whatsapp.net`, '67890@lid', '5511555550000@s.whatsapp.net']) {
      await fluxo.enviar('prefixo', sender)
      await fluxo.enviar('prefixo', sender, undefined, false, sender)
      assert.equal(fluxo.respostasPrefixo.length, antes)
    }
  })
  await teste('OFF: dono consulta por JID/LID no grupo e no privado', async () => {
    const cooldowns = require('../dados/cooldowns')
    lid.__definirConsultaSessaoTeste(async id => id === '98765' ? dono : null)
    try {
      for (const [sender, jid] of [['12345@lid', grupo], [`${dono}@s.whatsapp.net`, `${dono}@s.whatsapp.net`], ['98765@lid', '98765@lid']]) {
        cooldowns.limpar()
        const antes = fluxo.respostasPrefixo.length
        await fluxo.enviar(' Prefixo ', sender, undefined, false, jid)
        assert.equal(fluxo.respostasPrefixo.length, antes + 1)
        assert.equal(await estado.obterLigado(), false)
      }
    } finally { cooldowns.limpar(); lid.__definirConsultaSessaoTeste(async () => null) }
  })
  await teste('OFF: totag/notag2 com imagem citada bloqueia ADM e permite dono LID', async () => {
    await estado.definirLigado(false)
    for (const nome of ['totag', 'notag2']) {
      const message = { ephemeralMessage: { message: { imageMessage: { caption: `/${nome}`, contextInfo: {
        stanzaId: 'imagem-original', participant: `${comum}@s.whatsapp.net`,
        quotedMessage: { imageMessage: { caption: 'Legenda original', mimetype: 'image/jpeg', url: 'https://example.invalid/original' } }
      } } } } }
      const antes = fluxo.downloadsTotag.length
      for (const sender of [`${comum}@s.whatsapp.net`, '67890@lid']) {
        await fluxo.enviar('', sender, message)
        assert.ok(!fluxo.eventos.includes('comando:totag'))
      }
      assert.equal(fluxo.downloadsTotag.length, antes)
      await fluxo.enviar('', '12345@lid', message)
      assert.ok(fluxo.eventos.includes('comando:totag'))
      assert.equal(fluxo.downloadsTotag.length, antes + 1)
      assert.equal(fluxo.downloadsTotag.at(-1)[0].key.id, 'imagem-original')
      const envio = fluxo.imagensTotag.at(-1)
      assert.deepEqual(envio.image, Buffer.from('imagem-totag-offline'))
      assert.equal(envio.caption, 'Legenda original')
      assert.deepEqual(envio.contextInfo.mentionedJid, (await fluxo.sock.groupMetadata(grupo)).participants.map(p => p.id))
      assert.equal(await estado.obterLigado(), false)
    }
  })
  await teste('ON: ADM LID reenvia imagem por totag no handler', async () => {
    await estado.definirLigado(true)
    const antes = fluxo.downloadsTotag.length
    await fluxo.enviar('/totag', '67890@lid', { extendedTextMessage: { text: '/totag', contextInfo: {
      stanzaId: 'imagem-sem-legenda', participant: `${comum}@s.whatsapp.net`,
      quotedMessage: { imageMessage: { mimetype: 'image/png', url: 'https://example.invalid/original' } }
    } } })
    assert.equal(fluxo.downloadsTotag.length, antes + 1)
    assert.ok(fluxo.eventos.includes('comando:totag'))
    assert.equal(fluxo.imagensTotag.at(-1).caption, undefined)
    await estado.definirLigado(false)
  })
  await teste('OFF preserva gate das enquetes nativas e aliases no handler real', async () => {
    const jogos = require('../dados/jogos-ativos')
    await estado.definirLigado(false)
    for (const [nome, alias] of [['enquete', 'enquete-opiniao'], ['enquete-admin', 'votacao']]) {
      const antes = fluxo.polls.length
      for (const sender of [`${comum}@s.whatsapp.net`, '67890@lid']) {
        await fluxo.enviar(`/${alias} P | A | B`, sender)
        assert.ok(!fluxo.eventos.includes(`comando:${nome}`))
      }
      assert.equal(fluxo.polls.length, antes)
      await fluxo.enviar(`/${alias} P | A | B`, '12345@lid')
      assert.ok(fluxo.eventos.includes(`comando:${nome}`))
      assert.equal(fluxo.polls.length, antes + 1)
      assert.equal(fluxo.polls.at(-1).selectableCount, 1)
      const cmd = require(nome === 'enquete' ? '../comandos/menu-brincadeiras/enquete' : '../comandos/admin/enquete-admin')[0]
      cmd.encerrarEnquete(grupo)
      assert.equal(jogos.obterJogo(grupo), null)
    }
    assert.equal(await estado.obterLigado(), false)
  })
  await teste('voto nativo chega à apuração pelo handler e respeita OFF', async () => {
    const protocolo = require('./helpers/enquete-nativa-fake')
    for (const nome of ['enquete', 'enquete-admin']) {
      await fluxo.enviar(`/${nome} P | A | B`, '12345@lid')
      const cmd = require(nome === 'enquete' ? '../comandos/menu-brincadeiras/enquete' : '../comandos/admin/enquete-admin')[0]
      const dados = cmd._enqueteAtiva(grupo)
      const update = () => protocolo.voto(dados, grupo, `${comum}@s.whatsapp.net`, [0], { criador: fluxo.sock.user.id }).message
      await fluxo.enviar('', `${comum}@s.whatsapp.net`, update())
      assert.equal(cmd.apurar(dados).total, 0, 'OFF bloqueia apuração do voto de não dono')
      await estado.definirLigado(true)
      await fluxo.enviar('', `${comum}@s.whatsapp.net`, update())
      assert.equal(cmd.apurar(dados).total, 1, 'ON recebe voto nativo pelo fluxo de produção')
      cmd.encerrarEnquete(grupo)
      await estado.definirLigado(false)
    }
  })
  await teste('OFF: comunicado real prepara, confirma e relata via handler para dono LID', async () => {
    await estado.definirLigado(false)
    for (const acao of ['Aviso de manutenção', 'confirmar']) {
      await fluxo.enviar(`/comunicado ${acao}`, '12345@lid')
      assert.ok(fluxo.eventos.includes('comando:comunicado'))
    }
    await require('../comunicados').sistema.aguardarConclusao()
    assert.equal(await estado.obterLigado(), false)
    for (const sender of [`${comum}@s.whatsapp.net`, '67890@lid']) {
      await fluxo.enviar('/broadcast proibido', sender)
      assert.ok(!fluxo.eventos.includes('comando:comunicado'))
    }
  })
  await teste('OFF: parar chega ao envio real em andamento pelo handler', async () => {
    const enviarOriginal = fluxo.sock.sendMessage
    let concluirEnvio
    const espera = new Promise(resolve => { concluirEnvio = resolve })
    const relatorios = []
    fluxo.sock.sendMessage = async (jid, conteudo, opcoes) => {
      if (conteudo.text?.startsWith('🌙 *HIPNOS —')) await espera
      if (conteudo.text?.includes('RELATÓRIO DO COMUNICADO')) relatorios.push(conteudo.text)
      return enviarOriginal(jid, conteudo, opcoes)
    }
    try {
      await fluxo.enviar('/avisogeral Manutenção', '12345@lid')
      await fluxo.enviar('/anunciar confirmar', '12345@lid')
      await fluxo.enviar('/comunicado parar', '12345@lid')
      assert.ok(fluxo.eventos.includes('comando:comunicado'))
      concluirEnvio()
      await require('../comunicados').sistema.aguardarConclusao()
      assert.match(relatorios[0], /Interrompido pelo dono/)
      assert.equal(await estado.obterLigado(), false)
    } finally { concluirEnvio(); fluxo.sock.sendMessage = enviarOriginal }
  })
  await teste('modo somente admin permite dono LID resolvido pela sessão sem metadados', async () => {
    fluxo.protecoes.onlyAdmin = [grupo]
    const obterMetadata = fluxo.sock.groupMetadata
    fluxo.sock.groupMetadata = async () => { throw new Error('metadata offline') }
    lid.__definirConsultaSessaoTeste(async id => id === '98765' ? dono : null)
    try {
      await fluxo.enviar('/comunicado Manutenção', '98765@lid')
      assert.ok(fluxo.eventos.includes('comando:comunicado'))
      await fluxo.enviar('/comunicado cancelar', '98765@lid')
    } finally {
      fluxo.sock.groupMetadata = obterMetadata
      delete fluxo.protecoes.onlyAdmin
      lid.__definirConsultaSessaoTeste(async () => null)
    }
  })
  await teste('OFF mantém antilink e antiáudio executando no handler real', async () => {
    fluxo.protecoes.antiLink = [grupo]
    await fluxo.enviar('https://exemplo.com')
    assert.ok(fluxo.eventos.includes('delete'))
    delete fluxo.protecoes.antiLink
    fluxo.protecoes.antiAudio = [grupo]
    await fluxo.enviar('', `${comum}@s.whatsapp.net`, { audioMessage: { mimetype: 'audio/ogg' } })
    assert.ok(fluxo.eventos.includes('delete'))
    delete fluxo.protecoes.antiAudio
  })
  // Integração real: o hard recebe prioridade antes do antilink JSON e do OFF.
  for (const [basico, hard] of [[true, false], [false, true], [true, true]]) {
    await teste(`handler: antilink=${basico}, hard=${hard}, sem efeitos duplicados`, async () => {
      const conf = require('../dados/antilinkhard-config'), mod = require('../dados/moderacao-antilinkhard')
      conf.__definirColecoesTeste({ config: require('./helpers/colecao-figurinhas-fake')(), eventos: require('./helpers/colecao-figurinhas-fake')(), travas: require('./helpers/colecao-figurinhas-fake')() })
      mod.__limparCacheTeste()
      await conf.definir(grupo, hard, dono)
      const originalMeta = fluxo.sock.groupMetadata, originalRemover = fluxo.sock.groupParticipantsUpdate
      fluxo.sock.groupMetadata = async () => ({ participants: [
        { id: '5511666660000@s.whatsapp.net', lid: '66666@lid', admin: 'admin' },
        { id: `${comum}@s.whatsapp.net` }, { id: `${dono}@s.whatsapp.net` }
      ] })
      let remocoes = 0
      fluxo.sock.groupParticipantsUpdate = async (_, ids) => { remocoes++; return ids.map(jid => ({ jid, status: '200' })) }
      if (basico) fluxo.protecoes.antiLink = [grupo]; else delete fluxo.protecoes.antiLink
      try {
        await estado.definirLigado(false)
        await fluxo.enviar('https://example.com', `${comum}@s.whatsapp.net`)
        assert.equal(fluxo.eventos.filter(e => e === 'delete').length, 1)
        assert.equal(remocoes, hard ? 1 : 0)
        assert.equal(fluxo.eventos.filter(e => e === 'resposta').length, hard ? 1 : 0)
        assert.ok(!fluxo.eventos.includes('jogo'))
        if (basico && hard) {
          await conf.definir(grupo, false, dono)
          await fluxo.enviar('https://example.com', `${comum}@s.whatsapp.net`)
          assert.equal(fluxo.eventos.filter(e => e === 'delete').length, 1)
          assert.equal(remocoes, 1)
          assert.deepEqual(fluxo.protecoes.antiLink, [grupo])
        }
        if (basico && !hard) {
          for (const conteudo of [{ conversation: 'example.com' }, { imageMessage: { caption: 'https://example.com' } }]) {
            await fluxo.enviar('', `${comum}@s.whatsapp.net`, conteudo)
            assert.ok(!fluxo.eventos.includes('delete'), 'antilink básico preserva escopo original')
          }
        }
      } finally {
        fluxo.sock.groupMetadata = originalMeta; fluxo.sock.groupParticipantsUpdate = originalRemover
        delete fluxo.protecoes.antiLink; await conf.definir(grupo, false, dono)
      }
    })
  }
  await teste('OFF: comando hard e aliases bloqueiam ADM e autorizam dono; prefixo dinâmico', async () => {
    const conf = require('../dados/antilinkhard-config')
    await estado.definirLigado(false)
    for (const nome of ['antilinkhard', 'antilink-hard', 'antilinkban']) {
      await fluxo.enviar(`/${nome} on`, '67890@lid')
      assert.ok(!fluxo.eventos.includes('comando:antilinkhard'))
      assert.equal(await conf.obter(grupo), false)
      await fluxo.enviar(`/${nome} on`, '12345@lid')
      assert.ok(fluxo.eventos.includes('comando:antilinkhard'))
      assert.equal(await conf.obter(grupo), true)
      await fluxo.enviar(`/${nome} off`, '12345@lid')
    }
    require('../prefixo').__definirPrefixoTeste('!')
    try {
      await fluxo.enviar('!antilinkhard on', '12345@lid')
      assert.equal(await conf.obter(grupo), true)
      await fluxo.enviar('!antilinkhard status', '12345@lid')
      assert.ok(fluxo.eventos.includes('comando:antilinkhard'))
      await fluxo.enviar('!antilinkhard off', '12345@lid')
    } finally { require('../prefixo').__definirPrefixoTeste('/') }
  })
  await teste('OFF: antiflood real continua apagando; ranking mantido e jogos/IA bloqueados', async () => {
    const conf = require('../dados/antiflood-config'), mod = require('../dados/moderacao-antiflood')
    const original = fluxo.sock.groupMetadata
    fluxo.sock.groupMetadata = async () => ({ participants: [
      { id: '5511666660000@s.whatsapp.net', lid: '66666@lid', admin: 'admin' },
      { id: `${comum}@s.whatsapp.net`, lid: '88888@lid' },
      { id: `${dono}@s.whatsapp.net`, lid: '12345@lid' }
    ] })
    try {
      await estado.definirLigado(false); mod.__limparTeste()
      await conf.definir(grupo, { ativo:true, acao:'apagar' }, dono)
      for(let i=0;i<6;i++) await fluxo.enviar('texto')
      await fluxo.enviar('/menu')
      assert.ok(fluxo.eventos.includes('delete'))
      assert.ok(fluxo.eventos.includes('ranking'))
      assert.ok(!fluxo.eventos.some(e=>e==='jogo'||e==='ia'||e==='comando:menu'))
    } finally { fluxo.sock.groupMetadata = original; await conf.definir(grupo,{ativo:false},dono); mod.__limparTeste() }
  })
  await teste('ON: mensagem excedente não executa comando nem jogos/IA', async () => {
    const conf = require('../dados/antiflood-config'), mod = require('../dados/moderacao-antiflood'), original = fluxo.sock.groupMetadata
    fluxo.sock.groupMetadata = async () => ({ participants: [ { id:'5511666660000@s.whatsapp.net',lid:'66666@lid',admin:'admin' }, { id:`${comum}@s.whatsapp.net` } ] })
    try {
      await estado.definirLigado(true); mod.__limparTeste(); await conf.definir(grupo,{ativo:true,acao:'apagar'},dono)
      for(let i=0;i<6;i++) await fluxo.enviar('texto')
      await fluxo.enviar('/menu'); assert.ok(fluxo.eventos.includes('delete')); assert.ok(!fluxo.eventos.some(e=>e==='comando:menu'||e==='jogo'||e==='ia'))
    } finally { fluxo.sock.groupMetadata=original; await conf.definir(grupo,{ativo:false},dono); mod.__limparTeste() }
  })
  await teste('handler: link na sétima recebe somente punição hard', async () => {
    const conf = require('../dados/antiflood-config'), hard = require('../dados/antilinkhard-config'), mod = require('../dados/moderacao-antiflood')
    const meta=fluxo.sock.groupMetadata, remover=fluxo.sock.groupParticipantsUpdate; let remocoes=0
    const fake = require('./helpers/colecao-figurinhas-fake')
    hard.__definirColecoesTeste({ config:fake(), eventos:fake(), travas:fake() })
    fluxo.sock.groupMetadata=async()=>({participants:[{id:'5511666660000@s.whatsapp.net',lid:'66666@lid',admin:'admin'},{id:`${comum}@s.whatsapp.net`}]})
    fluxo.sock.groupParticipantsUpdate=async(jid,alvos)=>{remocoes++;return alvos.map(jid=>({jid,status:'200'}))}
    try {
      await estado.definirLigado(false); mod.__limparTeste(); require('../dados/moderacao-antilinkhard').__limparCacheTeste()
      await conf.definir(grupo,{ativo:true,acao:'adv'},dono); await hard.definir(grupo,true,dono)
      for(let i=0;i<6;i++)await fluxo.enviar('texto')
      await fluxo.enviar('https://example.com')
      assert.equal(remocoes,1); assert.equal(fluxo.eventos.filter(e=>e==='delete').length,1); assert.equal(fluxo.eventos.filter(e=>e==='resposta').length,1)
      await fluxo.enviar('continuação'); assert.equal(fluxo.eventos.filter(e=>e==='delete').length,1); assert.ok(!fluxo.eventos.includes('resposta'))
    } finally { fluxo.sock.groupMetadata=meta; fluxo.sock.groupParticipantsUpdate=remover; await hard.definir(grupo,false,dono); await conf.definir(grupo,{ativo:false},dono); mod.__limparTeste() }
  })
  await teste('OFF: antiflood configuração bloqueia ADM e libera dono com prefixo dinâmico', async () => {
    const conf = require('../dados/antiflood-config')
    await estado.definirLigado(false)
    await fluxo.enviar('/antiflood on','67890@lid'); assert.ok(!fluxo.eventos.includes('comando:antiflood')); assert.equal((await conf.obter(grupo)).ativo,false)
    require('../prefixo').__definirPrefixoTeste('!')
    try {
      await fluxo.enviar('!antiflood on','12345@lid'); assert.ok(fluxo.eventos.includes('comando:antiflood')); assert.equal((await conf.obter(grupo)).ativo,true)
      await fluxo.enviar('!antiflood off','12345@lid'); assert.equal((await conf.obter(grupo)).ativo,false)
    } finally { require('../prefixo').__definirPrefixoTeste('/') }
  })
  await teste('OFF mantém ranking, captura diária, cache e atualização AFK sem avisos', async () => {
    fluxo.mapaAfk.set(comum, { desde: Date.now() - 60000 })
    await fluxo.enviar('voltei')
    for (const evento of ['revogacao', 'ranking', 'jornal', 'cache', 'afk', 'afk-removido']) assert.ok(fluxo.eventos.includes(evento), evento)
    assert.ok(!fluxo.eventos.includes('resposta'))
  })
  await teste('OFF mantém restrição mute existente', async () => {
    fluxo.mutados.set(`${comum}@s.whatsapp.net`, true)
    await fluxo.enviar('/menu')
    assert.ok(!fluxo.eventos.includes('afk'))
    assert.ok(!fluxo.eventos.includes('comando:menu'))
    fluxo.mutados.clear()
  })
  await teste('OFF não impede disparo real de lembrete agendado', async () => {
    const lembretes = require('../lembretes')
    const doc = { _id: 'teste', numero: comum, jid_destino: grupo, texto: 'lembrete de teste', disparar_em: Date.now() - 1000, enviado: false }
    lembretes.__definirColecaoTeste({
      find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [doc] }) }) }),
      updateOne: async () => { doc.enviado = true },
      deleteMany: async () => ({ deletedCount: 0 })
    })
    const envios = []
    const resultado = await lembretes.verificarLembretes({ sock: { sendMessage: async (jid, conteudo) => envios.push({ jid, conteudo }) } })
    assert.equal(resultado.enviados, 1)
    assert.equal(doc.enviado, true)
    assert.equal(envios.length, 1)
    assert.equal(await estado.obterLigado(), false)
  })
  await teste('ON mantém comandos, jogos, IA e avisos AFK', async () => {
    await estado.definirLigado(true)
    await fluxo.enviar('/menu')
    assert.ok(fluxo.eventos.includes('comando:menu'))
    fluxo.mapaAfk.set(comum, { desde: Date.now() - 60000 })
    await fluxo.enviar('pular')
    for (const evento of ['jogo', 'ia', 'resposta', 'afk-removido']) assert.ok(fluxo.eventos.includes(evento), evento)
  })
  console.log(`\n${passou} testes passaram.`)
}

main().catch(erro => { console.error(erro); process.exitCode = 1 }).finally(() => {
  OWNER_NUMBERS.splice(0, OWNER_NUMBERS.length, ...donosOriginais)
  lid.__definirConsultaSessaoTeste(null)
})
