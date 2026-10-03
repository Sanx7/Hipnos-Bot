// ============================================================
// ✍️📦 ASSINATURA (/assinatura, alias /assinaturavip) — autor + pack (EXIF)
// ============================================================
// Uso:
//   /assinatura <texto>        -> define SÓ o autor (comportamento atual)
//   /assinatura pack <texto>   -> define SÓ o nome do pack customizado
//   /assinatura                -> mostra os dois valores atuais (autor e pack)
//   /assinatura remover        -> desliga SÓ o autor (volta ao padrão)
//   /assinatura pack remover   -> desliga SÓ o pack (volta a "Hipnos Bot")
//   (também /reset no lugar de remover, nos dois casos)
//
// 💠 PERMISSÃO: EXCLUSIVO VIP (mesmo caminho do /nomecustom e do /corvip:
// vip-acesso.js resolve o remetente via lid.js e consulta o vip.isVip).
// Admin e dono do bot NÃO entram por conta própria.
//
// 🗄️ Armazenamento: campos `assinatura` (autor) e `packCustom` (pack) no MESMO
// documento de VIP do Mongo (collection "vips", gerida pelo vip.js), com o LID
// resolvido p/ o número real antes de gravar — igual ao /nomecustom e ao /darvip.
//
// 📐 Regras (validadas no vip.js): até 35 caracteres (ASSINATURA_MAX), sem
// quebra de linha nem caracteres invisíveis; emoji PERMITIDO (o EXIF grava
// UTF-8 puro). O pack custom usa o MESMO limite e a MESMA sanitização do autor.
//
// 📍 Onde a assinatura aparece: NO EXIF das figurinhas criadas com /s e
// /figurinha — pack = packCustom (ou "Hipnos Bot" quando não há) + autor =
// assinatura (ou "Sombras do Limbo" quando não há). É o "pack • autor" que o
// WhatsApp mostra ao segurar a figurinha. Sem assinatura (ou sem VIP) o EXIF
// segue o padrão.
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

// PACK_PADRAO espelha o pack padrão do /s e do /figurinha: é o que aparece
// quando o VIP não tem pack custom.
const PACK_PADRAO = 'Hipnos Bot'
const AUTOR_PADRAO = 'Sombras do Limbo'

// ─── 💬 Avisos ───
const AVISO_SEM_PERMISSAO =
  '🔒 *Este feitiço é só para os coroados...*\n\n' +
  'O `/assinatura` é exclusivo dos 💠 *VIPs*.\n\n' +
  '💠 Quer virar VIP? Fale com um dono do bot ou consulte o `/menu-vip`.'

const AVISO_LIMITE_AUTOR =
  `⚠️ *Assinatura muito longa.*\n\n` +
  `O nome de autor aceita até *${vip.ASSINATURA_MAX}* caracteres, sem quebra de linha.`

const AVISO_LIMITE_PACK =
  `⚠️ *Nome do pack muito longo.*\n\n` +
  `O nome do pack aceita até *${vip.ASSINATURA_MAX}* caracteres, sem quebra de linha.`

const AVISO_VAZIA_AUTOR = '⚠️ *Assinatura vazia.* Escreva o texto depois do comando (ex.: */assinatura @joaovip*).'
const AVISO_VAZIA_PACK = '⚠️ *Nome do pack vazio.* Escreva o texto depois do comando (ex.: */assinatura pack Meu Pack*).'

const AVISO_INDISPONIVEL =
  '⛔ O livro dos VIPs está fora de alcance agora... Tente novamente em instantes.'

const AVISO_SEM_VIP_ATIVO =
  '⌛ *Seu VIP não está mais ativo.*\n\n' +
  'A assinatura vive junto do selo 💠 — renove o VIP e defina de novo.'

