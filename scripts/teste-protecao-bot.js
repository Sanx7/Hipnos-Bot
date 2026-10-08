process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
process.env.OWNER_NUMBERS = '5511000000099,5511000000098'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const lid = require('../lid')
const { limparNumero, OWNER_NUMBERS } = require('../config')
const protecao = require('../dados/protecao-bot')
const sair = require('../comandos/menu-dono/sairgrupo')
const ban = require('../comandos/admin/ban')
require('../prefixo').__definirPrefixoTeste('/')
const GRUPO = '1@g.us', OUTRO = '2@g.us'
const BOT = '5511000000000@s.whatsapp.net', BOT_LID = '90000@lid'
const ADMIN = '5511000000001@s.whatsapp.net', COMUM = '5511000000002@s.whatsapp.net'
const DONO = `${OWNER_NUMBERS[0]}@s.whatsapp.net`, DONO2 = `${OWNER_NUMBERS[1]}@s.whatsapp.net`
const DONO_LID = '90099@lid'
let pares = new Map(), blacklist = [], clock = Date.now
// Usa os helpers reais para normalizar/metadados; sessão offline controlada.
lid.__definirConsultaSessaoTeste(async id => pares.get(id) || null)
lid.resolverLidsEmLote = async ids => new Map(ids.map(limparNumero).filter(id => pares.has(id)).map(id => [id, pares.get(id)]))
ban.__definirGravacaoBlacklistTeste(numero => blacklist.push(numero))
function mensagem(sender = ADMIN, alvo, reply = false, grupo = GRUPO) {
  return { key: { remoteJid: grupo, participant: sender, fromMe: false }, message: {
    extendedTextMessage: { contextInfo: alvo ? (reply ? { participant: alvo } : { mentionedJid: [alvo] }) : {} }
  } }
}
function criarSock() {
  const envios = [], remocoes = [], saidas = [], eventos = []
  return {
    user: { id: '5511000000000:12@s.whatsapp.net', lid: BOT_LID },
    membros: [ { id: BOT_LID, phoneNumber: BOT, admin: 'admin' }, { id: ADMIN, admin: 'admin' },
      { id: COMUM }, { id: DONO }, { id: DONO2 }, { id: DONO_LID, phoneNumber: DONO } ],
    envios, remocoes, saidas, eventos,
    async groupMetadata() { return { participants: this.membros, owner: ADMIN } },
    async sendMessage(jid, conteudo) { envios.push({ jid, ...conteudo }); eventos.push('envio'); return { key: { id: 'mock' } } },
    async groupParticipantsUpdate(jid, alvos, acao) { remocoes.push({ jid, alvos, acao }); return alvos.map(jid => ({ jid, status: '200' })) },
    async groupSettingUpdate() {},
    async groupLeave(jid) { saidas.push(jid); eventos.push('saida') }
  }
}
let passou = 0
async function teste(nome, fn) {
  sair.__limparConfirmacoesTeste(); pares.clear(); blacklist = []
  lid.__definirConsultaSessaoTeste(async id => pares.get(id) || null)
  Date.now = clock
  await fn()
  passou++
  console.log(`PASSOU: ${nome}`)
}
const texto = sock => sock.envios.at(-1)?.text || ''
const COMANDOS_SAIDA = /\/(?:sairgrupo|sairdogrupo|sairgp|leavegp)\b/i
function afirmarRespostaProtecao(resposta) {
  assert.ok(protecao.RESPOSTAS_AUTOEXPULSAO.includes(resposta), 'Deve usar uma das respostas do Hipnos')
  assert.doesNotMatch(resposta, COMANDOS_SAIDA)
}
async function main() {
  await teste('Todas as respostas são sombrias e não revelam comandos de saída', async () => {
    assert.equal(protecao.RESPOSTAS_AUTOEXPULSAO.length, 5)
    for (const resposta of protecao.RESPOSTAS_AUTOEXPULSAO) {
      afirmarRespostaProtecao(resposta)
      assert.match(resposta, /\*Hipnos:\*/)
    }
  })
  await teste('Sorteio não repete consecutivamente, mesmo com random fixo', async () => {
    const randomOriginal = Math.random
    Math.random = () => 0
    try {
      let anterior
      for (let i = 0; i < 30; i++) {
        const resposta = protecao.respostaAutoexpulsao()
        afirmarRespostaProtecao(resposta)
        assert.notEqual(resposta, anterior)
        anterior = resposta
      }
    } finally { Math.random = randomOriginal }
  })
  await teste('Respostas entre comandos diferentes também não repetem nem revelam saída', async () => {
    const sock = criarSock()
    sock.membros.find(p => p.id === DONO).admin = 'admin'
    let anterior
    for (const nome of ['ban', 'kick', 'addblacklist', 'adv']) {
      if (nome === 'kick') delete require.cache[require.resolve('../comandos/admin/kick')]
      await require(`../comandos/admin/${nome}`).executar(sock, GRUPO, mensagem(DONO, BOT_LID), `/${nome} @bot motivo`)
      afirmarRespostaProtecao(texto(sock))
      assert.notEqual(texto(sock), anterior)
      anterior = texto(sock)
    }
    assert.equal(sock.remocoes.length, 0); assert.equal(sock.saidas.length, 0)
  })
  for (const nome of ['ban', 'kick']) for (const [tipo, alvo, reply] of [
    ['menção JID', BOT, false], ['menção LID', BOT_LID, false], ['reply JID', BOT, true], ['reply LID', BOT_LID, true]
  ]) await teste(`${nome} bloqueia bot por ${tipo}`, async () => {
    const sock = criarSock()
    if (nome === 'kick') delete require.cache[require.resolve('../comandos/admin/kick')]
    const cmd = require(`../comandos/admin/${nome}`)
    await cmd.executar(sock, GRUPO, mensagem(ADMIN, alvo, reply), `/${nome} @bot motivo`)
    assert.equal(sock.remocoes.length, 0); assert.equal(sock.saidas.length, 0)
    assert.equal(blacklist.length, 0); afirmarRespostaProtecao(texto(sock))
  })
  await teste('Dono também não pode banir o bot', async () => {
    const sock = criarSock(); sock.membros.find(p => p.id === DONO).admin = 'admin'
    await ban.executar(sock, GRUPO, mensagem(DONO, BOT_LID), '/ban @bot')
    afirmarRespostaProtecao(texto(sock)); assert.equal(sock.remocoes.length, 0)
  })
  for (const nome of ['ban', 'kick']) await teste(`${nome} continua removendo usuário comum`, async () => {
    const sock = criarSock()
    if (nome === 'kick') delete require.cache[require.resolve('../comandos/admin/kick')]
    await require(`../comandos/admin/${nome}`).executar(sock, GRUPO, mensagem(ADMIN, COMUM), `/${nome} @membro motivo`)
    assert.deepEqual(sock.remocoes[0].alvos, [COMUM])
  })
  await teste('Lote ignora somente o bot; promote/demote permanecem intactos', async () => {
    const sock = protecao.protegerRemocoes(criarSock())
    assert.equal(protecao.protegerRemocoes(sock), sock)
    await sock.groupParticipantsUpdate(GRUPO, [BOT_LID, COMUM, ADMIN, BOT], 'remove')
    assert.deepEqual(sock.remocoes[0].alvos, [COMUM, ADMIN])
    await sock.groupParticipantsUpdate(GRUPO, [BOT], 'promote')
    await sock.groupParticipantsUpdate(GRUPO, [BOT], 'demote')
    assert.equal(sock.remocoes.length, 3)
  })
  await teste('Bot por LID dos metadados sem sock.user.lid', async () => {
    const sock = criarSock(); delete sock.user.lid
    assert.equal(await protecao.ehProprioBot(sock, GRUPO, BOT_LID), true)
  })
  await teste('Socket LID e alvo telefone são a mesma conta', async () => {
    const sock = criarSock(); sock.user = { id: BOT_LID }
    assert.equal(await protecao.ehProprioBot(sock, GRUPO, BOT), true)
  })
  await teste('Identidade de sessão resolve LID mesmo sem metadados', async () => {
    const sock = criarSock(); delete sock.user.lid
    sock.groupMetadata = async () => { throw new Error('offline') }
    pares.set('90000', limparNumero(BOT))
    assert.equal(await protecao.ehProprioBot(sock, GRUPO, BOT_LID), true)
  })
  await teste('Dígitos iguais em LID e telefone de outro usuário não confundem contas', async () => {
    const sock = criarSock()
    const outroLid = `${limparNumero(BOT)}@lid`
    sock.membros.push({ id: outroLid, phoneNumber: COMUM })
    assert.equal(await protecao.ehProprioBot(sock, GRUPO, outroLid), false)
    await protecao.protegerRemocoes(sock).groupParticipantsUpdate(GRUPO, [outroLid], 'remove')
    assert.deepEqual(sock.remocoes[0].alvos, [outroLid])
  })
  await teste('LID impossível de distinguir é ignorado sem bloquear outros alvos', async () => {
    const sock = criarSock(); delete sock.user.lid; sock.membros = []
    await assert.rejects(protecao.ehProprioBot(sock, GRUPO, '88888@lid'), /distinguir/)
    await protecao.protegerRemocoes(sock).groupParticipantsUpdate(GRUPO, ['88888@lid', COMUM], 'remove')
    assert.deepEqual(sock.remocoes[0].alvos, [COMUM])
  })
  await teste('Ban automático compartilhado não grava nem remove o bot', async () => {
    const sock = criarSock()
    await assert.rejects(ban.banirDoGrupo(sock, GRUPO, BOT_LID), err => {
      afirmarRespostaProtecao(err.message)
      return true
    })
    assert.equal(blacklist.length, 0); assert.equal(sock.remocoes.length, 0)
  })
  for (const nome of ['addblacklist', 'adv']) await teste(`${nome} bloqueia bot antes de persistir`, async () => {
    const sock = criarSock()
    await require(`../comandos/admin/${nome}`).executar(sock, GRUPO, mensagem(nome === 'adv' ? ADMIN : DONO, BOT_LID), `/${nome} @bot motivo`)
    afirmarRespostaProtecao(texto(sock)); assert.equal(sock.remocoes.length, 0)
  })
  await teste('Votação de ban recusa o bot por LID antes de abrir', async () => {
    const sock = criarSock()
    const jogos = require('../dados/jogos-ativos'); jogos.limparJogos()
    const enquete = require('../comandos/admin/enquete-admin')[0]
    await enquete.executar(sock, GRUPO, mensagem(ADMIN, BOT_LID), '/enquete-admin-ban @bot | sim | não')
    afirmarRespostaProtecao(texto(sock))
    assert.equal(jogos.obterJogo(GRUPO), null)
    assert.equal(sock.remocoes.length, 0); assert.equal(blacklist.length, 0)
  })
  await teste('Roleta russa preserva membros protegidos e remove somente o comum', async () => {
    const sock = protecao.protegerRemocoes(criarSock())
    await require('../comandos/menu-brincadeiras/roletarussa').executar(sock, GRUPO, mensagem(ADMIN), '/roletarussa')
    assert.equal(sock.remocoes.length, 1); assert.deepEqual(sock.remocoes[0].alvos, [COMUM])
  })
  // Executa listeners extraídos de produção; a barreira do socket é a real.
  function criarListener(sock, evento, blacklistOuConfigs) {
    let handler
    const fonte = fs.readFileSync(require.resolve('../bot'), 'utf8')
    const inicio = fonte.indexOf(`sock.ev.on('${evento}',`)
    const proximo = evento === 'messages.upsert' ? 'connection.update' : 'messages.upsert'
    const fim = fonte.indexOf(`sock.ev.on('${proximo}'`, inicio)
    assert.ok(inicio >= 0 && fim > inicio)
    sock.ev = { on: (_, fn) => { handler = fn } }
    const contexto = {
      sock, console, path, __dirname: path.dirname(require.resolve('../bot')),
      fs: { existsSync: () => true, readFileSync: () => JSON.stringify(blacklistOuConfigs) },
      OWNER_NUMBERS, ehLid: lid.ehLid, resolverLidParaTelefone: lid.resolverLidParaTelefone,
      welcomeHabilitado: async () => false,
      antiApagadaHabilitada: async () => false,
      moderacaoFigurinhas: { processarLote: async () => new Set() },
      rankingRegistro: { registrarComNumeroReal: async () => {} },
      ehRemetenteEhDono: async () => false,
      configAtiva: (configs, a, b, jid) => configs[a]?.includes(jid) || configs[b]?.includes(jid)
    }
    vm.runInNewContext(fonte.slice(inicio, fim), contexto)
    return handler
  }
  await teste('Anti-blacklist automática filtra o bot e preserva o restante do lote', async () => {
    const sock = protecao.protegerRemocoes(criarSock())
    pares.set('90000', limparNumero(BOT))
    const handler = criarListener(sock, 'group-participants.update', [limparNumero(BOT), limparNumero(COMUM)])
    await handler({ id: GRUPO, action: 'add', participants: [BOT_LID, COMUM] })
    assert.deepEqual(Array.from(sock.remocoes[0].alvos), [COMUM])
  })
  for (const tipo of ['antiPayment', 'antiStatus']) await teste(`${tipo} não remove bot e ainda remove usuário comum`, async () => {
    const sock = protecao.protegerRemocoes(criarSock())
    const handler = criarListener(sock, 'messages.upsert', { [tipo]: [GRUPO] })
    for (const sender of [BOT_LID, COMUM]) {
      const msg = mensagem(sender)
      if (tipo === 'antiPayment') msg.message = { paymentInviteMessage: {} }
      else msg.message.extendedTextMessage.contextInfo.remoteJid = 'status@broadcast'
      await handler({ messages: [msg] })
    }
    assert.equal(sock.remocoes.length, 1); assert.deepEqual(Array.from(sock.remocoes[0].alvos), [COMUM])
  })
  for (const [tipo, sender] of [['comum', COMUM], ['ADM', ADMIN], ['VIP', COMUM]]) await teste(`/sairgrupo bloqueia ${tipo}`, async () => {
    const sock = criarSock(); sock.membros.find(p => p.id === sender).vip = tipo === 'VIP'
    await sair.executar(sock, GRUPO, mensagem(sender), '/sairgrupo')
    await sair.executar(sock, GRUPO, mensagem(sender), '/sairgrupo confirmar')
    assert.match(texto(sock), /Só o dono/); assert.equal(sock.saidas.length, 0)
  })
  await teste('Dono inicia e confirma; despedida precede saída do grupo atual', async () => {
    const sock = criarSock()
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo')
    assert.match(texto(sock), /30 segundos/); assert.equal(sock.saidas.length, 0)
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo confirmar')
    assert.deepEqual(sock.saidas, [GRUPO]); assert.deepEqual(sock.eventos, ['envio', 'envio', 'saida'])
  })
  await teste('Outro grupo não aceita confirmação', async () => {
    const sock = criarSock()
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo')
    await sair.executar(sock, OUTRO, mensagem(DONO, null, false, OUTRO), '/sairgrupo confirmar')
    assert.equal(sock.saidas.length, 0); assert.match(texto(sock), /Não há confirmação válida/)
  })
  await teste('Outro dono e outros participantes não confirmam o pedido', async () => {
    const sock = criarSock()
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo')
    for (const autor of [DONO2, ADMIN, COMUM]) await sair.executar(sock, GRUPO, mensagem(autor), '/sairgrupo confirmar')
    assert.equal(sock.saidas.length, 0)
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo confirmar')
    assert.equal(sock.saidas.length, 1)
  })
  await teste('Confirmação expirada aos 30 segundos é rejeitada', async () => {
    const sock = criarSock(), inicio = clock()
    Date.now = () => inicio
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo')
    Date.now = () => inicio + 30000
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo confirmar')
    assert.equal(sock.saidas.length, 0); assert.match(texto(sock), /Não há confirmação válida/)
  })
  await teste('Reutilização e confirmações concorrentes deixam uma única saída', async () => {
    const sock = criarSock()
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo')
    await Promise.all([1, 2].map(() => sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo confirmar')))
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo confirmar')
    assert.equal(sock.saidas.length, 1)
  })
  await teste('Mesmo dono iniciando por LID pode confirmar por telefone', async () => {
    const sock = criarSock()
    await sair.executar(sock, GRUPO, mensagem(DONO_LID), '/sairgrupo')
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo confirmar')
    assert.equal(sock.saidas.length, 1)
  })
  for (const alias of sair.aliases) await teste(`Alias /${alias}`, async () => {
    const sock = criarSock()
    await sair.executar(sock, GRUPO, mensagem(DONO), `/${alias}`)
    await sair.executar(sock, GRUPO, mensagem(DONO), `/${alias} confirmar`)
    assert.deepEqual(sock.saidas, [GRUPO])
  })
  await teste('Fora de grupo é rejeitado, sem groupLeave', async () => {
    const sock = criarSock()
    await sair.executar(sock, DONO, mensagem(DONO), '/sairgrupo')
    assert.match(texto(sock), /dentro de grupos/); assert.equal(sock.saidas.length, 0)
  })
  await teste('Confirmar sem iniciar ou argumento inválido não sai', async () => {
    const sock = criarSock()
    for (const text of ['/sairgrupo confirmar', '/sairgrupo qualquercoisa']) await sair.executar(sock, GRUPO, mensagem(DONO), text)
    assert.equal(sock.saidas.length, 0)
  })
  await teste('Despedida é aguardada antes de groupLeave', async () => {
    const sock = criarSock()
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo')
    let liberar, envioIniciado
    const iniciado = new Promise(resolve => { envioIniciado = resolve })
    sock.sendMessage = () => { envioIniciado(); return new Promise(resolve => { liberar = resolve }) }
    const confirmando = sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo confirmar')
    await iniciado; assert.equal(sock.saidas.length, 0)
    liberar(); await confirmando; assert.equal(sock.saidas.length, 1)
  })
  await teste('Falha na despedida ainda permite saída confirmada', async () => {
    const sock = criarSock()
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo')
    sock.sendMessage = async () => { throw new Error('envio offline') }
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo confirmar')
    assert.equal(sock.saidas.length, 1)
  })
  await teste('Falha de groupLeave é tratada e confirmação foi consumida', async () => {
    const sock = criarSock(); let chamadas = 0
    sock.groupLeave = async () => { chamadas++; throw new Error('leave offline') }
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo')
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo confirmar')
    assert.match(texto(sock), /Não consegui sair/)
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo confirmar')
    assert.equal(chamadas, 1)
  })
  await teste('Falha do pedido não deixa confirmação invisível pendente', async () => {
    const sock = criarSock(), enviar = sock.sendMessage
    sock.sendMessage = async () => { throw new Error('envio offline') }
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo')
    sock.sendMessage = enviar
    await sair.executar(sock, GRUPO, mensagem(DONO), '/sairgrupo confirmar')
    assert.equal(sock.saidas.length, 0)
  })
  await teste('LID sem prova de dono não autoriza, mesmo com dígitos iguais', async () => {
    const sock = criarSock()
    await sair.executar(sock, GRUPO, mensagem(`${limparNumero(DONO)}@lid`), '/sairgrupo')
    assert.match(texto(sock), /Só o dono/); assert.equal(sock.saidas.length, 0)
  })
  await teste('Socket protegido na inicialização; única saída explícita é sairgrupo', async () => {
    const fonte = fs.readFileSync(require.resolve('../bot'), 'utf8')
    assert.match(fonte, /protecao-bot.*protegerRemocoes\(sock\)/)
    assert.ok(fonte.indexOf('protegerRemocoes(sock)') < fonte.indexOf("sock.ev.on('group-participants.update'"))
    assert.doesNotMatch(fs.readFileSync(require.resolve('../comandos/menu-dono/sairgrupo'), 'utf8'), /process\.exit\(|\.logout\(|\.end\(/)
  })
  console.log(`\n${passou} testes passaram.`)
}
main().catch(err => { console.error(err); process.exitCode = 1 }).finally(() => {
  Date.now = clock; sair.__limparConfirmacoesTeste(); ban.__definirGravacaoBlacklistTeste(null)
})
