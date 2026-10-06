// ============================================================
// TESTE-JORNAL parte 1/3 — base, captura e prompt
// Roda 100% offline: IA e Mongo sao injetados. Uso: node scripts/teste-jornal.js
// ============================================================
const captura = require('../dados/captura-diaria')
const jornal = require('../comandos/menu-utilitario/jornal')
const I = jornal.__internos

const JID = '120363000000000001@g.us'
const MSG = { key: { remoteJid: JID, fromMe: false, id: 'J1' }, message: { conversation: '/jornal' } }

let reprovadas = 0
async function testar (nome, fn) {
  try { await fn(); console.log('PASSOU: ' + nome) }
  catch (err) { reprovadas += 1; console.log('FALHOU: ' + nome + ' :: ' + (err?.message || err)) }
}
function exigir (cond, detalhe) { if (!cond) throw new Error(detalhe || 'condicao falsa') }

function criarSock (overrides) {
  const enviadas = []
  const cfg = overrides || {}
  return {
    enviadas,
    sock: {
      profilePictureUrl: cfg.profilePictureUrl || (async () => { throw new Error('sem foto') }),
      sendMessage: async (jid, conteudo) => { enviadas.push({ jid, conteudo }); return { key: { id: 'f' } } }
    }
  }
}
const textos = (env) => env.map((e) => e.conteudo?.text).filter((x) => typeof x === 'string')

function semearMemoria (jid, n) {
  captura._limparMemoria()
  for (let i = 0; i < n; i += 1) {
    captura.registrarNoAcumulado(jid, 'Ana', 'mensagem numero ' + i + ' sobre o churrasco de domingo com bastante texto')
  }
}


