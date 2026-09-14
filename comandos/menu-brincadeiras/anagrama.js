// ============================================
// 🔠 ANAGRAMA — Descubra a palavra (lista fixa do projeto)
// ============================================
// Opção A (decidida com o dono): SEM comandos novos globais — tudo pelo
// /anagrama, evitando conflito com o /letra (letras de música):
//
//   /anagrama                   → inicia um jogo (ou mostra o jogo ativo)
//   /anagrama <categoria>       → inicia com categoria (ex: /anagrama animais)
//   /anagrama <letra>           → com jogo ativo, tenta uma LETRA
//   /anagrama palpite <palavra> → tenta a palavra completa
//   /anagrama desistir          → encerra revelando a resposta
//
// Regras:
//   - A palavra vem de dados/palavras-anagrama.js (~500 palavras, array
//     { palavra, categoria } — reaproveitado futuramente pelo /gartic);
//   - No início é revelada uma LETRA DE BÔNUS (todas as ocorrências dela);
//   - Chutar letra certa revela TODAS as ocorrências; letra repetida não
//     penaliza; letra errada conta como erro;
//   - 6 erros encerram o jogo mostrando a resposta;
//   - Palpite certo encerra e anuncia o vencedor (com mention);
//   - 🔒 UM jogo ativo por vez por grupo (Map por JID).
// ============================================

const { CATEGORIAS, sortearPalavra, normalizar } = require('../../dados/palavras-anagrama')
// 🎮 Registro COMPARTILHADO de jogos por grupo: bloqueio cruzado entre
// /velha, /anagrama e /gartic (um jogo ativo por vez por grupo).
const { TIPOS, rotuloDoTipo, registrarJogo, removerJogo, jogoDeOutroTipo } = require('../../dados/jogos-ativos')

const MAX_ERROS = 6

// 🔒 Um jogo por grupo: jid → { palavra, categoria, reveladas, chutesErrados }
const jogos = new Map()

// ─── 🎲 Cria um jogo novo (revela a letra de bônus) ───
function criarJogo (palavraObj, autor) {
  const letras = [...new Set(palavraObj.palavra.split(''))]
  const bonus = letras[Math.floor(Math.random() * letras.length)]
  return {
    palavra: palavraObj.palavra,
    categoria: palavraObj.categoria,
    reveladas: new Set([bonus]),
    chutesErrados: new Set(),
    autor
  }
}

// ─── 📟 Monta o tabuleiro: "_ A _ A T O" ───
function montarTabuleiro (palavra, reveladas) {
  return palavra.split('').map(l => (reveladas.has(l) ? l : '_')).join(' ')
}

// ─── ✉️ Estado do jogo em texto ───
function textoJogo (jogo, titulo) {
  const erros = [...jogo.chutesErrados].join(', ') || '—'
  return `${titulo}\n\n` +
    `🔠 ${montarTabuleiro(jogo.palavra, jogo.reveladas)}\n\n` +
    `📂 Categoria: *${jogo.categoria}*\n` +
    `❌ Erros (${jogo.chutesErrados.size}/${MAX_ERROS}): ${erros}\n\n` +
    '💡 `/anagrama <letra>` tenta uma letra • `/anagrama palpite <palavra>` arrisca tudo • `/anagrama desistir` desiste'
}

// ─── 🏁 Jogo completo? ───
function jogoCompleto (jogo) {
  return jogo.palavra.split('').every(l => jogo.reveladas.has(l))
}

// ─── 🔓 Encerra o jogo (Map próprio + registro COMPARTILHADO) ───
// Todas as formas de fim (acerto, 6 erros, palpite, desistir) passam aqui
// para o bloqueio cruzado do jogos-ativos.js nunca ficar com resíduo.
function encerrarJogo (jid) {
  jogos.delete(jid)
  removerJogo(jid, TIPOS.ANAGRAMA)
}

// 🪝 Ponto de injeção do sorteio para os testes offline
let sortear = sortearPalavra

