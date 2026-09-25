// ============================================
// 🎭 VERDADE OU CONSEQUÊNCIA — sorteio único (uso LIVRE)
// ============================================
// O clássico "verdade ou consequência" de grupo, em UM comando só.
//
// Uso:
//   /verdadeouconsequencia              → sorteia verdade OU desafio
//                                         pra QUEM MANDOU o comando;
//   /verdadeouconsequencia @pessoa      → sorteia pra pessoa MARCADA;
//   /verdadeouconsequencia verdade      → FORÇA a categoria "verdade";
//   /verdadeouconsequencia desafio      → FORÇA a categoria "desafio".
//   (a categoria pode vir antes ou depois da menção: "verdade @pessoa" também
//    funciona).
//
// 🚫 SEM ESTADO / SEM MONGO — diferente do /gartic, /anagrama e /velha, aqui
//    não existe rodada em andamento: cada chamada é um sorteio único e
//    encerrado. Por isso NÃO usa coleção no Mongo nem bloqueio via
//    dados/jogos-ativos.js — o grupo não fica "ocupado" depois do sorteio.
//    Isso é uma escolha deliberada: o jogo é de 5 segundos, e travar o grupo
//    por causa de um sorteio de uma frase só seria um aborrecimento.
//
// 🔒 TRAVA DIÁRIA DETERMINÍSTICA (opcional, MAS implementada): o índice do
//    item sorteado vem de um hash FNV-1a de "numero|categoria|YYYY-MM-DD"
//    (o mesmo hash do /horoscopo, com o número da pessoa no meio da chave).
//    Efeito: a MESMA pessoa NÃO recebe a mesma pergunta no MESMO dia, mesmo
//    chamando o comando mil vezes — mas amanhã o sorteio gira sozinho. Como
//    aqui repetir não é tão ruim quanto no horóscopo, isso é só um mimo: se
//    alguém quiser repetir no mesmo dia, basta chamar com outra categoria
//    ("verdade" e "desafio" têm chaves diferentes).
//
// 🔒 Padrão do bot (mesmo do /elogio):
//   - SEM API externa, SEM key, SEM rede: só hash local + Math.random() p/ a
//     categoria quando ela não foi forçada;
//   - o texto e o mentions[] saem SEMPRE com o MESMO JID (se não, o "@" não
//     renderiza e vira número cru no chat);
//   - alvo vindo como LID (@lid): tenta os metadados do grupo (config.js —
//     acharParticipante, o mesmo caminho PROOF-LID do ehDonoDoBot) pra achar
//     o número REAL; se não der, usa o próprio LID (menção ainda funciona);
//   - try/catch com mensagem amigável em pt-BR — a conexão NÃO cai;
//   - logs "[vouc] ..." para diagnóstico no Render.
// ============================================

const { normalizeMessageContent } = require('@whiskeysockets/baileys')

// 👑 acharParticipante = helper compartilhado do projeto (compara id E
// phoneNumber, normalizados) — o mesmo usado pelo ehDonoDoBot/lid.js.
const { acharParticipante } = require('../../config')

// 📜 Banco de conteúdo (duas listas curadas — ver dados/perguntas-vouc.js)
const { VERDADES, DESAFIOS } = require('../../dados/perguntas-vouc')

// 🎭 As duas categorias + os textos que o grupo pode ver
const CATEGORIAS = {
  verdade: {
    chave: 'verdade',
    emoji: '🎭',
    titulo: 'VERDADE',
    instrucao: 'Responda com honestidade (ou paga o drink da rodada!):',
    lista: VERDADES
  },
  desafio: {
    chave: 'desafio',
    emoji: '💣',
    titulo: 'DESAFIO',
    instrucao: 'Cumbra agora mesmo, sem choro:',
    lista: DESAFIOS
  }
}

// 🔎 Normaliza texto: minúsculas e SEM acento (aceita "verdade", "Verdade",
//    "verdade!" etc. sem ficar exigindo grafia perfeita).
function normalizar (texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')    // remove os acentos combinantes (U+0300–U+036F)
    .toLowerCase()
    .trim()
}

