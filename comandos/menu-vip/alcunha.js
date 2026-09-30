// ============================================================
// ⚔️ ALCUNHA (/alcunha) — o apelido de guerra
// ============================================================
// Uso:
//   /alcunha Punho de Zeus  -> define a alcunha (1 a 25 caracteres)
//   /alcunha                -> mostra a alcunha atual
//   /alcunha remover        -> volta para a alcunha padrão (aceita /reset)
//
// 💠 PERMISSÃO: EXCLUSIVO VIP — mesmo sistema do /nomecustom (vip-acesso.js:
// `checarAcessoVip`, que resolve o LID antes de checar). Só o VIP define
// alcunha; TODO mundo tem alcunha, mas ela é a PADRÃO do número.
//
// 🎲 ALCUNHA PADRÃO: todo jogador tem uma, calculada em
// ../dados/alcunhas.js por hash FNV-1a do número — SEM data e sem
// aleatoriedade, então a mesma pessoa recebe SEMPRE a mesma alcunha (ela
// não muda sozinha nem quando o Render reinicia).
//
// 🗄️ Armazenamento: campo `alcunhaCustom` no MESMO documento de VIP do
// Mongo (collection "vips", vip.js) — nenhuma collection nova. Como o campo
// mora no registro do VIP, ele expira JUNTO com o selo: quando o VIP vence
// o registro é apagado e a pessoa volta para a alcunha padrão sozinha.
//
// 📍 Onde a alcunha aparece: o cartaz de procurado do /procurado e a
// resposta deste comando.
// ============================================================

const vip = require('../../vip')
// ⚔️ O banco + a regra determinística da alcunha padrão (dados/ puro, sem deps).
const alcunhas = require('../../dados/alcunhas')
// 🔐 Resolução LID + checagem de VIP na FONTE ÚNICA (vip-acesso.js), o mesmo
// caminho do /nomecustom — nada de lógica de permissão duplicada aqui.
const {
  resolverRemetente,
  checarAcessoVip,
  _injetarChecarVip
} = require('../../vip-acesso')

// Variante de só-permissão (não devolve o número resolvido) — usada pelos testes.
const temPermissao = async (sock, jid, msg) =>
  (await checarAcessoVip(sock, jid, msg, 'alcunha')).autorizado

// ─── 💬 Avisos ───
const AVISO_SEM_PERMISSAO =
  '🔒 *Este feitiço é só para os coroados...*\n\n' +
  'O `/alcunha` é exclusivo dos 💠 *VIPs*.\n\n' +
  '💠 Quer virar VIP? Fale com um dono do bot ou consulte o `/menu-vip`.'

const AVISO_LIMITE =
  '⚠️ *Alcunha inválida.*\n\n' +
  `Use até *${vip.ALCUNHA_MAX}* caracteres, sem quebra de linha e sem emoji.\n\n` +
  'Ex.: */alcunha Punho de Zeus*'

const AVISO_EMOJI =
  '⚠️ *Alcunha com emoji não pode.*\n\n' +
  'O cartaz de procurado é desenhado com uma fonte antiga e emoji sairia como quadradinho vazio. Escreva só com letras.\n\n' +
  'Ex.: */alcunha Punho de Zeus*'

const AVISO_INDISPONIVEL =
  '⛔ O livro dos VIPs está fora de alcance agora... Tente novamente em instantes.'

const AVISO_SEM_VIP_ATIVO =
  '⌛ *Seu VIP não está mais ativo.*\n\n' +
  'A alcunha custom vive junto do selo 💠 — renove o VIP e defina de novo. (A alcunha padrão continua valendo.)'

// Traduz o motivo devolvido pelo vip.js para a mensagem certa.
function avisoDoMotivo (motivo) {
  if (motivo === 'sem-vip') return AVISO_SEM_VIP_ATIVO
  if (motivo === 'curto' || motivo === 'longo' || motivo === 'vazio') return AVISO_LIMITE
  if (motivo === 'emoji') return AVISO_EMOJI
  return AVISO_INDISPONIVEL
}

