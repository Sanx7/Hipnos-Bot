// Apenas repositórios em memória e mensagens simuladas; sem serviços reais.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
require('node:net').Socket.prototype.connect = function () { throw Error('REDE_PROIBIDA') }
const fs = require('node:fs'), path = require('node:path')
const existe = fs.existsSync
fs.existsSync = f => path.basename(String(f)) === '.env' ? false : existe(f)
const assert = require('node:assert/strict')
const criarColecao = require('./helpers/colecao-casamento-fake')
const { criarRepositorio, preparar } = require('../dados/casamento-olimpo-mongo')
const sistema = require('../dados/casamento-olimpo')
const midia = require('../func/animacoes-locais')
const arquivos = require('../dados/animacoes-relacionamentos')
const prefixo = require('../prefixo')
const modo = require('../modoadulto')
let adultoLigado = false, falharModo = false
modo.modoAdultoAtivo = async () => { if (falharModo) throw Error('offline'); return adultoLigado }
const comandosAdultos = require('../comandos/menu-adulto/comandos-adulto')
const configuracoes = require('../dados/comandos-adulto')
const A = '5511999990000', B = '5511888880000', C = '5511777770000'
const pn = n => n + '@s.whatsapp.net', G = '123@g.us'
const enviarOriginal = midia.enviarAnimacao
let total = 0, chamadas = []
async function teste(nome, fn) { chamadas = []; await fn(); total++; console.log('OK:', nome) }
async function contexto() {
  const col = criarColecao(); await preparar(col)
  const repo = criarRepositorio(async () => col), servico = sistema.criarServico(repo), envios = []
  const participantes = [A, B, C].map(n => ({ id: pn(n) }))
  const sock = { groupMetadata: async () => ({ participants: participantes }),
    sendMessage: async (jid, payload, opts) => { envios.push({ jid, payload, opts }) } }
  const msg = (autor, alvo, id) => ({ key: { id, remoteJid: G, participant: pn(autor) },
    message: { extendedTextMessage: { contextInfo: { mentionedJid: alvo ? [pn(alvo)] : [] } } } })
  const executar = (acao, autor, alvo, id = acao) => servico.executar(acao, sock, G, msg(autor, alvo, id), '/'+acao)
  const chamar = async (acao, autor = A, alvo, id = acao) => {
    sistema.__definirRepositorioTeste(repo)
    const m = msg(autor, alvo, id)
    await sistema.comando(acao).executar(sock, G, m, '/'+acao)
    return m
  }
  return { col, repo, servico, envios, participantes, sock, msg, executar, chamar }
}
async function estadoInicial(c, acao) {
  if (['casar', 'namorar'].includes(acao)) return
  const namoro = ['aceitarnamoro', 'recusarnamoro', 'terminar'].includes(acao)
  await c.executar(namoro ? 'namorar' : 'casar', A, B, 'pedido')
  if (['terminar', 'divorciar'].includes(acao)) await c.executar(namoro ? 'aceitarnamoro' : 'aceitar', B, null, 'aceite')
}
async function main() {
  prefixo.__definirPrefixoTeste('!')
  midia.enviarAnimacao = async (sock, jid, caminhos, resposta, opts, opcoes) => {
    chamadas.push({ caminhos, resposta, opts, opcoes })
    return sock.sendMessage(jid, resposta, opts)
  }
  for (const acao of Object.keys(arquivos)) {
    await teste(`${acao}: animação somente após confirmação, com mensagem e documentos preservados`, async () => {
      const esperado = await contexto(), atual = await contexto()
      await estadoInicial(esperado, acao); await estadoInicial(atual, acao)
      const autor = ['aceitar', 'recusar', 'aceitarnamoro', 'recusarnamoro'].includes(acao) ? B : A
      const alvo = ['casar', 'namorar'].includes(acao) ? B : null
      const resposta = await esperado.executar(acao, autor, alvo)
      const msg = await atual.chamar(acao, autor, alvo)
      assert.equal(chamadas.length, 1)
      assert.deepEqual(chamadas[0].caminhos, arquivos[acao])
      assert.deepEqual(chamadas[0].resposta, resposta)
      assert.equal(chamadas[0].opts.quoted, msg)
      assert.deepEqual(atual.col.docs, esperado.col.docs)
      assert.equal(atual.envios.length, 1)
    })
  }
  for (const acao of Object.keys(arquivos)) {
    await teste(`${acao}: requisição sem autorização ou estado válido não seleciona mídia`, async () => {
      const c = await contexto()
      await c.chamar(acao, A, ['casar', 'namorar'].includes(acao) ? A : null)
      assert.equal(chamadas.length, 0); assert.equal(c.col.docs.filter(d => d.tipo === 'uniao').length, 0)
      assert.ok(c.envios[0].payload.text); assert.ok(!c.envios[0].payload.video)
    })
  }
  await teste('somente destinatário e grupo correto podem aceitar ou recusar', async () => {
    for (const acao of ['aceitar', 'recusar', 'aceitarnamoro', 'recusarnamoro']) {
      const c = await contexto(); await estadoInicial(c, acao)
      await c.chamar(acao, C)
      assert.equal(chamadas.length, 0); assert.equal(c.col.docs[0].estado, 'pendente')
      sistema.__definirRepositorioTeste(c.repo)
      const msg = c.msg(B, null, 'outro-grupo'); msg.key.remoteJid = '456@g.us'
      await sistema.comando(acao).executar(c.sock, '456@g.us', msg, '/'+acao)
      assert.equal(chamadas.length, 0); assert.equal(c.col.docs[0].estado, 'pendente')
    }
  })
  await teste('replay de decisão e consulta não selecionam animação nem mudam o resultado', async () => {
    const c = await contexto(); await c.executar('casar', A, B, 'pedido')
    await c.chamar('aceitar', B, null, 'decisao')
    const documentos = structuredClone(c.col.docs)
    await c.chamar('aceitar', B, null, 'decisao')
    await c.chamar('casamento', A)
    assert.equal(chamadas.length, 1); assert.deepEqual(c.col.docs, documentos)
    assert.ok(c.envios.at(-1).payload.text)
  })
  await teste('conversão do namoro em casamento mantém o histórico e seleciona as mídias de Hera', async () => {
    const c = await contexto(); await c.executar('namorar', A, B, 'namoro'); await c.executar('aceitarnamoro', B)
    await c.chamar('casar', A, B, 'proposta-casamento'); await c.chamar('aceitar', B, null, 'aceite-casamento')
    assert.deepEqual(chamadas.map(c => c.caminhos), [arquivos.casar, arquivos.aceitar])
    assert.equal(c.col.docs[0].modalidade, 'casamento'); assert.equal(c.col.docs[0].namoroAnterior.estado, 'convertido')
  })
  await teste('metadados e persistência indisponíveis nunca anunciam sucesso com animação', async () => {
    const c = await contexto(); c.sock.groupMetadata = async () => { throw Error('segredo') }
    await c.chamar('casar', A, B); assert.equal(chamadas.length, 0)
    const d = await contexto(); d.col.falhar = true
    await d.chamar('namorar', A, B); assert.equal(chamadas.length, 0)
  })
  await teste('menções LID comprovadas continuam na resposta original da proposta', async () => {
    const c = await contexto(); c.participantes[0] = { id: '111@lid', phoneNumber: pn(A) }
    const msg = c.msg(A, B, 'lid'); msg.key.participant = '111@lid'
    sistema.__definirRepositorioTeste(c.repo)
    await sistema.comando('namorar').executar(c.sock, G, msg, '!namorar')
    assert.deepEqual(chamadas[0].resposta.mentions, ['111@lid', pn(B)])
    assert.match(chamadas[0].resposta.text, /!aceitarnamoro/)
  })
  await teste('falha de envio não desfaz a transição nem repete mensagem', async () => {
    const c = await contexto(); let tentativas = 0
    midia.enviarAnimacao = enviarOriginal
    try {
      c.sock.sendMessage = async () => { tentativas++; throw Error('transporte') }
      await c.chamar('casar', A, B)
      assert.equal(tentativas, 1); assert.equal(c.col.docs[0].estado, 'pendente')
    } finally { midia.enviarAnimacao = async (sock, jid, caminhos, resposta, opts, opcoes) => {
      chamadas.push({ caminhos, resposta, opts, opcoes }); return sock.sendMessage(jid, resposta, opts)
    } }
  })
  await teste('50 comandos adultos preservam nomes, aliases, legendas, menções e arquivos anteriores', async () => {
    adultoLigado = true
    assert.equal(comandosAdultos.length, 50)
    const c = await contexto(), m = c.msg(A, B, 'adulto')
    for (const cfg of configuracoes) {
      const cmd = comandosAdultos.find(cmd => cmd.nome === cfg.nome)
      assert.deepEqual(cmd.aliases, cfg.aliases)
      await cmd.executar(c.sock, G, m)
      const r = chamadas.at(-1)
      assert.deepEqual(r.caminhos, cfg.gifs)
      assert.equal(r.resposta.text, cfg.frase.replace(/\[autor\]|\{autor\}/gi, '@'+A).replace(/\[alvo\]|\{alvo\}/gi, '@'+B))
      assert.deepEqual(r.resposta.mentions, [pn(A), pn(B)])
      assert.equal(r.opcoes.fallbackTexto, false)
      assert.equal(r.opts.quoted, m)
    }
    assert.equal(chamadas.length, 50)
  })
  const casosTextoAdulto = [
    ['sem contexto', null, null],
    ['sem alvo', {}, null],
    ['participant sem reply', { participant: pn(B) }, null],
    ['mencoes invalidas', { mentionedJid: ['', null, 123, 'invalido', G, 'status@broadcast'] }, null],
    ['lista de mencoes malformada', { mentionedJid: pn(B) }, null],
    ['mencao ao proprio autor', { mentionedJid: [pn(A)] }, null],
    ['mencao ao dispositivo do proprio autor', { mentionedJid: [A + ':2@s.whatsapp.net'] }, null],
    ['reply ao proprio autor', { participant: pn(A), quotedMessage: { conversation: 'teste' } }, null],
    ['reply sem participante', { quotedMessage: { conversation: 'teste' } }, null],
    ['reply com participante invalido', { participant: G, quotedMessage: { conversation: 'teste' } }, null],
    ['mencao valida', { mentionedJid: [pn(B)] }, pn(B)],
    ['mencao LID valida', { mentionedJid: ['888@lid'] }, '888@lid'],
    ['mencao valida apos entradas invalidas', { mentionedJid: [null, pn(A), pn(B)] }, pn(B)],
    ['reply a outra pessoa', { participant: pn(B), quotedMessage: { conversation: 'teste' } }, pn(B)],
    ['reply valido apos mencao invalida', { mentionedJid: [G], participant: pn(B), quotedMessage: { conversation: 'teste' } }, pn(B)],
    ['mencao tem prioridade sobre reply', { mentionedJid: [pn(B)], participant: pn(C), quotedMessage: { conversation: 'teste' } }, pn(B)]
  ];
  for (const [nome, info, alvo] of casosTextoAdulto) {
    await teste(`50 comandos adultos: texto e mencoes em ${nome}`, async () => {
      adultoLigado = true
      const c = await contexto(), m = c.msg(A, null, 'texto-adulto')
      m.message = info ? { extendedTextMessage: { contextInfo: info } } : { conversation: '/comando' }
      for (const cfg of configuracoes) {
        await comandosAdultos.find(cmd => cmd.nome === cfg.nome).executar(c.sock, G, m)
        const r = chamadas.at(-1)
        const esperado = alvo ? cfg.frase.replace(/\[autor\]|\{autor\}/gi, '@'+A)
          .replace(/\[alvo\]|\{alvo\}/gi, '@'+alvo.split('@')[0]).trim() : cfg.legenda
        assert.equal(r.resposta.text, esperado, cfg.nome)
        assert.deepEqual(r.resposta.mentions, alvo ? [pn(A), alvo] : undefined)
        assert.deepEqual(r.caminhos, cfg.gifs)
        assert.equal(r.opts.quoted, m)
        assert.equal(r.opcoes.fallbackTexto, false)
      }
      assert.equal(chamadas.length, 50)
    })
  }
  await teste('identificador alternativo do autor nao vira alvo; namespaces PN e LID distintos', async () => {
    const c = await contexto(), cmd = comandosAdultos[0], cfg = configuracoes[0]
    const m = c.msg(A, null, 'autor-alternativo')
    m.key.participant = '777@lid'
    m.key.participantAlt = pn(A)
    m.participant = undefined
    m.message.extendedTextMessage.contextInfo = { mentionedJid: [pn(A)] }
    await cmd.executar(c.sock, G, m)
    assert.equal(chamadas.at(-1).resposta.text, cfg.legenda)
    assert.equal(chamadas.at(-1).resposta.mentions, undefined)
    // Digitos iguais em namespaces diferentes nao comprovam a mesma pessoa.
    m.message.extendedTextMessage.contextInfo.mentionedJid = ['777@s.whatsapp.net']
    await cmd.executar(c.sock, G, m)
    assert.deepEqual(chamadas.at(-1).resposta.mentions, ['777@lid', '777@s.whatsapp.net'])
  })
  await teste('reply em imagem, video e documento usa frase', async () => {
    const c = await contexto(), cmd = comandosAdultos[0], cfg = configuracoes[0]
    for (const tipo of ['imageMessage', 'videoMessage', 'documentMessage']) {
      const m = c.msg(A, null, tipo)
      m.message = { [tipo]: { contextInfo: { participant: pn(B), quotedMessage: { conversation: 'teste' } } } }
      await cmd.executar(c.sock, G, m)
      assert.equal(chamadas.at(-1).resposta.text, cfg.frase.replace(/\{autor\}/g, '@'+A).replace(/\{alvo\}/g, '@'+B))
    }
  })
  await teste('sem alvo e sem legenda nao usa frase como fallback', async () => {
    const c = await contexto(), cfg = configuracoes[0], original = cfg.legenda
    try {
      cfg.legenda = ''
      await comandosAdultos[0].executar(c.sock, G, c.msg(A, null, 'sem-legenda'))
      assert.equal(chamadas.at(-1).resposta.text, undefined)
      assert.equal(chamadas.at(-1).resposta.mentions, undefined)
    } finally { cfg.legenda = original }
  })
  await teste('modo adulto desligado e privado bloqueiam todos os 50 comandos antes da mídia', async () => {
    adultoLigado = false
    const c = await contexto(), m = c.msg(A, B, 'adulto-bloqueado')
    for (const cmd of comandosAdultos) {
      await cmd.executar(c.sock, G, m)
      assert.match(c.envios.at(-1).payload.text, /modo adulto/)
      await cmd.executar(c.sock, pn(A), m)
      assert.match(c.envios.at(-1).payload.text, /dentro de grupos/)
    }
    assert.equal(chamadas.length, 0)
  })
  await teste('erro da consulta ao modo adulto mantém bloqueio e falha de mídia preserva aviso', async () => {
    adultoLigado = true
    const c = await contexto()
    falharModo = true
    try {
      await comandosAdultos[0].executar(c.sock, G, c.msg(A, B))
      assert.equal(chamadas.length, 0); assert.equal(c.envios.length, 1)
      assert.ok(!c.envios[0].payload.video)
    } finally { falharModo = false; c.envios.length = 0 }
    const anterior = midia.enviarAnimacao
    midia.enviarAnimacao = async () => { throw Error('segredo de conversao') }
    try {
      await comandosAdultos.find(c => c.nome === 'esfregar').executar(c.sock, G, c.msg(A, B))
      assert.equal(c.envios.length, 1); assert.match(c.envios[0].payload.text, /Não consegui enviar o gif/)
    } finally { midia.enviarAnimacao = anterior }
  })
  console.log(`${total} testes de integração de animações passaram (offline).`)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => { midia.enviarAnimacao = enviarOriginal })
