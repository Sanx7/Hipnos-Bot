// ============================================
// 📊 CHECKATIVO — Conta de mensagens do recinto
// ============================================
// Mostra quantas mensagens a pessoa já ecoou no grupo atual. Os dados vêm
// da MESMA fonte do /ranking: collection "ranking" no MongoDB, filtrada
// por grupo_id + usuario_id (ver ../../database.js).
//
// Como usar (uso LIVRE):
//   /checkativo                     -> as suas próprias mensagens
//   /checkativo @membro             -> as mensagens de quem foi marcado
//   responda a uma mensagem com /checkativo -> as mensagens do autor citado
//
// 🏷️ Apelidos (aliases): /mensagens, /msgs e /ativo — registrados pelo
// loader do bot.js (propriedade "aliases", novo suporte do loader).
// ============================================

const { limparNumero, formatarNumero } = require('../../config')
const { buscarEstatisticasUsuario } = require('../../database')

module.exports = {
  nome: 'checkativo',
  aliases: ['mensagens', 'msgs', 'ativo'],
  descricao: 'Mostra a quantidade de mensagens enviadas no grupo pela pessoa ou por quem foi marcado.',
  categoria: 'utilitario',

  async executar(sock, jid, msg) {
    try {
      // 1) 🚫 Este comando só faz sentido dentro de grupos
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, {
          text: '📊 *O /checkativo só funciona em grupos.*\n\n' +
            'As contas de mensagens são próprias de cada recinto — invoque o comando dentro do grupo desejado.'
        }, { quoted: msg })
      }

      // 2) 🎯 Alvo: menção (@) -> autor da mensagem respondida -> o próprio emissor
      const contextInfo = msg.message?.extendedTextMessage?.contextInfo
      const alvoJid = contextInfo?.mentionedJid?.[0] ||
        contextInfo?.participant ||
        msg.key.participant ||
        msg.key.remoteJid

      // Número limpo p/ o banco (resolve LID/telefone pelo helper do config)
      const usuarioId = limparNumero(alvoJid)
      const grupoId = jid

      // 3) 🗄️ Consulta a collection "ranking" (grupo_id + usuario_id)
      const estatisticas = await buscarEstatisticasUsuario(grupoId, usuarioId)

      // Banco indisponível (sem MONGODB_URI, conexão morta, etc.)
      if (!estatisticas) {
        return await sock.sendMessage(jid, {
          text: '🌑 *As sombras do banco não responderam...*\n\n' +
            'Não consegui consultar a contagem agora. Tente novamente em instantes.'
        }, { quoted: msg })
      }

      const { total, posicao, totalUsuarios, nome } = estatisticas

      // 4) Ainda sem eco no recinto -> resposta amigável
      if (!total) {
        return await sock.sendMessage(jid, {
          text: `💤 *@${alvoJid.split('@')[0]} ainda dorme em silêncio...*\n\n` +
            'Nenhuma mensagem ecoada neste recinto até agora.\n' +
            'Fale algo para despertar a contagem! 🌙',
          mentions: [alvoJid]
        }, { quoted: msg })
      }

      // 5) 📊 Monta a resposta com formatação pt-BR e a temática do Limbo
      const apelido = nome || formatarNumero(usuarioId)
      const palavra = total > 1 ? 'mensagens' : 'mensagem'
      const totalFormatado = total.toLocaleString('pt-BR')

      const linhaPosicao = posicao && totalUsuarios
        ? `🏆 Posição no ranking: *${posicao}º* de ${totalUsuarios.toLocaleString('pt-BR')} mortais\n`
        : ''

      const resposta =
        `📊 *CONTA DE MENSAGENS* 📊\n\n` +
        `👤 *${apelido}*\n` +
        `💬 Mensagens ecoadas no recinto: *${totalFormatado}* ${palavra}\n` +
        linhaPosicao +
        `\n💤 *"Cada palavra conta nos sonhos do Limbo."*`

      await sock.sendMessage(jid, {
        text: resposta,
        mentions: [alvoJid]
      }, { quoted: msg })
    } catch (err) {
      // 🛡️ Nenhum erro pode escapar para o listener principal (messages.upsert)
      console.error('[checkativo] erro ao contar mensagens:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram a contagem... Tente novamente.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}