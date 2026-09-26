// ============================================================
// ✍️ ASSINATURA (/assinatura, alias /assinaturavip) — marca d'água
// ============================================================
// Uso:
//   /assinatura @joaovip  -> define a assinatura (até 15 caracteres)
//   /assinatura          -> mostra a atual
//   /assinatura remover  -> desliga (também /reset)
//
// 💠 PERMISSÃO: EXCLUSIVO VIP (mesmo caminho do /nomecustom e do /corvip:
// vip-acesso.js resolve o remetente via lid.js e consulta o vip.isVip).
// Admin e dono do bot NÃO entram por conta própria.
//
// 🗄️ Armazenamento: campo `assinatura` no MESMO documento de VIP do Mongo
// (collection "vips", gerida pelo vip.js), com o LID resolvido p/ o número
// real antes de gravar — igual ao /nomecustom e ao /darvip.
//
// 📐 Regras (validadas no vip.js): até 15 caracteres, sem quebra de linha
// nem caracteres invisíveis e SEM EMOJI (o drawtext do ffmpeg escreve com
// fonte TTF comum e um emoji sairia como quadradinho vazio na figurinha).
//
// 📍 Onde a assinatura aparece: nas figurinhas criadas com /s e /figurinha,
// no canto inferior direito, fonte pequena com leve contorno. Sem assinatura
// (ou sem VIP) o comportamento dos dois comandos é EXATAMENTE o de hoje.
// ============================================================

const vip = require('../../vip')
// 🔐 Resolução LID + checagem de VIP na FONTE ÚNICA (vip-acesso.js, raiz),
// compartilhada com o /nomecustom e o /corvip.
const {
  resolverRemetente,
  checarAcessoVip,
  _injetarChecarVip
} = require('../../vip-acesso')

// Variante de só-permissão (testes e quem só precisa do sim/não).
const temPermissao = async (sock, jid, msg) =>
  (await checarAcessoVip(sock, jid, msg, 'assinatura')).autorizado

// ─── 💬 Avisos ───
const AVISO_SEM_PERMISSAO =
  '🔒 *Este feitiço é só para os coroados...*\n\n' +
  'O `/assinatura` é exclusivo dos 💠 *VIPs*.\n\n' +
  '💠 Quer virar VIP? Fale com um dono do bot ou consulte o `/menu-vip`.'

const AVISO_LIMITE =
  `⚠️ *Assinatura muito longa.*\n\n` +
  `A figurinha é pequena (512×512): use até *${vip.ASSINATURA_MAX}* caracteres, sem quebra de linha.`

const AVISO_EMOJI =
  '⚠️ *Sem emoji na assinatura.*\n\n' +
  'A marca é escrita com fonte comum e um emoji sairia como quadradinho vazio na figurinha. Use só texto (ex.: */assinatura @joaovip*).'

const AVISO_VAZIA = '⚠️ *Assinatura vazia.* Escreva o texto depois do comando (ex.: */assinatura @joaovip*).'

const AVISO_INDISPONIVEL =
  '⛔ O livro dos VIPs está fora de alcance agora... Tente novamente em instantes.'

const AVISO_SEM_VIP_ATIVO =
  '⌛ *Seu VIP não está mais ativo.*\n\n' +
  'A assinatura vive junto do selo 💠 — renove o VIP e defina de novo.'

// Traduz o motivo devolvido pelo vip.js para a mensagem certa.
function avisoDoMotivo(motivo) {
  if (motivo === 'sem-vip') return AVISO_SEM_VIP_ATIVO
  if (motivo === 'longo') return AVISO_LIMITE
  if (motivo === 'emoji') return AVISO_EMOJI
  if (motivo === 'vazio') return AVISO_VAZIA
  return AVISO_INDISPONIVEL
}

module.exports = {
  nome: 'assinatura',
  aliases: ['assinaturavip'],
  descricao: "Define a marca d'água que aparece nas suas figurinhas (/s e /figurinha) — exclusivo para VIPs.",
  categoria: 'vip',

  async executar(sock, jid, msg, text) {
    try {
      // 1) 🔐 Acesso PRIMEIRO (só VIP passa daqui); o `alvo` vem no número
      //    real quando o LID foi resolvido (documento criado pelo /darvip).
      const { autorizado, sender, alvo } = await checarAcessoVip(sock, jid, msg, 'assinatura')
      if (!autorizado) {
        return await sock.sendMessage(jid, { text: AVISO_SEM_PERMISSAO }, { quoted: msg }).catch(() => {})
      }

      // 2) Argumento: tudo o que vem depois de "/assinatura"
      const pedido = String(text || '').split(/\s+/).slice(1).join(' ').trim()

      // 3) Sem argumento → mostra a assinatura atual
      if (!pedido) {
        const atual = await vip.obterAssinatura(alvo)
        const resposta = atual
          ? '✍️ *SUA ASSINATURA* ✍️\n\n' +
            `Suas figurinhas do /s e do /figurinha saem marcadas como: *${atual}*\n\n` +
            '✏️ Trocar: */assinatura <texto>*\n' +
            '🧹 Desligar: */assinatura remover*'
          : '✍️ *Você ainda não tem assinatura.*\n\n' +
            `Use */assinatura <texto>* (até ${vip.ASSINATURA_MAX} caracteres, sem emoji) para marcar suas figurinhas do /s e do /figurinha.`

        return await sock.sendMessage(jid, { text: resposta }, { quoted: msg }).catch(() => {})
      }

      // 4) "remover" / "reset" → desliga a marca d'água
      if (/^(remover|reset)$/i.test(pedido)) {
        const resultado = await vip.removerAssinatura(alvo)
        if (!resultado.ok) {
          return await sock.sendMessage(jid, { text: avisoDoMotivo(resultado.motivo) }, { quoted: msg }).catch(() => {})
        }
        const resposta = resultado.tinha
          ? "🧹 *Assinatura removida.*\n\nSuas figurinhas voltam a sair sem marca d'água."
          : "✍️ Você não tinha assinatura definida — suas figurinhas seguem sem marca d'água."

        return await sock.sendMessage(jid, { text: resposta }, { quoted: msg }).catch(() => {})
      }

      // 5) Caso geral: definir (limite de tamanho, saneamento e recusa de emoji
      //    ficam no vip.js, junto com o registro no Mongo).
      const resultado = await vip.definirAssinatura(alvo, pedido)
      if (!resultado.ok) {
        return await sock.sendMessage(jid, { text: avisoDoMotivo(resultado.motivo) }, { quoted: msg }).catch(() => {})
      }

      console.log(`[assinatura] ✍️ assinatura definida (${sender}): "${resultado.assinatura}"`)
      await sock.sendMessage(jid, {
        text:
          '✍️💠 *ASSINATURA DEFINIDA* 💠✍️\n\n' +
          `A partir de agora suas figurinhas do /s e do /figurinha saem marcadas como *${resultado.assinatura}*.\n\n` +
          '🧹 Para desligar: */assinatura remover*'
      }, { quoted: msg }).catch(() => {})
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa do comando para o socket.
      console.error('[assinatura] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
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
    AVISO_VAZIA,
    AVISO_INDISPONIVEL,
    AVISO_SEM_VIP_ATIVO,
    _injetarChecarVip
  }
}
