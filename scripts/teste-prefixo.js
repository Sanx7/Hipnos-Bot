// ============================================================
// 🧪 teste-prefixo.js — Testes OFFLINE do PREFIXO DINÂMICO + /set-prefix
// ============================================================
// Cobre o roteamento de comandos com prefixo CONFIGURÁVEL:
//   ✅ padrão "/" e barra legada; "!" (e qualquer símbolo) funcionando;
//   ✅ texto normal NÃO vira comando (palpite de jogo / IA continuam);
//   ✅ validação: 1 caractere, sem espaço/letra/número, apelidos por nome;
//   ✅ leitura do Mongo + cache (1ª vez lê, depois é memória) + gravação;
//   ✅ tempo real: depois do /set-prefix o roteador JÁ usa o prefixo novo;
//   ✅ /set-prefix: só dono, status, troca, inválidos, reset, banco fora;
//   ✅ menu-dono e changelog anunciam; bot.js lê a config central (sem "/").
// RODA SEM WhatsApp e SEM MongoDB de verdade: collection FAKE injetada no
// prefixo.js (__definirColecaoTeste) + sock mockado — mesmo padrão dos
// testes de VIP/welcome do projeto.
// ⚠️ MONGODB_URI é zerada no TOPO (antes de qualquer require): o config.js
// carrega o .env da raiz e, sem isso, o harness pegaria o Atlas real.
// 🗣️ O aviso de MONGODB_URI ausente no console é ESPERADO (cenário de infra).
// Uso: node scripts/teste-prefixo.js
// ============================================================

process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''

const path = require('path')
const fs = require('fs')

const prefixo = require('../prefixo')
const { getDonos } = require('../config')

// ─── 🗄️ Collection FAKE (contrato mínimo do driver MongoDB) ───
function criarColecaoFake() {
  const documentos = new Map()
  const clone = (d) => (d ? JSON.parse(JSON.stringify(d)) : null)
  return {
    _mapa: documentos,       // acesso direto p/ os testes conferirem
    _falhar: false,          // liga/desliga o "Mongo fora do ar"
    _leituras: 0,            // conta findOne (prova o cache em memória)
    async findOne(filtro) {
      this._leituras += 1
      if (this._falhar) throw new Error('Mongo fora do ar')
      return clone(documentos.get(filtro?._id))
    },
    async updateOne(filtro, atualizacao, opcoes = {}) {
      if (this._falhar) throw new Error('Mongo fora do ar')
      const chave = filtro?._id
      const atual = documentos.get(chave)
      if (atual) {
        Object.assign(atual, atualizacao.$set || {})
        return { matchedCount: 1 }
      }
      if (opcoes?.upsert) {
        documentos.set(chave, { ...(atualizacao.$setOnInsert || {}), ...(atualizacao.$set || {}) })
        return { upsertedCount: 1 }
      }
      return { matchedCount: 0 }
    }
  }
}

const colecaoFake = criarColecaoFake()
prefixo.__definirColecaoTeste(colecaoFake)

const comando = require('../comandos/menu-dono/set-prefix')
const T = comando._test

// ─── 👥 Cenário ───
const JID_GRUPO = '120363000000000000@g.us'
const JID_DONO = `${getDonos()[0]}@s.whatsapp.net`
const JID_MORTAL = '5511900000002@s.whatsapp.net'
const JID_ADMIN = '5511900000003@s.whatsapp.net'
const LID_DONO = '999888777@lid' // dono chegando como LID (PROOF-LID)
const PARTICIPANTES = [
  { id: JID_DONO },
  { id: JID_MORTAL },
  { id: JID_ADMIN, admin: 'admin' }
]

// ─── 💬 Mocks ───
function criarSock() {
  const enviadas = []
  const sock = {
    enviadas,
    groupMetadata: async () => ({ subject: 'Recinto de Teste', participants: PARTICIPANTES }),
    sendMessage: async (jid, conteudo, extra) => {
      enviadas.push({ jid, conteudo, extra })
      return { key: { id: `fake-${enviadas.length}` } }
    }
  }
  return { enviadas, sock }
}

