// ============================================
// 🔮 HOROSCOPO — Leitura do dia do Limbo (lista fixa, sem API)
// ============================================
// /horoscopo <signo>
//   Ex.: /horoscopo leao  (funciona com ou sem acento)
//
// Como funciona:
//   - Não há API gratuita confiável de horóscopo: as leituras são uma lista
//     FIXA no código, com 8 frases genéricas por signo (temática Hipnos).
//   - 🔒 TRAVA DIÁRIA: o resultado é determinístico por CHAVE = signo + DATA
//     (hash FNV-1a simples → índice da frase). Todo mundo que perguntar o
//     mesmo signo NO MESMO DIA recebe a MESMA leitura — não é sorteio por
//     usuário. À meia-noite a chave muda e a leitura gira sozinha.
//   - Aceita o signo com ou sem acento (normalizamos antes de comparar).
//   - Sem API/rede: nada de timeout, fallback ou rate limit.
//
// Padrão do bot:
//   - export { nome, descricao, executar } (contrato do loader);
//   - try/catch com aviso amigável + console.error do erro real;
//   - respostas sempre com { quoted: msg }.
// ============================================

// ─── 🗿 Os 12 signos, com 8 leituras cada ───
const SIGNOS = [
  {
    signo: 'áries', emoji: '♈',
    frases: [
      'Sua energia de fogo está mais forte que o despertar de Hipnos: use-a para começar o que anda adormecido.',
      'Hoje o impulso fala mais alto que a paciência — respire antes de responder, mesmo que as estrelas apertem o relógio.',
      'Uma porta que parecia trancada cede ao primeiro empurrão sincero.',
      'Evite transformar pedrinhas em montanhas: nem todo obstáculo de hoje merece uma guerra.',
      'Alguém admira sua coragem em silêncio; não espere aplauso para continuar.',
      'A pressa é inimiga dos sonhos: o que nasce com calma dura mais.',
      'Sua franqueza abre caminhos, mas escolha bem as portas em que ela entra.',
      'Ao anoitecer, você perceberá que o dia pediu menos força e mais escuta.'
    ]
  },
  {
    signo: 'touro', emoji: '♉',
    frases: [
      'A constância é seu dom: hoje ela vale mais que qualquer atalho.',
      'Um pequeno prazer simples vai equilibrar um dia agitado — permita-se.',
      'Cuidado com a teimosia: ouvir não é perder, é juntar peças.',
      'As estrelas recomendam terminar o que começou antes de sonhar com o próximo.',
      'Segurança também se constrói com gentileza, não só com esforço.',
      'Um convite inesperado pode trazer o descanso que você negou a si mesmo.',
      'Se a rotina pesar, mude um detalhe: até o sonho muda de cor com luz nova.',
      'Seu esforço silencioso de hoje vira colheita quando você menos esperar.'
    ]
  },
  {
    signo: 'gêmeos', emoji: '♊',
    frases: [
      'Sua mente corre mais rápido que o vento do limbo: anote as ideias antes que fujam.',
      'Duas conversas trouxeram a mesma mensagem disfarçada — preste atenção.',
      'Hoje, menos é mais: escolher uma direção vale mais que dez planos.',
      'O humor abre portas que o discurso não abre.',
      'Evite prometer o que a agenda de amanhã não pode pagar.',
      'Uma pergunta sincera vale mais que dez respostas ensaiadas.',
      'Notícias viajam até você; confirme antes de repassar.',
      'A curiosidade te renova: aprenda algo pequeno e o dia fica maior.'
    ]
  },
  {
    signo: 'câncer', emoji: '♋',
    frases: [
      'Seu coração é bússola, mas hoje ele pede mapa: converse antes de concluir.',
      'Casa é onde o seu silêncio descansa — proteja esse canto.',
      'Alguém precisa do seu cuidado mais do que demonstra.',
      'Não carregue o que não é seu: empatia sem limites vira cansaço.',
      'Uma lembrança antiga vem trazer paz, não saudade que aprisiona.',
      'Diga o que sente antes que a lua mude de fase.',
      'A intuição de hoje está afiada: confie, mas confira.',
      'Perdoar-se é o abraço que faltava no seu dia.'
    ]
  },
  {
    signo: 'leão', emoji: '♌',
    frases: [
      'Seu brilho acorda quem está dormindo ao redor — use-o com generosidade.',
      'Reconhecimento chega por caminhos que você não estava vigiando.',
      'Liderar hoje é servir: quem ajuda primeiro, brilha mais tempo.',
      'Cuidado com o orgulho ferido: ele conta histórias maiores que a realidade.',
      'Um elogio sincero seu muda o dia de alguém (e o seu também).',
      'Você não precisa ser o centro para ser importante.',
      'A criatividade de hoje merece palco, mesmo que pequeno.',
      'O sol do limbo ilumina um plano antigo seu: retome-o com orgulho leve.'
    ]
  },
  {
    signo: 'virgem', emoji: '♍',
    frases: [
      'Sua atenção aos detalhes salva o dia — mas não deixe o perfeccionismo dirigir sozinho.',
      'Organize o exterior e o interior segue a ordem.',
      'Uma lista curta, concluída, vale mais que um plano grandioso adiado.',
      'Criticar menos não é aceitar mais: é escolher batalhas que pagam bem.',
      'Seu corpo manda recados hoje: hidrate, respire, pause.',
      'Alguém valoriza exatamente o que você acha insignificante.',
      'A ordem que você busca lá fora começa aqui dentro.',
      'Deixe 10% do dia sem planejar: o acaso também sonha com você.'
    ]
  },
  {
    signo: 'libra', emoji: '♎',
    frases: [
      'A balança pende para o diálogo: uma conversa honesta pesa mais que razões.',
      'Beleza ao redor acalma a beleza dentro — arrume um canto seu.',
      'Evite decidir no meio da maré: equilibre-se antes de escolher.',
      'Um sim seu vale ouro hoje: gaste-o com quem merece.',
      'Alguém espelha sua gentileza de volta quando você menos espera.',
      'Justiça e paz nem sempre andam juntas — hoje, escolha a paz que honra a justiça.',
      'A arte salva horas difíceis: música, cor, poema — o que te toca.',
      'Cortar o que pesa também é equilíbrio.'
    ]
  },
  {
    signo: 'escorpião', emoji: '♏',
    frases: [
      'Sua intensidade é rio profundo: hoje ela irriga, não afoga.',
      'Você enxerga o que está escondido — use essa visão para proteger, não para ferir.',
      'Transformar-se dói menos que fingir que está tudo igual.',
      'Um segredo te procura: guarde-o como se guarda o sono.',
      'Confiança se reconstrói em tijolos pequenos: comece por um.',
      'Solte o que já morreu por dentro: o limbo recicla tudo em força.',
      'Sua lealdade é rara: ofereça-a a quem enxerga isso.',
      'A paixão de hoje precisa de direção, não de freio.'
    ]
  },
  {
    signo: 'sagitário', emoji: '♐',
    frases: [
      'Sua flecha mira longe — mas o alvo de hoje está a três passos.',
      'A aventura chama: responda com planejamento, não só com entusiasmo.',
      'Sua sinceridade ilumina, se vier embrulhada em carinho.',
      'Aprender algo novo abre uma janela no teto do seu sonho.',
      'Alguém de longe traz uma notícia que muda a rota para melhor.',
      'Ria de si mesmo uma vez ao dia: o ego fica leve.',
      'O horizonte pede movimento: até uma caminhada curta reescreve o dia.',
      'Fé não é certeza: é dar o passo mesmo com névoa.'
    ]
  },
  {
    signo: 'capricórnio', emoji: '♑',
    frases: [
      'A montanha de hoje se escala em degraus pequenos e honestos.',
      'Seu esforço constante é o feitiço mais raro deste reino.',
      'Descansar também é estratégia: até Hipnos tira o chapéu.',
      'Uma responsabilidade sua pode ser dividida — pedir ajuda é força.',
      'O reconhecimento demora, mas nunca se perde: continue.',
      'Cuidado com o depois: o agora é o único território real.',
      'Sua palavra firme abre portas que atalhos não abrem.',
      'Celebre o progresso invisível: ele sustenta o visível.'
    ]
  },
  {
    signo: 'aquário', emoji: '♒',
    frases: [
      'Sua mente mora no futuro: hoje ela traz um presente disfarçado de ideia estranha.',
      'Ser diferente não é defeito: é o seu jeito de cuidar do mundo.',
      'Uma amizade inesperada floresce em terreno improvável.',
      'Desapegue de uma opinião antiga: a asa nova precisa de espaço.',
      'Sua liberdade cresce quando você também liberta os outros.',
      'Tecnologia, arte ou causa: escolha o canal do seu ideal de hoje.',
      'O grupo precisa do seu olhar fora da caixa — ofereça-o sem medo.',
      'O silêncio de hoje não é solidão: é laboratório.'
    ]
  },
  {
    signo: 'peixes', emoji: '♓',
    frases: [
      'Seus sonhos de hoje têm recado prático: anote-os ao acordar.',
      'Sua sensibilidade é radar: use-a para aproximar, não para se esconder.',
      'A criatividade transborda: derrame um pouco em algo concreto.',
      'Diga não com carinho: seu mar interior agradece.',
      'Alguém se apoia na sua correnteza sem que você perceba.',
      'Fugir é humano; flutuar é divino: observe antes de reagir.',
      'Uma música certa destrava o dia inteiro.',
      'O limbo te visita cedo hoje: durma com uma pergunta na cabeça.'
    ]
  }
]

