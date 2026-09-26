// ============================================================
// 🧪 teste-corvip.js — Testes OFFLINE do /corvip (+ aplicação no /ranking)
// ============================================================
// Tudo roda SEM WhatsApp e SEM MongoDB de verdade:
//   🗄️ collection FAKE de VIPs injetada no vip.js (__definirColecaoTeste),
//      com o contrato mínimo do driver (findOne/updateOne $set+$unset/
//      deleteOne/deleteMany/find $in);
//   💬 sock mockado — só registra o que seria enviado;
//   🗄️ /ranking com um database FAKE (buscarRanking trocado ANTES do require
//      do comando, que faz destructuring);
//   📚 a lib `emoji-regex` (usada na validação) é a REAL do node_modules —
//      ela é offline por natureza, então a validação é a de produção.
// ⚠️ MONGODB_URI é zerada no TOPO (antes de qualquer require do projeto): o
// config.js carrega o .env da raiz e, sem isso, o harness pegaria o Atlas real.
//
// Cobre: definir, listar sugestões, remover/reset, emoji inválido (texto
// comum), múltiplos emojis, emoji misturado com texto, não-VIP recusado
// (inclusive admin/dono), VIP vencido, LID resolvido antes de gravar,
// checagem de VIP quebrada, infra sem banco e a aplicação no /ranking.
// 🗣️ Os avisos de [vip]/[lid] no console são ESPERADOS: dois cenários
// testam de propósito o caminho sem banco (MONGODB_URI vazia).
// Uso: node scripts/teste-corvip.js
// ============================================================

process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''

const path = require('path')
const fs = require('fs')

const vip = require('../vip')
const lid = require('../lid')
const { limparNumero, getDonos } = require('../config')

// ─── 🗄️ Collection FAKE de VIPs (contrato mínimo do driver MongoDB) ───
function criarColecaoFake() {
  const documentos = new Map()
  const clone = (d) => JSON.parse(JSON.stringify(d))
  const casa = (d, filtro) =>
    Object.entries(filtro || {}).every(([campo, valor]) => {
      if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
        if (Array.isArray(valor.$in)) return valor.$in.includes(d[campo])
        if (valor.$lte !== undefined) return d[campo] <= valor.$lte
        if (valor.$gt !== undefined) return d[campo] > valor.$gt
      }
      return d[campo] === valor
    })

  return {
    _mapa: documentos, // acesso direto p/ os testes conferirem o que foi gravado
    async findOne(filtro) {
      for (const d of documentos.values()) if (casa(d, filtro)) return clone(d)
      return null
    },
    async updateOne(filtro, atualizacao, opcoes = {}) {
      for (const [, d] of documentos) {
        if (casa(d, filtro)) {
          if (atualizacao.$set) Object.assign(d, atualizacao.$set)
          if (atualizacao.$unset) for (const campo of Object.keys(atualizacao.$unset)) delete d[campo]
          return { matchedCount: 1 }
        }
      }
      if (opcoes.upsert) {
        const novo = { ...(atualizacao.$setOnInsert || {}), ...(atualizacao.$set || {}) }
        documentos.set(novo.numero, novo)
        return { upsertedCount: 1 }
      }
      return { matchedCount: 0 }
    },
    async deleteOne(filtro) {
      for (const [chave, d] of documentos) {
        if (casa(d, filtro)) { documentos.delete(chave); return { deletedCount: 1 } }
      }
      return { deletedCount: 0 }
    },
    async deleteMany(filtro) {
      let removidos = 0
      const teto = filtro?.expira_em?.$lte
      if (teto !== undefined) {
        for (const [chave, d] of documentos) {
          if (d.expira_em <= teto) { documentos.delete(chave); removidos += 1 }
        }
      }
      return { deletedCount: removidos }
    },
    find(filtro) {
      return {
        sort() { return this },
        async toArray() { return [...documentos.values()].filter((d) => casa(d, filtro)).map(clone) }
      }
    }
  }
}

const colecaoFake = criarColecaoFake()
vip.__definirColecaoTeste(colecaoFake)

// ─── 🗄️ database FAKE — instalado ANTES do require dos comandos ───
const database = require('../database')
let rankingFake = []
database.buscarRanking = async () => rankingFake

const comando = require('../comandos/menu-vip/corvip')
const ranking = require('../comandos/ranking')
const T = comando._test

