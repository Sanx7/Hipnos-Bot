// ============================================================
// 🧪 teste-efeitos.js — Testes OFFLINE dos efeitos/memes de imagem
// ============================================================
// RODA SEM WhatsApp e SEM Some Random API: socket e fotos são injetados
// via `_injetar` (mesmo padrão do teste-temavip.js) e as fotos sintéticas
// são geradas com o próprio `canvas`.
//
// Cobre:
//   - o MÓDULO exporta os 21 comandos pedidos + os que já existiam;
//   - NENHUM nome colide com outro comando do projeto (/delete é admin);
//   - menção validada ANTES de qualquer download (sem_mencao);
//   - sem foto de perfil → aviso amigável (sem_foto);
//   - cada meme LOCAL devolve PNG válido, sem tocar em rede;
//   - /slap usa as DUAS fotos; /apagar usa uma só;
//   - /sfundo responde "em breve" (provedor pago não escolhido).
// Uso: node scripts/teste-efeitos.js
// ============================================================

process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''

const path = require('path')
const fs = require('fs')

const { createCanvas } = require('canvas')
const efeitos = require('../comandos/menu-efeitos/efeitos-imagem')

// ─── 🖼️ Foto sintética (PNG) para injetar como "foto de perfil" ───
function fotoSintetica(cor) {
  const c = createCanvas(200, 200)
  const ctx = c.getContext('2d')
  ctx.fillStyle = cor
  ctx.fillRect(0, 0, 200, 200)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 30px Sans'
  ctx.textAlign = 'center'
  ctx.fillText('H', 100, 115)
  return c.toBuffer('image/png')
}

const FOTO_A = fotoSintetica('#3366cc')
const FOTO_B = fotoSintetica('#cc3366')

// ─── Sock mockado ───
function criarSock() {
  const enviadas = []
  return {
    enviadas,
    sock: {
      sendMessage: async (jid, conteudo) => {
        enviadas.push({ jid, conteudo })
        return { key: { id: `fake-${enviadas.length}` } }
      },
      profilePictureUrl: async () => 'https://exemplo.invalid/foto.png',
      groupMetadata: async () => ({ participants: [{ id: '5511900000001@s.whatsapp.net' }, { id: '5511900000002@s.whatsapp.net' }] })
    }
  }
}

function msgComMencao(alvo) {
  return {
    key: { remoteJid: 'G@g.us', fromMe: false, id: 'MSG', participant: '5511900000001@s.whatsapp.net' },
    message: {
      extendedTextMessage: {
        text: '/efeito',
        contextInfo: alvo ? { mentionedJid: [alvo] } : {}
      }
    }
  }
}

const ALVO = '5511900000002@s.whatsapp.net'
const ultimoTexto = (alvo) => {
  const e = [...alvo].reverse().find((x) => x.conteudo?.text)
  return e?.conteudo?.text || null
}

// PNG válido? (assinatura 89 50 4E 47)
const ehPng = (buf) => Buffer.isBuffer(buf) && buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50

const porNome = (nome) => efeitos.find((c) => c.nome === nome)

// 🔁 Estado de injeção — cada teste declara o que o módulo deve ver.
// Sempre injetamos TUDO (fotoDePerfil, buscarSra, baixarBuffer) para não
// herdar a injeção do teste anterior.
const semRede = { baixarBuffer: async () => FOTO_A, buscarSra: async () => { throw new Error('a SRA não deve ser chamada neste teste') } }
const injetar = (fotoDePerfil) => efeitos._injetar({ ...semRede, fotoDePerfil })

