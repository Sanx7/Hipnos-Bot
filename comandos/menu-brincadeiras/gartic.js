// ============================================================
// 🎨 GARTIC — Adivinhe a palavra pela imagem (Pixabay)
// ============================================================
//   /gartic                → inicia uma rodada (ou mostra a rodada ativa)
//   /gartic <categoria>    → inicia filtrando a palavra pela categoria
//   /gartic desistir       → encerra revelando a resposta
//
// COMO FUNCIONA
//   - A palavra-resposta vem de dados/palavras-anagrama.js — a MESMA lista
//     já usada pelo /anagrama (nada de lista duplicada);
//   - Busca uma foto na Pixabay (image_type=photo & safesearch=true) e
//     escolhe um resultado ALEATÓRIO entre os retornados (não é sempre a
//     primeira foto: varia mesmo quando a palavra se repete);
//   - Baixa a webformatURL com axios (buffer) e envia como `image`. A
//     legenda NUNCA revela a resposta (mostra só a categoria como dica);
//   - 🖼️ jpegThumbnail SEMPRE gerado pelo ffmpeg em PROCESSO FILHO (helper
//     central gerarJpegThumbnail do webp-animado) — REGRA DE OURO do
//     projeto: enviar `image` sem jpegThumbnail faz a Baileys gerar a
//     miniatura com sharp/libvips IN-PROCESS e derrubar o processo inteiro
//     (GLib-GObject-CRITICAL), sem chance de try/catch;
//   - Os palpites são TEXTO LIVRE no grupo: o bot.js entrega as mensagens
//     sem "/" para dados/jogos-ativos.js, que chama o ouvinte deste arquivo;
//   - Quem acerta primeiro vence (mention + fim da rodada);
//   - ⏳ 3 minutos sem acerto → revela a resposta e encerra sozinho;
//   - 🔒 Um jogo ativo por vez por grupo (registro COMPARTILHADO com o
//     /velha e o /anagrama — bloqueio cruzado de verdade).
//
// 🔑 VARIÁVEL DE AMBIENTE OBRIGATÓRIA: PIXABAY_API_KEY
//    Chave GRÁTIS em https://pixabay.com/api/docs/
//    → Local: arquivo .env na raiz   |   Render: Environment > Environment
//      Variables.
//    Sem ela o comando APENAS avisa — não existe chave fixa no código.
// ============================================================

const fs = require('fs')
const os = require('os')
const path = require('path')
const axios = require('axios')
const { CATEGORIAS, sortearPalavra, normalizar } = require('../../dados/palavras-anagrama')
const {
  TIPOS,
  rotuloDoTipo,
  registrarJogo,
  removerJogo,
  obterJogo,
  registrarOuvinteTexto
} = require('../../dados/jogos-ativos')
// 🖼️ Helper CENTRAL de thumbnail (ffmpeg em processo filho + fallback de
// JPEG 8x8 embutido — nunca deixa a Baileys usar sharp/libvips)
const { gerarJpegThumbnail } = require('../menu-fig/webp-animado')
const { apagarComRetry } = require('../menu-utilitario/audio-extrator')

const TIPO_JOGO = TIPOS.GARTIC

// ─── ⚙️ Configurações ───
const PIXABAY_ENDPOINT = 'https://pixabay.com/api/'
const TIMEOUT_MS = 15000                 // timeout de cada chamada HTTP
const TENTATIVAS_MAX = 3                 // palavras diferentes antes de desistir
const RESULTADOS_POR_BUSCA = 20          // fotos candidatas por busca
const LIMITE_IMAGEM_BYTES = 20 * 1024 * 1024
const DURACAO_PARTIDA_MS = 3 * 60 * 1000 // ⏳ 3 minutos por rodada
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

// ─── ✉️ Mensagens (pt-BR, temática onírica) ───
const AVISO_FORA_GRUPO =
  '🎨 *GARTIC DO SONHO*\n\n' +
  'As imagens só se revelam dentro de um grupo. Use `/gartic` num grupo e desafie os mortais.'

const AVISO_SEM_CHAVE =
  '⚠️ *PIXABAY_API_KEY não configurada!*\n\n' +
  'Sem essa chave o /gartic não consegue buscar as imagens do sonho.\n' +
  '🔑 Pegue uma chave GRÁTIS em https://pixabay.com/api/docs/ e defina `PIXABAY_API_KEY` no `.env` (local) ou nas variáveis de ambiente do Render.'

