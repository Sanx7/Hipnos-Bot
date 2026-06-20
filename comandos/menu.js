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

👁️‍🗨️ /revelar
➥ Revela fotos/vídeos de visualização única (Responda à mídia).

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

════════════════════

🛡️ GUARDIÕES DO LIMBO (ANTIS)

⚙️ /soadm (1 ou 0)
➥ Restringe o uso do bot apenas a administradores.

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