function mensagem(texto, autor) {
  return {
    key: {
      remoteJid: JID_GRUPO,
      participant: autor || JID_DONO,
      id: 'MSG' + Math.random().toString(36).slice(2, 8),
      fromMe: false
    },
    message: { conversation: texto }
  }
}

const textoUnico = (alvo) =>
  (alvo?.enviadas || [])
    .filter((e) => typeof e.conteudo?.text === 'string')
    .map((e) => e.conteudo.text)
    .join(' | ')

const docSalvo = () => colecaoFake._mapa.get('global')

// Deixa o cenário limpo entre os testes (banco vazio + cache zerado).
const resetarEstado = () => {
  colecaoFake._mapa.clear()
  colecaoFake._falhar = false
  colecaoFake._leituras = 0
  prefixo.__limparCacheTeste()
}

// ------------------------------------------------------------
// Execução
// ------------------------------------------------------------
async function main() {
  let reprovadas = 0
  const testar = async (nome, fn) => {
    try {
      await fn()
      console.log(`✅ ${nome}`)
    } catch (err) {
      reprovadas += 1
      console.log(`❌ ${nome}:`, err?.message || err)
    }
  }

  // ── 🧩 MÓDULO CENTRAL (prefixo.js) ──

  await testar('módulo: padrão "/" e barra legada ligada', async () => {
    if (prefixo.PREFIXO_PADRAO !== '/') throw new Error('padrão: ' + prefixo.PREFIXO_PADRAO)
    if (prefixo.ACEITAR_BARRA_LEGADA !== true) throw new Error('a barra legada deveria continuar aceita')
  })

  await testar('validarPrefixo: símbolo passa; vazio/longo/espaço/letra/número não', async () => {
    for (const bom of ['!', '.', '-', '+', '?', '#', '/']) {
      const r = prefixo.validarPrefixo(bom)
      if (!r.ok || r.prefixo !== bom) throw new Error(`deveria aceitar ${bom}: ${JSON.stringify(r)}`)
    }
    const casos = [
      ['', 'vazio'],
      [null, 'vazio'],
      ['!!', 'longo'],
      ['abc', 'longo'],
      ['a b', 'espaco'],
      ['a', 'invalido'],
      ['1', 'invalido']
    ]
    for (const [entrada, motivo] of casos) {
      const r = prefixo.validarPrefixo(entrada)
      if (r.ok) throw new Error(`deveria recusar ${JSON.stringify(entrada)}`)
      if (r.motivo !== motivo) throw new Error(`${JSON.stringify(entrada)}: motivo ${r.motivo} ≠ ${motivo}`)
    }
  })

  await testar('apelidos por nome: exclamacao → !, slash → /, PONTO → .', async () => {
    const esperado = [['exclamacao', '!'], ['exclama', '!'], ['slash', '/'], ['barra', '/'], ['PONTO', '.'], ['interrogacao', '?']]
    for (const [entrada, alvo] of esperado) {
      const r = prefixo.validarPrefixo(entrada)
      if (!r.ok || r.prefixo !== alvo) throw new Error(`${entrada} → ${JSON.stringify(r)} (esperado ${alvo})`)
    }
  })

  await testar('obterPrefixo: sem documento cai no "/" e com documento lê o valor', async () => {
    resetarEstado()
    if ((await prefixo.obterPrefixo()) !== '/') throw new Error('sem documento deveria usar "/"')
    resetarEstado()
    colecaoFake._mapa.set('global', { _id: 'global', prefixo: '!' })
    if ((await prefixo.obterPrefixo()) !== '!') throw new Error('deveria ler "!" do banco')
  })

  await testar('obterPrefixo: documento com prefixo inválido cai no padrão', async () => {
    resetarEstado()
    colecaoFake._mapa.set('global', { _id: 'global', prefixo: 'abc' })
    if ((await prefixo.obterPrefixo()) !== '/') throw new Error('prefixo inválido no banco deveria cair no "/"')
  })

  await testar('cache: só a 1ª leitura vai ao banco (as próximas são memória)', async () => {
    resetarEstado()
    colecaoFake._mapa.set('global', { _id: 'global', prefixo: '?' })
    if ((await prefixo.obterPrefixo()) !== '?') throw new Error('1ª leitura falhou')
    const leiturasAposPrimeira = colecaoFake._leituras
    await prefixo.obterPrefixo()
    await prefixo.obterPrefixo()
    if (colecaoFake._leituras !== leiturasAposPrimeira) {
      throw new Error('o cache não segurou: ' + colecaoFake._leituras + ' leituras')
    }
  })

  await testar('definirPrefixo: grava no Mongo e muda o cache na HORA', async () => {
    resetarEstado()
    const resultado = await prefixo.definirPrefixo('!')
    if (!resultado.ok) throw new Error('deveria gravar: ' + JSON.stringify(resultado))
    if (resultado.prefixo !== '!' || resultado.anterior !== '/') throw new Error('resultado: ' + JSON.stringify(resultado))
    if (docSalvo()?.prefixo !== '!') throw new Error('não gravou no banco: ' + JSON.stringify(docSalvo()))
    if (prefixo.prefixoSincrono() !== '!') throw new Error('o cache não mudou na hora')
    if ((await prefixo.obterPrefixo()) !== '!') throw new Error('a leitura seguinte não reflete o novo')
  })

  await testar('definirPrefixo: mesmo valor devolve inalterado sem regravar', async () => {
    resetarEstado()
    await prefixo.definirPrefixo('!')
    const resultado = await prefixo.definirPrefixo('!')
    if (!resultado.ok || !resultado.inalterado) throw new Error('esperava inalterado: ' + JSON.stringify(resultado))
  })

  await testar('definirPrefixo: banco fora devolve motivo "banco" (sem quebrar)', async () => {
    resetarEstado()
    colecaoFake._falhar = true
    const resultado = await prefixo.definirPrefixo('!')
    colecaoFake._falhar = false
    if (resultado.ok) throw new Error('deveria falhar com o banco fora')
    if (resultado.motivo !== 'banco') throw new Error('motivo: ' + resultado.motivo)
    if (docSalvo()) throw new Error('não deveria ter gravado nada')
  })

  await testar('resolverNomeComando no padrão "/": comando, texto livre e prefixo sozinho', async () => {
    prefixo.__definirPrefixoTeste('/')
    if (prefixo.resolverNomeComando('/perfil') !== 'perfil') throw new Error('/perfil deveria resolver perfil')
    if (prefixo.resolverNomeComando('!perfil') !== null) throw new Error('"!perfil" não é comando no padrão')
    if (prefixo.resolverNomeComando('oi tudo bem') !== null) throw new Error('texto livre não pode virar comando')
    if (prefixo.resolverNomeComando('/') !== '') throw new Error('prefixo sozinho devolve string vazia')
    if (prefixo.ehComando('/menu') !== true || prefixo.ehComando('oi') !== false) throw new Error('ehComando')
  })

  await testar('prefixo "!": "!/perfil" vira perfil e "/perfil" continua (barra legada)', async () => {
    prefixo.__definirPrefixoTeste('!')
    if (prefixo.resolverNomeComando('!perfil') !== 'perfil') throw new Error('!/perfil deveria resolver perfil')
    if (prefixo.resolverNomeComando('/perfil') !== 'perfil') throw new Error('a "/" legada deveria continuar')
    if (prefixo.resolverNomeComando('perfil') !== null) throw new Error('sem prefixo não é comando')
    if (prefixo.removerPrefixo('!renomear Fulano') !== 'renomear Fulano') throw new Error('removerPrefixo com "!"')
    if (prefixo.removerPrefixo('/renomear Fulano') !== 'renomear Fulano') throw new Error('removerPrefixo com a legada')
    if (prefixo.removerPrefixo('texto solto') !== 'texto solto') throw new Error('removerPrefixo sem prefixo')
  })

  // ── 🎛️ COMANDO /set-prefix ──

  await testar('exports do /set-prefix + registro do loader', async () => {
    if (comando.nome !== 'set-prefix') throw new Error('nome: ' + comando.nome)
    for (const apelido of ['prefixo', 'setprefix']) {
      if (!comando.aliases.includes(apelido)) throw new Error('falta alias: ' + apelido)
    }
    if (typeof comando.executar !== 'function') throw new Error('sem executar')
    if (!comando.descricao) throw new Error('sem descricao')
    if (comando.categoria !== 'dono') throw new Error('categoria: ' + comando.categoria)

    // Simula o registro do loader do bot.js (nome + aliases no mesmo Map)
    const registro = new Map()
    registro.set(comando.nome, comando)
    for (const apelido of comando.aliases) registro.set(apelido, comando)
    if (registro.get('set-prefix') !== comando) throw new Error('/set-prefix não aponta para o comando')
    if (registro.get('prefixo') !== comando) throw new Error('/prefixo não aponta para o comando')
  })

  await testar('recusa: mortal e admin de grupo (só dono) — e nada é gravado', async () => {
    resetarEstado()
    for (const [alvo, rotulo] of [[JID_MORTAL, 'mortal'], [JID_ADMIN, 'admin']]) {
      const { sock } = criarSock()
      await comando.executar(sock, JID_GRUPO, mensagem('/set-prefix !', alvo), '/set-prefix !')
      if (!/segredo dos donos/i.test(textoUnico(sock))) throw new Error(`${rotulo} deveria ser recusado: ${textoUnico(sock)}`)
    }
    if (docSalvo()) throw new Error('não deveria ter gravado nada: ' + JSON.stringify(docSalvo()))
  })

  await testar('dono: sem argumento mostra o prefixo atual', async () => {
    resetarEstado()
    prefixo.__definirPrefixoTeste('/')
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/set-prefix', JID_DONO), '/set-prefix')
    const t = textoUnico(sock)
    if (!/PREFIXO DOS COMANDOS/.test(t)) throw new Error('faltou o cabeçalho: ' + t)
    if (!/\*\/set-prefix !\*/.test(t)) throw new Error('faltou a dica de uso: ' + t)
    if (!/reset/.test(t)) throw new Error('faltou a dica do reset: ' + t)
  })

  await testar('dono: troca para "!" na HORA (roteador já aceita "!/perfil")', async () => {
    resetarEstado()
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/set-prefix !', JID_DONO), '/set-prefix !')
    const t = textoUnico(sock)
    if (!/PREFIXO TROCADO/.test(t)) throw new Error('faltou a confirmação: ' + t)
    if (!/\*!\*/.test(t)) throw new Error('faltou o prefixo novo na resposta: ' + t)
    if (docSalvo()?.prefixo !== '!') throw new Error('não gravou no banco: ' + JSON.stringify(docSalvo()))
    // ⚡ tempo real: o roteador já resolve com o prefixo novo
    if (prefixo.resolverNomeComando('!perfil') !== 'perfil') throw new Error('o roteador ainda não usa o "!"')
    if (prefixo.resolverNomeComando('/perfil') !== 'perfil') throw new Error('a "/" legada deveria continuar')
  })

  await testar('dono: pelo NOME do símbolo (exclamacao) também troca', async () => {
    resetarEstado()
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/set-prefix exclamacao', JID_DONO), '/set-prefix exclamacao')
    if (docSalvo()?.prefixo !== '!') throw new Error('apelido não gravou: ' + JSON.stringify(docSalvo()))
    if (!/PREFIXO TROCADO/.test(textoUnico(sock))) throw new Error('faltou a confirmação')
  })

  await testar('dono: prefixo inválido é recusado com explicação (e não grava)', async () => {
    for (const [pedido, esperado] of [['abc', /UM caractere só/i], ['a', /inválido/i], ['1', /inválido/i]]) {
      resetarEstado()
      const { sock } = criarSock()
      await comando.executar(sock, JID_GRUPO, mensagem(`/set-prefix ${pedido}`, JID_DONO), `/set-prefix ${pedido}`)
      const t = textoUnico(sock)
      if (!esperado.test(t)) throw new Error(`"${pedido}" deveria avisar: ${t}`)
      if (docSalvo()) throw new Error(`"${pedido}" não deveria gravar nada`)
      if (prefixo.prefixoSincrono() !== '/') throw new Error('o prefixo não deveria ter mudado')
    }
  })

  await testar('dono: reset volta para "/" (e o padrão volta a valer)', async () => {
    resetarEstado()
    await prefixo.definirPrefixo('!')
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/set-prefix reset', JID_DONO), '/set-prefix reset')
    const t = textoUnico(sock)
    if (!/PREFIXO TROCADO/.test(t)) throw new Error('faltou a confirmação do reset: ' + t)
    if (docSalvo()?.prefixo !== '/') throw new Error('não voltou ao "/": ' + JSON.stringify(docSalvo()))
    if (prefixo.resolverNomeComando('/perfil') !== 'perfil') throw new Error('o "/" deveria voltar a valer')
  })

  await testar('dono chegando como LID resolve pelos metadados (PROOF-LID)', async () => {
    resetarEstado()
    PARTICIPANTES.push({ id: LID_DONO, phoneNumber: JID_DONO })
    try {
      const { sock } = criarSock()
      await comando.executar(sock, JID_GRUPO, mensagem('/set-prefix !', LID_DONO), '/set-prefix !')
      if (!/PREFIXO TROCADO/.test(textoUnico(sock))) throw new Error('o dono LID deveria passar: ' + textoUnico(sock))
    } finally {
      PARTICIPANTES.pop()
    }
  })

  await testar('banco fora: mensagem amigável e o prefixo segue como estava', async () => {
    resetarEstado()
    colecaoFake._falhar = true
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/set-prefix !', JID_DONO), '/set-prefix !')
    colecaoFake._falhar = false
    const t = textoUnico(sock)
    if (!/Não consegui gravar/i.test(t)) throw new Error('deveria avisar da falha: ' + t)
    if (docSalvo()) throw new Error('não deveria ter gravado nada')
  })

  await testar('integração: bot.js lê a config central (e não tem "/" fixo)', async () => {
    const fonteBot = fs.readFileSync(path.join(__dirname, '..', 'bot.js'), 'utf8')
    if (!/require\('\.\/prefixo'\)/.test(fonteBot)) throw new Error('o bot.js não carrega o prefixo.js')
    if (!/prefixoComandos\.resolverNomeComando\(/.test(fonteBot)) throw new Error('o roteador não usa resolverNomeComando')
    if (!/prefixoComandos\.obterPrefixo\(\)/.test(fonteBot)) throw new Error('o roteador não aquece/lê o prefixo')
    if (/text\.startsWith\('\/'\)/.test(fonteBot)) throw new Error('o bot.js ainda tem o "/" fixo no roteador')
    if (/\.slice\(1\)\s*\n\s*\.split\(' '\)\[0\]/.test(fonteBot)) throw new Error('o nome do comando ainda é derivado de slice(1) fixo')

    const fonteRename = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'menu-fig', 'rename.js'), 'utf8')
    if (!/removerPrefixo\(/.test(fonteRename)) throw new Error('o /renomear não usa a config central')
    if (/texto\.slice\(1\)/.test(fonteRename)) throw new Error('o /renomear ainda corta 1 caractere fixo')
  })

  await testar('menu-dono e changelog anunciam o /set-prefix', async () => {
    const menu = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'menu-dono', 'menu-dono.js'), 'utf8')
    if (!/\/set-prefix/.test(menu)) throw new Error('o /menu-dono não cita o /set-prefix')

    const changelog = require('../dados/changelog')
    if (!Array.isArray(changelog) || !changelog.length) throw new Error('changelog vazio')
    if (!changelog.some((entrada) => /\/set-prefix/.test(entrada.titulo))) {
      throw new Error('o changelog não tem entrada para o /set-prefix')
    }
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('💥 erro fatal no harness:', err)
  process.exit(1)
})