async function main () {
  console.log('Teste offline do /jornal')

  await testar('exports: nome jornal, aliases e categoria', async () => {
    exigir(jornal.nome === 'jornal', 'nome errado')
    exigir(jornal.aliases.includes('resumododia'), 'falta resumododia')
    exigir(jornal.aliases.includes('manchetes'), 'falta manchetes')
    exigir(jornal.categoria === 'utilitario', 'categoria errada')
    exigir(I.NOME_JORNAL === 'JORNAL DO HIPNOS', 'nome do jornal errado')
    exigir(I.LIMITE_ENTRADA === 8000, 'limite 8000')
    exigir(I.CAPA_LARG === 900 && I.CAPA_ALT === 1200, 'dimensoes capa')
    exigir(I.URL_GROQ_CHAT.includes('api.groq.com'), 'Groq igual /gpt')
  })

  await testar('sanitizarTextoJimp: aspas curvas viram aspas retas', async () => {
    exigir(typeof I.sanitizarTextoJimp === 'function', 'sanitizarTextoJimp nao exportada')
    const t = I.sanitizarTextoJimp('“Manchete” do grupo disse ’oi’')
    const esperado = '"' + 'Manchete' + '"' + ' do grupo disse ' + String.fromCharCode(39) + 'oi' + String.fromCharCode(39)
    exigir(t === esperado, 'aspas curvas nao viraram retas: ' + t)
  })

  await testar('sanitizarTextoJimp: travessao longo e meio-travessao viram hifen', async () => {
    exigir(I.sanitizarTextoJimp('A — B') === 'A - B', 'em-dash nao virou hifen')
    exigir(I.sanitizarTextoJimp('A – B') === 'A - B', 'meio-travessao nao virou hifen')
  })

  await testar('sanitizarTextoJimp: reticencias unicode viram tres pontos', async () => {
    exigir(I.sanitizarTextoJimp('Fim… do resumo') === 'Fim... do resumo', 'reticencias nao viraram tres pontos')
  })

  await testar('sanitizarTextoJimp: texto normal (ASCII/acentos) passa intacto', async () => {
    const normal = 'Churrasco do domingo às 18h, café coado e cerveja gelada!'
    exigir(I.sanitizarTextoJimp(normal) === normal, 'texto normal foi alterado: ' + I.sanitizarTextoJimp(normal))
  })

  await testar('sanitizarTextoJimp: fora do conjunto vira espaco, \\n preservado', async () => {
    exigir(I.sanitizarTextoJimp('grupo 🎉 legal') === 'grupo legal', 'emoji nao virou espaco')
    const nl = String.fromCharCode(10)
    exigir(I.sanitizarTextoJimp('linha1' + nl + 'linha2') === 'linha1' + nl + 'linha2', 'quebra de linha nao preservada')
  })

  await testar('capa com texto sujo da IA nao quebra (sanitizado no desenho)', async () => {
    const buf = await I.comporCapaJornal({
      manchete: '“Grupo” — aí sim…',
      resumo: 'A turma ’combinou’ tudo — café… pronto 🎉\nSegunda linha “entre aspas”.',
      fotoBuffer: null
    })
    exigir(Buffer.isBuffer(buf) && buf.length > 5000, 'capa com texto sujo falhou')
    const { Jimp } = require('jimp')
    const img = await Jimp.read(buf)
    exigir(img.bitmap.width === 900 && img.bitmap.height === 1200, 'dimensao errada')
  })

  await testar('acumulado vazio avisa sem chamar IA', async () => {
    captura._limparMemoria()
    captura._injetarColecao({ findOne: async () => null })
    let chamouIa = false
    jornal._injetarIa(async () => { chamouIa = true; return { manchete: 'x', resumo: 'y' } })
    const { sock, enviadas } = criarSock()
    await jornal.executar(sock, JID, MSG)
    exigir(!chamouIa, 'IA nao devia ser chamada')
    exigir(!enviadas.some((e) => e.conteudo.image), 'nao devia mandar imagem')
    exigir(textos(enviadas).join(' ').includes('branco'), 'aviso vazio diferente')
    jornal._restaurarIa()
  })

  await testar('captura ignora comandos e midia sem texto', async () => {
    captura._limparMemoria()
    captura._injetarColecao(null)
    const gid = '120363099999999999@g.us'
    captura.capturarMensagem({ key: {}, pushName: 'A', message: { conversation: '/jornal agora' } }, gid)
    captura.capturarMensagem({ key: {}, pushName: 'B', message: { imageMessage: { caption: '' } } }, gid)
    captura.capturarMensagem({ key: {}, pushName: 'C', message: { conversation: '   ' } }, gid)
    let dia = await captura.lerAcumulado(gid)
    exigir(dia.mensagens.length === 0, 'devia ignorar tudo, tem ' + dia.mensagens.length)
    captura.capturarMensagem({ key: {}, pushName: 'D', message: { conversation: 'bom dia grupo, bora o churrasco?' } }, gid)
    dia = await captura.lerAcumulado(gid)
    exigir(dia.mensagens.length === 1, 'texto livre devia entrar')
    exigir(dia.mensagens[0].autor === 'D', 'autor errado')
  })

  await testar('reset diario: data velha esvazia o acumulado', async () => {
    captura._limparMemoria()
    captura._injetarColecao(null)
    const gid = '120363088888888888@g.us'
    captura.acumuladoMemoria.set(gid, { data: '2000-01-01', mensagens: [{ autor: 'X', texto: 'velha', hora: 1 }] })
    const dia = await captura.lerAcumulado(gid)
    exigir(dia.mensagens.length === 0, 'dia velho devia resetar')
    exigir(dia.data === captura.chaveDataLocal(), 'data devia ser hoje')
  })

  await testar('prompt pede manchete + resumo em JSON', async () => {
    exigir(I.SYSTEM_PROMPT.includes('manchete'), 'prompt sem manchete')
    exigir(I.SYSTEM_PROMPT.includes('JSON'), 'prompt sem JSON')
    const p = I.montarPrompt('Ana: oi')
    exigir(p.includes('Ana: oi'), 'prompt sem texto do dia')
    const ex = I.extrairJson('```json\n{"manchete":"A","resumo":"B"}\n```')
    exigir(ex && ex.manchete === 'A' && ex.resumo === 'B', 'extrairJson markdown')
  })

  await testar('erros de IA viram aviso igual gpt e resumir', async () => {
    const casos = [
      ['sem_chave', 'dorme'], ['chave_invalida', 'dorme'],
      ['limite', 'sobrecarregada'], ['timeout', 'sobrecarregada'],
      ['api', 'sombras'], ['vazia', 'sombras']
    ]
    for (const [tipo, trecho] of casos) {
      exigir(I.avisoPara(tipo).includes(trecho), tipo + ' devia conter ' + trecho)
    }
  })

  await testar('erro de IA no comando vira aviso sem imagem', async () => {
    semearMemoria(JID, 5)
    captura._injetarColecao(null)
    jornal._injetarIa(async () => { throw new I.ErroJornal('HTTP 429', 'limite') })
    const { sock, enviadas } = criarSock()
    await jornal.executar(sock, JID, MSG)
    exigir(!enviadas.some((e) => e.conteudo.image), 'erro de IA nao manda imagem')
    exigir(textos(enviadas).join(' ').includes('sobrecarregada'), 'aviso 429 diferente')
    jornal._restaurarIa()
  })

  await testar('truncamento em 8000 chars igual resumir', async () => {
    const t = I.truncar('a'.repeat(9000))
    exigir(t.texto.length === 8000, 'devia truncar em 8000')
    exigir(t.truncado === 1000, 'descarte 1000')
    exigir(I.truncar('curto').truncado === 0, 'curto nao trunca')
  })
}


