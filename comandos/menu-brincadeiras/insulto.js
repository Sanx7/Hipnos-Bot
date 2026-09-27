// ============================================================
// 😈 INSULTO — Zoeira leve e engraçada (uso LIVRE)
// ============================================================
// O espelho do /elogio: em vez de encher de elogios, o Hipnos dá uma
// cutucada carinhosa — zoeira leve, de grupo, sem ofensa pesada
// (nada de aparência, família, doença, morte ou sexual — a graça é no
// exagero e no absurdo, nunca em ferir de verdade).
//
// Uso:
//   /insulto            → zoa QUEM MANDOU o comando
//   /insulto @pessoa    → zoa a pessoa marcada
//
// Formato da resposta: 😈 @{mencionado}, {frase sorteada}.
//
// 🔒 Sem API externa, sem key, sem rede: só Math.random() na lista local.
// 🔒 Padrão do bot:
//   - o texto e o mentions[] saem SEMPRE com o MESMO JID (se não, o "@" não
//     renderiza e vira número cru no chat);
//   - alvo vindo como LID (@lid): tenta os metadados do grupo (config.js —
//     acharParticipante, o mesmo caminho PROOF-LID do ehDonoDoBot) pra achar
//     o número REAL; se não der, usa o próprio LID (menção ainda funciona);
//   - try/catch com mensagem amigável em pt-BR — a conexão NÃO cai;
//   - logs "[insulto] ..." para diagnóstico no Render.
// ============================================================

const { normalizeMessageContent } = require('@whiskeysockets/baileys')

// 👑 acharParticipante = helper compartilhado do projeto (compara id E
// phoneNumber, normalizados) — o mesmo usado pelo ehDonoDoBot/lid.js.
const { acharParticipante } = require('../../config')

