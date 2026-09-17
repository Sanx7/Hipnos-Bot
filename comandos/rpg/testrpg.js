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
// 🪪 Resolução LID→número real (lid.js — mesmo módulo do /darvip)
const { resolverNumeroAlvo } = require('../../lid')

module.exports = {
  nome: 'testrpg',
  descricao: 'Testa a fundação do RPG: lê/cria seu jogador no banco e mostra os dados.',

  async executar(sock, jid, msg, texto) {
    try {
      // 🔎 JID do remetente: em grupos o autêntico está em
      // msg.key.participant (o remetente da mensagem); fora de grupos
      // usa msg.key.remoteJid (o próprio chat). Igual aos outros comandos.
      let sender = msg.key?.participant || msg.key?.remoteJid || jid

      // 🪪 RESOLUÇÃO LID→NÚMERO REAL (lid.js — mesmo padrão do /darvip):
      // o remetente pode chegar como "@lid"; consultar o jogador por LID
      // quebra a base indexada por telefone (MESMO bug dos VIPs).
      // Grupo → metadados (phoneNumber); privado → mapeamento da sessão.
      // Sem resolução possível, segue com o LID cru + warning no log
      // (scripts/migrar-rpg-lid.js corrige os registros depois — idempotente).
      if (String(sender).endsWith('@lid')) {
        let participantes = null
        if (jid.endsWith('@g.us')) {
          try {
            participantes = (await sock.groupMetadata(jid)).participants
          } catch (err) {
            console.error('[testrpg] sem metadados do grupo p/ resolver @lid:', err?.message || err)
          }
        }
        const resolucao = await resolverNumeroAlvo(participantes, sender)
        if (resolucao.numero && resolucao.via !== null) {
          console.log(`[testrpg] 🪪 remetente resolvido de @lid p/ o número real ${resolucao.numero} via ${resolucao.via}`)
          sender = resolucao.numero
        } else {
          console.warn('[testrpg] 🪪 @lid do remetente não resolvível — seguindo com o LID cru (corrigível via scripts/migrar-rpg-lid.js)')
        }
      }

      // 1) Lê/cria o jogador (getPlayer cria com os padrões se não existir)
      const jogador = await getPlayer(sender)

      // 2) Formata a data de criação
      // ⚠️ FIX DO TDZ (temporal dead zone): o código antigo era
      // `const criadoEm = jogador.criadoEm ? new Date(criadoEm)...` — a própria
      // `criadoEm` era usada DENTRO do inicializador do `const` (linha 32),
      // antes de existir → ReferenceError: Cannot access 'criadoEm' before
      // initialization. Agora a data bruta fica numa variável própria e só
      // depois é formatada (declaração sempre antes do uso).
      const criadoEmBruto = jogador.criadoEm
      const criadoEm = criadoEmBruto
        ? new Date(criadoEmBruto).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
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