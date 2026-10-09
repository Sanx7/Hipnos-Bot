// Offline: Baileys e MongoDB sem conexões; normalização e autorização reais.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const baileys = require('@whiskeysockets/baileys')
let midia, erroDownload, downloads, streamBaixado, atrasoDownload
require.cache[require.resolve('@whiskeysockets/baileys')] = { exports: {
  ...baileys,
  async downloadMediaMessage(msg, tipo) {
    downloads++
    assert.equal(tipo, 'stream')
    assert.ok(msg.message.imageMessage)
    if (erroDownload) throw erroDownload
    if (atrasoDownload) await atrasoDownload.promise
    streamBaixado = Readable.from(midia)
    return streamBaixado
  }
} }
const { OWNER_NUMBERS } = require('../config')
const estado = require('../estado-bot')
const lid = require('../lid')
const prefixo = require('../prefixo')
const { criarSistema } = require('../comunicados')
const dono = '5511999990000'
const outroDono = '5511999990001'
OWNER_NUMBERS.push(dono, outroDono)
const privado = `${dono}@s.whatsapp.net`
const grupo = '100@g.us'
const destinos = ['200@g.us', '300@g.us', '400@g.us']
let passou = 0
function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

function ambiente() {
  downloads = 0; erroDownload = null; atrasoDownload = null; midia = [Buffer.from('imagem-original')]
  lid.__definirConsultaSessaoTeste(async () => null)
  prefixo.__definirPrefixoTeste('/')
  let tempo = 0
  let contador = 0
  const timers = new Map()
  const a = { grupos: destinos.map(id => ({ id })), consultas: 0, pausado: false, intervalos: [], envios: [], falhas: new Map(), maxParalelos: 0, emCurso: 0 }
  a.sistema = criarSistema({
    agora: () => tempo,
    agendar(fn, ms) {
      const id = ++contador
      timers.set(id, { fn, ms })
      if (ms === 5000) {
        a.intervalos.push(ms)
        if (!a.pausado) queueMicrotask(() => { if (timers.has(id)) { timers.delete(id); fn() } })
      }
      return id
    },
    desagendar: id => timers.delete(id)
  })
  a.avancar = ms => { tempo += ms }
  a.expirarTimer = () => { for (const [id, t] of timers) if (t.ms === 60000) { timers.delete(id); t.fn() } }
  a.sock = {
    async groupMetadata() { return { participants: [
      { id: '111@lid', phoneNumber: privado },
      { id: '222@lid', phoneNumber: '5511888880000@s.whatsapp.net', admin: 'admin' }
    ] } },
    async groupFetchAllParticipating() {
      a.consultas++
      if (a.erroGrupos) throw new Error('segredo que não deve aparecer')
      if (a.listaInvalida) return null
      return Object.fromEntries(a.grupos.map((g, i) => [i, g]))
    },
    async sendMessage(jid, conteudo, options) {
      a.envios.push({ jid, ...conteudo, options })
      if (destinos.includes(jid)) {
        a.emCurso++
        a.maxParalelos = Math.max(a.maxParalelos, a.emCurso)
        try {
          if (a.bloqueio) await a.bloqueio.promise
          if (a.falhas.has(jid)) throw a.falhas.get(jid)
        } finally { a.emCurso-- }
      } else if (a.erroResposta) throw new Error('resposta indisponível')
      return { key: { id: 'mock' } }
    }
  }
  a.executar = (texto = '/comunicado Aviso', { jid = privado, sender, citado } = {}) => {
    const msg = {
      key: { remoteJid: jid, ...(jid.endsWith('@g.us') ? { participant: sender || privado } : {}) },
      message: { extendedTextMessage: { text: texto, contextInfo: citado ? { quotedMessage: citado, stanzaId: 'citado', participant: privado } : {} } }
    }
    return a.sistema.executar(a.sock, jid, msg, texto)
  }
  a.disparos = () => a.envios.filter(e => destinos.includes(e.jid))
  a.resposta = () => a.envios.at(-1).text || a.envios.at(-1).caption
  a.confirmar = async (opcoes) => { await a.executar('/comunicado confirmar', opcoes); await a.sistema.aguardarConclusao() }
  return a
}
async function teste(nome, fn) {
  const a = ambiente()
  await fn(a)
  a.expirarTimer()
  passou++
  console.log(`✅ ${nome}`)
}