const AVISO_ERRO_BUSCA =
  '❌ A Pixabay não devolveu nenhuma imagem depois de ' + TENTATIVAS_MAX + ' tentativas...\n\n' +
  'Pode ser instabilidade da API ou falta de resultados para as palavras sorteadas. Tente `/gartic` de novo em instantes. 🌙'

const AVISO_SEM_JOGO =
  '❌ Não tem nenhuma rodada de gartic ativa nesse grupo. Comece com `/gartic`!'

const AVISO_ERRO =
  '⛔ As sombras embaçaram a imagem... Tente novamente em instantes.'

// ─── 🪝 Pontos de injeção dos testes offline (mesmo padrão do /pinterest) ───
let sortear = sortearPalavra
let buscarFotos = buscarFotosPixabay
let baixarFoto = baixarBuffer
let duracaoPartidaMs = DURACAO_PARTIDA_MS

// ─── 🔑 Chave da Pixabay (SOMENTE do ambiente — nunca fixa no código) ───
function chavePixabay () {
  return String(process.env.PIXABAY_API_KEY || '').trim()
}

// ─── 🔎 Consulta a Pixabay e devolve as URLs candidatas ───
async function buscarFotosPixabay (palavra, chave) {
  const resposta = await axios.get(PIXABAY_ENDPOINT, {
    params: {
      key: chave,
      q: palavra,
      image_type: 'photo',
      safesearch: 'true',
      per_page: RESULTADOS_POR_BUSCA,
      lang: 'pt'
    },
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT }
  })

  const hits = Array.isArray(resposta?.data?.hits) ? resposta.data.hits : []
  return hits
    .map((hit) => hit?.webformatURL || hit?.largeImageURL || hit?.previewURL || '')
    .filter(Boolean)
}

// ─── ⬇️ Baixa a imagem como Buffer ───
async function baixarBuffer (url) {
  const resposta = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: TIMEOUT_MS,
    maxContentLength: LIMITE_IMAGEM_BYTES,
    headers: { 'User-Agent': USER_AGENT }
  })
  return Buffer.from(resposta.data)
}

// ─── 🎲 Sorteia palavra + foto, tentando até TENTATIVAS_MAX palavras ───
// Se a Pixabay não devolver nada para a palavra sorteada, descartamos ela e
// sorteamos outra (até 3 tentativas antes de avisar erro ao usuário).
async function sortearPalavraComFoto (chave, categoria) {
  const usadas = new Set()
  let tentativas = 0
  let sorteios = 0
  const tetoDeSorteios = TENTATIVAS_MAX * 10 // trava anti-loop infinito

  while (tentativas < TENTATIVAS_MAX && sorteios < tetoDeSorteios) {
    sorteios++
    const alvo = categoria ? sortear(categoria) : sortear()
    if (!alvo || !alvo.palavra) break
    if (usadas.has(alvo.palavra)) continue
    usadas.add(alvo.palavra)

    tentativas++
    const fotos = await buscarFotos(alvo.palavra, chave)
    if (!Array.isArray(fotos) || fotos.length === 0) {
      console.log(`[gartic] 🔎 sem foto para "${alvo.palavra}" (tentativa ${tentativas}/${TENTATIVAS_MAX})`)
      continue
    }

    // 🎯 Resultado ALEATÓRIO entre os retornados (não é sempre a 1ª foto)
    const url = fotos[Math.floor(Math.random() * fotos.length)]
    return { alvo, url }
  }

  return null
}

// ─── ✍️ Legenda da rodada (NUNCA revela a resposta) ───
function montarLegenda (alvo, minutos) {
  return '🎨 *GARTIC DO SONHO* 🎨\n\n' +
    'Que palavra essa imagem representa? Escreva a resposta aqui no grupo!\n\n' +
    `📂 Dica: categoria *${alvo.categoria}*\n` +
    `⏳ ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} para alguém acertar.\n\n` +
    '🏳️ Desistir: `/gartic desistir`'
}

// ─── 🖼️ Envia a foto SEMPRE com jpegThumbnail do ffmpeg (regra de ouro) ───
async function enviarFoto (sock, jid, msg, buffer, alvo, minutos) {
  const idUnico = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const caminhoTemp = path.join(os.tmpdir(), `gartic_${idUnico}.jpg`)
  let caminhoThumb = null
  try {
    fs.writeFileSync(caminhoTemp, buffer)
    const thumb = await gerarJpegThumbnail(caminhoTemp, os.tmpdir(), idUnico)
    caminhoThumb = thumb.caminho
    console.log(`[gartic] 🧯 jpegThumbnail pronto (fonte: ${thumb.fonte}, ${thumb.base64.length} chars base64)`)
    return await sock.sendMessage(jid, {
      image: buffer,
      caption: montarLegenda(alvo, minutos),
      jpegThumbnail: Buffer.from(thumb.base64, 'base64')
    }, { quoted: msg })
  } finally {
    await apagarComRetry(caminhoTemp)
    await apagarComRetry(caminhoThumb)
  }
}

