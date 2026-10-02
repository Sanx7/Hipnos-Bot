// ============================================
// 🏆 RANKING — Os Mestres da Palavra do Recinto
// ============================================
// Mostra os TOP 7 membros que mais enviaram mensagens NO GRUPO atual, num
// QUADRO GREGO (imagem + texto desenhado por cima via Jimp — ver
// ../dados/ranking-pergaminho.js). A arte é o arquivo
// assets/quadros/ranking-pergaminho.png: moldura grega, rolos dourados,
// templo no cabeçalho e as 7 posições do pódio (coroa + louros + número),
// cada uma com a linha pontilhada onde o nome e a contagem são escritos.
// O nome sai na cor do `corVip` de quem configurou (/corvip).
//
// ⚠️ São 7 posições porque são 7 as que a imagem tem — e não há linha para a
// 8ª. O corte para 7 acontece DEPOIS do agrupamento por número (passo 5.5),
// para o documento do telefone da mesma pessoa não ficar de fora.
//
// 🛟 Se a imagem falhar por qualquer motivo (quadro ausente, Jimp, envio), o
// comando cai no TEXTO de sempre (mesma lista, mesma formatação) — ninguém
// fica sem o ranking.
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
// 🪪 Resolução dos identificadores do BANCO (podem ser LID cru) para o número
// real e AGRUPAMENTO das linhas da MESMA pessoa. O módulo compartilhado
// ../ranking-registro.js é o MESMO que o bot.js usa para GRAVAR pelo número real
// e que o /procurado usa para achar o líder — assim escrita, VIP/cor e exibição
// falam sempre do mesmo identificador:
//   • LIMITE_BUSCA_AGRUPAMENTO — quantas linhas buscar ANTES de agrupar;
//   • resolverNumeros(participantes, ids) — idCru → número real;
//   • agruparPorNumero(itens, numeros) — soma as linhas do mesmo número.
const {
  LIMITE_BUSCA_AGRUPAMENTO,
  resolverNumeros,
  agruparPorNumero
} = require('../ranking-registro')

// 🏛️ O quadro de honra (e a miniatura do preview) vivem num módulo só.
const { comporPergaminhoRanking, miniaturaDoPergaminho, POSICOES_RANKING } = require('../dados/ranking-pergaminho')


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

// 📏 Quantas posições o QUADRO tem (7 — uma por linha pontilhada do asset).
// É a fonte da verdade do corte do top: mais que isso não tem onde escrever.
const LIMITE_EXIBIDOS = POSICOES_RANKING.length

// 🏛️ Gerador do quadro. Fica numa variável porque os testes trocam por um
// gerador que falha de propósito (para exercitar o fallback em texto).
let comporCapa = comporPergaminhoRanking

