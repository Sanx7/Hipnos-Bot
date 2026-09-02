// ============================================
// 💞 CASAL — Os Amantes Oníricos de Hipnos
// ============================================
// Sorteia dois participantes diferentes do grupo
// e forma um "casal" com mensagem engraçada e
// uma porcentagem de compatibilidade aleatória.
// Fora de grupo, avisa que só funciona em grupos.
// ============================================

// Frases que apresentam o casal (placeholders {p1}, {p2}, {c})
const FALAS = [
  '💞 {p1} e {p2} se encontraram nos braços de Morfeu... e o sonho os uniu para sempre! 😴 Compatibilidade: {c}%',
  '😳 O pêndulo da hipnose cruzou os fios entre {p1} e {p2}... e o feitiço foi lançado! 💘 Compatibilidade: {c}%',
  '💑 {p1} e {p2} sonharam um com o outro na mesma noite... o subconsciente não mente! Compatibilidade: {c}%',
  '🔮 Entre as névoas do destino, {p1} e {p2} foram escolhidos para dividir o mesmo sonho. 💖 Compatibilidade: {c}%',
  '😴 {p1}, o destino sonhou com você agarradinho a {p2}... não há como escapar do amor onírico! 💞 Compatibilidade: {c}%',
  '🌙 Os espíritos do grupo apontaram {p1} e {p2}... casou, casou! 📿 Compatibilidade: {c}%'
]

// Aviso enviado quando o comando é usado fora de um grupo
const AVISO_FORA_GRUPO = '💞 Os sonhos só formam casais dentro de um grupo. Use este comando no grupo para Hipnos unir duas almas.'

// Aviso enviado quando o grupo não tem almas suficientes
const AVISO_POUCAS_ALMAS = '💞 O subconsciente não encontrou almas suficientes neste grupo para formar um casal. São necessários pelo menos dois participantes.'

// Sorteia uma frase aleatória de uma lista
function sortearFrase(lista) {
  return lista[Math.floor(Math.random() * lista.length)]
}

// Converte qualquer JID (com sufixo de device) no formato limpo para menção
function normalizarJid(id) {
  const numero = String(id).split('@')[0].split(':')[0]
  return `${numero}@s.whatsapp.net`
}

// Sorteia dois itens distintos de uma lista (embaralhamento Fisher-Yates)
function sortearDoisDistintos(lista) {
  const copia = [...lista]
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copia[i], copia[j]] = [copia[j], copia[i]]
  }
  return [copia[0], copia[1]]
}

module.exports = {
  nome: 'casal',
  descricao: 'Sorteia dois participantes do grupo e forma um casal com compatibilidade.',

  async executar(sock, jid, msg) {
    try {
      // Só funciona dentro de grupos
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, { text: AVISO_FORA_GRUPO }, { quoted: msg })
      }

      // Busca os participantes do grupo via Baileys
      const metadados = await sock.groupMetadata(jid)
      const participantes = metadados.participants.map((p) => p.id)

      // Exclui o próprio bot para nunca formar casal com ele
      const numeroDoBot = (sock.user?.id || '').split('@')[0].split(':')[0]
      const alvos = participantes.filter((participante) => {
        if (!numeroDoBot) return true
        return String(participante).split('@')[0].split(':')[0] !== numeroDoBot
      })

      // Um casal precisa de pelo menos duas almas válidas
      if (alvos.length < 2) {
        return await sock.sendMessage(jid, { text: AVISO_POUCAS_ALMAS }, { quoted: msg })
      }

      // Sorteia duas pessoas diferentes (sem repetir)
      const [pessoa1, pessoa2] = sortearDoisDistintos(alvos)

      // Porcentagem de compatibilidade aleatória (1 a 100)
      const compatibilidade = Math.floor(Math.random() * 100) + 1

      const numero1 = pessoa1.split('@')[0].split(':')[0]
      const numero2 = pessoa2.split('@')[0].split(':')[0]

      const mensagem = sortearFrase(FALAS)
        .replace('{p1}', `@${numero1}`)
        .replace('{p2}', `@${numero2}`)
        .replace('{c}', compatibilidade)

      // Responde marcando as duas pessoas sorteadas
      await sock.sendMessage(jid, {
        text: mensagem,
        mentions: [normalizarJid(pessoa1), normalizarJid(pessoa2)]
      }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando casal:', err)
      await sock.sendMessage(jid, {
        text: '💞 O véu do amor se rasgou... Tente novamente.'
      }, { quoted: msg })
    }
  }
}