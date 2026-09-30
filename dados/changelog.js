// ============================================
// 🌙 CHANGELOG — Novidades do bot (curadoria manual)
// ============================================
// Fonte de verdade do comando /novidades (aliases: /changelog, /atualizacoes).
// Mantido MANUALMENTE: a cada comando novo ou mudança relevante pro usuário
// final do grupo, adicione uma entrada no TOPO (mais recente primeiro).
//
// Formato de cada entrada:
//   { data: 'AAAA-MM-DD', titulo: 'texto curto', detalhes: 'texto opcional mais longo' }
//
// Regras:
//   - Só entra o que INTERESSA pra quem usa o bot no grupo (comando novo,
//     melhoria visível, correção que afetava o uso). Correção de bug interno,
//     refatoração e detalhe técnico NÃO entram aqui.
//   - "titulo" é curto (uma linha); "detalhes" é opcional e explica como usar.
//   - A lista fica ordenada da mais recente para a mais antiga.
// ============================================

module.exports = [
  {
    data: '2026-09-30',
    titulo: 'Correção: cor do VIP, assinatura e tema agora aparecem sempre',
    detalhes: 'A cor do /corvip podia não pintar o nome no /ranking, a assinatura do /assinatura podia não sair na figurinha (/s e /figurinha) e o tema do /temavip podia não colorir os cards de /kiss e /ship. O bot passou a reconhecer o autor pelo número real antes de buscar esses dados.'
  },
  {
    data: '2026-09-30',
    titulo: '/procurado — o líder do ranking ganha um cartaz com foto',
    detalhes: 'Use /procurado no grupo para gerar o cartaz do quem mais mandou mensagem: foto, nome, alcunha, contagem e a data. Todo mundo já tem uma alcunha — os VIPs podem trocar a delas com /alcunha.'
  },
  {
    data: '2026-09-30',
    titulo: '/ranking agora é um pergaminho grego ilustrado',
    detalhes: 'O /ranking virou imagem: pergaminho envelhecido, frisco grego dourado, rolos de ouro no topo e na base e o seu nome pintado com a cor do seu /corvip. Se a imagem falhar, a lista em texto continua sendo enviada.'
  },
  {
    data: '2026-09-30',
    titulo: '/jornal — o resumo do dia do grupo em capa de jornal',
    detalhes: 'Use /jornal no grupo para resumir as conversas do dia com a IA numa capa de jornal (também: /resumododia e /manchetes).'
  },
  {
    data: '2026-09-29',
    titulo: 'Modificador de voz: /esquilo, /gigante, /robo, /demonio, /rapido, /lento, /reverso e /estourar',
    detalhes: 'Responda a uma nota de voz ou áudio com um dos 8 efeitos e receba o áudio distorcido de volta (nota de voz continua nota de voz). Limite de 20MB ou 3 minutos por áudio.'
  },
  {
    data: '2026-09-26',
    titulo: '/insulto — a zoeira leve do grupo',
    detalhes: 'O espelho do /elogio: /insulto @pessoa devolve uma zoeira leve e engraçada, tirada de uma lista de frases no próprio bot (sem API e sem internet). Sem menção, a zoeira é pra quem chamou. Também: /zoeira e /provocar.'
  },
  {
    data: '2026-09-26',
    titulo: '/enquete-admin — votação de decisão do grupo',
    detalhes: 'Só administradores abrem: /enquete-admin pergunta | opção 1 | opção 2 e o grupo vota mandando o número da opção (2 a 6 opções, 2 minutos). Se o "sim" ganhar numa votação de ban (/enquete-admin-ban @pessoa | sim | não), o bot remove a pessoa e bota na blacklist sozinho — com as mesmas proteções do /ban (nunca bane dono do bot). Empate não decide nada. É diferente do /enquete, que é só de opinião e qualquer um abre.'
  },
  {
    data: '2026-09-26',
    titulo: '/enquete — enquete de opinião no grupo',
    detalhes: 'Monte assim: /enquete pergunta | opção 1 | opção 2 (até 6 opções) e o grupo vota mandando o número da opção no chat. Qualquer membro pode abrir a enquete (diferente do /enquete-admin, que é administrativo); dura 2 minutos e pode ser encerrada antes com /encerrar-enquete. No fim sai a contagem de cada opção e a vencedora (ou o empate).'
  },
  {
    data: '2026-09-26',
    titulo: '/compatibilidade — quanto duas almas se entendem',
    detalhes: 'Mencione uma pessoa para comparar com você (/compatibilidade @fulano) ou duas para comparar entre elas. O bot responde com a porcentagem de 0 a 100% e um veredito. O resultado é do par e trava por dia: hoje e sempre hoje, a mesma dupla tem a mesma porcentagem (também: /match).'
  },
  {
    data: '2026-09-26',
    titulo: '/desenharpalavra — Pictionary só com texto',
    detalhes: 'Quem chama o comando vira o descritor e recebe a palavra sorteada só no privado; no grupo, ele descreve com palavras (sem escrever a resposta, ou a dica é invalidada) e os demais chutam no chat. Rodada de 3 minutos e um jogo por grupo. Também: /pictionary.'
  },
  {
    data: '2026-09-26',
    titulo: 'Efeitos novos: /contraste, /espelhar, /pixel, /rip e os apelidos /gray, /inverter, /cadeia',
    detalhes: 'Mais quatro efeitos na foto de perfil, feitos pelo próprio bot (sem depender de API): /contraste aumenta o contraste, /espelhar espelha a imagem, /pixel pixeliza e /rip coloca a foto numa lápide com "RIP". Os comandos antigos também ganharam nomes alternativos: /greyscale aceita /gray, /invert aceita /inverter e /jail aceita /cadeia. O /pixelate continua funcionando, agora como apelido do /pixel.'
  },
  {
    data: '2026-09-26',
    titulo: 'Novos efeitos de foto: /slap, /spank, /batslap, /beautiful, /bobross, /ad e /apagar',
    detalhes: 'Sete memes novos na foto de perfil — /slap @pessoa combina as duas fotos num tapa, e /spank, /batslap, /beautiful, /bobross, /ad e /apagar (também /deletar) aplicam o efeito em quem mandar ou em quem for mencionado. Também chegaram /passed, /pixelate e /heart, e o /clown agora é feito pelo próprio bot (não depende mais de API). Detalhes em /menu-efeitos.'
  },
  {
    data: '2026-09-26',
    titulo: '/tiktok-audio — só o som do TikTok, em MP3',
    detalhes: 'Mande o mesmo link do /tiktok com /tiktok-audio e o bot responde com apenas o áudio do vídeo em MP3. Quando o vídeo não tem faixa publicada, o som é extraído do próprio vídeo. Também: /tiktok-mp3, /tt-audio e /tk-audio.'
  },
  {
    data: '2026-09-26',
    titulo: '/set-prefix — troque o prefixo dos comandos (de / para !)',
    detalhes: 'Só para donos do bot: /set-prefix ! faz os comandos passarem a responder com "!" na hora, sem reiniciar o bot, e o prefixo fica salvo no banco (sobrevive a reinício e redeploy). /set-prefix sem argumento mostra o atual, /set-prefix reset volta para "/" e a "/" antiga continua funcionando para não quebrar o costume do grupo. Aceita qualquer símbolo (! . - + ? #) — letra e número são recusados porque roubariam as mensagens normais do grupo. Também: /prefixo.'
  },
  {
    data: '2026-09-26',
    titulo: 'Pacote de personalização VIP: /temavip, /assinatura, /corvip, /nomecustom e /badge',
    detalhes: 'Exclusivo para VIPs, tudo no mesmo dia: /temavip escolhe as cores do card do /perfil (e dos cards de /ship e /kiss; também /temacustom), /assinatura marca as figurinhas criadas com /s e /figurinha (também /assinaturavip), /corvip define o emoji antes do seu nome no /ranking (também /corcustom), /nomecustom escolhe o nome exibido no /perfil e no /ranking (também /nomevip) — e o selo 💠 VIP no /perfil é AUTOMÁTICO: ele aparece sozinho ao lado do nome enquanto o VIP estiver ativo e some quando expira; /badge (também /selovip) mostra o status do selo na hora.'
  },
  {
    data: '2026-09-26',
    titulo: '/revelaraudio — revela áudios de visualização única',
    detalhes: 'Responda a um áudio com 👁️ (visualização única) com /revelaraudio que o bot reenvia (também: /revelarpv, /audiorevelado). Exclusivo para VIPs, admins do grupo e donos do bot. Fotos/vídeos continuam no /revelar.'
  },
  {
    data: '2026-09-26',
    titulo: '/emojimix — misture dois emojis numa imagem só',
    detalhes: 'Igual à cozinha do Gboard: /emojimix 😂😭 manda a mistura como imagem — /emojimix fig 😂😭 manda como figurinha (também: /mixemoji, /emoji-mix).'
  },
  {
    data: '2026-09-26',
    titulo: '/adivinha-emoji — adivinhe o filme pela sequência de emojis',
    detalhes: 'O bot manda só os emojis e o grupo tenta acertar em texto livre (vale sem acento e com pequeno erro de escrita). Dica a cada ~20s, ~90s por rodada. Ex.: /adivinha-emoji (também: /emojiadivinha, /adivinheemoji).'
  },
  {
    data: '2026-09-26',
    titulo: '/eununca agora vira enquete no grupo',
    detalhes: 'A frase sorteada vai como enquete nativa com as opções Eu nunca e Eu já (voto único). Ex.: /eununca (também: /nuncaeu).'
  },
  {
    data: '2026-09-25',
    titulo: '/verdadeouconsequencia — verdade ou desafio no grupo',
    detalhes: 'Sorteia uma verdade ou um desafio: /verdadeouconsequencia (o destino é sorteado), /verdadeouconsequencia verdade, /verdadeouconsequencia desafio, ou marque alguém com @ pra jogar no lugar dela. Também: /vouc, /verdadeconsequencia.'
  },
  {
    data: '2026-09-25',
    titulo: '/explicarmeme — a IA explica a zoeira do meme',
    detalhes: 'Mande a imagem com o comando na legenda ou responda a ela que a IA explica o humor, o contexto e a referência do meme (também: /explicameme).'
  },
  {
    data: '2026-09-25',
    titulo: '/gerar-nome — a IA cria 5 nomes pra qualquer tema',
    detalhes: 'Descreva o tema em texto livre que a IA sugere 5 nomes criativos e bem diferentes entre si. Ex.: /gerar-nome rpg fantasia, /gerar-nome banda de rock (também: /gerarnome).'
  },
  {
    data: '2026-09-25',
    titulo: '/reescrever — reescreve qualquer texto em outro tom',
    detalhes: 'Mande o tom e o texto (ou responda a uma mensagem): /reescrever formal Aí mano, bora hoje? Tons: formal, informal, engraçado, poético, educado, profissional, agressivo e zoeira.'
  },
  {
    data: '2026-09-25',
    titulo: '/forca — jogo da forca no grupo',
    detalhes: 'Descubra a palavra letra por letra antes que o boneco se complete. Ex.: /forca (chute a letra ou a palavra direto no chat).'
  },
  {
    data: '2026-09-25',
    titulo: '/rimas — desafio da rima no grupo',
    detalhes: 'Sorteie uma palavra e desafie o grupo a rimar com ela. Ex.: /rimas (também: /rima).'
  },
  {
    data: '2026-09-23',
    titulo: '/adv — advertências com ban automático na 3ª',
    detalhes: 'Admins advertem com motivo: /adv @membro motivo. Na 3ª ativa o bot expulsa e joga na blacklist. Veja com /advs e perdoe com /remadv.'
  },
  {
    data: '2026-09-23',
    titulo: '/quiz — perguntas de múltipla escolha com ranking',
    detalhes: '5 perguntas por rodada; responda com a letra da alternativa (A-D). Ex.: /quiz geografia (também: /quiz parar pra encerrar).'
  },
  {
    data: '2026-09-23',
    titulo: '/eununca — a brincadeira do Eu nunca no grupo',
    detalhes: 'Sorteie frases Eu nunca pra todo mundo reagir. Ex.: /eununca (também: /nuncaeu).'
  },
  {
    data: '2026-09-23',
    titulo: '/tempo-resposta — saiba se o bot está rápido',
    detalhes: 'Mostra o tempo de resposta em ms, o tempo online e a latência do banco. Ex.: /tempo-resposta (também: /latencia).'
  },
  {
    data: '2026-09-23',
    titulo: '/conversor — conversor de unidades sem internet',
    detalhes: 'Converta distância, peso, temperatura, volume e velocidade na hora. Ex.: /conversor 10 km em milhas — ou /conversor 30 c em f.'
  },
  {
    data: '2026-09-23',
    titulo: '/hidetag corrigido — convocação voltou a funcionar pra todo admin',
    detalhes: 'Admins e donos não são mais barrados à toa. Use /hidetag <recado> para chamar todo o grupo.'
  },
  {
    data: '2026-09-22',
    titulo: '/traduzir — tradutor entre idiomas',
    detalhes: 'Traduza qualquer texto com detecção automática do idioma original. Ex.: /traduzir en Bom dia — ou responda a uma mensagem com /traduzir es.'
  },
  {
    data: '2026-09-20',
    titulo: '/resumir — resuma textões com a IA',
    detalhes: 'Mande /resumir <texto> ou responda a uma mensagem longa com /resumir para ganhar um resumo objetivo.'
  },
  {
    data: '2026-09-18',
    titulo: '/figurinha — figurinha SEM corte',
    detalhes: 'Diferente do /s (que corta a imagem), o /figurinha usa a foto inteira com fundo transparente. Envie a foto com /figurinha na legenda ou responda a ela.'
  },
  {
    data: '2026-09-15',
    titulo: '/transcrever — áudio e vídeo viram texto',
    detalhes: 'Responda a um áudio ou vídeo com /transcrever para receber o que foi dito escrito em texto.'
  },
  {
    data: '2026-09-12',
    titulo: 'Lembretes — /lembrete, /meuslembretes e /cancelarlembrete',
    detalhes: 'Agende avisos futuros: /lembrete 2h Beber água. Veja os pendentes com /meuslembretes e cancele com /cancelarlembrete <número>.'
  },
  {
    data: '2026-09-08',
    titulo: '/brat e /bratvid — capa estilo Brat em figurinha',
    detalhes: 'Gere a capinha verde do álbum da Charli XCX com seu texto: /brat hipnos bot (parada) ou /bratvid oi mundo (animada).'
  },
  {
    data: '2026-09-05',
    titulo: '/play, /tiktok e /pinterest — downloads direto no chat',
    detalhes: 'Baixe áudio do YouTube (/play <nome da música>), vídeos do TikTok sem marca d’água (/tiktok <link>) e pins do Pinterest (/pinterest <link>).'
  },
  {
    data: '2026-09-02',
    titulo: '/clima, /cep e /ddd — consultas do dia a dia',
    detalhes: 'Previsão do tempo (/clima Campinas), endereço de um CEP (/cep 01310-100) e estado/cidades de um DDD (/ddd 11).'
  },
  {
    data: '2026-08-28',
    titulo: '/nasa e /horoscopo — o céu no grupo',
    detalhes: 'Foto Astronômica do Dia com explicação em português (/nasa) e a leitura do dia do seu signo (/horoscopo leao).'
  },
  {
    data: '2026-08-25',
    titulo: '/wiki, /dicionario e /letra — conhecimento rápido',
    detalhes: 'Resumo da Wikipédia (/wiki Buraco Negro), significado de palavras (/dicionario efêmero) e letra de músicas (/letra Coldplay - Yellow).'
  },
  {
    data: '2026-08-20',
    titulo: '/afk — avise que você está ausente',
    detalhes: 'Marque-se como ausente com /afk <motivo>. Quem te mencionar recebe o aviso, e o status sai sozinho quando você voltar a falar.'
  },
  {
    data: '2026-08-15',
    titulo: '/ranking e /perfil — quem manda no grupo',
    detalhes: 'Veja os 10 membros mais ativos (/ranking) e o seu perfil com foto, cargo e posição (/perfil).'
  },
  {
    data: '2026-08-10',
    titulo: '/avaliar, /sugestao e boas-vindas com banner',
    detalhes: 'Dê nota ao bot (/avaliar 5), mande ideias aos donos (/sugestao <texto>) e receba novatos com banner ilustrado de boas-vindas.'
  }
]
