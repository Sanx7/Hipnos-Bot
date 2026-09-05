// ============================================
// 🎲 MENU-BRINCADEIRAS — Pergaminho das Brincadeiras
// ============================================
// Lista TODOS os comandos de brincadeira do bot (comandos/menu-brincadeiras/),
// seguindo o mesmo estilo visual do /menu principal e do /menu-vip.
// Consultar este menu é livre — igual ao /menu geral.
//
// Alias: /brincadeira (ver brincadeira.js, mesmo padrão do /flip -> /moeda).
// ============================================

module.exports = {
  nome: 'menu-brincadeiras',
  descricao: 'Abre o pergaminho das brincadeiras: sorteios, jogos e oráculos de Hipnos.',

  async executar(sock, jid, msg) {
    try {
      await sock.sendMessage(jid, {
        text: `
╔══════════════════════════════╗
║     🎲 𝐌𝐄𝐍𝐔 𝐁𝐑𝐈𝐍𝐂𝐀𝐃𝐄𝐈𝐑𝐀𝐒 🎲     ║
╚══════════════════════════════╝

🎲 O salão dos jogos e das decisões do sono.
(Comandos liberados para todos os mortais.)

════════════════════

🏆 SORTEIO & DECISÃO

🏆 /sorteio <prêmio> @user1 @user2
➥ Sorteia um vencedor entre os marcados (ex: /sorteio de duas passagens aéreas @user1 @user2).

🎰 /roleta
➥ Gira a roda onírica e marca um membro sorteado do grupo.

💞 /casal
➥ O oráculo do amor sorteia um casal do grupo e revela a compatibilidade.

🔮 /escolha opção1, opção2, ...
➥ O oráculo escolhe uma das opções separadas por vírgula (ex: /escolha café, chá, sonho).

════════════════════

🎲 JOGOS

🪙 /moeda (ou /flip)
➥ Desafia o destino: Cara ou Coroa?

🎲 /dado [lados]
➥ Rola um dado de 6 lados, ou com quantos lados quiser (ex: /dado 20).

🃏 /carta
➥ Sorteia uma carta do baralho dos sonhos.

🔢 /numero [min] [max]
➥ Sorteia um número no intervalo (ex: /numero 10 20). Padrão: 1 a 100.

════════════════════

🔮 ORÁCULOS

🔮 /8ball <pergunta>
➥ O orbe do subconsciente responde a sua pergunta (ex: /8ball devo mudar de emprego?).

🔮 /simounao <pergunta>
➥ O oráculo dos sonhos responde Sim ou Não (ex: /simounao devo dormir cedo?).

════════════════════

💀 FRASES DE HIPNOS

"O acaso é apenas o sono do destino."
"Sorte é sonhar com os olhos abertos."

════════════════════

🌙 Hipnos Bot v1.0.0
🔮 Criador: Sanx7 (+1 (438) 224-6600)
💤 Guardião Supremo dos Sonhos
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o menu-brincadeiras:", err);
    }
  }
};