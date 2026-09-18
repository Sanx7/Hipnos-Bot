// ============================================================
// 💬 FAKE-CHAT (/fake-chat) — Print falso de conversa (uso LIVRE)
// ============================================================
// Gera uma IMAGEM de conversa encenada estilo WhatsApp (modo escuro)
// 100% LOCAL com jimp (sem rede, sem API de terceiro, nada vaza).
// Formatos (quebras de linha PRESERVADAS, como no /legendabv):
//   /fake-chat oi, sumido!         → 1 bolha MINHA (direita)
//   /fake-chat Ana | oi, sumido!   → 1 bolha DELA (esquerda, com nome)
//   /fake-chat (varias linhas = ida e volta):
//     Ana: oi, sumido!
//     eu: oi! quanto tempo
//     Ana | que bom te ver
// Regras por linha: "Nome | texto" ou "Nome: texto" = bolha esquerda
// com nome; "eu | texto" ou "eu: texto" = bolha minha (direita); sem
// prefixo = bolha minha. Max. 8 mensagens, 200 caracteres cada.
// Envia como IMAGEM com jpegThumbnail PRONTA (regra de ouro do projeto:
// meme.js/nasa.js — a Baileys pula o sharp/libvips nativo).
// ============================================================

const { Jimp, JimpMime, loadFont, measureText } = require('jimp')
const { SANS_32_WHITE, SANS_16_WHITE, SANS_8_WHITE } = require('jimp/fonts')

const LARGURA = 720
const MARGEM_LATERAL = 24
const LARGURA_MAX_BOLHA = 520
const PADDING_X = 20
const RAIO_BOLHA = 18
const ALTURA_CABECALHO = 96
const ALTURA_RODAPE = 90
const ESPACO_TOPO = 20
const ESPACO_ENTRE = 12
const MAX_MENSAGENS = 8
const MAX_NOME = 20
const MAX_TEXTO_MSG = 200

const COR_FUNDO = 0x0b141aff
const COR_BARRA = 0x1f2c34ff
const COR_BOLHA_FORA = 0x1f2c34ff
const COR_BOLHA_EU = 0x005c4bff
const COR_AVATAR = 0x3b4a54ff
const COR_INPUT = 0x2a3942ff

// 🧩 JPEG 8x8 valido (mesmo fallback do meme.js/nasa.js)
const THUMB_FALLBACK_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzU4LjQyLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAEBEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgACAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AD//Z'

const CACHE_FONTE = new Map()
async function obterFonte(constante) {
  if (!CACHE_FONTE.has(constante)) CACHE_FONTE.set(constante, await loadFont(constante))
  return CACHE_FONTE.get(constante)
}

// ─── ✂️ Corpo depois do comando PRESERVANDO quebras de linha ───
function extrairCorpo(texto) {
  return String(texto || '').replace(/^\/?\S+/, '').replace(/^\s+/, '').trimEnd()
}

// ─── 💬 Uma linha → { lado, nome, texto } ───
function parsearLinha(linha) {
  const crua = String(linha || '').trim()
  if (!crua) return null
  if (crua.includes('|')) {
    const i = crua.indexOf('|')
    const quem = crua.slice(0, i).trim()
    const resto = crua.slice(i + 1).trim()
    if (resto) {
      if (/^eu$/i.test(quem)) return { lado: 'eu', nome: null, texto: resto }
      if (quem) return { lado: 'fora', nome: quem.slice(0, MAX_NOME), texto: resto }
    }
  } else {
    const m = crua.match(/^([^:]{1,20}):\s*(.+)$/)
    if (m) {
      const quem = String(m[1] || '').trim()
      const resto = String(m[2] || '').trim()
      if (resto) {
        if (/^eu$/i.test(quem)) return { lado: 'eu', nome: null, texto: resto }
        if (quem) return { lado: 'fora', nome: quem, texto: resto }
      }
    }
  }
  return { lado: 'eu', nome: null, texto: crua }
}

// ─── 💬 Corpo → lista de mensagens (máx. 8, truncadas) ───
function parsearConversa(corpo) {
  const linhas = String(corpo || '').split('\n').map((l) => l.trim()).filter(Boolean)
  const msgs = []
  for (const linha of linhas) {
    if (msgs.length >= MAX_MENSAGENS) break
    const msg = parsearLinha(linha)
    if (!msg || !msg.texto) continue
    let texto = msg.texto.replace(/\s+/g, ' ').trim()
    if (!texto) continue
    if (texto.length > MAX_TEXTO_MSG) texto = texto.slice(0, MAX_TEXTO_MSG).trim() + '...'
    msgs.push({ lado: msg.lado, nome: msg.nome, texto })
  }
  return msgs
}