// ─── 🔤 Normaliza texto (minúsculas + sem acento) p/ comparar signos ───
function normalizar (texto) {
  return String(texto || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

// ─── 📅 Data de hoje como chave (YYYY-MM-DD, horário local do servidor) ───
function chaveData (agora) {
  const d = agora || new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

// ─── 🔒 Índice determinístico por chave (signo + data) ───
// Hash FNV-1a: mesmo signo no mesmo dia → mesmo índice → mesma frase,
// para TODO mundo (não depende de usuário nem de Math.random).
function indiceDiario (signo, data) {
  const chave = `${normalizar(signo)}|${data}`
  let hash = 2166136261
  for (let i = 0; i < chave.length; i++) {
    hash ^= chave.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

// ─── 🔮 Sorteia a leitura do dia de um signo ───
// Retorna { signo, emoji, frase, indice, data } ou null se o signo for inválido.
function horoscopoDoDia (termo, agora) {
  const data = chaveData(agora)
  const entrada = SIGNOS.find(s => normalizar(s.signo) === normalizar(termo))
  if (!entrada) return null
  const indice = indiceDiario(entrada.signo, data) % entrada.frases.length
  return { signo: entrada.signo, emoji: entrada.emoji, frase: entrada.frases[indice], indice, data }
}

// ─── 📋 Lista de signos para exibir nos avisos ───
function listaSignos () {
  return SIGNOS.map(s => s.signo).join(', ')
}

// ---- EXPORTACAO PRINCIPAL (mesmo contrato do loader: nome + executar) ----
module.exports = {
  nome: 'horoscopo',
  descricao: 'Leitura do dia do Limbo para o seu signo — a mesma para todos no mesmo dia (aceita com ou sem acento).',

  executar: async function (sock, jid, msg, texto) {
    try {
      const termo = String(texto || '').replace(/^\/\S+\s*/, '').trim()

      // Sem signo → instruções de uso com a lista completa
      if (!termo) {
        return await sock.sendMessage(jid, {
          text: '🌙 *Como usar o horóscopo do Limbo*\n\n' +
            'Envie o comando com o seu signo:\n' +
            '`/horoscopo leao` (funciona com ou sem acento)\n\n' +
            `♈ Os 12 signos: ${listaSignos()}`
        }, { quoted: msg })
      }

      const leitura = horoscopoDoDia(termo)

      // Signo inválido → aviso amigável com a lista
      if (!leitura) {
        return await sock.sendMessage(jid, {
          text: '❌ Não conheço esse signo...\n\n' +
            `♈ Os 12 signos aceitos: ${listaSignos()}\n\n` +
            '🗝️ Exemplo: `/horoscopo leao` (com ou sem acento)'
        }, { quoted: msg })
      }

      const dataLegivel = new Date().toLocaleDateString('pt-BR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      })

      const mensagem =
        `${leitura.emoji} *HORÓSCOPO DO DIA — ${leitura.signo.toUpperCase()}* ${leitura.emoji}\n` +
        `📅 ${dataLegivel}\n\n` +
        `✨ ${leitura.frase}\n\n` +
        '🌌 As estrelas mudam à meia-noite: volte amanhã para uma nova leitura.'

      await sock.sendMessage(jid, { text: mensagem }, { quoted: msg })
    } catch (err) {
      // 🛡️ Nada escapa para o socket
      console.error('[horoscopo] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⛔ As estrelas do limbo se apagaram por um instante... Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  // Extras internos para os testes offline (mesmo padrão do pinterest)
  SIGNOS,
  horoscopoDoDia,
  indiceDiario,
  chaveData,
  normalizar
}
