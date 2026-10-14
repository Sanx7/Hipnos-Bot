// Gartic: catalogo proprio MongoDB + Cloudinary; regras do jogo preservadas.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { CATEGORIAS, normalizar } = require('../../dados/palavras-anagrama')
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

const catalogo = require('../../gartic-catalogo')
const prefixo = require('../../prefixo')
const estadoBot = require('../../estado-bot')
const conexao = require('../../dados/socket-seguro')
const TIPO_JOGO = TIPOS.GARTIC

// ─── ⚙️ Configurações ───
const TENTATIVAS_MAX = 3
const DURACAO_PARTIDA_MS = 3 * 60 * 1000 // ⏳ 3 minutos por rodada
// ─── ✉️ Mensagens (pt-BR, temática onírica) ───
const AVISO_FORA_GRUPO =
  '🎨 *GARTIC DO SONHO*\n\n' +
  'As imagens só se revelam dentro de um grupo. Use `/gartic` num grupo e desafie os mortais.'

const AVISO_VAZIO = 'O catálogo do Gartic está vazio para essa categoria. O dono pode cadastrar imagens com /gartic-add.'
const AVISO_ERRO_BUSCA = 'Não consegui obter uma imagem do catálogo. Tente novamente em instantes.'

const AVISO_SEM_JOGO =
  '❌ Não tem nenhuma rodada de gartic ativa nesse grupo. Comece com `/gartic`!'

const AVISO_ERRO =
  '⛔ As sombras embaçaram a imagem... Tente novamente em instantes.'

// ─── 🪝 Pontos de injeção dos testes offline (mesmo padrão do /pinterest) ───
let selecionar = (categoria, excluidas) => catalogo.sortear(categoria, excluidas)
let baixarFoto = doc => catalogo.baixar(doc)
let duracaoPartidaMs = DURACAO_PARTIDA_MS
const preparacoes = new Set()
async function sortearPalavraComFoto(categoria) {
  const usadas = []
  for (let tentativa = 0; tentativa < TENTATIVAS_MAX; tentativa++) {
    const doc = await selecionar(categoria, usadas)
    if (!doc) {
      if (!usadas.length) return null
      throw new Error('Imagens indisponiveis')
    }
    usadas.push(doc._id)
    try {
      const buffer = await baixarFoto(doc)
      if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Imagem vazia')
      return { alvo: { palavra: doc.palavra, categoria: doc.categoria }, buffer }
    } catch (_) { console.warn('[gartic]', { evento: 'imagem_indisponivel' }) }
  }
  throw new Error('Imagens indisponiveis')
}

// ─── ✍️ Legenda da rodada (NUNCA revela a resposta) ───
function montarLegenda (alvo, minutos) {
  return '🎨 *GARTIC DO SONHO* 🎨\n\n' +
    'Que palavra essa imagem representa? Escreva a resposta aqui no grupo!\n\n' +
    `📂 Dica: categoria *${alvo.categoria}*\n` +
    `⏳ ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} para alguém acertar.\n\n` +
    `🏳️ Desistir: \`${prefixo.prefixoSincrono()}gartic desistir\``
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
    return await sock.sendMessage(jid, { text: AVISO_FORA_GRUPO.replace(/\/gartic/g, prefixo.prefixoSincrono() + 'gartic') }, { quoted: msg })
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
        `💡 Escreva a resposta aqui no grupo ou use \`${prefixo.prefixoSincrono()}gartic desistir\`.`
    }, { quoted: msg })
  }
  if (ativo) {
    return await sock.sendMessage(jid, {
      text: `🔒 Já tem um *${rotuloDoTipo(ativo.tipo)}* rolando neste grupo. Termine (ou cancele) ele antes de abrir um gartic.`
    }, { quoted: msg })
  }

  let sorteado
  try { sorteado = await sortearPalavraComFoto(categoria) }
  catch (_) {
    console.warn('[gartic]', { evento: 'catalogo_indisponivel' })
    return await sock.sendMessage(jid, { text: AVISO_ERRO_BUSCA }, { quoted: msg })
  }
  if (!sorteado) return await sock.sendMessage(jid, { text: AVISO_VAZIO.replace(/\/gartic/g, prefixo.prefixoSincrono() + 'gartic') }, { quoted: msg })
  const buffer = sorteado.buffer
  // Não publicar uma nova rodada após perder conexão/permissão durante o download.
  if (!conexao.disponivel(sock) || !await estadoBot.permitirMensagem(sock, jid, autor)) return

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
  dados.timer.unref?.()
  const minutos = Math.round(dados.duracaoMs / 60000) || 1
  try { return await enviarFoto(sock, jid, msg, buffer, sorteado.alvo, minutos) }
  catch (e) { if (obterJogo(jid)?.dados === dados) encerrarRodada(jid); throw e }
}

