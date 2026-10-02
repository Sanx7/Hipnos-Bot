// ============================================================
// ✍️ ASSINATURA (/assinatura, alias /assinaturavip) — nome de autor (EXIF)
// ============================================================
// Uso:
//   /assinatura @joaovip  -> define a assinatura (até 35 caracteres, emoji ok)
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
// 📐 Regras (validadas no vip.js): até 35 caracteres, sem quebra de linha
// nem caracteres invisíveis; emoji PERMITIDO (o EXIF grava UTF-8 puro).
//
// 📍 Onde a assinatura aparece: NO EXIF das figurinhas criadas com /s e
// /figurinha — pack fixo "Hipnos Bot" + autor = assinatura (ou "Sombras do
// Limbo" quando não há). É o "pack • autor" que o WhatsApp mostra ao
// segurar a figurinha. Sem assinatura (ou sem VIP) o EXIF segue o padrão.
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
  `O nome de autor aceita até *${vip.ASSINATURA_MAX}* caracteres, sem quebra de linha.`

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
  // Motivo legado 'emoji' (assinaturas antigas recusavam emoji): hoje o
  // emoji é permitido, então cai no genérico sem quebrar o comando.
  if (motivo === 'vazio') return AVISO_VAZIA
  return AVISO_INDISPONIVEL
}

module.exports = {
  nome: 'assinatura',
  aliases: ['assinaturavip'],
  descricao: "Define o nome de autor das suas figurinhas (/s e /figurinha) — o que aparece no EXIF como 'pack • autor'. Exclusivo para VIPs.",
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
            `Suas figurinhas do /s e do /figurinha saem com o autor: *${atual}*\n` +
            '(pack "Hipnos Bot" • o autor aparece ao segurar a figurinha)\n\n' +
            '✏️ Trocar: */assinatura <texto>*\n' +
            '🧹 Desligar: */assinatura remover*'
          : '✍️ *Você ainda não tem assinatura.*\n\n' +
            `Use */assinatura <texto>* (até ${vip.ASSINATURA_MAX} caracteres, emoji liberado) para personalizar o nome de autor das suas figurinhas do /s e do /figurinha.`

        return await sock.sendMessage(jid, { text: resposta }, { quoted: msg }).catch(() => {})
      }

      // 4) "remover" / "reset" → desliga a assinatura (o EXIF volta ao padrão)
      if (/^(remover|reset)$/i.test(pedido)) {
        const resultado = await vip.removerAssinatura(alvo)
        if (!resultado.ok) {
          return await sock.sendMessage(jid, { text: avisoDoMotivo(resultado.motivo) }, { quoted: msg }).catch(() => {})
        }
        const resposta = resultado.tinha
          ? '🧹 *Assinatura removida.*\n\nSuas figurinhas voltam a sair com o autor padrão.'
          : '✍️ Você não tinha assinatura definida — suas figurinhas seguem com o autor padrão.'

        return await sock.sendMessage(jid, { text: resposta }, { quoted: msg }).catch(() => {})
      }

      // 5) Caso geral: definir (limite de tamanho e saneamento ficam no
      //    vip.js, junto com o registro no Mongo). Emoji é permitido.
      const resultado = await vip.definirAssinatura(alvo, pedido)
      if (!resultado.ok) {
        return await sock.sendMessage(jid, { text: avisoDoMotivo(resultado.motivo) }, { quoted: msg }).catch(() => {})
      }

      console.log(`[assinatura] ✍️ assinatura definida (${sender}): "${resultado.assinatura}"`)
      await sock.sendMessage(jid, {
        text:
          '✍️💠 *ASSINATURA DEFINIDA* 💠✍️\n\n' +
          `A partir de agora suas figurinhas do /s e do /figurinha saem com o autor *${resultado.assinatura}* (pack "Hipnos Bot").\n\n` +
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
    AVISO_VAZIA,
    AVISO_INDISPONIVEL,
    AVISO_SEM_VIP_ATIVO,
    _injetarChecarVip
  }
}