module.exports = {
  nome: 'ranking',
  descricao: 'Mostra os 7 membros mais ativos do grupo num quadro ilustrado.',

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

      // 2) Busca no banco as linhas do grupo atual (filtrado por grupo_id).
      //    🪪 LIMITE_BUSCA_AGRUPAMENTO (maior que 7) de propósito: o
      //    agrupamento por número (passo 5.5) pode juntar o LID e o telefone da
      //    MESMA pessoa, e o documento do telefone costuma estar fora do top 7.
      const bruto = await buscarRanking(jid, LIMITE_BUSCA_AGRUPAMENTO)

      // 3) Grupo ainda sem mensagens registradas -> resposta amigável
      if (!bruto.length) {
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
        // 🏛️ O nome do grupo vira o subtítulo do quadro (na faixa vazia entre o
        // templo e a 1ª posição).
        nomeDoGrupo = String(metadata.subject || '').trim()
      } catch (err) {
        // Sem metadados o ranking continua funcionando (mostra só o número)
        console.error('Erro ao buscar metadados para o ranking:', err)
      }

      // 5) 🪪 Resolve os identificadores do ranking para o NÚMERO REAL (LID cru
      //    → telefone) ANTES de consultar os VIPs. Sem isso, em grupo com LID
      //    habilitado o documento de VIP (gravado pelo /darvip pelo número
      //    real) nunca é encontrado: o nome sai do banco e a cor do VIP some.
      //    Detalhes do problema e do porquê em `resolverNumeros`.
      //    Falha aqui não derruba o ranking — cai no identificador cru.
      let numeros = new Map()
      try {
        numeros = await resolverNumeros(participantes, bruto.map((i) => i.usuario_id))
      } catch (errResolucao) {
        console.error('[ranking] ⚠️ falha ao resolver os identificadores:', errResolucao?.message || errResolucao)
      }

      // 5.5) 📊 AGRUPA POR NÚMERO RESOLVIDO e só ENTÃO corta no tamanho do quadro: a
      //    mesma pessoa com LID + telefone no banco vira UMA linha com a SOMA
      //    (sem isso ela apareceria duas vezes e o ranking ficaria com um
      //    "buraco"). O corte é no FIM porque cortar antes jogaria fora justamente
      //    o documento do telefone, que pode estar fora das 7 primeiras.
      let top = []
      try {
        top = agruparPorNumero(bruto, numeros).slice(0, LIMITE_EXIBIDOS)
      } catch (errAgrupamento) {
        console.error('[ranking] ⚠️ falha ao agrupar por número (usando as linhas cruas):', errAgrupamento?.message || errAgrupamento)
        top = bruto.slice(0, LIMITE_EXIBIDOS)
      }

      // 6) 💠 Estilos dos VIPs entre os 7 do pódio (/nomecustom e /corvip —
      //    campos `nomeCustom` e `corVip` do documento VIP): UMA consulta só,
      //    feita com os NÚMEROS REAIS resolvidos acima. Quem definiu nome
      //    aparece com ele; quem definiu cor vê o emoji ANTES do nome
      //    ("🔥 João") no texto e o NOME PINTADO na cor no quadro. Os
      //    demais seguem no padrão (pushName do banco ou número). Falha do
      //    banco de VIPs não derruba o ranking — obterEstilosVip nunca lança
      //    e devolve mapa vazio.
      let estilos = new Map()
      try {
        estilos = await vip.obterEstilosVip([...new Set(numeros.values())])
      } catch (errEstilo) {
        console.error('[ranking] ⚠️ falha ao ler nomes/cores dos VIPs:', errEstilo?.message || errEstilo)
      }

      // 7) Monta a lista numerada: cada item guarda os dados CRUS (para o
      //    quadro) e a linha de texto pronta (para o fallback).
      const itens = top.map((item, indice) => {
        const posicao = MEDALHAS[indice] || `${indice + 1}º`
        // 🔑 A chave do mapa de estilos é o NÚMERO REAL resolvido no passo 5 —
        //    e não o `usuario_id` cru do banco (que num grupo com LID é o LID
        //    e nunca casava com o documento de VIP).
        const idCru = normalizarId(item.usuario_id)
        const estilo = estilos.get(numeros.get(idCru) || idCru) || {}
        const nome = estilo.nome || item.nome || formatarNumero(item.usuario_id)
        // 🎨 A cor do VIP entra antes do nome; sem cor, o nome fica como sempre.
        const nomeComCor = estilo.cor ? `${estilo.cor} ${nome}` : nome
        const total = item.total

        // Avisa se o usuário já não faz mais parte do grupo. Compara o id cru
        // E o número real: num grupo com LID cada lado pode estar no outro
        // formato (participante pelo LID, banco pelo telefone, ou vice-versa).
        const numeroReal = numeros.get(idCru)
        // 🪪 Depois do agrupamento o item pode ter VÁRIOS identificadores (o
        //    LID e o telefone da mesma pessoa): basta UM deles estar no grupo.
        const idsDoItem = Array.isArray(item.ids) && item.ids.length ? item.ids : [idCru]
        const aindaNoGrupo = participantes.some((p) => {
          const idDoParticipante = normalizarParticipante(p)
          return idsDoItem.includes(idDoParticipante) || (numeroReal && idDoParticipante === numeroReal)
        })
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
        `Os ${LIMITE_EXIBIDOS} reinos que mais ecoaram no recinto:\n\n` +
        linhas.join('\n\n') +
        '\n\n💤 *"O sono alcança até os mais falantes."*'

      // 8) 🏛️ O quadro em imagem. Qualquer tropeço aqui (arte, miniatura
      //    ou envio) cai no TEXTO logo abaixo, sem perder a lista.
      const legenda = `🏆 Quadro do ranking — os ${LIMITE_EXIBIDOS} mais ativos do recinto`
      try {
        const quadro = await comporCapa({ itens, subtitulo: nomeDoGrupo })
        const miniatura = await miniaturaDoPergaminho(quadro)
        const payload = { image: quadro, caption: legenda }
        if (miniatura) payload.jpegThumbnail = miniatura
        await sock.sendMessage(jid, payload, { quoted: msg })
      } catch (errQuadro) {
        console.error('[ranking] ⚠️ quadro falhou, segue em texto:', errQuadro?.message || errQuadro)
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
    LIMITE_EXIBIDOS,
    POSICOES_RANKING,
    normalizarParticipante,
    resolverNumeros,
    agruparPorNumero,
    LIMITE_BUSCA_AGRUPAMENTO,
    comporPergaminhoRanking,
    miniaturaDoPergaminho
  }
}