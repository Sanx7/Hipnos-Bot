// ============================================================
// 💰 CARTEIRA — Dinheiro do jogador no RPG (Fase 2 — economia)
// ============================================================
// Uso: /carteira        (aliases: /banco, /saldo, /dinheiro)
//
// 📌 DECISÃO DE DESIGN (documentada, como pedido): /carteira e /banco
// foram UNIFICADOS num único comando. Motivo: os dois responderiam à
// mesma pergunta ("quanto eu tenho?") com a mesma leitura no Mongo —
// separá-los só criaria dois arquivos quase idênticos e obrigaria o
// jogador a mandar dois comandos para ver o patrimônio inteiro. Então
// /carteira mostra CARTEIRA + BANCO + TOTAL na MESMA mensagem, e /banco,
// /saldo e /dinheiro são ALIASES deste comando (ninguém fica sem resposta
// por ter digitado "banco"). A diferença conceitual continua explícita na
// mensagem: o dinheiro do BANCO é o cofre protegido (só sai com /sacar);
// o da CARTEIRA é o que circula em /transferir — e, por isso, será ele o
// dinheiro exposto ao roubo da Fase 7.
//
// Persistência: apenas LEITURA via getPlayer (rpg/database.js) — a
// resolução LID→número real já acontece lá dentro (Fase 1).
// ============================================================

const { getPlayer } = require('../../rpg/database')
const { formatarReais } = require('../../rpg/economia')

// 🎨 Linha temática de separação (mesmo estilo da /ficha)
const LINHA = '━━━━━━━━━━━━━━━━━━━'

module.exports = {
  nome: 'carteira',
  aliases: ['banco', 'saldo', 'dinheiro'],
  descricao: 'Mostra quanto você tem na carteira e no banco (RPG).',

  async executar(sock, jid, msg) {
    try {
      // 👤 JID do remetente (mesma convenção dos outros comandos do RPG).
      // 🪪 Sem resolução de LID aqui de propósito: getPlayer já resolve
      // dentro do rpg/database.js (REGRA DE IDENTIDADE — Fase 1).
      const sender = msg.key?.participant || msg.key?.remoteJid || jid

      // 🔎 getPlayer lê/cria o jogador (nunca falha por "conta nova")
      const jogador = await getPlayer(sender)

      // 💰 Arredonda em centavos (mesma convenção do rpg/economia.js)
      const carteira = Math.round((Number(jogador.carteira) || 0) * 100) / 100
      const banco = Math.round((Number(jogador.banco) || 0) * 100) / 100
      const total = Math.round((carteira + banco) * 100) / 100

      await sock.sendMessage(jid, {
        text:
          `💰 *SUAS MOEDAS NO SONHO* 💤\n` +
          `${LINHA}\n\n` +
          `👛 Carteira: *${formatarReais(carteira)}*\n` +
          `   _é o que circula em /transferir_\n\n` +
          `🏦 Banco: *${formatarReais(banco)}*\n` +
          `   _cofre protegido — só sai com /sacar_\n\n` +
          `💎 Total: *${formatarReais(total)}*\n\n` +
          `${LINHA}\n` +
          `💸 /depositar <valor> • /sacar <valor> • /transferir @alguém <valor>\n` +
          `_(use \`todos\` no lugar do valor para mover o saldo inteiro)_`
      }, { quoted: msg })
    } catch (err) {
      // 🛡️ Mesma rede de segurança dos outros comandos do RPG
      console.error('[carteira] 💥 erro ao ler o saldo do RPG:', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⚠️ *Não consegui abrir seu cofre no reino dos sonhos agora.*\n\nO banco de dados do RPG não respondeu — tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
