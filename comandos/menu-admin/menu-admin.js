// ============================================
// 👑 MENU-ADMIN — Pergaminho da Administração
// ============================================
// Lista TODOS os comandos administrativos/moderação do bot
// (comandos/admin/), seguindo o mesmo estilo visual do /menu
// principal e do /menu-vip.
// ============================================

const { RODAPE_MENU } = require('../../config')

module.exports = {
  nome: 'menu-admin',
  descricao: 'Abre o pergaminho da administração: moderação, blacklist e guardiões do limbo.',

  async executar(sock, jid, msg) {
    try {
      await sock.sendMessage(jid, {
        text: `
╔══════════════════════════════╗
║      👑 𝐌𝐄𝐍𝐔 𝐀𝐃𝐌𝐈𝐍 👑      ║
╚══════════════════════════════╝

👑 O arsenal de Hipnos para manter a ordem.
(Comandos de moderação e proteção do recinto.)

════════════════════

👥 GESTÃO DE MEMBROS

👢 /kick @membro
➥ Expulsa um mortal do recinto.

☠️ /ban @membro
➥ Punição máxima: Expulsa e joga na blacklist.

👑 /promover @membro
➥ Eleva um mortal à administração.

⬇️ /rebaixar @membro
➥ Rebaixa um administrador de volta à condição de mortal.

🌑 /mute @membro
➥ Impõe o silêncio eterno no chat.

🌙 /unmute @membro
➥ Devolve a voz ao silenciado.

👋 /bemvindo (1 ou 0)
➥ Ativa ou desativa a saudação de novos membros.

════════════════════

☠️ BLACKLIST & PUNIÇÕES

☠️ /addblacklist @membro
➥ Condena uma alma à blacklist eterna.

🕊️ /remblacklist @membro
➥ Perdoa e liberta um número da blacklist.

📕 /blacklist
➥ Revela a lista negra de Hipnos (Apenas donos).

════════════════════

🚪 CONTROLE DO GRUPO

🔓 /abrir
➥ Abre as portas do grupo.

🔒 /fechar
➥ Sela o grupo (Apenas admins).

🔗 /linkgp
➥ Revela o portal (Link de convite) do grupo.

📢 /hidetag [texto]
➥ Convocação oculta de todas as almas do grupo.

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

👁️‍🗨️ UTILITÁRIOS

👁️‍🗨️ /revelar
➥ Revela fotos/vídeos de visualização única (Responda à mídia).

════════════════════

💀 FRASES DE HIPNOS

"Até o sono precisa de guardiões."

════════════════════

${RODAPE_MENU}
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o menu-admin:", err);
    }
  }
};