// ─── 🧹 Encerra a rodada (registro compartilhado + timer) ───
function encerrarRodada (jid) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) return null
  if (jogo.dados?.timer) clearTimeout(jogo.dados.timer)
  removerJogo(jid, TIPO_JOGO)
  return jogo.dados
}

// ─── 🏁 Inicia uma rodada ───
async function iniciar (sock, jid, msg, autor, categoria) {
  if (!jid.endsWith('@g.us')) {
    return await sock.sendMessage(jid, { text: AVISO_FORA_GRUPO }, { quoted: msg })
  }

  const chave = chavePixabay()
  if (!chave) {
    return await sock.sendMessage(jid, { text: AVISO_SEM_CHAVE }, { quoted: msg })
  }

  // 🔒 Já existe jogo neste grupo?
  const ativo = obterJogo(jid)
  if (ativo && ativo.tipo === TIPO_JOGO) {
    const dados = ativo.dados || {}
    const restanteSeg = Math.max(0, Math.ceil(
      (Number(dados.inicio || 0) + Number(dados.duracaoMs || duracaoPartidaMs) - Date.now()) / 1000
    ))
    return await sock.sendMessage(jid, {
      text: '🎨 *JÁ TEM UM GARTIC ROLANDO NESTE GRUPO!*\n\n' +
        `📂 Dica: categoria *${dados.categoria}*\n` +
        `⏳ ~${restanteSeg}s restantes.\n\n` +
        '💡 Escreva a resposta aqui no grupo ou use `/gartic desistir`.'
    }, { quoted: msg })
  }
  if (ativo) {
    return await sock.sendMessage(jid, {
      text: `🔒 Já tem um *${rotuloDoTipo(ativo.tipo)}* rolando neste grupo. Termine (ou cancele) ele antes de abrir um gartic.`
    }, { quoted: msg })
  }

  // 🎲 Palavra + foto (até 3 tentativas)
  let sorteado = null
  try {
    sorteado = await sortearPalavraComFoto(chave, categoria)
  } catch (err) {
    console.error('[gartic] 💥 erro na busca da Pixabay:', err?.stack || err)
    return await sock.sendMessage(jid, { text: AVISO_ERRO_BUSCA }, { quoted: msg })
  }
  if (!sorteado) {
    return await sock.sendMessage(jid, { text: AVISO_ERRO_BUSCA }, { quoted: msg })
  }

  // ⬇️ Download da imagem
  let buffer = null
  try {
    buffer = await baixarFoto(sorteado.url)
  } catch (err) {
    console.error('[gartic] 💥 erro ao baixar a imagem:', err?.stack || err)
    return await sock.sendMessage(jid, { text: AVISO_ERRO_BUSCA }, { quoted: msg })
  }
  if (!buffer || !buffer.length) {
    return await sock.sendMessage(jid, { text: AVISO_ERRO_BUSCA }, { quoted: msg })
  }

  // 🔒 Registra a rodada ANTES de enviar a foto (palpite instantâneo já conta)
  const dados = {
    palavra: sorteado.alvo.palavra,
    categoria: sorteado.alvo.categoria,
    autor,
    inicio: Date.now(),
    duracaoMs: duracaoPartidaMs,
    timer: null,
    sock
  }
  const registro = registrarJogo(jid, TIPO_JOGO, dados)
  if (!registro.ok) {
    return await sock.sendMessage(jid, {
      text: `🔒 Já tem um *${rotuloDoTipo(registro.conflito?.tipo)}* rolando neste grupo.`
    }, { quoted: msg })
  }

  dados.timer = setTimeout(() => aoExpirar(jid), dados.duracaoMs)
  console.log(`[gartic] 🎨 nova rodada em ${jid}: ${dados.palavra} (${dados.categoria})`)

  const minutos = Math.round(dados.duracaoMs / 60000) || 1
  return await enviarFoto(sock, jid, msg, buffer, sorteado.alvo, minutos)
}

