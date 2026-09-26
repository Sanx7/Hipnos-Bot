// ============================================================
// 🧪 teste-temavip.js — Testes OFFLINE do /temavip (+ os cards)
// ============================================================
// RODA SEM WhatsApp e SEM Mongo de verdade:
//   🗄️ collection FAKE de VIPs injetada no vip.js (__definirColecaoTeste);
//   💬 sock mockado — só registra o que seria enviado;
//   🖼️ cards gerados DE VERDADE e conferidos PIXEL A PIXEL (jimp para o
//      card do /perfil; canvas para o card de par do /ship e do /kiss).
// ⚠️ MONGODB_URI é zerada no TOPO (antes de qualquer require do projeto): o
// config.js carrega o .env da raiz e, sem isso, o harness pegaria o Atlas real.
//
// Cobre: listar temas, aplicar tema válido (com LID resolvido), tema
// inválido (lista as opções válidas), mostrar o atual, remover, não-VIP
// recusado (comum/admin/dono), VIP vencido, e o card refletindo as cores
// do tema (fundo/moldura/faixa/texto) — inclusive provando que SEM tema o
// card de par continua com as cores fixas de hoje.
// Uso: node scripts/teste-temavip.js
// ============================================================

process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''

const path = require('path')
const fs = require('fs')

const { Jimp, JimpMime } = require('jimp')
const vip = require('../vip')
const temasVip = require('../temas-vip')
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
      }
      return d[campo] === valor
    })

  return {
    _mapa: documentos,
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
    async deleteMany() { return { deletedCount: 0 } },
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

const comando = require('../comandos/menu-vip/temavip')
const T = comando._test
const perfil = require('../comandos/perfil')
const efeitos = require('../comandos/menu-fig/efeitos-imagem')

// ─── 👥 Cenário ───
const JID_GRUPO = '120363000000000000@g.us'
const JID_VIP = '5511900000001@s.whatsapp.net'
const JID_COMUM = '5511900000002@s.whatsapp.net'
const NUM_VIP = limparNumero(JID_VIP)
const NUM_COMUM = limparNumero(JID_COMUM)
const LID_VIP = '999888777@lid'
const DOIS_DIAS = 2 * vip.DIA_EM_MS
const PARTICIPANTES = [
  { id: JID_VIP },
  { id: JID_COMUM },
  { id: LID_VIP, phoneNumber: JID_VIP }
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
      participant: autor || JID_VIP,
      id: 'MSG' + Math.random().toString(36).slice(2, 8),
      fromMe: false
    },
    message: { conversation: texto }
  }
}

const textoUnico = (alvo) =>
  (Array.isArray(alvo?.enviadas) ? alvo.enviadas : (alvo?.sock?.enviadas || []))
    .filter((e) => typeof e.conteudo?.text === 'string')
    .map((e) => e.conteudo.text)
    .join(' | ')
const vips = () => colecaoFake._mapa

// ─── 🖼️ Helpers de imagem ───
// Pixel em hex "#rrggbb" (o jimp devolve 0xRRGGBBAA).
async function pixelDe(buffer, x, y) {
  const img = await Jimp.read(buffer)
  const cor = img.getPixelColor(x, y)
  return '#' + cor.toString(16).padStart(8, '0').slice(0, 6)
}

// Foto quadrada de cor sólida (buffer PNG) p/ alimentar os cards.
async function fotoSolida(corHex, lado = 300) {
  const cor = temasVip.hexParaJimp(corHex)
  const imagem = new Jimp({ width: lado, height: lado, color: cor })
  return imagem.getBuffer(JimpMime.png)
}

