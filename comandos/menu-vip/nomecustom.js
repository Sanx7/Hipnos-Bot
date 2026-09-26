// ============================================================
// 🏷️ NOMECUSTOM (/nomecustom, alias /nomevip) — Nome personalizado
// ============================================================
// Uso:
//   /nomecustom MeuNomeVip  -> define o nome (2 a 20 caracteres)
//   /nomecustom             -> mostra o nome atual
//   /nomecustom remover     -> volta ao nome padrão do WhatsApp (aceita /reset)
//
// 💠 PERMISSÃO: EXCLUSIVO VIP — nem admin do grupo nem dono do bot entram
// aqui (é o contrário do /revelaraudio, que atende os três). A checagem reusa
// `vip.isVip` (o MESMO sistema do /darvip e do /listavip) e o remetente é
// resolvido via lid.js ANTES de checar — padrão PROOF-LID do /revelaraudio:
// em grupos com LID habilitado o sender chega como "175952680210489@lid"
// enquanto o registro de VIP está no número REAL.
//
// 🗄️ Armazenamento: campo `nomeCustom` no MESMO documento de VIP do Mongo
// (collection "vips", gerida pelo vip.js — nenhuma collection nova), sempre
// com o LID resolvido p/ o número real antes de gravar (como o /darvip).
//
// 📍 Onde o nome aparece hoje: /perfil (nome do card) e /ranking (nome da
// lista). Nos outros lugares que citam o nome, vale o padrão de sempre.
// ============================================================

const vip = require('../../vip')
// 🔐 Resolução LID + checagem de VIP na FONTE ÚNICA (vip-acesso.js, raiz),
// compartilhada com o /corvip — nada de lógica de permissão duplicada aqui.
const {
  resolverRemetente,
  checarAcessoVip,
  _injetarChecarVip
} = require('../../vip-acesso')

// Variante de só-permissão (não devolve o número resolvido) — usada pelos
// testes e por quem só precisa do sim/não. O executar() usa o checarAcessoVip
// direto, que entrega os mesmos candidatos sem consultar metadados 2x.
const temPermissao = async (sock, jid, msg) =>
  (await checarAcessoVip(sock, jid, msg, 'nomecustom')).autorizado

// ─── 💬 Avisos ───
const AVISO_SEM_PERMISSAO =
  '🔒 *Este feitiço é só para os coroados...*\n\n' +
  'O `/nomecustom` é exclusivo dos 💠 *VIPs*.\n\n' +
  '💠 Quer virar VIP? Fale com um dono do bot ou consulte o `/menu-vip`.'

const AVISO_LIMITE =
  '⚠️ *Nome inválido.*\n\n' +
  `Use entre *${vip.NOME_CUSTOM_MIN}* e *${vip.NOME_CUSTOM_MAX}* caracteres, sem quebra de linha e sem caracteres invisíveis.`

const AVISO_INDISPONIVEL =
  '⛔ O livro dos VIPs está fora de alcance agora... Tente novamente em instantes.'

const AVISO_SEM_VIP_ATIVO =
  '⌛ *Seu VIP não está mais ativo.*\n\n' +
  'O nome custom vive junto do selo 💠 — renove o VIP e defina de novo.'

// Traduz o motivo devolvido pelo vip.js para a mensagem certa.
function avisoDoMotivo (motivo) {
  if (motivo === 'sem-vip') return AVISO_SEM_VIP_ATIVO
  if (motivo === 'curto' || motivo === 'longo' || motivo === 'vazio') return AVISO_LIMITE
  return AVISO_INDISPONIVEL
}

module.exports = {
  nome: 'nomecustom',
  aliases: ['nomevip'],
  descricao: 'Define o nome que o bot exibe nas respostas (/perfil e /ranking) — exclusivo para VIPs.',
  categoria: 'vip',

  async executar (sock, jid, msg, text) {
    try {
      // 1) 🔐 Acesso PRIMEIRO (só VIP passa daqui). O `alvo` já vem no NÚMERO
      //    REAL quando o LID foi resolvido — que é o documento de VIP criado
      //    pelo /darvip e onde o nome custom é gravado.
      const { autorizado, sender, alvo } = await checarAcessoVip(sock, jid, msg, 'nomecustom')
      if (!autorizado) {
        return await sock.sendMessage(jid, { text: AVISO_SEM_PERMISSAO }, { quoted: msg }).catch(() => {})
      }

      // 2) Argumento: tudo o que vem depois de "/nomecustom"
      const pedido = String(text || '').split(/\s+/).slice(1).join(' ').trim()

      // 3) Sem argumento → mostra o nome atual
      if (!pedido) {
        const atual = await vip.obterNomeCustom(alvo)
        const resposta = atual
          ? '🏷️ *SEU NOME CUSTOM* 🏷️\n\n' +
            `No /perfil e no /ranking você aparece como *${atual}*.\n\n` +
            '✏️ Trocar: */nomecustom <nome>*\n' +
            '🧹 Voltar ao nome do WhatsApp: */nomecustom remover*'
          : '🏷️ *Você ainda não tem nome custom.*\n\n' +
            'Use */nomecustom <nome>* (de 2 a 20 caracteres) para escolher como quer aparecer no /perfil e no /ranking.'

        return await sock.sendMessage(jid, { text: resposta }, { quoted: msg }).catch(() => {})
      }

      // 4) "remover" / "reset" → volta ao nome padrão do WhatsApp
      if (/^(remover|reset)$/i.test(pedido)) {
        const resultado = await vip.removerNomeCustom(alvo)
        if (!resultado.ok) {
          return await sock.sendMessage(jid, { text: avisoDoMotivo(resultado.motivo) }, { quoted: msg }).catch(() => {})
        }
        const resposta = resultado.tinhaNome
          ? '🧹 *Nome custom removido.*\n\nVocê voltou a aparecer com o nome padrão do WhatsApp no /perfil e no /ranking.'
          : '🏷️ Você não tinha nome custom definido — o nome padrão do WhatsApp continua valendo.'

        return await sock.sendMessage(jid, { text: resposta }, { quoted: msg }).catch(() => {})
      }

      // 5) Caso geral: definir o nome (sanitização + limite + exigência de VIP
      //    ativo ficam no vip.js — o comando só traduz o resultado).
      const resultado = await vip.definirNomeCustom(alvo, pedido)
      if (!resultado.ok) {
        return await sock.sendMessage(jid, { text: avisoDoMotivo(resultado.motivo) }, { quoted: msg }).catch(() => {})
      }

      console.log(`[nomecustom] 🏷️ nome custom definido (${sender}): "${resultado.nome}"`)
      await sock.sendMessage(jid, {
        text:
          '🏷️💠 *NOME CUSTOM DEFINIDO* 💠🏷️\n\n' +
          `A partir de agora você aparece como *${resultado.nome}* no /perfil e no /ranking.\n\n` +
          '🧹 Para voltar ao nome do WhatsApp: */nomecustom remover*'
      }, { quoted: msg }).catch(() => {})
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa do comando para o socket.
      console.error('[nomecustom] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  // Ganchos p/ testes offline (não viram comando — o loader lê nome/executar).
  _test: {
    temPermissao,
    resolverRemetente,
    avisoDoMotivo,
    AVISO_SEM_PERMISSAO,
    AVISO_LIMITE,
    AVISO_INDISPONIVEL,
    AVISO_SEM_VIP_ATIVO,
    _injetarChecarVip
  }
}