// ─── 🔤 Quebra em linhas que caibam (palavra gigante é cortada) ───
function quebrarLinhas(font, texto, larguraMaxima) {
  const linhas = []
  let atual = ''
  const empurra = (palavra) => {
    const tentativa = atual ? atual + ' ' + palavra : palavra
    if (measureText(font, tentativa) <= larguraMaxima || !atual) atual = tentativa
    else { linhas.push(atual); atual = palavra }
  }
  for (const palavra of String(texto).split(/\s+/).filter(Boolean)) {
    if (measureText(font, palavra) > larguraMaxima) {
      let pedaco = ''
      for (const letra of palavra) {
        if (pedaco && measureText(font, pedaco + letra) > larguraMaxima) { empurra(pedaco); pedaco = letra }
        else pedaco += letra
      }
      if (pedaco) empurra(pedaco)
    } else empurra(palavra)
  }
  if (atual) linhas.push(atual)
  return linhas.length ? linhas : ['']
}

// ─── 🟧 Retangulo solido no bitmap ───
function preencherReto(imagem, x, y, w, h, cor) {
  const { width, height } = imagem.bitmap
  const x0 = Math.max(0, x)
  const y0 = Math.max(0, y)
  const x1 = Math.min(width, x + w)
  const y1 = Math.min(height, y + h)
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) imagem.setPixelColor(cor, px, py)
  }
}

