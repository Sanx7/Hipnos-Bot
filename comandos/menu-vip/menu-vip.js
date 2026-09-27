// ============================================
// 💠 MENU-VIP — Pergaminho dos Privilegiados
// ============================================
// Lista SOMENTE os comandos do sistema de VIP (hoje: /darvip e /listavip
// são dos donos do bot; /nomecustom, /corvip, /assinatura, /temavip e a
// consulta /badge são dos próprios VIPs — e o selo 💠 do /perfil é um
// benefício AUTOMÁTICO, sem comando de ativação),
// seguindo o mesmo estilo visual do /menu principal.
// Os comandos em si são exclusivos dos DONOS do bot (OWNER_NUMBERS),
// mas consultar este menu é livre — igual ao /menu geral.
// ============================================

const { RODAPE_MENU } = require('../../config')

module.exports = {
  nome: "menu-vip",

  async executar(sock, jid, msg) {
    try {
      await sock.sendMessage(jid, {
        text: `
╔══════════════════════════════╗
║      💠 𝐌𝐄𝐍𝐔 𝐕𝐈𝐏 💠      ║
╚══════════════════════════════╝

💠 O salão dos privilegiados do sono.
(Comandos exclusivos dos DONOS do bot.)

════════════════════

👑 /darvip @membro [dias]
➥ Outorga dias de VIP a um mortal (ex: /darvip @membro 30).
➥ Aceita também número digitado: /darvip 5511999999999 30.
➥ Se o membro já for VIP ativo, os dias são SOMADOS à expiração atual.

📜 /listavip
➥ Lista os VIPs ativos e suas expirações, da mais próxima para a mais distante.
➥ VIPs vencidos são varridos do livro automaticamente.

════════════════════

💠 VANTAGENS DE SER VIP

💠 Selo no /perfil (AUTOMÁTICO)
⇥ Enquanto seu VIP estiver vigente, o selo 💠 VIP aparece sozinho ao lado do seu nome no /perfil — nada para ativar. Ele some sozinho quando o VIP expira. Confira o seu com /badge (também: /selovip).

🏷️ /nomecustom <nome>
➥ Escolhe o nome que o bot exibe por você no /perfil e no /ranking.
➥ De 2 a 20 caracteres, sem quebra de linha.
➥ Sem argumento mostra o nome atual; /nomecustom remover volta ao nome do WhatsApp.
➥ Exclusivo de VIP (também: /nomevip).

🎨 /corvip <emoji>
➥ Escolhe o emoji que aparece antes do seu nome no /ranking (ex.: /corvip 🔥).
➥ Só UM emoji por vez; /corvip lista mostra as sugestões e a sua cor atual.
➥ /corvip remover volta ao padrão (também: /corcustom, /corvip reset).

✍️ /assinatura <texto>
➥ Marca as figurinhas que você cria com /s e /figurinha (canto inferior direito).
➥ Até 15 caracteres, sem emoji; /assinatura remover desliga (também: /assinaturavip).

🎨 /temavip <tema>
➥ Escolhe o esquema de cor (fundo, texto e destaque) dos seus cards: o do /perfil e os de /ship e /kiss.
➥ /temavip lista mostra os temas com as cores; /temavip neon aplica; /temavip remover volta ao padrão (também: /temacustom).

🎙️ /revelaraudio
➥ Revela áudios de visualização única (responda ao 🎙️ com 👁️).
➥ Também liberado para admins do grupo e donos do bot.

════════════════════

💀 FRASES DE HIPNOS

"Todo privilégio sonha com o seu fim."
"Os coroados descansam mais fundo."

════════════════════

${RODAPE_MENU}
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o menu-vip:", err);
    }
  }
};