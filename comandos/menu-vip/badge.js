// ============================================================
// 💠 BADGE (/badge, alias /selovip) — consulta rápida do selo VIP
// ============================================================
// Uso:
//   /badge        -> mostra se o seu selo 💠 VIP está ATIVO agora
//
// O selo em si é PASSIVO: o /perfil checa `vip.isVip` em tempo real toda
// vez que monta o card e imprime "💠 VIP" ao lado do nome de quem é VIP
// ativo — sem comando para ativar e sem expiração própria (ele some
// sozinho assim que o VIP vence). Este comando é só a CONSULTA RÁPIDA
// desse status, com a explicação de como o selo se comporta no /perfil.
//
// 🆓 DIFERENTE dos outros comandos do /menu-vip: /badge é de uso LIVRE
// (qualquer mortal pode rodar — ele só informa o próprio status, sem
// privilégio algum). A checagem reusa o vip-acesso.js (resolução LID via
// lid.js + vip.isVip), a MESMA base do /darvip, do /listavip e do /perfil.
// ============================================================

// 🔐 Mesma fonte única da checagem "este remetente é VIP?" dos comandos de
// privilégio — aqui usada só para exibir o sim/não, nunca para recusar.
const { checarAcessoVip } = require('../../vip-acesso')

// ─── 💬 Mensagens ───
function textoSeloAtivo() {
  return (
    '💠 *SELO VIP ATIVO* 💠\n\n' +
    'Seu selo 💠 VIP está aceso. ✨\n\n' +
    'Ele aparece AUTOMATICAMENTE ao lado do seu nome no /perfil — sem precisar ativar nada. ' +
    'Enquanto o seu VIP estiver vigente, o selo fica; quando expirar, ele some sozinho junto com o VIP.\n\n' +
    '⏳ Renove com um dono do bot para manter o selo aceso.'
  )
}

function textoSeloInativo() {
  return (
    '🚫 *SELO VIP INATIVO*\n\n' +
    'Você não tem o selo 💠 agora: sem VIP ativo, o /perfil não mostra nada ao lado do seu nome.\n\n' +
    '💠 O selo é AUTOMÁTICO — basta estar com o VIP vigente que ele aparece sozinho no /perfil ' +
    '(e some quando o VIP expira). Nada para configurar.\n\n' +
    '💠 Quer virar VIP? Fale com um dono do bot ou consulte o /menu-vip.'
  )
}

module.exports = {
  nome: 'badge',
  aliases: ['selovip'],
  descricao: 'Mostra se o selo 💠 VIP está ativo — ele aparece sozinho no /perfil enquanto o VIP durar.',
  categoria: 'vip',

  async executar(sock, jid, msg) {
    try {
      // 1) 🔎 Status do REMETENTE na FONTE ÚNICA (vip-acesso.js): resolve o
      //    LID (grupos com LID habilitado) e roda o vip.isVip em cada
      //    candidato. Consulta LIVRE: o resultado vira resposta, não recusa.
      const { autorizado } = await checarAcessoVip(sock, jid, msg, 'badge')

      // 2) Resposta: status + explicação do comportamento AUTOMÁTICO.
      console.log(`[badge] 💠 consulta de selo: ${autorizado ? 'ativo' : 'inativo'}`)
      const texto = autorizado ? textoSeloAtivo() : textoSeloInativo()
      await sock.sendMessage(jid, { text: texto }, { quoted: msg }).catch(() => {})
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa do comando para o socket.
      console.error('[badge] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  // Ganchos p/ testes offline (não viram comando — o loader lê nome/executar).
  _test: {
    checarAcessoVip,
    textoSeloAtivo,
    textoSeloInativo
  }
}