// Traduz o motivo devolvido pelo vip.js para a mensagem certa.
// `campo` é 'autor' (padrão) ou 'pack': o limite varia só no texto.
function avisoDoMotivo(motivo, campo = 'autor') {
  if (motivo === 'sem-vip') return AVISO_SEM_VIP_ATIVO
  if (motivo === 'longo') return campo === 'pack' ? AVISO_LIMITE_PACK : AVISO_LIMITE_AUTOR
  // Motivo legado 'emoji' (assinaturas antigas recusavam emoji): hoje o
  // emoji é permitido, então cai no genérico sem quebrar o comando.
  if (motivo === 'vazio') return campo === 'pack' ? AVISO_VAZIA_PACK : AVISO_VAZIA_AUTOR
  return AVISO_INDISPONIVEL
}

// Compat: o teste antigo lê AVISO_LIMITE e AVISO_VAZIA (modo autor).
const AVISO_LIMITE = AVISO_LIMITE_AUTOR
const AVISO_VAZIA = AVISO_VAZIA_AUTOR

// Separa "/assinatura pack <texto>" (modo pack) de "/assinatura <texto>"
// (modo autor). Só a palavra "pack" como PRIMEIRO argumento troca o modo.
function separarModo(pedido) {
  const texto = String(pedido || '').trim()
  const semPack = texto.replace(/^pack(?:\s+|$)/i, '')
  if (semPack !== texto) return { modo: 'pack', resto: semPack.trim() }
  return { modo: 'autor', resto: texto }
}

function ehRemover(resto) {
  return /^(remover|reset)$/i.test(String(resto || '').trim())
}

