// ============================================
// 🪢 FORCA — Jogo da forca clássico no grupo
// ============================================
// Arquitetura: MESMO padrão de jogo do /gartic e do /quiz
//   - Estado em dados/jogos-ativos.js (bloqueio cruzado com os outros);
//   - Jogadas em TEXTO LIVRE via processarMensagemLivre + comandos /forca;
//   - Nada de Mongo: rodada em memória.
// Banco: dados/palavras-anagrama.js (MESMA lista do /anagrama e /gartic,
// ~500 palavras A-Z sem acento). Sem banco novo: o formato da forca pede
// exatamente isso (letras mascaráveis + categoria como dica).
// Regras: /forca [categoria] inicia; letra única revela ocorrências;
// palavra completa certa vence; 6 erros = derrota; /forca desistir sai.
// ============================================

const { CATEGORIAS, sortearPalavra, normalizar } = require('../../dados/palavras-anagrama')
const { TIPOS, rotuloDoTipo, registrarOuvinteTexto, obterJogo, registrarJogo, removerJogo } = require('../../dados/jogos-ativos')

const TIPO_JOGO = TIPOS.FORCA
const MAX_ERROS = 6

// ─── 🪢 Desenho ASCII: 7 estágios (0 a 6 erros) ───
const DESENHOS = [
  '```\n  +---+\n  |   |\n      |\n      |\n      |\n      |\n=========\n```',
  '```\n  +---+\n  |   |\n  O   |\n      |\n      |\n      |\n=========\n```',
  '```\n  +---+\n  |   |\n  O   |\n  |   |\n      |\n      |\n=========\n```',
  '```\n  +---+\n  |   |\n  O   |\n /|   |\n      |\n      |\n=========\n```',
  '```\n  +---+\n  |   |\n  O   |\n /|\\  |\n      |\n      |\n=========\n```',
  '```\n  +---+\n  |   |\n  O   |\n /|\\  |\n /    |\n      |\n=========\n```',
  '```\n  +---+\n  |   |\n  O   |\n /|\\  |\n / \\  |\n      |\n=========\n```'
]

const AVISO_FORA_GRUPO = '🌙 A forca é coisa de grupo! Chame os amigos em um grupo e rode `/forca` lá.'
const AVISO_SEM_JOGO = '❌ Não tem nenhuma forca rolando neste grupo. Comece com `/forca`!'

let sortear = sortearPalavra

function montarTabuleiro (palavra, reveladas) {
  return String(palavra || '').split('').map((l) => (reveladas.has(l) ? l : '_')).join(' ')
}

function desenhoForca (erros) {
  const n = Math.max(0, Math.min(MAX_ERROS, Number(erros) || 0))
  return DESENHOS[n]
}

function textoJogo (dados, titulo) {
  const erros = [...dados.erradas].join(', ') || '—'
  return `${titulo}\n\n` + `${desenhoForca(dados.erradas.size)}\n` + `🔠 ${montarTabuleiro(dados.palavra, dados.reveladas)}\n\n` + `📂 Categoria: *${dados.categoria}*\n` + `❌ Erros (${dados.erradas.size}/${MAX_ERROS}): ${erros}\n\n` + '💡 Chute uma *letra* ou a *palavra completa* direto no chat — ou use `/forca <letra>` • `/forca desistir` desiste'
}

function jogoCompleto (dados) {
  return String(dados.palavra || '').split('').every((l) => dados.reveladas.has(l))
}

