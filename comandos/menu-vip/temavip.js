// ============================================================
// 🎨 TEMAVIP (/temavip, alias /temacustom) — esquema de cor dos cards
// ============================================================
// Uso:
//   /temavip lista     -> mostra os temas disponíveis (com as 3 cores)
//   /temavip neon      -> aplica o tema nos SEUS cards
//   /temavip remover   -> volta às cores fixas de hoje (também /reset)
//   /temavip           -> mostra o tema atual
//
// 💠 PERMISSÃO: EXCLUSIVO VIP (mesmo caminho do /nomecustom, /corvip e do
// /assinatura: vip-acesso.js resolve o remetente via lid.js e consulta o
// vip.isVip). Admin e dono do bot NÃO entram por conta própria.
//
// 🗄️ Armazenamento: campo `temaVip` no MESMO documento de VIP do Mongo
// (collection "vips", gerida pelo vip.js), com o LID resolvido p/ o número
// real antes de gravar — igual aos outros campos de estilo.
//
// 🎨 Onde o tema aparece: no card do /perfil (a foto sai com fundo,
// moldura/faixa e nome nas cores do tema) e nos cards de par do /ship,
// /shipme, /kiss e /kissme (fundo, anel/coração, barra e texto). Sem tema
// (ou sem VIP) os cards continuam EXATAMENTE os de hoje.
// ============================================================

const vip = require('../../vip')
// 🎨 Catálogo de temas (nomes + paletas) — fonte única das listagens.
const temasVip = require('../../temas-vip')
// 🔐 Resolução LID + checagem de VIP na FONTE ÚNICA (vip-acesso.js, raiz),
// compartilhada com o /nomecustom, o /corvip e o /assinatura.
const {
  resolverRemetente,
  checarAcessoVip,
  _injetarChecarVip
} = require('../../vip-acesso')

// Variante de só-permissão (testes e quem só precisa do sim/não).
const temPermissao = async (sock, jid, msg) =>
  (await checarAcessoVip(sock, jid, msg, 'temavip')).autorizado

// ─── 💬 Avisos ───
const AVISO_SEM_PERMISSAO =
  '🔒 *Este feitiço é só para os coroados...*\n\n' +
  'O `/temavip` é exclusivo dos 💠 *VIPs*.\n\n' +
  '💠 Quer virar VIP? Fale com um dono do bot ou consulte o `/menu-vip`.'

const AVISO_VAZIO = '⚠️ *Tema vazio.* Escreva o tema depois do comando (ex.: */temavip neon*) ou use */temavip lista*.'

const AVISO_INDISPONIVEL =
  '⛔ O livro dos VIPs está fora de alcance agora... Tente novamente em instantes.'

const AVISO_SEM_VIP_ATIVO =
  '⌛ *Seu VIP não está mais ativo.*\n\n' +
  'O tema dos cards vive junto do selo 💠 — renove o VIP e escolha de novo.'

// 📋 Monta a lista dos temas com as 3 cores de cada um (swatch em texto).
// Exibe a CHAVE digitável (é o que o /temavip aceita e o que fica gravado);
// a marca ✅ compara com a chave do tema atual (sem acento).
function textoDosTemas(temaAtual) {
  const linhas = temasVip.listarTemas().map((paleta) => {
    const marca = paleta.chave === temaAtual ? ' ✅ *atual*' : ''
    return (
      `${paleta.emoji} *${paleta.chave}*${marca}\n` +
      `   fundo \`${paleta.fundo}\` · texto \`${paleta.texto}\` · destaque \`${paleta.destaque}\`\n` +
      `   _${paleta.descricao}_`
    )
  })
  return (
    '🎨 *TEMAS DE COR DISPONÍVEIS* 🎨\n\n' +
    linhas.join('\n\n') +
    '\n\n───────────\n' +
    '✏️ Aplicar: */temavip <nome>* (ex.: */temavip dourado*)\n' +
    '🧹 Voltar ao padrão: */temavip remover*'
  )
}

// 🎨 Resumo curto do tema que a pessoa já tem.
function textoDoTemaAtual(temaAtual) {
  if (!temaAtual) {
    return (
      '🎨 *Você ainda não escolheu um tema.*\n\n' +
      'Seus cards saem com as cores de sempre. Veja as opções com ' +
      '*/temavip lista* e aplique com */temavip <nome>*.'
    )
  }
  const paleta = temasVip.obterPaleta(temaAtual)
  return (
    '🎨 *SEU TEMA DE COR* 🎨\n\n' +
    `${paleta.emoji} *${paleta.nome}* — ${paleta.descricao}\n\n` +
    `fundo \`${paleta.fundo}\` · texto \`${paleta.texto}\` · destaque \`${paleta.destaque}\`\n\n` +
    'Onde vale: o card do */perfil* e os cards de */ship*, */kiss* (e variações).\n\n' +
    '✏️ Trocar: */temavip <nome>*\n' +
    '📋 Opções: */temavip lista*\n' +
    '🧹 Desligar: */temavip remover*'
  )
}

