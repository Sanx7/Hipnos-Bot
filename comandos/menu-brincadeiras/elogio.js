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
  'você é tão generoso que até o oráculo ficou sem palavras de gratidão',

  // ── Lote 2 (setembro/2026): +100 elogios, pra repetição nunca cansar.
  //    Mesma regra da lista original: sem ponto final (o executor fecha a frase).
  'você é o tipo de pessoa que transforma a fila do padaria em evento social',
  'seus olhos têm o brilho de quem já viu todos os sonhos bons e ainda quer mais',
  'você é a pessoa que faz a temperatura do grupo subir uns três graus de alegria',
  'você é o tipo de amigo que o celular vibra e mesmo assim atende',
  'seu emprego doeu no coração do grupo quando você chegou',
  'você é a pessoa que marca o aniversário de todo mundo e nunca esquece a data',
  'seu cérebro é um navegador com quatrocentas abas abertas e nenhuma travada',
  'você é tão pontual que o relógio para para te esperar',
  'você é a pessoa que faz ninguém precisar ter pressa com você',
  'sua sorte é tão teimosa que ela fica mesmo quando você não quer',
  'você é a pessoa que faz a tarde do grupo parecer manhã',
  'se bondade tivesse contrato, você já estaria renovando a assinatura',
  'você é o motivo de pelo menos uma pessoa ter melhorado na semana',
  'você é tão livre que nem o gps precisa te corrigir',
  'você é a pessoa que a internet inteira procuraria e não encontraria',
  'se seu cérebro fosse soma, a resposta sempre seria maior que as parcelas',
  'você é tanto de fazer quanto de deixar fazer, e isso é raríssimo',
  'você é a pessoa que faz o silêncio do grupo parecer uma boa conversa',
  'se você fosse um presente, não desembrulhavam nunca',
  'você é a pessoa que o celular carrega cem por cento só de te ver',
  'você é tão diplomata que a briga ia embora com vergonha',
  'você é a pessoa que faz o grupo querer ficar até a última piada',
  'se você fosse música, tocaria em repeat o dia inteiro',
  'você é a pessoa que faz a chateação do grupo sumir em três segundos',
  'vou parar de elogiar porque o próximo item da lista também é você',
  'você é tão corajoso que falar não para você já parece aventura',
  'se você fosse um upgrade, o grupo inteiro agradeceria todo dia',
  'você é a pessoa que a nuvem troca o nome para usar o seu',
  'você é a pessoa que o Hipnos escuta antes de dormir',

  // ── Lote 3: +25 elogios
  'você é a pessoa que faz o dia de quem acordou cedo parecer escolha',
  'se você fosse uma constante, a matemática te daria razão',
  'você é o que faz a chuva do grupo virar clima de conversa',
  'você é a pessoa que o calendário reserva o dia mais bonito pra você',
  'se você fosse um farol, o mar inteiro ia parar pra não se perder em você',
  'você é tão raro quanto chuva no deserto, e igual de necessário',
  'você é a pessoa que faz o grupo lembrar que quinta-feira também pode ser boa',
  'se você fosse um mapa, ninguém se perderia porque você já conhece o caminho',
  'você é a pessoa que o Hipnos usa como referência de qualidade',
  'você é tão organizado que a vida se ajeita só de te ver chegar',
  'você é a pessoa que o espelho se desvia para elogiar de volta',
  'se você fosse um disaster drill, todo mundo sairia ileso',
  'você é a pessoa que faz o telefone parar de tocar quando você atende',
  'você é a razão pela qual o grupo nunca perde o humor no caminho',
  'se você fosse um antidoto, receitavam de prevenção',
  'você é a pessoa que o vagão de trem preferia ser seu Passageiro',
  'você é a pessoa que até a planilha sorri quando abre',
  'se você fosse o Wi-Fi do recanto, todo mundo configuraria a senha igual à sua',
  'vou fazer uma pausa técnica aqui porque não há elogio grande o bastante para você',
  'você é a pessoa que faz a segunda-feira pedir desculpas pra existir',
  'você é o que faz o fim de semana chegar antes do sábado',
  'você é a pessoa que a sorte guardou o turno extra só para você',
  'se você fosse uma constelação, o céu ia brilhar mais por causa de você',
  'você é a pessoa que o cronograma para de brigar quando você entra nele',

  // ── Lote 4: +25 elogios (encerra a lista)
  'você é a pessoa que faz o elevador parar no seu andar por educação',
  'se você fosse uma receita, o mundo inteiro aprenderia a cozinhar',
  'você é a pessoa que o destino avisa antes de mandar notícia',
  'você é tão carinhoso que até a parede do grupo quer ser abraçada por você',
  'você é a pessoa que a sorte usa de exemplo quando precisa dar uma volta',
  'se você fosse um abraço, todo mundo choraria de vontade de devolver',
  'você é a pessoa que o vento para para ouvir o que você vai falar',
  'você é a pessoa que o grupo inteiro ri só de você respirar',
  'se você fosse um domingo, ninguém pediria segunda-feira',
  'você é a pessoa que faz a casa parecer grande quando você chega',
  'você é tan generoso que a sua alegria se espalha sem você querer',
  'você é a pessoa que o Hipnos pede pra songar com você de guia',
  'se você fosse um GPS, ninguém perguntaria o caminho pra chegar em você',
  'você é a pessoa que o destino usa pra provar que ainda dá pra recomeçar',
  'você é a pessoa que o grupo do WhatsApp manda mensagem quando você some',
  'se você fosse um café, a manhã inteira pareceria com dia de domingo',
  'você é a pessoa que faz o erro parecer só um detalhe sem importância',
  'você é a pessoa que a vida arruma as coisas quando você passa perto',
  'você é a pessoa que o sonho do Hipnos sempre acaba bem quando você aparece',
  'você é a pessoa que faz a sua equipe se orgulhar de estar com você',
  'se você fosse um final de filme, ninguém acreditaria no fim e queria mais',
  'você é a pessoa que a constelação do zênite acompanha quando você passa',
  'você é a pessoa que o grupo faz quando você entra: festa',
  'você é a pessoa que o Hipnos põe no Featured de todas as lembranças',
  'você é a pessoa que faz o mundo parecer um lugar melhor do que é',

  // ── Lote 5: +22 elogios (completa as ~100 novas)
  'você é a pessoa que faz o grupo inteiro querer aprender com você',
  'se você fosse um mapa-múndi, ninguém ficaria sem rumo pra onde você já passou',
  'você é a pessoa que a noite inteira espera você terminar o dia',
  'você é tão marcante que a sua ausência também avisa que você estava',
  'você é a pessoa que faz a segunda leva valer mais que a primeira',
  'se você fosse um reparo, consertava até o que não estava quebrado',
  'você é a pessoa que o Hipnos pede ajuda quando esquece algum sonho',
  'você é tão paciente que já contam a sua espera como parte da diversão',
  'você é a pessoa que faz o silêncio longo não incomodar ninguém aqui',
  'você é a pessoa que chega cansada e sai deixando o grupo melhor',
  'se você fosse um relógio, marcaria a hora certa de ser feliz',
  'você é a pessoa que o grupo sente falta antes mesmo de perceber',
  'você é o que faz a parte ruim do dia ficar pequena perto de você',
  'você é a pessoa que as crianças do grupo já tratam com confiança',
  'se você fosse uma seta, todo mundo voltaria ao ponto onde você está',
  'vou parar de falar de você porque a conversa é minha e você roubou ela',
  'você é a pessoa que faz o Hipnos ter orgulho de ser Hipnos',
  'você é a pessoa que o grupo queria ter atendido todo dia',
  'você é a pessoa que o bom dia já vem pronto quando você acorda',
  'você é a pessoa que a noite terminou bem porque você apareceu',
  'você é a pessoa que faz qualquer coisa terminar virar memória boa',
  'você é a pessoa que o mundo escuta quando você fala'
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
