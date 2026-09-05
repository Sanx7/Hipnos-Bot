// ============================================
// 👑 MENU-DONO — Pergaminho dos Soberanos
// ============================================
// Lista os comandos EXCLUSIVOS dos DONOS DO BOT que não têm menu próprio.
// - NÃO repete /darvip e /servip (já estão no /menu-vip);
// - NÃO repete a moderação genérica de admin de grupo (está no /menu-admin).
// - /soadm aparece aqui como nota: embora seja usável por admins de grupo,
//   o dono sempre tem prioridade; ele também está no /menu-admin.
// Consultar este menu é livre — igual aos demais menus (só o uso dos
// comandos em si é restrito aos donos).
// ============================================

module.exports = {
  nome: 'menu-dono',
  descricao: 'Abre o pergaminho dos soberanos: /dono, /seradm e /soadm.',

  async executar(sock, jid, msg) {
    try {
      await sock.sendMessage(jid, {
        text: `
╔══════════════════════════════╗
║      👑 𝐌𝐄𝐍𝐔 𝐃𝐎𝐍𝐎 👑      ║
╚══════════════════════════════╝

👑 O trono onde Hipnos despeja seus segredos.
(Comandos exclusivos dos DONOS do bot.)

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

✨ *Mais comandos exclusivos, organizados em:*
➥ 💠 /menu-vip  →  /darvip (outorgar VIP) e /servip (listar VIPs)
➥ 👑 /menu-admin  →  moderação, blacklist e guardiões do limbo

════════════════════

💀 FRASES DE HIPNOS

"Quem detém o sono, detém o reino."

════════════════════

🌙 Hipnos Bot v1.0.0
🔮 Criador: Sanx7 (+1 (438) 224-6600)
💤 Guardião Supremo dos Sonhos
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o menu-dono:", err);
    }
  }
};