// ============================================
// 👑 MENU-DONO — Pergaminho dos Soberanos
// ============================================
// Lista os comandos EXCLUSIVOS dos DONOS DO BOT que não têm menu próprio.
// - NÃO repete /darvip e /listavip (já estão no /menu-vip);
// - NÃO repete a moderação genérica de admin de grupo (está no /menu-admin).
// - /soadm aparece aqui como nota: embora seja usável por admins de grupo,
//   o dono sempre tem prioridade; ele também está no /menu-admin.
// - /redes aparece aqui por ser um comando ligado ao CRIADOR do bot, MAS
//   o uso dele é LIVRE (qualquer pessoa pode chamar) — a entrada deixa
//   isso explícito para não confundir.
// - /set-prefix também aparece aqui porque é do DONO, mas é GLOBAL (vale
//   para o bot inteiro, não para um grupo) — por isso o aviso na entrada.
// Consultar este menu é livre — igual aos demais menus (só o USO dos
// comandos, exceto /redes, é restrito aos donos).
// ============================================

const { RODAPE_MENU } = require('../../config')

module.exports = {
  nome: 'menu-dono',
  descricao: 'Abre o pergaminho dos soberanos: /dono, /seradm, /soadm, /ia-interativa, /set-prefix e /redes.',

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

☀️ /on • 💤 /off
➥ Liga/desliga o uso geral em todos os grupos e no privado (só dono).
➥ OFF = manutenção: apenas donos interagem; moderação e tarefas automáticas continuam.
➥ Estado salvo no banco entre reinícios.

🌙 /sairgrupo
➥ Retira o Hipnos do grupo mediante confirmação (somente dono, prazo de 30 segundos).

🌙 /comunicado — Envia comunicados oficiais a todos os grupos do Hipnos.
➥ Só dono; aceita texto ou resposta a imagem. Prévia com confirmação em 60 segundos.
➥ /comunicado confirmar • /comunicado cancelar • /comunicado parar
➥ Funciona em manutenção; não altera o estado ON/OFF.

👑 /seradm @membro
➥ Promove o autor (ou a @menção) a administrador DO GRUPO.
➥ Sem menção, promove quem chamou o comando.
➥ Requer que o bot seja admin do grupo.

⚙️ /soadm
➥ Alterna o modo somente admin deste grupo (/soadm 1 ativa, /soadm 0 desativa).
➥ Nota: também listado no /menu-admin (usável por admins de grupo).

🤖 /ia-interativa (1/0)
➥ Liga/desliga a IA conversacional DESTE grupo (só dono do bot).
➥ Sem argumento, mostra o estado atual.
➥ Ligada: Hipnos responde sozinho quando alguém menciona o bot ou responde a uma mensagem dele
   (máximo 1 resposta a cada 30s por pessoa, sem histórico de conversa).

🔤 /set-prefix <símbolo>
➥ Troca o prefixo de TODOS os comandos (ex.: de / para !) — só dono do bot, e vale na hora, sem reiniciar.
➥ Sem argumento mostra o atual; /set-prefix reset volta para "/". A "/" antiga continua funcionando.
➥ Salvo no banco: o prefixo sobrevive a reinício e redeploy.

════════════════════

🌐 REDES DO CRIADOR

🌐 /redes
➥ Mostra o Instagram e o TikTok do criador do bot.
➥ ⚠️ Uso LIVRE: qualquer pessoa pode chamar este comando (não é exclusivo de donos).

════════════════════

✨ *Mais comandos exclusivos, organizados em:*
➥ 💠 /menu-vip  →  /darvip (outorgar VIP) e /listavip (listar VIPs)
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