// -------------------------------------------------------------------
// 📜 LISTA DE INSULTOS (zoeira leve; sem ponto final — o executor fecha).
// Mantida no mesmo tamanho do /elogio original (~35) pra não repetir muito.
// -------------------------------------------------------------------
const FRASES = [
  'você é a prova viva de que o wifi do grupo precisa de senha',
  'se a sua memória fosse um celular, já estaria nas configurações de fábrica há muito tempo',
  'você é o tipo de pessoa que o grupo silencia com carinho',
  'seu senso de tempo é tão flexível que o relógio pediu demissão por sua causa',
  'você é a pessoa que perde a caneta e culpa a mesa',
  'se você fosse uma atualização, o celular pediria para voltar à versão anterior',
  'você é o único capaz de transformar um emoji em trezentas mensagens',
  'sua capacidade de se enrolar merece uma medalha de ouro',
  'você é o humano mais próximo de um tutorial que ninguém assistiu',
  'se você dissesse já vou e fizesse alguma coisa, o grupo não acreditaria',
  'você é a pessoa que chega atrasada até para o próprio atraso',
  'se a sua cabeça fosse um grupo de WhatsApp, alguém já teria mutado',
  'você é o que faz o grupo responder só com duas letras para economizar dois minutos',
  'se você fosse um carregador, o grupo ia esperar mais que o almoço',
  'vou ser honesto com você: você é o carregador do grupo',
  'você é a pessoa que perde a hora do café e acha que ganhou',
  'se você fosse um meme, já estaria desatualizado há três semanas',
  'você é o que faz qualquer assunto virar receita de bolo de cenoura',
  'se você fosse um teclado, todas as teclas estariam travadas',
  'você é a prova de que já vou chamar e já vou nunca são a mesma coisa',
  'sua pontualidade é tão elástica que já virou borracha',
  'vou parar de zoar porque até eu estou ficando sem graça',
  'você é a pessoa que lê a sala e ri sozinha',
  'se você fosse um filtro do celular, seria o de borrar o próprio nome',
  'você é o que faz o grupo digitar sim só para acabar logo com isso',
  'você é a pessoa que guarda a pilha e cobra juros em figurinha',
  'se você fosse um aplicativo, só abriria pra pedir atualização',
  'você é a pessoa que transforma um desvio de dois minutos em conferência',
  'se você fosse o undo do grupo, alguém já teria te chamado umas três vezes',
  'você é a prova de que o botão de mudo existe por sua causa',
  'você é a pessoa que manda bom dia com efeito de bocejo',
  'se você fosse um semáforo, ficaria no amarelo pra sempre',
  'vou te dar um conselho de graça: para de ser tão você',

  // ── Lote 2: +25 zoeiras (a lista foi ampliada pra não repetir tanto)
  'você é a pessoa que o grupo usa pra testar se a internet ainda funciona',
  'se você fosse um comando, seria o que todo mundo esquece de executar',
  'você é a prova de que o botão de pular propaganda também tem personalidade',
  'você é a pessoa que responde em emoji enquanto o assunto pede uma frase',
  'se você fosse um arquivo, seria aquele que ninguém sabe quando abriu',
  'você é o que faz o grupo mudar de assunto bem na melhor parte',
  'você é a pessoa que manda áudio de 4 minutos só para dizer que vai mandar texto',
  'se você fosse um despertador, o celular ia pedir pra ser outro aparelho',
  'você é a pessoa que perde o grupo em qualquer lugar com mais de uma sala',
  'se você fosse um mapa do tesouro, a marca estaria no lugar errado',
  'você é a pessoa que chega no comitê e altera a pauta sem querer',
  'se sua memória fosse um disco, já estaria precisando de defragmentar',
  'você é a pessoa que promete cinco minutos e chega na próxima lua',
  'se você fosse o mute do grupo, o grupo inteiro ia ficar em silêncio educado',
  'você é a pessoa que lê a regra, não achando que era sugestão',
  'se você fosse um spoiler, ninguém te aguentaria no filme',
  'vou te dar um conselho: para de responder tudo com aquele emoji de risada',
  'você é a pessoa que transforma qualquer assunto em reunião',
  'se você fosse o carregador do celular do grupo, já estaria na tomada',
  'vou parar de zoar porque você já percebeu e continua do mesmo jeito',

  // ── Lote 3: +25 zoeiras
  'você é a pessoa que o grupo chama quando ninguém sabe onde está a planilha',
  'se você fosse um GPS, ele ficaria recalculando a rota pra não te perder',
  'você é a pessoa que manda bom dia às três da tarde com convicção',
  'se você fosse um filtro de foto, ia apagar a sua antes de mostrar',
  'você é o que faz o grupo respirar fundo antes de ler suas mensagens',
  'se você fosse uma senha, ninguém ia lembrar e todo mundo ia errar',
  'você é a pessoa que esquece o nome e lembra de todo o resto',
  'se você fosse um botão, era o de repetir que ninguém consegue desligar',
  'você é a pessoa que responde a pergunta fácil e some na difícil',
  'se você fosse um grupo de whatsapp, todo mundo já teria colocado no silencioso',
  'você é a prova viva de que distração e problema têm relação de pai e filho',
  'você é a pessoa que transforma qualquer lista em um mar de itens',
  'vou te indicar: o seu ponto forte é o silêncio do grupo quando você digita',
  'se você fosse um travesseiro, ia ter a marca do pescoço em todo lugar',
  'você é a pessoa que chega cedo na festa e sai antes do principal',
  'se você fosse um roldo, passaria meia hora dando volta no mesmo lugar',
  'vou te dar uma ideia: tenta dormir mais, você ia dar bom dia na hora certa',

  // ── Lote 4: +25 zoeiras
  'você é a pessoa que o grupo manda mensagem de bom dia e você responde com boa noite',
  'se você fosse um calendário, o grupo nunca saberia em que dia está',
  'você é a pessoa que guarda todas as senhas e nenhuma das dicas',
  'se você fosse um roteador, todo mundo perderia a internet só de te ver',
  'vou te indicar: a sua técnica deixa a desejar, mas a sua coragem é real',
  'você é a pessoa que faz o grupo rir e depois pedir desculpa pelo barulho',
  'se você fosse um argumento, ninguém ia querer discutir',
  'vou parar de zoar porque você claramente não leva pro pessoal',

  // ── Lote 5: +42 zoeiras (fecha a lista ampliada)
  'você é a pessoa que responde tudo com um joinha e espera milagre',
  'se você fosse um semáforo, o grupo pararia esperando sua decisão',
  'você é a pessoa que perde a hora e culpa o relógio inteiro',
  'se você fosse um aplicativo, a loja ia escrever que ele trava sozinho',
  'vou te dar um conselho: para de mandar bom dia em dia de churrasco',
  'você é a pessoa que o grupo deixa de lado quando o assunto é importante',
  'se você fosse um buffer, o grupo ia esperar mais que a fila do banco',
  'você é a pessoa que transforma um discord inteiro numa aula',
  'se você fosse um mouse, o cursor ia te arrastar pra baixo',
  'vou parar de zoar porque você já é o meme oficial do grupo',
  'você é a pessoa que chega na conversa pronta e sai no meio',
  'se você fosse um spoiler, o cinema te proibia antes do trailer',
  'você é a pessoa que manda o áudio com a história inteira da vida dele',
  'se você fosse uma bateria, estava sempre no doze por cento',
  'vou te indicar: você cole em qualquer assunto e ninguém sabe explicar',
  'você é a pessoa que faz a piada e ri antes de terminar a frase',
  'se você fosse um interruptor, a casa inteira vivia no escuro',
  'vou parar de zoar porque já virou elogio barato',
  'você é a pessoa que some justo quando alguém pede sua opinião',
  'se você fosse um link, ele nunca abriria na primeira tentativa',
  'vou te dar uma ideia: mandar menos mensagem e dormir mais te faria bem',
  'você é a pessoa que perde no jogo de tabuleiro por causa das próprias regras',
  'se você fosse uma semente, o jardineiro ia pedir instruções',
  'vou parar, tá ficando fácil te zoar',

  // ── Lote 6: +33 zoeiras (lista final, 135 frases no total)
  'você é a pessoa que o grupo chama pra opinar e depois discorda de você',
  'se você fosse um radar, ele nunca encontraria a própria agulha',
  'vou te indicar: o teu talento pra sumir no meio da conversa é impressionante',
  'você é a pessoa que confirma o que todo mundo já pensou pra não ficar sozinho',
  'se você fosse um elevador, a porta fecharia bem na sua cara',
  'vou te dar um conselho: usa menos ponto de exclamação',
  'você é a pessoa que faz a leitura coletiva levar vinte minutos',
  'se você fosse uma impressora, todo mundo ficaria esperando o papel',
  'vou parar de zoar porque a piada já é melhor que a frase',
  'você é a pessoa que responde a tudo com uma pergunta nova',
  'se você fosse um espelho, ia devolver a imagem errada',
  'vou te indicar: você tem talento pra encher o silêncio do grupo',
  'você é a pessoa que some do grupo na hora de limpar o bot',
  'se você fosse um WIFI, o sinal caía bem quando você precisa falar',
  'vou parar, prometo que é a última',
  'você é a pessoa que faz o grupo inteiro rir de um erro seu',
  'se você fosse um calendário, o grupo nunca saberia o dia da reunião',
  'vou te dar um conselho: para de responder com áudio quando o texto resolve',
  'você é a pessoa que perde a senha e jura que decorou',
  'se você fosse um nuvem, a chuva cairia na hora errada sempre',
  'vou parar de zoar, meu dedo já tá doendo de tanto te digitar',
  'você é a pessoa que faz a promessa e esquece na mesma frase',
  'se você fosse um short, o grupo ia pular a parte que importa',
  'vou te indicar: o teu talento pra não estar no ensaio é bizarro',
  'você é a pessoa que transforma qualquer desculpa em banda larga',
  'se você fosse um teclado, a tecla de espaço já pedaria socorro',
  'vou parar, amanhã eu invento outra',
  'você é a pessoa que o grupo marcaria como vip do silêncio',
  'se você fosse um carregador, ia demorar umas três horas só pra lembrar o próprio tamanho',
  'vou parar de zoar porque o Hipnos também já se cansou',
  'você é a pessoa que faz a zoeira virar elogio sem querer'
]

