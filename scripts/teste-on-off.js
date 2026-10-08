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
    const inicio = fonte.indexOf("sock.ev.on('messages.upsert', async ({ messages }) => {")
    const fim = fonte.indexOf("sock.ev.on('connection.update'", inicio)
    assert.ok(inicio >= 0 && fim > inicio)
    const ouvintes = new Map()
    const exclusoes = []
    const eventos = []
    const protecoes = {}
    const mapaAfk = new Map()
    const mutados = new Map()
    const registro = new Map([['mute', { mutedUsers: mutados }]])
    const limparChat = require('../comandos/menu-dono/limpar-chat')
    registro.set('limpar-chat', { executar: async (...args) => {
      eventos.push('comando:limpar-chat')
      return limparChat.executar(...args)
    } })
    let sequencia = 0
    for (const nome of ['menu', 'ping', 'vip', 'ban', 'on', 'off', 'forca', 'rankativo', 'inativos']) {
      registro.set(nome, { executar: async () => eventos.push(`comando:${nome}`) })
    }
    const sairGrupo = require('../comandos/menu-dono/sairgrupo')
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
        async groupLeave(jid) { assert.equal(jid, grupo); eventos.push('saida-grupo') },
        async sendMessage(jid, conteudo) {
          eventos.push(conteudo.delete ? 'delete' : 'resposta')
          if (conteudo.delete) {
            exclusoes.push(conteudo.delete)
            for (const fn of ouvintes.get('messages.update') || []) fn([{
              key: conteudo.delete,
              update: { message: null, messageStubType: require('@whiskeysockets/baileys').WAMessageStubType.REVOKE }
            }])
          }
          return { key: { remoteJid: jid, fromMe: true, id: `manutencao-${++sequencia}` } }
        }
      },
      estadoBot: estado,
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
      prefixoComandos: { obterPrefixo: async () => '/', resolverNomeComando: text => text.startsWith('/') ? text.slice(1).split(' ')[0] : null },
      processarMensagemLivre: async () => { eventos.push('jogo'); return false },
      processarGatilhoIA: async () => eventos.push('ia')
    }
    require('../dados/mensagens-enviadas').acompanharSocket(contexto.sock)
    vm.runInNewContext(fonte.slice(inicio, fim), contexto)
    return { eventos, exclusoes, protecoes, mapaAfk, mutados, sock: contexto.sock, async enviar(texto, sender = `${comum}@s.whatsapp.net`, conteudo, fromMe = false) {
      eventos.length = 0
      const mensagem = msg(sender)
      const lote = { messages: [{ ...mensagem, key: { ...mensagem.key, id: `recebida-${++sequencia}`, fromMe }, message: conteudo || { conversation: texto } }] }
      for (const fn of ouvintes.get('messages.upsert') || []) await fn(lote)
      await Promise.resolve()
    } }
  }
  const fluxo = criarHandler()
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