// ─── 🎮 Inicia um jogo (ou mostra o atual) ───
async function iniciarOuMostrar (sock, jid, msg, autor, categoria) {
  if (jogos.has(jid)) {
    return await sock.sendMessage(jid, {
      text: textoJogo(jogos.get(jid), '🎮 *Já tem um anagrama rolando nesse grupo!*')
    }, { quoted: msg })
  }

  // 🔒 Bloqueio cruzado: outro jogo (velha/gartic) rolando neste grupo?
  const outroJogo = jogoDeOutroTipo(jid, TIPOS.ANAGRAMA)
  if (outroJogo) {
    return await sock.sendMessage(jid, {
      text: `🔒 Já tem um *${rotuloDoTipo(outroJogo.tipo)}* rolando neste grupo. ` +
        'Termine (ou cancele) ele antes de abrir um anagrama.'
    }, { quoted: msg })
  }

  const palavraObj = categoria ? sortear(categoria) : sortear()
  if (!palavraObj) {
    return await sock.sendMessage(jid, {
      text: `❌ Não conheço essa categoria...\n\n📂 Categorias válidas: ${CATEGORIAS.join(', ')}`
    }, { quoted: msg })
  }

  const jogo = criarJogo(palavraObj, autor)
  jogos.set(jid, jogo)
  // 🎮 Registro compartilhado (bloqueio cruzado entre os jogos do grupo)
  registrarJogo(jid, TIPOS.ANAGRAMA, { jogo })
  console.log(`[anagrama] 🎮 novo jogo em ${jid}: ${jogo.palavra} (${jogo.categoria})`)
  return await sock.sendMessage(jid, {
    text: textoJogo(jogo, '🎮 *ANAGRAMA DO LIMBO* — nova palavra sorteada!\n\n🌙 Uma letra de bônus já foi revelada. Boa sorte!')
  }, { quoted: msg })
}

// ─── 🔤 Chute de uma letra ───
async function chutarLetra (sock, jid, msg, autor, letraBruta) {
  const jogo = jogos.get(jid)
  if (!jogo) {
    return await sock.sendMessage(jid, { text: '❌ Não tem anagrama ativo nesse grupo. Comece com `/anagrama`!' }, { quoted: msg })
  }

  const letra = letraBruta.trim().toUpperCase()
  if (!/^[A-Z]$/.test(letra)) {
    return await sock.sendMessage(jid, { text: '❌ Chute UMA letra por vez (de A a Z). Ex.: `/anagrama A`' }, { quoted: msg })
  }

  // Letra repetida: avisa, sem penalizar
  if (jogo.reveladas.has(letra) || jogo.chutesErrados.has(letra)) {
    return await sock.sendMessage(jid, {
      text: `🤔 A letra *${letra}* já foi tentada!\n\n` + textoJogo(jogo, '🎮')
    }, { quoted: msg })
  }

  if (jogo.palavra.includes(letra)) {
    // ✅ Acerto: revela TODAS as ocorrências
    jogo.reveladas.add(letra)
    if (jogoCompleto(jogo)) {
      encerrarJogo(jid)
      return await sock.sendMessage(jid, {
        text: `🎉 *PARABÉNS! O anagrama foi desvendado!* 🎉\n\n` +
          `👤 Vencedor: @${String(autor).split('@')[0]}\n` +
          `🔤 A palavra era: *${jogo.palavra}* (${jogo.categoria})\n\n` +
          '🌙 Digite `/anagrama` para jogar de novo!',
        mentions: [autor]
      }, { quoted: msg })
    }
    return await sock.sendMessage(jid, {
      text: `✅ A letra *${letra}* está na palavra!\n\n` + textoJogo(jogo, '🎮')
    }, { quoted: msg })
  }

  // ❌ Erro
  jogo.chutesErrados.add(letra)
  if (jogo.chutesErrados.size >= MAX_ERROS) {
    encerrarJogo(jid)
    return await sock.sendMessage(jid, {
      text: `💀 *Seis erros — o anagrama venceu dessa vez!*\n\n` +
        `🔤 A palavra era: *${jogo.palavra}* (${jogo.categoria})\n\n` +
        '🌙 Digite `/anagrama` para uma revanche!'
    }, { quoted: msg })
  }
  return await sock.sendMessage(jid, {
    text: `❌ A letra *${letra}* não está na palavra.\n\n` + textoJogo(jogo, '🎮')
  }, { quoted: msg })
}

