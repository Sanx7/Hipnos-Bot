// ============================================================
// 🔤 SET-PREFIX (/set-prefix, alias /prefixo) — PREFIXO dos comandos
// ============================================================
// Uso:
//   /set-prefix            -> mostra o prefixo ATUAL dos comandos
//   /set-prefix !          -> troca o prefixo para "!" (vale na HORA)
//   /set-prefix exclamacao -> mesma coisa, pelo nome do símbolo
//   /set-prefix reset      -> volta ao "/" (também: padrao, slash, barra)
//
// 🔒 PERMISSÃO: APENAS DONOS DO BOT (mesmo padrão do /ia-interativa —
//    OWNER_NUMBERS + ehDonoDoBot, que resolve o remetente mesmo quando o
//    WhatsApp o entrega como "@lid"). Admin de grupo NÃO troca o prefixo:
//    isso afeta o bot inteiro, não só um grupo. Funciona no privado e no grupo.
//
// 🗄️ Persistência: MongoDB, collection "prefixoComando", 1 documento
//    { _id: "global", prefixo } — toda a lógica (validação, cache de 60s,
//    gravação) vive em prefixo.js (RAIZ do projeto), a FONTE ÚNICA do
//    prefixo. O bot.js lê o mesmo módulo no roteador.
//
// ⚡ TEMPO REAL: o /set-prefix grava no Mongo e atualiza o cache do módulo
//    na mesma hora — a mensagem seguinte já responde pelo prefixo novo,
//    sem reiniciar o bot. O prefixo antigo continua aceito (barra legada),
//    então nada quebra para quem já digitava "/" (ver prefixo.js).
// ============================================================

const { OWNER_NUMBERS, limparNumero, ehDonoDoBot } = require('../../config')
const prefixoComandos = require('../../prefixo')

// 🔤 Opções que significam "volta ao padrão" (além de "/", que o próprio
// validarPrefixo já traduz).
const OPCOES_RESET = ['reset', 'resetar', 'padrao', 'padrão', 'default']

// 👤 O remetente é DONO do bot? (1º teste direto pelo número real; em
// grupo, confirma via metadados — padrão PROOF-LID do bot.js). Nunca lança.
async function remetenteEhDono(sock, jid, sender) {
  if (OWNER_NUMBERS.includes(limparNumero(sender))) return true
  if (!String(jid || '').endsWith('@g.us')) return false
  try {
    const metadados = await sock.groupMetadata(jid)
    return ehDonoDoBot(metadados?.participants || [], sender)
  } catch (err) {
    console.error('[set-prefix] falha ao buscar metadados (checando dono):', err?.message || err)
    return false
  }
}

// ─── 💬 Textos ───
function textoStatus(atual) {
  return (
    '🔤 *PREFIXO DOS COMANDOS*\n\n' +
    `Hoje os comandos respondem a: *${atual}*\n\n` +
    `Ex.: *${atual}perfil* • *${atual}menu* • *${atual}ping*\n\n` +
    `🔁 Trocar: *${atual}set-prefix !*  (ou pelo nome: *${atual}set-prefix exclamacao*)\n` +
    `↩️ Voltar ao "/": *${atual}set-prefix reset*`
  )
}

function textoTroca(novo, anterior) {
  const legado = anterior && anterior !== novo && anterior !== '/'
    ? `\nℹ️ O prefixo anterior (*${anterior}*) continua funcionando — nada quebra para quem já digitava assim.`
    : '\nℹ️ A "/" continua funcionando como atalho, para o grupo não perder o costume.'
  return (
    '🔤 *PREFIXO TROCADO*\n\n' +
    `A partir de agora os comandos respondem a: *${novo}*\n\n` +
    `Ex.: *${novo}perfil* • *${novo}menu* • *${novo}ping*` +
    legado +
    '\n💾 Salvo no banco — o prefixo sobrevive a reinício e redeploy.'
  )
}

function textoJaIgual(atual) {
  return `🔤 O prefixo já é *${atual}*. Nada mudou.`
}

