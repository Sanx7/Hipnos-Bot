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

// Retorna o JID real e mencionável de um participante do grupo.
// - Prefere `phoneNumber` (número real @s.whatsapp.net) quando o WhatsApp
//   entrega o participante como LID (@lid);
// - Mantém o domínio ORIGINAL do id — NUNCA reconstroi @s.whatsapp.net a
//   partir de um LID (isso era o que gerava números de telefone falsos);
// - Remove o sufixo de dispositivo (:N) para a menção renderizar.
function jidMencionavel(participante) {
  const bruto = participante?.phoneNumber || participante?.id || ''
  const [usuario, servidor] = String(bruto).split('@')
  if (!usuario || !servidor) return ''
  return `${usuario.split(':')[0]}@${servidor}`
}

// Extrai apenas os dígitos de um JID, para comparar com o número do bot
function apenasDigitos(jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
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

      // 1) Busca a lista REAL de participantes do grupo via Baileys
      const metadados = await sock.groupMetadata(jid)
      const participantes = metadados.participants || []

      // 2) Converte cada participante no JID "mencionável" real
      //    (prefere phoneNumber, mantém o domínio original, remove :dispositivo),
      //    deduplica e exclui o próprio bot para nunca sortear ele mesmo.
      const numeroDoBot = apenasDigitos(sock.user?.id)
      const alvos = participantes
        .map(jidMencionavel)
        .filter(Boolean)
        .filter((jidAlvo, indice, lista) => lista.indexOf(jidAlvo) === indice) // deduplica
        .filter((jidAlvo) => {
          if (!numeroDoBot) return true
          return apenasDigitos(jidAlvo) !== numeroDoBot
        })

      // 3) Um casal precisa de pelo menos duas almas válidas
      if (alvos.length < 2) {
        return await sock.sendMessage(jid, { text: AVISO_POUCAS_ALMAS }, { quoted: msg })
      }

      // 4) Sorteia duas pessoas DIFERENTES (sem repetir a mesma)
      const [pessoa1, pessoa2] = sortearDoisDistintos(alvos)

      // Porcentagem de compatibilidade aleatória (1 a 100)
      const compatibilidade = Math.floor(Math.random() * 100) + 1

      // Usa os dígitos do MESMO JID que vai no mentions[] (texto e menção casam)
      const numero1 = pessoa1.split('@')[0]
      const numero2 = pessoa2.split('@')[0]

      const mensagem = sortearFrase(FALAS)
        .replace('{p1}', `@${numero1}`)
        .replace('{p2}', `@${numero2}`)
        .replace('{c}', compatibilidade)

      // 5) Responde marcando as duas pessoas sorteadas com o JID REAL delas
      await sock.sendMessage(jid, {
        text: mensagem,
        mentions: [pessoa1, pessoa2]
      }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando casal:', err)
      await sock.sendMessage(jid, {
        text: '💞 O véu do amor se rasgou... Tente novamente.'
      }, { quoted: msg })
    }
  }
}