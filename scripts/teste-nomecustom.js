// ============================================================
// 🧪 teste-nomecustom.js — Testes OFFLINE do /nomecustom (+ /perfil e /ranking)
// ============================================================
// Tudo roda SEM WhatsApp e SEM MongoDB de verdade:
//   🗄️ collection FAKE de VIPs injetada no vip.js (__definirColecaoTeste),
//      com o contrato mínimo do driver (findOne/updateOne $set+$unset/
//      deleteOne/deleteMany/find $in);
//   💬 sock mockado — só registra o que seria enviado;
//   🗄️ /ranking com um database FAKE (buscarRanking trocado ANTES do require
//      do comando, que faz destructuring) e sem estatísticas de perfil;
//   👤 /perfil rodando de VERDADE (avatar padrão embutido + ffmpeg do projeto).
// ⚠️ MONGODB_URI é zerada no TOPO (antes de qualquer require do projeto): o
// config.js carrega o .env da raiz e, sem isso, o harness pegaria o Atlas real.
//
// Cobre: definir, mostrar o atual, remover/reset, limites de tamanho,
// sanitização (quebra de linha/zero-width), não-VIP recusado (inclusive
// admin/dono), VIP vencido, LID resolvido antes de gravar, checagem de VIP
// quebrada, infra sem banco, e o reflexo do nome no /perfil e no /ranking.
// 🗣️ Os avisos de [vip]/[database] no console são ESPERADOS: dois cenários
// testam de propósito o caminho sem banco (MONGODB_URI vazia).
// Uso: node scripts/teste-nomecustom.js
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
database.buscarEstatisticasUsuario = async () => ({ total: 0, posicao: null, totalUsuarios: 0, nome: null })

const comando = require('../comandos/menu-vip/nomecustom')
const perfil = require('../comandos/perfil')
const ranking = require('../comandos/ranking')
// 🏛️ O /ranking virou pergaminho em imagem; estes testes conferem o TEXTO
// (nome custom no lugar do nome do banco), então forçam o fallback. O
// pergaminho em si tem teste próprio: scripts/teste-ranking.js.
ranking._injetarCapa(async () => { throw new Error('teste de texto: sem pergaminho') })
const T = comando._test

// ─── 👥 Cenário ───
const JID_GRUPO = '120363000000000000@g.us'
const JID_VIP = '5511900000001@s.whatsapp.net'
const JID_COMUM = '5511900000002@s.whatsapp.net'
const NUM_VIP = limparNumero(JID_VIP)
const NUM_COMUM = limparNumero(JID_COMUM)
const LID_VIP = '999888777@lid'                      // VIP que chega como LID
const LID_SEM_METADADOS = '424242424242@lid'          // só resolve pelo lid-mapping
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
    profilePictureUrl: async () => { throw Object.assign(new Error('item-not-found'), { statusCode: 404 }) },
    fetchStatus: async () => ({ list: [] }),
    sendMessage: async (jid, conteudo, extra) => {
      enviadas.push({ jid, conteudo, extra })
      return { key: { id: `fake-${enviadas.length}` } }
    }
  }
  return { enviadas, sock }
}

function mensagem(texto, autor, pushName) {
  return {
    key: {
      remoteJid: JID_GRUPO,
      participant: autor || JID_VIP,
      id: 'MSG' + Math.random().toString(36).slice(2, 8),
      fromMe: false
    },
    pushName,
    message: { conversation: texto }
  }
}

// Aceita tanto o wrapper do criarSock() quanto o próprio sock (enviadas anexado)
const enviadasDe = (alvo) => (Array.isArray(alvo?.enviadas) ? alvo.enviadas : (alvo?.sock?.enviadas || []))
const textosDe = (alvo) =>
  enviadasDe(alvo).filter((e) => typeof e.conteudo?.text === 'string').map((e) => e.conteudo.text)
