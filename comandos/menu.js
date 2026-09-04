module.exports = {
  nome: "menu",

  async executar(sock, jid, msg) {
    try {
      await sock.sendMessage(jid, {
        text: `
╔══════════════════════════════╗
║       🌙 𝐇𝐈𝐏𝐍𝐎𝐒 𝐁𝐎𝐓 🌙       ║
║     💀 𝐃𝐄𝐔𝐒 𝐃𝐎 𝐒𝐎𝐍𝐎 💀     ║
╚══════════════════════════════╝

🌑 Bem-vindo ao domínio de Hipnos.

"Aqueles que perturbam o sono
enfrentam o julgamento das sombras."

════════════════════

📜 COMANDOS GERAIS

🏓 /ping
➥ Mede a pulsação do bot.

📖 /menu
➥ Exibe este pergaminho.

🏆 /ranking
➥ Mostra os 10 membros mais ativos do grupo (mais mensagens enviadas).

👁️‍🗨️ /revelar
➥ Revela fotos/vídeos de visualização única (Responda à mídia).

🎵 /play <nome da música>
➥ Pesquisa e baixa o áudio do YouTube direto no chat.

👑 /dono
➥ Revela quem são os donos do bot.

════════════════════

🔮 MENU STICKER (FIGURINHAS)

🔮 /s
➥ Transforma imagens em figurinhas.

🖼️ /toimg
➥ Converte figurinha estática em imagem comum (Responda ao sticker).

🏷️ /renomear [Pacote] | [Autor]
➥ Altera os metadados de um sticker (Responda ao sticker).

🎞️ /togif
➥ Transforma figurinha animada em GIF em loop (Responda ao sticker).

🎬 /tomp4
➥ Transforma figurinha animada em vídeo MP4 comum (Responda ao sticker).

════════════════════

🎲 BRINCADEIRAS

🪙 /moeda (ou /flip)
➥ Desafia o destino: Cara ou Coroa?

🎲 /dado [lados]
➥ Rola um dado de 6 lados, ou com quantos lados quiser (ex: /dado 20).

🔮 /escolha opção1, opção2, ...
➥ O oráculo escolhe uma das opções separadas por vírgula (ex: /escolha café, chá, sonho).

🎰 /roleta
➥ Gira a roda onírica e marca um membro sorteado do grupo.

💞 /casal
➥ O oráculo do amor sorteia um casal do grupo e revela a compatibilidade.

🔮 /simounao <pergunta>
➥ O oráculo dos sonhos responde Sim ou Não (ex: /simounao devo dormir cedo?).

🔢 /numero [min] [max]
➥ Sorteia um número no intervalo (ex: /numero 10 20). Padrão: 1 a 100.

🃏 /carta
➥ Sorteia uma carta do baralho dos sonhos.

🏆 /sorteio <prêmio> @user1 @user2
➥ Sorteia um vencedor entre os marcados (ex: /sorteio de duas passagens aéreas @user1 @user2).

🔮 /8ball <pergunta>
➥ O orbe do subconsciente responde a sua pergunta (ex: /8ball devo mudar de emprego?).

════════════════════

👑 ADMINISTRAÇÃO

🔓 /abrir
➥ Abre as portas do grupo.

🔒 /fechar
➥ Sela o grupo (Apenas admins).

👢 /kick @membro
➥ Expulsa um mortal do recinto.

🌑 /mute @membro
➥ Impõe o silêncio eterno no chat.

🌙 /unmute @membro
➥ Devolve a voz ao silenciado.

☠️ /ban @membro
➥ Punição máxima: Expulsa e joga na blacklist.

📢 /hidetag [texto]
➥ Convocação oculta de todas as almas do grupo.

🔗 /linkgp
➥ Revela o portal (Link de convite) do grupo.

👑 /promover @membro
➥ Eleva um mortal à administração.

⬇️ /rebaixar @membro
➥ Rebaixa um administrador de volta à condição de mortal.

👋 /bemvindo (1 ou 0)
➥ Ativa ou desativa a saudação de novos membros.

☠️ /addblacklist @membro
➥ Condena uma alma à blacklist eterna.

🕊️ /remblacklist @membro
➥ Perdoa e liberta um número da blacklist.

════════════════════

🛡️ GUARDIÕES DO LIMBO (ANTIS)

⚙️ /soadm
➥ Alterna o modo somente admin: só admins (e o dono) usam os comandos. Também aceita /soadm 1 (ativa) ou /soadm 0 (desativa).

🎧 /anti-audio (1 ou 0)
➥ Intercepta e deleta áudios enviados.

📂 /antidoc (1 ou 0)
➥ Barra e elimina documentos no chat.

📅 /antievento (1 ou 0)
➥ Cancela e apaga convites de eventos.

🔗 /antilink (1 ou 0)
➥ Destrói links externos enviados.

💰 /antipay (1 ou 0)
➥ Bane cobranças materiais e detecções stealth.

👁️ /antistatus (1 ou 0)
➥ Intercepta e bane marcações invasivas de status externo.

════════════════════

💠 MEMBROS VIP (SÓ DONO)

💠 /menu-vip
➥ Abre o pergaminho dos privilegiados: /darvip (outorgar dias de VIP) e /servip (listar VIPs ativos).

════════════════════

💀 FRASES DE HIPNOS

"O sono alcança todos."
"As sombras nunca dormem."
"O silêncio é inevitável."

════════════════════

🌙 Hipnos Bot v1.0.0
🔮 Criador: Sanx7 (+1 (438) 224-6600)
💤 Guardião Supremo dos Sonhos
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o menu:", err);
    }
  }
};