// Conta pixels EXATAMENTE iguais a `corHex` numa região do PNG.
async function contarCor(buffer, regiao, corHex) {
  const img = await Jimp.read(buffer)
  const alvo = parseInt(corHex.replace('#', ''), 16) * 256 + 255
  const [x0, y0, x1, y1] = regiao
  let total = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (img.getPixelColor(x, y) === alvo) total += 1
    }
  }
  return total
}

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
    if (comando.nome !== 'temavip') throw new Error('nome: ' + comando.nome)
    if (JSON.stringify(comando.aliases) !== JSON.stringify(['temacustom'])) {
      throw new Error('aliases: ' + JSON.stringify(comando.aliases))
    }
    if (typeof comando.executar !== 'function') throw new Error('sem executar')
    if (!comando.descricao) throw new Error('sem descricao')
    if (comando.categoria !== 'vip') throw new Error('categoria: ' + comando.categoria)

    const registro = new Map()
    registro.set(comando.nome, comando)
    for (const apelido of comando.aliases) registro.set(apelido, comando)
    if (registro.get('temacustom') !== comando) throw new Error('/temacustom não aponta para o comando')
  })

  await testar('menu-vip e changelog (no topo) anunciam o /temavip', async () => {
    const menu = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'menu-vip', 'menu-vip.js'), 'utf8')
    if (!/\/temavip/.test(menu)) throw new Error('o /menu-vip não cita o /temavip')
    if (!/\/temacustom/.test(menu)) throw new Error('o /menu-vip não cita o alias /temacustom')

    const changelog = require('../dados/changelog')
    if (!/\/temavip/.test(changelog[0].titulo)) {
      throw new Error('a entrada do /temavip deveria estar no TOPO do changelog')
    }
  })

  await testar('catálogo: 5 temas com fundo/texto/destaque válidos', async () => {
    const nomes = temasVip.listarNomes()
    const esperados = ['padrao', 'neon', 'pastel', 'escuro', 'dourado']
    if (JSON.stringify(nomes) !== JSON.stringify(esperados)) {
      throw new Error('temas: ' + JSON.stringify(nomes))
    }
    for (const paleta of temasVip.listarTemas()) {
      for (const campo of ['fundo', 'texto', 'destaque']) {
        if (!/^#[0-9a-f]{6}$/i.test(paleta[campo])) {
          throw new Error(`${paleta.nome}.${campo} inválido: ${paleta[campo]}`)
        }
      }
      if (paleta.destaque.toLowerCase() === '#ffffff') {
        throw new Error(`${paleta.nome}: destaque branco puro quebraria a recoloração do texto`)
      }
    }
    if (temasVip.normalizarNomeTema('  DOURADO ') !== 'dourado') throw new Error('normalização falhou')
    if (temasVip.normalizarNomeTema('padrão') !== 'padrao') throw new Error('acento não removido')
    if (temasVip.obterPaleta('inexistente').nome !== 'padrão') throw new Error('fallback não é o padrão')
    if (!vip.validarTemaVip('Neon').ok) throw new Error('validarTemaVip rejeitou Neon')
    if (vip.validarTemaVip('  ').motivo !== 'vazio') throw new Error('vazio não detectado')
    const ruim = vip.validarTemaVip('chuva')
    if (ruim.ok || ruim.motivo !== 'desconhecido') throw new Error('desconhecido não detectado')
    if (!Array.isArray(ruim.opcoes) || ruim.opcoes.length !== 5) throw new Error('sem as 5 opções')
  })

  await testar('lista: /temavip lista mostra os 5 temas com as 3 cores', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS, temaVip: 'neon' })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/temavip lista', JID_VIP), '/temavip lista')
    const texto = textoUnico(sock)
    for (const nome of temasVip.listarNomes()) {
      if (!texto.includes(nome)) throw new Error(`tema ausente na lista: ${nome}`)
    }
    const neon = temasVip.obterPaleta('neon')
    if (!texto.includes(neon.fundo) || !texto.includes(neon.texto) || !texto.includes(neon.destaque)) {
      throw new Error('as cores do tema não saíram na lista: ' + texto.slice(0, 200))
    }
    if (!/neon[\s\S]{0,40}atual/.test(texto)) throw new Error('o tema ATUAL não foi marcado')
  })

  await testar('aplicar: tema válido grava temaVip no doc (LID resolvido)', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, adicionado_em: Date.now(), expira_em: Date.now() + DOIS_DIAS })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/temavip NEON', LID_VIP), '/temavip NEON')

    const texto = textoUnico(sock)
    if (!/TEMA APLICADO/.test(texto) || !/neon/.test(texto)) throw new Error('confirmação inesperada: ' + texto)
    if (vips().size !== 1) throw new Error('deveria existir 1 documento: ' + JSON.stringify([...vips().keys()]))
    if (vips().get(NUM_VIP)?.temaVip !== 'neon') {
      throw new Error('não gravou no doc do número real: ' + JSON.stringify(vips().get(NUM_VIP)))
    }
    if ((await vip.obterTemaVip(NUM_VIP)) !== 'neon') throw new Error('obterTemaVip não devolveu neon')
  })

  await testar('erro: tema inexistente lista as opções e NÃO grava', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/temavip chuva', JID_VIP), '/temavip chuva')
    const texto = textoUnico(sock)
    if (!/desconhecido/i.test(texto)) throw new Error('aviso inesperado: ' + texto)
    for (const nome of temasVip.listarNomes()) {
      if (!texto.includes(nome)) throw new Error(`opção ausente no aviso: ${nome}`)
    }
    if ('temaVip' in vips().get(NUM_VIP)) throw new Error('gravou tema inválido')
  })

  await testar('mostrar: sem argumento devolve o atual; sem tema, o convite', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS, temaVip: 'pastel' })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/temavip', JID_VIP), '/temavip')
    const texto = textoUnico(sock)
    if (!/SEU TEMA/.test(texto) || !/pastel/.test(texto)) throw new Error('resposta inesperada: ' + texto)
    if (!/remover/.test(texto)) throw new Error('deveria ensinar como remover')

    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    const { sock: sock2 } = criarSock()
    await comando.executar(sock2, JID_GRUPO, mensagem('/temavip', JID_VIP), '/temavip')
    if (!/ainda não escolheu um tema/i.test(textoUnico(sock2))) throw new Error('convite ausente')
  })

  await testar('remover: apaga o tema e o VIP continua VIP', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS, temaVip: 'dourado' })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/temavip remover', JID_VIP), '/temavip remover')
    if (!/removid/i.test(textoUnico(sock))) throw new Error('resposta inesperada: ' + textoUnico(sock))
    const doc = vips().get(NUM_VIP)
    if (!doc) throw new Error('o registro de VIP foi apagado junto (não deveria)')
    if ('temaVip' in doc) throw new Error('o campo temaVip continuou: ' + JSON.stringify(doc))
    if ((await vip.obterTemaVip(NUM_VIP)) !== null) throw new Error('obterTemaVip deveria devolver null')

    const { sock: sock2 } = criarSock()
    await comando.executar(sock2, JID_GRUPO, mensagem('/temavip reset', JID_VIP), '/temavip reset')
    if (!/não tinha tema/i.test(textoUnico(sock2))) throw new Error('segunda remoção: ' + textoUnico(sock2))
  })

  await testar('recusa: mortal comum, admin e dono (só VIP)', async () => {
    const JID_ADMIN = '5511900000003@s.whatsapp.net'
    PARTICIPANTES.push({ id: JID_ADMIN, admin: 'superadmin' })
    try {
      vips().clear()
      const alvos = [[JID_COMUM, 'mortal comum'], [JID_ADMIN, 'admin'], [`${getDonos()[0]}@s.whatsapp.net`, 'dono']]
      for (const [alvo, rotulo] of alvos) {
        const { sock } = criarSock()
        await comando.executar(sock, JID_GRUPO, mensagem('/temavip neon', alvo), '/temavip neon')
        if (!/exclusivo/i.test(textoUnico(sock))) throw new Error(`${rotulo} deveria ser recusado: ${textoUnico(sock)}`)
      }
      if (vips().size !== 0) throw new Error('nada deveria ter sido gravado')
    } finally {
      PARTICIPANTES.pop()
    }
  })

  await testar('VIP vencido: recusado e o registro é limpo', async () => {
    vips().clear()
    vips().set(NUM_COMUM, {
      numero: NUM_COMUM,
      adicionado_em: Date.now() - 10 * vip.DIA_EM_MS,
      expira_em: Date.now() - 1000,
      temaVip: 'neon'
    })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/temavip pastel', JID_COMUM), '/temavip pastel')
    if (!/exclusivo/i.test(textoUnico(sock))) throw new Error('VIP vencido deveria ser recusado')
    if (vips().has(NUM_COMUM)) throw new Error('o registro vencido deveria ter sido apagado')
  })

  await testar('card /perfil: pixels refletem o tema (fundo/moldura/faixa/texto)', async () => {
    const paleta = temasVip.obterPaleta('neon')
    const foto = await fotoSolida('#ff00ff') // magenta: a foto entra ou não?
    const card = await perfil.comporCardPerfil(foto, paleta, 'Fulano')

    const cabecalho = card.subarray(0, 8).toString('hex')
    if (cabecalho !== '89504e470d0a1a0a') throw new Error('não é PNG: ' + cabecalho)

    const fundo = await pixelDe(card, 5, 5)
    if (fundo !== paleta.fundo) throw new Error(`fundo: ${fundo} ≠ ${paleta.fundo}`)

    const moldura = await pixelDe(card, 100, 300) // entre 96..110 (moldura)
    if (moldura !== paleta.destaque) throw new Error(`moldura: ${moldura} ≠ ${paleta.destaque}`)

    const faixa = await pixelDe(card, 700, 700)
    if (faixa !== paleta.destaque) throw new Error(`faixa: ${faixa} ≠ ${paleta.destaque}`)

    const meio = await pixelDe(card, 360, 315) // centro da área da foto
    if (meio !== '#ff00ff') throw new Error(`a foto não entrou no card: ${meio}`)

    const texto = await contarCor(card, [0, perfil.CARD_LADO - perfil.CARD_FAIXA, perfil.CARD_LADO, perfil.CARD_LADO], paleta.texto)
    if (texto < 20) throw new Error(`nome na faixa quase ausente (${texto} px de ${paleta.texto})`)
  })

  await testar('card /perfil: trocar de tema troca as cores (pastel ≠ neon)', async () => {
    const foto = await fotoSolida('#00ff00')
    const pastel = await perfil.comporCardPerfil(foto, temasVip.obterPaleta('pastel'), 'Outra Pessoa')
    const esperado = temasVip.obterPaleta('pastel')
    const fundo = await pixelDe(pastel, 5, 5)
    if (fundo !== esperado.fundo) throw new Error(`fundo pastel: ${fundo} ≠ ${esperado.fundo}`)
    if (fundo === temasVip.obterPaleta('neon').fundo) throw new Error('o card pastel saiu com o fundo do neon')
    const faixa = await pixelDe(pastel, 30, 660)
    if (faixa !== esperado.destaque) throw new Error(`faixa pastel: ${faixa} ≠ ${esperado.destaque}`)
  })

  await testar('card /ship e /kiss: sem paleta seguem as cores de HOJE', async () => {
    const fotoA = await fotoSolida('#3366cc', 200)
    const fotoB = await fotoSolida('#cc3366', 200)

    // Sem paleta (5º arg ausente) → fallback byte a byte do comportamento atual
    const ship = await efeitos.comporPar(fotoA, fotoB, 'ship', 77)
    const fundoShip = await pixelDe(ship, 5, 5)
    if (fundoShip !== '#0b141a') throw new Error(`fundo do /ship mudou: ${fundoShip}`)
    const anelShip = await pixelDe(ship, 230, 100) // topo do círculo A (anel 6px)
    if (anelShip !== '#7c3aed') throw new Error(`anel do /ship mudou: ${anelShip}`)

    const kiss = await efeitos.comporPar(fotoA, fotoB, 'kiss', 50)
    const anelKiss = await pixelDe(kiss, 230, 100)
    if (anelKiss !== '#f43f5e') throw new Error(`anel do /kiss mudou: ${anelKiss}`)
  })

  await testar('card /ship e /kiss: com tema, fundo/anéis vêm da paleta', async () => {
    const fotoA = await fotoSolida('#3366cc', 200)
    const fotoB = await fotoSolida('#cc3366', 200)
    const neon = temasVip.obterPaleta('neon')

    const ship = await efeitos.comporPar(fotoA, fotoB, 'ship', 77, neon)
    const fundo = await pixelDe(ship, 5, 5)
    if (fundo !== neon.fundo) throw new Error(`fundo neon: ${fundo} ≠ ${neon.fundo}`)
    const anel = await pixelDe(ship, 230, 100)
    if (anel !== neon.destaque) throw new Error(`anel neon: ${anel} ≠ ${neon.destaque}`)

    const dourado = temasVip.obterPaleta('dourado')
    const kiss = await efeitos.comporPar(fotoA, fotoB, 'kiss', 50, dourado)
    const anelKiss = await pixelDe(kiss, 230, 100)
    if (anelKiss !== dourado.destaque) throw new Error(`anel dourado: ${anelKiss} ≠ ${dourado.destaque}`)
  })

  await testar('integração: /perfil e os cards de par LEEM o tema do autor', async () => {
    const fontePerfil = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'perfil.js'), 'utf8')
    if (!/obterTemaVip/.test(fontePerfil)) throw new Error('o /perfil não lê o tema VIP')
    if (!/comporCardPerfil/.test(fontePerfil)) throw new Error('o /perfil não compõe o card temático')
    if (!/temas-vip/.test(fontePerfil)) throw new Error('o /perfil não usa o catálogo de paletas')

    const fonteEfeitos = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'menu-fig', 'efeitos-imagem.js'), 'utf8')
    if (!/obterTemaVip/.test(fonteEfeitos)) throw new Error('os cards de par não leem o tema do autor')
    if (!/comporPar\(fotoA\.buffer, fotoB\.buffer, modo, percentual, paleta\)/.test(fonteEfeitos)) {
      throw new Error('a paleta não está sendo passada pro canvas do card')
    }
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('💥 erro fatal no harness:', err)
  process.exit(1)
})