async function main() {
  await teste('dono prepara no privado sem envio global', async a => {
    await a.executar(); assert.match(a.resposta(), /PRÉVIA/); assert.equal(a.disparos().length, 0)
    assert.match(a.resposta(), /Grupos encontrados: 3/)
  })
  for (const [perfil, sender] of [['administrador', '222@lid'], ['VIP', '5511888880001@s.whatsapp.net'], ['membro comum', '5511888880002@s.whatsapp.net']]) {
    await teste(`${perfil} bloqueado antes de consultar grupos ou mídia`, async a => {
      await a.executar('/comunicado', { jid: grupo, sender, citado: { imageMessage: { caption: 'proibido' } } })
      assert.match(a.resposta(), /Somente o dono/); assert.equal(downloads, 0); assert.equal(a.consultas, 0)
    })
  }
  await teste('dono JID com dispositivo e uso em grupo', async a => {
    await a.executar('/comunicado Aviso', { jid: grupo, sender: `${dono}:4@s.whatsapp.net` })
    assert.match(a.resposta(), /PRÉVIA/)
  })
  await teste('LID de grupo e JID confirmam a mesma identidade', async a => {
    await a.executar('/comunicado Aviso', { jid: grupo, sender: '111@lid' })
    await a.confirmar({ jid: grupo }); assert.equal(a.disparos().length, 3)
  })
  await teste('LID privado resolvido pela sessão', async a => {
    lid.__definirConsultaSessaoTeste(async id => id === '111' ? dono : null)
    await a.executar('/comunicado Aviso', { jid: '111@lid' }); await a.confirmar({ jid: '111@lid' })
    assert.equal(a.disparos().length, 3)
  })
  await teste('LID cru igual ao telefone do dono falha fechado', async a => {
    await a.executar('/comunicado Aviso', { jid: `${dono}@lid` })
    assert.match(a.resposta(), /Somente o dono/); assert.equal(a.consultas, 0)
  })
  await teste('falha de metadados e de resolução não autoriza', async a => {
    a.sock.groupMetadata = async () => { throw new Error('metadata') }
    await a.executar('/comunicado Aviso', { jid: grupo, sender: '111@lid' })
    assert.match(a.resposta(), /Somente o dono/)
  })
  await teste('texto direto preservado e prioritário', async a => {
    const escrito = 'Olá  Olimpo!\nLinha 2  '
    await a.executar(`/comunicado ${escrito}`, { citado: { conversation: 'ignorado' } }); await a.confirmar()
    assert.ok(a.disparos()[0].text.includes(`\n\n${escrito}\n\n`)); assert.ok(!a.disparos()[0].text.includes('ignorado'))
  })
  await teste('resposta a texto simples', async a => {
    await a.executar('/comunicado', { citado: { conversation: 'texto citado' } }); await a.confirmar()
    assert.match(a.disparos()[0].text, /texto citado/)
  })
  await teste('resposta a texto estendido efêmero', async a => {
    await a.executar('/comunicado', { citado: { ephemeralMessage: { message: { extendedTextMessage: { text: 'texto efêmero' } } } } })
    await a.confirmar(); assert.match(a.disparos()[0].text, /texto efêmero/)
  })
  await teste('imagem original e legenda preservadas', async a => {
    await a.executar('/comunicado', { citado: { imageMessage: { caption: 'legenda', mimetype: 'image/png' } } })
    await a.confirmar(); assert.equal(downloads, 1)
    for (const e of a.disparos()) { assert.deepEqual(e.image, Buffer.from('imagem-original')); assert.match(e.caption, /legenda/); assert.equal(e.mimetype, 'image/png') }
  })
  await teste('texto direto ganha da legenda da imagem', async a => {
    await a.executar('/comunicado novo', { citado: { imageMessage: { caption: 'velho' } } }); await a.confirmar()
    assert.match(a.disparos()[0].caption, /novo/); assert.ok(!a.disparos()[0].caption.includes('velho'))
  })
  await teste('imagem sem legenda é aceita', async a => {
    await a.executar('/comunicado', { citado: { imageMessage: {} } }); await a.confirmar(); assert.equal(a.disparos().length, 3)
  })
  await teste('imagem indisponível não cria confirmação', async a => {
    erroDownload = new Error('404 segredo'); await a.executar('/comunicado', { citado: { imageMessage: {} } })
    assert.match(a.resposta(), /Não consegui baixar/); await a.confirmar(); assert.equal(a.disparos().length, 0)
  })
  await teste('limite de imagem declarado impede download', async a => {
    await a.executar('/comunicado', { citado: { imageMessage: { fileLength: 9 * 1024 * 1024 } } })
    assert.equal(downloads, 0); assert.match(a.resposta(), /8 MB/)
  })
  await teste('limite real durante stream e fechamento', async a => {
    midia = [Buffer.alloc(4 * 1024 * 1024), Buffer.alloc(5 * 1024 * 1024)]
    await a.executar('/comunicado', { citado: { imageMessage: {} } })
    assert.match(a.resposta(), /8 MB/); assert.equal(streamBaixado.destroyed, true)
  })
  await teste('imagem vazia recusada', async a => {
    midia = []; await a.executar('/comunicado', { citado: { imageMessage: {} } }); assert.match(a.resposta(), /vazia/)
  })
  await teste('timeout de download libera prévia e fecha stream tardio', async a => {
    atrasoDownload = deferred()
    const agendarOriginal = global.setTimeout
    global.setTimeout = (fn, ms, ...args) => {
      if (ms === 30000) { queueMicrotask(fn); return undefined }
      return agendarOriginal(fn, ms, ...args)
    }
    try {
      await a.executar('/comunicado', { citado: { imageMessage: {} } })
      assert.match(a.resposta(), /download da imagem expirou/)
      atrasoDownload.resolve(); await new Promise(setImmediate)
      assert.equal(streamBaixado.destroyed, true)
      await a.executar('/comunicado Nova prévia'); assert.match(a.resposta(), /PRÉVIA/)
    } finally { global.setTimeout = agendarOriginal; atrasoDownload.resolve() }
  })
  await teste('confirmação válida, serial e relatório correto', async a => {
    await a.executar(); await a.confirmar()
    assert.equal(a.disparos().length, 3); assert.equal(a.maxParalelos, 1)
    assert.deepEqual(a.intervalos, [5000, 5000]); assert.match(a.resposta(), /Enviados: 3\n❌ Falhas: 0\n⏹️ Não enviados: 0/)
  })
  await teste('confirmação expirada mesmo sem callback de timer', async a => {
    await a.executar(); a.avancar(60000); await a.confirmar(); assert.equal(a.disparos().length, 0)
  })
  await teste('expiração automática libera outra prévia', async a => {
    await a.executar(); a.expirarTimer(); await a.executar('/comunicado Outra'); assert.match(a.resposta(), /PRÉVIA/)
  })
  await teste('outro dono não confirma nem cancela a prévia', async a => {
    await a.executar()
    for (const acao of ['confirmar', 'cancelar']) { await a.executar(`/comunicado ${acao}`, { jid: `${outroDono}@s.whatsapp.net` }); assert.match(a.resposta(), /Não há prévia válida/) }
    await a.confirmar(); assert.equal(a.disparos().length, 3)
  })
  await teste('mesmo dono não confirma em outra conversa', async a => {
    await a.executar(); await a.confirmar({ jid: grupo }); assert.equal(a.disparos().length, 0)
    await a.confirmar(); assert.equal(a.disparos().length, 3)
  })
  await teste('cancelamento antes do envio', async a => {
    await a.executar(); await a.executar('/comunicado cancelar'); await a.confirmar(); assert.equal(a.disparos().length, 0)
  })
  await teste('parada de prévia impede confirmação', async a => {
    await a.executar(); await a.executar('/comunicado parar'); await a.confirmar(); assert.equal(a.disparos().length, 0)
  })
  await teste('conteúdo congelado depois da prévia', async a => {
    await a.executar('/comunicado original'); await a.executar('/comunicado modificado'); await a.confirmar()
    assert.match(a.disparos()[0].text, /original/); assert.ok(!a.disparos()[0].text.includes('modificado'))
  })
  await teste('confirmação reutilizada', async a => {
    await a.executar(); await a.confirmar(); await a.confirmar(); assert.equal(a.disparos().length, 3)
  })
  await teste('confirmações concorrentes consomem uma única vez', async a => {
    await a.executar(); await Promise.all([a.executar('/comunicado confirmar'), a.executar('/comunicado confirmar')])
    await a.sistema.aguardarConclusao(); assert.equal(a.disparos().length, 3)
  })
  await teste('bloqueio de preparação simultânea', async a => {
    const d = deferred(); a.sock.groupFetchAllParticipating = () => d.promise
    const preparando = a.executar(); await new Promise(setImmediate)
    await a.executar('/comunicado Outro'); assert.match(a.resposta(), /Já existe/)
    d.resolve({ grupo: { id: destinos[0] } }); await preparando
  })
  await teste('cancelamento durante envio e relatório parcial', async a => {
    a.bloqueio = deferred(); await a.executar(); await a.executar('/comunicado confirmar'); await new Promise(setImmediate)
    assert.equal(a.disparos().length, 1)
    await a.executar('/comunicado parar'); a.bloqueio.resolve(); await a.sistema.aguardarConclusao()
    assert.equal(a.disparos().length, 1); assert.match(a.resposta(), /Enviados: 1\n❌ Falhas: 0\n⏹️ Não enviados: 2/)
  })
  await teste('envio em andamento bloqueia outro comunicado e recupera depois', async a => {
    a.bloqueio = deferred(); await a.executar(); await a.executar('/comunicado confirmar'); await new Promise(setImmediate)
    await a.executar('/comunicado Outro'); assert.match(a.resposta(), /Já existe/)
    a.bloqueio.resolve(); await a.sistema.aguardarConclusao()
    await a.executar('/comunicado Outro'); assert.match(a.resposta(), /PRÉVIA/)
  })
  await teste('parada acorda intervalo sem iniciar próximo envio', async a => {
    a.pausado = true; await a.executar(); await a.executar('/comunicado confirmar'); await new Promise(setImmediate)
    await a.executar('/comunicado parar'); await a.sistema.aguardarConclusao(); assert.equal(a.disparos().length, 1)
  })
  await teste('não-dono não para envio em curso', async a => {
    a.bloqueio = deferred(); await a.executar(); await a.executar('/comunicado confirmar'); await new Promise(setImmediate)
    await a.executar('/comunicado parar', { jid: grupo, sender: '222@lid' }); a.bloqueio.resolve()
    await a.sistema.aguardarConclusao(); assert.equal(a.disparos().length, 3)
  })
  await teste('outro dono pode parar de outra conversa', async a => {
    a.pausado = true; await a.executar(); await a.executar('/comunicado confirmar'); await new Promise(setImmediate)
    await a.executar('/comunicado parar', { jid: `${outroDono}@s.whatsapp.net` }); await a.sistema.aguardarConclusao()
    assert.equal(a.disparos().length, 1)
  })
  await teste('nenhum sucesso declarado antes de sendMessage terminar', async a => {
    a.bloqueio = deferred(); await a.executar(); await a.executar('/comunicado confirmar'); await new Promise(setImmediate)
    assert.ok(!a.envios.some(e => /RELATÓRIO/.test(e.text || '')))
    a.bloqueio.resolve(); await a.sistema.aguardarConclusao(); assert.match(a.resposta(), /Enviados: 3/)
  })
  await teste('grupos duplicados e privados filtrados', async a => {
    a.grupos.push({ id: destinos[0] }, { id: '5511@s.whatsapp.net' }, { id: 'status@broadcast' }, null)
    await a.executar(); await a.confirmar(); assert.equal(a.disparos().length, 3)
    assert.ok(a.envios.every(e => e.jid === privado || destinos.includes(e.jid)))
  })
  await teste('erro ao obter grupos', async a => {
    a.erroGrupos = true; await a.executar(); assert.match(a.resposta(), /Não consegui obter/); await a.confirmar(); assert.equal(a.disparos().length, 0)
  })
  await teste('lista indisponível e nenhum grupo', async a => {
    a.listaInvalida = true; await a.executar(); assert.match(a.resposta(), /indisponível/)
    a.listaInvalida = false; a.grupos = []; await a.executar(); assert.match(a.resposta(), /Nenhum grupo/)
  })
  await teste('grupos deixados e novos após prévia', async a => {
    await a.executar(); a.grupos = [{ id: destinos[0] }, { id: '999@g.us' }]; await a.confirmar()
    assert.equal(a.disparos().length, 1); assert.ok(!a.envios.some(e => e.jid === '999@g.us')); assert.match(a.resposta(), /Não enviados: 2/)
  })
  await teste('falha na atualização dos grupos impede disparo', async a => {
    await a.executar(); a.erroGrupos = true; await a.confirmar(); assert.equal(a.disparos().length, 0); assert.match(a.resposta(), /Não enviados: 3/)
  })
  await teste('falha isolada permite próximos envios e sem retry', async a => {
    a.falhas.set(destinos[1], new Error('grupo indisponível')); await a.executar(); await a.confirmar()
    assert.equal(a.disparos().length, 3); assert.match(a.resposta(), /Enviados: 2\n❌ Falhas: 1/)
  })
  for (const erro of [{ output: { statusCode: 429 } }, { statusCode: 403 }, { data: { code: 405 } }, new Error('rate-overlimit'), new Error('Connection Closed')]) {
    await teste(`restrição ${erro.message || JSON.stringify(erro)} interrompe`, async a => {
      a.falhas.set(destinos[0], erro); await a.executar(); await a.confirmar()
      assert.equal(a.disparos().length, 1); assert.match(a.resposta(), /Falhas: 1\n⏹️ Não enviados: 2/)
    })
  }
  await teste('sem menções da mensagem citada', async a => {
    await a.executar('/comunicado', { citado: { extendedTextMessage: { text: '@todos', contextInfo: { mentionedJid: [privado] } } } }); await a.confirmar()
    for (const e of a.disparos()) { assert.equal(e.mentions, undefined); assert.equal(e.contextInfo, undefined); assert.equal(e.options, undefined) }
  })
  await teste('falha na prévia não permite confirmação e recupera sistema', async a => {
    a.erroResposta = true; await a.executar(); a.erroResposta = false; await a.confirmar(); assert.equal(a.disparos().length, 0)
    await a.executar(); assert.match(a.resposta(), /PRÉVIA/)
  })
  await teste('falha no relatório libera operação', async a => {
    await a.executar(); a.erroResposta = true; await a.confirmar(); a.erroResposta = false
    await a.executar(); assert.match(a.resposta(), /PRÉVIA/)
  })
  await teste('prefixo dinâmico e aliases', async a => {
    prefixo.__definirPrefixoTeste('!')
    await a.executar('!broadcast Aviso'); await a.executar('!anunciar confirmar'); await a.sistema.aguardarConclusao()
    assert.equal(a.disparos().length, 3)
    const cmd = require('../comandos/menu-dono/comunicado'); assert.equal(typeof cmd.executar, 'function')
    assert.deepEqual(cmd.aliases, ['avisogeral', 'broadcast', 'anunciar'])
  })
  await teste('conteúdo ausente e excesso de texto recusados', async a => {
    await a.executar('/comunicado'); assert.match(a.resposta(), /Use \/comunicado/)
    await a.executar(`/comunicado ${'a'.repeat(3501)}`); assert.match(a.resposta(), /3500 caracteres/)
  })
  console.log(`\n✅ ${passou} testes de comunicado passaram. Nenhum envio real.`)
}
main().catch(erro => { console.error(erro); process.exitCode = 1 })