// ─── ⏳ Expirou: revela a resposta e encerra sozinho ───
function aoExpirar (jid) {
  try {
    const dados = encerrarRodada(jid)
    if (!dados || !dados.sock) return
    console.log(`[gartic] ⏳ rodada expirada em ${jid} (resposta: ${dados.palavra})`)
    dados.sock.sendMessage(jid, {
      text: '⌛ *TEMPO ESGOTADO!* Ninguém acertou dessa vez...\n\n' +
        `🔤 A palavra era: *${dados.palavra}* (${dados.categoria})\n\n` +
        '🌙 Digite `/gartic` para uma nova rodada!'
    }).catch(() => {})
  } catch (err) {
    console.error('[gartic] 💥 erro ao encerrar por tempo:', err?.stack || err)
  }
}

// ─── 💬 Ouvinte de TEXTO LIVRE: valida os palpites do grupo ───
// Registrado no dados/jogos-ativos.js e chamado pelo bot.js para toda
// mensagem que NÃO começa com "/". Retorna true quando consome a mensagem.
async function aoReceberPalpite (sock, jid, msg, texto, dados) {
  const tentativa = String(normalizar(texto) || '').toUpperCase().replace(/[^A-Z]/g, '')
  if (!tentativa) return false

  const resposta = String(normalizar(dados?.palavra) || '').toUpperCase().replace(/[^A-Z]/g, '')
  if (!resposta || tentativa !== resposta) return false // errou: silêncio (sem spam)

  const autor = msg.key?.participant || msg.key?.remoteJid || ''
  const palavra = dados.palavra
  const categoria = dados.categoria
  encerrarRodada(jid)
  console.log(`[gartic] 🏆 acerto em ${jid}: ${palavra} por ${autor}`)

  await sock.sendMessage(jid, {
    text: `🏆 *ACERTOU!* @${String(autor).split('@')[0]} desvendou a imagem do sonho!\n\n` +
      `🔤 A palavra era: *${palavra}* (${categoria})\n\n` +
      '🌙 Digite `/gartic` para uma nova rodada!',
    mentions: [autor]
  }, { quoted: msg })
  return true
}

// ── 🏳️ Desistência ───
async function desistir (sock, jid, msg) {
  const dados = encerrarRodada(jid)
  if (!dados) {
    return await sock.sendMessage(jid, { text: AVISO_SEM_JOGO }, { quoted: msg })
  }
  return await sock.sendMessage(jid, {
    text: `🏳️ Rodada encerrada. A palavra era: *${dados.palavra}* (${dados.categoria})\n\n` +
      '🌙 Digite `/gartic` para jogar de novo!'
  }, { quoted: msg })
}

// 💬 O ouvinte de texto livre é registrado UMA vez, no carregamento do módulo
registrarOuvinteTexto(TIPO_JOGO, aoReceberPalpite)

// ---- EXPORTAÇÃO PRINCIPAL (mesmo contrato do loader: nome + executar) ----
module.exports = {
  nome: 'gartic',
  descricao: 'Gartic: adivinhe a palavra pela imagem (Pixabay) — um jogo por grupo, 3 minutos por rodada.',

  executar: async function (sock, jid, msg, texto) {
    try {
      const resto = String(texto || '').replace(/^\/\S+\s*/, '').trim()
      const normalizado = normalizar(resto)

      if (normalizado === 'desistir' || normalizado === 'cancelar') {
        return await desistir(sock, jid, msg)
      }

      // Categoria opcional (as MESMAS categorias do /anagrama)
      const categoria = CATEGORIAS.find((c) => normalizar(c) === normalizado) || null
      const autor = msg.key?.participant || msg.key?.remoteJid
      return await iniciar(sock, jid, msg, autor, categoria)
    } catch (err) {
      // 🛡️ Nada escapa para o socket
      console.error('[gartic] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, { text: AVISO_ERRO }, { quoted: msg }).catch(() => {})
    }
  },

  // Extras internos usados pelos testes offline (mesmo padrão do /pinterest)
  TIPO_JOGO,
  montarLegenda,
  aoReceberPalpite,
  aoExpirar,
  _injetarSorteio: (fn) => { sortear = fn || sortearPalavra },
  _injetarBuscaFotos: (fn) => { buscarFotos = fn || buscarFotosPixabay },
  _injetarDownload: (fn) => { baixarFoto = fn || baixarBuffer },
  _definirDuracao: (ms) => { duracaoPartidaMs = Number(ms) > 0 ? Number(ms) : DURACAO_PARTIDA_MS }
}
