process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const assert = require('node:assert/strict')
const jogos = require('../dados/jogos-ativos')
const livre = require('../comandos/menu-brincadeiras/enquete')[0]
const admin = require('../comandos/admin/enquete-admin')[0]
const eununca = require('../comandos/menu-brincadeiras/eununca')
const { OWNER_NUMBERS } = require('../config')
const lid = require('../lid')
const prefixo = require('../prefixo')
const protocolo = require('./helpers/enquete-nativa-fake')
const GRUPO = '100@g.us', ADM = '5511000000001@s.whatsapp.net', MEMBRO = '5511000000002@s.whatsapp.net'
let passou = 0
const msg = (autor = ADM) => ({ key: { remoteJid: GRUPO, participant: autor }, message: { conversation: '' } })
function ambiente() {
  jogos.limparJogos(); prefixo.__definirPrefixoTeste('/')
  lid.__definirConsultaSessaoTeste(async () => null)
  for (const cmd of [livre, admin]) cmd._injetarAgendador(() => 1, () => {})
  const a = { envios: [], participantes: [{ id: ADM, admin: 'admin' }, { id: '111@lid', phoneNumber: ADM, admin: 'admin' }, { id: MEMBRO }] }
  a.sock = { user: { id: protocolo.BOT },
    groupMetadata: async () => { if (a.falharMetadata) throw new Error('metadata'); return { participants: a.participantes } },
    sendMessage: async (jid, conteudo) => {
      a.envios.push({ jid, ...conteudo })
      if (a.falharEnvio) throw new Error('sendMessage falhou')
      return protocolo.mensagemEnviada(jid, conteudo)
    }
  }
  a.polls = () => a.envios.filter(e => e.poll)
  return a
}
async function teste(nome, fn) { const a = ambiente(); await fn(a); passou++; console.log(`✅ ${nome}`) }
async function main() {
  for (const cmd of [livre, admin]) {
    await teste(`${cmd.nome}: duas opções e um voto nativo`, async a => {
      await cmd.executar(a.sock, GRUPO, msg(), `/${cmd.nome} Melhor? | A | B`)
      assert.deepEqual(a.polls()[0].poll, { name: 'Melhor?', values: ['A', 'B'], selectableCount: 1 })
      const original = cmd._enqueteAtiva(GRUPO).mensagemEnquete
      assert.equal(original.message.pollCreationMessageV3.selectableOptionsCount, 1)
    })
    await teste(`${cmd.nome}: doze opções compatíveis com o protocolo instalado`, async a => {
      const values = Array.from({ length: 12 }, (_, i) => `Opção ${i + 1}`)
      await cmd.executar(a.sock, GRUPO, msg(), `/${cmd.nome} Pergunta? | ${values.join('|')}`)
      assert.deepEqual(a.polls()[0].poll.values, values)
      assert.equal(cmd._enqueteAtiva(GRUPO).mensagemEnquete.message.pollCreationMessageV3.options.length, 12)
    })
    for (const [nome, conteudo] of [
      ['pergunta vazia', '| A | B'], ['uma opção', 'P | A'], ['sem opções', 'P'],
      ['opção vazia', 'P | A | | B'], ['opção vazia final', 'P | A | B |'],
      ['duplicadas', 'P | A | a'], ['excesso de opções', `P | ${Array.from({ length: 13 }, (_, i) => i).join('|')}`],
      ['pergunta longa', `${'P'.repeat(256)} | A | B`], ['opção longa', `P | ${'A'.repeat(101)} | B`]
    ]) {
      await teste(`${cmd.nome}: recusa ${nome} e mostra exemplo`, async a => {
        await cmd.executar(a.sock, GRUPO, msg(), `/${cmd.nome} ${conteudo}`)
        assert.equal(a.polls().length, 0); assert.equal(jogos.obterJogo(GRUPO), null)
        assert.match(a.envios.at(-1).text, /Ex\.:/)
      })
    }
    await teste(`${cmd.nome}: falha do Baileys limpa registro e não simula enquete`, async a => {
      a.falharEnvio = true
      await cmd.executar(a.sock, GRUPO, msg(), `/${cmd.nome} P | A | B`)
      assert.equal(jogos.obterJogo(GRUPO), null)
      assert.match(a.envios.at(-1).text, /sombras/)
    })
    await teste(`${cmd.nome}: prefixo dinâmico e alias preservado`, async a => {
      prefixo.__definirPrefixoTeste('!')
      await cmd.executar(a.sock, GRUPO, msg(), `!${cmd.aliases[0]} P | A | B`)
      assert.equal(a.polls()[0].poll.name, 'P')
    })
    await teste(`${cmd.nome}: texto livre não é voto`, async a => {
      await cmd.executar(a.sock, GRUPO, msg(), `/${cmd.nome} P | A | B`)
      assert.equal(await jogos.processarMensagemLivre(a.sock, GRUPO, msg(MEMBRO), '1'), false)
      assert.equal(cmd.apurar(cmd._enqueteAtiva(GRUPO)).total, 0)
    })
    await teste(`${cmd.nome}: uso incorreto mostra exemplo e status não duplica cartão`, async a => {
      await cmd.executar(a.sock, GRUPO, msg(), `/${cmd.nome} P | A | B`)
      await cmd.executar(a.sock, GRUPO, msg(), `/${cmd.nome} texto sem separador`)
      assert.match(a.envios.at(-1).text, /Ex\.:/)
      await cmd.executar(a.sock, GRUPO, msg(), `/${cmd.nome} status`)
      assert.match(a.envios.at(-1).text, /enquete nativa/i)
      assert.equal(a.polls().length, 1)
    })
  }
  await teste('ADM LID pode abrir; membro que menciona ADM não pode', async a => {
    await admin.executar(a.sock, GRUPO, msg('111@lid'), '/votacao P | A | B'); assert.equal(a.polls().length, 1)
    jogos.limparJogos()
    const membro = msg(MEMBRO); membro.message = { extendedTextMessage: { contextInfo: { mentionedJid: [ADM] } } }
    await admin.executar(a.sock, GRUPO, membro, '/votacao P | A | B'); assert.equal(a.polls().length, 1)
    assert.match(a.envios.at(-1).text, /administradores/)
  })
  await teste('dono que não é ADM mantém acesso mesmo sem metadados', async a => {
    a.falharMetadata = true
    await admin.executar(a.sock, GRUPO, msg(`${OWNER_NUMBERS[0]}@s.whatsapp.net`), '/enquete-admin P | A | B')
    assert.equal(a.polls().length, 1)
  })
  await teste('LID com dígitos de ADM ou dono não burla autorização', async a => {
    for (const numero of [ADM.split('@')[0], OWNER_NUMBERS[0]]) {
      await admin.executar(a.sock, GRUPO, msg(`${numero}@lid`), '/votacao P | A | B')
    }
    assert.equal(a.polls().length, 0)
  })
  await teste('falha de metadados bloqueia ADM não comprovado', async a => {
    a.falharMetadata = true
    await admin.executar(a.sock, GRUPO, msg(), '/enquete-admin P | A | B'); assert.equal(a.polls().length, 0)
  })
  await teste('voto criptografado pode ser trocado e removido; replay ignorado', async a => {
    await livre.executar(a.sock, GRUPO, msg(), '/enquete P | A | B')
    const dados = livre._enqueteAtiva(GRUPO)
    const antigo = protocolo.voto(dados, GRUPO, MEMBRO, [0], { timestamp: 10 })
    for (const update of [antigo, protocolo.voto(dados, GRUPO, MEMBRO, [1], { timestamp: 11 })]) {
      assert.equal(await jogos.processarMensagemLivre(a.sock, GRUPO, update, ''), true)
    }
    assert.equal(await jogos.processarMensagemLivre(a.sock, GRUPO, antigo, ''), false)
    assert.equal(dados.votos.get(0).size, 0); assert.equal(dados.votos.get(1).size, 1)
    await jogos.processarMensagemLivre(a.sock, GRUPO, protocolo.voto(dados, GRUPO, MEMBRO, [], { timestamp: 12 }), '')
    assert.equal(livre.apurar(dados).total, 0)
  })
  await teste('voto adulterado, múltiplo ou de outro cartão não conta', async a => {
    await admin.executar(a.sock, GRUPO, msg(), '/enquete-admin P | A | B')
    const dados = admin._enqueteAtiva(GRUPO)
    const adulterado = protocolo.voto(dados, GRUPO, MEMBRO, [0]); adulterado.message.pollUpdateMessage.vote.encPayload[0] ^= 1
    const outro = protocolo.voto(dados, GRUPO, MEMBRO, [0]); outro.message.pollUpdateMessage.pollCreationMessageKey = { id: 'outro' }
    for (const update of [adulterado, outro, protocolo.voto(dados, GRUPO, MEMBRO, [0, 1])]) {
      assert.equal(await jogos.processarMensagemLivre(a.sock, GRUPO, update, ''), false)
    }
    assert.equal(admin.apurar(dados).total, 0)
  })
  await teste('encerrar-enquete do loader delega decisão sem abrir permissão', async a => {
    await admin.executar(a.sock, GRUPO, msg(), '/enquete-admin P | A | B')
    const encerrar = require('../comandos/menu-brincadeiras/enquete')[1]
    await encerrar.executar(a.sock, GRUPO, msg(MEMBRO)); assert.equal(jogos.tipoAtivo(GRUPO), 'enquete-admin')
    await encerrar.executar(a.sock, GRUPO, msg()); assert.equal(jogos.tipoAtivo(GRUPO), null)
  })
  await teste('eununca preserva payload funcional e aliases', async a => {
    await eununca.executar(a.sock, GRUPO, msg())
    assert.deepEqual(a.polls()[0].poll.values, ['Eu nunca', 'Eu já']); assert.equal(a.polls()[0].poll.selectableCount, 1)
    assert.deepEqual(eununca.aliases, ['nuncaeu'])
  })
  jogos.limparJogos()
  console.log(`\n${passou} testes de enquetes nativas passaram.`)
}
main().catch(erro => { console.error(erro); process.exitCode = 1 })