// ─── ⏳ Expirou: revela a resposta e encerra sozinho ───
function aoExpirar (jid) {
  try {
    const dados = encerrarRodada(jid)
    if (!dados || !dados.sock) return
    dados.sock.sendMessage(jid, {
      text: '⌛ *TEMPO ESGOTADO!* Ninguém acertou dessa vez...\n\n' +
        `🔤 A palavra era: *${dados.palavra}* (${dados.categoria})\n\n` +
        `🌙 Digite \`${prefixo.prefixoSincrono()}gartic\` para uma nova rodada!`
    }).catch(() => {})
  } catch (err) {
    console.warn('[gartic]', { evento: 'operacao_falhou' })
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
  await sock.sendMessage(jid, {
    text: `🏆 *ACERTOU!* @${String(autor).split('@')[0]} desvendou a imagem do sonho!\n\n` +
      `🔤 A palavra era: *${palavra}* (${categoria})\n\n` +
      `🌙 Digite \`${prefixo.prefixoSincrono()}gartic\` para uma nova rodada!`,
    mentions: [autor]
  }, { quoted: msg })
  return true
}

// ── 🏳️ Desistência ───
async function desistir (sock, jid, msg) {
  const dados = encerrarRodada(jid)
  if (!dados) {
    return await sock.sendMessage(jid, { text: AVISO_SEM_JOGO.replace(/\/gartic/g, prefixo.prefixoSincrono() + 'gartic') }, { quoted: msg })
  }
  return await sock.sendMessage(jid, {
    text: `🏳️ Rodada encerrada. A palavra era: *${dados.palavra}* (${dados.categoria})\n\n` +
      `🌙 Digite \`${prefixo.prefixoSincrono()}gartic\` para jogar de novo!`
  }, { quoted: msg })
}

// 💬 O ouvinte de texto livre é registrado UMA vez, no carregamento do módulo
registrarOuvinteTexto(TIPO_JOGO, aoReceberPalpite)

// ---- EXPORTAÇÃO PRINCIPAL (mesmo contrato do loader: nome + executar) ----
module.exports = {
  nome: 'gartic',
  descricao: 'Gartic: adivinhe a palavra pelo catálogo próprio — um jogo por grupo, 3 minutos por rodada.',

  executar: async function (sock, jid, msg, texto) {
    try {
      const sender = msg.key?.participant || jid
      if (!conexao.disponivel(sock) || !await estadoBot.permitirMensagem(sock, jid, sender)) return
      const resto = prefixo.removerPrefixo(String(texto || '')).replace(/^\S+\s*/, '').trim()
      const normalizado = normalizar(resto)

      if (normalizado === 'desistir' || normalizado === 'cancelar') {
        return await desistir(sock, jid, msg)
      }

      // Categoria opcional (as MESMAS categorias do /anagrama)
      const categoria = [...CATEGORIAS, 'catálogo'].find((c) => normalizar(c) === normalizado) || null
      const autor = msg.key?.participant || msg.key?.remoteJid
      if (preparacoes.has(jid)) return await sock.sendMessage(jid, { text: 'A imagem deste grupo já está sendo preparada. Aguarde.' }, { quoted: msg })
      preparacoes.add(jid)
      try { return await iniciar(sock, jid, msg, autor, categoria) }
      finally { preparacoes.delete(jid) }
    } catch (err) {
      // 🛡️ Nada escapa para o socket
      console.warn('[gartic]', { evento: 'operacao_falhou' })
      if (conexao.disponivel(sock)) await sock.sendMessage(jid, { text: AVISO_ERRO }, { quoted: msg }).catch(() => {})
    }
  },

  // Extras internos usados pelos testes offline (mesmo padrão do /pinterest)
  TIPO_JOGO,
  montarLegenda,
  aoReceberPalpite,
  aoExpirar,
  _injetarCatalogo: (fn) => { selecionar = fn || ((categoria, excluidas) => catalogo.sortear(categoria, excluidas)) },
  _injetarDownload: (fn) => { baixarFoto = fn || (doc => catalogo.baixar(doc)) },
  _definirDuracao: (ms) => { duracaoPartidaMs = Number(ms) > 0 ? Number(ms) : DURACAO_PARTIDA_MS }
}
