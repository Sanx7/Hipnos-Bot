// ============================================
// 🎲 MENU-BRINCADEIRAS — Pergaminho das Brincadeiras
// ============================================
// Lista TODOS os comandos de brincadeira do bot (comandos/menu-brincadeiras/),
// seguindo o mesmo estilo visual do /menu principal e do /menu-vip.
// Consultar este menu é livre — igual ao /menu geral.
//
// Alias: /brincadeira (ver brincadeira.js, mesmo padrão do /flip -> /moeda).
// ============================================

const { RODAPE_MENU } = require('../../config')

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

🔫 /roletarussa
➥ A roleta do limbo: sorteia um mortal comum ao acaso e o expulsa do grupo (Admins/Donos do bot).

💞 /casal
➥ O oráculo do amor sorteia um casal do grupo e revela a compatibilidade.

🔮 /escolha opção1, opção2, ...
➥ O oráculo escolhe uma das opções separadas por vírgula (ex: /escolha café, chá, sonho).

════════════════════

🎭 AÇÕES (INTERAÇÃO ANIMADA)

👋 /tapa @usuario
➥ Dá um tapa em alguém (GIF animado) — responda a mensagem da pessoa (reply) ou mencione com @usuario.

💋 /beijo @usuario
➥ Dá um beijo em alguém (GIF animado) — responda a mensagem da pessoa (reply) ou mencione com @usuario.

🤗 /abraço @usuario
➥ Dá um abraço em alguém (GIF animado) — responda a mensagem da pessoa (reply) ou mencione com @usuario.

👊 /soco @usuario
➥ Dá um soco em alguém (GIF animado) — responda a mensagem da pessoa (reply) ou mencione com @usuario.

🦶 /chute @usuario
➥ Dá um chute em alguém (GIF animado) — responda a mensagem da pessoa (reply) ou mencione com @usuario.

🫳 /carinho @usuario
➥ Faz carinho em alguém (GIF animado) — responda a mensagem da pessoa (reply) ou mencione com @usuario.

🦷 /mordida @usuario
➥ Dá uma mordida em alguém (GIF animado) — responda a mensagem da pessoa (reply) ou mencione com @usuario.

👉 /cutucada @usuario
➥ Cutuca alguém (GIF animado) — responda a mensagem da pessoa (reply) ou mencione com @usuario.

🫂 /aconchego @usuario
➥ Aconchega alguém (GIF animado) — responda a mensagem da pessoa (reply) ou mencione com @usuario.

😋 /comer @usuario
➥ Come alguém (GIF animado) — responda a mensagem da pessoa (reply) ou mencione com @usuario.

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

🕹️ /velha @usuario
➥ Desafia quem você marcar para uma partida de jogo da velha 3x3 (tabuleiro em ❌/⭕/▫️). Para encerrar: /velha cancelar.

🔠 /anagrama [categoria]
➥ Descubra a palavra secreta letra por letra — 6 erros e o limbo vence (um jogo por grupo; ex: /anagrama animais). Com jogo ativo: /anagrama <letra> chuta, /anagrama palpite <palavra> arrisca tudo, /anagrama desistir desiste.

🎨 /gartic [categoria]
➥ Adivinhe a palavra pela imagem (Pixabay) — quem acertar primeiro vence (um jogo por grupo, 3 min por rodada; ex: /gartic animais).

❌ /jogar [1-9]
➥ Marca uma posição no tabuleiro da partida em curso (ex: /jogar 5, teclado numérico). Só joga quem é a vez.

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

${RODAPE_MENU}
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o menu-brincadeiras:", err);
    }
  }
};