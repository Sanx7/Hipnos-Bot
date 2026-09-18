// ============================================
// 🖼️ TTP (/ttp) — Text To Picture (estilo "citação")
// ============================================
// Gera uma FIGURINHA com o texto do usuário sobre um fundo escuro
// (estilo "citação"/meme): texto branco, centralizado, com quebra de
// linha e auto-ajuste do tamanho da fonte. Uso:
//   /ttp o sono alcança todos
// ⚠️ TESTADO em 17/09/2026: a API api.betabotz.eu.org (/api/maker/ttp)
// responde 404 exigindo "apikey" — sem chave não é utilizável. Seguimos a
// alternativa MAIS ESTÁVEL pedida: geração 100% LOCAL com jimp (loadFont
// + print, fontes bitmap embutidas SANS_128/64/32_WHITE) e envio como
// FIGURINHA via wa-sticker-formatter. Sem rede, sem key, nada vaza.
// Uso LIVRE: qualquer pessoa pode chamar /ttp.
// ============================================

const { Jimp, JimpMime, loadFont, measureText } = require('jimp')
const { SANS_128_WHITE, SANS_64_WHITE, SANS_32_WHITE } = require('jimp/fonts')
const { Sticker, StickerTypes } = require('wa-sticker-formatter')

const LADO = 512
const MARGEM = 48
const LIMITE_CARACTERES = 80

// 🎨 Fundos ESCUROS (texto branco sempre legível), sorteados a cada uso
const PALETA = Object.freeze([
  0x1d1a2eff, // roxo do limbo (tema do bot)
  0x111318ff, // grafite
  0x18253aff, // azul-noite
  0x2a102eff, // vinho-escuro
  0x102a24ff  // verde-floresta
])

// Cache das fontes bitmap (loadFont é async; carrega uma vez por processo)
const CACHE_FONTE = new Map()
async function obterFonte(constante) {
  if (!CACHE_FONTE.has(constante)) CACHE_FONTE.set(constante, await loadFont(constante))
  return CACHE_FONTE.get(constante)
}

// ─── ✂️ Extrai o texto depois do comando ───
function extrairTexto(texto) {
  return String(texto || '').split(' ').slice(1).join(' ').trim()
}

// ─── 🔤 Quebra em linhas que caibam (palavra gigante é cortada por caractere) ───
function quebrarLinhas(font, texto, larguraMaxima) {
  const linhas = []
  let atual = ''
  const empurra = (palavra) => {
    const tentativa = atual ? atual + ' ' + palavra : palavra
    if (measureText(font, tentativa) <= larguraMaxima || !atual) {
      atual = tentativa
    } else {
      linhas.push(atual)
      atual = palavra
    }
  }
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    if (measureText(font, palavra) > larguraMaxima) {
      let pedaco = ''
      for (const letra of palavra) {
        if (pedaco && measureText(font, pedaco + letra) > larguraMaxima) {
          empurra(pedaco)
          pedaco = letra
        } else {
          pedaco += letra
        }
      }
      if (pedaco) empurra(pedaco)
    } else {
      empurra(palavra)
    }
  }
  if (atual) linhas.push(atual)
  return linhas
}

// ─── 🖼️ Fundo escuro sorteado + texto branco centralizado ───
// Auto-ajuste: tenta 128 → 64 → 32 px; texto gigante usa 32 e corta o
// excedente com "...".
async function gerarImagem(texto) {
  const corFundo = PALETA[Math.floor(Math.random() * PALETA.length)]
  const larguraUtil = LADO - MARGEM * 2
  const alturaUtil = LADO - MARGEM * 2

  let escolhida = null
  for (const constante of [SANS_128_WHITE, SANS_64_WHITE, SANS_32_WHITE]) {
    const font = await obterFonte(constante)
    const linhas = quebrarLinhas(font, texto, larguraUtil)
    if (linhas.length * font.common.lineHeight <= alturaUtil) {
      escolhida = { font, linhas }
      break
    }
  }
  if (!escolhida) {
    const font = await obterFonte(SANS_32_WHITE)
    const linhas = quebrarLinhas(font, texto, larguraUtil)
    const maxLinhas = Math.max(1, Math.floor(alturaUtil / font.common.lineHeight))
    escolhida = {
      font,
      linhas: linhas.slice(0, maxLinhas).concat(linhas.length > maxLinhas ? ['...'] : [])
    }
  }
  const { font, linhas } = escolhida

  const alturaBloco = linhas.length * font.common.lineHeight
  const topo = Math.max(MARGEM, Math.round((LADO - alturaBloco) / 2))

  const imagem = new Jimp({ width: LADO, height: LADO, color: corFundo })
  for (let indice = 0; indice < linhas.length; indice += 1) {
    imagem.print({
      font,
      x: MARGEM,
      y: topo + indice * font.common.lineHeight,
      text: linhas[indice]
    })
  }
  return imagem.getBuffer(JimpMime.png)
}

// ─── 📦 Empacota o PNG como figurinha FULL ───
async function empacotarSticker(bufferPng) {
  const sticker = new Sticker(bufferPng, {
    pack: 'Hipnos Bot',
    author: 'Sombras do Limbo',
    type: StickerTypes.FULL,
    categories: ['🖼️'],
    id: 'hipnos_ttp',
    quality: 90
  })
  return sticker.toBuffer()
}

// ─── 📨 Execução do comando ───
module.exports = {
  nome: 'ttp',
  descricao: 'Gera uma figurinha estilo "citação" com o texto que você enviar (ex: /ttp o sono alcança todos).',

  async executar(sock, jid, msg, texto) {
    try {
      // 1) Valida o texto do usuário
      const corpo = extrairTexto(texto)
      if (!corpo) {
        return await sock.sendMessage(jid, {
          text: '🖼️ *Você precisa me dizer o que escrever na imagem...*\n\n' +
            'Use: */ttp <texto>*\n' +
            'Exemplo: */ttp o sono alcança todos*'
        }, { quoted: msg })
      }

      // 2) Trunca textos longos (a figurinha precisa continuar legível)
      const textoFinal = corpo.length > LIMITE_CARACTERES
        ? corpo.slice(0, LIMITE_CARACTERES).trim() + '...'
        : corpo

      // 3) Gera a arte localmente (jimp) e envia como figurinha
      const png = await gerarImagem(textoFinal)
      const stickerBuffer = await empacotarSticker(png)
      await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg })
    } catch (err) {
      console.error('[ttp] Erro ao gerar a figurinha:', err?.message || err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras rabiscaram demais e a imagem se dispersou... Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}

// Exporta utilidades para os testes (mesmo padrão do sticker.js)
Object.assign(module.exports, {
  gerarImagem,
  LIMITE_CARACTERES
})