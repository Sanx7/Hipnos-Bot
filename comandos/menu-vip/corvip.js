// ============================================================
// 🎨 CORVIP (/corvip, alias /corcustom) — Emoji/cor ao lado do nome
// ============================================================
// Uso:
//   /corvip 🔥        -> define a cor (UM emoji só)
//   /corvip lista     -> mostra as sugestões (e a cor atual)
//   /corvip remover   -> volta ao padrão (também /reset)
//   /corvip           -> mostra a cor atual
//
// 💠 PERMISSÃO: EXCLUSIVO VIP (mesmo caminho do /nomecustom: vip-acesso.js
// resolve o remetente via lid.js e consulta o vip.isVip). Admin e dono do
// bot NÃO entram por conta própria.
//
// 🗄️ Armazenamento: campo `corVip` no MESMO documento de VIP do Mongo
// (collection "vips", gerida pelo vip.js), com o LID resolvido p/ o número
// real antes de gravar — igual ao /nomecustom e ao /darvip.
//
// ✅ VALIDAÇÃO: UM emoji válido, conferido pela lib `emoji-regex` (já no
// projeto como dependência do emoji-mixer). Sequências compostas contam
// como 1 (🧑‍🚀, 🇧🇷, 1️⃣). São recusados: texto comum, 2+ emojis e
// emoji misturado com texto ("🔥 Fulano") — nada é gravado nesses casos.
//
// 📍 Onde a cor aparece: hoje só no /ranking, antes do nome (🔥 João — 120
// mensagens). Sem cor definida, o ranking fica exatamente como está.
// ============================================================

const vip = require('../../vip')
// 🔐 Resolução LID + checagem de VIP na FONTE ÚNICA (vip-acesso.js, raiz),
// compartilhada com o /nomecustom.
const {
  resolverRemetente,
  checarAcessoVip,
  _injetarChecarVip
} = require('../../vip-acesso')

// Variante de só-permissão (testes e quem só precisa do sim/não).
const temPermissao = async (sock, jid, msg) =>
  (await checarAcessoVip(sock, jid, msg, 'corvip')).autorizado

// ─── 💬 Avisos ───
const AVISO_SEM_PERMISSAO =
  '🔒 *Este feitiço é só para os coroados...*\n\n' +
  'O `/corvip` é exclusivo dos 💠 *VIPs*.\n\n' +
  '💠 Quer virar VIP? Fale com um dono do bot ou consulte o `/menu-vip`.'

const AVISO_EMOJI_INVALIDO =
  '🎨 *Preciso de UM emoji só!*\n\n' +
  'Ex.: `/corvip 🔥` — texto comum, vários emojis de uma vez ou emoji misturado com palavras são recusados.'

const AVISO_INDISPONIVEL =
  '⛔ O livro dos VIPs está fora de alcance agora... Tente novamente em instantes.'

const AVISO_SEM_VIP_ATIVO =
  '⌛ *Seu VIP não está mais ativo.*\n\n' +
  'A cor vive junto do selo 💠 — renove o VIP e defina de novo.'

// Traduz o motivo devolvido pelo vip.js para a mensagem certa.
function avisoDoMotivo(motivo) {
  if (motivo === 'sem-vip') return AVISO_SEM_VIP_ATIVO
  if (motivo === 'sem-emoji' || motivo === 'varios' || motivo === 'mistura' || motivo === 'vazio') {
    return AVISO_EMOJI_INVALIDO
  }
  return AVISO_INDISPONIVEL
}

// ─── 📋 Texto das sugestões (`/corvip lista`) ───
function textoDasSugestoes(atual) {
  const linhas = []
  for (let i = 0; i < vip.SUGESTOES_COR_VIP.length; i += 5) {
    linhas.push(vip.SUGESTOES_COR_VIP.slice(i, i + 5).join(' '))
  }

  return (
    '🎨 *CORES DO RECINTO* 🎨\n\n' +
    (atual ? `Sua cor atual: *${atual}*\n\n` : 'Você ainda não escolheu uma cor.\n\n') +
    'Sugestões:\n' +
    linhas.join('\n') +
    '\n\n✨ Escolha a sua: */corvip <emoji>*\n' +
    '🧹 Voltar ao padrão: */corvip remover*'
  )
}

module.exports = {
  nome: 'corvip',
  aliases: ['corcustom'],
  descricao: 'Escolhe o emoji que aparece ao lado do seu nome no /ranking — exclusivo para VIPs.',
  categoria: 'vip',

  async executar(sock, jid, msg, text) {
    try {
      // 1) 🔐 Acesso PRIMEIRO (só VIP passa daqui); o `alvo` vem no número
      //    real quando o LID foi resolvido (documento criado pelo /darvip).
      const { autorizado, sender, alvo } = await checarAcessoVip(sock, jid, msg, 'corvip')
      if (!autorizado) {
        return await sock.sendMessage(jid, { text: AVISO_SEM_PERMISSAO }, { quoted: msg }).catch(() => {})
      }

      // 2) Argumento: tudo o que vem depois de "/corvip"
      const pedido = String(text || '').split(/\s+/).slice(1).join(' ').trim()

      // 3) "lista" (ou "sugestoes") → as sugestões + a cor atual
      if (!pedido || /^(lista|sugestoes|sugestões)$/i.test(pedido)) {
        const atual = await vip.obterCorVip(alvo)
        return await sock.sendMessage(jid, { text: textoDasSugestoes(atual) }, { quoted: msg }).catch(() => {})
      }

      // 4) "remover" / "reset" → volta ao padrão (sem emoji no /ranking)
      if (/^(remover|reset)$/i.test(pedido)) {
        const resultado = await vip.removerCorVip(alvo)
        if (!resultado.ok) {
          return await sock.sendMessage(jid, { text: avisoDoMotivo(resultado.motivo) }, { quoted: msg }).catch(() => {})
        }
        const resposta = resultado.tinha
          ? '🧹 *Cor removida.*\n\nSeu nome volta a aparecer sem emoji no /ranking.'
          : '🎨 Você não tinha cor definida — o /ranking continua sem emoji no seu nome.'

        return await sock.sendMessage(jid, { text: resposta }, { quoted: msg }).catch(() => {})
      }

      // 5) Caso geral: definir a cor (validação do UM emoji fica no vip.js,
      //    junto com o registro no Mongo — o comando só traduz o motivo).
      const resultado = await vip.definirCorVip(alvo, pedido)
      if (!resultado.ok) {
        return await sock.sendMessage(jid, { text: avisoDoMotivo(resultado.motivo) }, { quoted: msg }).catch(() => {})
      }

      console.log(`[corvip] 🎨 cor definida (${sender}): ${resultado.emoji}`)
      await sock.sendMessage(jid, {
        text:
          '🎨💠 *COR DEFINIDA* 💠🎨\n\n' +
          `A partir de agora seu nome aparece com *${resultado.emoji}* no /ranking. 🎨\n\n` +
          '🧹 Para voltar ao padrão: */corvip remover*'
      }, { quoted: msg }).catch(() => {})
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa do comando para o socket.
      console.error('[corvip] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
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
    textoDasSugestoes,
    AVISO_SEM_PERMISSAO,
    AVISO_EMOJI_INVALIDO,
    AVISO_INDISPONIVEL,
    AVISO_SEM_VIP_ATIVO,
    _injetarChecarVip
  }
}