// ─── 🎯 Palpite da palavra completa ───
async function palpitePalavra (sock, jid, msg, autor, palavraBruta) {
  const jogo = jogos.get(jid)
  if (!jogo) {
    return await sock.sendMessage(jid, { text: '❌ Não tem anagrama ativo nesse grupo. Comece com `/anagrama`!' }, { quoted: msg })
  }

  const palpite = normalizar(palavraBruta).toUpperCase().replace(/[^A-Z]/g, '')
  if (!palpite) {
    return await sock.sendMessage(jid, { text: '❌ Digite a palavra depois do palpite. Ex.: `/anagrama palpite SAPATO`' }, { quoted: msg })
  }

  if (palpite === jogo.palavra) {
    encerrarJogo(jid)
    return await sock.sendMessage(jid, {
      text: `🎯 *ACERTOU A PALAVRA COMPLETA!* 🎉\n\n` +
        `👤 Vencedor: @${String(autor).split('@')[0]}\n` +
        `🔤 A palavra era: *${jogo.palavra}* (${jogo.categoria})\n\n` +
        '🌙 Digite `/anagrama` para jogar de novo!',
      mentions: [autor]
    }, { quoted: msg })
  }

  // Palpite errado conta como tentativa errada
  jogo.chutesErrados.add(palpite)
  if (jogo.chutesErrados.size >= MAX_ERROS) {
    encerrarJogo(jid)
    return await sock.sendMessage(jid, {
      text: `💀 *Seis erros — o anagrama venceu dessa vez!*\n\n` +
        `🔤 A palavra era: *${jogo.palavra}* (${jogo.categoria})\n\n` +
        '🌙 Digite `/anagrama` para uma revanche!'
    }, { quoted: msg })
  }
  return await sock.sendMessage(jid, {
    text: `❌ *${palavraBruta.trim().toUpperCase()}* não é a palavra...\n\n` + textoJogo(jogo, '🎮')
  }, { quoted: msg })
}

// ─── 🏳️ Desistência (encerra revelando a resposta) ───
async function desistir (sock, jid, msg) {
  const jogo = jogos.get(jid)
  if (!jogo) {
    return await sock.sendMessage(jid, { text: '❌ Não tem anagrama ativo nesse grupo. Comece com `/anagrama`!' }, { quoted: msg })
  }
  encerrarJogo(jid)
  return await sock.sendMessage(jid, {
    text: `🏳️ Jogo encerrado. A palavra era: *${jogo.palavra}* (${jogo.categoria})\n\n🌙 Digite \`/anagrama\` para jogar de novo!`
  }, { quoted: msg })
}

// ---- EXPORTACAO PRINCIPAL (mesmo contrato do loader: nome + executar) ----
module.exports = {
  nome: 'anagrama',
  descricao: 'Jogo do anagrama: descubra a palavra secreta letra por letra (um jogo por grupo).',

  executar: async function (sock, jid, msg, texto) {
    try {
      const bruto = String(texto || '').replace(/^\/\S+\s*/, '').trim()
      const autor = msg.key?.participant || msg.key?.remoteJid

      // 1) Sem argumentos → inicia ou mostra o jogo ativo
      if (!bruto) {
        return await iniciarOuMostrar(sock, jid, msg, autor)
      }

      const brutoLower = normalizar(bruto)

      // 2) Desistir
      if (brutoLower === 'desistir') {
        return await desistir(sock, jid, msg)
      }

      // 3) Palpite da palavra completa
      if (brutoLower.startsWith('palpite ')) {
        return await palpitePalavra(sock, jid, msg, autor, bruto.slice(8))
      }

      // 4) Chute de UMA letra (com jogo ativo)
      if (/^[a-z]$/i.test(bruto)) {
        if (!jogos.has(jid)) {
          return await sock.sendMessage(jid, {
            text: '❌ Não tem anagrama ativo nesse grupo. Comece com `/anagrama` (ou `/anagrama <categoria>`)!'
          }, { quoted: msg })
        }
        return await chutarLetra(sock, jid, msg, autor, bruto)
      }

      // 5) Categoria → inicia jogo com ela (se não houver jogo ativo)
      const ehCategoria = CATEGORIAS.some(c => normalizar(c) === brutoLower)
      if (ehCategoria) {
        return await iniciarOuMostrar(sock, jid, msg, autor, brutoLower)
      }

      // 6) Nada reconhecido → ajuda
      return await sock.sendMessage(jid, {
        text: '❌ Não entendi...\n\n' +
          '🎲 `/anagrama` — inicia um jogo\n' +
          '📂 `/anagrama <categoria>` — inicia com categoria\n' +
          '🔤 `/anagrama <letra>` — chuta uma letra (com jogo ativo)\n' +
          '🎯 `/anagrama palpite <palavra>` — arrisca a palavra\n' +
          '🏳️ `/anagrama desistir` — encerra revelando a resposta\n\n' +
          `📂 Categorias: ${CATEGORIAS.join(', ')}`
      }, { quoted: msg })
    } catch (err) {
      // 🛡️ Nada escapa para o socket
      console.error('[anagrama] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⛔ O anagrama deu um nó nas sombras... Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  // Extras internos para os testes offline (mesmo padrão do pinterest)
  jogos,
  criarJogo,
  montarTabuleiro,
  MAX_ERROS,
  _injetarSorteio: (fn) => { sortear = fn || sortearPalavra }
}
