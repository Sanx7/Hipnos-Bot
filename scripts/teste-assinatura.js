// ============================================================
// 🧪 teste-assinatura.js — Testes OFFLINE do /assinatura (+ o drawtext)
// ============================================================
// RODA SEM WhatsApp e SEM Mongo de verdade:
//   🗄️ collection FAKE de VIPs injetada no vip.js (__definirColecaoTeste);
//   💬 sock mockado — só registra o que seria enviado;
//   🎬 ffmpeg MOCKADO nos comandos de figurinha (_injetarRodarExecutavel):
//      o teste LÊ os args (-vf) para provar que o drawtext entra quando há
//      assinatura e NÃO entra quando não há;
//   ✅ e UMA passagem com o ffmpeg REAL (o embutido do projeto) para provar
//      que o filtro é válido de verdade e que o texto aparece na imagem.
// ⚠️ MONGODB_URI é zerada no TOPO (antes de qualquer require do projeto): o
// config.js carrega o .env da raiz e, sem isso, o harness pegaria o Atlas real.
//
// Cobre: definir, mostrar, remover/reset, limite de 15 caracteres, emoji
// recusado, não-VIP recusado (comum/admin/dono), VIP vencido, LID resolvido,
// e a aplicação do drawtext no /figurinha e no /s (com e sem assinatura).
// Uso: node scripts/teste-assinatura.js
// ============================================================

process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''

const path = require('path')
const fs = require('fs')
const os = require('os')

const vip = require('../vip')
const lid = require('../lid')
const { limparNumero, getDonos } = require('../config')
const webp = require('../comandos/menu-fig/webp-animado')
const figurinha = require('../comandos/menu-fig/figurinha')
const sticker = require('../comandos/menu-fig/sticker')

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

const comando = require('../comandos/menu-vip/assinatura')
const T = comando._test

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

// ─── 🎬 ffmpeg MOCKADO: registra os args e "produz" o arquivo de saída ───
function espiarFfmpeg(alvos) {
  const chamadas = []
  const mock = async (binario, args) => {
    chamadas.push({ binario, args, filtro: args[args.indexOf('-vf') + 1] })
    const saida = args[args.length - 1]
    if (!fs.existsSync(saida)) fs.writeFileSync(saida, 'webp-falso')
    return { stdout: '', stderr: '' }
  }
  for (const alvo of alvos) alvo._injetarRodarExecutavel(mock)
  return chamadas
}

