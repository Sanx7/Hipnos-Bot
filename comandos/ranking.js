// ============================================
// 🏆 RANKING — Os Mestres da Palavra do Recinto
// ============================================
// Mostra os TOP 10 membros que mais enviaram mensagens NO GRUPO atual, agora
// como PERGAMINHO GREGO (imagem gerada com Jimp — ver ../pergaminho-ranking.js):
// frisco grego dourado, rolos de ouro no topo e na base e o nome de cada VIP
// pintado com a cor do `corVip`.
//
// 🛟 Se a imagem falhar por qualquer motivo, o comando cai no TEXTO de sempre
// (mesma lista, mesma formatação) — ninguém fica sem o ranking.
//
// Os dados vêm do MongoDB (ver ../database.js), onde TODA mensagem que passa
// pelo bot é registrada separada por grupo (remoteJid).
// ============================================

const { buscarRanking, normalizarId } = require('../database')
// 💠 Estilo dos VIPs no ranking (/nomecustom e /corvip — campos `nomeCustom`
// e `corVip` do documento VIP): nome escolhido e o emoji da cor.
const vip = require('../vip')

// Formatação legível dos números (fonte única: ../config — usada também pelo /dono)
const { formatarNumero } = require('../config')

// 🏛️ O desenho do pergaminho (e a miniatura do preview) vivem num módulo só.
const { comporPergaminhoRanking, miniaturaDoPergaminho } = require('../pergaminho-ranking')


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

// 🏛️ Gerador do pergaminho. Fica numa variável porque os testes trocam por um
// gerador que falha de propósito (para exercitar o fallback em texto).
let comporCapa = comporPergaminhoRanking

module.exports = {
  nome: 'ranking',
  descricao: 'Mostra os 10 membros mais ativos do grupo num pergaminho ilustrado.',

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
      const top = await buscarRanking(jid, 10)

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
      let nomeDoGrupo = ''
      try {
        const metadata = await sock.groupMetadata(jid)
        participantes = metadata.participants || []
        // 🏛️ O nome do grupo vira o subtítulo do pergaminho (se vier vazio, o
        // pergaminho usa o subtítulo padrão dele).
        nomeDoGrupo = String(metadata.subject || '').trim()
      } catch (err) {
        // Sem metadados o ranking continua funcionando (mostra só o número)
        console.error('Erro ao buscar metadados para o ranking:', err)
      }

      // 5) 🏷️🎨 Nome e cor custom dos VIPs (/nomecustom e /corvip — campos
      //    `nomeCustom` e `corVip` do documento VIP): UMA consulta só para os
      //    10 da lista. Quem definiu nome aparece com ele; quem definiu cor
      //    vê o emoji ANTES do nome ("🔥 João") no texto e o NOME PINTADO na
      //    cor no pergaminho. Os demais seguem no padrão (pushName do banco
      //    ou número). Falha do banco de VIPs não derruba o ranking —
      //    obterEstilosVip nunca lança e devolve mapa vazio.
      let estilos = new Map()
      try {
        estilos = await vip.obterEstilosVip(top.map((i) => i.usuario_id))
      } catch (errEstilo) {
        console.error('[ranking] ⚠️ falha ao ler nomes/cores dos VIPs:', errEstilo?.message || errEstilo)
      }

      // 6) Monta a lista numerada: cada item guarda os dados CRUS (para o
      //    pergaminho) e a linha de texto pronta (para o fallback).
      const itens = top.map((item, indice) => {
        const posicao = MEDALHAS[indice] || `${indice + 1}º`
        const estilo = estilos.get(normalizarId(item.usuario_id)) || {}
        const nome = estilo.nome || item.nome || formatarNumero(item.usuario_id)
        // 🎨 A cor do VIP entra antes do nome; sem cor, o nome fica como sempre.
        const nomeComCor = estilo.cor ? `${estilo.cor} ${nome}` : nome
        const total = item.total

        // Avisa se o usuário já não faz mais parte do grupo
        const aindaNoGrupo = participantes.some(
          (p) => normalizarParticipante(p) === item.usuario_id
        )
        const aviso = aindaNoGrupo ? '' : ' *(saiu do grupo)*'

        // Plural correto de "mensagem" em português: mensagem -> mensagens
        const palavra = item.total > 1 ? 'mensagens' : 'mensagem'

        return {
          posicao,
          nome,
          cor: estilo.cor || '',
          total,
          palavra,
          saiu: !aindaNoGrupo,
          linha: `${posicao} *${nomeComCor}* — *${total}* ${palavra}${aviso}`
        }
      })

      const linhas = itens.map((item) => item.linha)
      const resposta =
        '🏆 *RANKING DOS MAIS ATIVOS* 🏆\n\n' +
        'Os 10 reinos que mais ecoaram no recinto:\n\n' +
        linhas.join('\n\n') +
        '\n\n💤 *"O sono alcança até os mais falantes."*'

      // 7) 🏛️ O pergaminho em imagem. Qualquer tropeço aqui (arte, miniatura
      //    ou envio) cai no TEXTO logo abaixo, sem perder a lista.
      const legenda = '🏆 Pergaminho do ranking — os 10 mais ativos do recinto'
      try {
        const pergaminho = await comporCapa({ itens, subtitulo: nomeDoGrupo })
        const miniatura = await miniaturaDoPergaminho(pergaminho)
        const payload = { image: pergaminho, caption: legenda }
        if (miniatura) payload.jpegThumbnail = miniatura
        await sock.sendMessage(jid, payload, { quoted: msg })
      } catch (errPergaminho) {
        console.error('[ranking] ⚠️ pergaminho falhou, segue em texto:', errPergaminho?.message || errPergaminho)
        await sock.sendMessage(jid, { text: resposta }, { quoted: msg })
      }
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
  },

  // 🧪 Ganchos e peças para os testes offline (não viram comando).
  _injetarCapa (fn) { comporCapa = fn },
  _restaurarCapa () { comporCapa = comporPergaminhoRanking },
  __internos: {
    MEDALHAS,
    normalizarParticipante,
    comporPergaminhoRanking,
    miniaturaDoPergaminho
  }
}