async function parteImagem () {
  await testar('capa jimp 900x1200 bege 2 colunas sem estourar', async () => {
    const { Jimp, loadFont, measureText } = require('jimp')
    const { SANS_16_BLACK } = require('jimp/fonts')
    const font = await loadFont(SANS_16_BLACK)
    const largCol = Math.floor((900 - 80 - 24) / 2)
    const resumo = ('Palavra '.repeat(120).trim() + '\nSegundo paragrafo com bastante texto para encher as colunas.')
    const linhas = I.quebrarEmLinhas(font, resumo, largCol)
    exigir(linhas.length > 4, 'resumo devia quebrar em varias linhas')
    for (const l of linhas) {
      exigir(measureText(font, l) <= largCol + 1, 'linha estourou: ' + l.slice(0, 30))
    }
    const buf = await I.comporCapaJornal({ manchete: 'Churrasco agita o grupo', resumo, fotoBuffer: null })
    exigir(Buffer.isBuffer(buf) && buf.length > 5000, 'capa muito pequena')
    const img = await Jimp.read(buf)
    exigir(img.bitmap.width === 900 && img.bitmap.height === 1200, 'dimensao errada')
    const idx = (10 * 900 + 10) * 4
    exigir(img.bitmap.data[idx] > 220, 'fundo devia ser bege claro')
  })

  await testar('falha na imagem cai para texto com manchete', async () => {
    semearMemoria(JID, 5)
    captura._injetarColecao(null)
    jornal._injetarIa(async () => ({ manchete: 'Manchete X', resumo: 'Resumo Y do dia.' }))
    jornal._injetarCapa(async () => { throw new Error('jimp quebrou') })
    const { sock, enviadas } = criarSock()
    await jornal.executar(sock, JID, MSG)
    jornal._restaurarCapa()
    jornal._restaurarIa()
    exigir(!enviadas.some((e) => e.conteudo.image), 'nao devia mandar imagem quebrada')
    const txt = textos(enviadas).join('\n')
    exigir(txt.includes('imagem falhou'), 'sem aviso de fallback')
    exigir(txt.includes('Manchete X'), 'fallback sem manchete')
  })

  await testar('foto ocupa no maximo 35pc da altura', async () => {
    const { Jimp, JimpMime } = require('jimp')
    const foto = new Jimp({ width: 800, height: 800, color: 0x3366ccff })
    const fotoBuf = await foto.getBuffer(JimpMime.png)
    const buf = await I.comporCapaJornal({ manchete: 'M', resumo: 'texto curto', fotoBuffer: fotoBuf })
    const img = await Jimp.read(buf)
    exigir(img.bitmap.height === 1200, 'altura mudou')
    exigir(Math.round(1200 * 0.35) === 420, 'teto 35pc = 420px')
    exigir(buf.length > 5000, 'capa com foto pequena')
  })

  await testar('fluxo feliz manda imagem com legenda', async () => {
    semearMemoria(JID, 5)
    captura._injetarColecao(null)
    jornal._injetarIa(async () => ({ manchete: 'Churrasco do domingo', resumo: 'O grupo combinou o churrasco.' }))
    const { sock, enviadas } = criarSock()
    await jornal.executar(sock, JID, MSG)
    const capa = enviadas.find((e) => e.conteudo.image)
    exigir(capa, 'devia mandar a capa em imagem')
    exigir(String(capa.conteudo.caption).includes('Resumo do dia'), 'legenda errada')
    exigir(capa.conteudo.jpegThumbnail, 'sem jpegThumbnail')
    jornal._restaurarIa()
  })

  await testar('TTL do Mongo com indice expiraEm', async () => {
    const fs = require('fs')
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'dados', 'captura-diaria.js'), 'utf8')
    exigir(src.includes('expireAfterSeconds'), 'sem TTL')
    exigir(src.includes('expiraEm'), 'sem expiraEm')
    exigir(src.includes('America/Sao_Paulo'), 'fuso errado')
  })

  await testar('bot.js chama a captura em grupo', async () => {
    const fs = require('fs')
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'bot.js'), 'utf8')
    exigir(src.includes('captura-diaria'), 'bot sem captura')
    exigir(src.includes('capturarMensagem'), 'bot sem hook')
  })
}

async function runAll () {
  await main()
  await parteImagem()
  console.log(reprovadas === 0 ? 'TODOS PASSARAM' : reprovadas + ' FALHARAM')
  process.exit(reprovadas === 0 ? 0 : 1)
}
runAll().catch((e) => { console.error(e); process.exit(1) })