// ─── 👥 Cenário ───
const JID_GRUPO = '120363000000000000@g.us'
const JID_VIP = '5511900000001@s.whatsapp.net'
const JID_COMUM = '5511900000002@s.whatsapp.net'
const NUM_VIP = limparNumero(JID_VIP)
const NUM_COMUM = limparNumero(JID_COMUM)
const LID_VIP = '999888777@lid'              // VIP que chega como LID
const LID_SEM_METADADOS = '424242424242@lid' // só resolve pelo lid-mapping
const DOIS_DIAS = 2 * vip.DIA_EM_MS
const PARTICIPANTES = [
  { id: JID_VIP },
  { id: JID_COMUM },
  { id: LID_VIP, phoneNumber: JID_VIP } // metadados entregam o número real
]

// ─── 💬 Mocks ───
function criarSock() {
  const enviadas = []
  const sock = {
    enviadas, // 🔎 os helpers do teste leem daqui (textoUnico/legendaImagem)
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
      participant: autor || JID_VIP,
      id: 'MSG' + Math.random().toString(36).slice(2, 8),
      fromMe: false
    },
    message: { conversation: texto }
  }
}

// Aceita tanto o wrapper do criarSock() quanto o próprio sock (enviadas anexado)
const enviadasDe = (alvo) => (Array.isArray(alvo?.enviadas) ? alvo.enviadas : (alvo?.sock?.enviadas || []))
const textosDe = (alvo) =>
  enviadasDe(alvo).filter((e) => typeof e.conteudo?.text === 'string').map((e) => e.conteudo.text)
const textoUnico = (alvo) => textosDe(alvo).join(' | ')
const vips = () => colecaoFake._mapa

