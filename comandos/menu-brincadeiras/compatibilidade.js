// ============================================================
// 💞 COMPATIBILIDADE — quanto duas almas se entendem (lista fixa, sem API)
// ============================================================
// /compatibilidade @pessoa1 @pessoa2   (também: /match)
//
// Uso:
//   - duas menções: compara as duas pessoas;
//   - UMA menção: a segunda pessoa é quem chamou o comando;
//   - sem menção: compara quem chamou com quem responde o comando (reply).
//
// 🔒 TRAVA DIÁRIA (o mesmo truque do /horoscopo): o resultado é
// determinístico por CHAVE = os DOIS números ORDENADOS + a DATA local
// (hash FNV-1a → número de 0 a 100). Sem Math.random, sem Mongo:
//   · o MESMO par recebe a MESMA porcentagem o dia TODO;
//   · `@A @B` e `@B @A` dão EXATAMENTE o mesmo resultado (a chave ordena
//     os dois números antes);
//   · à meia-noite a chave muda e o veredito gira sozinho;
//   · o resultado é do PAR, não de quem perguntou — todo mundo no grupo
//     que perguntar o mesmo par vê a mesma resposta.
//
// Sem API/rede: nada de timeout, fallback ou rate limit. Frases por
// faixa (0-20, 21-40, 41-60, 61-79, 80-100) com 4 opções cada, tiradas
// pelo mesmo hash — assim o par não cai sempre na mesma frase.
//
// Padrão do bot:
//   - export { nome, aliases, descricao, executar } (contrato do loader);
//   - try/catch com aviso amigável + console.error do erro real;
//   - respostas sempre com { quoted: msg } e menção aos envolvidos.
// ============================================================

const { limparNumero } = require('../../config')

// ─── 💬 Frases por faixa de compatibilidade (temática Hipnos) ───
// `ate` = limite INCLUSIVO (a faixa é [de, ate]).
const FAIXAS = [
  {
    de: 0, ate: 20, rotulo: 'SEM FUTURO', emoji: '💔',
    frases: [
      'O verbo bater foi forte hoje: cada um no seu canto, sem ponte que os una.',
      'A sintonia veio em modoEconomia de energia — dá pra conviver, mas o silêncio pesa.',
      'Hoje os sonhos apontam em direções opostas: a distância é do sonho, não da música.',
      'Pouco em comum, muito em silêncio: talvez a conversa comece melhor amanhã.'
    ]
  },
  {
    de: 21, ate: 40, rotulo: 'DIFÍCIL MAS POSSÍVEL', emoji: '🌫️',
    frases: [
      'A sintonia existe, mas mora fundo: exige paciência para aflorar.',
      'Vocês se entendem por esforço, não por acaso — e isso tem seu valor.',
      'Duas sombras na mesma madrugada: afinidade rara, conversa difícil.',
      'Há fio de ligação, frouxo mas real — puxar com calma, sem forçar.'
    ]
  },
  {
    de: 41, ate: 60, rotulo: 'NO LIMIAR', emoji: '⚖️',
    frases: [
      'Está no ponto exato do limbo: dá pra ir bem, depende do dia e do humor.',
      'Uma moeda de dois lados, mas a mesma moeda — ninguém sai perdendo a troca.',
      'Afinidade mediana: suficiente para rir, às vezes para brigar.',
      'O destino empurrou vocês pro mesmo cômodo, sem dizer se é acaso ou combinado.'
    ]
  },
  {
    de: 61, ate: 79, rotulo: 'QUASE GÊMEOS', emoji: '💫',
    frases: [
      'Forte sintonia: vocês se entendem antes de terminar a frase.',
      'O oráculo do Limbo concordou: hoje a conversa flui como se sempre tivesse fluído.',
      'Almas irmãs de sonho — mesma trilha, caminhos diferentes.',
      'Afinidade que dá vontade de proteger um ao outro nos piores dias.'
    ]
  },
  {
    de: 80, ate: 100, rotulo: 'ALMAS GÊMEAS', emoji: '💞',
    frases: [
      'Sintonia máxima: os dois lados do Limbo acendem no mesmo instante.',
      'Vocês se completam — o que falta a um, o outro carrega sem perceber.',
      'Afinidade rara, daquelas que o Hipnos só vê uma vez por geração.',
      'Almas gêmeas: mesma porta, mesma frequência, mesmo destino compartilhado.'
    ]
  }
]

