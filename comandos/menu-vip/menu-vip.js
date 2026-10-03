// ============================================
// 💠 MENU-VIP — Pergaminho dos Privilegiados
// ============================================
// Lista SOMENTE os comandos do sistema de VIP (hoje: /darvip e /listavip
// são dos donos do bot; /nomecustom, /corvip, /assinatura, /temavip, /alcunha e a
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

⚔️ /alcunha <apelido>
➥ Escolhe o seu apelido de guerra, que aparece no cartaz do /procurado.
➥ Todo mundo já tem uma alcunha (a padrão sai do seu número e nunca muda sozinha) — esta é a sua versão.
➥ Até 25 caracteres, sem emoji; /alcunha remover volta à padrão.
➥ Exclusivo de VIP.

✍️ /assinatura <texto>
➥ Marca o nome de autor e o nome do pack das suas figurinhas do /s e do /figurinha (o pack e o autor aparecem ao segurar a figurinha).
➥ /assinatura <texto> define o autor (até 35 caracteres, emoji liberado); /assinatura remover desliga o autor.
➥ /assinatura pack <texto> define o pack (padrão "Hipnos Bot", mesmo limite); /assinatura sozinho mostra os dois; /assinatura pack remover desliga o pack (também: /assinaturavip).

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