// Traduz o motivo devolvido pelo vip.js para a mensagem certa.
function avisoDoMotivo(motivo, opcoes = []) {
  if (motivo === 'sem-vip') return AVISO_SEM_VIP_ATIVO
  if (motivo === 'vazio') return AVISO_VAZIO
  if (motivo === 'desconhecido') {
    const lista = (opcoes.length ? opcoes : temasVip.listarNomes()).join(', ')
    return (
      '❓ *Tema desconhecido.*\n\n' +
      `Os temas válidos são: *${lista}*.\n\n` +
      'Use */temavip lista* para ver as cores de cada um.'
    )
  }
  return AVISO_INDISPONIVEL
}

module.exports = {
  nome: 'temavip',
  aliases: ['temacustom'],
  descricao: 'Escolhe o esquema de cor (fundo/texto/destaque) dos cards que o bot gera para você — exclusivo para VIPs.',
  categoria: 'vip',

  async executar(sock, jid, msg, text) {
    try {
      // 1) 🔐 Acesso PRIMEIRO (só VIP passa daqui); o `alvo` vem no número
      //    real quando o LID foi resolvido (documento criado pelo /darvip).
      const { autorizado, sender, alvo } = await checarAcessoVip(sock, jid, msg, 'temavip')
      if (!autorizado) {
        return await sock.sendMessage(jid, { text: AVISO_SEM_PERMISSAO }, { quoted: msg }).catch(() => {})
      }

      // 2) Argumento: tudo o que vem depois de "/temavip"
      const pedido = String(text || '').split(/\s+/).slice(1).join(' ').trim()

      // 3) Sem argumento → mostra o tema atual (ou o convite)
      if (!pedido) {
        const atual = await vip.obterTemaVip(alvo)
        return await sock.sendMessage(jid, { text: textoDoTemaAtual(atual) }, { quoted: msg }).catch(() => {})
      }

      // 4) "lista" → o catálogo com as cores (com o atual marcado)
      if (/^(lista|listar|list)$/i.test(pedido)) {
        const atual = await vip.obterTemaVip(alvo)
        return await sock.sendMessage(jid, { text: textoDosTemas(atual) }, { quoted: msg }).catch(() => {})
      }

      // 5) "remover" / "reset" → desliga o tema (cores fixas de hoje)
      if (/^(remover|reset)$/i.test(pedido)) {
        const resultado = await vip.removerTemaVip(alvo)
        if (!resultado.ok) {
          return await sock.sendMessage(jid, { text: avisoDoMotivo(resultado.motivo) }, { quoted: msg }).catch(() => {})
        }
        const resposta = resultado.tinha
          ? '🧹 *Tema removido.*\n\nSeus cards voltam a sair com as cores de sempre (/perfil, /ship, /kiss).'
          : '🎨 Você não tinha tema definido — seus cards seguem com as cores de sempre.'
        return await sock.sendMessage(jid, { text: resposta }, { quoted: msg }).catch(() => {})
      }

      // 6) Caso geral: aplicar (validação do nome e gravação ficam no vip.js,
      //    junto com o registro no Mongo).
      const resultado = await vip.definirTemaVip(alvo, pedido)
      if (!resultado.ok) {
        return await sock.sendMessage(jid, { text: avisoDoMotivo(resultado.motivo, resultado.opcoes) }, { quoted: msg }).catch(() => {})
      }

      const paleta = temasVip.obterPaleta(resultado.tema)
      console.log(`[temavip] 🎨 tema definido (${sender}): ${resultado.tema}`)
      await sock.sendMessage(jid, {
        text:
          '🎨💠 *TEMA APLICADO* 💠🎨\n\n' +
          `${paleta.emoji} *${paleta.nome}* — ${paleta.descricao}\n\n` +
          `fundo \`${paleta.fundo}\` · texto \`${paleta.texto}\` · destaque \`${paleta.destaque}\`\n\n` +
          'A partir de agora seus cards saem nessa paleta: card do */perfil* e cards de */ship* e */kiss*.\n\n' +
          '🧹 Para desligar: */temavip remover*'
      }, { quoted: msg }).catch(() => {})
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa do comando para o socket.
      console.error('[temavip] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
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
    textoDosTemas,
    textoDoTemaAtual,
    AVISO_SEM_PERMISSAO,
    AVISO_VAZIO,
    AVISO_INDISPONIVEL,
    AVISO_SEM_VIP_ATIVO,
    _injetarChecarVip
  }
}

