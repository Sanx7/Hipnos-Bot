// A implementação real roda em processos isolados com identidades fictícias.
// Não lê .env, não acessa rede e não compartilha configurações/cache com o bot.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const FICTICIOS = Array.from({ length: 4 }, (_, i) => `00000000000${i + 1}`)

if (process.argv[2] !== '--cenario-isolado') {
  let falhas = 0
  for (const quantidade of [1, 2, 4]) {
    const r = spawnSync(process.execPath, [__filename, '--cenario-isolado', String(quantidade)], {
      env: { ...process.env, OWNER_NUMBERS: FICTICIOS.slice(0, quantidade).join(','), MONGODB_URI: '', MONGO_URI_RPG: '' },
      encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024
    })
    process.stdout.write(r.stdout || '')
    process.stderr.write(r.stderr || '')
    if (r.error || r.status !== 0) falhas++
  }
  if (falhas) { console.error('FALHA: configuração isolada de donos'); process.exitCode = 1 }
  else console.log('TODOS PASSARAM: configurações independentes com 1, 2 e 4 donos fictícios.')
} else {
  executarCenario().catch(() => { console.error('FALHA inesperada no cenário isolado'); process.exitCode = 1 })
}

async function executarCenario() {
  process.env.MONGODB_URI = ''
  process.env.MONGO_URI_RPG = ''
  const fs = require('node:fs'), path = require('node:path')
  const existe = fs.existsSync, ler = fs.readFileSync
  const envReal = path.resolve(__dirname, '../.env')
  let acessosEnv = 0, tentativasRede = 0, tentativasMongo = 0
  fs.existsSync = p => path.resolve(String(p)) === envReal ? false : existe(p)
  fs.readFileSync = function (p, ...args) {
    if (typeof p !== 'number' && path.resolve(String(p)) === envReal) {
      acessosEnv++; throw Error('ENV_REAL_PROIBIDO')
    }
    return ler.call(this, p, ...args)
  }
  const net = require('node:net'), conectar = net.Socket.prototype.connect
  net.Socket.prototype.connect = function () { tentativasRede++; throw Error('REDE_PROIBIDA') }
  const { MongoClient } = require('mongodb'), conectarMongo = MongoClient.prototype.connect
  MongoClient.prototype.connect = async function () { tentativasMongo++; throw Error('MONGO_REAL_PROIBIDO') }

  const config = require('../config')
  const estado = require('../estado-bot')
  const lid = require('../lid')
  const prefixo = require('../prefixo')
  const setPrefix = require('../comandos/menu-dono/set-prefix')
  const comandosEstado = require('../comandos/menu-dono/on-off')
  const donos = FICTICIOS.slice(0, Number(process.argv[3]))
  const originais = [...config.OWNER_NUMBERS]
  const grupo = '00000000000001@g.us', comum = '0000000000099', novo = '0000000000088'
  const pn = n => `${n}@s.whatsapp.net`, idLid = i => `90000000000${i + 1}@lid`
  let participantes = [], consulta = async () => null, falharMetadata = false
  let escritasPrefixo = 0, escritasEstado = 0, envios = [], passou = 0, falhou = 0
  const sock = {
    async groupMetadata() {
      if (falharMetadata) throw Error('METADADOS_FICTICIOS_INDISPONIVEIS')
      return { participants: participantes }
    },
    async sendMessage(jid, conteudo) { envios.push({ jid, conteudo }); return { key: { id: 'ficticio' } } }
  }
  const colecaoPrefixo = {
    async findOne() { return { _id: 'global', prefixo: '/' } },
    async updateOne() { escritasPrefixo++; return { acknowledged: true, matchedCount: 1 } }
  }
  const colecaoEstado = {
    async findOne() { return { _id: 'global', ligado: false } },
    async updateOne() { escritasEstado++; return { acknowledged: true, matchedCount: 1 } }
  }
  async function teste(nome, fn) {
    config.OWNER_NUMBERS.splice(0, config.OWNER_NUMBERS.length, ...donos)
    participantes = []; consulta = async () => null; falharMetadata = false
    envios = []; escritasPrefixo = 0; escritasEstado = 0
    lid.__definirConsultaSessaoTeste(id => consulta(id))
    prefixo.__definirColecaoTeste(colecaoPrefixo)
    prefixo.__limparCacheTeste()
    estado.__definirColecaoTeste(colecaoEstado)
    try { await fn(); passou++; console.log(`PASSOU [${donos.length} donos]: ${nome}`) }
    catch (_) { falhou++; console.error(`FALHOU [${donos.length} donos]: ${nome}`) }
  }
  async function checar(sender, esperado, jid = grupo) {
    assert.equal(await estado.remetenteEhDono(sock, jid, sender), esperado)
    assert.equal(await setPrefix._test.remetenteEhDono(sock, jid, sender), esperado)
    const numero = await estado.obterNumeroDono(sock, jid, sender)
    assert.equal(Boolean(numero), esperado)
    if (esperado) assert.ok(config.OWNER_NUMBERS.includes(numero))
  }
  async function executarComandos(sender, jid = grupo) {
    const msg = { key: { remoteJid: jid, ...(jid.endsWith('@g.us') ? { participant: sender } : {}) } }
    await setPrefix.executar(sock, jid, msg, '/set-prefix !')
    for (const comando of comandosEstado) await comando.executar(sock, jid, msg)
    assert.equal(envios.length, 3)
  }
  try {
    await teste('configuração usa exclusivamente a lista fictícia fornecida ao processo', async () => {
      assert.deepEqual(originais, donos)
      assert.deepEqual(config.OWNER_NUMBERS, donos); assert.deepEqual(config.getDonos(), donos)
      assert.equal(acessosEnv, 0)
    })
    await teste('cada dono PN é autorizado no grupo, no privado e com device', async () => {
      for (const n of donos) {
        assert.equal(config.ehDonoDoBot([], pn(n)), true)
        await checar(pn(n), true); await checar(pn(n), true, pn(n))
        await checar(`${n}:7@s.whatsapp.net`, true)
      }
    })
    await teste('cada dono LID é autorizado pelo par id=LID e phoneNumber=PN', async () => {
      for (const [i, n] of donos.entries()) {
        participantes = [{ id: idLid(i), phoneNumber: pn(n) }]
        assert.equal(config.ehDonoDoBot(participantes, idLid(i)), true)
        await checar(idLid(i), true)
      }
    })
    await teste('dono LID com id=PN e campo lid separado é reconhecido', async () => {
      participantes = [{ id: pn(donos[0]), lid: idLid(0) }]
      assert.equal(config.ehDonoDoBot(participantes, idLid(0)), true)
      await checar(idLid(0), true)
    })
    await teste('mapeamento fictício de sessão autoriza LID no privado e no grupo', async () => {
      consulta = async id => id === config.limparNumero(idLid(0)) ? donos[0] : null
      await checar(idLid(0), true, idLid(0)); await checar(idLid(0), true)
    })
    await teste('metadados indisponíveis permitem apenas LID comprovado pela sessão', async () => {
      falharMetadata = true; await checar(idLid(0), false)
      consulta = async () => donos[0]; await checar(idLid(0), true)
    })
    await teste('falha na sessão não concede permissão ao LID desconhecido', async () => {
      falharMetadata = true; consulta = async () => { throw Error('SESSAO_FICTICIA_INDISPONIVEL') }
      await checar(idLid(0), false)
    })
    await teste('LID com os mesmos dígitos do PN do dono não é dono', async () => {
      const sender = `${donos[0]}@lid`
      participantes = [{ id: pn(donos[0]), admin: 'superadmin' }]
      assert.equal(config.ehDonoDoBot(participantes, sender), false); await checar(sender, false)
    })
    await teste('LID duplicado bloqueia autorização e comandos até com sessão favorável', async () => {
      participantes = [{ id: idLid(0), phoneNumber: pn(donos[0]) }, { id: idLid(0), phoneNumber: pn(comum) }]
      consulta = async () => donos[0]
      assert.equal(config.ehDonoDoBot(participantes, idLid(0)), false); await checar(idLid(0), false)
      await executarComandos(idLid(0)); assert.equal(escritasPrefixo + escritasEstado, 0)
    })
    await teste('participante com dois PNs conflitantes não recebe autorização por LID', async () => {
      participantes = [{ id: pn(donos[0]), lid: idLid(0), phoneNumber: pn(comum) }]
      consulta = async () => donos[0]
      assert.equal(config.ehDonoDoBot(participantes, idLid(0)), false); await checar(idLid(0), false)
    })
    await teste('identidades ausentes e domínios inválidos são recusados', async () => {
      for (const sender of ['', null, `${donos[0]}@g.us`, `${donos[0]}@dominio-invalido`]) {
        assert.equal(config.ehDonoDoBot([], sender), false); await checar(sender, false)
      }
    })
    await teste('usuário comum PN e LID comprovado não é dono', async () => {
      participantes = [{ id: idLid(0), phoneNumber: pn(comum) }]
      assert.equal(config.ehDonoDoBot(participantes, idLid(0)), false)
      await checar(pn(comum), false); await checar(idLid(0), false)
    })
    await teste('concessão e revogação fictícias valem para PN e LID já resolvido em cache', async () => {
      consulta = async () => novo
      await checar(pn(novo), false); await checar(idLid(0), false, idLid(0))
      config.OWNER_NUMBERS.push(novo)
      assert.equal(config.ehDonoDoBot([], pn(novo)), true)
      await checar(pn(novo), true); await checar(idLid(0), true, idLid(0))
      config.OWNER_NUMBERS.splice(config.OWNER_NUMBERS.indexOf(novo), 1)
      assert.deepEqual(config.getDonos(), donos)
      assert.equal(config.ehDonoDoBot([], pn(novo)), false)
      await checar(pn(novo), false); await checar(idLid(0), false, idLid(0))
      await executarComandos(idLid(0), idLid(0)); assert.equal(escritasPrefixo + escritasEstado, 0)
    })
    for (const papel of [null, 'admin', 'superadmin']) {
      for (const namespace of ['PN', 'LID']) {
        await teste(`${papel || 'comum'} ${namespace} não executa set-prefix, on ou off`, async () => {
          participantes = [{ id: idLid(0), phoneNumber: pn(comum), admin: papel }]
          const sender = namespace === 'PN' ? pn(comum) : idLid(0)
          assert.equal(config.ehAdminDoGrupo(participantes, sender), Boolean(papel))
          await executarComandos(sender)
          assert.equal(escritasPrefixo, 0); assert.equal(escritasEstado, 0)
          assert.ok(envios.every(e => /dono/i.test(e.conteudo.text)))
        })
      }
    }
    await teste('usuário comum no privado não executa comandos exclusivos', async () => {
      await executarComandos(pn(comum), pn(comum)); assert.equal(escritasPrefixo + escritasEstado, 0)
    })
    await teste('LID comum comprovado pela sessão no privado não executa comandos exclusivos', async () => {
      consulta = async () => comum
      await executarComandos(idLid(0), idLid(0)); assert.equal(escritasPrefixo + escritasEstado, 0)
    })
    for (const namespace of ['PN', 'LID']) {
      await teste(`controle positivo: dono ${namespace} executa comandos com persistência fictícia`, async () => {
        participantes = [{ id: idLid(0), phoneNumber: pn(donos[0]) }]
        await executarComandos(namespace === 'PN' ? pn(donos[0]) : idLid(0))
        assert.equal(escritasPrefixo, 1); assert.equal(escritasEstado, 2)
      })
    }
    await teste('nenhuma tentativa de rede, MongoDB real ou leitura do .env', async () => {
      assert.equal(tentativasRede, 0); assert.equal(tentativasMongo, 0); assert.equal(acessosEnv, 0)
    })
  } finally {
    config.OWNER_NUMBERS.splice(0, config.OWNER_NUMBERS.length, ...originais)
    lid.__definirConsultaSessaoTeste(null)
    prefixo.__definirColecaoTeste(null); estado.__definirColecaoTeste(null)
    fs.existsSync = existe; fs.readFileSync = ler
    net.Socket.prototype.connect = conectar; MongoClient.prototype.connect = conectarMongo
  }
  console.log(`Resultado [${donos.length} donos]: ${passou} passaram; ${falhou} falharam.`)
  if (falhou) process.exitCode = 1
}