// Estado padrão: duas fotos distintas (autor = A, menção = B)
const injetarPadrao = () => injetar(async (sock, jid) => ({ url: 'https://exemplo.invalid/foto.png', buffer: jid === ALVO ? FOTO_B : FOTO_A }))

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

  injetarPadrao()

  await testar('exports: todos os comandos do prompt estão registrados', async () => {
    const exigidos = ['kiss', 'kissme', 'ship', 'shipme', 'slap', 'spank', 'triggered', 'jail', 'wasted', 'blur', 'greyscale', 'grayscale', 'sepia', 'invert', 'clown', 'batslap', 'beautiful', 'bobross', 'ad', 'circulo', 'sfundo']
    for (const nome of exigidos) {
      if (!porNome(nome)) throw new Error(`falta o comando /${nome}`)
    }
    // /apagar é o "delete" da SRA, renomeado por conflito com o admin
    if (!porNome('apagar')) throw new Error('falta o /apagar (ex-/delete)')
  })

  await testar('cada comando tem nome + executar + descricao (padrão do loader)', async () => {
    for (const c of efeitos) {
      if (!c?.nome) continue // helpers injetados (_injetar/compor), não comandos
      if (typeof c.executar !== 'function') throw new Error(`/${c.nome} sem executar`)
      if (!c.descricao) throw new Error(`/${c.nome} sem descricao`)
    }
  })

  await testar('nenhum nome colide com outro comando do projeto', async () => {
    // "delete" é o comando ADMIN (apaga mensagem) — precisa continuar lá
    const adminDelete = require('../comandos/admin/delete')
    if (adminDelete.nome !== 'delete') throw new Error('o admin /delete mudou de nome')
    const apagado = porNome('apagar')
    if (apagado.nome === 'delete') throw new Error('/apagar não pode se chamar "delete" (conflita com o admin)')
    // nenhum efeito pode registrar "delete" como nome ou alias
    for (const c of efeitos) {
      if (c.nome === 'delete') throw new Error('um efeito registrando "delete" sobrescreveria o admin')
      if (Array.isArray(c.aliases) && c.aliases.includes('delete')) {
        throw new Error(`/${c.nome} tem alias "delete" — sobrescreveria o admin`)
      }
    }
    // /apagar tem aliases livres
    if (!apagado.aliases.includes('deletar')) throw new Error('/apagar deveria ter o alias /deletar')
  })

  await testar('menção é exigida ANTES de baixar qualquer foto', async () => {
    // Se este fosse chamado, a injeção quebraria o teste de propósito
    injetar(async () => { throw new Error('NÃO deveria baixar foto sem menção') })
    for (const nome of ['slap', 'kiss', 'ship']) {
      const { sock, enviadas } = criarSock()
      await porNome(nome).executar(sock, 'G@g.us', msgComMencao(null))
      const t = ultimoTexto(enviadas)
      if (!t || !/Falta o alvo/i.test(t)) throw new Error(`/${nome} deveria pedir menção: ${t}`)
    }
  })

  await testar('sem foto de perfil → aviso amigável (sem stack)', async () => {
    // Usa a CLASSE REAL do módulo: a falha vira aviso, nunca stack crua.
    injetar(async () => { throw new efeitos.ErroEfeitos('sem foto de perfil', 'sem_foto') })
    const { sock, enviadas } = criarSock()
    await porNome('slap').executar(sock, 'G@g.us', msgComMencao(ALVO))
    const t = ultimoTexto(enviadas)
    if (!t || !/Sem foto de perfil/i.test(t)) throw new Error(`aviso inesperado: ${t}`)
  })

  await testar('memes LOCAIS geram PNG válido sem tocar em rede', async () => {
    injetarPadrao()
    const { compor } = efeitos
    const casos = [
      ['spank', [FOTO_A]],
      ['batslap', [FOTO_A]],
      ['beautiful', [FOTO_A]],
      ['bobross', [FOTO_A]],
      ['ad', [FOTO_A]],
      ['apagar', [FOTO_A]],
      ['clown', [FOTO_A]],
      ['slap', [FOTO_A, FOTO_B]] // duas fotos
    ]
    for (const [nome, fotos] of casos) {
      const buffer = await compor[nome](...fotos)
      if (!ehPng(buffer)) throw new Error(`/${nome} não devolveu PNG válido (${buffer?.length} bytes)`)
    }
  })

  await testar('/slap usa as DUAS fotos e marca a menção', async () => {
    injetarPadrao()
    const { sock, enviadas } = criarSock()
    await porNome('slap').executar(sock, 'G@g.us', msgComMencao(ALVO))
    const conteudo = [...enviadas].reverse().find((x) => x.conteudo?.image)?.conteudo
    if (!conteudo || !ehPng(conteudo.image)) throw new Error('/slap não enviou imagem PNG')
    if (!conteudo.mentions?.includes(ALVO)) throw new Error('/slap deveria marcar a pessoa mencionada')
    if (!conteudo.jpegThumbnail) throw new Error('/slap deveria enviar jpegThumbnail pronta (regra do projeto)')
  })

  await testar('/apagar (ex-/delete) funciona com uma foto só', async () => {
    injetarPadrao()
    const { sock, enviadas } = criarSock()
    await porNome('apagar').executar(sock, 'G@g.us', msgComMencao(ALVO))
    const conteudo = [...enviadas].reverse().find((x) => x.conteudo?.image)?.conteudo
    if (!conteudo || !ehPng(conteudo.image)) throw new Error('/apagar não enviou PNG')
    if (!/apagada/i.test(conteudo.caption || '')) throw new Error('legenda do /apagar inesperada: ' + conteudo.caption)
  })

  await testar('/sfundo responde "em breve" (provedor pago não escolhido)', async () => {
    const { sock, enviadas } = criarSock()
    await porNome('sfundo').executar(sock, 'G@g.us', msgComMencao(ALVO))
    const t = ultimoTexto(enviadas)
    if (!t || !/Em breve/i.test(t)) throw new Error(`/sfundo deveria avisar "em breve": ${t}`)
  })

  await testar('filtros LOCAIS com jimp real: contraste, espelhar e pixel geram PNG', async () => {
    injetarPadrao()
    // Foto com gradiente (para o espelhar ter efeito observável)
    const grad = createCanvas(120, 120)
    const g = grad.getContext('2d')
    const lin = g.createLinearGradient(0, 0, 120, 0)
    lin.addColorStop(0, '#ff0000')
    lin.addColorStop(1, '#0000ff')
    g.fillStyle = lin
    g.fillRect(0, 0, 120, 120)
    const foto = grad.toBuffer('image/png')

    for (const nome of ['contraste', 'espelhar', 'pixel']) {
      const cmd = porNome(nome)
      if (!cmd) throw new Error(`falta o /${nome}`)
      const { sock, enviadas } = criarSock()
      await cmd.executar(sock, 'G@g.us', msgComMencao(ALVO))
      const conteudo = [...enviadas].reverse().find((x) => x.conteudo?.image)?.conteudo
      if (!conteudo || !ehPng(conteudo.image)) throw new Error(`/${nome} não enviou PNG válido`)
      if (!conteudo.jpegThumbnail) throw new Error(`/${nome} deveria enviar jpegThumbnail pronta`)
    }
  })

  await testar('/espelhar realmente espelha (o gradiente inverte de lado)', async () => {
    // 🔬 PROVA FUNCIONAL, feita no PRÓPRIO JIMP (mesma lib do efeito):
    // colunas vão de VERMELHO (esquerda) a AZUL (direita). Depois de
    // espelhar, a borda ESQUERDA tem de puxar para o AZUL.
    // ⚠️ O gradiente é montado pixel a pixel de propósito: o
    // createLinearGradient do node-canvas não é fiável neste ambiente.
    const { Jimp, JimpMime } = require('jimp')
    const LARG = 120
    const base = new Jimp({ width: LARG, height: 8, color: 0x000000ff })
    for (let i = 0; i < LARG; i++) {
      const t = i / (LARG - 1)
      const cor = (Math.round(255 * (1 - t)) << 16) | Math.round(255 * t)
      for (let y = 0; y < 8; y++) base.setPixelColor(cor, i, y)
    }
    const original = await base.getBuffer(JimpMime.png)

    const antes = await Jimp.read(original)
    const depois = await Jimp.read(await efeitos.compor.filtro('espelhar', original))
    const canal = (img, x) => {
      const p = img.getPixelColor(x, 4)
      return { r: (p >> 16) & 0xff, b: p & 0xff }
    }
    const aEsq = canal(antes, 1)
    const aDir = canal(antes, LARG - 2)
    const dEsq = canal(depois, 1)
    // Sanidade: a origem tem de variar mesmo (vermelho à esq, azul à dir)
    if (!(aEsq.r > aEsq.b)) throw new Error(`origem não varia: esq=${aEsq.r}/${aEsq.b}`)
    if (!(aDir.b > aDir.r)) throw new Error(`origem não varia: dir=${aDir.r}/${aDir.b}`)
    // Sanidade: o espelhar tem de mudar a borda esquerda
    if (!(dEsq.b > dEsq.r)) throw new Error(`não espelhou: esq ${aEsq.r}/${aEsq.b} → ${dEsq.r}/${dEsq.b}`)
  })

  await testar('/rip gera a lápide local com PNG válido', async () => {
    injetarPadrao()
    const buffer = await efeitos.compor.rip(FOTO_A)
    if (!ehPng(buffer)) throw new Error('/rip não devolveu PNG válido')
    const { sock, enviadas } = criarSock()
    await porNome('rip').executar(sock, 'G@g.us', msgComMencao(ALVO))
    const conteudo = [...enviadas].reverse().find((x) => x.conteudo?.image)?.conteudo
    if (!conteudo || !ehPng(conteudo.image)) throw new Error('/rip não enviou imagem')
    if (!/RIP/i.test(conteudo.caption || '')) throw new Error('legenda do /rip inesperada: ' + conteudo.caption)
  })

  await testar('/bolsonaro responde "indisponível" (endpoint saiu da API)', async () => {
    const { sock, enviadas } = criarSock()
    await porNome('bolsonaro').executar(sock, 'G@g.us', msgComMencao(ALVO))
    const t = ultimoTexto(enviadas)
    if (!t || !/Indispon/i.test(t)) throw new Error(`/bolsonaro deveria avisar indisponibilidade: ${t}`)
  })

  await testar('aliases novos apontam para o comando certo', async () => {
    const esperado = {
      gray: 'greyscale',
      inverter: 'invert',
      cadeia: 'jail',
      pixelate: 'pixel'
    }
    for (const [alias, alvo] of Object.entries(esperado)) {
      const dono = efeitos.find((c) => Array.isArray(c.aliases) && c.aliases.includes(alias))
      if (!dono) throw new Error(`nenhum comando tem o alias /${alias}`)
      if (dono.nome !== alvo) throw new Error(`/${alias} aponta para /${dono.nome}, deveria ser /${alvo}`)
    }
    // O alias não pode sequestrar o nome de outro comando do projeto
    const reserved = ['delete', 'play', 'menu', 'perfil', 'info']
    for (const c of efeitos) {
      for (const a of c.aliases || []) {
        if (reserved.includes(a)) throw new Error(`alias /${a} de /${c.nome} colide com um comando do projeto`)
      }
    }
  })

  await testar('menu-efeitos lista TODOS os comandos de efeito (sem nenhum faltando)', async () => {
    const fs = require('fs')
    const menu = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'menu-efeitos', 'menu-efeitos.js'), 'utf8')

    // Só contam as LINHAS DE COMANDO do menu (emoji + "/comando"), não
    // imports de código (ex.: require('../../config')) nem comentários.
    const linhasDeComando = menu
      .split('\n')
      .filter((l) => !/^\s*\/\//.test(l))           // não é comentário
      .filter((l) => !/require\(/.test(l))           // não é import de código
      .filter((l) => /^\s*[^\s/][^\n]*\/(?![/*])/.test(l)) // tem emoji + /algo
      .join('\n')
    const citados = [...linhasDeComando.matchAll(/\/([a-z][a-z0-9-]{2,})/g)].map((m) => m[1])

    // Nenhum comando do módulo pode faltar no menu.
    // (/sfundo e /bolsonaro respondem "indisponível", mas ficam listados
    //  na seção de indisponíveis — então TODO comando deve aparecer.)
    const faltando = efeitos
      .filter((c) => c.nome)
      .map((c) => c.nome)
      .filter((nome) => !new RegExp(`\\/${nome}\\b`).test(linhasDeComando))
    if (faltando.length) throw new Error('faltando no menu: ' + faltando.join(', '))

    // 2) O menu não pode inventar comando de efeito que não existe.
    //    Aliases legítimos (dos próprios comandos e dos submenus) valem.
    const submenus = new Set(['menuefeitos', 'menu-efeito', 'efeitos', 'menu-fig', 'fulano', 'pessoa', 'esquilo', 'gigante', 'robo', 'demonio', 'rapido', 'lento', 'reverso', 'estourar'])
    const nomesReais = new Set(efeitos.filter((c) => c.nome).map((c) => c.nome))
    for (const c of efeitos) {
      if (c.nome && Array.isArray(c.aliases)) for (const a of c.aliases) nomesReais.add(a)
    }
    for (const citado of new Set(citados)) {
      if (!nomesReais.has(citado) && !submenus.has(citado)) {
        throw new Error(`o menu cita /${citado}, que não existe no módulo`)
      }
    }
  })

  await testar('/menuefeitos é alias do menu e o /menu principal aponta pra ele', async () => {
    const fs = require('fs')
    const menuCmd = require('../comandos/menu-efeitos/menu-efeitos')
    if (menuCmd.nome !== 'menu-efeitos') throw new Error('nome: ' + menuCmd.nome)
    for (const apelido of ['menuefeitos', 'menu-efeito', 'efeitos']) {
      if (!menuCmd.aliases.includes(apelido)) throw new Error('falta alias: ' + apelido)
    }
    // Simula o registro do loader: nome + todos os aliases
    const registro = new Map()
    registro.set(menuCmd.nome, menuCmd)
    for (const apelido of menuCmd.aliases) registro.set(apelido, menuCmd)
    if (registro.get('menuefeitos') !== menuCmd) throw new Error('/menuefeitos não aponta para o menu')

    // E o /menu principal deve citá-lo
    const menuPrincipal = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'menu.js'), 'utf8')
    if (!/menuefeitos/.test(menuPrincipal)) throw new Error('o /menu não cita o /menuefeitos')
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()