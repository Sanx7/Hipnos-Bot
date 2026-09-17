// ============================================================
// 🏦 DEPOSITAR — Carteira → Banco (Fase 2 — economia)
// ============================================================
// Uso: /depositar <valor|todos>      (aliases: /dep, /deposito)
//   Ex.: /depositar 500  •  /depositar 1.234,56  •  /depositar todos
//
// Regras:
//   - valor precisa ser um número POSITIVO (zero, negativo ou texto → recusa);
//   - precisa ter saldo suficiente na CARTEIRA;
//   - "todos"/"tudo" move o saldo INTEIRO da carteira;
//   - a escrita é UMA só: rpg/economia.js (moverSaldo) usa $inc duplo no
//     MESMO documento com condição de saldo no filtro ($gte) — carteira e
//     banco nunca ficam inconsistentes entre si, nem com comandos em corrida.
//
// Por que guardar no banco? O dinheiro do BANCO não pode ser transferido
// por outras pessoas (só sai com /sacar) — é o cofre do jogador, pensado
// para o futuro sistema de roubo da Fase 7.
//
// Persistência: rpg/database.js (getPlayer resolve o LID internamente).
// ============================================================

const { getPlayer } = require('../../rpg/database')
const { formatarReais, parseValor, moverSaldo } = require('../../rpg/economia')

module.exports = {
  nome: 'depositar',
  aliases: ['dep', 'deposito'],
  descricao: 'Deposita dinheiro da carteira no banco. Uso: /depositar <valor|todos>',

  async executar(sock, jid, msg, texto) {
    try {
      // 👤 JID do remetente (mesma convenção dos outros comandos do RPG)
      const sender = msg.key?.participant || msg.key?.remoteJid || jid

      // ✂️ "/depositar <valor>" — só o 1º argumento é usado
      const tokenValor = String(texto || '').trim().split(/\s+/).filter(Boolean)[1]

      if (!tokenValor) {
        return await sock.sendMessage(jid, {
          text:
            '🏦 *Como depositar na sua conta onírica:*\n\n' +
            '`/depositar <valor>`\n\n' +
            '✏️ Exemplos: `/depositar 500` • `/depositar 1.234,56` • `/depositar todos`\n' +
            '_(`todos` deposita o saldo inteiro da carteira)_'
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

      // 👛 "todos" → descobre o saldo inteiro da carteira ANTES de mover
      if (valor === 'todos') {
        const jogador = await getPlayer(sender)
        const saldoCarteira = Math.round((Number(jogador.carteira) || 0) * 100) / 100
        if (saldoCarteira <= 0) {
          return await sock.sendMessage(jid, {
            text:
              '👛 *Sua carteira está vazia* — não há nada para depositar.\n\n' +
              '💼 Trabalhe quando a Fase 3 chegar, ou receba uma transferência: `/transferir @alguém <valor>`'
          }, { quoted: msg })
        }
        valor = saldoCarteira
      }

      // 💾 Uma única escrita atômica (ver rpg/economia.js — moverSaldo)
      const resultado = await moverSaldo(sender, valor, 'depositar')

      if (!resultado.ok) {
        if (resultado.motivo === 'saldo_insuficiente') {
          return await sock.sendMessage(jid, {
            text:
              `💸 *Saldo insuficiente na carteira.*\n\n` +
              `👛 Você tem *${formatarReais(resultado.saldoOrigem)}* na carteira ` +
              `e tentou depositar *${formatarReais(valor)}*.\n\n` +
              'Confira seus saldos com /carteira.'
          }, { quoted: msg })
        }
        return await sock.sendMessage(jid, {
          text: '🚫 *Não consegui fazer esse depósito* — valor inválido. Confira o valor e tente de novo.'
        }, { quoted: msg })
      }

      await sock.sendMessage(jid, {
        text:
          `🏦 *DEPÓSITO CONFIRMADO* 💤\n` +
          `━━━━━━━━━━━━━━━━━━━\n\n` +
          `💰 Depositado: *${formatarReais(resultado.valor)}*\n\n` +
          `👛 Carteira: *${formatarReais(resultado.saldoCarteira)}*\n` +
          `🏦 Banco: *${formatarReais(resultado.saldoBanco)}*\n\n` +
          `🔒 O dinheiro no banco fica protegido de transferências e roubos.`
      }, { quoted: msg })
    } catch (err) {
      // 🛡️ Mesma rede de segurança dos outros comandos do RPG
      console.error('[depositar] 💥 erro ao depositar no RPG:', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⚠️ *Não consegui registrar seu depósito no reino dos sonhos agora.*\n\nO banco de dados do RPG não respondeu — tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
