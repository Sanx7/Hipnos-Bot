// ============================================================
// 💵 SACAR — Banco → Carteira (Fase 2 — economia)
// ============================================================
// Uso: /sacar <valor|todos>      (aliases: /saque, /retirar)
//   Ex.: /sacar 500  •  /sacar 1.234,56  •  /sacar todos
//
// Espelho do /depositar (mesmas regras, direção contrária):
//   - valor precisa ser um número POSITIVO (zero, negativo ou texto → recusa);
//   - precisa ter saldo suficiente no BANCO;
//   - "todos"/"tudo" saca o saldo INTEIRO do banco;
//   - UMA escrita atômica via rpg/economia.js (moverSaldo): $inc duplo no
//     mesmo documento com condição de saldo ($gte) no filtro.
//
// Lembrete de design: só o dinheiro na CARTEIRA pode ser transferido (e,
// no futuro, roubado — Fase 7). Sacar é o que "expõe" o seu dinheiro.
//
// Persistência: rpg/database.js (getPlayer resolve o LID internamente).
// ============================================================

const { getPlayer } = require('../../rpg/database')
const { formatarReais, parseValor, moverSaldo } = require('../../rpg/economia')

module.exports = {
  nome: 'sacar',
  aliases: ['saque', 'retirar'],
  descricao: 'Saca dinheiro do banco para a carteira. Uso: /sacar <valor|todos>',

  async executar(sock, jid, msg, texto) {
    try {
      // 👤 JID do remetente (mesma convenção dos outros comandos do RPG)
      const sender = msg.key?.participant || msg.key?.remoteJid || jid

      // ✂️ "/sacar <valor>" — só o 1º argumento é usado
      const tokenValor = String(texto || '').trim().split(/\s+/).filter(Boolean)[1]

      if (!tokenValor) {
        return await sock.sendMessage(jid, {
          text:
            '💵 *Como sacar do seu cofre onírico:*\n\n' +
            '`/sacar <valor>`\n\n' +
            '✏️ Exemplos: `/sacar 500` • `/sacar 1.234,56` • `/sacar todos`\n' +
            '_(`todos` saca o saldo inteiro do banco)_'
        }, { quoted: msg })
      }

      // 🧮 Aceita "500", "1.234,56", "todos"/"tudo"; recusa 0, negativo e texto
      let valor = parseValor(tokenValor)
      if (valor === null) {
        return await sock.sendMessage(jid, {
          text:
            `🚫 *Valor inválido:* "${tokenValor}"\n\n` +
            'Use um número positivo (ex.: `100`, `1.234,56`) ou `todos`.'
        }, { quoted: msg })
      }

      // 🏦 "todos" → descobre o saldo inteiro do banco ANTES de mover
      if (valor === 'todos') {
        const jogador = await getPlayer(sender)
        const saldoBanco = Math.round((Number(jogador.banco) || 0) * 100) / 100
        if (saldoBanco <= 0) {
          return await sock.sendMessage(jid, {
            text:
              '🏦 *Seu banco está vazio* — não há nada para sacar.\n\n' +
              '💰 Use `/depositar <valor>` para guardar o que está na carteira.'
          }, { quoted: msg })
        }
        valor = saldoBanco
      }

      // 💾 Uma única escrita atômica (ver rpg/economia.js — moverSaldo)
      const resultado = await moverSaldo(sender, valor, 'sacar')

      if (!resultado.ok) {
        if (resultado.motivo === 'saldo_insuficiente') {
          return await sock.sendMessage(jid, {
            text:
              `💸 *Saldo insuficiente no banco.*\n\n` +
              `🏦 Você tem *${formatarReais(resultado.saldoOrigem)}* no banco ` +
              `e tentou sacar *${formatarReais(valor)}*.\n\n` +
              'Confira seus saldos com /carteira.'
          }, { quoted: msg })
        }
        return await sock.sendMessage(jid, {
          text: '🚫 *Não consegui fazer esse saque* — valor inválido. Confira o valor e tente de novo.'
        }, { quoted: msg })
      }

      await sock.sendMessage(jid, {
        text:
          `💵 *SAQUE CONFIRMADO* 💤\n` +
          `━━━━━━━━━━━━━━━━━━━\n\n` +
          `💰 Sacado: *${formatarReais(resultado.valor)}*\n\n` +
          `👛 Carteira: *${formatarReais(resultado.saldoCarteira)}*\n` +
          `🏦 Banco: *${formatarReais(resultado.saldoBanco)}*\n\n` +
          `⚠️ O dinheiro na carteira pode ser transferido — e, um dia, roubado.`
      }, { quoted: msg })
    } catch (err) {
      // 🛡️ Mesma rede de segurança dos outros comandos do RPG
      console.error('[sacar] 💥 erro ao sacar no RPG:', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⚠️ *Não consegui registrar seu saque no reino dos sonhos agora.*\n\nO banco de dados do RPG não respondeu — tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