// ------------------------------------------------------------
// Execução
// ------------------------------------------------------------
async function main() {
  let reprovadas = 0
  const testar = async (nome, fn) => {
    T._injetarChecarVip(null)
    figurinha._injetarRodarExecutavel(null)
    sticker._injetarRodarExecutavel(null)
    try {
      await fn()
      console.log(`✅ ${nome}`)
    } catch (err) {
      reprovadas += 1
      console.log(`❌ ${nome}:`, err?.message || err)
    }
  }

  await testar('exports: nome/aliases/executar + registro do loader', async () => {
    if (comando.nome !== 'assinatura') throw new Error('nome: ' + comando.nome)
    if (JSON.stringify(comando.aliases) !== JSON.stringify(['assinaturavip'])) {
      throw new Error('aliases: ' + JSON.stringify(comando.aliases))
    }
    if (typeof comando.executar !== 'function') throw new Error('sem executar')
    if (!comando.descricao) throw new Error('sem descricao')

    const registro = new Map()
    registro.set(comando.nome, comando)
    for (const apelido of comando.aliases) registro.set(apelido, comando)
    if (registro.get('assinaturavip') !== comando) throw new Error('/assinaturavip não aponta para o comando')
  })

  await testar('menu-vip e changelog anunciam o /assinatura', async () => {
    const menu = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'menu-vip', 'menu-vip.js'), 'utf8')
    if (!/\/assinatura/.test(menu)) throw new Error('o /menu-vip não cita o /assinatura')
    if (!/\/assinaturavip/.test(menu)) throw new Error('o /menu-vip não cita o alias /assinaturavip')

    const changelog = require('../dados/changelog')
    // A entrada precisa EXISTIR; se o topo é de outro lançamento mais novo
    // (o /temavip entrou depois), tudo bem — mesma regra do /corvip e do
    // /nomecustom ("topo = mais recente" é relativo ao lançamento vigente).
    if (!changelog.some((entrada) => /\/assinatura/.test(entrada.titulo))) {
      throw new Error('o changelog não tem entrada para o /assinatura')
    }
  })

  await testar('limite: 15 entra, 16 não; e o saneamento tira quebra/invisível', async () => {
    if (vip.ASSINATURA_MAX !== 15) throw new Error('limite esperado: 15')

    const ok = await vip.validarAssinatura('@joaovip')
    if (!ok.ok || ok.assinatura !== '@joaovip') throw new Error('assinatura simples recusada: ' + JSON.stringify(ok))
    if (!(await vip.validarAssinatura('a'.repeat(15))).ok) throw new Error('15 chars deveria passar')

    const longo = await vip.validarAssinatura('a'.repeat(16))
    if (longo.ok || longo.motivo !== 'longo') throw new Error('16 chars deveria dar longo: ' + JSON.stringify(longo))

    const sujo = await vip.validarAssinatura('  @joao\u200B\nvip  ')
    if (!sujo.ok || sujo.assinatura !== '@joaovip') throw new Error('sanitização falhou: ' + JSON.stringify(sujo))

    const vazio = await vip.validarAssinatura('   ')
    if (vazio.ok || vazio.motivo !== 'vazio') throw new Error('só espaços deveria dar vazio')
  })

  await testar('emoji recusado (não renderiza na fonte do drawtext)', async () => {
    const comEmoji = await vip.validarAssinatura('@joao🔥')
    if (comEmoji.ok || comEmoji.motivo !== 'emoji') throw new Error('emoji deveria ser recusado: ' + JSON.stringify(comEmoji))
    if (!(await vip.validarAssinatura('@joao_vip.1')).ok) throw new Error('texto normal com @ _ . deveria passar')
  })

  await testar('drawtext: entra no filtro COM assinatura e some SEM ela', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'assinatura-filtro-'))
    const entrada = path.join(tmp, 'in.png')
    fs.writeFileSync(entrada, 'x')
    const assinatura = webp.prepararAssinatura('@joaovip', 'teste')
    if (!assinatura) throw new Error('prepararAssinatura devolveu null (fonte do sistema?)')
    // O .txt leva o texto EXATO (é o que o ffmpeg vai ler via textfile=)
    if (fs.readFileSync(assinatura.caminhoTexto, 'utf8') !== '@joaovip') {
      throw new Error('o arquivo da assinatura não tem o texto exato')
    }

    // SEM assinatura: filtro idêntico ao de hoje
    const semChamadas = espiarFfmpeg([figurinha])
    await figurinha.gerarWebpComPadding(entrada, path.join(tmp, 'a.webp'), null)
    if (semChamadas.length !== 1) throw new Error('esperava 1 chamada ao ffmpeg')
    if (/drawtext/.test(semChamadas[0].filtro)) throw new Error('drawtext apareceu sem assinatura: ' + semChamadas[0].filtro)
    if (semChamadas[0].filtro !== figurinha.FILTRO_IMAGEM) throw new Error('o filtro mudou sem assinatura')

    // COM assinatura: drawtext no fim da cadeia
    const comChamadas = espiarFfmpeg([figurinha])
    await figurinha.gerarWebpComPadding(entrada, path.join(tmp, 'b.webp'), assinatura)
    const filtro = comChamadas[0].filtro
    if (!/drawtext=/.test(filtro)) throw new Error('drawtext ausente: ' + filtro)
    if (!filtro.startsWith(figurinha.FILTRO_IMAGEM + ',')) throw new Error('o filtro base mudou: ' + filtro)
    if (!/textfile=/.test(filtro)) throw new Error('a assinatura deveria ir por textfile=: ' + filtro)
    if (!/x=w-tw-/.test(filtro) || !/y=h-th-/.test(filtro)) throw new Error('posição ausente: ' + filtro)

    // 🧹 o teste não deixa .txt temporário para trás
    fs.rmSync(assinatura.caminhoTexto, { force: true })
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  await testar('drawtext: também no vídeo do /s e do /figurinha, só com assinatura', async () => {
    // ⚠️ Caminhos em os.tmpdir(): o mock do ffmpeg "escreve" o arquivo de
    // saída, e um caminho relativo sujo deixaria lixo na raiz do projeto.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'assinatura-video-'))
    const video = path.join(tmp, 'v.mp4')
    const saida = path.join(tmp, 'v.webp')
    fs.writeFileSync(video, 'x')

    const assinatura = webp.prepararAssinatura('@joaovip', 'teste')
    const comVideo = espiarFfmpeg([sticker])
    await sticker.videoParaWebpAnimado(video, saida, undefined, assinatura)
    if (!/drawtext=/.test(comVideo[0].filtro)) throw new Error('/s vídeo sem drawtext: ' + comVideo[0].filtro)

    const semVideo = espiarFfmpeg([sticker])
    await sticker.videoParaWebpAnimado(video, saida)
    if (/drawtext/.test(semVideo[0].filtro)) throw new Error('/s vídeo com drawtext sem assinatura')

    if (!/drawtext=/.test(figurinha.filtroVideo(12, assinatura))) throw new Error('/figurinha vídeo sem drawtext')
    if (/drawtext/.test(figurinha.filtroVideo(12))) throw new Error('/figurinha vídeo com drawtext sem assinatura')

    fs.rmSync(assinatura.caminhoTexto, { force: true })
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  await testar('definir: grava no MESMO documento do VIP com o LID resolvido', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, adicionado_em: Date.now(), expira_em: Date.now() + DOIS_DIAS })

    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/assinatura @joaovip', LID_VIP), '/assinatura @joaovip')

    const texto = textoUnico(sock)
    if (!/ASSINATURA DEFINIDA/.test(texto) || !/@joaovip/.test(texto)) throw new Error('confirmação inesperada: ' + texto)
    if (vips().size !== 1) throw new Error('deveria existir 1 documento só: ' + JSON.stringify([...vips().keys()]))
    if (vips().get(NUM_VIP)?.assinatura !== '@joaovip') {
      throw new Error('não gravou no documento do número real: ' + JSON.stringify(vips().get(NUM_VIP)))
    }
    if ((await vip.obterAssinatura(NUM_VIP)) !== '@joaovip') throw new Error('obterAssinatura deveria devolver o texto')
  })

  await testar('mostrar: sem argumento devolve a atual; sem ela, o convite', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS, assinatura: '@minha' })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/assinatura', JID_VIP), '/assinatura')
    const texto = textoUnico(sock)
    if (!/SUA ASSINATURA/.test(texto) || !/@minha/.test(texto)) throw new Error('resposta inesperada: ' + texto)
    if (!/remover/.test(texto)) throw new Error('deveria ensinar como remover')

    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    const { sock: sock2 } = criarSock()
    await comando.executar(sock2, JID_GRUPO, mensagem('/assinatura', JID_VIP), '/assinatura')
    if (!/ainda não tem assinatura/i.test(textoUnico(sock2))) throw new Error('convite ausente')
  })

  await testar('remover: apaga o campo e o VIP continua VIP', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS, assinatura: '@sai' })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/assinatura remover', JID_VIP), '/assinatura remover')
    if (!/removida/i.test(textoUnico(sock))) throw new Error('resposta inesperada: ' + textoUnico(sock))
    const doc = vips().get(NUM_VIP)
    if (!doc) throw new Error('o registro de VIP foi apagado junto (não deveria)')
    if ('assinatura' in doc) throw new Error('o campo assinatura continuou: ' + JSON.stringify(doc))
  })

  await testar('erro: limite e emoji recusados SEM gravar', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    const casos = [
      { pedido: `/assinatura ${'a'.repeat(16)}`, esperado: /longa/i },
      { pedido: '/assinatura @joao🔥', esperado: /emoji/i }
    ]
    for (const caso of casos) {
      const { sock } = criarSock()
      await comando.executar(sock, JID_GRUPO, mensagem(caso.pedido, JID_VIP), caso.pedido)
      if (!caso.esperado.test(textoUnico(sock))) throw new Error(`recusa inesperada: ${textoUnico(sock)}`)
      if ('assinatura' in vips().get(NUM_VIP)) throw new Error('gravou assinatura inválida')
    }
  })

  await testar('recusa: mortal comum, admin e dono (só VIP)', async () => {
    const JID_ADMIN = '5511900000003@s.whatsapp.net'
    PARTICIPANTES.push({ id: JID_ADMIN, admin: 'superadmin' })
    vips().clear()

    const alvos = [[JID_COMUM, 'mortal comum'], [JID_ADMIN, 'admin'], [`${getDonos()[0]}@s.whatsapp.net`, 'dono']]
    for (const [alvo, rotulo] of alvos) {
      const { sock } = criarSock()
      await comando.executar(sock, JID_GRUPO, mensagem('/assinatura @x', alvo), '/assinatura @x')
      if (!/exclusivo/i.test(textoUnico(sock))) throw new Error(`${rotulo} deveria ser recusado: ${textoUnico(sock)}`)
    }
    if (vips().size !== 0) throw new Error('nada deveria ter sido gravado')
  })

  await testar('VIP vencido: recusado e o registro é limpo', async () => {
    vips().clear()
    vips().set(NUM_COMUM, {
      numero: NUM_COMUM,
      adicionado_em: Date.now() - 10 * vip.DIA_EM_MS,
      expira_em: Date.now() - 1000,
      assinatura: '@zumbi'
    })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/assinatura @zumbi', JID_COMUM), '/assinatura @zumbi')
    if (!/exclusivo/i.test(textoUnico(sock))) throw new Error('VIP vencido deveria ser recusado')
    if (vips().has(NUM_COMUM)) throw new Error('o registro vencido deveria ter sido apagado')
  })

  await testar('checagem de VIP quebrada e banco fora: recusa segura', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })

    T._injetarChecarVip(async () => { throw new Error('mongo fora') })
    const { sock } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/assinatura @x', JID_VIP), '/assinatura @x')
    T._injetarChecarVip(null)
    if (!/exclusivo/i.test(textoUnico(sock))) throw new Error('deveria recusar com a checagem quebrada')
    if ('assinatura' in vips().get(NUM_VIP)) throw new Error('gravou com a checagem quebrada')

    vip.__definirColecaoTeste(null) // caminho real do vip.js, sem MONGODB_URI
    try {
      const { sock: sock2 } = criarSock()
      const inicio = Date.now()
      await comando.executar(sock2, JID_GRUPO, mensagem('/assinatura @x', JID_VIP), '/assinatura @x')
      if (Date.now() - inicio > 2000) throw new Error('demorou demais — a guarda de infra não atuou')
      if (!/exclusivo/i.test(textoUnico(sock2))) throw new Error('deveria recusar sem banco')
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
        mensagem('/assinatura @x', JID_VIP),
        '/assinatura @x'
      )
    } catch (e) { escapou = true }
    if (escapou) throw new Error('o erro escapou do executar')
  })

  await testar("ffmpeg REAL: a marca d'água aparece de verdade na imagem", async () => {
    const { execFileSync } = require('child_process')
    const binFfmpeg = require('@ffmpeg-installer/ffmpeg').path
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'assinatura-real-'))
    figurinha._injetarRodarExecutavel(null) // ffmpeg de verdade (padrão)
    sticker._injetarRodarExecutavel(null)

    // Imagem PRETA: com a assinatura branca aparecem pixels claros; sem ela, não.
    const preto = path.join(tmp, 'preto.png')
    execFileSync(binFfmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=512x512', '-frames:v', '1', preto])

    const contarClaros = (arquivo) => {
      const bruto = execFileSync(binFfmpeg, ['-i', arquivo, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 28 })
      let claros = 0
      for (const byte of bruto) if (byte > 100) claros += 1
      return claros
    }

    const assinatura = webp.prepararAssinatura('@joaovip', 'real')
    const comAss = path.join(tmp, 'com.webp')
    const semAss = path.join(tmp, 'sem.webp')
    await figurinha.gerarWebpComPadding(preto, comAss, assinatura)
    await figurinha.gerarWebpComPadding(preto, semAss, null)

    const clarosCom = contarClaros(comAss)
    const clarosSem = contarClaros(semAss)
    if (clarosCom <= 0) throw new Error('a assinatura não apareceu na imagem (0 pixels claros)')
    if (clarosSem !== 0) throw new Error('sem assinatura a imagem deveria continuar preta')
    console.log(`   → ${clarosCom} pixels claros com assinatura / ${clarosSem} sem`)

    fs.rmSync(assinatura.caminhoTexto, { force: true })
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  // ────────────────────────────────────────────────────────────
  // 🪪 Regressão: autor que chega como "@lid" (grupo com LID habilitado)
  // ────────────────────────────────────────────────────────────
  await testar('vip-acesso: o autor "@lid" é resolvido pelo telefone dos metadados', async () => {
    const { resolverAutorVip } = require('../vip-acesso')
    // 🚫 Mapeamento LID→telefone da sessão INDISPONÍVEL: é o cenário em que o
    // documento de VIP (gravado pelo telefone) ficava invisível para os
    // comandos de figurinha. O único dado que sobra são os metadados.
    lid.__definirConsultaSessaoTeste(async () => null)
    try {
      vips().clear()
      vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS, assinatura: '@joaovip' })

      // 📉 Linha de base (o bug): com o "@lid" cru o documento NÃO é achado.
      if ((await vip.obterAssinatura(LID_VIP)) !== null) {
        throw new Error('o cenário exige que o @lid cru não ache o documento')
      }

      const { sock } = criarSock()
      const autor = await resolverAutorVip(sock, JID_GRUPO, mensagem('/s', LID_VIP), 'teste')
      if (autor.numero !== NUM_VIP) throw new Error('número resolvido: ' + JSON.stringify(autor))
      if (autor.via !== 'metadados') throw new Error('via esperado "metadados": ' + autor.via)

      // ✍️ É com esse número que o /s e o /figurinha consultam a assinatura.
      if ((await vip.obterAssinatura(autor.numero)) !== '@joaovip') {
        throw new Error('a assinatura do número real não foi achada')
      }

      // 🛡️ Sem metadados e sem mapeamento não inventa número: cai nos dígitos.
      const orfao = await resolverAutorVip({ groupMetadata: async () => ({ participants: [] }) }, JID_GRUPO, mensagem('/s', LID_VIP), 'teste')
      if (orfao.numero !== limparNumero(LID_VIP) || orfao.via !== null) {
        throw new Error('sem resolução deveria devolver os dígitos crus: ' + JSON.stringify(orfao))
      }
    } finally {
      lid.__definirConsultaSessaoTeste(null)
    }
  })

  await testar('fonte: /s e /figurinha consultam o VIP pelo autor RESOLVIDO', async () => {
    for (const arquivo of ['sticker.js', 'figurinha.js']) {
      const fonte = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'menu-fig', arquivo), 'utf8')
      if (!/const \{ numero: autorVip \} = await resolverAutorVip\(sock, jid, msg/.test(fonte)) {
        throw new Error(`${arquivo} não resolve o autor via vip-acesso`)
      }
      if (!/obterAssinatura\(autorVip\)/.test(fonte)) {
        throw new Error(`${arquivo} não consulta a assinatura pelo número resolvido`)
      }
      if (/\bobterAssinatura\(autor\)/.test(fonte) || /\bisVip\(autor\)/.test(fonte)) {
        throw new Error(`${arquivo} voltou a consultar o VIP com o identificador cru`)
      }
    }
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()
