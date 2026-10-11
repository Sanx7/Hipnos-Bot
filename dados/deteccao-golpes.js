const { temLinkHard } = require('./deteccao-links')
function normalizar(texto) {
  return String(texto || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}
const PESOS = Object.freeze({ credenciais: 4, identidade: 3, urgencia: 2, financeiro: 3, premiacao: 3, pagamento: 3, dados: 3, verificacao: 3, link: 2 })
const LIMIARES = Object.freeze({ baixa: { medio: 8, alto: 11 }, media: { medio: 5, alto: 8 }, alta: { medio: 4, alto: 7 } })
const NOMES = Object.freeze({ credenciais: 'Pedido de credenciais', identidade: 'Identidade de suporte ou administração', urgencia: 'Pressão por urgência',
  financeiro: 'Promessa financeira irreal', premiacao: 'Oferta de premiação', pagamento: 'Pagamento antecipado', dados: 'Solicitação de dados pessoais', verificacao: 'Verificação de conta solicitada', link: 'Link associado aos sinais' })
const PADROES = {
  credenciais: /\b(?:envie|enviar|mande|mandar|informe|informar|passe|passar|compartilhe|digite|me de|me diga|qual e|preciso d[ao])\b.{0,55}\b(?:senha|codigo (?:de verificacao|recebido|enviado|por sms|do sms)|codigo sms|codigo de seis digitos)\b/,
  identidade: /\b(?:sou|somos|aqui e|equipe|central|funcionario|administrador|suporte)\b.{0,35}\b(?:suporte|whatsapp|administracao|administrador d[oe] grupo)\b/,
  urgencia: /\b(?:sua conta (?:sera|vai ser) bloqueada|voce tem (?:[1-9]|10) minutos?|clique agora|ultima chance|perdera o acesso|urgente.{0,25}(?:conta|saque|pagamento))\b/,
  financeiro: /\b(?:dinheiro facil|retorno (?:financeiro )?garantido|lucro (?:garantido|absurdo)|dobre (?:seu|o) dinheiro|(?:ganhe|lucre) [0-9]+ (?:reais|por cento) (?:por|ao) dia|investimento sem risco)\b/,
  premiacao: /\b(?:voce ganhou (?:um |o |seu )?premio|resgate (?:seu|o) premio|saque liberado|parabens voce foi selecionad[oa])\b/,
  pagamento: /\b(?:pague|pagar|envie|enviar|mande|mandar|deposite|depositar|transferir|transfira)\b.{0,35}\b(?:taxa|pix|pagamento|deposito|reais)\b.{0,40}\b(?:liberar|receber|resgatar|validar|desbloquear|antecipad[oa])\b|\b(?:taxa|pagamento) antecipad[oa].{0,40}(?:premio|saque|liberar)\b/,
  dados: /\b(?:envie|enviar|mande|mandar|informe|informar|preencha|preciso d[oe])\b.{0,40}\b(?:cpf|dados pessoais|dados bancarios|numero do cartao)\b/,
  verificacao: /\b(?:verifique|valide|atualize)\b.{0,25}\b(?:sua conta|conta do whatsapp)\b/
}
function analisar(texto, sensibilidade = 'media', excecoes = []) {
  if (!LIMIARES[sensibilidade]) throw new Error('Sensibilidade inválida')
  const sinais = new Set()
  let link = false, premiacaoPermitida = false
  // Contexto local: uma frase educativa não desativa o restante da mensagem.
  const conteudo = String(texto || '').replace(/(?:exemplo de golpe|recebi uma mensagem (?:suspeita|de golpe)|alerta de golpe)\s*:\s*["“][^"”]*["”]/giu, '')
  for (const frase of conteudo.split(/(?:[.!?]\s+|[\n;]+)/u)) {
    const n = normalizar(frase)
    if (!n || /^(?:alerta de golpe|aviso de golpe|exemplo de golpe|nao (?:envie|mande|informe|compartilhe|clique|pague)|nunca (?:envie|mande|compartilhe|pague)|jamais (?:envie|mande|compartilhe))\b/.test(n) ||
        /^(?:cuidado|atencao)\b.*\b(?:golpes?|fraude)\b/.test(n) ||
        /\b(?:alguem tentou me dar um golpe|recebi uma mensagem (?:suspeita|de golpe)|isso e (?:um )?golpe)\b/.test(n)) continue
    for (const [categoria, regex] of Object.entries(PADROES)) {
      if (!regex.test(n)) continue
      if (categoria === 'premiacao' && excecoes.some(t => (` ${n} `).includes(` ${normalizar(t)} `))) { premiacaoPermitida = true; continue }
      // Negação imediatamente antes do pedido não é evidência de solicitação.
      if (['credenciais', 'pagamento', 'dados'].includes(categoria) && /\b(?:nao|nunca|jamais)\s+(?:envie|mande|informe|compartilhe|digite|pague|preencha)\b/.test(n)) continue
      sinais.add(categoria)
    }
    if (temLinkHard(frase)) link = true
  }
  // A expressão aprovada não reduz pontuação de mensagens com pedidos de
  // credenciais, dados, pagamento ou promessa financeira, mesmo noutra frase.
  if (premiacaoPermitida && ['credenciais', 'dados', 'pagamento', 'financeiro', 'verificacao'].some(s => sinais.has(s))) sinais.add('premiacao')
  const primarios = [...sinais].filter(s => !['urgencia', 'identidade'].includes(s))
  if (link && primarios.length) sinais.add('link')
  const categorias = [...sinais]
  const pontuacao = categorias.reduce((p, s) => p + PESOS[s], 0)
  const limiar = LIMIARES[sensibilidade]
  // Sempre exigir duas categorias e pelo menos um sinal específico de fraude.
  const suficiente = categorias.length >= 2 && primarios.length > 0
  const risco = suficiente && pontuacao >= limiar.alto ? 'alto' : suficiente && pontuacao >= limiar.medio ? 'medio' : 'baixo'
  return { risco, pontuacao, categorias }
}
module.exports = { analisar, normalizar, PESOS, LIMIARES, NOMES }