module.exports = {
  nome: 'alcunha',
  descricao: 'Define seu apelido de guerra no cartaz de procurado (/procurado) — exclusivo para VIPs.',
  categoria: 'vip',

  async executar (sock, jid, msg, text) {
    try {
      // 1) 🔐 Acesso PRIMEIRO (só VIP passa daqui). O `alvo` já vem no NÚMERO
      //    REAL quando o LID foi resolvido — que é o documento de VIP onde a
      //    alcunha custom é gravada.
      const { autorizado, sender, alvo } = await checarAcessoVip(sock, jid, msg, 'alcunha')
      if (!autorizado) {
        return await sock.sendMessage(jid, { text: AVISO_SEM_PERMISSAO }, { quoted: msg }).catch(() => {})
      }

      // 2) Argumento: tudo o que vem depois de "/alcunha"
      const pedido = String(text || '').split(/\s+/).slice(1).join(' ').trim()
      const padrao = alcunhas.alcunhaPadrao(alvo)

      // 3) Sem argumento → mostra a alcunha atual (custom ou padrão)
      if (!pedido) {
        const custom = await vip.obterAlcunhaCustom(alvo)
        const resposta = custom
          ? '⚔️ *SUA ALCUNHA* ⚔️\n\n' +
            `No /procurado você aparece como *${custom}*.\n\n` +
            '✏️ Trocar: */alcunha <texto>*\n' +
            '🧹 Voltar à padrão: */alcunha remover*'
          : '⚔️ *Você ainda não tem alcunha custom.*\n\n' +
            `Sua alcunha PADRÃO (calculada pelo seu número, não muda sozinha) é: *${padrao}*\n\n` +
            `Use */alcunha <texto>* (até ${vip.ALCUNHA_MAX} caracteres) para escolher a sua.`

        return await sock.sendMessage(jid, { text: resposta }, { quoted: msg }).catch(() => {})
      }

      // 4) "remover" / "reset" → volta à alcunha padrão (a do número)
      if (/^(remover|reset)$/i.test(pedido)) {
        const resultado = await vip.removerAlcunha(alvo)
        if (!resultado.ok) {
          return await sock.sendMessage(jid, { text: avisoDoMotivo(resultado.motivo) }, { quoted: msg }).catch(() => {})
        }
        const resposta = resultado.tinha
          ? `🧹 *Alcunha custom removida.*\n\nVocê voltou à alcunha padrão: *${padrao}*`
          : `⚔️ Você não tinha alcunha custom — a padrão sempre valendo é *${padrao}*.`

        return await sock.sendMessage(jid, { text: resposta }, { quoted: msg }).catch(() => {})
      }

      // 5) Caso geral: definir a alcunha (sanitização + limite + exigência de VIP
      //    ativo ficam no vip.js — o comando só traduz o resultado).
      const resultado = await vip.definirAlcunha(alvo, pedido)
      if (!resultado.ok) {
        return await sock.sendMessage(jid, { text: avisoDoMotivo(resultado.motivo) }, { quoted: msg }).catch(() => {})
      }

      console.log(`[alcunha] ⚔️ alcunha definida (${sender}): "${resultado.alcunha}"`)
      await sock.sendMessage(jid, {
        text:
          '⚔️💠 *ALCUNHA DEFINIDA* 💠⚔️\n\n' +
          `A partir de agora o /procurado mostra você como *${resultado.alcunha}*.\n\n` +
          '🧹 Para voltar à alcunha padrão: */alcunha remover*'
      }, { quoted: msg }).catch(() => {})
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa do comando para o socket.
      console.error('[alcunha] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
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
    AVISO_EMOJI,
    AVISO_INDISPONIVEL,
    AVISO_SEM_VIP_ATIVO,
    _injetarChecarVip
  }
}
