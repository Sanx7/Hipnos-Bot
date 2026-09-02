// ============================================
// 🎲 DADO — A Vontade do Subconsciente de Hipnos
// ============================================
// Rola um dado com a quantidade de lados informada.
// Sem argumentos, usa o dado padrão de 6 lados.
// ============================================

// Lados padrão usados quando o comando é chamado sem argumentos
const LADOS_PADRAO = 6

// Limite de segurança para evitar números absurdos/overflow
const LADOS_MAX = 1000000000

// Frases de abertura escolhidas aleatoriamente a cada rolagem
const INTROS = [
  'As névoas do subconsciente revelam o número:',
  'O dado dos sonhos girou entre as dimensões...',
  'O pêndulo da hipnose apontou para o destino:',
  'Os tecidos do inconsciente sussurram o veredito:',
  'O oráculo do sono lançou o dado... e declarou:'
]

// Mensagens de erro com a temática mística do bot
const ERROS = [
  '⛔ Os reinos do sono não aceitam um número de lados inválido. Use um número inteiro positivo, como `/dado 20`.',
  '⛔ As sombras recusaram essa invocação. O número de lados precisa ser inteiro e maior que zero. Ex: `/dado 12`.',
  '⛔ Sua mente pediu algo que os sonhos não compreendem. Informe um número inteiro positivo de lados. Ex: `/dado 100`.'
]

// Erro específico quando o número de lados é grande demais
const ERRO_MAXIMO = `⛔ O dado excedeu os limites do sonho. O máximo de lados permitido é ${LADOS_MAX}.`

// Sorteia uma frase aleatória de uma lista
function sortearFrase(lista) {
  return lista[Math.floor(Math.random() * lista.length)]
}

// Rola um número aleatório entre 1 e a quantidade de lados
function rolarDado(lados) {
  return Math.floor(Math.random() * lados) + 1
}

module.exports = {
  nome: 'dado',
  descricao: 'Rola um dado de 6 lados ou com a quantidade de lados informada.',

  async executar(sock, jid, msg, texto) {
    try {
      // Extrai o que foi digitado depois de "/dado"
      const argumento = String(texto || '').replace(/^\/\S+\s*/, '').trim()

      // Sem argumento: rola o dado padrão de 6 lados
      if (!argumento) {
        const numero = rolarDado(LADOS_PADRAO)
        const mensagem = `${sortearFrase(INTROS)}\n\n🎲 O destino escolheu: *${numero}* (d${LADOS_PADRAO})`
        return await sock.sendMessage(jid, { text: mensagem }, { quoted: msg })
      }

      // Valida: a entrada deve ser apenas dígitos (inteiro positivo sem sinal)
      if (!/^\d+$/.test(argumento)) {
        return await sock.sendMessage(jid, { text: sortearFrase(ERROS) }, { quoted: msg })
      }

      const lados = parseInt(argumento, 10)

      // O número precisa ser maior que zero
      if (lados <= 0) {
        return await sock.sendMessage(jid, { text: sortearFrase(ERROS) }, { quoted: msg })
      }

      // Respeita o limite de segurança
      if (lados > LADOS_MAX) {
        return await sock.sendMessage(jid, { text: ERRO_MAXIMO }, { quoted: msg })
      }

      const numero = rolarDado(lados)
      const mensagem = `${sortearFrase(INTROS)}\n\n🎲 O destino escolheu: *${numero}* (d${lados})`

      await sock.sendMessage(jid, { text: mensagem }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando dado:', err)
      await sock.sendMessage(jid, {
        text: '⛔ Os tecidos do sonho se romperam... Tente novamente.'
      }, { quoted: msg })
    }
  }
}