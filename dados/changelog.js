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
