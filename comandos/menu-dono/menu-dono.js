// ============================================
// 👑 MENU-DONO — Pergaminho dos Soberanos
// ============================================
// Lista os comandos EXCLUSIVOS dos DONOS DO BOT que não têm menu próprio.
// - NÃO repete /darvip e /servip (já estão no /menu-vip);
// - NÃO repete a moderação genérica de admin de grupo (está no /menu-admin).
// - /soadm aparece aqui como nota: embora seja usável por admins de grupo,
//   o dono sempre tem prioridade; ele também está no /menu-admin.
// - /redes aparece aqui por ser um comando ligado ao CRIADOR do bot, MAS
//   o uso dele é LIVRE (qualquer pessoa pode chamar) — a entrada deixa
//   isso explícito para não confundir.
// Consultar este menu é livre — igual aos demais menus (só o USO dos
// comandos, exceto /redes, é restrito aos donos).
// ============================================

const { RODAPE_MENU } = require('../../config')

module.exports = {
  nome: 'menu-dono',
  descricao: 'Abre o pergaminho dos soberanos: /dono, /seradm, /soadm e /redes.',

  async executar(sock, jid, msg) {
    try {
      await sock.sendMessage(jid, {
        text: `
╔══════════════════════════════╗
║      👑 𝐌𝐄𝐍𝐔 𝐃𝐎𝐍𝐎 👑      ║
╚══════════════════════════════╝

👑 O trono onde Hipnos despeja seus segredos.
(Comandos exclusivos dos DONOS do bot — exceto o /redes, que é de uso livre.)

════════════════════

👑 /dono
➥ Revela a lista de donos do bot (consulta pública — qualquer pessoa pode chamar).

👑 /seradm @membro
➥ Promove o autor (ou a @menção) a administrador DO GRUPO.
➥ Sem menção, promove quem chamou o comando.
➥ Requer que o bot seja admin do grupo.

⚙️ /soadm
➥ Alterna o modo somente admin deste grupo (/soadm 1 ativa, /soadm 0 desativa).
➥ Nota: também listado no /menu-admin (usável por admins de grupo).

════════════════════

🌐 REDES DO CRIADOR

🌐 /redes
➥ Mostra o Instagram e o TikTok do criador do bot.
➥ ⚠️ Uso LIVRE: qualquer pessoa pode chamar este comando (não é exclusivo de donos).

════════════════════

✨ *Mais comandos exclusivos, organizados em:*
➥ 💠 /menu-vip  →  /darvip (outorgar VIP) e /servip (listar VIPs)
➥ 👑 /menu-admin  →  moderação, blacklist e guardiões do limbo

════════════════════

💀 FRASES DE HIPNOS

"Quem detém o sono, detém o reino."

════════════════════

${RODAPE_MENU}
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o menu-dono:", err);
    }
  }
};