// ─── 📅 Data local (YYYY-MM-DD) — a chave da trava diária ───
function chaveData (agora) {
  const d = agora || new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

// ─── 🔒 Hash determinístico (FNV-1a, o MESMO do /horoscopo) ───
// "numero|categoria|data" → uint32. Mesma chave = MESMO índice, sempre.
function indiceDiario (numero, categoria, data) {
  const chave = `${numero || 'anonimo'}|${categoria}|${data}`
  let hash = 2166136261
  for (let i = 0; i < chave.length; i++) {
    hash ^= chave.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

// ─── 🎯 Escolhe a categoria pedida no texto ("verdade"/"desafio") ───
// Devolve 'verdade' | 'desafio' | null (não forçou nada → sorteia 50/50).
function categoriaPedida (texto) {
  const termo = normalizar(String(texto || '').replace(/^\/\S+\s*/, ''))
  if (!termo) return null
  if (termo.includes('desafio') || termo.includes('consequencia')) return 'desafio'
  if (termo.includes('verdade')) return 'verdade'
  return null
}

// ─── 🎲 Sorteia a categoria quando o usuário NÃO forçou ───
// (aí sim é aleatório de verdade: a trava diária vale por categoria)
let sorteador = () => (Math.random() < 0.5 ? 'verdade' : 'desafio')

// ─── 🎴 Sorteia o item: categoria pedida (ou sorteada) + trava diária ───
// Devolve { categoria, titulo, emoji, instrucao, pergunta, indice, numero, data }.
function sortear (opcoes) {
  const {
    numero = 'anonimo',
    forcar = null,
    data = null,
    agora = null
  } = opcoes || {}

  const chave = forcar && CATEGORIAS[forcar] ? forcar : sorteador()
  const cat = CATEGORIAS[chave]
  const dia = data || chaveData(agora)
  const indice = indiceDiario(numero, chave, dia) % cat.lista.length

  return {
    categoria: chave,
    titulo: cat.titulo,
    emoji: cat.emoji,
    instrucao: cat.instrucao,
    pergunta: cat.lista[indice],
    indice,
    numero,
    data: dia
  }
}

// 🪪 Normaliza um JID: tira o sufixo de dispositivo (:N) e MANTÉM o domínio
// original — nunca converte @lid em @s.whatsapp.net (número falso), mesma regra
// do /elogio, /casal e /aleatorios.
function normalizarJid (id) {
  const bruto = String(id || '')
  const [usuario, servidor] = bruto.split('@')
  if (!usuario || !servidor) return ''
  return `${usuario.split(':')[0]}@${servidor}`
}

// 👉 Primeiro JID @mencionado na mensagem (normalizado) ou null.
// O contextInfo é procurado no extendedTextMessage e, se não houver, em
// QUALQUER chave do conteúdo (funciona com legenda de imagem/sticker).
function alvoMencionado (msg) {
  const conteudo = normalizeMessageContent(msg?.message) || {}

  let contexto = conteudo.extendedTextMessage?.contextInfo || null
  if (!contexto) {
    for (const valor of Object.values(conteudo)) {
      if (valor && typeof valor === 'object' && valor.contextInfo) {
        contexto = valor.contextInfo
        break
      }
    }
  }

  const bruto = contexto?.mentionedJid?.[0] || null
  return bruto ? normalizarJid(bruto) : null
}

// 🔎 JID que RENDERIZA a menção: números reais passam direto; LIDs são
// resolvidos p/ o número real via metadados do grupo (quando possível).
function jidMencionavel (participante) {
  const bruto = participante?.phoneNumber || participante?.id || ''
  return normalizarJid(bruto)
}

async function resolverMencao (sock, jid, alvoBruto) {
  const alvo = normalizarJid(alvoBruto)
  if (!alvo) return ''
  // Já é número real → renderiza direto, sem tocar na rede
  if (!alvo.endsWith('@lid')) return alvo

  // É LID → tenta os metadados do grupo (best-effort: falhou, segue com o LID)
  try {
    if (!String(jid).endsWith('@g.us')) return alvo
    const metadados = await sock.groupMetadata(jid)
    const participante = acharParticipante(metadados?.participants || [], alvo)
    return jidMencionavel(participante) || alvo
  } catch (err) {
    console.error('[vouc] ⚠️ falha ao ler os metadados do grupo (seguindo com o LID):', err?.message || err)
    return alvo
  }
}

// 📝 Monta o texto da resposta (menção + cartão da pergunta)
function montarMensagem (sorteado, digitosAlvo) {
  return `${sorteado.emoji} @${digitosAlvo}, *${sorteado.titulo}*\n\n${sorteado.instrucao}\n\n"${sorteado.pergunta}"`
}


// ============================================
// 🎯 /verdadeouconsequencia — executor
// ============================================
module.exports = {
  nome: 'verdadeouconsequencia',
  aliases: ['vouc', 'verdadeconsequencia', 'verdadeouconseq'],
  descricao: 'Sorteia uma verdade ou um desafio (pode forçar a categoria).',
  categoria: 'brincadeiras',

  async executar (sock, jid, msg, texto) {
    try {
      // 1) 👤 Autor da mensagem (em grupo é o participant; no privado, o chat).
      // ⚠️ Sem menção em GRUPO não dá p/ sortear pra "quem mandou" se o WhatsApp
      // não informou o participant — e usar o JID do grupo (@g.us) faria o
      // sorteio cair no grupo inteiro, com menção que não renderiza. Nesses
      // casos, avisamos (o participant sempre vem em mensagens de grupo).
      const ehGrupo = String(jid).endsWith('@g.us')
      const autorBruto = ehGrupo ? (msg?.key?.participant || '') : (msg?.key?.participant || jid || '')
      const autor = normalizarJid(autorBruto)

      // 2) 🎯 Alvo: a 1ª menção (@pessoa) ou, sem menção, quem mandou
      const mencionado = alvoMencionado(msg)
      const alvoBruto = mencionado || autor

      if (!alvoBruto) {
        return await sock.sendMessage(jid, {
          text: '🎭 *Não consegui identificar pra quem é a rodada...*\n\nMarque alguém com @ ou use o comando direto para o sorteio cair em você.'
        }, { quoted: msg })
      }

      // 3) 🔎 JID que renderiza a menção (resolve LID → número real)
      const alvo = await resolverMencao(sock, jid, alvoBruto)
      const digitos = String(alvo).split('@')[0].split(':')[0]

      // 4) 🎴 Sorteia (respeitando a categoria forçada no texto, se houver)
      const forcar = categoriaPedida(texto)
      const sorteado = sortear({ numero: digitos, forcar })

      console.log(`[vouc] 🎭 ${sorteado.categoria} p/ ${digitos}${mencionado ? '' : ' (autor — sem menção)'} · #${sorteado.indice} · ${sorteado.data}`)

      // 5) ✉️ Envia citando a mensagem; a menção usa o MESMO JID do texto,
      //    senão o WhatsApp não renderiza o nome e vira número cru.
      return await sock.sendMessage(jid, {
        text: montarMensagem(sorteado, digitos),
        mentions: [alvo]
      }, { quoted: msg })
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa para o socket
      console.error('[vouc] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      return await sock.sendMessage(jid, {
        text: '🎭 *As sombras engoliram o sorteio...*\n\nNão consegui sortear agora. Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  // 🔬 Ganchos de teste offline (mesmo padrão do /elogio)
  _injetarSorteador (fn) {
    sorteador = fn
  },
  _restaurarSorteador () {
    sorteador = () => (Math.random() < 0.5 ? 'verdade' : 'desafio')
  },
  __teste: {
    normalizar,
    chaveData,
    indiceDiario,
    categoriaPedida,
    normalizarJid,
    alvoMencionado,
    resolverMencao,
    montarMensagem,
    sortear,
    CATEGORIAS
  }
}