// ─── 🫧 Bolha = retangulo arredondado (cantos = quartos de circulo) ───
function pintarBolha(imagem, x, y, w, h, raio, cor) {
  const r = Math.max(0, Math.min(raio, Math.floor(Math.min(w, h) / 2)))
  const dentro = (px, py) => {
    if (px >= x + r && px < x + w - r) return true
    if (py >= y + r && py < y + h - r) return true
    const cx = px < x + r ? x + r : x + w - r - 1
    const cy = py < y + r ? y + r : y + h - r - 1
    return (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r
  }
  const { width, height } = imagem.bitmap
  for (let py = y; py < y + h; py += 1) {
    if (py < 0 || py >= height) continue
    for (let px = x; px < x + w; px += 1) {
      if (px < 0 || px >= width) continue
      if (dentro(px, py)) imagem.setPixelColor(cor, px, py)
    }
  }
}

function horaAtual() {
  try {
    return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch (err) { return '12:00' }
}

// ─── 🖼️ Gera o PNG do print (altura conforme nº de bolhas) ───
async function gerarImagem(mensagens) {
  const fonteMsg = await obterFonte(SANS_16_WHITE)
  const fonteNome = await obterFonte(SANS_16_WHITE)
  const fonteHora = await obterFonte(SANS_8_WHITE)
  const fonteBarra = await obterFonte(SANS_32_WHITE)
  const lh = fonteMsg.common.lineHeight
  const lhNome = fonteNome.common.lineHeight
  const hora = horaAtual()
  const larguraHora = measureText(fonteHora, hora)

  const titulo = (mensagens.find((m) => m.lado === 'fora' && m.nome) || {}).nome || 'Conversa'
  const blocos = mensagens.map((m) => {
    const larguraUtil = LARGURA_MAX_BOLHA - PADDING_X * 2
    const linhas = quebrarLinhas(fonteMsg, m.texto, larguraUtil)
    let maior = 0
    for (const l of linhas) maior = Math.max(maior, measureText(fonteMsg, l))
    const larguraTexto = Math.min(larguraUtil, maior)
    const alturaTexto = linhas.length * lh
    const alturaNome = m.nome ? lhNome : 0
    const w = Math.ceil(Math.max(larguraTexto, m.nome ? measureText(fonteNome, m.nome) : 0, larguraHora + 52)) + PADDING_X * 2
    const h = 14 + alturaNome + alturaTexto + 12 + 12
    return { msg: m, linhas, w, h }
  })

  let altura = ALTURA_CABECALHO + ESPACO_TOPO
  for (const b of blocos) altura += b.h + ESPACO_ENTRE
  altura += ALTURA_RODAPE

  const imagem = new Jimp({ width: LARGURA, height: altura, color: COR_FUNDO })
  preencherReto(imagem, 0, 0, LARGURA, ALTURA_CABECALHO, COR_BARRA)
  preencherReto(imagem, 30, 28, 40, 40, COR_AVATAR)
  imagem.print({ font: fonteBarra, x: 84, y: 22, text: titulo.slice(0, 24) })
  imagem.print({ font: fonteHora, x: 84, y: 62, text: 'online agora mesmo' })

  let y = ALTURA_CABECALHO + ESPACO_TOPO
  for (const b of blocos) {
    const w = Math.min(b.w, LARGURA - MARGEM_LATERAL * 2)
    const x = b.msg.lado === 'eu' ? LARGURA - MARGEM_LATERAL - w : MARGEM_LATERAL
    pintarBolha(imagem, x, y, w, b.h, RAIO_BOLHA, b.msg.lado === 'eu' ? COR_BOLHA_EU : COR_BOLHA_FORA)
    let ty = y + 14
    if (b.msg.nome) {
      imagem.print({ font: fonteNome, x: x + PADDING_X, y: ty, text: b.msg.nome })
      ty += lhNome
    }
    for (const l of b.linhas) {
      imagem.print({ font: fonteMsg, x: x + PADDING_X, y: ty, text: l })
      ty += lh
    }
    imagem.print({ font: fonteHora, x: x + w - PADDING_X - larguraHora, y: y + b.h - 12 - 10, text: hora })
    y += b.h + ESPACO_ENTRE
  }

  preencherReto(imagem, 0, altura - ALTURA_RODAPE, LARGURA, ALTURA_RODAPE, COR_BARRA)
  preencherReto(imagem, MARGEM_LATERAL, altura - ALTURA_RODAPE + 20, LARGURA - MARGEM_LATERAL * 2, 50, COR_INPUT)
  return imagem.getBuffer(JimpMime.png)
}

// ─── 🎨 Miniatura PRONTA (jimp, JS puro — igual ao meme.js) ───
async function gerarThumbnailBase64(buffer) {
  try {
    const imagem = await Jimp.read(buffer)
    imagem.cover({ w: 64, h: 64 })
    const jpeg = await imagem.getBuffer(JimpMime.jpeg, { quality: 60 })
    return jpeg.toString('base64')
  } catch (err) {
    console.error('[fake-chat] miniatura falhou (fallback 8x8):', err?.message || err)
    return THUMB_FALLBACK_JPEG_BASE64
  }
}

// ─── 📨 Execucao do comando ───
module.exports = {
  nome: 'fake-chat',
  aliases: ['fakechat', 'fchat', 'printchat'],
  descricao: 'Gera um print falso de conversa estilo WhatsApp com o texto que voce enviar (ex: /fake-chat Ana | oi, sumido!).',
  categoria: 'principal',

  async executar(sock, jid, msg, texto) {
    try {
      const corpo = extrairCorpo(texto)
      if (!corpo) {
        return await sock.sendMessage(jid, {
          text: '💬 *Voce precisa me dizer a conversa...*\n\n' +
            'Use: */fake-chat <mensagem>*\n' +
            'Exemplos:\n' +
            '• */fake-chat oi, sumido!* (bolha minha)\n' +
            '• */fake-chat Ana | oi, sumido!* (bolha dela)\n' +
            '• Varias linhas = ida e volta:\n' +
            '```/fake-chat\nAna: oi, sumido!\neu: oi! quanto tempo\nAna | que bom te ver```'
        }, { quoted: msg })
      }

      const mensagens = parsearConversa(corpo)
      if (!mensagens.length) {
        return await sock.sendMessage(jid, {
          text: '💬 *Nao achei mensagem nenhuma...*\n\nEscreva ao menos uma linha de texto depois do comando.'
        }, { quoted: msg })
      }

      const png = await gerarImagem(mensagens)
      const jpegThumbnail = await gerarThumbnailBase64(png)
      await sock.sendMessage(jid, {
        image: png,
        caption: '💬 *Print do limbo (conversa encenada — nao e real)*',
        jpegThumbnail
      }, { quoted: msg })
    } catch (err) {
      console.error('[fake-chat] Erro ao gerar o print:', err?.message || err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras borraram o print... Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}

Object.assign(module.exports, {
  gerarImagem,
  parsearLinha,
  parsearConversa,
  MAX_MENSAGENS
})