// -------------------------------------------------------------------
// 🧹 Helpers de menção (mesmo contrato do /elogio)
// -------------------------------------------------------------------

// 📱 Remove o sufixo de dispositivo (:12) e devolve o JID limpo
function normalizarJid (bruto) {
  const texto = String(bruto || '').trim()
  if (!texto) return ''
  return texto.includes('@') ? texto.split(':')[0] : texto
}

// 🎯 Quem foi marcado: 1ª menção da mensagem. Envolve normalizeMessageContent
// para achar o contextInfo também em legenda de imagem/sticker (funciona com
// a chave do conteúdo).
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
    console.error('[insulto] ⚠️ falha ao ler os metadados do grupo (seguindo com o LID):', err?.message || err)
    return alvo
  }
}

// 🎲 Sorteia uma frase da lista
function sortearFrase (lista) {
  return lista[Math.floor(Math.random() * lista.length)]
}

// ============================================================
// 😈 /insulto — executor
// ============================================================
module.exports = {
  nome: 'insulto',
  aliases: ['insultar', 'zoeira', 'provocar'],
  descricao: 'Dá uma zoeira leve e engraçada em alguém (sem menção, zoa você mesmo).',

  async executar (sock, jid, msg) {
    try {
      // 1) 👤 Autor da mensagem (em grupo é o participant; no privado, o chat)
      const autor = normalizarJid(msg?.key?.participant || jid || '')

      // 2) 🎯 Alvo: a 1ª menção (@pessoa) ou, sem menção, quem mandou
      const mencionado = alvoMencionado(msg)
      const alvoBruto = mencionado || autor

      if (!alvoBruto) {
        return await sock.sendMessage(jid, {
          text: '😈 *Não consegui identificar quem levar a zoeira...*\n\nMarque alguém com @ ou use o comando direto para ouvir a zoeira de volta.'
        }, { quoted: msg })
      }

      // 3) 🔎 JID que renderiza a menção (resolve LID → número real)
      const alvo = await resolverMencao(sock, jid, alvoBruto)
      const digitos = String(alvo).split('@')[0].split(':')[0]

      // 4) 📜 Sorteia a frase e responde
      const frase = sortearFrase(FRASES)
      console.log(`[insulto] 😈 zoando ${digitos}${mencionado ? '' : ' (autor — sem menção)'}`)

      return await sock.sendMessage(jid, {
        text: `😈 @${digitos}, ${frase}.`,
        mentions: [alvo]
      }, { quoted: msg })
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa para o socket
      console.error('[insulto] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      return await sock.sendMessage(jid, {
        text: '😈 *As sombras engoliram a zoeira...*\n\nNão consegui zoar agora. Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  // 🧪 Ganchos dos testes offline (mesmo padrão do /elogio)
  __frases: FRASES,
  __alvoMencionado: alvoMencionado,
  __resolverMencao: resolverMencao
}