module.exports = {
  nome: 'assinatura',
  aliases: ['assinaturavip'],
  descricao: "Define o nome de autor e o nome do pack das suas figurinhas (/s e /figurinha) — o que aparece no EXIF como 'pack • autor'. Use /assinatura <texto> pro autor e /assinatura pack <texto> pro pack. Exclusivo para VIPs.",
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
      const { modo, resto } = separarModo(pedido)

      // 3) Sem argumento → mostra os DOIS valores atuais (autor e pack)
      if (!pedido) {
        const completo = await vip.obterAssinaturaCompleta(alvo)
        const atualAutor = completo?.autor || null
        const atualPack = completo?.pack || null
        const linhaAutor = atualAutor ? `✍️ Autor: *${atualAutor}*` : `✍️ Autor: padrão (*${AUTOR_PADRAO}*)`
        const linhaPack = atualPack ? `📦 Pack: *${atualPack}*` : `📦 Pack: padrão (*${PACK_PADRAO}*)`
        const temAlgum = Boolean(atualAutor || atualPack)
        const resposta = temAlgum
          ? '✍️ *SUA ASSINATURA* ✍️\n\n' +
            `Suas figurinhas do /s e do /figurinha saem assim: *${atualPack || PACK_PADRAO} • ${atualAutor || AUTOR_PADRAO}*\n` +
            `${linhaAutor}\n` +
            `${linhaPack}\n` +
            '(o pack e o autor aparecem ao segurar a figurinha)\n\n' +
            '✏️ Trocar autor: */assinatura <texto>*\n' +
            '📦 Trocar pack: */assinatura pack <texto>*\n' +
            '🧹 Desligar autor: */assinatura remover*\n' +
            '🧹 Desligar pack: */assinatura pack remover*'
          : '✍️ *Você ainda não tem assinatura.*\n\n' +
            `${linhaAutor}\n${linhaPack}\n\n` +
            `Use */assinatura <texto>* (até ${vip.ASSINATURA_MAX} caracteres, emoji liberado) para personalizar o nome de autor, ` +
            `e */assinatura pack <texto>* para personalizar o nome do pack das suas figurinhas do /s e do /figurinha.`

        return await sock.sendMessage(jid, { text: resposta }, { quoted: msg }).catch(() => {})
      }

      // 3b) "/assinatura pack" sozinho (sem texto) → mostra os dois atuais
      if (modo === 'pack' && !resto) {
        const completo = await vip.obterAssinaturaCompleta(alvo)
        const atualAutor = completo?.autor || null
        const atualPack = completo?.pack || null
        const linhaAutor = atualAutor ? `✍️ Autor: *${atualAutor}*` : `✍️ Autor: padrão (*${AUTOR_PADRAO}*)`
        const linhaPack = atualPack ? `📦 Pack: *${atualPack}*` : `📦 Pack: padrão (*${PACK_PADRAO}*)`
        const resposta = '✍️ *SUA ASSINATURA* ✍️\n\n' +
          `${linhaAutor}\n${linhaPack}\n\n` +
          `📦 Definir pack: */assinatura pack <texto>* (até ${vip.ASSINATURA_MAX} caracteres, emoji liberado)\n` +
          '🧹 Desligar pack: */assinatura pack remover*'
        return await sock.sendMessage(jid, { text: resposta }, { quoted: msg }).catch(() => {})
      }

      // 4) "remover" / "reset" → desliga UM campo (o EXIF volta ao padrão nele)
      if (ehRemover(resto)) {
        if (modo === 'pack') {
          const resultado = await vip.removerPackCustom(alvo)
          if (!resultado.ok) {
            return await sock.sendMessage(jid, { text: avisoDoMotivo(resultado.motivo, 'pack') }, { quoted: msg }).catch(() => {})
          }
          const resposta = resultado.tinha
            ? '🧹 *Nome do pack removido.*\n\nSuas figurinhas voltam a sair com o pack padrão "Hipnos Bot".'
            : '📦 Você não tinha nome de pack definido — suas figurinhas seguem com o pack padrão "Hipnos Bot".'
          return await sock.sendMessage(jid, { text: resposta }, { quoted: msg }).catch(() => {})
        }
        const resultado = await vip.removerAssinatura(alvo)
        if (!resultado.ok) {
          return await sock.sendMessage(jid, { text: avisoDoMotivo(resultado.motivo, 'autor') }, { quoted: msg }).catch(() => {})
        }
        const resposta = resultado.tinha
          ? '🧹 *Assinatura removida.*\n\nSuas figurinhas voltam a sair com o autor padrão.'
          : '✍️ Você não tinha assinatura definida — suas figurinhas seguem com o autor padrão.'

        return await sock.sendMessage(jid, { text: resposta }, { quoted: msg }).catch(() => {})
      }

      // 5) Caso geral: definir (limite de tamanho e saneamento ficam no
      //    vip.js, junto com o registro no Mongo). Emoji é permitido.
      if (modo === 'pack') {
        const resultado = await vip.definirPackCustom(alvo, resto)
        if (!resultado.ok) {
          return await sock.sendMessage(jid, { text: avisoDoMotivo(resultado.motivo, 'pack') }, { quoted: msg }).catch(() => {})
        }
        console.log(`[assinatura] 📦 pack custom definido (${sender}): "${resultado.packCustom}"`)
        await sock.sendMessage(jid, {
          text:
            '📦💠 *PACK DEFINIDO* 💠📦\n\n' +
            `A partir de agora suas figurinhas do /s e do /figurinha saem no pack *${resultado.packCustom}*.\n\n` +
            '🧹 Para desligar: */assinatura pack remover*'
        }, { quoted: msg }).catch(() => {})
        return
      }
      const resultado = await vip.definirAssinatura(alvo, resto)
      if (!resultado.ok) {
        return await sock.sendMessage(jid, { text: avisoDoMotivo(resultado.motivo, 'autor') }, { quoted: msg }).catch(() => {})
      }

      console.log(`[assinatura] ✍️ assinatura definida (${sender}): "${resultado.assinatura}"`)
      await sock.sendMessage(jid, {
        text:
          '✍️💠 *ASSINATURA DEFINIDA* 💠✍️\n\n' +
          `A partir de agora suas figurinhas do /s e do /figurinha saem com o autor *${resultado.assinatura}*.\n\n` +
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
    separarModo,
    AVISO_SEM_PERMISSAO,
    AVISO_LIMITE,
    AVISO_LIMITE_AUTOR,
    AVISO_LIMITE_PACK,
    AVISO_VAZIA,
    AVISO_VAZIA_AUTOR,
    AVISO_VAZIA_PACK,
    AVISO_INDISPONIVEL,
    AVISO_SEM_VIP_ATIVO,
    PACK_PADRAO,
    AUTOR_PADRAO,
    _injetarChecarVip
  }
}