// ------------------------------------------------------------
// Execução
// ------------------------------------------------------------
async function main() {
  let reprovadas = 0
  const testar = async (nome, fn) => {
    T._injetarChecarVip(null)
    try {
      await fn()
      console.log(`✅ ${nome}`)
    } catch (err) {
      reprovadas += 1
      console.log(`❌ ${nome}:`, err?.message || err)
    }
  }

  await testar('exports: nome/aliases/executar + registro do loader', async () => {
    if (comando.nome !== 'corvip') throw new Error('nome: ' + comando.nome)
    if (JSON.stringify(comando.aliases) !== JSON.stringify(['corcustom'])) {
      throw new Error('aliases: ' + JSON.stringify(comando.aliases))
    }
    if (typeof comando.executar !== 'function') throw new Error('sem executar')
    if (!comando.descricao) throw new Error('sem descricao')

    const registro = new Map()
    registro.set(comando.nome, comando)
    for (const apelido of comando.aliases) registro.set(apelido, comando)
    if (registro.get('corcustom') !== comando) throw new Error('/corcustom não aponta para o comando')
  })

  await testar('menu-vip e changelog anunciam o /corvip', async () => {
    const caminhoMenu = path.join(__dirname, '..', 'comandos', 'menu-vip', 'menu-vip.js')
    const menu = fs.readFileSync(caminhoMenu, 'utf8')
    if (!/\/corvip/.test(menu)) throw new Error('o /menu-vip não cita o /corvip')
    if (!/\/corcustom/.test(menu)) throw new Error('o /menu-vip não cita o alias /corcustom')

    const changelog = require('../dados/changelog')
    // A entrada precisa EXISTIR; o topo é de outro lançamento mais novo
    // (sempre que um comando novo entra, como /temavip) — mesma regra do
    // /assinatura e do /nomecustom.
    if (!changelog.some((entrada) => /\/corvip/.test(entrada.titulo))) {
      throw new Error('o changelog não tem entrada para o /corvip')
    }
  })

  await testar('validação: UM emoji válido passa (inclusive sequência ZWJ/bandeira)', async () => {
    const simples = await vip.validarCorVip('🔥')
    if (!simples.ok || simples.emoji !== '🔥') throw new Error('emoji simples recusado: ' + JSON.stringify(simples))

    // Sequências compostas contam como 1 (senão seriam 3 e 2 pontos)
    const zwj = await vip.validarCorVip('🧑‍🚀')
    if (!zwj.ok || zwj.emoji !== '🧑‍🚀') throw new Error('emoji com ZWJ recusado: ' + JSON.stringify(zwj))
    if (!(await vip.validarCorVip('🇧🇷')).ok) throw new Error('bandeira recusada')

    // Espaços em volta não contam como texto misturado
    if (!(await vip.validarCorVip('  👑  ')).ok) throw new Error('emoji com espaços ao redor foi recusado')
  })

  await testar('validação: texto comum, vários emojis e mistura são recusados', async () => {
    const texto = await vip.validarCorVip('Fulano')
    if (texto.ok || texto.motivo !== 'sem-emoji') throw new Error('texto deveria dar sem-emoji: ' + JSON.stringify(texto))

    const dois = await vip.validarCorVip('🔥💎')
    if (dois.ok || dois.motivo !== 'varios' || dois.quantidade !== 2) {
      throw new Error('2 emojis deveriam dar varios: ' + JSON.stringify(dois))
    }
    const tres = await vip.validarCorVip('🔥 💎 👑')
    if (tres.ok || tres.motivo !== 'varios') throw new Error('3 emojis deveriam dar varios: ' + JSON.stringify(tres))

    const mistura = await vip.validarCorVip('🔥 Fulano')
    if (mistura.ok || mistura.motivo !== 'mistura') throw new Error('emoji+texto deveria dar mistura: ' + JSON.stringify(mistura))

    const vazio = await vip.validarCorVip('   ')
    if (vazio.ok || vazio.motivo !== 'vazio') throw new Error('só espaços deveria dar vazio')

    // Sugestões do /corvip lista têm que passar TODAS na validação
    for (const sugestao of vip.SUGESTOES_COR_VIP) {
      if (!(await vip.validarCorVip(sugestao)).ok) throw new Error('sugestão inválida no catálogo: ' + sugestao)
    }
  })

  await testar('definir: grava o corVip no MESMO documento do VIP com o LID resolvido', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, adicionado_em: Date.now(), expira_em: Date.now() + DOIS_DIAS })

    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/corvip 🔥', LID_VIP), '/corvip 🔥')

    const texto = textoUnico(sock)
    if (!/COR DEFINIDA/.test(texto) || !/🔥/.test(texto)) throw new Error('confirmação inesperada: ' + texto)
    if (vips().size !== 1) throw new Error('deveria existir 1 documento só: ' + JSON.stringify([...vips().keys()]))
    if (vips().get(NUM_VIP)?.corVip !== '🔥') {
      throw new Error('não gravou no documento do número real: ' + JSON.stringify(vips().get(NUM_VIP)))
    }
    if ((await vip.obterCorVip(NUM_VIP)) !== '🔥') throw new Error('obterCorVip deveria devolver o emoji')

    // 🪪 LID que NÃO está nos metadados → resolve pelo lid-mapping
    lid.__definirConsultaSessaoTeste(async (l) => (l === limparNumero(LID_SEM_METADADOS) ? NUM_VIP : null))
    try {
      const { sock: sock2 } = criarSock()
      await comando.executar(sock2, JID_GRUPO, mensagem('/corvip 💎', LID_SEM_METADADOS), '/corvip 💎')
      if (vips().get(NUM_VIP)?.corVip !== '💎') {
        throw new Error('LID não resolvido pelo mapeamento: ' + JSON.stringify(vips().get(NUM_VIP)))
      }
      if (vips().size !== 1) throw new Error('criou documento extra: ' + JSON.stringify([...vips().keys()]))
    } finally {
      lid.__definirConsultaSessaoTeste(null)
    }
  })

  await testar('lista: mostra as sugestões e a cor atual', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS, corVip: '👑' })

    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/corvip lista', JID_VIP), '/corvip lista')
    const texto = textoUnico(sock)
    if (!/CORES DO RECINTO/.test(texto)) throw new Error('título ausente: ' + texto)
    if (!/Sua cor atual: \*👑\*/.test(texto)) throw new Error('cor atual ausente: ' + texto)
    for (const sugestao of vip.SUGESTOES_COR_VIP) {
      if (!texto.includes(sugestao)) throw new Error('sugestão ausente na lista: ' + sugestao)
    }

    // Sem cor definida → convite, sem "cor atual"
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    const { sock: sock2 } = criarSock()
    await comando.executar(sock2, JID_GRUPO, mensagem('/corvip', JID_VIP), '/corvip')
    const texto2 = textoUnico(sock2)
    if (!/ainda não escolheu/i.test(texto2)) throw new Error('convite ausente: ' + texto2)
    if (/Sua cor atual/.test(texto2)) throw new Error('não deveria anunciar cor atual: ' + texto2)
  })

  await testar('remover: apaga o corVip e o VIP continua VIP', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS, corVip: '⚡' })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/corvip remover', JID_VIP), '/corvip remover')

    if (!/Cor removida/i.test(textoUnico(sock))) throw new Error('resposta inesperada: ' + textoUnico(sock))
    const doc = vips().get(NUM_VIP)
    if (!doc) throw new Error('o registro de VIP foi apagado junto (não deveria)')
    if ('corVip' in doc) throw new Error('o campo corVip continuou: ' + JSON.stringify(doc))
    if ((await vip.obterCorVip(NUM_VIP)) !== null) throw new Error('obterCorVip deveria devolver null')
  })

  await testar('reset: sinônimo de remover e resposta neutra sem cor definida', async () => {
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/corvip reset', JID_VIP), '/corvip reset')
    if (!/não tinha cor/i.test(textoUnico(sock))) throw new Error('resposta inesperada: ' + textoUnico(sock))
    if (!vips().has(NUM_VIP)) throw new Error('o registro de VIP não deveria sumir')
  })

  await testar('emoji inválido e múltiplos: recusados SEM gravar nada', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })

    const casos = [
      { pedido: '/corvip Fulano', motivo: 'texto comum' },
      { pedido: '/corvip 🔥💎', motivo: 'dois emojis' },
      { pedido: '/corvip 🔥 Fulano', motivo: 'emoji + texto' }
    ]
    for (const caso of casos) {
      const { sock } = criarSock()
      await comando.executar(sock, JID_GRUPO, mensagem(caso.pedido, JID_VIP), caso.pedido)
      const texto = textoUnico(sock)
      if (!/UM emoji/i.test(texto)) throw new Error(`${caso.motivo}: aviso inesperado -> ${texto}`)
      if (/COR DEFINIDA/.test(texto)) throw new Error(`${caso.motivo}: não deveria ter definido`)
      if ('corVip' in vips().get(NUM_VIP)) throw new Error(`${caso.motivo}: gravou assim mesmo`)
    }
  })

  await testar('recusa: mortal comum não passa (nada é gravado)', async () => {
    vips().clear()
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/corvip 🔥', JID_COMUM), '/corvip 🔥')
    const texto = textoUnico(sock)
    if (!/exclusivo/i.test(texto) || !/VIP/.test(texto)) throw new Error('deveria recusar o mortal comum: ' + texto)
    if (!/menu-vip/.test(texto)) throw new Error('a recusa deveria apontar o /menu-vip: ' + texto)
    if (vips().size !== 0) throw new Error('nada deveria ter sido gravado: ' + JSON.stringify([...vips().keys()]))
  })

  await testar('recusa: admin do grupo e dono do bot NÃO têm acesso automático', async () => {
    const JID_ADMIN = '5511900000003@s.whatsapp.net'
    PARTICIPANTES.push({ id: JID_ADMIN, admin: 'superadmin' })
    vips().clear()

    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/corvip 🔥', JID_ADMIN), '/corvip 🔥')
    if (!/exclusivo/i.test(textoUnico(sock))) throw new Error('admin do grupo deveria ser recusado: ' + textoUnico(sock))

    const JID_DONO = `${getDonos()[0]}@s.whatsapp.net`
    const { sock: sock2 } = criarSock()
    await comando.executar(sock2, JID_GRUPO, mensagem('/corvip 🔥', JID_DONO), '/corvip 🔥')
    if (!/exclusivo/i.test(textoUnico(sock2))) throw new Error('dono do bot deveria ser recusado: ' + textoUnico(sock2))

    if (vips().size !== 0) throw new Error('nenhuma recusa deveria ter criado registro')
  })

  await testar('temPermissao: só VIP passa e o LID é resolvido', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    const { sock } = criarSock()
    if (!(await T.temPermissao(sock, JID_GRUPO, mensagem('/corvip 🔥', LID_VIP)))) {
      throw new Error('VIP que chega como LID deveria ter permissão')
    }
    if (await T.temPermissao(sock, JID_GRUPO, mensagem('/corvip 🔥', JID_COMUM))) {
      throw new Error('mortal comum não deveria ter permissão')
    }
    const resolucao = await T.resolverRemetente(sock, JID_GRUPO, mensagem('/corvip 🔥', LID_VIP))
    if (resolucao.numeroReal !== NUM_VIP) throw new Error('número real não resolvido: ' + JSON.stringify(resolucao))
  })

  await testar('VIP vencido: tratado como não-VIP e o registro é limpo', async () => {
    vips().clear()
    vips().set(NUM_COMUM, {
      numero: NUM_COMUM,
      adicionado_em: Date.now() - 10 * vip.DIA_EM_MS,
      expira_em: Date.now() - 1000,
      corVip: '👻'
    })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/corvip 👻', JID_COMUM), '/corvip 👻')
    if (!/exclusivo/i.test(textoUnico(sock))) throw new Error('VIP vencido deveria ser recusado: ' + textoUnico(sock))
    if (vips().has(NUM_COMUM)) throw new Error('o registro vencido deveria ter sido apagado')
  })

  await testar('checagem de VIP quebrada: recusa segura (não libera)', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    T._injetarChecarVip(async () => { throw new Error('mongo fora') })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/corvip 🔥', JID_VIP), '/corvip 🔥')
    T._injetarChecarVip(null)

    if (!/exclusivo/i.test(textoUnico(sock))) throw new Error('deveria recusar: ' + textoUnico(sock))
    if ('corVip' in vips().get(NUM_VIP)) throw new Error('gravou mesmo com a checagem quebrada')
  })

  await testar('/ranking: a cor aparece ANTES do nome', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS, corVip: '🔥' })
    rankingFake = [
      { usuario_id: NUM_VIP, nome: 'João do Banco', total: 120 },
      { usuario_id: NUM_COMUM, nome: 'Comum', total: 5 }
    ]

    const { sock } = criarSock()
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking', JID_VIP), '/ranking')
    const texto = textoUnico(sock)
    if (!/\*🔥 João do Banco\*/.test(texto)) throw new Error('cor deveria vir antes do nome: ' + texto)
    if (!/\*120\* mensagens/.test(texto)) throw new Error('total/plural quebrado: ' + texto)
    if (/\*🔥 Comum\*/.test(texto)) throw new Error('cor vazou para quem não é VIP: ' + texto)
  })

  await testar('/ranking: sem cor definida o comportamento atual não muda', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS }) // VIP sem cor
    rankingFake = [{ usuario_id: NUM_VIP, nome: 'SemCor', total: 9 }]

    const { sock } = criarSock()
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking', JID_VIP), '/ranking')
    const texto = textoUnico(sock)
    if (!/\*SemCor\*/.test(texto)) throw new Error('nome deveria seguir o padrão: ' + texto)
    if (/[🔥💎👑🌙⚡🦋🐺👻🌹🍀]\s*SemCor/.test(texto)) throw new Error('apareceu emoji onde não deveria: ' + texto)
  })

  await testar('/ranking: nome custom + cor juntos saem na mesma linha', async () => {
    vips().clear()
    vips().set(NUM_VIP, {
      numero: NUM_VIP,
      expira_em: Date.now() + DOIS_DIAS,
      nomeCustom: 'MeuNomeVip',
      corVip: '👑'
    })
    rankingFake = [{ usuario_id: NUM_VIP, nome: 'NomeDoBanco', total: 7 }]

    const { sock } = criarSock()
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking', JID_VIP), '/ranking')
    const texto = textoUnico(sock)
    if (!/\*👑 MeuNomeVip\*/.test(texto)) throw new Error('cor + nome custom juntos: ' + texto)
    if (/NomeDoBanco/.test(texto)) throw new Error('o nome do banco deveria ter sido substituído')
  })

  await testar('/ranking: cor de VIP vencido NÃO aparece', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() - 1000, corVip: '👻' })
    rankingFake = [{ usuario_id: NUM_VIP, nome: 'Vencido', total: 4 }]

    const { sock } = criarSock()
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking', JID_VIP), '/ranking')
    const texto = textoUnico(sock)
    if (/👻/.test(texto)) throw new Error('cor de VIP vencido vazou: ' + texto)
    if (!/\*Vencido\*/.test(texto)) throw new Error('deveria manter o nome padrão: ' + texto)
  })

  await testar('infra: sem MONGODB_URI e sem collection, recusa na hora (sem travar)', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    vip.__definirColecaoTeste(null) // caminho REAL (e sem URI configurada no topo)
    try {
      const { sock } = criarSock()
      const inicio = Date.now()
      await comando.executar(sock, JID_GRUPO, mensagem('/corvip 🔥', JID_VIP), '/corvip 🔥')
      const decorrido = Date.now() - inicio
      if (decorrido > 2000) throw new Error('demorou demais — a guarda de infra não atuou (' + decorrido + 'ms)')
      if (!/exclusivo/i.test(textoUnico(sock))) throw new Error('deveria recusar sem banco: ' + textoUnico(sock))
    } finally {
      vip.__definirColecaoTeste(colecaoFake)
    }
  })

  await testar('sock quebrado nunca lança', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    let escapou = false
    try {
      await comando.executar(
        { sendMessage: async () => { throw new Error('rede fora') } },
        JID_GRUPO,
        mensagem('/corvip 🔥', JID_VIP),
        '/corvip 🔥'
      )
    } catch (e) { escapou = true }

    if (escapou) throw new Error('o erro escapou do executar')
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