// motivo (do prefixo.js) → frase amigável
function textoErro(motivo, atual) {
  if (motivo === 'longo') {
    return '❌ *O prefixo precisa ser UM caractere só.*\n\nEx.: `/set-prefix !`'
  }
  if (motivo === 'espaco') {
    return '❌ *O prefixo não pode ser espaço.*\n\nEx.: `/set-prefix !`'
  }
  if (motivo === 'invalido') {
    return (
      '❌ *Prefixo inválido.*\n\n' +
      'Não pode ser letra nem número: um prefixo de letra roubaria as mensagens normais do grupo ' +
      '(com "c", por exemplo, "casa" viraria comando).\n\n' +
      '💡 Use um símbolo: *!* . *-* + *?* *#*'
    )
  }
  if (motivo === 'vazio') {
    return `❌ Diga o novo prefixo depois do comando.\n\nEx.: \`${atual}set-prefix !\``
  }
  if (motivo === 'banco') {
    return (
      '⛔ *Não consegui gravar o prefixo agora.*\n\n' +
      'O banco de dados parece fora do ar, então o prefixo segue como está ' +
      `(o bot continua funcionando com *${atual}*). Tente de novo em instantes.`
    )
  }
  return '❌ Não entendi o prefixo pedido. Use *`/set-prefix !`* ou */set-prefix reset*.'
}

module.exports = {
  nome: 'set-prefix',
  aliases: ['prefixo', 'setprefix', 'prefixocomando'],
  descricao: 'Mostra ou troca o prefixo dos comandos do bot (ex.: de / para !) — apenas donos.',
  categoria: 'dono',

  async executar(sock, jid, msg, text) {
    try {
      const sender = msg.key.participant || msg.key.remoteJid

      // 1) 🔒 SOMENTE DONOS DO BOT
      if (!(await remetenteEhDono(sock, jid, sender))) {
        return await sock.sendMessage(jid, {
          text: '🌑 *O prefixo dos comandos é segredo dos donos.*\n\nSó o dono do bot pode trocá-lo — ele vale para o bot inteiro, em todos os grupos.'
        }, { quoted: msg })
      }

      // 2) 🎛️ Argumento (o que vem depois de "/set-prefix")
      const p = prefixoComandos.prefixoSincrono()
      const pedido = String(text || '').trim().split(/\s+/).slice(1).join(' ').trim()
      const opcao = pedido.split(/\s+/)[0] || ''

      // 3) Sem argumento → status
      if (!opcao) {
        return await sock.sendMessage(jid, { text: textoStatus(p) }, { quoted: msg })
      }

      // 4) Reset → volta ao "/" (validarPrefixo também traduz "slash"/"barra")
      if (OPCOES_RESET.includes(opcao.toLowerCase())) {
        const resultado = await prefixoComandos.resetarPrefixo()
        if (!resultado.ok) {
          return await sock.sendMessage(jid, { text: textoErro(resultado.motivo, p) }, { quoted: msg })
        }
        const texto = resultado.inalterado
          ? textoJaIgual(prefixoComandos.PREFIXO_PADRAO)
          : textoTroca(prefixoComandos.PREFIXO_PADRAO, resultado.anterior)
        return await sock.sendMessage(jid, { text: texto }, { quoted: msg })
      }

      // 5) Trocar (validação completa + gravação ficam em prefixo.js)
      const resultado = await prefixoComandos.definirPrefixo(opcao)
      if (!resultado.ok) {
        return await sock.sendMessage(jid, { text: textoErro(resultado.motivo, p) }, { quoted: msg })
      }

      const texto = resultado.inalterado
        ? textoJaIgual(resultado.prefixo)
        : textoTroca(resultado.prefixo, resultado.anterior)
      await sock.sendMessage(jid, { text: texto }, { quoted: msg })
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa do comando para o socket.
      console.error('[set-prefix] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  // Ganchos p/ testes offline (não viram comando — o loader lê nome/executar).
  _test: {
    remetenteEhDono,
    textoStatus,
    textoTroca,
    textoJaIgual,
    textoErro,
    OPCOES_RESET
  }
}