const textoUnico = (alvo) => textosDe(alvo).join(' | ')
const legendaImagem = (alvo) => enviadasDe(alvo).find((e) => e.conteudo?.image)?.conteudo?.caption || ''
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
    if (comando.nome !== 'nomecustom') throw new Error('nome: ' + comando.nome)
    if (JSON.stringify(comando.aliases) !== JSON.stringify(['nomevip'])) {
      throw new Error('aliases: ' + JSON.stringify(comando.aliases))
    }
    if (typeof comando.executar !== 'function') throw new Error('sem executar')
    if (!comando.descricao) throw new Error('sem descricao')

    // Simula o registro do loader do bot.js (nome + aliases no mesmo Map)
    const registro = new Map()
    registro.set(comando.nome, comando)
    for (const apelido of comando.aliases) registro.set(apelido, comando)
    if (registro.get('nomevip') !== comando) throw new Error('/nomevip não aponta para o comando')
  })

  await testar('menu-vip e changelog anunciam o /nomecustom', async () => {
    const caminhoMenu = path.join(__dirname, '..', 'comandos', 'menu-vip', 'menu-vip.js')
    const menu = fs.readFileSync(caminhoMenu, 'utf8')
    if (!/\/nomecustom/.test(menu)) throw new Error('o /menu-vip não cita o /nomecustom')
    if (!/\/nomevip/.test(menu)) throw new Error('o /menu-vip não cita o alias /nomevip')

    const changelog = require('../dados/changelog')
    if (!Array.isArray(changelog) || !changelog.length) throw new Error('changelog vazio')
    // A entrada do /nomecustom tem que EXISTIR, mas não precisa estar no topo:
    // o changelog é ordenado do mais novo pro mais antigo e hoje quem lidera é
    // o /corvip (lançado depois). O "topo = mais recente" é checado pelo
    // scripts/teste-corvip.js, que é o lançamento atual.
    if (!changelog.some((entrada) => /\/nomecustom/.test(entrada.titulo))) {
      throw new Error('o changelog não tem entrada para o /nomecustom')
    }
  })

  await testar('limites de tamanho (2 a 20 pontos de código)', async () => {
    if (vip.NOME_CUSTOM_MIN !== 2 || vip.NOME_CUSTOM_MAX !== 20) throw new Error('limites esperados: 2 e 20')

    const curto = vip.validarNomeCustom('a')
    if (curto.ok || curto.motivo !== 'curto') throw new Error('1 char deveria dar motivo curto: ' + JSON.stringify(curto))
    const longo = vip.validarNomeCustom('a'.repeat(21))
    if (longo.ok || longo.motivo !== 'longo') throw new Error('21 chars deveria dar motivo longo: ' + JSON.stringify(longo))
    if (!vip.validarNomeCustom('ab').ok) throw new Error('2 chars deveria ser aceito')
    if (!vip.validarNomeCustom('a'.repeat(20)).ok) throw new Error('20 chars deveria ser aceito')

    const vazio = vip.validarNomeCustom('   ')
    if (vazio.ok || vazio.motivo !== 'vazio') throw new Error('só espaços deveria dar motivo vazio')
  })

  await testar('sanitização: sem quebra de linha, sem controles/zero-width, emoji intacto', async () => {
    if (vip.limparNomeCustom('Meu\nNome') !== 'MeuNome') throw new Error('a quebra de linha deveria sair')
    if (vip.limparNomeCustom('  Meu   Nome  ') !== 'Meu Nome') throw new Error('espaços repetidos deveriam virar um só')
    if (vip.limparNomeCustom('ab\u200Bcd\u200E') !== 'abcd') throw new Error('zero-width/bidi deveriam sair')
    if (vip.limparNomeCustom('Oi\u0000\r\u0007') !== 'Oi') throw new Error('caracteres de controle deveriam sair')

    // Emoji composto (com ZWJ) NÃO é picado — e conta pelos seus pontos de
    // código (🧑 + ZWJ + 🚀 = 3), que é o critério do limite de 2-20.
    const emojiComposto = '🧑\u200D🚀'
    const doisEmojis = `${emojiComposto}${emojiComposto}`
    const r = vip.validarNomeCustom(doisEmojis)
    if (!r.ok || r.tamanho !== [...doisEmojis].length) {
      throw new Error('contagem do emoji composto inesperada: ' + JSON.stringify(r))
    }
    if (!r.nome.includes('\u200D')) throw new Error('o ZWJ do emoji não deveria ser removido')
    if (vip.validarNomeCustom('🚀').motivo !== 'curto') throw new Error('1 emoji só deveria dar curto')
    if (!vip.validarNomeCustom('🚀🚀').ok) throw new Error('2 emojis deveria ser aceito')

    if (vip.validarNomeCustom('\u200B\u200B').motivo !== 'vazio') throw new Error('só invisíveis deveria dar vazio')
  })

  await testar('definir: grava no MESMO documento do VIP com o LID resolvido', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, adicionado_em: Date.now(), expira_em: Date.now() + DOIS_DIAS })

    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/nomecustom MeuNomeVip', LID_VIP), '/nomecustom MeuNomeVip')

    const texto = textoUnico(sock)
    if (!/NOME CUSTOM DEFINIDO/.test(texto) || !/MeuNomeVip/.test(texto)) throw new Error('confirmação inesperada: ' + texto)
    if (vips().size !== 1) throw new Error('deveria existir 1 documento só (nada de documento-LID): ' + JSON.stringify([...vips().keys()]))
    if (vips().get(NUM_VIP)?.nomeCustom !== 'MeuNomeVip') {
      throw new Error('não gravou no documento do número real: ' + JSON.stringify(vips().get(NUM_VIP)))
    }

    // 🪪 LID que NÃO está nos metadados do grupo → resolve pelo lid-mapping
    lid.__definirConsultaSessaoTeste(async (l) => (l === limparNumero(LID_SEM_METADADOS) ? NUM_VIP : null))
    try {
      const { sock: sock2 } = criarSock()
      await comando.executar(sock2, JID_GRUPO, mensagem('/nomecustom ViaMapeamento', LID_SEM_METADADOS), '/nomecustom ViaMapeamento')
      if (vips().get(NUM_VIP)?.nomeCustom !== 'ViaMapeamento') {
        throw new Error('LID não resolvido pelo mapeamento da sessão: ' + JSON.stringify(vips().get(NUM_VIP)))
      }
      if (vips().size !== 1) throw new Error('criou documento extra: ' + JSON.stringify([...vips().keys()]))
    } finally {
      lid.__definirConsultaSessaoTeste(null)
    }
  })

  await testar('mostrar o atual: sem argumento devolve o nome gravado', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS, nomeCustom: 'NomeAtual' })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/nomecustom', JID_VIP), '/nomecustom')
    const texto = textoUnico(sock)
    if (!/SEU NOME CUSTOM/.test(texto) || !/NomeAtual/.test(texto)) throw new Error('resposta inesperada: ' + texto)
    if (!/remover/.test(texto)) throw new Error('deveria ensinar como remover: ' + texto)
  })

  await testar('mostrar o atual: sem nome definido mostra o convite', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/nomecustom', JID_VIP), '/nomecustom')
    const texto = textoUnico(sock)
    if (!/ainda não tem nome custom/i.test(texto)) throw new Error('resposta inesperada: ' + texto)
  })

  await testar('remover: apaga o nomeCustom e o VIP continua VIP', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS, nomeCustom: 'SumirAqui' })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/nomecustom remover', JID_VIP), '/nomecustom remover')

    if (!/removido/i.test(textoUnico(sock))) throw new Error('resposta inesperada: ' + textoUnico(sock))
    const doc = vips().get(NUM_VIP)
    if (!doc) throw new Error('o registro de VIP foi apagado junto (não deveria)')
    if ('nomeCustom' in doc) throw new Error('o campo nomeCustom continuou no documento: ' + JSON.stringify(doc))
    if ((await vip.obterNomeCustom(NUM_VIP)) !== null) throw new Error('obterNomeCustom deveria devolver null depois de remover')
  })

  await testar('reset: aceito como sinônimo e, sem nome definido, responde neutro', async () => {
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/nomecustom reset', JID_VIP), '/nomecustom reset')
    if (!/padrão do WhatsApp/i.test(textoUnico(sock))) throw new Error('resposta inesperada: ' + textoUnico(sock))
    if (!vips().has(NUM_VIP)) throw new Error('o registro de VIP não deveria sumir')
  })

  await testar('limites no comando: 1 e 21 chars recusados SEM gravar (20 passa)', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })

    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/nomecustom a', JID_VIP), '/nomecustom a')
    if (!/Nome inválido/i.test(textoUnico(sock))) throw new Error('1 char deveria ser recusado: ' + textoUnico(sock))

    const vinteUm = 'a'.repeat(21)
    const { sock: sock2 } = criarSock()
    await comando.executar(sock2, JID_GRUPO, mensagem(`/nomecustom ${vinteUm}`, JID_VIP), `/nomecustom ${vinteUm}`)
    if (!/Nome inválido/i.test(textoUnico(sock2))) throw new Error('21 chars deveria ser recusado: ' + textoUnico(sock2))

    if ('nomeCustom' in vips().get(NUM_VIP)) throw new Error('nome fora do limite foi gravado no banco')

    const { sock: sock3 } = criarSock()
    const vinte = 'b'.repeat(20)
    await comando.executar(sock3, JID_GRUPO, mensagem(`/nomecustom ${vinte}`, JID_VIP), `/nomecustom ${vinte}`)
    if (vips().get(NUM_VIP).nomeCustom !== vinte) throw new Error('20 chars deveria ter sido aceito')
  })

  await testar('limite no comando: quebra de linha é limpa (não quebra a formatação)', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    const { sock } = criarSock()
    const textoComando = '/nomecustom Quebrado\u200B\nNome'
    await comando.executar(sock, JID_GRUPO, mensagem(textoComando, JID_VIP), textoComando)
    const gravado = vips().get(NUM_VIP).nomeCustom
    // O argumento é remontado por split/join (o \n vira espaço) e o zero-width
    // é removido — o que NÃO pode sobrar é quebra de linha/invisível no nome.
    if (gravado !== 'Quebrado Nome') throw new Error('sanitização no comando falhou: ' + JSON.stringify(gravado))
    if (/[\n\r\u200B\u0000]/.test(gravado)) throw new Error('invisível vazou para o nome gravado: ' + JSON.stringify(gravado))
  })

  await testar('recusa: mortal comum não passa (nada é gravado)', async () => {
    vips().clear()
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/nomecustom Invasor', JID_COMUM), '/nomecustom Invasor')
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
    await comando.executar(sock, JID_GRUPO, mensagem('/nomecustom AdminVip', JID_ADMIN), '/nomecustom AdminVip')
    if (!/exclusivo/i.test(textoUnico(sock))) throw new Error('admin do grupo deveria ser recusado: ' + textoUnico(sock))

    const JID_DONO = `${getDonos()[0]}@s.whatsapp.net`
    const { sock: sock2 } = criarSock()
    await comando.executar(sock2, JID_GRUPO, mensagem('/nomecustom DonoVip', JID_DONO), '/nomecustom DonoVip')
    if (!/exclusivo/i.test(textoUnico(sock2))) throw new Error('dono do bot deveria ser recusado: ' + textoUnico(sock2))

    if (vips().size !== 0) throw new Error('nenhuma recusa deveria ter criado registro')
  })

  await testar('temPermissao/resolverRemetente: só VIP passa e o LID é resolvido', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })

    const { sock } = criarSock()
    if (!(await T.temPermissao(sock, JID_GRUPO, mensagem('/nomecustom', LID_VIP)))) {
      throw new Error('VIP que chega como LID deveria ter permissão')
    }
    if (await T.temPermissao(sock, JID_GRUPO, mensagem('/nomecustom', JID_COMUM))) {
      throw new Error('mortal comum não deveria ter permissão')
    }

    const resolucao = await T.resolverRemetente(sock, JID_GRUPO, mensagem('/nomecustom', LID_VIP))
    if (resolucao.numeroReal !== NUM_VIP) throw new Error('número real não resolvido: ' + JSON.stringify(resolucao))
    if (!resolucao.candidatos.includes(JID_VIP)) throw new Error('candidato com o número real ausente')
  })

  await testar('VIP vencido: tratado como não-VIP e o registro é limpo', async () => {
    vips().clear()
    vips().set(NUM_COMUM, {
      numero: NUM_COMUM,
      adicionado_em: Date.now() - 10 * vip.DIA_EM_MS,
      expira_em: Date.now() - 1000,
      nomeCustom: 'Zumbi'
    })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/nomecustom Zumbi', JID_COMUM), '/nomecustom Zumbi')
    if (!/exclusivo/i.test(textoUnico(sock))) throw new Error('VIP vencido deveria ser recusado: ' + textoUnico(sock))
    if (vips().has(NUM_COMUM)) throw new Error('o registro vencido deveria ter sido apagado do banco')
  })

  await testar('checagem de VIP quebrada: recusa segura (não libera)', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    T._injetarChecarVip(async () => { throw new Error('mongo fora') })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/nomecustom Hacker', JID_VIP), '/nomecustom Hacker')
    T._injetarChecarVip(null)

    if (!/exclusivo/i.test(textoUnico(sock))) throw new Error('deveria recusar com a checagem quebrada: ' + textoUnico(sock))
    if ('nomeCustom' in vips().get(NUM_VIP)) throw new Error('gravou mesmo com a checagem quebrada')
  })

  await testar('/perfil: o card usa o nome custom do VIP', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS, nomeCustom: 'NomeDoCard' })
    const { sock, enviadas } = criarSock()
    await perfil.executar(sock, JID_GRUPO, mensagem('/perfil', JID_VIP, 'PushNameDaPessoa'))
    const legenda = legendaImagem({ enviadas })
    if (!legenda) throw new Error('o /perfil deveria enviar imagem com o card na legenda')
    if (!/\*Nome:\* NomeDoCard/.test(legenda)) throw new Error('nome custom ausente no card')
    if (/PushNameDaPessoa/.test(legenda)) throw new Error('o pushName deveria ter sido substituído pelo nome custom')
  })

  await testar('/perfil: quem não tem nome custom segue com o pushName', async () => {
    const { sock, enviadas } = criarSock()
    await perfil.executar(sock, JID_GRUPO, mensagem('/perfil', JID_COMUM, 'MortalComum'))
    const legenda = legendaImagem({ enviadas })
    if (!/\*Nome:\* MortalComum/.test(legenda)) throw new Error('deveria manter o pushName do usuário')
  })

  await testar('/ranking: o nome custom substitui o nome do banco', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS, nomeCustom: 'NomeDoRanking' })
    rankingFake = [
      { usuario_id: NUM_VIP, nome: 'NomeDoBanco', total: 7 },
      { usuario_id: NUM_COMUM, nome: 'ComumDoBanco', total: 5 }
    ]
    const { sock } = criarSock()
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking', JID_VIP), '/ranking')
    const texto = textoUnico(sock)
    if (!/NomeDoRanking/.test(texto)) throw new Error('nome custom ausente no ranking: ' + texto)
    if (/NomeDoBanco/.test(texto)) throw new Error('o nome do banco deveria ter sido substituído')
    if (!/ComumDoBanco/.test(texto)) throw new Error('quem não tem nome custom deveria manter o nome do banco')
  })

  await testar('/ranking: nome custom de VIP vencido NÃO aparece', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() - 1000, nomeCustom: 'NomeVencido' })
    const { sock } = criarSock()
    await ranking.executar(sock, JID_GRUPO, mensagem('/ranking', JID_VIP), '/ranking')
    const texto = textoUnico(sock)
    if (/NomeVencido/.test(texto)) throw new Error('nome de VIP vencido vazou para o ranking: ' + texto)
    if (!/NomeDoBanco/.test(texto)) throw new Error('deveria cair no nome padrão do banco')
  })

  await testar('infra: sem MONGODB_URI e sem collection, recusa na hora (sem travar)', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    vip.__definirColecaoTeste(null) // caminho REAL (e sem URI configurada no topo)
    try {
      const { sock } = criarSock()
      const inicio = Date.now()
      await comando.executar(sock, JID_GRUPO, mensagem('/nomecustom SemBanco', JID_VIP), '/nomecustom SemBanco')
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
        mensagem('/nomecustom Resiste', JID_VIP),
        '/nomecustom Resiste'
      )
    } catch (e) { escapou = true }

    if (escapou) throw new Error('o erro escapou do executar')
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