function encerrarRodada (jid) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) return null
  removerJogo(jid, TIPO_JOGO)
  return jogo.dados || null
}
// ─── 🎮 Inicia uma rodada (ou mostra a ativa) ───
async function iniciar (sock, jid, msg, autor, categoria) {
  if (!String(jid || '').endsWith('@g.us')) {
    return await sock.sendMessage(jid, { text: AVISO_FORA_GRUPO }, { quoted: msg })
  }
  const atual = obterJogo(jid)
  if (atual) {
    if (atual.tipo === TIPO_JOGO) {
      return await sock.sendMessage(jid, { text: textoJogo(atual.dados, '🎮 *Já tem uma forca rolando nesse grupo!*') }, { quoted: msg })
    }
    return await sock.sendMessage(jid, { text: `🔒 Já tem um *${rotuloDoTipo(atual.tipo)}* rolando neste grupo. Termine (ou cancele) ele antes de abrir uma forca.` }, { quoted: msg })
  }
  const palavraObj = categoria ? sortear(categoria) : sortear()
  if (!palavraObj) {
    return await sock.sendMessage(jid, { text: `❌ Não conheço essa categoria...\n\n📂 Categorias válidas: ${CATEGORIAS.join(', ')}` }, { quoted: msg })
  }
  const dados = { palavra: palavraObj.palavra, categoria: palavraObj.categoria, reveladas: new Set(), erradas: new Set(), autor, inicio: Date.now() }
  const registro = registrarJogo(jid, TIPO_JOGO, dados)
  if (!registro.ok) {
    return await sock.sendMessage(jid, { text: `🔒 Já tem um *${rotuloDoTipo(registro.conflito?.tipo)}* rolando neste grupo. Termine (ou cancele) ele antes de abrir uma forca.` }, { quoted: msg })
  }
  console.log(`[forca] nova rodada em ${jid}: ${dados.palavra} (${dados.categoria})`)
  return await sock.sendMessage(jid, { text: textoJogo(dados, '🪢 *FORCA DO LIMBO* — nova palavra sorteada! Boa sorte!') }, { quoted: msg })
}
// ─── 🔤 Jogada de UMA letra (texto livre E /forca) ───
async function aplicarLetra (sock, jid, msg, autor, letraBruta) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) {
    await sock.sendMessage(jid, { text: AVISO_SEM_JOGO }, { quoted: msg })
    return { fim: null, semJogo: true }
  }
  const dados = jogo.dados
  const letra = String(letraBruta || '').trim().toUpperCase()
  if (!/^[A-Z]$/.test(letra)) {
    await sock.sendMessage(jid, { text: '❌ Chute UMA letra por vez (de A a Z).' }, { quoted: msg })
    return { fim: null }
  }
  if (dados.reveladas.has(letra) || [...dados.erradas].some((e) => e === letra)) {
    await sock.sendMessage(jid, { text: `🤔 A letra *${letra}* já foi tentada!\n\n` + textoJogo(dados, '🪢') }, { quoted: msg })
    return { fim: null }
  }
  if (dados.palavra.includes(letra)) {
    dados.palavra.split('').forEach((l) => { if (l === letra) dados.reveladas.add(l) })
    if (jogoCompleto(dados)) {
      encerrarRodada(jid)
      await sock.sendMessage(jid, { text: `🎉 *A FORCA FOI VENCIDA!* 🎉\n\n👤 Vencedor: @${String(autor).split('@')[0]}\n🔤 A palavra era: *${dados.palavra}* (${dados.categoria})\n\n🌙 Digite \`/forca\` para jogar de novo!`, mentions: [autor] }, { quoted: msg })
      return { fim: 'vitoria' }
    }
    await sock.sendMessage(jid, { text: `✅ A letra *${letra}* está na palavra!\n\n` + textoJogo(dados, '🪢') }, { quoted: msg })
    return { fim: null }
  }
  dados.erradas.add(letra)
  if (dados.erradas.size >= MAX_ERROS) {
    encerrarRodada(jid)
    await sock.sendMessage(jid, { text: `${desenhoForca(MAX_ERROS)}\n💀 *A forca venceu dessa vez!*\n\n🔤 A palavra era: *${dados.palavra}* (${dados.categoria})\n\n🌙 Digite \`/forca\` para uma revanche!` }, { quoted: msg })
    return { fim: 'derrota' }
  }
  await sock.sendMessage(jid, { text: `❌ A letra *${letra}* não está na palavra.\n\n` + textoJogo(dados, '🪢') }, { quoted: msg })
  return { fim: null }
}
async function aplicarPalavra (sock, jid, msg, autor, palavraBruta) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) {
    await sock.sendMessage(jid, { text: AVISO_SEM_JOGO }, { quoted: msg })
    return { fim: null, semJogo: true }
  }
  const dados = jogo.dados
  const palpite = normalizar(palavraBruta).toUpperCase().replace(/[^A-Z]/g, '')
  if (!palpite) {
    await sock.sendMessage(jid, { text: '❌ Digite a palavra do seu chute. Ex.: `/forca SAPATO`' }, { quoted: msg })
    return { fim: null }
  }
  if (palpite === dados.palavra) {
    encerrarRodada(jid)
    await sock.sendMessage(jid, { text: `🎯 *ACERTOU A PALAVRA COMPLETA!* 🎉\n\n👤 Vencedor: @${String(autor).split('@')[0]}\n🔤 A palavra era: *${dados.palavra}* (${dados.categoria})\n\n🌙 Digite \`/forca\` para jogar de novo!`, mentions: [autor] }, { quoted: msg })
    return { fim: 'vitoria' }
  }
  dados.erradas.add(palpite)
  if (dados.erradas.size >= MAX_ERROS) {
    encerrarRodada(jid)
    await sock.sendMessage(jid, { text: `${desenhoForca(MAX_ERROS)}\n💀 *A forca venceu dessa vez!*\n\n🔤 A palavra era: *${dados.palavra}* (${dados.categoria})\n\n🌙 Digite \`/forca\` para uma revanche!` }, { quoted: msg })
    return { fim: 'derrota' }
  }
  await sock.sendMessage(jid, { text: `❌ *${palpite}* não é a palavra...\n\n` + textoJogo(dados, '🪢') }, { quoted: msg })
  return { fim: null }
}

