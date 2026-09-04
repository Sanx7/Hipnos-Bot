// ============================================
// 🏆 RANKING — Os Mestres da Palavra do Recinto
// ============================================
// Mostra os TOP 10 membros que mais enviaram mensagens NO GRUPO atual.
// Os dados vêm do banco SQLite (ver ../database.js), onde TODA mensagem
// que passa pelo bot é registrada separada por grupo (remoteJid).
// ============================================

const { buscarRanking, normalizarId } = require('../database')

// Formatação legível dos números (fonte única: ../config — usada também pelo /dono)
const { formatarNumero } = require('../config')

// Normaliza um participante (objeto ou JID) para comparar com o usuário salvo
function normalizarParticipante(participante) {
  if (!participante) return ''
  const idStr =
    typeof participante === 'object'
      ? participante.id || participante.jid || ''
      : String(participante)
  return idStr.split('@')[0].split(':')[0].replace(/\D/g, '')
}

// Medalhas para o pódio do TOP 3; depois vira "4º", "5º"...
const MEDALHAS = ['🥇', '🥈', '🥉']

module.exports = {
  nome: 'ranking',
  descricao: 'Mostra os 10 membros que mais enviaram mensagens no grupo.',

  async executar(sock, jid, msg) {
    try {
      // 1) O /ranking só faz sentido dentro de um grupo
      if (!jid.endsWith('@g.us')) {
        return sock.sendMessage(
          jid,
          {
            text:
              '💤 *O /ranking só funciona em grupos.*\n\n' +
              'Invoque este comando dentro de um grupo para ver os mais ativos do recinto.'
          },
          { quoted: msg }
        )
      }

      // 2) Busca no banco os TOP 10 do grupo atual (filtrado por grupo_id)
      const top = buscarRanking(jid, 10)

      // 3) Grupo ainda sem mensagens registradas -> resposta amigável
      if (!top.length) {
        return sock.sendMessage(
          jid,
          {
            text:
              '🌑 *O recinto ainda está em silêncio...*\n\n' +
              'Ainda não há mensagens registradas neste grupo. 💤\n' +
              'Envie algumas mensagens e chame o /ranking novamente.'
          },
          { quoted: msg }
        )
      }

      // 4) Tenta obter os participantes para saber nomes atuais e quem saiu
      let participantes = []
      try {
        const metadata = await sock.groupMetadata(jid)
        participantes = metadata.participants || []
      } catch (err) {
        // Sem metadados o ranking continua funcionando (mostra só o número)
        console.error('Erro ao buscar metadados para o ranking:', err)
      }

      // 5) Monta a lista numerada com nome/número + total de mensagens
      const linhas = top.map((item, indice) => {
        const posicao = MEDALHAS[indice] || `${indice + 1}º`
        const nome =
          item.nome || formatarNumero(item.usuario_id)
        const total = item.total

        // Avisa se o usuário já não faz mais parte do grupo
        const aindaNoGrupo = participantes.some(
          (p) => normalizarParticipante(p) === item.usuario_id
        )
        const aviso = aindaNoGrupo ? '' : ' *(saiu do grupo)*'

        // Plural correto de "mensagem" em português: mensagem -> mensagens
        const palavra = item.total > 1 ? 'mensagens' : 'mensagem'

        return `${posicao} *${nome}* — *${total}* ${palavra}${aviso}`
      })

      const resposta =
        '🏆 *RANKING DOS MAIS ATIVOS* 🏆\n\n' +
        'Os 10 reinos que mais ecoaram no recinto:\n\n' +
        linhas.join('\n\n') +
        '\n\n💤 *"O sono alcança até os mais falantes."*'

      await sock.sendMessage(jid, { text: resposta }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando ranking:', err)
      await sock.sendMessage(
        jid,
        {
          text: '⛔ As sombras confundiram o ranking... Tente novamente.'
        },
        { quoted: msg }
      )
    }
  }
}