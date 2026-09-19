// ============================================
// ✨ ELOGIO — Elogio exagerado e bobo (uso LIVRE)
// ============================================
// O espelho oposto do /roast: em vez de alfinetar, enche a pessoa de
// elogios absurdamente exagerados — e o exagero é a piada.
//
// Uso:
//   /elogio            → elogia QUEM MANDOU o comando
//   /elogio @pessoa    → elogia a pessoa marcada
//
// Formato da resposta (exigido): ✨ @{mencionado}, {frase sorteada}.
//
// 🔒 Padrão do bot:
//   - SEM API externa, SEM key, SEM rede: só Math.random() na lista local;
//   - o texto e o mentions[] saem SEMPRE com o MESMO JID (se não, o "@" não
//     renderiza e vira número cru no chat);
//   - alvo vindo como LID (@lid): tenta os metadados do grupo (config.js —
//     acharParticipante, o mesmo caminho PROOF-LID do ehDonoDoBot) pra achar
//     o número REAL; se não der, usa o próprio LID (menção ainda funciona);
//   - try/catch com mensagem amigável em pt-BR — a conexão NÃO cai;
//   - logs "[elogio] ..." para diagnóstico no Render.
// ============================================

const { normalizeMessageContent } = require('@whiskeysockets/baileys')

// 👑 acharParticipante = helper compartilhado do projeto (compara id E
// phoneNumber, normalizados) — o mesmo usado pelo ehDonoDoBot/lid.js.
const { acharParticipante } = require('../../config')

// -------------------------------------------------------------------
// 📜 LISTA DE ELOGIOS (~35 frases de elogio exagerado/bobo).
// Sem ponto final próprio: o executor fecha a frase (ver formato).
// -------------------------------------------------------------------
const FRASES = [
  'você é tão radiante que as sombras pediram autógrafo',
  'seu carisma é tão forte que o limbo abriu uma exceção só pra você',
  'existem dois sóis neste grupo, e um deles é você',
  'sua energia é tão boa que até o Morfeu tirou uma soneca extra de tão em paz que ficou',
  'você é o motivo pelo qual o oráculo nunca responde "não" pra você',
  'sua inteligência é tão afiada que as sombras pedem dicas',
  'seu coração é tão grande que caberia o limbo inteiro com sobra',
  'você é tão especial que até este bot escreveu uma lista inteira de elogios só pra te marcar',
  'até as estrelas tiram folga pra te ver passar',
  'você tem o dom de deixar qualquer conversa três vezes mais interessante só de aparecer',
  'se gentileza fosse moeda, você já seria o banco central',
  'você é tipo Wi-Fi de madrugada: essencial, raro, e quando aparece tudo funciona',
  'você é a única pessoa capaz de fazer o silêncio parecer uma boa conversa',
  'sua risada devia ser patrimônio cultural deste grupo',
  'você é tão confiável que o destino te entregou as chaves e foi dormir',
  'sua paciência é do tamanho do oceano — e o oceano é enorme, viu',
  'você é o tipo de pessoa que faz o amanhecer valer a pena depois de uma noite virada',
  'seu nome deveria estar gravado nas paredes do Olimpo digital',
  'você é tão único que o oráculo teve que inventar uma categoria nova',
  'se o limbo tivesse um trono, ele já estaria reservado com o seu nome',
  'você é a prova viva de que dá sim pra ser incrível sem esforço nenhum',
  'o brilho da sua alma faz o sol parecer lâmpada de emergência',
  'você é tão sábio que até eu, um bot, te consulto em pensamento',
  'sua vibe é um spa para os nervos deste grupo inteiro',
  'você merece um elogio por dia, e eu vou tentar cumprir essa meta',
  'você é a pessoa que o Hipnos escolheria pra cuidar dos sonhos do mundo inteiro',
  'sua existência é a melhor notificação que este grupo recebe',
  'você é tão bom no que faz que as sombras pediram aula particular',
  'até o acaso virou fã quando você passou',
  'você tem um jeito de existir que faz o caos parecer organizado',
  'você é o motivo pelo qual o limbo ainda mantém as portas abertas',
  'seu talento é grande o bastante pra caber em três grupos e ainda sobrar',
  'você é como aquele silêncio bom de domingo: raro, precioso e revigorante',
  'se fossem sortear a melhor pessoa do grupo, o sorteio pediria pra não participar',
  'você é tão generoso que até o oráculo ficou sem palavras de gratidão'
]

// ─── 📜 Frase aleatória da lista (Math.random puro) ───
function sortearFrase (lista) {
  return lista[Math.floor(Math.random() * lista.length)]
}

// ─── 🪪 Normaliza um JID: remove o sufixo de dispositivo (:N) e MANTÉM o
// domínio original — nunca transforma @lid em @s.whatsapp.net (número falso,
// mesma regra do casal.js/aleatorios.js). ───
function normalizarJid (id) {
  const bruto = String(id || '')
  const [usuario, servidor] = bruto.split('@')
  if (!usuario || !servidor) return ''
  return `${usuario.split(':')[0]}@${servidor}`
}

// ─── 👉 Primeiro JID @mencionado na mensagem (normalizado) ou null.
// O contextInfo é procurado no extendedTextMessage e, se não houver, em
// QUALQUER chave do conteúdo (funciona com legenda de imagem/sticker). ───
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

// ─── 🔎 JID que RENDERIZA a menção: números reais passam direto; LIDs são
// resolvidos p/ o número real via metadados do grupo (quando possível). ───
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
    console.error('[elogio] ⚠️ falha ao ler os metadados do grupo (seguindo com o LID):', err?.message || err)
    return alvo
  }
}

// ============================================
// 🎯 /elogio — executor
// ============================================
module.exports = {
  nome: 'elogio',
  aliases: ['elogiar', 'elogios'],
  descricao: 'Enche alguém de elogios exagerados (sem menção, elogia você mesmo).',

  async executar (sock, jid, msg) {
    try {
      // 1) 👤 Autor da mensagem (em grupo é o participant; no privado, o chat)
      const autor = normalizarJid(msg?.key?.participant || jid || '')

      // 2) 🎯 Alvo: a 1ª menção (@pessoa) ou, sem menção, quem mandou
      const mencionado = alvoMencionado(msg)
      const alvoBruto = mencionado || autor

      if (!alvoBruto) {
        return await sock.sendMessage(jid, {
          text: '✨ *Não consegui identificar quem elogiar...*\n\nMarque alguém com @ ou use o comando direto para receber o elogio você mesmo.'
        }, { quoted: msg })
      }

      // 3) 🔎 JID que renderiza a menção (resolve LID → número real)
      const alvo = await resolverMencao(sock, jid, alvoBruto)
      const digitos = String(alvo).split('@')[0].split(':')[0]

      // 4) 📜 Sorteia o elogio e responde
      const frase = sortearFrase(FRASES)
      console.log(`[elogio] ✨ elogiando ${digitos}${mencionado ? '' : ' (autor — sem menção)'}`)

      return await sock.sendMessage(jid, {
        text: `✨ @${digitos}, ${frase}.`,
        mentions: [alvo]
      }, { quoted: msg })
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa para o socket
      console.error('[elogio] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      return await sock.sendMessage(jid, {
        text: '✨ *As sombras engoliram o elogio...*\n\nNão consegui elogiar agora. Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  // 🧪 Ganchos dos testes offline (mesmo padrão dos _injetarBuscas do projeto)
  __frases: FRASES,
  __alvoMencionado: alvoMencionado
}
