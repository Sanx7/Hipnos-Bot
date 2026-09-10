// ============================================================
// 🧪 TESTRPG — Comando de teste da fundação do RPG (uso LIVRE)
// ============================================================
// Fase 0 do sistema de RPG. NÃO implementa nenhum jogo: apenas chama
// getPlayer() para o número que mandou a mensagem e responde
// confirmando que os dados foram lidos/criados no MongoDB (mostra o
// JID e o criadoEm). Serve para validar que a base funciona.
//
// Formato de export: nome + executar (o padrão ATUAL do loader do
// bot.js). NÃO é o formato antigo (comando/handler) que quebrava o
// carregamento (o bug do /play).
// ============================================================

const { getPlayer } = require('../../rpg/database')

module.exports = {
  nome: 'testrpg',
  descricao: 'Testa a fundação do RPG: lê/cria seu jogador no banco e mostra os dados.',

  async executar(sock, jid, msg, texto) {
    try {
      // 🔎 JID do remetente: em grupos o autêntico está em
      // msg.key.participant (o remetente da mensagem); fora de grupos
      // usa msg.key.remoteJid (o próprio chat). Igual aos outros comandos.
      const sender = msg.key?.participant || msg.key?.remoteJid || jid

      // 1) Lê/cria o jogador (getPlayer cria com os padrões se não existir)
      const jogador = await getPlayer(sender)

      // 2) Formata a data de criação
      const criadoEm = jogador.criadoEm
        ? new Date(criadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        : '?'
      const novoJogador = !jogador._id ? '✅ Criado agora!' : '📖 Já existia'

      // 3) Resposta confirmando leitura/criação (mostra JID e criadoEm)
      await sock.sendMessage(jid, {
        text:
          `🧪 *RPG — Fundação OK* 🎲\n\n` +
          `👤 JID: \`${jogador.jid}\`\n` +
          `🆔 Status: ${novoJogador}\n` +
          `🗓️ Criado em: ${criadoEm}\n\n` +
          `💰 carteira: ${jogador.carteira} | banco: ${jogador.banco}\n` +
          `⚡ energia: ${jogador.energia} | 🍔 fome: ${jogador.fome}\n` +
          `💼 emprego: ${jogador.emprego || '—'}`
      }, { quoted: msg })

    } catch (err) {
      // 🛡️ Nada escapa pro socket — loga e avisa com calma
      console.error('[testrpg] 💥 erro ao acessar o banco do RPG:', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⚠️ *Não consegui falar com o reino dos sonhos agora.*\n\nO sistema de RPG não está disponível no momento — verifique se o MongoDB está acessível. Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}