// ─── 📅 Data local (YYYY-MM-DD) — mesmo formato do /horoscopo ───
function chaveData (agora) {
  const d = agora || new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

// ─── 🔒 Hash FNV-1a (o MESMO do /horoscopo) ───
function hashFnv1a (texto) {
  const chave = String(texto || '')
  let hash = 2166136261
  for (let i = 0; i < chave.length; i++) {
    hash ^= chave.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

// ─── 🔑 Chave da rodada: par ORDENADO + data ───
// Ordenar os dois números é o que garante que @A @B == @B @A.
function chavePar (numeroA, numeroB, data) {
  const [menor, maior] = [String(numeroA), String(numeroB)].sort()
  return `${menor}|${maior}|${data}`
}

// ─── 📊 A faixa de um número de 0 a 100 ───
function faixaDe (porcentagem) {
  return FAIXAS.find((f) => porcentagem >= f.de && porcentagem <= f.ate) || FAIXAS[0]
}

// ─── 💞 Veredito do dia para um par ───
// Retorna { porcentagem, faixa, frase, data, chave } ou null se o par for inválido
// (mesma pessoa nos dois lados, ou número ausente).
function compatibilidadeDe (jidA, jidB, agora) {
  const a = limparNumero(jidA)
  const b = limparNumero(jidB)
  if (!a || !b || a === b) return null

  const data = chaveData(agora)
  const chave = chavePar(a, b, data)
  const hash = hashFnv1a(chave)

  // 0..100 a partir do hash (o módulo dá 0..2^32-1)
  const porcentagem = hash % 101
  const faixa = faixaDe(porcentagem)
  // A frase também sai do MESMO hash → o par não repete a mesma frase sempre
  const frase = faixa.frases[hash % faixa.frases.length]

  return { porcentagem, faixa, frase, data, chave, numeroA: a, numeroB: b }
}

// ─── 👥 Resolve as DUAS pessoas a comparar ───
// 2 menções → as duas; 1 menção → quem chamou + a mencionada;
// 0 menções → quem chamou + quem enviou a mensagem citada (reply).
function resolverPar (msg) {
  const contexto = msg?.message?.extendedTextMessage?.contextInfo
  const mencoes = Array.isArray(contexto?.mentionedJid) ? contexto.mentionedJid : []
  const eu = msg?.key?.participant || msg?.key?.remoteJid || ''

  if (mencoes.length >= 2) return { a: mencoes[0], b: mencoes[1], modo: 'duas' }
  if (mencoes.length === 1) return { a: eu, b: mencoes[0], modo: 'uma' }
  if (contexto?.participant) return { a: eu, b: contexto.participant, modo: 'reply' }
  return null
}

const AVISO_USO =
  '💞 *COMPATIBILIDADE — quanto duas almas se entendem*\n\n' +
  'Mencione a pessoa para comparar com você:\n' +
  '`/compatibilidade @fulano`\n\n' +
  'Para comparar DUAS pessoas:\n' +
  '`/compatibilidade @fulano @doutra`\n\n' +
  '🔒 O resultado é o do *par* e trava por dia: hoje e sempre hoje, vocês têm a mesma porcentagem (também: /match).'

// ─── 📤 Monta a mensagem do resultado ───
function montarMensagem (veredito, jidA, jidB) {
  const numero = (jid) => String(jid).split('@')[0]
  const dataLegivel = new Date().toLocaleDateString('pt-BR', {
    day: 'numeric', month: 'long', year: 'numeric'
  })
  return (
    `${veredito.faixa.emoji} *COMPATIBILIDADE* ${veredito.faixa.emoji}\n\n` +
    `💞 @${numero(jidA)}  +  @${numero(jidB)}\n\n` +
    `*${veredito.porcentagem}%* — *${veredito.faixa.rotulo}*\n` +
    `📊 ${'█'.repeat(Math.round(veredito.porcentagem / 5)).padEnd(20, '░')}\n\n` +
    `✨ ${veredito.frase}\n\n` +
    `📅 ${dataLegivel}\n` +
    '🔒 O veredito trava por dia: amanhã essa mesma dupla pode virar outra história.'
  )
}

// ---- EXPORTAÇÃO PRINCIPAL (mesmo contrato do loader) ----
module.exports = {
  nome: 'compatibilidade',
  aliases: ['match'],
  descricao: 'Calcula a compatibilidade entre duas pessoas (em %) — o resultado é do par e trava por dia.',

  executar: async function (sock, jid, msg) {
    try {
      const par = resolverPar(msg)

      // Sem menção e sem reply → instruções de uso
      if (!par) {
        return await sock.sendMessage(jid, { text: AVISO_USO }, { quoted: msg })
      }

      const veredito = compatibilidadeDe(par.a, par.b)

      // Mesma pessoa nos dois lados (ou número inválido)
      if (!veredito) {
        return await sock.sendMessage(jid, {
          text: '💔 *Duas pessoas distintas são necessárias...*\n\n' +
            'Mencione outra pessoa (não você mesmo) para o oráculo comparar.'
        }, { quoted: msg })
      }

      const mentions = [par.a, par.b].filter(Boolean)
      await sock.sendMessage(jid, {
        text: montarMensagem(veredito, par.a, par.b),
        mentions
      }, { quoted: msg })
    } catch (err) {
      // 🛡️ Nada escapa para o socket
      console.error('[compatibilidade] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⛔ O oráculo se perdeu nas névoas... Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  // Extras internos para os testes offline (mesmo padrão do /horoscopo)
  FAIXAS,
  hashFnv1a,
  chavePar,
  chaveData,
  faixaDe,
  compatibilidadeDe,
  resolverPar,
  montarMensagem,
  AVISO_USO
}