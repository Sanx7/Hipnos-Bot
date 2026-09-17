// ============================================================
// 💸 TRANSFERIR — Carteira → Carteira entre jogadores (Fase 2 — economia)
// ============================================================
// Uso: /transferir <@menção|número> <valor|todos>   (aliases: /transf, /pix)
//   Ex.: /transferir @fulano 250
//        /transferir 5511999999999 250
//        /transferir 250                 (respondendo à mensagem do alvo)
//
// Regras:
//   - sai da CARTEIRA de quem manda e entra na CARTEIRA de quem recebe
//     (o BANCO fica de fora DE PROPÓSITO: dinheiro guardado é o cofre,
//     pensado para o sistema de roubo da Fase 7);
//   - não pode transferir para si mesmo; valor precisa ser positivo; é
//     preciso ter saldo na carteira;
//   - o alvo que NUNCA usou o RPG é criado automaticamente — getPlayer()
//     auto-cria com os padrões (ninguém recebe "conta inexistente");
//   - ATOMICIDADE (nunca debitar sem creditar): rpg/economia.js tenta uma
//     TRANSAÇÃO MongoDB real (Atlas/replica set → rollback total em
//     qualquer falha) e, se o deployment não suportar transação, aplica um
//     plano COMPENSATÓRIO (crédito + débito condicional $gte; se o débito
//     não casar, o crédito é REVERTIDO);
//   - 🪪 menção/reply pode chegar como "@lid": resolvemos para o número
//     real REUTILIZANDO o lid.js (mesmo padrão do /darvip) e, se não for
//     resolvível, RECUSAMOS — nunca gravamos LID como jid no banco.
//   - 🔔 aviso ao destinatário é BEST-EFFORT (documentado): se falhar, a
//     transferência já está concluída e só logamos — nada quebra.
// ============================================================

const { limparNumero } = require('../../config')
// 🪪 Resolução LID→número real (lid.js — mesmo módulo do /darvip)
const { resolverNumeroAlvo } = require('../../lid')
const { getPlayer } = require('../../rpg/database')
const { formatarReais, parseValor, transferirEntreJogadores } = require('../../rpg/economia')