// ─── 💬 Ouvinte de TEXTO LIVRE (gancho do bot.js) ───
async function aoReceberJogada (sock, jid, msg, texto) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) return false
  const tentativa = normalizar(texto).toUpperCase().replace(/[^A-Z]/g, '')
  if (!tentativa || !/^[A-Z]+$/.test(tentativa)) return false
  const autor = msg.key?.participant || msg.key?.remoteJid || ''
  if (tentativa.length === 1) {
    await aplicarLetra(sock, jid, msg, autor, tentativa)
    return true
  }
  await aplicarPalavra(sock, jid, msg, autor, tentativa)
  return true
}

async function desistir (sock, jid, msg) {
  const dados = encerrarRodada(jid)
  if (!dados) {
    return await sock.sendMessage(jid, { text: AVISO_SEM_JOGO }, { quoted: msg })
  }
  return await sock.sendMessage(jid, { text: `🏳️ Jogo encerrado. A palavra era: *${dados.palavra}* (${dados.categoria})\n\n🌙 Digite \`/forca\` para jogar de novo!` }, { quoted: msg })
}

registrarOuvinteTexto(TIPO_JOGO, aoReceberJogada)

module.exports = {
  nome: 'forca',
  descricao: 'Jogo da forca: descubra a palavra letra por letra antes que o boneco se complete (um jogo por grupo).',
  executar: async function (sock, jid, msg, texto) {
    try {
      const resto = String(texto || '').replace(/^\/\S+\s*/, '').trim()
      const autor = msg.key?.participant || msg.key?.remoteJid
      if (!resto) return await iniciar(sock, jid, msg, autor)
      const normalizado = normalizar(resto)
      if (normalizado === 'desistir' || normalizado === 'cancelar' || normalizado === 'parar') return await desistir(sock, jid, msg)
      if (/^[a-z]$/i.test(resto.trim())) return await aplicarLetra(sock, jid, msg, autor, resto)
      const ehCategoria = CATEGORIAS.some((c) => normalizar(c) === normalizado)
      if (ehCategoria && !obterJogo(jid)) return await iniciar(sock, jid, msg, autor, normalizado)
      const soLetras = normalizar(resto).toUpperCase().replace(/[^A-Z]/g, '')
      if (soLetras) return await aplicarPalavra(sock, jid, msg, autor, resto)
      return await sock.sendMessage(jid, { text: '❌ Não entendi...\n\n🎲 `/forca` — inicia um jogo\n📂 `/forca <categoria>` — inicia com categoria' }, { quoted: msg })
    } catch (err) {
      console.error('[forca] erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, { text: '⛔ A forca embaraçou nas sombras... Tente novamente em instantes.' }, { quoted: msg }).catch(() => {})
    }
  },
  TIPO_JOGO, MAX_ERROS, DESENHOS, montarTabuleiro, desenhoForca, textoJogo, jogoCompleto, aplicarLetra, aplicarPalavra, aoReceberJogada, encerrarRodada,
  _injetarSorteio: (fn) => { sortear = fn || sortearPalavra }
}