module.exports = {
  nome: 'transferir',
  aliases: ['transf', 'pix'],
  descricao: 'Transfere dinheiro da sua carteira para outro jogador. Uso: /transferir @alguém <valor>',

  async executar(sock, jid, msg, texto) {
    try {
      const sender = msg.key?.participant || msg.key?.remoteJid || jid

      const comoUsar =
        '💸 *Como transferir no reino dos sonhos:*\n\n' +
        '`/transferir @alguém <valor>`\n\n' +
        '✏️ Exemplos: `/transferir @fulano 250` • `/transferir 5511999999999 250`\n' +
        '   _(respondendo a uma mensagem do alvo: `/transferir 250`)_\n' +
        '_(`todos` no lugar do valor envia o saldo inteiro da carteira)_'

      // 📎 Contexto da mensagem: menção direta (mentionedJid) ou autor da
      // mensagem citada (reply) — mesma extração usada no /afk e no /darvip.
      // 📌 DECISÃO: com VÁRIAS menções usamos só a 1ª (diferente do /afk, que
      // avisa todos) — dinheiro tem UM destinatário só; quem quiser mandar
      // para outra pessoa repete o comando. Assim nunca há dúvida sobre
      // quem recebeu o quê.
      const contextInfo =
        msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.[Object.keys(msg.message || {})[0]]?.contextInfo ||
        null
      const alvoBruto = contextInfo?.mentionedJid?.[0] || contextInfo?.participant || null

      // ✂️ Argumentos: "/transferir <alvo> <valor>". Sem menção/reply, o 1º
      // argumento é o alvo digitado (número ou @número); o ÚLTIMO é o valor.
      const args = String(texto || '').trim().split(/\s+/).slice(1).filter(Boolean)
      const alvoTexto = !alvoBruto && args.length >= 2 ? args.shift() : null
      const tokenValor = args.pop()

      // ── 1) 🔎 Número REAL do alvo ──
      let numeroAlvo = ''
      if (alvoBruto) {
        // Em grupo os METADADOS dão o phoneNumber do mencionado (PROOF-LID,
        // igual ao /darvip); no privado o lid.js cai no mapeamento da sessão.
        let participantes = null
        if (jid.endsWith('@g.us')) {
          try {
            participantes = (await sock.groupMetadata(jid)).participants
          } catch (err) {
            console.error('[transferir] sem metadados do grupo p/ resolver @lid:', err?.message || err)
          }
        }
        const resolucao = await resolverNumeroAlvo(participantes, alvoBruto)
        if (!resolucao.numero || resolucao.via === null) {
          console.warn(`[transferir] 🪪 alvo ${alvoBruto} não resolvível — recusando para NÃO gravar LID no banco`)
          return await sock.sendMessage(jid, {
            text:
              '🪪 *Não consegui identificar o número real dessa menção* (o WhatsApp entregou só o LID).\n\n' +
              'Transfira direto pelo número: `/transferir 5511999999999 250`.'
          }, { quoted: msg })
        }
        numeroAlvo = resolucao.numero
      } else if (alvoTexto) {
        const digitos = limparNumero(alvoTexto)
        if (digitos.length >= 10 && digitos.length <= 15) numeroAlvo = digitos
      }

      if (!numeroAlvo) {
        return await sock.sendMessage(jid, { text: comoUsar }, { quoted: msg })
      }

      // ── 2) 💵 Valor ──
      if (!tokenValor) {
        return await sock.sendMessage(jid, {
          text: '💰 *Quanto você quer transferir?*\n\nEx.: `/transferir @fulano 250` _(ou `todos` para enviar o saldo inteiro da carteira)_'
        }, { quoted: msg })
      }

      let valor = parseValor(tokenValor)
      if (valor === null) {
        return await sock.sendMessage(jid, {
          text:
            `🚫 *Valor inválido:* "${tokenValor}"\n\n` +
            'Use um número positivo (ex.: `100`, `1.234,56`) ou `todos`.'
        }, { quoted: msg })
      }

      // ── 3) 🚫 Não pode transferir para si mesmo ──
      if (limparNumero(sender) === numeroAlvo) {
        return await sock.sendMessage(jid, {
          text: '🙃 *Você não pode transferir dinheiro para si mesmo.*\n\nO dinheiro já é seu! Use `/depositar` se quiser guardá-lo no banco.'
        }, { quoted: msg })
      }

      // 👛 "todos" → saldo inteiro da CARTEIRA (nunca do banco)
      if (valor === 'todos') {
        const jogador = await getPlayer(sender)
        const saldoCarteira = Math.round((Number(jogador.carteira) || 0) * 100) / 100
        if (saldoCarteira <= 0) {
          return await sock.sendMessage(jid, {
            text: '👛 *Sua carteira está vazia* — não há nada para transferir.\n\n_(Se o dinheiro estiver no banco, saque antes com `/sacar todos`.)_'
          }, { quoted: msg })
        }
        valor = saldoCarteira
      }

      // ── 4) 💸 Transferência segura (transação Mongo ou compensação) ──
      const alvoJid = `${numeroAlvo}@s.whatsapp.net`
      const resultado = await transferirEntreJogadores(sender, alvoJid, valor)

      if (!resultado.ok) {
        const motivos = {
          saldo_insuficiente:
            `💸 *Saldo insuficiente na carteira.*\n\n` +
            `Você tentou enviar *${formatarReais(valor)}* — confira o que tem com /carteira.\n` +
            '_(Se o dinheiro estiver no banco, saque antes com `/sacar`.)_',
          mesmo_jogador: '🙃 *Você não pode transferir dinheiro para si mesmo.*',
          valor_invalido: '🚫 *Valor inválido* — use um número positivo.',
          jogador_ausente: '⛔ *Não encontrei o jogador de destino* para creditar. Tente novamente em instantes.'
        }
        return await sock.sendMessage(jid, {
          text: motivos[resultado.motivo] || '⚠️ Não consegui completar essa transferência.'
        }, { quoted: msg })
      }

      // ── 5) 💬 Confirmação para quem enviou ──
      await sock.sendMessage(jid, {
        text:
          `💸 *TRANSFERÊNCIA CONCLUÍDA* 💤\n` +
          `━━━━━━━━━━━━━━━━━━━\n\n` +
          `➡️ Enviado: *${formatarReais(valor)}*\n` +
          `👤 Para: @${numeroAlvo}\n\n` +
          `👛 Sua carteira: *${formatarReais(resultado.novoSaldoRemetente)}*\n\n` +
          `🔒 Lembrete: o dinheiro guardado no banco não entra em transferências (nem em roubos).`,
        mentions: [alvoBruto || alvoJid]
      }, { quoted: msg })

      // ── 6) 🔔 Aviso ao destinatário — BEST-EFFORT (falha não quebra nada) ──
      try {
        await sock.sendMessage(alvoJid, {
          text:
            `💸 *VOCÊ RECEBEU UMA TRANSFERÊNCIA!* 💤\n\n` +
            `💰 Valor: *${formatarReais(valor)}*\n` +
            `👤 De: @${limparNumero(sender)}\n` +
            `👛 Sua carteira agora: *${formatarReais(resultado.novoSaldoDestinatario)}*`,
          mentions: [msg.key.participant || sender]
        })
      } catch (errAviso) {
        // DECISÃO documentada: o aviso é opcional. A transferência já está
        // gravada e confirmada, então apenas logamos a falha do aviso.
        console.warn('[transferir] 🔔 não consegui avisar o destinatário (transferência já concluída):', errAviso?.message || errAviso)
      }
    } catch (err) {
      // 🛡️ Mesma rede de segurança dos outros comandos do RPG
      console.error('[transferir] 💥 erro ao transferir no RPG:', err?.stack || err)
      await sock.sendMessage(jid, {
        text:
          '⚠️ *Não consegui completar a transferência no reino dos sonhos agora.*\n\n' +
          'O banco de dados do RPG não respondeu — confira seu saldo com /carteira antes de tentar de novo (nada é debitado sem creditar).'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
